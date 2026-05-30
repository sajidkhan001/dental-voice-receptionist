/**
 * health.ts — Health check endpoint
 */

import { Request, Response } from "express";
import { healthCheck as dbHealthCheck } from "../lib/db";
import { getGlobalCredentialAvailability } from "../services/credentials-service";

const startTime = Date.now();

export async function handleHealthCheck(_req: Request, res: Response) {
  let dbOk = false;
  if (process.env.DATABASE_URL) {
    try {
      dbOk = await dbHealthCheck();
    } catch {
      dbOk = false;
    }
  }

  const availability = await getGlobalCredentialAvailability();
  const isSimulation = process.env.SIMULATION_MODE !== "false";
  const isHealthy = isSimulation || dbOk;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "1.0.0",
    simulation_mode: isSimulation,
    checks: {
      database: process.env.DATABASE_URL ? (dbOk ? "ok" : "error") : "not_configured",
      voice: {
        telephony: availability.telephony,
        stt: availability.stt,
        llm: availability.llm,
        tts: availability.tts,
      },
      google_calendar: availability.google_calendar,
    },
  });
}
