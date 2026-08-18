import { randomInt } from 'node:crypto';
import { CARD_RANKS, CARD_SUITS, type Card } from '@yoppi/game-types';

export type RandomInt = (min: number, max: number) => number;

export function createDeck(): Card[] {
  return CARD_SUITS.flatMap((suit) => CARD_RANKS.map((rank) => ({ suit, rank })));
}

export function shuffleCards(cards: Card[], rng: RandomInt = randomInt): Card[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = rng(0, index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function createShoe(deckCount = 6, rng: RandomInt = randomInt): Card[] {
  if (!Number.isInteger(deckCount) || deckCount < 1) {
    throw new Error('deckCount must be a positive integer.');
  }
  const cards = Array.from({ length: deckCount }, () => createDeck()).flat();
  return shuffleCards(cards, rng);
}

export function drawCard(shoe: Card[]): Card {
  const card = shoe.pop();
  if (!card) throw new Error('The shoe is empty.');
  return card;
}
