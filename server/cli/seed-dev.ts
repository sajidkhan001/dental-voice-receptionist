/**
 * seed-dev.ts — Seed development database with test data
 * Usage: npx tsx cli/seed-dev.ts
 */

import { config } from "dotenv";
config();

import bcrypt from "bcrypt";
import { getPool, runMigrations, closePool } from "../lib/db";

async function seed() {
  const pool = getPool();
  if (!pool) {
    console.error("ERROR: DATABASE_URL is required for seeding. Set it in .env");
    process.exit(1);
  }

  console.log("Running migrations...");
  await runMigrations();

  console.log("Seeding development data...\n");

  // 1. Create test clinic
  const clinicResult = await pool.query(`
    INSERT INTO clinics (slug, name, phone, address, status, hours, emergency_number)
    VALUES ('demo-dental', 'Demo Dental Clinic', '555-000-1234', '123 Main Street, Suite 100, Your City, ST 00000', 'active',
      '{"monday":"9:00-18:00","tuesday":"9:00-18:00","wednesday":"9:00-18:00","thursday":"9:00-18:00","friday":"9:00-18:00","saturday":"9:00-14:00","sunday":"closed"}',
      '555-000-9999')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const clinicId = clinicResult.rows[0].id;
  console.log(`  Clinic: Demo Dental Clinic (${clinicId})`);

  // 2. Create users
  const superadminHash = await bcrypt.hash("admin123", 12);
  const clinicAdminHash = await bcrypt.hash("clinic123", 12);

  await pool.query(`
    INSERT INTO users (email, password_hash, name, role, clinic_id)
    VALUES ('admin@test.com', $1, 'Super Admin', 'superadmin', NULL)
    ON CONFLICT (email) DO UPDATE SET password_hash = $1
  `, [superadminHash]);
  console.log("  User: admin@test.com / admin123 (superadmin)");

  await pool.query(`
    INSERT INTO users (email, password_hash, name, role, clinic_id)
    VALUES ('clinic@test.com', $1, 'Clinic Manager', 'clinic_admin', $2)
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, clinic_id = $2
  `, [clinicAdminHash, clinicId]);
  console.log("  User: clinic@test.com / clinic123 (clinic_admin)");

  // 3. Create providers
  const providers = [
    { name: "Dr. Smith", specialty: "General Dentistry", days: ["Monday","Tuesday","Wednesday","Thursday","Friday"] },
    { name: "Dr. Lee", specialty: "Orthodontics", days: ["Tuesday","Thursday","Saturday"] },
    { name: "Dr. Patel", specialty: "Pediatric Dentistry", days: ["Wednesday","Friday"] },
  ];

  for (const p of providers) {
    await pool.query(`
      INSERT INTO providers (clinic_id, name, specialty, working_days, start_time, end_time)
      VALUES ($1, $2, $3, $4, '09:00', '18:00')
      ON CONFLICT DO NOTHING
    `, [clinicId, p.name, p.specialty, JSON.stringify(p.days)]);
  }
  console.log("  Providers: Dr. Smith, Dr. Lee, Dr. Patel");

  // 4. Create services
  const services = [
    { name: "New Patient Exam", duration: 60 },
    { name: "Cleaning", duration: 45 },
    { name: "Filling", duration: 60 },
    { name: "Whitening Consult", duration: 30 },
    { name: "Emergency Visit", duration: 45 },
    { name: "Orthodontic Consult", duration: 45 },
  ];

  for (const s of services) {
    await pool.query(`
      INSERT INTO services (clinic_id, name, duration_minutes)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [clinicId, s.name, s.duration]);
  }
  console.log("  Services: 6 services created");

  // 5. Create sample call logs
  const intents = ["booking", "reschedule", "cancel", "question", "emergency"];
  const transcripts = [
    "Hi, I'd like to schedule a cleaning. I'm a new patient. My name is Jane Doe.",
    "I need to reschedule my appointment from Thursday to next week.",
    "I need to cancel my appointment on Friday at 2 PM. My name is David Park.",
    "Are you open on Saturdays? Do you accept MetLife insurance?",
    "My tooth is killing me, the pain is a 9 out of 10 and my face is swollen.",
    "I want to see Dr. Lee for an Invisalign consultation.",
    "I need to make an appointment for my daughter, she's 6 and has never been to the dentist.",
    "Hi, I'd like to schedule a filling. My name is Mike Johnson.",
    "Can you tell me your hours? I need a cleaning but I can only do mornings.",
    "I've been trying to get an appointment for weeks and no one calls me back!",
  ];

  for (let i = 0; i < 10; i++) {
    const intent = intents[i % intents.length];
    const isCrisis = intent === "emergency";
    const daysAgo = 10 - i;
    await pool.query(`
      INSERT INTO call_logs (clinic_id, call_id, caller_phone, transcript, intent, crisis_detected, booking_confirmed, agent_response, duration_seconds, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '${daysAgo} days')
    `, [
      clinicId,
      `test-call-${Date.now()}-${i}`,
      `+1555${String(1000000 + i).slice(1)}`,
      transcripts[i],
      intent,
      isCrisis,
      intent === "booking",
      `AI response for ${intent} call`,
      Math.floor(60 + Math.random() * 240),
    ]);
  }
  console.log("  Call logs: 10 sample calls");

  // 6. Create sample bookings
  const bookings = [
    { patient: "Jane Doe", phone: "+15551000000", provider: "Sarah", service: "Cleaning", status: "confirmed" },
    { patient: "Mike Johnson", phone: "+15551000007", provider: "Dr. Smith", service: "Filling", status: "confirmed" },
    { patient: "Lisa Chen", phone: "+15551000001", provider: "Dr. Smith", service: "Filling", status: "confirmed" },
    { patient: "Carlos Mendez", phone: "+15551000005", provider: "Sarah", service: "Cleaning", status: "pending" },
    { patient: "Lily Martinez", phone: "+15551000006", provider: "Dr. Patel", service: "New Patient Exam", status: "confirmed" },
  ];

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    const daysAhead = i + 1;
    await pool.query(`
      INSERT INTO bookings (clinic_id, patient_name, patient_phone, provider_name, service_name, date, time, duration_minutes, status)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + INTERVAL '${daysAhead} days', $6, $7, $8)
    `, [
      clinicId,
      b.patient,
      b.phone,
      b.provider,
      b.service,
      `${9 + i}:${i % 2 === 0 ? "00" : "30"}`,
      b.service === "Cleaning" ? 45 : 60,
      b.status,
    ]);
  }
  console.log("  Bookings: 5 sample appointments");

  console.log("\nSeed complete! You can now log in:");
  console.log("  Superadmin:   admin@test.com / admin123");
  console.log("  Clinic Admin: clinic@test.com / clinic123");

  await closePool();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
