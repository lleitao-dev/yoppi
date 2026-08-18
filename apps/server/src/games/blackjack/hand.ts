import type { Card } from '@yoppi/game-types';

const FACE_VALUE = 10;

export interface HandValue {
  total: number;
  soft: boolean;
  blackjack: boolean;
  bust: boolean;
}

function cardValue(card: Card): number {
  if (card.rank === 'A') return 11;
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') return FACE_VALUE;
  return Number(card.rank);
}

export function valueHand(cards: Card[]): HandValue {
  let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let acesAsEleven = cards.filter((card) => card.rank === 'A').length;

  while (total > 21 && acesAsEleven > 0) {
    total -= 10;
    acesAsEleven -= 1;
  }

  return {
    total,
    soft: acesAsEleven > 0,
    blackjack: cards.length === 2 && total === 21,
    bust: total > 21,
  };
}
