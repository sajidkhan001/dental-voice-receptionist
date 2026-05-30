/**
 * activate-clinic.ts — Run pre-flight checks and activate a clinic
 *
 * Usage: npx tsx cli/activate-clinic.ts --clinic bright-smile
 */

import { config } from "dotenv";
config();

import { loadClinicBySlug, updateClinic } from "../services/clinic-service";
import { closePool } from "../lib/db";
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

  if (!args.clinic) {
    logger.info("Usage: npx tsx cli/activate-clinic.ts --clinic <slug>");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    logger.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  const clinic = await loadClinicBySlug(args.clinic);
  if (!clinic) {
    logger.error(`ERROR: Clinic "${args.clinic}" not found`);
    process.exit(1);
  }

  logger.info(`\n[ACTIVATE] Running pre-flight checks for: ${clinic.name}\n`);

  const checks: { name: string; pass: boolean; detail: string }[] = [];

  // Check 1: Has providers
  const hasProviders = clinic.providers.length > 0;
  checks.push({
    name: "Providers configured",
    pass: hasProviders,
    detail: hasProviders ? `${clinic.providers.length} provider(s)` : "No providers — add via CLI or admin API",
  });

  // Check 2: Has services
  const hasServices = clinic.services.length > 0;
  checks.push({
    name: "Services configured",
    pass: hasServices,
    detail: hasServices ? `${clinic.services.length} service(s)` : "No services — add via CLI or admin API",
  });

  // Check 3: Google Calendar
  const hasCal = !!clinic.googleAuth;
  checks.push({
    name: "Google Calendar connected",
    pass: hasCal,
    detail: hasCal ? "OAuth tokens stored" : "Run: npx tsx cli/setup-calendar.ts --clinic " + args.clinic,
  });

  // Check 4: Verify Google Calendar token works
  if (hasCal) {
    try {
      const { listEvents } = await import("../lib/calendar-manager");
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      await listEvents(clinic, now, tomorrow);
      checks.push({ name: "Google Calendar API test", pass: true, detail: "API call successful" });
    } catch (err: any) {
      checks.push({ name: "Google Calendar API test", pass: false, detail: `API error: ${err.message}` });
    }
  }

  // Check 5: Voice pipeline (Twilio phone number)
  const hasVoice = !!clinic.twilioPhoneNumber;
  checks.push({
    name: "Voice pipeline configured",
    pass: hasVoice,
    detail: hasVoice ? `Phone: ${clinic.twilioPhoneNumber}` : "Go Live from dashboard or run provisioning",
  });

  // Check 6: Phone number
  const hasPhone = !!clinic.phone;
  checks.push({
    name: "Clinic phone number set",
    pass: hasPhone,
    detail: hasPhone ? clinic.phone! : "Update via admin API",
  });

  // Print results
  logger.info("  Pre-flight Checks:");
  logger.info("  " + "-".repeat(60));
  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? "[PASS]" : "[FAIL]";
    logger.info(`  ${icon} ${check.name}: ${check.detail}`);
    if (!check.pass) allPass = false;
  }
  logger.info("  " + "-".repeat(60));

  if (!allPass) {
    logger.info("\n  Some checks failed. Fix the issues above and re-run.\n");
    logger.info("  To force activation anyway: npx tsx cli/activate-clinic.ts --clinic " + args.clinic + " --force");

    if (args.force !== "true") {
      await closePool();
      process.exit(1);
    }
    logger.info("\n  --force flag set, activating anyway...\n");
  }

  // Activate
  await updateClinic(clinic.id, { status: "active" });

  logger.info(`
  =============================================
  Clinic ACTIVATED: ${clinic.name}

  Status:      active
  Voice:       ${clinic.twilioPhoneNumber || "not configured"}
  Calendar:    ${hasCal ? "connected" : "not connected"}
  Providers:   ${clinic.providers.length}
  Services:    ${clinic.services.length}

  The clinic is now live and accepting calls!
  =============================================
  `);

  await closePool();
}

main().catch((err) => {
  logger.error("ERROR:", err.message);
  process.exit(1);
});
