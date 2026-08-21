import { describe, expect, it } from 'vitest';
import type { Card } from '@yoppi/game-types';
import { BlackjackEngine, BlackjackEngineError } from './engine';

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const ROOM = '00000000-0000-4000-8000-000000000010';

function card(rank: Card['rank'], suit: Card['suit'] = 'SPADES'): Card {
  return { rank, suit };
}

function shoe(drawOrder: Card[]): Card[] {
  return [...drawOrder].reverse();
}

function engine(drawOrder: Card[], options: { twoPlayers?: boolean; startingChips?: number } = {}) {
  return new BlackjackEngine({
    roomId: ROOM,
    hostPlayerId: P1,
    ...(options.startingChips === undefined ? {} : { startingChips: options.startingChips }),
    players: [
      { playerId: P1, displayName: 'Alice', seat: 0 },
      ...(options.twoPlayers ? [{ playerId: P2, displayName: 'Bob', seat: 1 }] : []),
    ],
    shoe: shoe(drawOrder),
  });
}

function playerState(game: BlackjackEngine, playerId = P1) {
  return game.getView(playerId).players.find((player) => player.playerId === playerId)!;
}

describe('BlackjackEngine', () => {
  it('rejects bets outside the configured ten-chip increment', () => {
    const game = engine([]);
    expect(() => game.placeBet(P1, 15)).toThrowError(BlackjackEngineError);
    try {
      game.placeBet(P1, 15);
    } catch (error) {
      expect((error as BlackjackEngineError).code).toBe('INVALID_BET');
    }
  });

  it('rejects a bet larger than the player stack', () => {
    const game = engine([], { startingChips: 20 });
    try {
      game.placeBet(P1, 30);
      throw new Error('Expected insufficient chips.');
    } catch (error) {
      expect((error as BlackjackEngineError).code).toBe('INSUFFICIENT_CHIPS');
    }
  });

  it('deducts a valid bet and automatically deals once all players have bet', () => {
    const game = engine([card('10'), card('9'), card('7'), card('8')]);
    game.placeBet(P1, 20);
    const view = game.getView(P1);
    expect(view.phase).toBe('PLAYER_TURNS');
    expect(playerState(game).chips).toBe(980);
    expect(playerState(game).bet).toBe(20);
  });

  it('waits for every seated player before dealing', () => {
    const game = engine([card('10'), card('9'), card('8'), card('7'), card('6'), card('5')], {
      twoPlayers: true,
    });
    game.placeBet(P1, 10);
    expect(game.getView(P1).phase).toBe('BETTING');
    game.placeBet(P2, 10);
    expect(game.getView(P1).phase).toBe('PLAYER_TURNS');
    expect(game.getView(P1).currentPlayerId).toBe(P1);
  });

  it('hides the dealer hole card until dealer resolution', () => {
    const game = engine([card('10'), card('10'), card('8'), card('7')]);
    game.placeBet(P1, 10);
    expect(game.getView(P1).dealer.cards).toEqual([card('10'), null]);
    expect(game.getView(P1).dealer.total).toBeNull();
    game.stand(P1);
    expect(game.getView(P1).dealer.cards).toEqual([card('10'), card('7')]);
    expect(game.getView(P1).dealer.total).toBe(17);
  });

  it('pays a natural blackjack at 3:2', () => {
    const game = engine([card('A'), card('9'), card('K'), card('7')]);
    game.placeBet(P1, 10);
    const player = playerState(game);
    expect(game.getView(P1).phase).toBe('ROUND_COMPLETE');
    expect(player.result).toBe('BLACKJACK');
    expect(player.net).toBe(15);
    expect(player.chips).toBe(1015);
  });

  it('pushes when both player and dealer have natural blackjack', () => {
    const game = engine([card('A'), card('A'), card('K'), card('K')]);
    game.placeBet(P1, 20);
    const player = playerState(game);
    expect(player.result).toBe('PUSH');
    expect(player.chips).toBe(1000);
  });

  it('returns the stake on a push', () => {
    const game = engine([card('10'), card('10'), card('7'), card('7')]);
    game.placeBet(P1, 20);
    game.stand(P1);
    const player = playerState(game);
    expect(player.result).toBe('PUSH');
    expect(player.net).toBe(0);
    expect(player.chips).toBe(1000);
  });

  it('pays a normal win at 1:1', () => {
    const game = engine([card('10'), card('10'), card('8'), card('7')]);
    game.placeBet(P1, 20);
    game.stand(P1);
    const player = playerState(game);
    expect(player.result).toBe('WIN');
    expect(player.net).toBe(20);
    expect(player.chips).toBe(1020);
  });

  it('marks a hit over 21 as a bust', () => {
    const game = engine([card('10'), card('9'), card('6'), card('7'), card('10')]);
    game.placeBet(P1, 10);
    game.hit(P1);
    const player = playerState(game);
    expect(player.result).toBe('BUST');
    expect(player.total).toBe(26);
    expect(player.chips).toBe(990);
    expect(game.getView(P1).phase).toBe('ROUND_COMPLETE');
  });

  it('stands on dealer soft 17', () => {
    const game = engine([card('10'), card('A'), card('8'), card('6'), card('10')]);
    game.placeBet(P1, 10);
    game.stand(P1);
    const view = game.getView(P1);
    expect(view.dealer.total).toBe(17);
    expect(view.dealer.soft).toBe(true);
    expect(view.dealer.cards).toHaveLength(2);
  });

  it('draws on dealer hard 16', () => {
    const game = engine([card('10'), card('10'), card('9'), card('6'), card('2')]);
    game.placeBet(P1, 10);
    game.stand(P1);
    const view = game.getView(P1);
    expect(view.dealer.total).toBe(18);
    expect(view.dealer.cards).toHaveLength(3);
  });

  it('double down doubles the stake, deals exactly one card, and ends the turn', () => {
    const game = engine([card('5'), card('10'), card('6'), card('7'), card('10')], {
      startingChips: 100,
    });
    game.placeBet(P1, 10);
    game.doubleDown(P1);
    const player = playerState(game);
    expect(player.cards).toHaveLength(3);
    expect(player.bet).toBe(20);
    expect(player.total).toBe(21);
    expect(player.result).toBe('WIN');
    expect(player.chips).toBe(120);
  });

  it('rejects a double down without enough chips', () => {
    const game = engine([card('5'), card('10'), card('6'), card('7')], { startingChips: 10 });
    game.placeBet(P1, 10);
    expect(() => game.doubleDown(P1)).toThrowError(BlackjackEngineError);
    try {
      game.doubleDown(P1);
    } catch (error) {
      expect((error as BlackjackEngineError).code).toBe('INSUFFICIENT_CHIPS');
    }
  });

  it('enforces player turn order', () => {
    const game = engine([card('10'), card('9'), card('8'), card('7'), card('7'), card('8')], {
      twoPlayers: true,
    });
    game.placeBet(P1, 10);
    game.placeBet(P2, 10);
    expect(() => game.stand(P2)).toThrowError(BlackjackEngineError);
    game.stand(P1);
    expect(game.getView(P2).currentPlayerId).toBe(P2);
  });

  it('transfers next-round authority to the new room host', () => {
    const game = engine([card('A'), card('10'), card('9'), card('K'), card('Q'), card('7')], {
      twoPlayers: true,
    });
    game.placeBet(P1, 10);
    game.placeBet(P2, 10);
    game.stand(P2);

    expect(game.getView(P1).phase).toBe('ROUND_COMPLETE');
    expect(game.getView(P2).allowedActions).not.toContain('NEXT_ROUND');

    game.setHostPlayerId(P2);
    expect(game.getView(P2).allowedActions).toContain('NEXT_ROUND');
    expect(game.getView(P1).allowedActions).not.toContain('NEXT_ROUND');
  });

  it('allows only the host to begin the next round', () => {
    const game = engine([card('A'), card('9'), card('K'), card('7')], { twoPlayers: false });
    game.placeBet(P1, 10);
    expect(game.getView(P1).allowedActions).toContain('NEXT_ROUND');
    game.beginNextRound(P1);
    expect(game.getView(P1)).toMatchObject({ phase: 'BETTING', round: 2 });
    expect(playerState(game).bet).toBe(0);
    expect(playerState(game).cards).toHaveLength(0);
  });

  it('lets a player leave during betting without deadlocking the round', () => {
    const game = engine([]);
    expect(game.requestLeave(P1)).toBe(true);
    const view = game.getView(P1);
    expect(view.phase).toBe('ROUND_COMPLETE');
    expect(view.dealer.cards).toHaveLength(0);
    expect(view.allowedActions).toEqual([]);
  });

  it('safely stands a departing player during player turns', () => {
    const game = engine(
      [card('10'), card('9'), card('8'), card('7'), card('6'), card('7'), card('2')],
      { twoPlayers: true },
    );
    game.placeBet(P1, 10);
    game.placeBet(P2, 10);
    expect(game.getView(P1).currentPlayerId).toBe(P1);

    expect(game.requestLeave(P1)).toBe(true);
    expect(game.getView(P2).currentPlayerId).toBe(P2);
    expect(game.getView(P1).allowedActions).toEqual([]);

    game.stand(P2);
    expect(game.getView(P2).phase).toBe('ROUND_COMPLETE');
  });

  it('synchronizes departures and newly admitted players only at a round boundary', () => {
    const game = engine([card('A'), card('9'), card('K'), card('7')]);
    game.placeBet(P1, 10);
    expect(game.getView(P1).phase).toBe('ROUND_COMPLETE');
    expect(playerState(game, P1).chips).toBe(1015);

    game.syncPlayers([
      { playerId: P1, displayName: 'Alice', seat: 0 },
      { playerId: P2, displayName: 'Bob', seat: 1 },
    ]);
    expect(playerState(game, P1).chips).toBe(1015);
    expect(playerState(game, P2).chips).toBe(1000);

    game.syncPlayers([{ playerId: P2, displayName: 'Bob', seat: 0 }]);
    expect(game.getView(P2).players.map((player) => player.playerId)).toEqual([P2]);
  });

  it('sits out a disconnected player during betting and restores eligibility on reconnect', () => {
    const game = engine([], { twoPlayers: true });
    expect(game.playerDisconnected(P2)).toBe(true);
    expect(game.getView(P2).players.find((player) => player.playerId === P2)?.status).toBe('OUT');
    expect(game.playerConnected(P2)).toBe(true);
    expect(game.getView(P2).players.find((player) => player.playerId === P2)?.status).toBe(
      'BETTING',
    );
  });

  it('carries a disconnected placed bet into the round as a standing hand', () => {
    const game = engine(
      [card('10'), card('9'), card('8'), card('7'), card('6'), card('7'), card('2')],
      { twoPlayers: true },
    );
    game.placeBet(P1, 10);
    expect(game.playerDisconnected(P1)).toBe(false);
    game.placeBet(P2, 10);
    expect(game.getView(P2).players.find((player) => player.playerId === P1)?.status).toBe(
      'STANDING',
    );
    game.stand(P2);
    expect(game.getView(P2).phase).toBe('ROUND_COMPLETE');
  });

  it('stands a disconnected future-turn player so the round cannot deadlock later', () => {
    const game = engine(
      [card('10'), card('9'), card('8'), card('7'), card('6'), card('7'), card('2')],
      { twoPlayers: true },
    );
    game.placeBet(P1, 10);
    game.placeBet(P2, 10);
    expect(game.getView(P1).currentPlayerId).toBe(P1);

    expect(game.playerDisconnected(P2)).toBe(true);
    expect(game.getView(P1).players.find((player) => player.playerId === P2)?.status).toBe(
      'STANDING',
    );
    game.stand(P1);
    expect(game.getView(P1).phase).toBe('ROUND_COMPLETE');
  });

  it('rejects participant synchronization in the middle of a round', () => {
    const game = engine([card('10'), card('9'), card('7'), card('8')]);
    game.placeBet(P1, 10);
    expect(game.getView(P1).phase).toBe('PLAYER_TURNS');
    expect(() => game.syncPlayers([{ playerId: P1, displayName: 'Alice', seat: 0 }])).toThrow(
      'Blackjack participants can only be synchronized at a round boundary.',
    );
  });
});
