import { describe, expect, it } from 'vitest';
import { RoomManager } from './room-manager';

const roomId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';

function baseRoom() {
  return {
    id: roomId,
    code: 'ABC234',
    gameType: 'BLACKJACK' as const,
    status: 'WAITING' as const,
    hostPlayerId: playerId,
    minPlayers: 1,
    maxPlayers: 5,
    players: [
      {
        playerId,
        displayName: 'Alex',
        seat: 0,
        connected: false,
        isHost: true,
        joinedAt: '2026-08-18T00:00:00.000Z',
        participation: 'WAITING' as const,
      },
    ],
  };
}

describe('RoomManager', () => {
  it('tracks socket connection state, start capability, and room revisions', () => {
    const manager = new RoomManager();
    const initial = manager.hydrate(baseRoom());
    expect(initial.revision).toBe(0);
    expect(initial.players[0]!.connected).toBe(false);
    expect(initial.canStart).toBe(false);
    expect(initial.playerRequirement).toEqual({ minimum: 1, current: 0, graceDeadline: null });

    const connected = manager.connect(roomId, playerId, 'socket-1');
    expect(connected?.revision).toBe(1);
    expect(connected?.players[0]!.connected).toBe(true);
    expect(connected?.canStart).toBe(true);
    expect(connected?.playerRequirement.current).toBe(1);

    const changed = manager.disconnectSocket('socket-1');
    expect(changed).toHaveLength(1);
    expect(changed[0]!.revision).toBe(2);
    expect(changed[0]!.players[0]!.connected).toBe(false);
    expect(changed[0]!.canStart).toBe(false);
    expect(changed[0]!.playerRequirement.current).toBe(0);
  });

  it('keeps a player connected while another socket remains', () => {
    const manager = new RoomManager();
    manager.hydrate(baseRoom());
    manager.connect(roomId, playerId, 'socket-1');
    manager.connect(roomId, playerId, 'socket-2');

    const changed = manager.disconnectSocket('socket-1');
    expect(changed[0]!.players[0]!.connected).toBe(true);
  });

  it('disconnects every socket for one room member without removing membership', () => {
    const manager = new RoomManager();
    manager.hydrate(baseRoom());
    manager.connect(roomId, playerId, 'socket-1');
    manager.connect(roomId, playerId, 'socket-2');

    const disconnected = manager.disconnectPlayer(roomId, playerId);
    expect(disconnected?.players).toHaveLength(1);
    expect(disconnected?.players[0]!.connected).toBe(false);
  });

  it('counts connected playing and queued members toward an active-game requirement', () => {
    const manager = new RoomManager();
    manager.hydrate({
      ...baseRoom(),
      gameType: 'POKER',
      status: 'ACTIVE',
      minPlayers: 2,
      maxPlayers: 6,
      players: [
        { ...baseRoom().players[0]!, participation: 'PLAYING' },
        {
          playerId: '00000000-0000-4000-8000-000000000003',
          displayName: 'Queued',
          seat: null,
          connected: false,
          isHost: false,
          joinedAt: '2026-08-18T00:01:00.000Z',
          participation: 'QUEUED',
        },
      ],
    });

    manager.connect(roomId, playerId, 'socket-1');
    expect(manager.get(roomId)?.playerRequirement.current).toBe(1);
    manager.connect(roomId, '00000000-0000-4000-8000-000000000003', 'socket-2');
    expect(manager.get(roomId)?.playerRequirement.current).toBe(2);
  });
});
