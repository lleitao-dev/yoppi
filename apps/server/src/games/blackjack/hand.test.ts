import { describe, expect, it } from 'vitest';
import type { Card } from '@yoppi/game-types';
import { valueHand } from './hand';

const card = (rank: Card['rank']): Card => ({ rank, suit: 'SPADES' });

describe('valueHand', () => {
  it('counts an ace as eleven when possible', () => {
    expect(valueHand([card('A'), card('7')])).toMatchObject({ total: 18, soft: true, bust: false });
  });

  it('reduces multiple aces as required', () => {
    expect(valueHand([card('A'), card('A'), card('9')])).toMatchObject({ total: 21, soft: true });
    expect(valueHand([card('A'), card('A'), card('9'), card('9')])).toMatchObject({
      total: 20,
      soft: false,
    });
  });

  it('recognizes natural blackjack and busts', () => {
    expect(valueHand([card('A'), card('K')]).blackjack).toBe(true);
    expect(valueHand([card('K'), card('8'), card('5')]).bust).toBe(true);
  });
});
