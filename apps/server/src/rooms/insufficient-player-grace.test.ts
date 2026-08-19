import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { InsufficientPlayerGraceController } from './insufficient-player-grace';

const roomId = '00000000-0000-4000-8000-000000000101';
const aliceId = '00000000-0000-4000-8000-000000000102';
const bobId = '00000000-0000-4000-8000-000000000103';

function activePokerRoom() {
  return {
    id: roomId,
    code: 'POK234',
    gameType: 'POKER' as const,
    status: 'ACTIVE' as const,
    hostPlayerId: aliceId,
    minPlayers: 2,
    maxPlayers: 6,
    players: [
      {
        playerId: aliceId,
        displayName: 'Alice',
        seat: 0,
        connected: false,
        isHost: true,
        joinedAt: '2026-08-18T00:00:00.000Z',
        participation: 'PLAYING' as const,
      },
      {
        playerId: bobId,
        displayName: 'Bob',
        seat: 1,
        connected: false,
        isHost: false,
        joinedAt: '2026-08-18T00:01:00.000Z',
        participation: 'PLAYING' as const,
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InsufficientPlayerGraceController', () => {
  it('starts a 15-second grace period and cancels it when availability recovers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
    const manager = new RoomManager();
    manager.hydrate(activePokerRoom());
    manager.connect(roomId, aliceId, 'socket-a');
    const expired = vi.fn(async () => undefined);
    const controller = new InsufficientPlayerGraceController(manager, expired);

    const started = controller.reconcile(roomId);
    expect(started.state).toBe('STARTED');
    expect(started.room?.playerRequirement).toEqual({
      minimum: 2,
      current: 1,
      graceDeadline: '2026-08-18T12:00:15.000Z',
    });

    manager.connect(roomId, bobId, 'socket-b');
    const cancelled = controller.reconcile(roomId);
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.room?.playerRequirement.graceDeadline).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(expired).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('expires exactly once when the room remains below its minimum', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
    const manager = new RoomManager();
    manager.hydrate(activePokerRoom());
    manager.connect(roomId, aliceId, 'socket-a');
    const expired = vi.fn(async () => undefined);
    const controller = new InsufficientPlayerGraceController(manager, expired);

    controller.reconcile(roomId);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith(roomId);
    controller.dispose();
  });
});
