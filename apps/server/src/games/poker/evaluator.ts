import type { Card } from '@yoppi/game-types';
import type { PokerHandCategory } from './protocol-types';

const RANK_VALUE: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

const CATEGORY_VALUE: Record<PokerHandCategory, number> = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

export interface EvaluatedHand {
  category: PokerHandCategory;
  tiebreak: number[];
  cards: Card[];
}

function combinations<T>(values: T[], choose: number): T[][] {
  const result: T[][] = [];
  function visit(start: number, selected: T[]) {
    if (selected.length === choose) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (choose - selected.length); index += 1) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  }
  visit(0, []);
  return result;
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const run = unique.slice(index, index + 5);
    if (run.every((value, offset) => value === run[0] - offset)) return run[0];
  }
  return null;
}

export function evaluateFive(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error('Exactly five cards are required.');
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);

  if (flush && straight !== null) return { category: 'STRAIGHT_FLUSH', tiebreak: [straight], cards };
  if (groups[0][1] === 4) return { category: 'FOUR_OF_A_KIND', tiebreak: [groups[0][0], groups[1][0]], cards };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 'FULL_HOUSE', tiebreak: [groups[0][0], groups[1][0]], cards };
  if (flush) return { category: 'FLUSH', tiebreak: values, cards };
  if (straight !== null) return { category: 'STRAIGHT', tiebreak: [straight], cards };
  if (groups[0][1] === 3) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return { category: 'THREE_OF_A_KIND', tiebreak: [groups[0][0], ...kickers], cards };
  }
  const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0]).sort((a, b) => b - a);
  if (pairs.length >= 2) {
    const kicker = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a)[0];
    return { category: 'TWO_PAIR', tiebreak: [pairs[0], pairs[1], kicker], cards };
  }
  if (pairs.length === 1) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return { category: 'PAIR', tiebreak: [pairs[0], ...kickers], cards };
  }
  return { category: 'HIGH_CARD', tiebreak: values, cards };
}

export function compareHands(left: EvaluatedHand, right: EvaluatedHand): number {
  const category = CATEGORY_VALUE[left.category] - CATEGORY_VALUE[right.category];
  if (category !== 0) return category;
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left.tiebreak[index] ?? 0) - (right.tiebreak[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function evaluateBest(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new Error('Poker hands require five to seven cards.');
  let best: EvaluatedHand | null = null;
  for (const candidate of combinations(cards, 5)) {
    const evaluated = evaluateFive(candidate);
    if (!best || compareHands(evaluated, best) > 0) best = evaluated;
  }
  if (!best) throw new Error('Unable to evaluate hand.');
  return best;
}
