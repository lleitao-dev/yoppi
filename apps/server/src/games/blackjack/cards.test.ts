import { describe, expect, it } from 'vitest';
import { createDeck, createShoe, shuffleCards } from './cards';

describe('secure card primitives', () => {
  it('creates a standard 52-card deck', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}-${card.suit}`)).size).toBe(52);
  });

  it('creates a six-deck shoe', () => {
    const shoe = createShoe(6, (_min, max) => max - 1);
    expect(shoe).toHaveLength(312);
  });

  it('uses Fisher-Yates bounds for every swap', () => {
    const bounds: Array<[number, number]> = [];
    shuffleCards(createDeck().slice(0, 4), (min, max) => {
      bounds.push([min, max]);
      return 0;
    });
    expect(bounds).toEqual([
      [0, 4],
      [0, 3],
      [0, 2],
    ]);
  });
});
