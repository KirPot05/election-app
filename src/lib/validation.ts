/**
 * Input normalization and validation shared by client and server.
 * The server always re-validates; client use is only for early feedback.
 */
import { z } from "zod";

export const FULL_NAME_MAX = 100;
export const PASSWORD_MIN = 8;
/** Generous upper bound that still caps hashing cost per request. */
export const PASSWORD_MAX = 256;
export const ADMIN_PASSWORD_MIN = 12;
export const REGISTRATION_NUMBER_MAX = 40;
export const CANDIDATE_NAME_MAX = 100;
export const CANDIDATE_DESCRIPTION_MAX = 300;
export const ELECTION_NAME_MAX = 120;

/** Default: 3-32 characters of A-Z, 0-9, "/", ".", "_" and "-", starting alphanumeric. */
export const DEFAULT_REGISTRATION_PATTERN = "^[A-Z0-9][A-Z0-9/._-]{2,31}$";

// Control characters (C0, DEL, C1) and Unicode line/paragraph separators.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Trims, applies Unicode NFC and collapses runs of whitespace to one space. */
export function normalizeFullName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Canonical registration number used for login and uniqueness.
 *
 * - NFKC folds full-width/compatibility characters (e.g. "２１" -> "21").
 * - All whitespace is removed, so "21 CS 001" and "21CS001" are the same.
 * - Upper-cased: registration numbers are treated as case-insensitive.
 * - Leading zeros and punctuation such as "/" or "-" are preserved.
 */
export function normalizeRegistrationNumber(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

/** Display form: what the student typed, trimmed with whitespace collapsed. */
export function displayRegistrationNumber(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export const fullNameSchema = z
  .string({ error: "Full name is required." })
  .transform(normalizeFullName)
  .pipe(
    z
      .string()
      .min(1, "Full name is required.")
      .max(FULL_NAME_MAX, `Full name must be at most ${FULL_NAME_MAX} characters.`)
      .refine((v) => !CONTROL_CHARS.test(v), "Full name contains invalid characters.")
      .refine((v) => /\p{L}/u.test(v), "Full name must contain letters.")
      .refine(
        (v) => /^[\p{L}\p{M}\s'’.\-]+$/u.test(v),
        "Full name may only contain letters, spaces, apostrophes, hyphens and periods.",
      ),
  );

/** Builds the registration-number schema for a (configurable) format pattern. */
export function registrationNumberSchema(pattern: string = DEFAULT_REGISTRATION_PATTERN) {
  const re = new RegExp(pattern, "u");
  return z
    .string({ error: "Registration number is required." })
    .transform((raw) => ({
      display: displayRegistrationNumber(raw),
      normalized: normalizeRegistrationNumber(raw),
    }))
    .refine((v) => v.normalized.length > 0, "Registration number is required.")
    .refine(
      (v) => v.normalized.length <= REGISTRATION_NUMBER_MAX,
      `Registration number must be at most ${REGISTRATION_NUMBER_MAX} characters.`,
    )
    .refine(
      (v) => !CONTROL_CHARS.test(v.display),
      "Registration number contains invalid characters.",
    )
    .refine((v) => re.test(v.normalized), "Enter a valid college registration number.");
}

export const newPasswordSchema = z
  .string({ error: "Password is required." })
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`);

/** For login: any non-empty string within bounds (no composition rules). */
export const existingPasswordSchema = z
  .string({ error: "Password is required." })
  .min(1, "Password is required.")
  .max(PASSWORD_MAX, "Incorrect registration number or password.");

export function signupSchema(pattern?: string) {
  return z.object({
    fullName: fullNameSchema,
    registrationNumber: registrationNumberSchema(pattern),
    password: newPasswordSchema,
  });
}

export const loginSchema = z.object({
  registrationNumber: z
    .string({ error: "Registration number is required." })
    .transform(normalizeRegistrationNumber)
    .pipe(
      z
        .string()
        .min(1, "Registration number is required.")
        .max(REGISTRATION_NUMBER_MAX, "Incorrect registration number or password."),
    ),
  password: existingPasswordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: existingPasswordSchema,
    newPassword: newPasswordSchema,
    confirmPassword: z.string({ error: "Confirm your new password." }),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The new passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "The new password must be different from the current password.",
    path: ["newPassword"],
  });

export const recoverySchema = z
  .object({
    token: z.string().min(20, "This recovery link is invalid.").max(200, "This recovery link is invalid."),
    newPassword: newPasswordSchema,
    confirmPassword: z.string({ error: "Confirm your new password." }),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The new passwords do not match.",
    path: ["confirmPassword"],
  });

export const adminLoginSchema = z.object({
  username: z
    .string({ error: "Username is required." })
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().min(1, "Username is required.").max(64)),
  password: existingPasswordSchema,
});

export const adminUsernameSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^[a-z0-9._-]{3,64}$/, "Username: 3-64 characters of a-z, 0-9, '.', '_' or '-'."),
  );

export const adminPasswordSchema = z
  .string()
  .min(ADMIN_PASSWORD_MIN, `Admin password must be at least ${ADMIN_PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX);

const singleLine = (label: string, max: number, min = 1) =>
  z
    .string({ error: `${label} is required.` })
    .transform((v) => v.normalize("NFC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(min, `${label} is required.`)
        .max(max, `${label} must be at most ${max} characters.`)
        .refine((v) => !CONTROL_CHARS.test(v), `${label} contains invalid characters.`),
    );

export const electionConfigSchema = z.object({
  name: singleLine("Election name", ELECTION_NAME_MAX),
  maxSelections: z
    .number({ error: "Maximum selections must be a number." })
    .int("Maximum selections must be a whole number.")
    .min(1, "Maximum selections must be at least 1.")
    .max(100, "Maximum selections must be at most 100."),
  resultsVisibility: z.enum(["LIVE", "AFTER_CLOSE"]).default("LIVE"),
});

export const candidateInputSchema = z.object({
  name: singleLine("Candidate name", CANDIDATE_NAME_MAX),
  description: z
    .string()
    .optional()
    .transform((v) => (v ?? "").normalize("NFC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .max(
          CANDIDATE_DESCRIPTION_MAX,
          `Description must be at most ${CANDIDATE_DESCRIPTION_MAX} characters.`,
        )
        .refine((v) => !CONTROL_CHARS.test(v), "Description contains invalid characters."),
    ),
});

export const ballotSubmissionSchema = z.object({
  candidateIds: z
    .array(z.number().int().positive(), { error: "Select at least one candidate." })
    .max(200, "Too many selections."),
  submissionKey: z.uuid("Invalid submission key."),
});

export const transitionSchema = z.object({
  to: z.enum(["OPEN", "CLOSED", "FINALIZED"]),
  confirm: z.literal(true, { error: "Confirmation is required." }),
});

/** Flattens zod issues into { field: message } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
