/**
 * email-service.ts — Unified email with SendGrid / Gmail SMTP / simulation fallback
 * Priority: SendGrid > Gmail SMTP > Simulation (file logging)
 */

import logger from "../lib/logger";
import fs from "fs";
import path from "path";
import { getClinicCredentials } from "./credentials-service";
import { ClinicCredentials } from "../lib/types";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  clinicId?: string;
}

type EmailProvider = "sendgrid" | "gmail" | "simulation";

function detectProvider(credentials: ClinicCredentials): EmailProvider {
  if (credentials.sendgridApiKey) return "sendgrid";
  if (credentials.gmailUser && credentials.gmailAppPassword) return "gmail";
  return "simulation";
}

async function getGmailTransporter(credentials: ClinicCredentials) {
  const nodemailer = (await import("nodemailer")).default;
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: credentials.gmailUser!,
      pass: credentials.gmailAppPassword!,
    },
  });
}

function getDefaultFrom(activeProvider: EmailProvider, credentials: ClinicCredentials): string {
  if (activeProvider === "sendgrid")
    return process.env.SENDGRID_FROM_EMAIL || credentials.gmailUser || "noreply@selfhosted.local";
  if (activeProvider === "gmail") return credentials.gmailUser!;
  return "noreply@simulation.local";
}

function getDefaultFromName(): string {
  return process.env.EMAIL_FROM_NAME || "AI Receptionist";
}

async function sendViaSendGrid(options: EmailOptions, credentials: ClinicCredentials, activeProvider: EmailProvider): Promise<void> {
  const sgMail = (await import("@sendgrid/mail")).default;
  sgMail.setApiKey(credentials.sendgridApiKey!);

  await sgMail.send({
    to: options.to,
    from: {
      email: options.from || getDefaultFrom(activeProvider, credentials),
      name: options.fromName || getDefaultFromName(),
    },
    subject: options.subject,
    html: options.html,
  });
}

async function sendViaGmail(options: EmailOptions, credentials: ClinicCredentials, activeProvider: EmailProvider): Promise<void> {
  const transporter = await getGmailTransporter(credentials);
  const fromAddr = options.from || getDefaultFrom(activeProvider, credentials);
  const fromName = options.fromName || getDefaultFromName();

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}

function sendViaSimulation(options: EmailOptions, credentials: ClinicCredentials, activeProvider: EmailProvider): void {
  const logDir = path.join(__dirname, "../../logs/email");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(
    logDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(
    logFile,
    JSON.stringify(
      {
        to: options.to,
        from: options.from || getDefaultFrom(activeProvider, credentials),
        subject: options.subject,
        html: options.html,
        simulated: true,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const { to, subject } = options;
  const credentials = await getClinicCredentials(options.clinicId);
  const activeProvider = detectProvider(credentials);

  if (activeProvider === "simulation") {
    logger.info("[EMAIL] Simulated", { to, subject });
    sendViaSimulation(options, credentials, activeProvider);
    return true;
  }

  try {
    if (activeProvider === "sendgrid") {
      await sendViaSendGrid(options, credentials, activeProvider);
    } else {
      await sendViaGmail(options, credentials, activeProvider);
    }
    logger.info(`[EMAIL] Sent via ${activeProvider}`, { to, subject });
    return true;
  } catch (err: any) {
    logger.error(`[EMAIL] Failed via ${activeProvider}`, {
      to,
      subject,
      error: err.message,
    });
    return false;
  }
}

export function getEmailProvider(): EmailProvider {
  return detectProvider({
    anthropicApiKey: null,
    deepgramApiKey: null,
    inworldApiKey: null,
    inworldVoiceId: null,
    inworldModelId: null,
    telnyxApiKey: null,
    telnyxConnectionId: null,
    telnyxFromNumber: null,
    telnyxWebhookSecret: null,
    sendgridApiKey: process.env.SENDGRID_API_KEY || null,
    gmailUser: process.env.GMAIL_USER || null,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || null,
    googleClientId: null,
    googleClientSecret: null,
  });
}
