import { existsSync } from "node:fs";

/** Loads .env.local for CLI scripts (Next.js loads it itself for the app). */
export function loadEnv() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export function isProductionEnv() {
  return (
    process.env.APP_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}
