const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function fetchApi<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new ApiError("Session expired", 401);
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status, body.details);
  }

  return res.json();
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string) =>
      fetchApi<{ user: User; token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => fetchApi("/api/auth/logout", { method: "POST" }),
    me: () => fetchApi<User>("/api/auth/me"),
    changePassword: (current_password: string, new_password: string) =>
      fetchApi<{ success: boolean }>("/api/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({ current_password, new_password }),
      }),
    updateProfile: (data: { name?: string; email?: string }) =>
      fetchApi<{ success: boolean }>("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  dashboard: {
    kpis: () => fetchApi<KPIs>("/api/dashboard/kpis"),
    calls: (params?: { limit?: number; offset?: number; intent?: string; date_from?: string; date_to?: string }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      if (params?.intent) query.set("intent", params.intent);
      if (params?.date_from) query.set("date_from", params.date_from);
      if (params?.date_to) query.set("date_to", params.date_to);
      return fetchApi<{ calls: CallLog[]; total: number }>(`/api/dashboard/calls?${query}`);
    },
    appointments: (month?: string) =>
      fetchApi<{ appointments: Appointment[]; month: string }>(`/api/dashboard/appointments${month ? `?month=${month}` : ""}`),
    appointmentsToday: () =>
      fetchApi<{ appointments: TodayAppointment[]; stats: NoShowStats }>("/api/dashboard/appointments/today"),
    updateAppointmentStatus: (id: string, status: string) =>
      fetchApi<{ success: boolean; status: string }>(`/api/dashboard/appointments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    triggerFollowup: (id: string, type: "sms" | "ai_call") =>
      fetchApi<{ success: boolean; message: string }>(`/api/dashboard/appointments/${id}/followup`, {
        method: "POST",
        body: JSON.stringify({ type }),
      }),
    getFollowups: (id: string) =>
      fetchApi<{ followups: NoShowFollowup[] }>(`/api/dashboard/appointments/${id}/followups`),
    analytics: (days = 30) => fetchApi<Analytics>(`/api/dashboard/analytics?days=${days}`),
    reviews: (params?: { limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      return fetchApi<ReviewStats>(`/api/dashboard/reviews?${query}`);
    },
    intakeForms: (params?: { status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      return fetchApi<{ forms: IntakeFormSummary[]; total: number }>(`/api/dashboard/intake-forms?${query}`);
    },
    intakeForm: (id: string) => fetchApi<IntakeFormDetail>(`/api/dashboard/intake-forms/${id}`),
    reviewIntakeForm: (id: string) =>
      fetchApi<{ success: boolean }>(`/api/dashboard/intake-forms/${id}/review`, { method: "POST" }),
    updateInsurance: (bookingId: string, verified: boolean, details?: Record<string, unknown>) =>
      fetchApi<{ success: boolean }>(`/api/dashboard/appointments/${bookingId}/insurance`, {
        method: "PATCH",
        body: JSON.stringify({ verified, details }),
      }),
    calendarSyncStatus: () => fetchApi<CalendarSyncStatus>("/api/dashboard/calendar-sync/status"),
    enableCalendarSync: () => fetchApi<{ success: boolean }>("/api/dashboard/calendar-sync/enable", { method: "POST" }),
    resyncCalendar: () => fetchApi<{ success: boolean; synced: number; conflicts: number }>("/api/dashboard/calendar-sync/resync", { method: "POST" }),
    status: () => fetchApi<ClinicStatus>("/api/dashboard/status"),
    getCredentials: () => fetchApi<CredentialStatus>("/api/dashboard/credentials"),
    saveCredentials: (values: Partial<CredentialValues>) =>
      fetchApi<{ saved: number }>("/api/dashboard/credentials", {
        method: "POST",
        body: JSON.stringify(values),
      }),
  },

  admin: {
    overview: () => fetchApi<AdminOverview>("/api/admin/overview"),
    clinics: () => fetchApi<{ clinics: Clinic[] }>("/api/admin/clinics"),
    clinic: (id: string) => fetchApi<{ clinic: Clinic }>(`/api/admin/clinics/${id}`),
    createClinic: (data: CreateClinicData) =>
      fetchApi<{ id: string }>("/api/admin/clinics", { method: "POST", body: JSON.stringify(data) }),
    users: () => fetchApi<{ users: AdminUser[] }>("/api/admin/users"),
    createUser: (data: CreateUserData) =>
      fetchApi<{ id: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(data) }),
    auditLogs: (params?: { limit?: number; offset?: number; clinic_id?: string; action?: string }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.offset) query.set("offset", String(params.offset));
      if (params?.clinic_id) query.set("clinic_id", params.clinic_id);
      if (params?.action) query.set("action", params.action);
      return fetchApi<{ logs: AuditLog[]; total: number }>(`/api/admin/audit-logs?${query}`);
    },
    updateClinic: (id: string, data: Record<string, any>) =>
      fetchApi<{ status: string }>(`/api/admin/clinics/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  intake: {
    submit: (data: IntakeData) =>
      fetchApi<{ success: boolean; saved_as: string }>("/api/intake", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      }),
  },

  setup: {
    status: () =>
      fetchApi<SetupStatus>("/api/setup/status"),
    calendarAuthUrl: () =>
      fetchApi<{ auth_url: string }>("/api/setup/google-calendar/auth-url"),
    goLive: () =>
      fetchApi<GoLiveResult>("/api/setup/go-live", { method: "POST" }),
  },

  webCall: {
    create: (agentId?: string) =>
      fetchApi<{ access_token: string; call_id: string }>("/api/create-web-call", {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId }),
      }),
  },
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "clinic_admin" | "clinic_staff";
  clinicId?: string;
  clinicName?: string;
}

// ---- Dashboard types ----

export interface KPIs {
  total_calls: number;
  today_calls: number;
  total_bookings: number;
  today_bookings: number;
  total_escalations: number;
  avg_satisfaction: number;
}

export interface CallLog {
  id: string;
  call_id: string;
  caller_phone: string;
  transcript: string;
  intent: string;
  crisis_detected: boolean;
  booking_confirmed: boolean;
  agent_response: string;
  recording_url: string | null;
  duration_seconds: number;
  created_at: string;
}

export interface Appointment {
  id: string;
  patient_name: string;
  patient_phone: string;
  provider_name: string;
  service_name: string;
  date: string;
  time: string;
  duration_minutes: number;
  status: string;
}

export interface Analytics {
  calls_by_day: { date: string; count: number }[];
  intents: { intent: string; count: number }[];
  booking_rate: number;
  escalation_rate: number;
}

export interface ClinicStatus {
  clinic: { name: string; slug: string; status: string; phone: string };
  integrations: { voice: string; google_calendar: string; sms: string; email: string };
  system: { database: string; uptime: number; simulation_mode: boolean };
}

export interface SetupStatus {
  steps: {
    clinic_created: boolean;
    has_providers: boolean;
    has_services: boolean;
    calendar_connected: boolean;
    voice_configured: boolean;
    is_active: boolean;
  };
  progress: number;
  clinic_status: string;
  phone_number: string | null;
}

export interface GoLiveResult {
  success: boolean;
  already_active?: boolean;
  phone_number: string;
}

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  phone: string;
  status: string;
  total_calls?: number;
  today_calls?: number;
  total_bookings?: number;
  created_at: string;
}

export interface AdminOverview {
  total_clinics: number;
  active_clinics: number;
  total_calls: number;
  today_calls: number;
  total_bookings: number;
  total_users: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  clinic_id: string;
  clinic_name: string;
  is_active: boolean;
  last_login_at: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  clinic_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  ip_address: string;
  created_at: string;
}

export interface CreateClinicData {
  slug: string;
  name: string;
  phone?: string;
  address?: string;
}

export interface CreateUserData {
  email: string;
  password: string;
  name?: string;
  role: string;
  clinicId?: string;
}

export interface IntakeData {
  clinic_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address?: string;
  website?: string;
  timezone?: string;
  emergency_number?: string;
  hours: Record<string, { open: string; close: string } | null>;
  providers: {
    name: string;
    title?: string;
    specialty?: string;
    workingDays: number[];
    startHour: number;
    endHour: number;
  }[];
  services: {
    slug: string;
    name: string;
    durationMinutes: number;
  }[];
  insurance_plans?: string[];
  voice_tone?: string;
  greeting_template?: string;
  primary_language?: string;
}

export interface TodayAppointment {
  id: string;
  patient_name: string;
  patient_phone: string | null;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  is_new_patient: boolean;
  provider_name: string | null;
  service_name: string | null;
  followup_count: number;
}

export interface NoShowStats {
  today_total: number;
  today_arrived: number;
  today_noshow: number;
  today_pending: number;
  week_noshow: number;
  pending_followups: number;
}

export interface NoShowFollowup {
  id: string;
  followup_type: string;
  outcome: string;
  call_sid: string | null;
  message_body: string | null;
  notes: string | null;
  created_at: string;
}

export interface ReviewStats {
  reviews: ReviewRequest[];
  total: number;
  stats: { sent: number; clicked: number; reviewed: number };
}

export interface ReviewRequest {
  id: string;
  patient_name: string;
  patient_phone: string;
  channel: string;
  status: string;
  message_body: string;
  created_at: string;
}

export interface IntakeFormSummary {
  id: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string;
  insurance_carrier: string | null;
  reason_for_visit: string | null;
  pain_level: number | null;
  status: string;
  submitted_at: string | null;
  appointment_date: string | null;
  start_time: string | null;
  provider_name: string | null;
  service_name: string | null;
}

export interface IntakeFormDetail extends IntakeFormSummary {
  patient_dob: string | null;
  patient_address: string | null;
  medical_history: Record<string, unknown>;
  current_medications: string | null;
  allergies: string | null;
  dental_history: Record<string, unknown>;
  last_dental_visit: string | null;
  insurance_member_id: string | null;
  insurance_group_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  signature_data: string | null;
  consent_hipaa: boolean;
  consent_treatment: boolean;
  consent_financial: boolean;
}

export interface CalendarSyncStatus {
  connected: boolean;
  watch_active: boolean;
  watch_expiry: string | null;
  last_sync: string | null;
  conflicts: number;
}

export interface CredentialFieldStatus {
  configured: boolean;
  last4: string | null;
}

export interface CredentialStatus {
  anthropicApiKey: CredentialFieldStatus;
  deepgramApiKey: CredentialFieldStatus;
  inworldApiKey: CredentialFieldStatus;
  inworldVoiceId: CredentialFieldStatus;
  inworldModelId: CredentialFieldStatus;
  telnyxApiKey: CredentialFieldStatus;
  telnyxConnectionId: CredentialFieldStatus;
  telnyxFromNumber: CredentialFieldStatus;
  telnyxWebhookSecret: CredentialFieldStatus;
  sendgridApiKey: CredentialFieldStatus;
  gmailUser: CredentialFieldStatus;
  gmailAppPassword: CredentialFieldStatus;
  googleClientId: CredentialFieldStatus;
  googleClientSecret: CredentialFieldStatus;
}

export interface CredentialValues {
  anthropicApiKey: string;
  deepgramApiKey: string;
  inworldApiKey: string;
  inworldVoiceId: string;
  inworldModelId: string;
  telnyxApiKey: string;
  telnyxConnectionId: string;
  telnyxFromNumber: string;
  telnyxWebhookSecret: string;
  sendgridApiKey: string;
  gmailUser: string;
  gmailAppPassword: string;
  googleClientId: string;
  googleClientSecret: string;
}

export { ApiError };
