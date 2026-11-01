import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canTransition,
  isConfigurationEditable,
  isRegistrationOpen,
  studentScreen,
  validateElectionConfig,
  validateSelection,
  votingEligibility,
  type ElectionStatus,
} from "@/lib/election-rules";

const STATUSES: ElectionStatus[] = ["DRAFT", "OPEN", "CLOSED", "FINALIZED"];

describe("state machine", () => {
  it("allows exactly DRAFT -> OPEN -> CLOSED -> FINALIZED", () => {
    const allowed = new Set(["DRAFT>OPEN", "OPEN>CLOSED", "CLOSED>FINALIZED"]);
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("never allows reopening or going backwards", () => {
    expect(canTransition("CLOSED", "OPEN")).toBe(false);
    expect(canTransition("FINALIZED", "OPEN")).toBe(false);
    expect(canTransition("OPEN", "DRAFT")).toBe(false);
    expect(allowedTransitions("FINALIZED")).toEqual([]);
  });

  it("configuration and registration are open only in DRAFT", () => {
    expect(STATUSES.filter(isConfigurationEditable)).toEqual(["DRAFT"]);
    expect(STATUSES.filter(isRegistrationOpen)).toEqual(["DRAFT"]);
  });
});

describe("election configuration (1 <= M < K)", () => {
  it("accepts valid M/K combinations", () => {
    expect(validateElectionConfig(5, 12)).toEqual([]);
    expect(validateElectionConfig(1, 2)).toEqual([]);
    expect(validateElectionConfig(11, 12)).toEqual([]);
  });

  it("rejects M >= K", () => {
    expect(validateElectionConfig(12, 12)).toContain("MAX_NOT_LESS_THAN_K");
    expect(validateElectionConfig(13, 12)).toContain("MAX_NOT_LESS_THAN_K");
  });

  it("rejects M < 1 and K < 2", () => {
    expect(validateElectionConfig(0, 12)).toContain("MAX_SELECTIONS_TOO_LOW");
    expect(validateElectionConfig(1.5, 12)).toContain("MAX_SELECTIONS_TOO_LOW");
    expect(validateElectionConfig(1, 1)).toEqual(expect.arrayContaining(["TOO_FEW_CANDIDATES", "MAX_NOT_LESS_THAN_K"]));
    expect(validateElectionConfig(1, 0)).toContain("TOO_FEW_CANDIDATES");
  });
});

describe("candidate selection", () => {
  const valid = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  it("accepts 1..M distinct valid candidates and sorts them", () => {
    for (let n = 1; n <= 5; n++) {
      const ids = [12, 3, 7, 1, 9].slice(0, n);
      const r = validateSelection(ids, valid, 5);
      expect(r).toEqual({ ok: true, candidateIds: [...ids].sort((a, b) => a - b) });
    }
  });

  it("rejects an empty ballot", () => {
    expect(validateSelection([], valid, 5)).toEqual({ ok: false, error: "EMPTY" });
  });

  it("rejects more than M selections", () => {
    expect(validateSelection([1, 2, 3, 4, 5, 6], valid, 5)).toEqual({ ok: false, error: "TOO_MANY" });
  });

  it("rejects duplicate selections", () => {
    expect(validateSelection([1, 1], valid, 5)).toEqual({ ok: false, error: "DUPLICATE" });
    // Duplicates are reported even when the raw count exceeds M.
    expect(validateSelection([1, 1, 1, 1, 1, 1], valid, 5)).toEqual({ ok: false, error: "DUPLICATE" });
  });

  it("rejects candidates outside the election", () => {
    expect(validateSelection([1, 99], valid, 5)).toEqual({ ok: false, error: "INVALID_CANDIDATE" });
    expect(validateSelection([0], valid, 5)).toEqual({ ok: false, error: "INVALID_CANDIDATE" });
  });

  it("does not mutate the input", () => {
    const ids = [3, 1, 2];
    validateSelection(ids, valid, 5);
    expect(ids).toEqual([3, 1, 2]);
  });
});

describe("voting eligibility and student screens", () => {
  it("only eligible, not-yet-voted students can vote while OPEN", () => {
    expect(votingEligibility({ status: "OPEN", eligible: true, hasVoted: false })).toBe("CAN_VOTE");
    expect(votingEligibility({ status: "OPEN", eligible: true, hasVoted: true })).toBe("ALREADY_VOTED");
    expect(votingEligibility({ status: "OPEN", eligible: false, hasVoted: false })).toBe("INELIGIBLE");
    expect(votingEligibility({ status: "DRAFT", eligible: true, hasVoted: false })).toBe("NOT_OPEN");
    expect(votingEligibility({ status: "CLOSED", eligible: true, hasVoted: false })).toBe("CLOSED");
    expect(votingEligibility({ status: "FINALIZED", eligible: true, hasVoted: false })).toBe("CLOSED");
  });

  it("maps election state and participation to the documented screens", () => {
    const s = (status: ElectionStatus, hasVoted = false, eligible = true) => studentScreen({ status, hasVoted, eligible });
    expect(s("DRAFT")).toBe("WAITING");
    expect(s("OPEN")).toBe("BALLOT");
    expect(s("OPEN", true)).toBe("VOTED");
    expect(s("CLOSED")).toBe("CLOSED");
    expect(s("CLOSED", true)).toBe("CLOSED");
    expect(s("FINALIZED", true)).toBe("FINALIZED");
    expect(s("DRAFT", false, false)).toBe("INELIGIBLE");
    expect(s("OPEN", false, false)).toBe("INELIGIBLE");
  });
});
