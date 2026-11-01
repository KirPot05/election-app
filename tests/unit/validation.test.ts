import { describe, expect, it } from "vitest";
import {
  ballotSubmissionSchema,
  changePasswordSchema,
  electionConfigSchema,
  fieldErrors,
  loginSchema,
  normalizeFullName,
  normalizeRegistrationNumber,
  recoverySchema,
  registrationNumberSchema,
  signupSchema,
} from "@/lib/validation";

describe("full name", () => {
  const parse = (v: unknown) => signupSchema().shape.fullName.safeParse(v);

  it("trims and collapses whitespace", () => {
    expect(normalizeFullName("  Asha   Verma \t")).toBe("Asha Verma");
    expect(parse("  Asha   Verma ").data).toBe("Asha Verma");
  });

  it("accepts Unicode names with apostrophes, hyphens and periods", () => {
    for (const name of ["Zoë D’Souza", "José-María O'Neil", "Nguyễn Văn An", "राहुल शर्मा", "தமிழ் செல்வி", "K. R. Nair", "李小龙"]) {
      expect(parse(name).success, name).toBe(true);
    }
  });

  it("rejects empty, whitespace-only, overlong and odd input", () => {
    for (const bad of ["", "   ", "\t\n", "a".repeat(101), "Robert'); DROP TABLE--", "Name1", "<script>", "Tab\u0007Bell", 42, null]) {
      expect(parse(bad).success, String(bad)).toBe(false);
    }
    expect(parse("a".repeat(100)).success).toBe(true);
  });
});

describe("registration number", () => {
  const schema = registrationNumberSchema();

  it("normalizes surrounding whitespace, inner spaces and case", () => {
    expect(normalizeRegistrationNumber("  21cs 001 ")).toBe("21CS001");
    expect(schema.parse(" 21cs 001 ")).toEqual({ display: "21cs 001", normalized: "21CS001" });
  });

  it("preserves leading zeros and meaningful punctuation", () => {
    expect(schema.parse("000123").normalized).toBe("000123");
    expect(schema.parse("21/CSE-04.7_b").normalized).toBe("21/CSE-04.7_B");
  });

  it("folds full-width digits (NFKC)", () => {
    expect(normalizeRegistrationNumber("２１ＣＳ００１")).toBe("21CS001");
  });

  it("is not digits-only", () => {
    expect(schema.safeParse("ABC").success).toBe(true);
  });

  it("rejects empty, too short, too long and invalid characters", () => {
    for (const bad of ["", "   ", "AB", "A".repeat(33), "21CS#001", "21CS<1>", "-123"]) {
      expect(schema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("supports a configurable format pattern", () => {
    const strict = registrationNumberSchema("^\\d{2}[A-Z]{2}\\d{3}$");
    expect(strict.safeParse("21cs001").success).toBe(true);
    expect(strict.safeParse("2021CS1").success).toBe(false);
  });

  it("identical numbers typed differently normalize identically (duplicate detection)", () => {
    const variants = ["21CS001", "21cs001", " 21 CS 001 ", "21Cs001"];
    expect(new Set(variants.map(normalizeRegistrationNumber)).size).toBe(1);
  });
});

describe("password", () => {
  const pw = signupSchema().shape.password;

  it("requires at least 8 characters without composition rules", () => {
    expect(pw.safeParse("1234567").success).toBe(false);
    expect(pw.safeParse("12345678").success).toBe(true);
    expect(pw.safeParse("aaaaaaaa").success).toBe(true);
    expect(pw.safeParse("correct horse battery staple").success).toBe(true);
  });

  it("supports long passphrases and password-manager output up to 256 chars", () => {
    expect(pw.safeParse("x".repeat(256)).success).toBe(true);
    expect(pw.safeParse("x".repeat(257)).success).toBe(false);
    expect(pw.safeParse("Ü🔐ñ密码パスワード").success).toBe(true);
  });

  it("is not trimmed (spaces are significant)", () => {
    expect(pw.parse("  spaced  ")).toBe("  spaced  ");
  });
});

describe("login", () => {
  it("normalizes the registration number and requires a password", () => {
    expect(loginSchema.parse({ registrationNumber: " 21cs 001", password: "x" })).toEqual({ registrationNumber: "21CS001", password: "x" });
    expect(loginSchema.safeParse({ registrationNumber: "21CS001", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ registrationNumber: "", password: "x" }).success).toBe(false);
  });
});

describe("password change", () => {
  it("requires matching confirmation and a different new password", () => {
    const ok = changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" });
    expect(ok.success).toBe(true);
    const mismatch = changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "other" });
    expect(fieldErrors(mismatch.error!)).toHaveProperty("confirmPassword");
    const same = changePasswordSchema.safeParse({ currentPassword: "same-password", newPassword: "same-password", confirmPassword: "same-password" });
    expect(fieldErrors(same.error!)).toHaveProperty("newPassword");
    const short = changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "short", confirmPassword: "short" });
    expect(fieldErrors(short.error!)).toHaveProperty("newPassword");
  });
});

describe("recovery input", () => {
  it("validates token shape and the new password", () => {
    const token = "A".repeat(43);
    expect(recoverySchema.safeParse({ token, newPassword: "new-password", confirmPassword: "new-password" }).success).toBe(true);
    expect(fieldErrors(recoverySchema.safeParse({ token: "short", newPassword: "new-password", confirmPassword: "new-password" }).error!)).toHaveProperty("token");
    expect(fieldErrors(recoverySchema.safeParse({ token, newPassword: "new-password", confirmPassword: "nope" }).error!)).toHaveProperty("confirmPassword");
  });
});

describe("election config", () => {
  it("accepts valid configuration and defaults visibility to LIVE", () => {
    expect(electionConfigSchema.parse({ name: " College Election 2026 ", maxSelections: 5 })).toEqual({
      name: "College Election 2026",
      maxSelections: 5,
      resultsVisibility: "LIVE",
    });
  });

  it("rejects non-integer or < 1 maximum selections and empty names", () => {
    for (const m of [0, -1, 1.5, "5", NaN]) expect(electionConfigSchema.safeParse({ name: "E", maxSelections: m }).success, String(m)).toBe(false);
    expect(electionConfigSchema.safeParse({ name: "  ", maxSelections: 1 }).success).toBe(false);
  });
});

describe("ballot payload", () => {
  const key = "7f1f5d0e-8a8c-4a1b-9f3e-2b3c4d5e6f70";

  it("requires integer candidate ids and a UUID submission key", () => {
    expect(ballotSubmissionSchema.safeParse({ candidateIds: [1, 2], submissionKey: key }).success).toBe(true);
    expect(ballotSubmissionSchema.safeParse({ candidateIds: ["1"], submissionKey: key }).success).toBe(false);
    expect(ballotSubmissionSchema.safeParse({ candidateIds: [1.5], submissionKey: key }).success).toBe(false);
    expect(ballotSubmissionSchema.safeParse({ candidateIds: [-1], submissionKey: key }).success).toBe(false);
    expect(ballotSubmissionSchema.safeParse({ candidateIds: [1], submissionKey: "abc" }).success).toBe(false);
    expect(ballotSubmissionSchema.safeParse({ candidateIds: "1,2", submissionKey: key }).success).toBe(false);
  });
});
