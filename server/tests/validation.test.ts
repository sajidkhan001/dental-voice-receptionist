import { describe, it, expect } from "vitest";
import { loginSchema, testCallSchema, createUserSchema, createClinicSchema } from "../lib/validators";

describe("loginSchema", () => {
  it("accepts valid login data", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "password123" });
    expect(result.success).toBe(true);
  });

  it("transforms email to lowercase", () => {
    const result = loginSchema.safeParse({ email: "TEST@Example.COM", password: "pass" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("test@example.com");
    }
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({ email: "notanemail", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "test@test.com" });
    expect(result.success).toBe(false);
  });
});

describe("testCallSchema", () => {
  it("accepts valid test call data", () => {
    const result = testCallSchema.safeParse({ transcript: "Hello, I need help" });
    expect(result.success).toBe(true);
  });

  it("rejects empty transcript", () => {
    const result = testCallSchema.safeParse({ transcript: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing transcript", () => {
    const result = testCallSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("createUserSchema", () => {
  it("accepts valid user data", () => {
    const result = createUserSchema.safeParse({
      email: "new@clinic.com",
      password: "securepass123",
      name: "Dr. Test",
      role: "clinic_admin",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short password", () => {
    const result = createUserSchema.safeParse({
      email: "new@clinic.com",
      password: "short",
      role: "clinic_admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = createUserSchema.safeParse({
      email: "new@clinic.com",
      password: "password123",
      role: "hacker",
    });
    expect(result.success).toBe(false);
  });
});

describe("createClinicSchema", () => {
  it("accepts valid clinic data", () => {
    const result = createClinicSchema.safeParse({
      slug: "bright-dental",
      name: "Bright Dental Care",
      phone: "555-111-2222",
    });
    expect(result.success).toBe(true);
  });

  it("rejects slug with spaces", () => {
    const result = createClinicSchema.safeParse({
      slug: "bad slug",
      name: "Test Clinic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug with uppercase", () => {
    const result = createClinicSchema.safeParse({
      slug: "BadSlug",
      name: "Test Clinic",
    });
    expect(result.success).toBe(false);
  });
});
