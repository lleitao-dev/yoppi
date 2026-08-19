import { describe, expect, it } from 'vitest';
import { PokerEngine } from './engine';

const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const CHARLIE = '00000000-0000-4000-8000-000000000003';
const ROOM = '00000000-0000-4000-8000-000000000010';

function game(turnTimeoutMs = 30_000) {
  return new PokerEngine({
    roomId: ROOM,
    hostPlayerId: ALICE,
    turnTimeoutMs,
    players: [
      { playerId: ALICE, displayName: 'Alice', seat: 0 },
      { playerId: BOB, displayName: 'Bob', seat: 1 },
    ],
  });
}

describe('Poker engine', () => {
  it('uses heads-up blind and pre-flop action order', () => {
    const engine = game();
    const state = engine.getView(ALICE);
    expect(state.dealerPlayerId).toBe(ALICE);
    expect(state.players.find((player) => player.playerId === ALICE)?.streetBet).toBe(10);
    expect(state.players.find((player) => player.playerId === BOB)?.streetBet).toBe(20);
    expect(state.currentPlayerId).toBe(ALICE);
    expect(state.callAmount).toBe(10);
  });

  it('advances through all streets and reaches showdown', () => {
    const engine = game();
    engine.call(ALICE);
    engine.check(BOB);
    expect(engine.getView(ALICE).phase).toBe('FLOP');

    engine.check(BOB);
    engine.check(ALICE);
    expect(engine.getView(ALICE).phase).toBe('TURN');

    engine.check(BOB);
    engine.check(ALICE);
    expect(engine.getView(ALICE).phase).toBe('RIVER');

    engine.check(BOB);
    engine.check(ALICE);
    const state = engine.getView(ALICE);
    expect(state.phase).toBe('HAND_COMPLETE');
    expect(state.board).toHaveLength(5);
    expect(state.players.some((player) => player.won > 0)).toBe(true);
  });

  it('awards the pot immediately when everyone else folds', () => {
    const engine = game();
    engine.fold(ALICE);
    const state = engine.getView(BOB);
    expect(state.phase).toBe('HAND_COMPLETE');
    expect(state.players.find((player) => player.playerId === BOB)?.stack).toBe(1010);
  });

  it('does not expose opponents hole cards before showdown', () => {
    const engine = game();
    const alice = engine.getView(ALICE);
    expect(alice.players.find((player) => player.playerId === ALICE)?.cards.every(Boolean)).toBe(true);
    expect(alice.players.find((player) => player.playerId === BOB)?.cards).toEqual([null, null]);
  });

  it('checks automatically on timeout when checking is legal', () => {
    const engine = game(1);
    engine.call(ALICE);
    expect(engine.getView(BOB).currentPlayerId).toBe(BOB);
    expect(engine.timeoutCurrentPlayer(Date.now() + 100)).toBe(true);
    expect(engine.getView(ALICE).phase).toBe('FLOP');
  });

  it('folds automatically on timeout when facing a bet', () => {
    const engine = game(1);
    expect(engine.timeoutCurrentPlayer(Date.now() + 100)).toBe(true);
    expect(engine.getView(BOB).phase).toBe('HAND_COMPLETE');
  });

  it('changes participants only between hands and preserves existing stacks', () => {
    const engine = game();
    engine.fold(ALICE);
    const bobStack = engine.getView(BOB).players.find((player) => player.playerId === BOB)?.stack;
    engine.syncPlayers([
      { playerId: ALICE, displayName: 'Alice', seat: 0 },
      { playerId: BOB, displayName: 'Bob', seat: 1 },
      { playerId: CHARLIE, displayName: 'Charlie', seat: 2 },
    ]);
    const state = engine.getView(CHARLIE);
    expect(state.players.find((player) => player.playerId === BOB)?.stack).toBe(bobStack);
    expect(state.players.find((player) => player.playerId === CHARLIE)?.stack).toBe(1000);
  });

  it('folds a deliberate leaver and reaches the hand boundary safely', () => {
    const engine = game();
    expect(engine.requestLeave(ALICE)).toBe(true);
    expect(engine.getView(BOB).phase).toBe('HAND_COMPLETE');
    expect(engine.isAdmissionBoundary()).toBe(true);
  });
});
