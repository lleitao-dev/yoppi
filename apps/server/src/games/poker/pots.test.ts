import { describe, expect, it } from 'vitest';
import { buildSidePots } from './pots';

describe('Poker side pots', () => {
  it('builds one pot when contributions are equal', () => {
    expect(buildSidePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ])).toEqual([{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }]);
  });

  it('builds main and side pots from unequal all-in contributions', () => {
    expect(buildSidePots([
      { playerId: 'a', amount: 50, folded: false },
      { playerId: 'b', amount: 120, folded: false },
      { playerId: 'c', amount: 200, folded: false },
    ])).toEqual([
      { amount: 150, eligiblePlayerIds: ['a', 'b', 'c'] },
      { amount: 140, eligiblePlayerIds: ['b', 'c'] },
      { amount: 80, eligiblePlayerIds: ['c'] },
    ]);
  });

  it('keeps folded chips in pots while excluding the folded player from winning', () => {
    expect(buildSidePots([
      { playerId: 'a', amount: 100, folded: true },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: false },
    ])).toEqual([{ amount: 300, eligiblePlayerIds: ['b', 'c'] }]);
  });
});
