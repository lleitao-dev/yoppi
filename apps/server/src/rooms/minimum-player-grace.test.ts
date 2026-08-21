import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { MinimumPlayerGraceController } from './minimum-player-grace';

const roomId = '00000000-0000-4000-8000-000000000001';
const aliceId = '00000000-0000-4000-8000-000000000002';
const bobId = '00000000-0000-4000-8000-000000000003';

function activePokerRoom() {
  return {
    id: roomId,
    code: 'ABC234',
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

describe('MinimumPlayerGraceController', () => {
  it('starts a 15 second grace period and expires server-side', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T07:00:00.000Z'));
    const manager = new RoomManager();
    manager.hydrate(activePokerRoom());
    manager.connect(roomId, aliceId, 'socket-alice');
    const expired = vi.fn(async () => undefined);
    const controller = new MinimumPlayerGraceController(manager, { onExpired: expired });

    const reconciliation = controller.reconcile(roomId);
    expect(reconciliation.state).toBe('STARTED');
    expect(reconciliation.room?.playerRequirement).toEqual({
      minimum: 2,
      current: 1,
      graceDeadline: '2026-08-18T07:00:15.000Z',
    });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledWith(roomId);
    controller.close();
  });

  it('cancels the grace period when a queued player arrives', async () => {
    vi.useFakeTimers();
    const manager = new RoomManager();
    const room = activePokerRoom();
    manager.hydrate({
      ...room,
      players: [room.players[0]!, { ...room.players[1]!, seat: null, participation: 'QUEUED' }],
    });
    manager.connect(roomId, aliceId, 'socket-alice');
    const expired = vi.fn(async () => undefined);
    const controller = new MinimumPlayerGraceController(manager, { onExpired: expired });

    expect(controller.reconcile(roomId).state).toBe('STARTED');
    manager.connect(roomId, bobId, 'socket-bob');
    const reconciliation = controller.reconcile(roomId);

    expect(reconciliation.state).toBe('CANCELLED');
    expect(reconciliation.room?.playerRequirement.current).toBe(2);
    expect(reconciliation.room?.playerRequirement.graceDeadline).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(expired).not.toHaveBeenCalled();
    controller.close();
  });
});
