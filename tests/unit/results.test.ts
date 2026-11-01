import { describe, expect, it } from "vitest";
import { checkConsistency, computeTurnout, sortByVotes, tallyBallots } from "@/lib/results";

const candidates = [
  { candidateId: 1, name: "Asha", displayOrder: 1 },
  { candidateId: 2, name: "Bala", displayOrder: 2 },
  { candidateId: 3, name: "Chitra", displayOrder: 3 },
  { candidateId: 4, name: "Dev", displayOrder: 4 },
];

describe("tallyBallots (approval counting)", () => {
  it("gives each selected candidate exactly one vote per ballot", () => {
    const totals = tallyBallots(candidates, [[1, 2], [1], [2, 3, 4], [1, 4]]);
    expect(totals.map((t) => [t.candidateId, t.votes])).toEqual([[1, 3], [2, 2], [3, 1], [4, 2]]);
  });

  it("counts ballots with fewer than M selections normally", () => {
    expect(tallyBallots(candidates, [[3]]).find((t) => t.candidateId === 3)?.votes).toBe(1);
  });

  it("ignores duplicate ids within a ballot and unknown candidates", () => {
    const totals = tallyBallots(candidates, [[1, 1, 99]]);
    expect(totals.map((t) => t.votes)).toEqual([1, 0, 0, 0]);
  });

  it("empty election: everyone at zero", () => {
    expect(tallyBallots(candidates, []).every((t) => t.votes === 0)).toBe(true);
  });
});

describe("sortByVotes", () => {
  it("sorts by votes desc, then ballot order, without mutating", () => {
    const totals = tallyBallots(candidates, [[4], [4], [2], [3]]);
    const sorted = sortByVotes(totals);
    expect(sorted.map((t) => t.candidateId)).toEqual([4, 2, 3, 1]);
    expect(totals.map((t) => t.candidateId)).toEqual([1, 2, 3, 4]);
  });
});

describe("computeTurnout", () => {
  it("computes not-voted and percentage of eligible voters", () => {
    expect(computeTurnout({ registered: 20, eligible: 19, voted: 7 })).toEqual({
      registered: 20,
      eligible: 19,
      voted: 7,
      notVoted: 12,
      turnoutPercent: 36.8,
    });
    expect(computeTurnout({ registered: 3, eligible: 3, voted: 3 }).turnoutPercent).toBe(100);
  });

  it("handles an empty election without dividing by zero", () => {
    expect(computeTurnout({ registered: 0, eligible: 0, voted: 0 })).toEqual({
      registered: 0,
      eligible: 0,
      voted: 0,
      notVoted: 0,
      turnoutPercent: 0,
    });
  });
});

describe("checkConsistency", () => {
  const totals = tallyBallots(candidates, [[1, 2], [3]]);

  it("passes when ballots, participation and totals agree", () => {
    expect(checkConsistency({ ballots: 2, participation: 2, choices: 3, totals, maxSelections: 2 })).toEqual({ ok: true, problems: [] });
  });

  it("flags mismatches", () => {
    expect(checkConsistency({ ballots: 2, participation: 3, choices: 3, totals, maxSelections: 2 }).ok).toBe(false);
    expect(checkConsistency({ ballots: 2, participation: 2, choices: 4, totals, maxSelections: 2 }).ok).toBe(false);
    expect(checkConsistency({ ballots: 1, participation: 1, choices: 3, totals, maxSelections: 2 }).ok).toBe(false);
  });

  it("passes for an empty election", () => {
    expect(checkConsistency({ ballots: 0, participation: 0, choices: 0, totals: tallyBallots(candidates, []), maxSelections: 2 }).ok).toBe(true);
  });
});
