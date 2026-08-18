import type { ParticipationStatus, RoomView } from '@yoppi/protocol';
import { canStartGame } from './game-capabilities';

type HydratedRoom = Omit<RoomView, 'revision' | 'canStart' | 'playerRequirement'>;

const ACTIVE_REQUIREMENT_PARTICIPATION = new Set<ParticipationStatus>(['PLAYING', 'QUEUED']);

export class RoomManager {
  private readonly rooms = new Map<string, RoomView>();
  private readonly connections = new Map<string, Map<string, Set<string>>>();
  private readonly graceDeadlines = new Map<string, string>();

  hydrate(room: HydratedRoom): RoomView {
    const previous = this.rooms.get(room.id);
    const connections = this.connections.get(room.id);
    if (room.status !== 'ACTIVE') this.graceDeadlines.delete(room.id);

    const next = this.withDerivedState({
      ...room,
      revision: previous?.revision ?? 0,
      canStart: false,
      playerRequirement: {
        minimum: room.minPlayers,
        current: 0,
        graceDeadline: null,
      },
      players: room.players.map((player) => ({
        ...player,
        connected: (connections?.get(player.playerId)?.size ?? 0) > 0,
      })),
    });
    this.rooms.set(room.id, next);
    return next;
  }

  get(roomId: string): RoomView | undefined {
    return this.rooms.get(roomId);
  }

  connect(roomId: string, playerId: string, socketId: string): RoomView | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    let roomConnections = this.connections.get(roomId);
    if (!roomConnections) {
      roomConnections = new Map();
      this.connections.set(roomId, roomConnections);
    }

    let playerConnections = roomConnections.get(playerId);
    if (!playerConnections) {
      playerConnections = new Set();
      roomConnections.set(playerId, playerConnections);
    }
    playerConnections.add(socketId);
    return this.refreshConnections(roomId);
  }

  disconnectSocket(socketId: string): RoomView[] {
    const changed: RoomView[] = [];
    for (const [roomId, roomConnections] of this.connections) {
      let roomChanged = false;
      for (const [playerId, sockets] of roomConnections) {
        if (sockets.delete(socketId)) roomChanged = true;
        if (sockets.size === 0) roomConnections.delete(playerId);
      }
      if (roomConnections.size === 0) this.connections.delete(roomId);
      if (roomChanged) {
        const room = this.refreshConnections(roomId);
        if (room) changed.push(room);
      }
    }
    return changed;
  }

  disconnectPlayer(roomId: string, playerId: string): RoomView | undefined {
    this.connections.get(roomId)?.delete(playerId);
    if (this.connections.get(roomId)?.size === 0) this.connections.delete(roomId);
    return this.refreshConnections(roomId);
  }

  removePlayer(roomId: string, playerId: string): RoomView | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    this.connections.get(roomId)?.delete(playerId);
    const next = this.bump({
      ...room,
      players: room.players.filter((player) => player.playerId !== playerId),
    });
    this.rooms.set(roomId, next);
    return next;
  }

  bumpRoom(roomId: string): RoomView | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const next = this.bump(room);
    this.rooms.set(roomId, next);
    return next;
  }

  setGraceDeadline(roomId: string, deadline: string | null): RoomView | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const currentDeadline = this.graceDeadlines.get(roomId) ?? null;
    if (currentDeadline === deadline) return room;

    if (deadline === null) this.graceDeadlines.delete(roomId);
    else this.graceDeadlines.set(roomId, deadline);

    const next = this.bump(room);
    this.rooms.set(roomId, next);
    return next;
  }

  private refreshConnections(roomId: string): RoomView | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const roomConnections = this.connections.get(roomId);
    const next = this.bump({
      ...room,
      players: room.players.map((player) => ({
        ...player,
        connected: (roomConnections?.get(player.playerId)?.size ?? 0) > 0,
      })),
    });
    this.rooms.set(roomId, next);
    return next;
  }

  private bump(room: RoomView): RoomView {
    return this.withDerivedState({ ...room, revision: room.revision + 1 });
  }

  private withDerivedState(room: RoomView): RoomView {
    const current = room.players.filter((player) => {
      if (!player.connected) return false;
      if (room.status === 'WAITING') return player.participation === 'WAITING';
      if (room.status === 'ACTIVE') return ACTIVE_REQUIREMENT_PARTICIPATION.has(player.participation);
      return false;
    }).length;

    return {
      ...room,
      canStart: canStartGame(room.gameType, room.status, room.players),
      playerRequirement: {
        minimum: room.minPlayers,
        current,
        graceDeadline: room.status === 'ACTIVE' ? (this.graceDeadlines.get(room.id) ?? null) : null,
      },
    };
  }
}

export const roomManager = new RoomManager();
