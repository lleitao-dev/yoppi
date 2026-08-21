export type GameType = 'BLACKJACK' | 'POKER';

export type RoomStatus = 'WAITING' | 'ACTIVE' | 'COMPLETE' | 'CLOSED';

export const CARD_SUITS = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'] as const;
export type CardSuit = (typeof CARD_SUITS)[number];

export const CARD_RANKS = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
] as const;
export type CardRank = (typeof CARD_RANKS)[number];

export interface Card {
  suit: CardSuit;
  rank: CardRank;
}
