import { describe, expect, it } from 'vitest';
import { createPokerDeck } from './cards';

describe('Poker deck', () => {
  it('contains each of the 52 cards exactly once', () => {
    const deck = createPokerDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}-${card.suit}`)).size).toBe(52);
  });
});
