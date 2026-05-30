/**
 * notification-service.ts — SMS/Email notification logging
 */

import { query, queryOne } from "../lib/db";

export async function saveNotification(clinicId: string, data: {
  callLogId?: string;
  bookingId?: string;
  channel: "sms" | "email";
  recipient: string;
  subject?: string;
  body: string;
  status?: string;
  externalId?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO notifications (clinic_id, call_log_id, booking_id, channel, recipient, subject, body, status, external_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      clinicId,
      data.callLogId || null,
      data.bookingId || null,
      data.channel,
      data.recipient,
      data.subject || null,
      data.body,
      data.status || "sent",
      data.externalId || null,
    ]
  );
  return result!.id;
}

export async function getNotifications(clinicId: string, options: {
  channel?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<any[]> {
  const conditions = ["clinic_id = $1"];
  const params: any[] = [clinicId];
  let idx = 2;

  if (options.channel) {
    conditions.push(`channel = $${idx++}`);
    params.push(options.channel);
  }

  return query(
    `SELECT * FROM notifications WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, options.limit || 50, options.offset || 0]
  );
}
