/** Pure result and turnout calculations. */

export type CandidateTotal = {
  candidateId: number;
  name: string;
  displayOrder: number;
  votes: number;
};

export type Turnout = {
  registered: number;
  eligible: number;
  voted: number;
  notVoted: number;
  /** Percentage of eligible voters who voted, rounded to one decimal. */
  turnoutPercent: number;
};

export function computeTurnout(input: { registered: number; eligible: number; voted: number }): Turnout {
  const notVoted = Math.max(0, input.eligible - input.voted);
  const turnoutPercent =
    input.eligible === 0 ? 0 : Math.round((input.voted / input.eligible) * 1000) / 10;
  return { ...input, notVoted, turnoutPercent };
}

/** Sorted by votes (desc), then ballot order, then name. Does not mutate input. */
export function sortByVotes(totals: readonly CandidateTotal[]): CandidateTotal[] {
  return [...totals].sort(
    (a, b) =>
      b.votes - a.votes || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
}

/** Tallies approval-style ballots: each selected candidate gets one vote. */
export function tallyBallots(
  candidates: readonly { candidateId: number; name: string; displayOrder: number }[],
  ballots: readonly (readonly number[])[],
): CandidateTotal[] {
  const counts = new Map<number, number>(candidates.map((c) => [c.candidateId, 0]));
  for (const ballot of ballots) {
    for (const id of new Set(ballot)) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return candidates.map((c) => ({ ...c, votes: counts.get(c.candidateId) ?? 0 }));
}

export type ConsistencyInput = {
  ballots: number;
  participation: number;
  choices: number;
  totals: readonly CandidateTotal[];
  maxSelections: number;
};

/**
 * Cross-checks that the numbers shown to the admin agree with each other:
 * ballots == voters marked voted, sum of candidate votes == stored choices,
 * and choices fall between 1*ballots and M*ballots.
 */
export function checkConsistency(input: ConsistencyInput): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const sum = input.totals.reduce((acc, t) => acc + t.votes, 0);
  if (input.ballots !== input.participation) {
    problems.push(`Ballots (${input.ballots}) differ from voters marked as voted (${input.participation}).`);
  }
  if (sum !== input.choices) {
    problems.push(`Candidate totals (${sum}) differ from recorded selections (${input.choices}).`);
  }
  if (input.choices < input.ballots || input.choices > input.ballots * input.maxSelections) {
    problems.push("Recorded selections are outside the allowed range for the number of ballots.");
  }
  return { ok: problems.length === 0, problems };
}
