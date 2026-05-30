/**
 * provisioning-service.ts — Auto-provision a clinic from the intake form.
 * Creates clinic + providers + services + admin user in a single transaction.
 */

import crypto from "crypto";
import bcrypt from "bcrypt";
import { withTransaction, isDbAvailable, queryOne } from "../lib/db";
import { createClinic, createProvider, createService } from "./clinic-service";
import { sendEmail } from "./email-service";
import logger from "../lib/logger";
import fs from "fs";
import path from "path";

function xmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface ProvisionInput {
  clinic_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address?: string;
  website?: string;
  timezone?: string;
  emergency_number?: string;
  hours: Record<string, { open: string; close: string } | null>;
  providers: {
    name: string;
    title?: string;
    specialty?: string;
    workingDays: number[];
    startHour: number;
    endHour: number;
  }[];
  services: {
    slug: string;
    name: string;
    durationMinutes: number;
  }[];
  insurance_plans?: string[];
  voice_tone?: string;
  greeting_template?: string;
  primary_language?: string;
}

export interface ProvisionResult {
  clinicId: string;
  slug: string;
  adminEmail: string;
  tempPassword: string;
  mode: "database" | "simulation";
}

/**
 * Generate a URL-safe slug from a clinic name, ensuring no collisions.
 */
async function generateSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!isDbAvailable()) return base;

  // Check for collision
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM clinics WHERE slug = $1`,
    [base]
  );

  if (!existing) return base;

  // Append random suffix
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

/**
 * Generate a random password for the new admin user.
 */
function generatePassword(): string {
  return crypto.randomBytes(10).toString("base64url");
}

/**
 * Provision a clinic: create all DB records + send welcome email.
 * Falls back to file-based storage in simulation mode.
 */
export async function provisionClinic(input: ProvisionInput): Promise<ProvisionResult> {
  const slug = await generateSlug(input.clinic_name);
  const tempPassword = generatePassword();

  if (!isDbAvailable()) {
    return provisionSimulation(input, slug, tempPassword);
  }

  return provisionDatabase(input, slug, tempPassword);
}

async function provisionDatabase(
  input: ProvisionInput,
  slug: string,
  tempPassword: string
): Promise<ProvisionResult> {
  const clinicId = await withTransaction(async (client) => {
    // 1. Create clinic
    const clinicResult = await client.query(
      `INSERT INTO clinics (slug, name, phone, address, website, timezone, emergency_number, hours, insurance_plans, voice_tone, greeting_template, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'onboarding')
       RETURNING id`,
      [
        slug,
        input.clinic_name,
        input.contact_phone,
        input.address || null,
        input.website || null,
        input.timezone || "America/New_York",
        input.emergency_number || null,
        JSON.stringify(input.hours),
        input.insurance_plans || [],
        input.voice_tone || "Warm, calm, professional, empathetic, reassuring.",
        input.greeting_template || null,
      ]
    );
    const cId = clinicResult.rows[0].id;

    // 2. Create providers
    for (const p of input.providers) {
      await client.query(
        `INSERT INTO providers (clinic_id, name, title, specialty, working_days, start_hour, end_hour)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cId, p.name, p.title || null, p.specialty || null, p.workingDays, p.startHour, p.endHour]
      );
    }

    // 3. Create services
    for (const s of input.services) {
      await client.query(
        `INSERT INTO services (clinic_id, slug, name, duration_minutes)
         VALUES ($1, $2, $3, $4)`,
        [cId, s.slug, s.name, s.durationMinutes]
      );
    }

    // 4. Create admin user
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role, clinic_id)
       VALUES ($1, $2, $3, 'clinic_admin', $4)`,
      [input.contact_email.toLowerCase().trim(), passwordHash, input.contact_name, cId]
    );

    return cId;
  });

  logger.info(`[PROVISION] Clinic created: ${input.clinic_name} (${slug}), ID: ${clinicId}`);

  // 5. Send welcome email
  await sendWelcomeEmail(input.contact_email, input.contact_name, input.clinic_name, tempPassword);

  return {
    clinicId,
    slug,
    adminEmail: input.contact_email,
    tempPassword,
    mode: "database",
  };
}

async function provisionSimulation(
  input: ProvisionInput,
  slug: string,
  tempPassword: string
): Promise<ProvisionResult> {
  // Save to file for dev inspection
  const intakeDir = path.join(__dirname, "../../intake");
  if (!fs.existsSync(intakeDir)) fs.mkdirSync(intakeDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}_${slug}.json`;

  const record = {
    ...input,
    slug,
    tempPassword,
    adminEmail: input.contact_email,
    provisioned_at: new Date().toISOString(),
    mode: "simulation",
  };

  fs.writeFileSync(path.join(intakeDir, filename), JSON.stringify(record, null, 2));
  logger.info(`[PROVISION] Simulation mode — saved to intake/${filename}`);

  // Still send email if credentials are configured
  await sendWelcomeEmail(input.contact_email, input.contact_name, input.clinic_name, tempPassword);

  return {
    clinicId: `sim-${slug}`,
    slug,
    adminEmail: input.contact_email,
    tempPassword,
    mode: "simulation",
  };
}

async function sendWelcomeEmail(
  email: string,
  contactName: string,
  clinicName: string,
  tempPassword: string
): Promise<void> {
  const loginUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/login`
    : "http://localhost:3000/login";

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#0f766e,#0d9488);padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">Welcome to Your AI Receptionist</h1>
        <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:14px">${xmlEncode(clinicName)}</p>
      </div>
      <div style="background:#fff;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px">
          Hi ${xmlEncode(contactName)},
        </p>
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px">
          Your clinic has been set up. Log in to connect your Google Calendar and go live with your AI receptionist.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 20px">
          <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px">Login Credentials</p>
          <p style="color:#0f172a;font-size:14px;margin:0 0 4px"><strong>Email:</strong> ${xmlEncode(email)}</p>
          <p style="color:#0f172a;font-size:14px;margin:0"><strong>Temporary Password:</strong> ${xmlEncode(tempPassword)}</p>
        </div>
        <a href="${xmlEncode(loginUrl)}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
          Log In Now
        </a>
        <p style="color:#94a3b8;font-size:13px;margin:20px 0 0">
          You&apos;ll be asked to change your password on first login.
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: `Your AI Receptionist is Ready — ${clinicName}`,
    html,
  });
}
