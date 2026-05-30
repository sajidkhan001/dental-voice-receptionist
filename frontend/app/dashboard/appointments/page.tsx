"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  AlertTriangle,
  Phone,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
} from "lucide-react";
import { api, type Appointment, type TodayAppointment, type NoShowStats } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusColors: Record<string, { className: string; label: string }> = {
  confirmed: { className: "bg-emerald-100 text-emerald-700", label: "Confirmed" },
  cancelled: { className: "bg-red-100 text-red-700", label: "Cancelled" },
  pending: { className: "bg-yellow-100 text-yellow-700", label: "Pending" },
  completed: { className: "bg-blue-100 text-blue-700", label: "Arrived" },
  no_show: { className: "bg-slate-100 text-slate-700", label: "No-Show" },
};

function getMonthString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function shiftMonth(monthStr: string, delta: number): string {
  const [year, month] = monthStr.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return getMonthString(date);
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTime12(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${hour12}:${String(minutes).padStart(2, "0")} ${ampm}`;
  } catch {
    return timeStr;
  }
}

// ---- Today Tab ----

function TodayTab() {
  const [appointments, setAppointments] = useState<TodayAppointment[]>([]);
  const [stats, setStats] = useState<NoShowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    appointmentId: string;
    patientName: string;
    type: "ai_call" | "mark_noshow";
  }>({ open: false, appointmentId: "", patientName: "", type: "ai_call" });
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchToday = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.dashboard.appointmentsToday();
      setAppointments(data.appointments);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToday();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchToday, 60_000);
    return () => clearInterval(interval);
  }, [fetchToday]);

  async function handleStatusChange(id: string, status: string) {
    if (status === "no_show") {
      const appt = appointments.find((a) => a.id === id);
      setConfirmDialog({
        open: true,
        appointmentId: id,
        patientName: appt?.patient_name || "",
        type: "mark_noshow",
      });
      return;
    }

    setActionLoading(id);
    try {
      await api.dashboard.updateAppointmentStatus(id, status);
      await fetchToday();
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "Failed to update appointment status" });
    } finally {
      setActionLoading(null);
    }
  }

  async function confirmMarkNoShow() {
    setActionLoading(confirmDialog.appointmentId);
    setConfirmDialog((d) => ({ ...d, open: false }));
    try {
      await api.dashboard.updateAppointmentStatus(confirmDialog.appointmentId, "no_show");
      await fetchToday();
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "Failed to mark as no-show" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFollowup(id: string, type: "sms" | "ai_call") {
    if (type === "ai_call") {
      const appt = appointments.find((a) => a.id === id);
      setConfirmDialog({
        open: true,
        appointmentId: id,
        patientName: appt?.patient_name || "",
        type: "ai_call",
      });
      return;
    }

    setActionLoading(id);
    try {
      const result = await api.dashboard.triggerFollowup(id, type);
      setNotification({ type: "success", text: result.message });
      await fetchToday();
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "Failed to send follow-up" });
    } finally {
      setActionLoading(null);
    }
  }

  async function confirmAiCallback() {
    setActionLoading(confirmDialog.appointmentId);
    setConfirmDialog((d) => ({ ...d, open: false }));
    try {
      const result = await api.dashboard.triggerFollowup(confirmDialog.appointmentId, "ai_call");
      setNotification({ type: "success", text: result.message });
      await fetchToday();
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "Failed to initiate AI callback" });
    } finally {
      setActionLoading(null);
    }
  }

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-200" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
        <p className="mt-2 text-sm font-medium text-red-800">Unable to load today&apos;s appointments</p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <button
          onClick={fetchToday}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Inline notification */}
      {notification && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium flex items-center justify-between ${
            notification.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <span className="flex items-center gap-2">
            {notification.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            {notification.text}
          </span>
          <button onClick={() => setNotification(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Total Today"
            value={stats.today_total}
            icon={<Calendar className="h-5 w-5 text-slate-400" />}
          />
          <StatCard
            label="Arrived"
            value={stats.today_arrived}
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            color="text-emerald-600"
          />
          <StatCard
            label="No-Shows"
            value={stats.today_noshow}
            icon={<XCircle className="h-5 w-5 text-red-500" />}
            color="text-red-600"
          />
          <StatCard
            label="Pending"
            value={stats.today_pending}
            icon={<Clock className="h-5 w-5 text-amber-500" />}
            color="text-amber-600"
          />
        </div>
      )}

      {/* Appointments List */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {appointments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Calendar className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">No appointments today</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => {
                const statusInfo = statusColors[appt.status] || statusColors.pending;
                const isLoading = actionLoading === appt.id;

                return (
                  <TableRow key={appt.id} className={appt.status === "no_show" ? "bg-red-50/40" : ""}>
                    <TableCell className="pl-6 text-slate-900 font-medium tabular-nums">
                      {formatTime12(appt.start_time)}
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-900 font-medium">{appt.patient_name}</div>
                      {appt.is_new_patient && (
                        <span className="text-xs text-blue-600 font-medium">New Patient</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">{appt.provider_name || "—"}</TableCell>
                    <TableCell className="text-slate-600">{appt.service_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusInfo.className}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex items-center justify-end gap-2">
                        {appt.status === "confirmed" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                              disabled={isLoading}
                              onClick={() => handleStatusChange(appt.id, "completed")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Arrived
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50"
                              disabled={isLoading}
                              onClick={() => handleStatusChange(appt.id, "no_show")}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              No-Show
                            </Button>
                          </>
                        )}

                        {appt.status === "completed" && (
                          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Arrived
                          </span>
                        )}

                        {appt.status === "no_show" && appt.patient_phone && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              disabled={isLoading}
                              onClick={() => handleFollowup(appt.id, "sms")}
                            >
                              <MessageSquare className="h-3.5 w-3.5 mr-1" />
                              SMS
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                              disabled={isLoading}
                              onClick={() => handleFollowup(appt.id, "ai_call")}
                            >
                              <Phone className="h-3.5 w-3.5 mr-1" />
                              AI Call
                            </Button>
                          </>
                        )}

                        {appt.status === "no_show" && Number(appt.followup_count) > 0 && (
                          <span className="text-xs text-slate-500">
                            ({appt.followup_count} follow-up{Number(appt.followup_count) > 1 ? "s" : ""})
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.type === "ai_call" ? "Confirm AI Callback" : "Mark as No-Show"}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.type === "ai_call"
                ? `This will trigger an AI phone call to ${confirmDialog.patientName} to reschedule their missed appointment.`
                : `Are you sure you want to mark ${confirmDialog.patientName}'s appointment as a no-show?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              variant={confirmDialog.type === "mark_noshow" ? "destructive" : "default"}
              onClick={confirmDialog.type === "ai_call" ? confirmAiCallback : confirmMarkNoShow}
            >
              {confirmDialog.type === "ai_call" ? "Call Now" : "Mark No-Show"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-slate-500 font-medium">{label}</p>
          <p className={`text-2xl font-bold ${color || "text-slate-900"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

// ---- Monthly Tab (existing) ----

function MonthlyTab() {
  const [month, setMonth] = useState(() => getMonthString(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.dashboard.appointments(month);
      setAppointments(data.appointments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  return (
    <>
      {/* Month Selector */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm w-fit">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[180px] text-center text-sm font-semibold text-slate-900">
          {getMonthLabel(month)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm font-medium text-red-800">Unable to load appointments</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <button
            onClick={fetchAppointments}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-200" />
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {appointments.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Calendar className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700">No appointments</p>
              <p className="mt-1 text-sm text-slate-500">
                No appointments scheduled for {getMonthLabel(month)}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((appt) => {
                  const status = statusColors[appt.status] || {
                    className: "bg-slate-100 text-slate-700",
                    label: appt.status,
                  };
                  return (
                    <TableRow key={appt.id}>
                      <TableCell className="pl-6 text-slate-900 font-medium">
                        {formatDate(appt.date)}
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums">
                        {formatTime12(appt.time)}
                      </TableCell>
                      <TableCell className="text-slate-900 font-medium">
                        {appt.patient_name}
                      </TableCell>
                      <TableCell className="text-slate-600">{appt.provider_name}</TableCell>
                      <TableCell className="text-slate-600">{appt.service_name}</TableCell>
                      <TableCell className="text-slate-600 tabular-nums">
                        {appt.duration_minutes} min
                      </TableCell>
                      <TableCell className="pr-6">
                        <Badge variant="secondary" className={status.className}>
                          {status.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </>
  );
}

// ---- Main Page ----

export default function AppointmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Appointments</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage today&apos;s schedule and follow up with no-shows
        </p>
      </div>

      <Tabs defaultValue="today" className="space-y-6">
        <TabsList>
          <TabsTrigger value="today" className="gap-2">
            <Users className="h-4 w-4" />
            Today
          </TabsTrigger>
          <TabsTrigger value="monthly" className="gap-2">
            <Calendar className="h-4 w-4" />
            Monthly
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-6">
          <TodayTab />
        </TabsContent>

        <TabsContent value="monthly" className="space-y-6">
          <MonthlyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
