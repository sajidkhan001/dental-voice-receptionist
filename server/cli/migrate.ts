/**
 * migrate.ts — Run database migrations
 * Usage: npx tsx cli/migrate.ts
 */

import { config } from "dotenv";
config();

import { runMigrations, closePool } from "../lib/db";
import logger from "../lib/logger";

async function main() {
  logger.info("[MIGRATE] Running database migrations...\n");

  if (!process.env.DATABASE_URL) {
    logger.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  try {
    await runMigrations();
    logger.info("\n[MIGRATE] All migrations applied successfully.");
  } catch (err: any) {
    logger.error("\n[MIGRATE] Migration failed:", err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
