"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  Calendar,
  Rocket,
  Loader2,
  ExternalLink,
  Building2,
  Phone,
  PartyPopper,
} from "lucide-react";
import { api, type SetupStatus } from "@/lib/api";

interface OnboardingWizardProps {
  clinicName: string;
  onComplete: () => void;
}

export function OnboardingWizard({ clinicName, onComplete }: OnboardingWizardProps) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSetup() {
      try {
        const data = await api.setup.status();
        setSetup(data);
        if (data.phone_number) setPhoneNumber(data.phone_number);
      } catch {
        // Silently fail — page will show loading
      } finally {
        setLoading(false);
      }
    }
    fetchSetup();
  }, []);

  async function handleConnectCalendar() {
    setCalendarLoading(true);
    setError(null);
    try {
      const { auth_url } = await api.setup.calendarAuthUrl();
      window.location.href = auth_url;
    } catch (err: any) {
      setError(err.message || "Failed to start calendar setup");
      setCalendarLoading(false);
    }
  }

  // Manual fallback — only shown if auto-activation after calendar failed
  async function handleGoLive() {
    setGoLiveLoading(true);
    setError(null);
    try {
      const result = await api.setup.goLive();
      setPhoneNumber(result.phone_number);
      const data = await api.setup.status();
      setSetup(data);
    } catch (err: any) {
      setError(err.message || "Go Live failed");
    } finally {
      setGoLiveLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-2xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-600" />
          <p className="mt-3 text-sm text-slate-500">Loading setup...</p>
        </div>
      </div>
    );
  }

  const calendarDone = setup?.steps.calendar_connected || false;
  const isActive = setup?.steps.is_active || false;

  // 2-step flow: connect calendar (auto-activates) → done
  // If auto-activation failed, show manual Go Live as fallback
  let currentStep = 1;
  if (calendarDone) currentStep = 2;
  if (isActive || phoneNumber) currentStep = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-teal-600 to-teal-700 px-8 py-6 text-white">
          <h2 className="text-xl font-bold">Welcome to Your AI Receptionist</h2>
          <p className="mt-1 text-sm text-teal-100">{clinicName}</p>
          <div className="mt-4 flex gap-2">
            {[1, 2].map((step) => (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-full ${
                  (step === 1 && currentStep >= 1) || (step === 2 && currentStep >= 3)
                    ? "bg-white"
                    : "bg-teal-400/40"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Completed: Clinic + Providers + Services */}
          <StepRow done icon={Building2} label="Clinic created with providers & services" />

          {/* Step 1: Connect Calendar (auto-activates) */}
          {!calendarDone ? (
            <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-teal-100 p-1.5">
                  <Calendar className="h-4 w-4 text-teal-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Connect Your Google Calendar</p>
                  <p className="mt-1 text-sm text-slate-500">
                    This lets your AI receptionist check availability and book appointments.
                    Your phone number will be assigned automatically.
                  </p>
                  <button
                    onClick={handleConnectCalendar}
                    disabled={calendarLoading}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    {calendarLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Calendar className="h-4 w-4" />
                    )}
                    Connect Google Calendar
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <StepRow done icon={Calendar} label="Google Calendar connected" />
          )}

          {/* Fallback: Manual Go Live (only if calendar done but auto-activation failed) */}
          {calendarDone && !isActive && !phoneNumber && (
            <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-teal-100 p-1.5">
                  <Rocket className="h-4 w-4 text-teal-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Activate Your Receptionist</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Almost there! Click below to assign a phone number and go live.
                  </p>
                  <button
                    onClick={handleGoLive}
                    disabled={goLiveLoading}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    {goLiveLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                    {goLiveLoading ? "Activating..." : "Activate Now"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* All done! */}
          {(isActive || phoneNumber) && (
            <>
              <StepRow done icon={Rocket} label="AI Receptionist is live!" />

              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
                <PartyPopper className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-2 font-semibold text-emerald-900">You're all set!</p>
                {phoneNumber && (
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <Phone className="h-4 w-4 text-emerald-600" />
                    <span className="text-lg font-bold text-emerald-800 tabular-nums">{phoneNumber}</span>
                  </div>
                )}
                <p className="mt-2 text-sm text-emerald-700">
                  Your AI receptionist is now answering calls. Go to your dashboard to monitor activity.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-8 py-4 flex justify-end">
          {(isActive || phoneNumber) ? (
            <button
              onClick={onComplete}
              className="rounded-lg bg-teal-600 px-6 py-2 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
            >
              Go to Dashboard
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ done, icon: Icon, label }: { done: boolean; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      {done ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
      ) : (
        <Circle className="h-5 w-5 text-slate-300 shrink-0" />
      )}
      <span className={`text-sm font-medium ${done ? "text-emerald-700" : "text-slate-500"}`}>
        {label}
      </span>
    </div>
  );
}
