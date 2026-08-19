import { randomInt } from 'node:crypto';
import { CARD_RANKS, CARD_SUITS, type Card } from '@yoppi/game-types';

export function createPokerDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) cards.push({ suit, rank });
  }
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
}
