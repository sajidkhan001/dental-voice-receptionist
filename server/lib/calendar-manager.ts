/**
 * calendar-manager.ts — Per-clinic Google Calendar operations
 *
 * Refactored from google-calendar.ts to accept ClinicConfig
 * for multi-tenant SaaS support.
 */

import { google } from "googleapis";
import { ClinicConfig, ProviderConfig, SlotOffer } from "./types";
import logger from "./logger";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  provider?: string;
  description?: string;
}

const BUFFER_MINUTES = 15;
const BOOKING_WINDOW_DAYS = 14;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// --- Auth (per-clinic) ---

function getAuth(clinic: ClinicConfig) {
  if (!clinic.googleAuth) {
    throw new Error(`Google Calendar not configured for clinic: ${clinic.name}`);
  }

  const auth = new google.auth.OAuth2(
    clinic.googleAuth.clientId,
    clinic.googleAuth.clientSecret
  );
  auth.setCredentials({ refresh_token: clinic.googleAuth.refreshToken });
  return auth;
}

function getCalendarId(clinic: ClinicConfig): string {
  return clinic.googleAuth?.calendarId || "primary";
}

// --- API Functions ---

export async function listEvents(
  clinic: ClinicConfig,
  timeMin: string,
  timeMax: string,
  calendarId?: string
): Promise<CalendarEvent[]> {
  const auth = getAuth(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: calendarId || getCalendarId(clinic),
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  return (res.data.items || []).map((e) => ({
    id: e.id!,
    summary: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    description: e.description || undefined,
  }));
}

export async function createBooking(
  clinic: ClinicConfig,
  booking: {
    summary: string;
    provider: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    description?: string;
  }
): Promise<{ eventId: string }> {
  const auth = getAuth(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  const startDt = parseDateTime(booking.date, booking.startTime);
  const endDt = new Date(startDt.getTime() + booking.durationMinutes * 60000);

  const providerConfig = clinic.providers.find((p) => p.name === booking.provider);
  const colorId = providerConfig?.calendarColorId || "1";
  const timezone = clinic.timezone || "America/New_York";

  const res = await calendar.events.insert({
    calendarId: getCalendarId(clinic),
    requestBody: {
      summary: `[${clinic.name}] ${booking.summary}`,
      description: booking.description || `Provider: ${booking.provider}\nBooked by AI Receptionist`,
      start: { dateTime: startDt.toISOString(), timeZone: timezone },
      end: { dateTime: endDt.toISOString(), timeZone: timezone },
      colorId,
    },
  });

  logger.info(`[CALENDAR] Event created for ${clinic.name}: ${res.data.id} — ${booking.summary}`);
  return { eventId: res.data.id! };
}

export async function cancelBooking(clinic: ClinicConfig, eventId: string): Promise<void> {
  const auth = getAuth(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: getCalendarId(clinic),
    eventId,
  });

  logger.info(`[CALENDAR] Event deleted for ${clinic.name}: ${eventId}`);
}

export async function searchByPatient(clinic: ClinicConfig, name: string): Promise<CalendarEvent[]> {
  const auth = getAuth(clinic);
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const future = new Date(now.getTime() + 90 * 86400000);

  const res = await calendar.events.list({
    calendarId: getCalendarId(clinic),
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    q: name,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items || []).map((e) => ({
    id: e.id!,
    summary: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    description: e.description || undefined,
  }));
}

// --- Availability Logic ---

export async function findRealAvailableSlots(
  clinic: ClinicConfig,
  service: string,
  provider: string,
  preferredDays?: string[],
  preferAfternoon?: boolean
): Promise<SlotOffer[]> {
  const providerConfig = clinic.providers.find((p) => p.name === provider);
  if (!providerConfig) {
    // Fallback to first provider
    const fallback = clinic.providers[0];
    if (!fallback) return [];
    logger.warn(`[CALENDAR] Unknown provider "${provider}" for ${clinic.name}, using ${fallback.name}`);
    return findRealAvailableSlots(clinic, service, fallback.name, preferredDays, preferAfternoon);
  }

  const svcConfig = clinic.services.find((s) => s.slug === service);
  const duration = svcConfig?.durationMinutes || 60;

  const now = new Date();
  const endDate = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 86400000);

  const events = await listEvents(clinic, now.toISOString(), endDate.toISOString());

  const slots: SlotOffer[] = [];

  for (let d = new Date(now); d < endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();

    if (!providerConfig.workingDays.includes(dayOfWeek)) continue;
    if (d.toDateString() === now.toDateString() && now.getHours() >= providerConfig.endHour) continue;

    const dayStr = d.toISOString().split("T")[0];
    const dayName = DAY_NAMES[dayOfWeek];

    if (preferredDays && preferredDays.length > 0) {
      const match = preferredDays.some(
        (p) => dayName.toLowerCase().startsWith(p.toLowerCase())
      );
      if (!match) continue;
    }

    const dayStart = new Date(`${dayStr}T00:00:00`);
    const dayEvents = events.filter((e) => {
      const eStart = new Date(e.start);
      return eStart.toDateString() === dayStart.toDateString();
    });

    const freeWindows = getFreeWindows(
      dayStr,
      providerConfig.startHour,
      providerConfig.endHour,
      providerConfig.lunchStart,
      providerConfig.lunchEnd,
      dayEvents,
      duration
    );

    for (const window of freeWindows) {
      const hour = parseInt(window.split(":")[0]);
      if (preferAfternoon && hour < 12) continue;
      if (!preferAfternoon && preferAfternoon !== undefined && hour >= 14) continue;

      slots.push({
        provider,
        date: dayStr,
        day: dayName,
        time: formatTime(window),
        service,
      });

      if (slots.length >= 5) break;
    }

    if (slots.length >= 5) break;
  }

  return slots.slice(0, 3);
}

export function getDuration(service: string, clinic: ClinicConfig): number {
  const svc = clinic.services.find((s) => s.slug === service);
  return svc?.durationMinutes || 60;
}

// --- Helpers ---

function getFreeWindows(
  dateStr: string,
  startHour: number,
  endHour: number,
  lunchStart: number,
  lunchEnd: number,
  events: CalendarEvent[],
  durationMinutes: number
): string[] {
  const startMin = startHour * 60;
  const endMin = endHour * 60;
  const busy = new Set<number>();

  if (lunchStart > 0) {
    const lunchStartMin = Math.floor(lunchStart * 60);
    const lunchEndMin = Math.floor(lunchEnd * 60);
    for (let m = lunchStartMin; m < lunchEndMin; m++) busy.add(m);
  }

  for (const evt of events) {
    const eStart = new Date(evt.start);
    const eEnd = new Date(evt.end);
    const eStartMin = eStart.getHours() * 60 + eStart.getMinutes();
    const eEndMin = eEnd.getHours() * 60 + eEnd.getMinutes();
    for (let m = eStartMin - BUFFER_MINUTES; m < eEndMin + BUFFER_MINUTES; m++) {
      if (m >= 0) busy.add(m);
    }
  }

  const windows: string[] = [];
  for (let m = startMin; m <= endMin - durationMinutes; m += 15) {
    let free = true;
    for (let c = m; c < m + durationMinutes; c++) {
      if (busy.has(c)) { free = false; break; }
    }
    if (free) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      windows.push(`${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`);
    }
  }

  return windows;
}

function formatTime(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function parseDateTime(dateStr: string, timeStr: string): Date {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error(`Invalid time format: ${timeStr}`);

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return new Date(`${dateStr}T${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`);
}
