/**
 * Pure election rules. No I/O; used by server services (inside transactions)
 * and by the UI for early feedback.
 */
export type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED" | "FINALIZED";

const TRANSITIONS: Record<ElectionStatus, readonly ElectionStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["FINALIZED"],
  FINALIZED: [],
};

export function allowedTransitions(from: ElectionStatus): readonly ElectionStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ElectionStatus, to: ElectionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Configuration (name, M, candidates, results visibility) is editable only in DRAFT. */
export function isConfigurationEditable(status: ElectionStatus): boolean {
  return status === "DRAFT";
}

/** Self-registration is accepted only before voting opens. */
export function isRegistrationOpen(status: ElectionStatus): boolean {
  return status === "DRAFT";
}

export type ConfigIssue = "MAX_SELECTIONS_TOO_LOW" | "TOO_FEW_CANDIDATES" | "MAX_NOT_LESS_THAN_K";

/**
 * Validates M (max selections) against K (candidate count): 1 <= M < K.
 * Returns an empty array when the election can be opened.
 */
export function validateElectionConfig(maxSelections: number, candidateCount: number): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!Number.isInteger(maxSelections) || maxSelections < 1) issues.push("MAX_SELECTIONS_TOO_LOW");
  if (candidateCount < 2) issues.push("TOO_FEW_CANDIDATES");
  if (maxSelections >= candidateCount) issues.push("MAX_NOT_LESS_THAN_K");
  return issues;
}

export const CONFIG_ISSUE_MESSAGES: Record<ConfigIssue, string> = {
  MAX_SELECTIONS_TOO_LOW: "Maximum selections must be at least 1.",
  TOO_FEW_CANDIDATES: "Add at least 2 candidates.",
  MAX_NOT_LESS_THAN_K: "Maximum selections must be less than the number of candidates.",
};

export type SelectionError = "EMPTY" | "TOO_MANY" | "DUPLICATE" | "INVALID_CANDIDATE";

export type SelectionResult =
  | { ok: true; candidateIds: number[] }
  | { ok: false; error: SelectionError };

/**
 * Validates a ballot's candidate selection: 1..M distinct candidates, all
 * belonging to this election. Returns the ids sorted ascending.
 */
export function validateSelection(
  candidateIds: readonly number[],
  validCandidateIds: ReadonlySet<number>,
  maxSelections: number,
): SelectionResult {
  if (candidateIds.length === 0) return { ok: false, error: "EMPTY" };
  if (new Set(candidateIds).size !== candidateIds.length) return { ok: false, error: "DUPLICATE" };
  if (candidateIds.length > maxSelections) return { ok: false, error: "TOO_MANY" };
  for (const id of candidateIds) {
    if (!validCandidateIds.has(id)) return { ok: false, error: "INVALID_CANDIDATE" };
  }
  return { ok: true, candidateIds: [...candidateIds].sort((a, b) => a - b) };
}

export const SELECTION_ERROR_MESSAGES: Record<SelectionError, string> = {
  EMPTY: "Select at least one candidate.",
  TOO_MANY: "You selected more candidates than allowed.",
  DUPLICATE: "A candidate can only be selected once.",
  INVALID_CANDIDATE: "Your ballot contains an invalid candidate.",
};

export type VotingEligibility = "CAN_VOTE" | "NOT_OPEN" | "CLOSED" | "ALREADY_VOTED" | "INELIGIBLE";

export function votingEligibility(input: {
  status: ElectionStatus;
  eligible: boolean;
  hasVoted: boolean;
}): VotingEligibility {
  if (input.hasVoted) return "ALREADY_VOTED";
  if (input.status === "DRAFT") return "NOT_OPEN";
  if (input.status !== "OPEN") return "CLOSED";
  if (!input.eligible) return "INELIGIBLE";
  return "CAN_VOTE";
}

export type StudentScreen = "WAITING" | "BALLOT" | "VOTED" | "CLOSED" | "FINALIZED" | "INELIGIBLE";

/** Which dashboard screen a logged-in student sees. */
export function studentScreen(input: {
  status: ElectionStatus;
  eligible: boolean;
  hasVoted: boolean;
}): StudentScreen {
  switch (input.status) {
    case "DRAFT":
      return input.eligible ? "WAITING" : "INELIGIBLE";
    case "OPEN":
      if (input.hasVoted) return "VOTED";
      return input.eligible ? "BALLOT" : "INELIGIBLE";
    case "CLOSED":
      return "CLOSED";
    case "FINALIZED":
      return "FINALIZED";
  }
}
