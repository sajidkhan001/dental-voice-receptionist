import "dotenv/config";
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { handleHealthCheck } from "./routes/health";
import authRoutes from "./routes/auth-routes";
import dashboardRoutes from "./routes/dashboard-api";
import adminRoutes from "./routes/admin-api";
import calendarOAuthRoutes from "./routes/calendar-oauth";
import setupRoutes from "./routes/setup-api";
import smsWebhookRoutes from "./routes/sms-webhook";
import voiceApiRoutes from "./voice/voice-api";
import { handleVoiceWebhook, handleCallStatus, attachMediaStreamWSS } from "./voice/voice-handler";
import { startReminderScheduler } from "./services/reminder-service";
import { startNoShowScheduler } from "./services/noshow-service";
import { startRecallScheduler } from "./services/recall-service";
import { startReviewScheduler } from "./services/review-service";
import { startCalendarSyncScheduler } from "./services/calendar-sync-service";
import { startPerformanceScheduler } from "./services/performance-service";
import { startSelfImproverScheduler } from "./services/self-improver-service";
import { calendarWebhookRouter, calendarSyncApiRouter } from "./routes/calendar-webhook";
import publicBookingRoutes from "./routes/public-booking";
import publicIntakeRoutes from "./routes/public-intake";
import { runMigrations, healthCheck as dbHealthCheck } from "./lib/db";
import { globalLimiter, authLimiter, webhookLimiter, testLimiter } from "./middleware/rate-limit";
import { validate } from "./middleware/validate";
import { testCallSchema, intakeSchema } from "./lib/validators";
import logger from "./lib/logger";

function xmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Health check (before rate limiter so Render health checks pass) ----
app.get("/health", handleHealthCheck);

// ---- Global middleware ----
app.use(helmet({ contentSecurityPolicy: false })); // CSP off for inline dashboard scripts
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? (process.env.CORS_ORIGIN || false)
    : true,
  credentials: true,
}));
app.use(globalLimiter);
app.use(express.json());
app.use(cookieParser());
// Note: static file serving removed — UI is served by the Next.js frontend container

// ---- Voice webhooks (Telnyx → our pipeline) ----
app.post("/webhook/voice", webhookLimiter, express.urlencoded({ extended: false }), handleVoiceWebhook);
app.post("/webhook/voice/status", webhookLimiter, express.urlencoded({ extended: false }), handleCallStatus);

// ---- Voice API (provisioning + config, authenticated) ----
app.use("/api/voice", voiceApiRoutes);

// ---- Telnyx SMS webhook (inbound patient replies) ----
app.use("/webhook/sms", webhookLimiter, express.urlencoded({ extended: false }), smsWebhookRoutes);

// ---- Auth routes ----
app.use("/api/auth", authLimiter, authRoutes);

// ---- Dashboard API (authenticated, clinic-scoped) ----
app.use("/api/dashboard", dashboardRoutes);

// ---- Admin API (superadmin only) ----
app.use("/api/admin", adminRoutes);

// ---- Setup API (clinic self-service: Calendar OAuth + Go Live) ----
app.use("/api/setup/google-calendar", calendarOAuthRoutes);
app.use("/api/setup", setupRoutes);

// ---- Public APIs (no auth — for widget & patient intake) ----
app.use("/api/public", publicBookingRoutes);
app.use("/api/public/intake", publicIntakeRoutes);

// ---- Google Calendar webhook (push notifications from Google) ----
app.use("/webhook/google-calendar", calendarWebhookRouter);

// ---- Calendar Sync API (authenticated) ----
app.use("/api/dashboard/calendar-sync", calendarSyncApiRouter);

// ---- Web Call (browser-based calling via Telnyx) ----
app.post("/api/create-web-call", async (req, res) => {
  try {
    const { agent_id } = req.body;

    if (!process.env.TELNYX_API_KEY) {
      // Simulation mode — return a mock token
      res.json({
        access_token: `sim-token-${Date.now()}`,
        call_id: `web-call-sim-${Date.now()}`,
      });
      return;
    }

    const Telnyx = (await import("telnyx")).default;
    const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! });

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

    // Create a Telnyx WebRTC credential token for the browser
    const credential = await (telnyx as any).telephonyCredentials.create({
      connection_id: process.env.TELNYX_CONNECTION_ID,
      expires_in: 3600,
    });

    const token = credential?.data?.sip_token || credential?.data?.token || `tok-${Date.now()}`;

    res.json({
      access_token: token,
      call_id: `web-call-${Date.now()}`,
    });
  } catch (err: any) {
    logger.error("[WEB-CALL] Failed to create web call:", err.message);
    res.status(500).json({ error: "Failed to create web call" });
  }
});

// ---- Manual test endpoint (simulation mode) ----
app.post("/test/process-call", testLimiter, validate(testCallSchema), async (req, res) => {
  const { transcript, caller_phone, scenario, clinic_id } = req.body;

  logger.info("\n========================================");
  logger.info("MANUAL TEST CALL");
  logger.info(`Scenario: ${scenario || "manual"}`);
  logger.info(`Phone: ${caller_phone || "+15550000000"}`);
  logger.info(`Transcript: ${transcript.substring(0, 100)}...`);
  logger.info("========================================\n");

  // Optionally load clinic config from DB
  let clinicConfig;
  if (clinic_id) {
    const { loadClinicConfig } = await import("./services/clinic-service");
    clinicConfig = await loadClinicConfig(clinic_id) || undefined;
  }

  const { runAgentPipeline } = await import("./agent-runner");
  const result = await runAgentPipeline(
    {
      call_id: `test-${Date.now()}`,
      transcript,
      caller_phone: caller_phone || "+15550000000",
      timestamp: new Date().toISOString(),
    },
    clinicConfig
  );

  res.json(result);
});

// ---- Intake form submission (auto-provisioning) ----
app.post("/api/intake", validate(intakeSchema), async (req, res) => {
  try {
    const { provisionClinic } = await import("./services/provisioning-service");
    const result = await provisionClinic(req.body);

    logger.info(`[INTAKE] Auto-provisioned clinic: ${req.body.clinic_name} (${result.slug}), mode: ${result.mode}`);

    // Notify admin if configured
    if (process.env.INTAKE_NOTIFY_EMAIL) {
      try {
        const { sendEmail } = await import("./services/email-service");
        await sendEmail({
          to: process.env.INTAKE_NOTIFY_EMAIL,
          subject: `New Clinic Provisioned: ${req.body.clinic_name}`,
          html: `<p>Clinic <strong>${xmlEncode(req.body.clinic_name)}</strong> (${xmlEncode(result.slug)}) was auto-provisioned.</p><p>Admin: ${xmlEncode(result.adminEmail)}</p><p>Mode: ${xmlEncode(result.mode)}</p>`,
          fromName: "AI Receptionist Setup",
        });
      } catch (err: any) {
        logger.error("[INTAKE] Admin notification failed:", err.message);
      }
    }

    res.json({
      success: true,
      clinic_id: result.clinicId,
      slug: result.slug,
      mode: result.mode,
    });
  } catch (err: any) {
    logger.error("[INTAKE] Provisioning failed:", err.message);
    res.status(500).json({ error: err.message || "Provisioning failed" });
  }
});

// ---- Sentry error handler (must be before custom handler) ----
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ---- Global error handler ----
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

// ---- Start server ----
async function start() {
  // Run DB migrations if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
      logger.info("[DB] Migrations complete");
      startReminderScheduler();
      startNoShowScheduler();
      startRecallScheduler();
      startReviewScheduler();
      // Calendar sync: renew watch channels every 6 hours
      const webhookBase = process.env.BASE_URL || `http://localhost:${PORT}`;
      startCalendarSyncScheduler(`${webhookBase}/webhook/google-calendar`);
      // Daily analytics: performance report at midnight, self-improver at 1 AM
      startPerformanceScheduler();
      startSelfImproverScheduler();
    } catch (err: any) {
      logger.error("[DB] Migration failed:", err.message);
      logger.info("[DB] Continuing in simulation mode (file-based logging)");
    }
  } else {
    logger.info("[DB] No DATABASE_URL set — running in simulation mode");
  }

  const server = app.listen(PORT, () => {
    logger.info(`
  =============================================
    Dental Voice SaaS — v2.0
    Port: ${PORT}
    Mode: ${process.env.SIMULATION_MODE !== "false" ? "SIMULATION" : "PRODUCTION"}
    DB:   ${process.env.DATABASE_URL ? "PostgreSQL" : "File-based (simulation)"}
  =============================================

  Public endpoints:
    GET  /health              Health check
    POST /webhook/voice       Telnyx voice webhook
    POST /webhook/voice/status  Call status callback
    POST /webhook/sms         Telnyx inbound SMS (2-way patient replies)
    POST /test/process-call   Manual test

  Voice API (authenticated):
    POST /api/voice/provision-phone  Buy Telnyx number
    POST /api/voice/config           Update voice settings
    GET  /api/voice/status           Pipeline status

  Auth endpoints:
    POST /api/auth/login      Login
    POST /api/auth/logout     Logout
    GET  /api/auth/me         Current user

  Dashboard API (requires auth):
    GET  /api/dashboard/kpis
    GET  /api/dashboard/calls
    GET  /api/dashboard/appointments
    GET  /api/dashboard/analytics
    GET  /api/dashboard/reviews
    GET  /api/dashboard/intake-forms
    GET  /api/dashboard/calendar-sync/status
    PATCH /api/dashboard/appointments/:id/insurance
    GET  /api/dashboard/status

  Admin API (superadmin only):
    GET  /api/admin/clinics
    POST /api/admin/clinics
    GET  /api/admin/overview
    GET  /api/admin/audit-logs

  Setup API (clinic self-service):
    GET  /api/setup/status
    POST /api/setup/go-live
    GET  /api/setup/google-calendar/auth-url
    GET  /api/setup/google-calendar/callback

  WebSocket:
    /media-stream             Telnyx Media Stream (voice pipeline)

  Public APIs (no auth):
    GET  /api/public/clinic/:id       Widget clinic info
    GET  /api/public/available-slots  Widget slot availability
    POST /api/public/book             Widget booking
    GET  /api/public/intake/:bookingId  Patient intake form data
    POST /api/public/intake/:bookingId  Patient intake form submit

  Webhooks:
    POST /webhook/google-calendar     Google Calendar push notifications

  Pages:
    /login     Login page
    /dashboard Clinic dashboard
    /admin     Superadmin panel
    /intake    Client intake form
    /book/:id  Online scheduling widget
    /intake/:bookingId  Patient intake form
    `);
  });

  // Attach WebSocket server for Telnyx Media Streams
  attachMediaStreamWSS(server);

  // Graceful shutdown handlers
  async function gracefulShutdown(signal: string) {
    logger.info(`[SHUTDOWN] ${signal} received — shutting down gracefully`);

    // 1. Close all active calls
    const { callManager } = await import("./voice/call-manager");
    await callManager.closeAll();

    // 2. Close DB pool
    const { closePool } = await import("./lib/db");
    await closePool();

    // 3. Stop HTTP server
    server.close(() => {
      logger.info("[SHUTDOWN] HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown fails
    setTimeout(() => {
      logger.error("[SHUTDOWN] Forced exit after timeout");
      process.exit(1);
    }, 10_000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start();
