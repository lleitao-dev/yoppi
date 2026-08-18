import { describe, expect, it } from 'vitest';
import type { RoomPlayerView } from '@yoppi/protocol';
import { canStartGame, getGameCapabilities } from './game-capabilities';

const player = (overrides: Partial<RoomPlayerView> = {}): RoomPlayerView => ({
  playerId: '00000000-0000-4000-8000-000000000002',
  displayName: 'Alex',
  seat: 0,
  connected: true,
  isHost: true,
  joinedAt: '2026-08-18T00:00:00.000Z',
  participation: 'WAITING',
  ...overrides,
});

describe('game capabilities', () => {
  it('defines different player requirements per game', () => {
    expect(getGameCapabilities('BLACKJACK')).toMatchObject({ minPlayers: 1, maxPlayers: 5 });
    expect(getGameCapabilities('POKER')).toMatchObject({ minPlayers: 2, maxPlayers: 6 });
  });

  it('allows Blackjack to start with one connected waiting player', () => {
    expect(canStartGame('BLACKJACK', 'WAITING', [player()])).toBe(true);
  });

  it('ignores disconnected and non-waiting members for start eligibility', () => {
    expect(
      canStartGame('BLACKJACK', 'WAITING', [
        player({ connected: false }),
        player({ playerId: '00000000-0000-4000-8000-000000000003', participation: 'QUEUED' }),
      ]),
    ).toBe(false);
  });

  it('keeps Poker start disabled until its engine exists', () => {
    expect(
      canStartGame('POKER', 'WAITING', [
        player(),
        player({ playerId: '00000000-0000-4000-8000-000000000003', isHost: false }),
      ]),
    ).toBe(false);
  });
});
