import { randomInt } from 'node:crypto';
import type { GameType, RoomView } from '@yoppi/protocol';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getGameCapabilities } from './game-capabilities';
import { roomManager } from './room-manager';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

type RoomRecord = Prisma.RoomGetPayload<{
  include: { members: { include: { player: true } } };
}>;

function roomDefaults(gameType: GameType) {
  const capabilities = getGameCapabilities(gameType);
  return gameType === 'BLACKJACK'
    ? {
        maxPlayers: capabilities.maxPlayers,
        config: { startingChips: 1000, minBet: 10, maxBet: 250 },
      }
    : {
        maxPlayers: capabilities.maxPlayers,
        config: { startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      };
}

function generateRoomCode(): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

async function uniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error('Unable to allocate a unique room code.');
}

function toRoomView(record: RoomRecord): RoomView {
  const capabilities = getGameCapabilities(record.gameType);
  return roomManager.hydrate({
    id: record.id,
    code: record.code,
    gameType: record.gameType,
    status: record.status,
    hostPlayerId: record.hostId,
    minPlayers: capabilities.minPlayers,
    maxPlayers: record.maxPlayers,
    players: record.members
      .filter((member) => member.leftAt === null)
      .sort((a, b) => {
        if (a.seat === null && b.seat === null) return a.joinedAt.getTime() - b.joinedAt.getTime();
        if (a.seat === null) return 1;
        if (b.seat === null) return -1;
        return a.seat - b.seat;
      })
      .map((member) => ({
        playerId: member.playerId,
        displayName: member.player.displayName,
        seat: member.seat,
        connected: false,
        isHost: member.playerId === record.hostId,
        joinedAt: member.joinedAt.toISOString(),
        participation: member.participation,
      })),
  });
}

const roomInclude = {
  members: { include: { player: true } },
} satisfies Prisma.RoomInclude;

function nextSeat(activeMembers: RoomRecord['members']): number {
  const usedSeats = new Set(
    activeMembers.map((member) => member.seat).filter((seat): seat is number => seat !== null),
  );
  let seat = 0;
  while (usedSeats.has(seat)) seat += 1;
  return seat;
}

export async function createRoom(playerId: string, gameType: GameType): Promise<RoomView> {
  const code = await uniqueRoomCode();
  const defaults = roomDefaults(gameType);

  const record = await prisma.room.create({
    data: {
      code,
      gameType,
      hostId: playerId,
      maxPlayers: defaults.maxPlayers,
      config: defaults.config,
      members: { create: { playerId, seat: 0, participation: 'WAITING' } },
    },
    include: roomInclude,
  });

  return toRoomView(record);
}

export async function getRoomById(roomId: string): Promise<RoomView | null> {
  const record = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  return record ? toRoomView(record) : null;
}

export async function getRoomForMember(roomId: string, playerId: string): Promise<RoomView | null> {
  const record = await prisma.room.findUnique({
    where: { id: roomId },
    include: roomInclude,
  });
  if (!record) return null;
  const member = record.members.find(
    (entry) => entry.playerId === playerId && entry.leftAt === null,
  );
  if (!member) return null;
  return toRoomView(record);
}

export async function joinRoom(playerId: string, code: string): Promise<RoomView> {
  const room = await prisma.room.findUnique({
    where: { code },
    include: roomInclude,
  });
  if (!room) throw new RoomServiceError('ROOM_NOT_FOUND', 'Room not found.');

  const activeMembers = room.members.filter((member) => member.leftAt === null);
  const existing = activeMembers.find((member) => member.playerId === playerId);

  // Existing members may always resolve the room by code, including active-game reconnects.
  if (existing) return toRoomView(room);

  if (room.status !== 'WAITING' && room.status !== 'ACTIVE') {
    throw new RoomServiceError('ROOM_ALREADY_STARTED', 'This room is no longer accepting players.');
  }

  const occupancy = activeMembers.filter((member) => member.participation !== 'LEAVING').length;
  if (occupancy >= room.maxPlayers) {
    throw new RoomServiceError('ROOM_FULL', 'This room is full.');
  }

  const previousMembership = room.members.find((member) => member.playerId === playerId);
  const participation = room.status === 'ACTIVE' ? 'QUEUED' : 'WAITING';
  const seat = room.status === 'ACTIVE' ? null : nextSeat(activeMembers);
  const joinedAt = new Date();

  if (previousMembership) {
    await prisma.roomMember.update({
      where: { id: previousMembership.id },
      data: { seat, leftAt: null, joinedAt, participation },
    });
  } else {
    await prisma.roomMember.create({
      data: { roomId: room.id, playerId, seat, participation, joinedAt },
    });
  }

  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: room.id },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return roomManager.bumpRoom(view.id) ?? view;
}

export interface LeaveRoomResult {
  room: RoomView | null;
  disposition: 'LEFT' | 'DEFERRED';
}

export async function leaveRoom(roomId: string, playerId: string): Promise<LeaveRoomResult> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room) return { room: null, disposition: 'LEFT' };

  const member = room.members.find((entry) => entry.playerId === playerId && entry.leftAt === null);
  if (!member) return { room: null, disposition: 'LEFT' };

  if (room.status === 'ACTIVE' && member.participation === 'PLAYING') {
    await prisma.roomMember.update({
      where: { id: member.id },
      data: { participation: 'LEAVING' },
    });
    const updated = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      include: roomInclude,
    });
    const view = toRoomView(updated);
    return { room: roomManager.bumpRoom(roomId) ?? view, disposition: 'DEFERRED' };
  }

  if (room.status === 'ACTIVE' && member.participation === 'LEAVING') {
    return { room: toRoomView(room), disposition: 'DEFERRED' };
  }

  const remaining = room.members
    .filter((entry) => entry.leftAt === null && entry.playerId !== playerId)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const nextHostPlayerId = remaining[0]?.playerId;

  await prisma.$transaction(async (tx) => {
    await tx.roomMember.update({
      where: { id: member.id },
      data: { leftAt: new Date(), seat: null },
    });
    if (room.status === 'WAITING' && remaining.length === 0) {
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    } else if (room.status === 'WAITING' && room.hostId === playerId && nextHostPlayerId) {
      await tx.room.update({ where: { id: roomId }, data: { hostId: nextHostPlayerId } });
    }
  });

  roomManager.removePlayer(roomId, playerId);
  if (room.status === 'WAITING' && remaining.length === 0) {
    return { room: null, disposition: 'LEFT' };
  }

  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return { room: roomManager.bumpRoom(roomId) ?? view, disposition: 'LEFT' };
}

export interface BoundaryMembershipResult {
  room: RoomView | null;
  changed: boolean;
  admittedPlayerIds: string[];
  removedPlayerIds: string[];
}

export async function applyBoundaryMembership(roomId: string): Promise<BoundaryMembershipResult> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room || room.status !== 'ACTIVE') {
    return {
      room: room ? toRoomView(room) : null,
      changed: false,
      admittedPlayerIds: [],
      removedPlayerIds: [],
    };
  }

  const currentView = toRoomView(room);
  const connectedPlayerIds = new Set(
    currentView.players.filter((player) => player.connected).map((player) => player.playerId),
  );
  const activeMembers = room.members.filter((member) => member.leftAt === null);
  const leaving = activeMembers.filter((member) => member.participation === 'LEAVING');
  const playing = activeMembers.filter((member) => member.participation === 'PLAYING');
  const queued = activeMembers
    .filter(
      (member) => member.participation === 'QUEUED' && connectedPlayerIds.has(member.playerId),
    )
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

  const availableSeats = Math.max(0, room.maxPlayers - playing.length);
  const admitted = queued.slice(0, availableSeats);
  const removedPlayerIds = leaving.map((member) => member.playerId);
  const admittedPlayerIds = admitted.map((member) => member.playerId);

  if (removedPlayerIds.length === 0 && admittedPlayerIds.length === 0) {
    return { room: currentView, changed: false, admittedPlayerIds: [], removedPlayerIds: [] };
  }

  const usedSeats = new Set(
    playing.map((member) => member.seat).filter((seat): seat is number => seat !== null),
  );

  await prisma.$transaction(async (tx) => {
    if (removedPlayerIds.length > 0) {
      await tx.roomMember.updateMany({
        where: { roomId, leftAt: null, participation: 'LEAVING' },
        data: { leftAt: new Date(), seat: null },
      });
    }

    for (const member of admitted) {
      let seat = 0;
      while (usedSeats.has(seat)) seat += 1;
      usedSeats.add(seat);
      await tx.roomMember.update({
        where: { id: member.id },
        data: { participation: 'PLAYING', seat },
      });
    }
  });

  for (const playerId of removedPlayerIds) roomManager.removePlayer(roomId, playerId);

  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return {
    room: roomManager.bumpRoom(roomId) ?? view,
    changed: true,
    admittedPlayerIds,
    removedPlayerIds,
  };
}

export interface InsufficientPlayerTimeoutResult {
  room: RoomView | null;
  closed: boolean;
}

export async function resetRoomAfterInsufficientPlayers(
  roomId: string,
): Promise<InsufficientPlayerTimeoutResult> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room) return { room: null, closed: true };
  if (room.status !== 'ACTIVE') return { room: toRoomView(room), closed: room.status === 'CLOSED' };

  const activeMembers = room.members
    .filter((member) => member.leftAt === null)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const leaving = activeMembers.filter((member) => member.participation === 'LEAVING');
  const survivors = activeMembers.filter((member) => member.participation !== 'LEAVING');
  const endedAt = new Date();
  const nextHostId = survivors.some((member) => member.playerId === room.hostId)
    ? room.hostId
    : (survivors[0]?.playerId ?? room.hostId);

  await prisma.$transaction(async (tx) => {
    if (leaving.length > 0) {
      await tx.roomMember.updateMany({
        where: { roomId, leftAt: null, participation: 'LEAVING' },
        data: { leftAt: endedAt, seat: null },
      });
    }

    if (survivors.length > 0) {
      await tx.roomMember.updateMany({
        where: { id: { in: survivors.map((member) => member.id) } },
        data: { participation: 'WAITING', seat: null },
      });
      for (const [seat, member] of survivors.entries()) {
        await tx.roomMember.update({
          where: { id: member.id },
          data: { seat },
        });
      }
    }

    await tx.gameSession.updateMany({
      where: { roomId, endedAt: null },
      data: { endedAt },
    });

    if (survivors.length === 0) {
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'CLOSED', closedAt: endedAt },
      });
    } else {
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'WAITING', closedAt: null, hostId: nextHostId },
      });
    }
  });

  for (const member of leaving) roomManager.removePlayer(roomId, member.playerId);

  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return { room: roomManager.bumpRoom(roomId) ?? view, closed: updated.status === 'CLOSED' };
}

export interface HostTransferResult {
  room: RoomView;
  changed: boolean;
}

export async function ensureConnectedHost(roomId: string): Promise<HostTransferResult | null> {
  const current = roomManager.get(roomId);
  if (!current || current.status === 'CLOSED')
    return current ? { room: current, changed: false } : null;

  const host = current.players.find((player) => player.playerId === current.hostPlayerId);
  if (host?.connected && host.participation !== 'LEAVING') return { room: current, changed: false };

  const hostPriority = { PLAYING: 0, QUEUED: 1, WAITING: 2, LEAVING: 3 } as const;
  const replacement = [...current.players]
    .filter((player) => player.connected && player.participation !== 'LEAVING')
    .sort((a, b) => {
      const participationOrder = hostPriority[a.participation] - hostPriority[b.participation];
      if (participationOrder !== 0) return participationOrder;
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    })[0];

  if (!replacement || replacement.playerId === current.hostPlayerId) {
    return { room: current, changed: false };
  }

  await prisma.room.update({ where: { id: roomId }, data: { hostId: replacement.playerId } });
  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return { room: roomManager.bumpRoom(roomId) ?? view, changed: true };
}

async function startRoomByType(
  roomId: string,
  playerId: string,
  gameType: GameType,
): Promise<RoomView> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room) throw new RoomServiceError('ROOM_NOT_FOUND', 'Room not found.');

  const member = room.members.find((entry) => entry.playerId === playerId && entry.leftAt === null);
  if (!member) throw new RoomServiceError('NOT_ROOM_MEMBER', 'You are not a member of this room.');
  if (room.gameType !== gameType) {
    throw new RoomServiceError(
      'WRONG_GAME_TYPE',
      `This room is configured for ${room.gameType.toLowerCase()}.`,
    );
  }
  if (room.status !== 'WAITING') {
    throw new RoomServiceError('ROOM_ALREADY_STARTED', 'This room has already started.');
  }

  const current = toRoomView(room);
  if (!current.canStart) {
    const label = gameType === 'BLACKJACK' ? 'Blackjack' : "Texas Hold'em";
    throw new RoomServiceError(
      'INSUFFICIENT_PLAYERS',
      `${label} requires at least ${current.minPlayers} connected player${current.minPlayers === 1 ? '' : 's'}.`,
    );
  }

  const playingPlayerIds = current.players
    .filter((player) => player.connected && player.participation === 'WAITING')
    .map((player) => player.playerId);

  const gameConfig = room.config ?? {};

  await prisma.$transaction(async (tx) => {
    await tx.room.update({ where: { id: roomId }, data: { status: 'ACTIVE' } });
    await tx.roomMember.updateMany({
      where: { roomId, leftAt: null, playerId: { in: playingPlayerIds } },
      data: { participation: 'PLAYING' },
    });
    await tx.roomMember.updateMany({
      where: { roomId, leftAt: null, playerId: { notIn: playingPlayerIds } },
      data: { participation: 'QUEUED', seat: null },
    });
    await tx.gameSession.create({ data: { roomId, gameType, config: gameConfig } });
  });

  const updated = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: roomInclude,
  });
  const view = toRoomView(updated);
  return roomManager.bumpRoom(roomId) ?? view;
}

export function startBlackjackRoom(roomId: string, playerId: string): Promise<RoomView> {
  return startRoomByType(roomId, playerId, 'BLACKJACK');
}

export function startPokerRoom(roomId: string, playerId: string): Promise<RoomView> {
  return startRoomByType(roomId, playerId, 'POKER');
}

export class RoomServiceError extends Error {
  constructor(
    public readonly code:
      | 'ROOM_NOT_FOUND'
      | 'ROOM_FULL'
      | 'ROOM_ALREADY_STARTED'
      | 'INSUFFICIENT_PLAYERS'
      | 'NOT_ROOM_MEMBER'
      | 'NOT_ROOM_HOST'
      | 'WRONG_GAME_TYPE',
    message: string,
  ) {
    super(message);
  }
}
