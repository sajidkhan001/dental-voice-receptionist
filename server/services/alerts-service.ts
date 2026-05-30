/**
 * alerts-service.ts — Real-time alert notifications to clinic owners
 *
 * Used for: crisis escalations, after-hours emergencies, system anomalies.
 * Alert target: clinic.emergencyNumber (on-call dentist / owner's cell).
 * Falls back to clinic.phone if emergency number is not set.
 */

import { sendSms } from "./sms-service";
import logger from "../lib/logger";
import { ClinicConfig } from "../lib/types";

export interface CrisisAlertData {
  callerPhone: string;
  reason: string;
  callId: string;
  startedAt: Date;
}

export async function sendCrisisAlert(
  clinic: ClinicConfig,
  alert: CrisisAlertData
): Promise<void> {
  const alertTarget = clinic.emergencyNumber || clinic.phone;
  if (!alertTarget) {
    logger.warn(`[ALERT] No alert number for clinic ${clinic.id} — crisis alert not sent`);
    return;
  }

  const time = alert.startedAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: clinic.timezone || "America/New_York",
  });

  const callerDisplay = alert.callerPhone !== "unknown"
    ? alert.callerPhone
    : "unknown caller";

  const body = [
    `EMERGENCY ESCALATION - ${clinic.name}`,
    `Caller: ${callerDisplay}`,
    `Time: ${time}`,
    `Reason: ${alert.reason || "Patient requested emergency transfer"}`,
    `Call ID: ${alert.callId}`,
    `AI transferred caller to on-call line.`,
  ].join("\n");

  try {
    await sendSms(alertTarget, body, clinic.smsFromNumber || undefined);
    logger.info(`[ALERT] Crisis SMS sent to ${alertTarget} for clinic ${clinic.id}`);
  } catch (err: any) {
    logger.error(`[ALERT] Failed to send crisis SMS for clinic ${clinic.id}: ${err.message}`);
  }
}
