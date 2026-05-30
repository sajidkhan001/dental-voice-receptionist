/**
 * setup-calendar.ts — Set up Google Calendar OAuth for a specific clinic
 *
 * Usage: npx tsx cli/setup-calendar.ts --clinic bright-smile
 */

import { config } from "dotenv";
config();

import { google } from "googleapis";
import http from "http";
import { URL } from "url";
import { queryOne, closePool } from "../lib/db";
import { updateClinicGoogleAuth } from "../services/clinic-service";
import fs from "fs";
import path from "path";
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
    logger.info("Usage: npx tsx cli/setup-calendar.ts --clinic <slug> [--credentials path/to/credentials.json]");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    logger.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  // Load clinic
  const clinic = await queryOne<{ id: string; name: string }>(
    "SELECT id, name FROM clinics WHERE slug = $1",
    [args.clinic]
  );
  if (!clinic) {
    logger.error(`ERROR: Clinic "${args.clinic}" not found`);
    process.exit(1);
  }

  logger.info(`\n[CALENDAR] Setting up Google Calendar for: ${clinic.name}\n`);

  // Load OAuth credentials
  const credPath = args.credentials || path.join(__dirname, "../credentials.json");
  if (!fs.existsSync(credPath)) {
    logger.error(`ERROR: credentials.json not found at ${credPath}`);
    logger.info("Download OAuth credentials from Google Cloud Console and save as credentials.json");
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
  const { client_id, client_secret } = creds.installed || creds.web || {};

  if (!client_id || !client_secret) {
    logger.error("ERROR: Invalid credentials.json — missing client_id or client_secret");
    process.exit(1);
  }

  const redirectUri = "http://localhost:3001/oauth/callback";
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
  });

  logger.info("Opening browser for Google authorization...");
  logger.info(`\nIf the browser doesn't open, go to:\n${authUrl}\n`);

  // Open browser
  const open = (await import("child_process")).exec;
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  open(`${cmd} "${authUrl}"`);

  // Start temp server to receive callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/oauth/callback")) return;

      const url = new URL(req.url, `http://localhost:3001`);
      const code = url.searchParams.get("code");

      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code");
        reject(new Error("No auth code received"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Authorization successful!</h2><p>You can close this window.</p>");

      server.close();
      resolve(code);
    });

    server.listen(3001, () => {
      logger.info("[CALENDAR] Waiting for Google authorization callback on port 3001...");
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timeout (60s)"));
    }, 60000);
  });

  // Exchange code for tokens
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    logger.error("ERROR: No refresh_token received. Try revoking access at https://myaccount.google.com/permissions and retry.");
    process.exit(1);
  }

  // Save to clinic record (encrypted)
  await updateClinicGoogleAuth(clinic.id, {
    clientId: client_id,
    clientSecret: client_secret,
    refreshToken: tokens.refresh_token,
    calendarId: args.calendar_id || "primary",
  });

  logger.info(`
  =============================================
  Google Calendar connected for ${clinic.name}!

  Client ID:     ${client_id.substring(0, 20)}...
  Refresh Token: ${tokens.refresh_token.substring(0, 20)}... (encrypted in DB)
  Calendar ID:   ${args.calendar_id || "primary"}
  =============================================
  `);

  await closePool();
}

main().catch((err) => {
  logger.error("ERROR:", err.message);
  process.exit(1);
});
