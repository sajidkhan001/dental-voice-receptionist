/**
 * validators.ts — Zod schemas for input validation
 */

import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email format").transform(v => v.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

export const testCallSchema = z.object({
  transcript: z.string().min(1, "Transcript is required").max(50000),
  caller_phone: z.string().optional(),
  scenario: z.string().optional(),
  clinic_id: z.string().uuid().optional(),
});

const dayHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
}).nullable();

export const intakeSchema = z.object({
  clinic_name: z.string().min(1, "Clinic name is required").max(200),
  contact_name: z.string().min(1, "Contact name is required").max(200),
  contact_email: z.string().email("Valid email required"),
  contact_phone: z.string().min(1, "Phone is required").max(30),
  address: z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  timezone: z.string().max(50).default("America/New_York"),
  emergency_number: z.string().max(30).optional(),
  hours: z.record(z.string(), dayHoursSchema),
  providers: z.array(z.object({
    name: z.string().min(1).max(200),
    title: z.string().max(50).optional(),
    specialty: z.string().max(200).optional(),
    workingDays: z.array(z.number().int().min(0).max(6)),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })).min(1, "At least one provider required"),
  services: z.array(z.object({
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    durationMinutes: z.number().int().min(5).max(480),
  })).min(1, "At least one service required"),
  insurance_plans: z.array(z.string()).optional(),
  voice_tone: z.string().max(200).optional(),
  greeting_template: z.string().max(2000).optional(),
  primary_language: z.string().max(10).optional(),
});

export const createClinicSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  hours: z.record(z.string(), z.any()).optional(),
  emergency_number: z.string().max(30).optional(),
});

export const createUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().max(200).optional(),
  role: z.enum(["superadmin", "clinic_admin", "clinic_staff"]),
  clinicId: z.string().uuid().optional().nullable(),
});

export const createProviderSchema = z.object({
  name: z.string().min(1).max(200),
  specialty: z.string().max(200).optional(),
  working_days: z.array(z.string()).optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  lunch_start: z.string().optional(),
  lunch_end: z.string().optional(),
});

export const createServiceSchema = z.object({
  name: z.string().min(1).max(200),
  duration_minutes: z.number().int().min(5).max(480),
  provider_ids: z.array(z.string().uuid()).optional(),
  category: z.string().max(100).optional(),
});

export const publicBookingSchema = z.object({
  clinicId: z.string().min(1, "Clinic ID is required"),
  providerId: z.string().optional(),
  serviceId: z.string().optional(),
  patientName: z.string().min(1, "Patient name is required").max(200),
  patientPhone: z.string().min(1, "Phone number is required").max(30),
  patientEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  patientInsurance: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  time: z.string().min(1, "Time is required").max(20),
  isNewPatient: z.boolean().optional().default(true),
});
