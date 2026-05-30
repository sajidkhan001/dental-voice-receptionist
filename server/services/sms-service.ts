/**
 * sms-service.ts — SMS via Telnyx with simulation fallback
 */

import logger from "../lib/logger";
import fs from "fs";
import path from "path";
import { getClinicCredentials } from "./credentials-service";

function createTelnyxClient(apiKey: string) {
  const Telnyx = require("telnyx").default;
  return new Telnyx({ apiKey });
}

export async function sendSms(
  to: string,
  body: string,
  from?: string,
  clinicId?: string
): Promise<string | null> {
  const credentials = await getClinicCredentials(clinicId);
  const apiKey = credentials.telnyxApiKey;
  const fromNumber = from || credentials.telnyxFromNumber;

  // Simulation mode or missing credentials
  if (
    process.env.SIMULATION_MODE !== "false" ||
    !apiKey ||
    !fromNumber
  ) {
    logger.info("[SMS] Simulated", { to, body: body.substring(0, 80) });

    // Log to file for dev inspection
    const logDir = path.join(__dirname, "../../logs/sms");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(logFile, JSON.stringify({ to, body, simulated: true, timestamp: new Date().toISOString() }, null, 2));

    return `sim-sms-${Date.now()}`;
  }

  try {
    const telnyx = createTelnyxClient(apiKey);

    const msg = await telnyx.messages.send({
      to,
      from: fromNumber,
      text: body,
    });

    const messageId = msg?.data?.id || `telnyx-${Date.now()}`;
    logger.info("[SMS] Sent", { to, id: messageId });
    return messageId;
  } catch (err: any) {
    logger.error("[SMS] Failed to send", { to, error: err.message });
    return null;
  }
}
