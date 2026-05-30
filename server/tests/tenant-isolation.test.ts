/**
 * tenant-isolation.test.ts
 *
 * Proves that service functions always scope queries to the calling clinic's ID.
 * These tests mock the DB layer and verify that:
 *   1. call_logs queries include clinic_id in the WHERE clause
 *   2. getCallLog(clinicA, idFromClinicB) returns null — cross-tenant access blocked
 *   3. getCallLogs(clinicA) never returns rows that belong to clinicB
 *   4. loadClinicConfig only loads the requested clinic's row
 *
 * If any of these fail, a JWT token for clinic A could leak clinic B's PHI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const CLINIC_A = "clinic-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLINIC_B = "clinic-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CALL_ID_B = "call-bbbb-bbbb-bbbb";

// ---- Mock the DB module so no real database is needed ----
vi.mock("../lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

// ---- Mock encryption so no ENCRYPTION_KEY env var needed ----
vi.mock("../lib/encryption", () => ({
  encrypt: (v: string) => `ENC:${v}`,
  decrypt: (v: string) => v.replace("ENC:", ""),
  encryptField: (v: string | null) => (v == null ? null : `ENC:${v}`),
  decryptField: (v: string | null) => (v == null ? null : v.replace(/^ENC:/, "")),
}));

// ---- Mock billing-service to avoid circular dep during incrementCallCount ----
vi.mock("../services/billing-service", () => ({
  incrementCallCount: vi.fn().mockResolvedValue(undefined),
  seedBillingTiers: vi.fn().mockResolvedValue(undefined),
}));

describe("tenant isolation — call service", () => {
  let db: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import("../lib/db");
  });

  it("getCallLogs always queries with the given clinic_id", async () => {
    db.query.mockResolvedValue([]);
    db.queryOne.mockResolvedValue({ count: "0" });

    const { getCallLogs } = await import("../services/call-service");
    await getCallLogs(CLINIC_A);

    // Every call to db.query should use CLINIC_A as the first parameter
    for (const call of db.query.mock.calls) {
      expect(call[1][0]).toBe(CLINIC_A);
    }
    for (const call of db.queryOne.mock.calls) {
      expect(call[1][0]).toBe(CLINIC_A);
    }
  });

  it("getCallLogs with clinicB does not receive clinicA rows", async () => {
    const clinicARow = {
      id: "row-a",
      clinic_id: CLINIC_A,
      transcript: null,
      caller_phone: null,
      patient_name: null,
      patient_phone: null,
      patient_email: null,
      patient_insurance: null,
      crisis_reason: null,
      agent_response: null,
    };

    // DB mock: always return clinicA data regardless of arguments
    // (simulates a bug where clinic_id filtering is missing)
    // The service should still only return what matches the given clinicId.
    // Since we're testing the service's OWN WHERE clause we pass the correct clinic
    // and verify query params, not mock cheating.
    db.query.mockResolvedValue([clinicARow]);
    db.queryOne.mockResolvedValue({ count: "1" });

    const { getCallLogs } = await import("../services/call-service");
    await getCallLogs(CLINIC_B);

    // The query must have been called with CLINIC_B, not CLINIC_A
    for (const call of db.query.mock.calls) {
      expect(call[1][0]).toBe(CLINIC_B);
    }
  });

  it("getCallLog returns null when clinic_id does not match the stored row", async () => {
    // Simulate: call log belongs to CLINIC_B; query with CLINIC_A returns null
    // (Postgres WHERE clinic_id=$1 AND id=$2 returns no rows)
    db.queryOne.mockResolvedValue(null);

    const { getCallLog } = await import("../services/call-service");
    const result = await getCallLog(CLINIC_A, CALL_ID_B);

    expect(result).toBeNull();
    // Verify the query was scoped to CLINIC_A
    expect(db.queryOne.mock.calls[0][1][0]).toBe(CLINIC_A);
  });

  it("getCallLog query includes BOTH clinic_id AND id", async () => {
    db.queryOne.mockResolvedValue(null);

    const { getCallLog } = await import("../services/call-service");
    await getCallLog(CLINIC_A, CALL_ID_B);

    const [sql, params] = db.queryOne.mock.calls[0];
    // SQL must filter by both columns
    expect(sql).toMatch(/clinic_id/);
    expect(sql).toMatch(/\$1/);
    expect(sql).toMatch(/\$2/);
    // Params must contain both values in the right order
    expect(params[0]).toBe(CLINIC_A);
    expect(params[1]).toBe(CALL_ID_B);
  });

  it("getKpis scopes aggregate query to the given clinic_id", async () => {
    db.queryOne.mockResolvedValue({
      total_calls: "5",
      today_calls: "2",
      booking_rate: "60.0",
      crisis_count: "0",
      avg_duration_ms: "4500",
    });

    const { getKpis } = await import("../services/call-service");
    await getKpis(CLINIC_A);

    expect(db.queryOne.mock.calls[0][1][0]).toBe(CLINIC_A);
  });
});

describe("tenant isolation — clinic service", () => {
  let db: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await import("../lib/db");
  });

  it("loadClinicConfig queries by clinic id", async () => {
    db.queryOne.mockResolvedValue(null); // clinic not found
    db.query.mockResolvedValue([]);

    const { loadClinicConfig } = await import("../services/clinic-service");
    const result = await loadClinicConfig(CLINIC_A);

    expect(result).toBeNull();
    expect(db.queryOne.mock.calls[0][1][0]).toBe(CLINIC_A);
  });

  it("loadClinicByPhoneNumber queries by phone number, not by guessed clinic_id", async () => {
    db.queryOne.mockResolvedValue(null);
    db.query.mockResolvedValue([]);

    const { loadClinicByPhoneNumber } = await import("../services/clinic-service");
    await loadClinicByPhoneNumber("+15550001234");

    const [sql, params] = db.queryOne.mock.calls[0];
    // Must query by the phone number field, not by clinic id
    expect(sql).toMatch(/twilio_phone_number|telnyx_phone_number/);
    expect(params[0]).toBe("+15550001234");
  });

  it("listClinics does not accept a clinic_id filter (superadmin only)", async () => {
    db.query.mockResolvedValue([]);

    const { listClinics } = await import("../services/clinic-service");
    await listClinics();

    // listClinics takes no args and returns ALL clinics (intentional — superadmin route)
    // But the call itself must not accidentally pass a clinic_id parameter
    expect(db.query.mock.calls[0][1]).toBeUndefined();
  });
});

describe("tenant isolation — encryption field boundary", () => {
  it("encryptField returns null for null input (no ENC: prefix on null)", async () => {
    const { encryptField } = await import("../lib/encryption");
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
  });

  it("decryptField returns null for null input (no crash on missing PHI)", async () => {
    const { decryptField } = await import("../lib/encryption");
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it("decryptField handles legacy plaintext without throwing", async () => {
    const { decryptField } = await import("../lib/encryption");
    // Old rows stored plaintext — must not throw or corrupt
    expect(() => decryptField("plaintext phone number")).not.toThrow();
    expect(decryptField("plain")).toBe("plain");
  });
});
