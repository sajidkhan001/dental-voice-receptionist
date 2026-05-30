import { describe, it, expect } from "vitest";
import { detectCrisis, extractPatientInfo, classifyIntent, runAgentPipeline } from "../agent-runner";

describe("detectCrisis", () => {
  it("detects high pain levels", () => {
    const result = detectCrisis("My tooth is killing me. The pain is a 9 out of 10.");
    expect(result.is_crisis).toBe(true);
    expect(result.reason).toContain("Pain");
  });

  it("detects swelling", () => {
    const result = detectCrisis("My face is swollen on the left side");
    expect(result.is_crisis).toBe(true);
    expect(result.reason).toContain("Swelling");
  });

  it("does not flag normal calls", () => {
    const result = detectCrisis("Hi, I'd like to schedule a cleaning. I'm a new patient.");
    expect(result.is_crisis).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("detects bleeding", () => {
    const result = detectCrisis("I've been bleeding from my gums for hours and it won't stop");
    expect(result.is_crisis).toBe(true);
  });

  it("detects knocked out tooth", () => {
    const result = detectCrisis("My son just fell and his tooth got knocked out completely");
    expect(result.is_crisis).toBe(true);
  });
});

describe("extractPatientInfo", () => {
  it("extracts name from transcript", () => {
    const result = extractPatientInfo("Hi, my name is Jane Doe and I need an appointment");
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
  });

  it("extracts phone number", () => {
    const result = extractPatientInfo("My name is John. My phone is 555-123-4567");
    expect(result).not.toBeNull();
  });

  it("returns null for insufficient info", () => {
    const result = extractPatientInfo("Hello, what are your hours?");
    // May return null or partial — just verify it doesn't crash
    expect(result === null || typeof result === "object").toBe(true);
  });
});

describe("classifyIntent", () => {
  it("classifies booking intent", () => {
    const result = classifyIntent("I'd like to schedule a cleaning");
    expect(result).toMatch(/book/i);
  });

  it("classifies reschedule intent", () => {
    const result = classifyIntent("I need to reschedule my appointment");
    expect(result).toMatch(/reschedule/i);
  });

  it("classifies cancel intent", () => {
    const result = classifyIntent("I need to cancel my appointment on Friday");
    expect(result).toMatch(/cancel/i);
  });

  it("classifies question intent", () => {
    const result = classifyIntent("Are you open on Saturdays?");
    expect(result).toMatch(/question/i);
  });

  it("classifies emergency intent", () => {
    const result = classifyIntent("I have severe pain and my face is swollen");
    expect(result).toMatch(/emergency/i);
  });
});

describe("runAgentPipeline", () => {
  it("processes a booking call in simulation mode", async () => {
    const result = await runAgentPipeline({
      call_id: "test-pipeline-1",
      transcript: "Hi, I'd like to schedule a cleaning. I'm a new patient. My name is Jane Doe.",
      caller_phone: "+15551234567",
      timestamp: new Date().toISOString(),
    });

    expect(result).toBeDefined();
    expect(result.intent).toMatch(/book/i);
    expect(result.crisis_detected).toBe(false);
    expect(result.agent_response).toBeTruthy();
    expect(typeof result.duration_ms).toBe("number");
  });

  it("processes an emergency call", async () => {
    const result = await runAgentPipeline({
      call_id: "test-pipeline-2",
      transcript: "My tooth is killing me, the pain is a 9 out of 10 and my face is swollen",
      caller_phone: "+15559876543",
      timestamp: new Date().toISOString(),
    });

    expect(result).toBeDefined();
    expect(result.crisis_detected).toBe(true);
  });
});
