import { existsSync } from "node:fs";
import { assertDisposableDatabase } from "../../scripts/lib/db-safety";

// Point the application's own getDb() (used by route handlers) at the test
// database before any application module creates a pool.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_URL = assertDisposableDatabase(process.env.TEST_DATABASE_URL);
process.env.APP_ENV = "test";
process.env.DB_POOL_MAX = "30";
