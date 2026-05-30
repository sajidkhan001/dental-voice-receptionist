"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  Settings,
  Building2,
  Phone,
  Calendar,
  Mail,
  MessageSquare,
  Headphones,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Rocket,
  ExternalLink,
  Circle,
  Key,
  Eye,
  EyeOff,
  Save,
} from "lucide-react";
import { api, type ClinicStatus, type SetupStatus, type CredentialStatus, type CredentialValues } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function StatusBadge({ status }: { status: string }) {
  const isOk = status === "ok" || status === "configured" || status === "active" || status === "true";
  return (
    <span className="inline-flex items-center gap-1.5">
      {isOk ? (
        <>
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">
            {status === "ok" ? "Connected" : status === "true" ? "Connected" : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-700">
            {status === "not_configured"
              ? "Not Configured"
              : status === "false"
                ? "Not Connected"
                : status === "error"
                  ? "Error"
                  : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </>
      )}
    </span>
  );
}

interface IntegrationRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: string;
  action?: React.ReactNode;
}

function IntegrationRow({ icon: Icon, label, status, action }: IntegrationRowProps) {
  const isOk = ["ok", "configured", "active", "true"].includes(status);
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            isOk ? "bg-emerald-50" : "bg-red-50"
          }`}
        >
          <Icon className={`h-4 w-4 ${isOk ? "text-emerald-600" : "text-red-500"}`} />
        </div>
        <span className="text-sm font-medium text-slate-900">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        {action}
      </div>
    </div>
  );
}

interface SetupStepProps {
  label: string;
  done: boolean;
  active?: boolean;
  children?: React.ReactNode;
}

function SetupStep({ label, done, active, children }: SetupStepProps) {
  return (
    <div className={`flex items-start gap-3 py-3 border-b border-slate-100 last:border-0 ${active ? "bg-teal-50/50 -mx-4 px-4 rounded-lg" : ""}`}>
      <div className="mt-0.5">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5 text-slate-300" />
        )}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${done ? "text-emerald-700" : "text-slate-700"}`}>
          {label}
        </p>
        {!done && children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

function CredentialInput({
  label,
  fieldKey,
  status,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  fieldKey: string;
  status?: { configured: boolean; last4: string | null };
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={fieldKey} className="block text-xs font-medium text-slate-600 mb-1">
          {label}
        </label>
        <div className="relative">
          <input
            id={fieldKey}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              status?.configured
                ? `Configured (****${status.last4 || ""})`
                : placeholder || "Paste key here"
            }
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 pr-9 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="shrink-0 mt-4">
        {status?.configured ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Set
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not set</span>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ClinicStatus | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [goLiveResult, setGoLiveResult] = useState<{ phone: string } | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);

  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const [credValues, setCredValues] = useState<Partial<CredentialValues>>({});
  const [credSaving, setCredSaving] = useState(false);
  const [credMessage, setCredMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function setField(field: keyof CredentialValues, value: string) {
    setCredValues((prev) => ({ ...prev, [field]: value }));
  }

  // Check URL params for calendar OAuth callback
  useEffect(() => {
    const calendarParam = searchParams.get("calendar");
    if (calendarParam === "success") {
      setCalendarMessage({ type: "success", text: "Google Calendar connected successfully!" });
    } else if (calendarParam === "error") {
      const reason = searchParams.get("reason") || "Unknown error";
      setCalendarMessage({ type: "error", text: `Calendar connection failed: ${reason}` });
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const [statusData, setup, creds] = await Promise.all([
          api.dashboard.status(),
          api.setup.status(),
          api.dashboard.getCredentials(),
        ]);
        setStatus(statusData);
        setSetupStatus(setup);
        setCredStatus(creds);

        if (setup.phone_number) {
          setGoLiveResult({ phone: setup.phone_number });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function handleSaveCredentials() {
    const toSave: Partial<CredentialValues> = {};
    for (const [k, v] of Object.entries(credValues)) {
      if (typeof v === "string" && v.trim() !== "") {
        (toSave as Record<string, string>)[k] = v.trim();
      }
    }
    if (Object.keys(toSave).length === 0) {
      setCredMessage({ type: "error", text: "Enter at least one key to save." });
      return;
    }
    setCredSaving(true);
    setCredMessage(null);
    try {
      await api.dashboard.saveCredentials(toSave);
      setCredValues({});
      const updated = await api.dashboard.getCredentials();
      setCredStatus(updated);
      setCredMessage({ type: "success", text: "API keys saved successfully." });
    } catch (err: unknown) {
      setCredMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save keys." });
    } finally {
      setCredSaving(false);
    }
  }

  async function handleConnectCalendar() {
    setCalendarLoading(true);
    setCalendarMessage(null);
    try {
      const { auth_url } = await api.setup.calendarAuthUrl();
      window.location.href = auth_url;
    } catch (err: unknown) {
      setCalendarMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to start calendar setup" });
      setCalendarLoading(false);
    }
  }

  async function handleGoLive() {
    setGoLiveLoading(true);
    setGoLiveError(null);
    try {
      const result = await api.setup.goLive();
      setGoLiveResult({ phone: result.phone_number });
      // Refresh status
      const [statusData, setup] = await Promise.all([
        api.dashboard.status(),
        api.setup.status(),
      ]);
      setStatus(statusData);
      setSetupStatus(setup);
    } catch (err: unknown) {
      setGoLiveError(err instanceof Error ? err.message : "Failed to go live. Please try again.");
    } finally {
      setGoLiveLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm font-medium text-red-800">Unable to load settings</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isOnboarding = setupStatus && setupStatus.clinic_status === "onboarding";
  const isActive = setupStatus?.steps.is_active;
  const calendarConnected = setupStatus?.steps.calendar_connected;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your clinic setup and connected services</p>
      </div>

      {/* Calendar message banner */}
      {calendarMessage && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            calendarMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {calendarMessage.type === "success" ? (
            <CheckCircle2 className="inline h-4 w-4 mr-2" />
          ) : (
            <XCircle className="inline h-4 w-4 mr-2" />
          )}
          {calendarMessage.text}
        </div>
      )}

      {/* Setup Checklist — shown when not fully active */}
      {setupStatus && !isActive && (
        <Card className="border-teal-200 shadow-sm bg-gradient-to-br from-teal-50/50 to-white">
          <CardHeader className="border-b border-teal-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-teal-900">
              <Rocket className="h-4 w-4 text-teal-600" />
              Setup Your AI Receptionist
              <Badge className="ml-auto bg-teal-100 text-teal-700">{setupStatus.progress}%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Progress bar */}
            <div className="mb-4">
              <div className="h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-teal-500 transition-all duration-500"
                  style={{ width: `${setupStatus.progress}%` }}
                />
              </div>
            </div>

            <SetupStep label="Clinic created" done={setupStatus.steps.clinic_created} />
            <SetupStep label="Providers configured" done={setupStatus.steps.has_providers} />
            <SetupStep label="Services configured" done={setupStatus.steps.has_services} />
            <SetupStep
              label="Connect Google Calendar"
              done={!!calendarConnected}
              active={!calendarConnected && setupStatus.steps.has_services}
            >
              <p className="text-xs text-slate-500 mb-2">
                Connect your Google Calendar so patients can book appointments in real-time.
              </p>
              <button
                onClick={handleConnectCalendar}
                disabled={calendarLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {calendarLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calendar className="h-4 w-4" />
                )}
                Connect Google Calendar
                <ExternalLink className="h-3 w-3" />
              </button>
            </SetupStep>
            <SetupStep
              label="Go Live!"
              done={!!isActive}
              active={!!calendarConnected && !isActive}
            >
              <p className="text-xs text-slate-500 mb-2">
                This will provision your AI voice agent and assign a dedicated phone number. Your receptionist is typically live within a few minutes.
              </p>
              {goLiveError && (
                <p className="text-xs text-red-600 mb-2 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  {goLiveError}
                </p>
              )}
              <button
                onClick={handleGoLive}
                disabled={goLiveLoading || !calendarConnected}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {goLiveLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                {goLiveLoading ? "Provisioning..." : "Go Live"}
              </button>
            </SetupStep>
          </CardContent>
        </Card>
      )}

      {/* Active phone number display */}
      {goLiveResult && (
        <Card className="border-emerald-200 shadow-sm bg-emerald-50/50">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <Phone className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800">Your AI Receptionist is Live!</p>
              <p className="text-2xl font-bold text-emerald-900 tabular-nums">{goLiveResult.phone}</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 text-xs">ACTIVE</Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clinic Information */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Building2 className="h-4 w-4 text-teal-600" />
              Clinic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <span className="text-sm text-slate-600">Clinic Name</span>
              <span className="text-sm font-medium text-slate-900">
                {status?.clinic.name || "--"}
              </span>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <span className="text-sm text-slate-600">Phone Number</span>
              <span className="text-sm font-medium text-slate-900 tabular-nums">
                {status?.clinic.phone || "--"}
              </span>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <span className="text-sm text-slate-600">Slug</span>
              <Badge variant="secondary" className="font-mono text-xs">
                {status?.clinic.slug || "--"}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-slate-600">Status</span>
              <StatusBadge status={status?.clinic.status || "unknown"} />
            </div>
          </CardContent>
        </Card>

        {/* Integration Status */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Settings className="h-4 w-4 text-teal-600" />
              Integration Status
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <IntegrationRow
              icon={Headphones}
              label="Voice Pipeline"
              status={status?.integrations.voice || "not_configured"}
            />
            <IntegrationRow
              icon={Calendar}
              label="Google Calendar"
              status={status?.integrations.google_calendar || "not_configured"}
              action={
                !calendarConnected ? (
                  <button
                    onClick={handleConnectCalendar}
                    disabled={calendarLoading}
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                  >
                    Connect
                  </button>
                ) : undefined
              }
            />
            <IntegrationRow
              icon={MessageSquare}
              label="SMS"
              status={status?.integrations.sms || "not_configured"}
            />
            <IntegrationRow
              icon={Mail}
              label="Email"
              status={status?.integrations.email || "not_configured"}
            />
          </CardContent>
        </Card>

        {/* System Status */}
        <Card className="border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-teal-600" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">Database</span>
                <StatusBadge status={status?.system.database || "unknown"} />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">Uptime</span>
                <span className="text-sm font-medium text-slate-900 tabular-nums">
                  {status?.system.uptime != null
                    ? `${Math.floor(status.system.uptime / 3600)}h ${Math.floor(
                        (status.system.uptime % 3600) / 60
                      )}m`
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">Mode</span>
                <Badge
                  variant="secondary"
                  className={
                    status?.system.simulation_mode
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                  }
                >
                  {status?.system.simulation_mode ? "Simulation" : "Live"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card className="border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Key className="h-4 w-4 text-teal-600" />
              API Keys &amp; Integrations
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-6">
            <p className="text-xs text-slate-500">
              Keys are encrypted at rest and never returned to the browser. Leave a field blank to keep its current value.
            </p>

            {credMessage && (
              <div className={`rounded-lg px-4 py-3 text-sm font-medium ${credMessage.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                {credMessage.type === "success" ? <CheckCircle2 className="inline h-4 w-4 mr-2" /> : <XCircle className="inline h-4 w-4 mr-2" />}
                {credMessage.text}
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              {/* AI / LLM */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">AI / LLM</h3>
                <CredentialInput label="Anthropic API Key" fieldKey="anthropicApiKey" status={credStatus?.anthropicApiKey} value={credValues.anthropicApiKey || ""} onChange={(v) => setField("anthropicApiKey", v)} placeholder="sk-ant-…" />
              </div>

              {/* Speech-to-Text */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Speech-to-Text</h3>
                <CredentialInput label="Deepgram API Key" fieldKey="deepgramApiKey" status={credStatus?.deepgramApiKey} value={credValues.deepgramApiKey || ""} onChange={(v) => setField("deepgramApiKey", v)} />
              </div>

              {/* Text-to-Speech (Inworld) */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Text-to-Speech (Inworld)</h3>
                <CredentialInput label="Inworld API Key" fieldKey="inworldApiKey" status={credStatus?.inworldApiKey} value={credValues.inworldApiKey || ""} onChange={(v) => setField("inworldApiKey", v)} />
                <CredentialInput label="Voice ID" fieldKey="inworldVoiceId" status={credStatus?.inworldVoiceId} value={credValues.inworldVoiceId || ""} onChange={(v) => setField("inworldVoiceId", v)} placeholder="e.g. Ashley" />
                <CredentialInput label="Model ID" fieldKey="inworldModelId" status={credStatus?.inworldModelId} value={credValues.inworldModelId || ""} onChange={(v) => setField("inworldModelId", v)} placeholder="inworld-tts-1.5-max" />
              </div>

              {/* Telephony (Telnyx) */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Telephony (Telnyx)</h3>
                <CredentialInput label="Telnyx API Key" fieldKey="telnyxApiKey" status={credStatus?.telnyxApiKey} value={credValues.telnyxApiKey || ""} onChange={(v) => setField("telnyxApiKey", v)} placeholder="KEY…" />
                <CredentialInput label="Connection ID" fieldKey="telnyxConnectionId" status={credStatus?.telnyxConnectionId} value={credValues.telnyxConnectionId || ""} onChange={(v) => setField("telnyxConnectionId", v)} />
                <CredentialInput label="From Number" fieldKey="telnyxFromNumber" status={credStatus?.telnyxFromNumber} value={credValues.telnyxFromNumber || ""} onChange={(v) => setField("telnyxFromNumber", v)} placeholder="+15550001234" />
                <CredentialInput label="Webhook Secret" fieldKey="telnyxWebhookSecret" status={credStatus?.telnyxWebhookSecret} value={credValues.telnyxWebhookSecret || ""} onChange={(v) => setField("telnyxWebhookSecret", v)} />
              </div>

              {/* Email */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Email (SendGrid or Gmail)</h3>
                <CredentialInput label="SendGrid API Key" fieldKey="sendgridApiKey" status={credStatus?.sendgridApiKey} value={credValues.sendgridApiKey || ""} onChange={(v) => setField("sendgridApiKey", v)} placeholder="SG.…" />
                <CredentialInput label="Gmail User" fieldKey="gmailUser" status={credStatus?.gmailUser} value={credValues.gmailUser || ""} onChange={(v) => setField("gmailUser", v)} placeholder="you@gmail.com" />
                <CredentialInput label="Gmail App Password" fieldKey="gmailAppPassword" status={credStatus?.gmailAppPassword} value={credValues.gmailAppPassword || ""} onChange={(v) => setField("gmailAppPassword", v)} />
              </div>

              {/* Google Calendar OAuth */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Google Calendar OAuth</h3>
                <CredentialInput label="OAuth Client ID" fieldKey="googleClientId" status={credStatus?.googleClientId} value={credValues.googleClientId || ""} onChange={(v) => setField("googleClientId", v)} />
                <CredentialInput label="OAuth Client Secret" fieldKey="googleClientSecret" status={credStatus?.googleClientSecret} value={credValues.googleClientSecret || ""} onChange={(v) => setField("googleClientSecret", v)} />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveCredentials}
                disabled={credSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {credSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {credSaving ? "Saving…" : "Save API Keys"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
