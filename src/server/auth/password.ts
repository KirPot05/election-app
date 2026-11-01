import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Argon2id with the OWASP-recommended baseline: 19 MiB memory, 2 iterations,
 * 1 lane. Takes roughly 20-60 ms per hash on serverless hardware.
 */
const OPTIONS = {
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same work as a real verification when the account doesn't exist,
 * so response timing doesn't reveal which registration numbers are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalization");
  await verifyPassword(await dummyHash, password);
  return false;
}
