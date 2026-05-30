/**
 * create-user.ts — Create a user account for a clinic
 *
 * Usage:
 *   npx tsx cli/create-user.ts --email admin@clinic.com --password Secret123 --role clinic_admin --clinic bright-smile
 */

import { config } from "dotenv";
config();

import bcrypt from "bcrypt";
import { queryOne, closePool } from "../lib/db";
import crypto from "crypto";
import logger from "../lib/logger";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();

  if (!process.env.DATABASE_URL) {
    logger.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  if (!args.email || !args.role) {
    logger.info(`
  Usage:
    npx tsx cli/create-user.ts --email admin@clinic.com --role clinic_admin --clinic bright-smile [--password ...]

  Required:
    --email    User email address
    --role     Role: superadmin, clinic_admin, or clinic_staff

  Optional:
    --clinic   Clinic slug (required for clinic_admin/clinic_staff)
    --password Password (auto-generated if not provided)
    --name     User display name
    `);
    process.exit(1);
  }

  const password = args.password || crypto.randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);

  let clinicId: string | null = null;
  if (args.clinic) {
    const clinic = await queryOne<{ id: string }>(
      "SELECT id FROM clinics WHERE slug = $1",
      [args.clinic]
    );
    if (!clinic) {
      logger.error(`ERROR: Clinic "${args.clinic}" not found`);
      process.exit(1);
    }
    clinicId = clinic.id;
  }

  try {
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, clinic_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [args.email.toLowerCase().trim(), passwordHash, args.name || null, args.role, clinicId]
    );

    logger.info(`
  =============================================
  User created successfully!

  User ID:    ${user!.id}
  Email:      ${args.email}
  Role:       ${args.role}
  Clinic:     ${args.clinic || "N/A (superadmin)"}
  Password:   ${password}
  =============================================

  ${!args.password ? "NOTE: Save this auto-generated password — it cannot be recovered." : ""}
    `);
  } catch (err: any) {
    if (err.code === "23505") {
      logger.error(`ERROR: Email "${args.email}" already exists`);
    } else {
      logger.error(`ERROR: ${err.message}`);
    }
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
