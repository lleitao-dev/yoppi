import { describe, expect, it } from 'vitest';
import type { Card } from '@yoppi/game-types';
import { compareHands, evaluateBest, evaluateFive } from './evaluator';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('Poker hand evaluator', () => {
  it('ranks a straight flush above four of a kind', () => {
    const straightFlush = evaluateFive([
      c('9', 'HEARTS'), c('10', 'HEARTS'), c('J', 'HEARTS'), c('Q', 'HEARTS'), c('K', 'HEARTS'),
    ]);
    const quads = evaluateFive([
      c('A', 'CLUBS'), c('A', 'DIAMONDS'), c('A', 'HEARTS'), c('A', 'SPADES'), c('K', 'HEARTS'),
    ]);
    expect(straightFlush.category).toBe('STRAIGHT_FLUSH');
    expect(compareHands(straightFlush, quads)).toBeGreaterThan(0);
  });

  it('recognizes an ace-low straight', () => {
    const hand = evaluateFive([
      c('A', 'SPADES'), c('2', 'CLUBS'), c('3', 'DIAMONDS'), c('4', 'HEARTS'), c('5', 'SPADES'),
    ]);
    expect(hand.category).toBe('STRAIGHT');
    expect(hand.tiebreak).toEqual([5]);
  });

  it('chooses the best five cards from seven', () => {
    const hand = evaluateBest([
      c('K', 'SPADES'), c('K', 'HEARTS'), c('K', 'DIAMONDS'),
      c('9', 'CLUBS'), c('9', 'SPADES'), c('2', 'HEARTS'), c('3', 'CLUBS'),
    ]);
    expect(hand.category).toBe('FULL_HOUSE');
    expect(hand.tiebreak).toEqual([13, 9]);
  });

  it('uses kickers to break equal pairs', () => {
    const aceKicker = evaluateFive([
      c('8', 'SPADES'), c('8', 'HEARTS'), c('A', 'CLUBS'), c('7', 'DIAMONDS'), c('2', 'SPADES'),
    ]);
    const kingKicker = evaluateFive([
      c('8', 'CLUBS'), c('8', 'DIAMONDS'), c('K', 'CLUBS'), c('7', 'HEARTS'), c('2', 'HEARTS'),
    ]);
    expect(compareHands(aceKicker, kingKicker)).toBeGreaterThan(0);
  });
});
