export interface PotContribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

export interface PokerPot {
  amount: number;
  eligiblePlayerIds: string[];
}

export function buildSidePots(contributions: PotContribution[]): PokerPot[] {
  const positive = contributions.filter((entry) => entry.amount > 0);
  const levels = [...new Set(positive.map((entry) => entry.amount))].sort((a, b) => a - b);
  const pots: PokerPot[] = [];
  let previous = 0;

  for (const level of levels) {
    const contributors = positive.filter((entry) => entry.amount >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) {
      pots.push({
        amount,
        eligiblePlayerIds: contributors.filter((entry) => !entry.folded).map((entry) => entry.playerId),
      });
    }
    previous = level;
  }
  return pots;
}
