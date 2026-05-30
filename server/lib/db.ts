/**
 * db.ts — PostgreSQL connection pool for multi-tenant SaaS
 * In simulation mode (no DATABASE_URL), all queries return empty results.
 */

import { Pool, PoolClient } from "pg";
import fs from "fs";
import path from "path";
import logger from "./logger";

const isSimulation = !process.env.DATABASE_URL;

const pool: Pool | null = isSimulation
  ? null
  : new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === "production"
 ? { rejectUnauthorized: true }
    : undefined,
    });

if (pool) {
  pool.on("error", (err) => {
    logger.error("[DB] Unexpected pool error:", err.message);
  });
}

export function getPool(): Pool | null {
  return pool;
}

export function isDbAvailable(): boolean {
  return pool !== null;
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  if (!pool) return [];
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  if (!pool) return null;
  const result = await pool.query(text, params);
  return (result.rows[0] as T) || null;
}

export async function execute(
  text: string,
  params?: any[]
): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query(text, params);
  return result.rowCount ?? 0;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) throw new Error("Database not available in simulation mode");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  if (!pool) {
    logger.info("[DB] Skipping migrations — no DATABASE_URL");
    return;
  }

  const migrationsDir = path.join(__dirname, "../migrations");
  if (!fs.existsSync(migrationsDir)) {
    logger.info("[DB] No migrations directory found");
    return;
  }

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const applied = await query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY id"
  );
  const appliedSet = new Set(applied.map((m) => m.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    logger.info(`[DB] Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });

    logger.info(`[DB] Applied: ${file}`);
  }
}

export async function healthCheck(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
}
