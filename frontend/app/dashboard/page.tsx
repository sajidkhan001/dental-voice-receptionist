"use client";

import { useState, useEffect } from "react";
import { Phone, CalendarCheck, AlertTriangle, Star } from "lucide-react";
import { api, type KPIs, type CallLog } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { OnboardingWizard } from "@/components/dashboard/onboarding-wizard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const intentColors: Record<string, { className: string; label: string }> = {
  booking: { className: "bg-emerald-100 text-emerald-700", label: "Booking" },
  question: { className: "bg-blue-100 text-blue-700", label: "Question" },
  emergency: { className: "bg-red-100 text-red-700", label: "Emergency" },
  cancel: { className: "bg-orange-100 text-orange-700", label: "Cancel" },
  reschedule: { className: "bg-yellow-100 text-yellow-700", label: "Reschedule" },
};

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatPhone(phone: string): string {
  if (!phone) return "Unknown";
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  if (phone.length === 11 && phone.startsWith("1")) {
    return `(${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  }
  return phone;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [clinicName, setClinicName] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        // Check setup status to decide if wizard should show
        const [kpiData, callData, setupData, statusData] = await Promise.all([
          api.dashboard.kpis(),
          api.dashboard.calls({ limit: 10 }),
          api.setup.status().catch(() => null),
          api.dashboard.status().catch(() => null),
        ]);
        setKpis(kpiData);
        setCalls(callData.calls);

        if (statusData) {
          setClinicName(statusData.clinic.name);
        }

        // Show wizard if clinic is still onboarding
        if (setupData && setupData.clinic_status === "onboarding") {
          setShowWizard(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm font-medium text-red-800">Unable to load dashboard</p>
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

  return (
    <div className="space-y-6">
      {showWizard && (
        <OnboardingWizard
          clinicName={clinicName}
          onComplete={() => {
            setShowWizard(false);
            window.location.reload();
          }}
        />
      )}

      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Calls"
          value={kpis?.total_calls ?? 0}
          icon={Phone}
          color="teal"
        />
        <KPICard
          title="Today's Bookings"
          value={kpis?.today_bookings ?? 0}
          icon={CalendarCheck}
          color="blue"
        />
        <KPICard
          title="Escalations"
          value={kpis?.total_escalations ?? 0}
          icon={AlertTriangle}
          color="red"
        />
        <KPICard
          title="Avg Satisfaction"
          value={kpis?.avg_satisfaction != null ? `${kpis.avg_satisfaction.toFixed(1)}/5` : "N/A"}
          icon={Star}
          color="amber"
        />
      </div>

      {/* Recent Calls Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Recent Calls</h2>
          <p className="text-sm text-slate-500">Most recent 10 calls</p>
        </div>
        {calls.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Phone className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">No calls yet</p>
            <p className="mt-1 text-sm text-slate-500">Calls will appear here as patients reach your AI receptionist</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>Caller</TableHead>
                <TableHead>Intent</TableHead>
                <TableHead>Crisis</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead className="pr-6">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => {
                const intent = intentColors[call.intent] || {
                  className: "bg-slate-100 text-slate-700",
                  label: call.intent,
                };
                return (
                  <TableRow key={call.id}>
                    <TableCell className="pl-6 text-slate-600">
                      {formatTime(call.created_at)}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {formatPhone(call.caller_phone)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={intent.className}
                        variant="secondary"
                      >
                        {intent.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {call.crisis_detected ? (
                        <Badge variant="destructive">Yes</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                          No
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {call.booking_confirmed ? (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                          Confirmed
                        </Badge>
                      ) : (
                        <span className="text-sm text-slate-400">--</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 tabular-nums text-slate-600">
                      {formatDuration(call.duration_seconds)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
