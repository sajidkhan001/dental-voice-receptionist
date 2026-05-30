"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Phone, ChevronDown, ChevronRight, AlertTriangle, Play } from "lucide-react";
import { api, type CallLog } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 20;

const intentOptions = [
  { value: "", label: "All Intents" },
  { value: "booking", label: "Booking" },
  { value: "reschedule", label: "Reschedule" },
  { value: "cancel", label: "Cancel" },
  { value: "question", label: "Question" },
  { value: "emergency", label: "Emergency" },
];

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
      year: "numeric",
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

export default function CallLogsPage() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [intent, setIntent] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchCalls = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: {
        limit: number;
        offset: number;
        intent?: string;
        date_from?: string;
        date_to?: string;
      } = { limit: PAGE_SIZE, offset };
      if (intent) params.intent = intent;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const data = await api.dashboard.calls(params);
      setCalls(data.calls);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load call logs");
    } finally {
      setLoading(false);
    }
  }, [offset, intent, dateFrom, dateTo]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  // Reset to first page when filters change
  useEffect(() => {
    setOffset(0);
  }, [intent, dateFrom, dateTo]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Call Logs</h1>
        <p className="text-sm text-slate-500 mt-1">Browse, search, and review every patient call</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="intent-filter" className="text-xs font-medium text-slate-600">
            Intent
          </label>
          <select
            id="intent-filter"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          >
            {intentOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="date-from" className="text-xs font-medium text-slate-600">
            From
          </label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="date-to" className="text-xs font-medium text-slate-600">
            To
          </label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        {(intent || dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIntent("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-slate-500"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm font-medium text-red-800">Unable to load call logs</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <button
            onClick={fetchCalls}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && !error && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-200" />
          ))}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {calls.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Phone className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700">No calls found</p>
              <p className="mt-1 text-sm text-slate-500">
                {intent || dateFrom || dateTo
                  ? "Try adjusting your filters"
                  : "Calls will appear here once they are recorded"}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6 w-8" />
                    <TableHead>Time</TableHead>
                    <TableHead>Caller</TableHead>
                    <TableHead>Call ID</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Crisis</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead className="pr-6">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((call) => {
                    const isExpanded = expandedId === call.id;
                    const intentStyle = intentColors[call.intent] || {
                      className: "bg-slate-100 text-slate-700",
                      label: call.intent,
                    };
                    return (
                      <React.Fragment key={call.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : call.id)}
                        >
                          <TableCell className="pl-6 w-8">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )}
                          </TableCell>
                          <TableCell className="text-slate-600">
                            {formatTime(call.created_at)}
                          </TableCell>
                          <TableCell className="font-medium text-slate-900">
                            {formatPhone(call.caller_phone)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {call.call_id.slice(0, 12)}...
                          </TableCell>
                          <TableCell>
                            <Badge className={intentStyle.className} variant="secondary">
                              {intentStyle.label}
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
                              <Badge
                                variant="secondary"
                                className="bg-emerald-100 text-emerald-700"
                              >
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
                        {isExpanded && (
                          <TableRow key={`${call.id}-detail`} className="hover:bg-transparent">
                            <TableCell colSpan={8} className="bg-slate-50 px-6 py-4">
                              <div className="space-y-3">
                                {/* Call Recording Player */}
                                {call.recording_url && (
                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                      <Play className="inline h-3 w-3 mr-1" />
                                      Call Recording
                                    </h4>
                                    <audio
                                      controls
                                      src={call.recording_url}
                                      className="w-full max-w-md h-8"
                                      preload="none"
                                    />
                                  </div>
                                )}
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                    Transcript
                                  </h4>
                                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                    {call.transcript || <span className="text-slate-400 italic">Transcript not available for this call</span>}
                                  </p>
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                    Agent Response
                                  </h4>
                                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                    {call.agent_response || <span className="text-slate-400 italic">Response data not available for this call</span>}
                                  </p>
                                </div>
                                <div className="flex gap-4 text-xs text-slate-500">
                                  <span>
                                    <strong>Full Call ID:</strong> {call.call_id}
                                  </span>
                                  <span>
                                    <strong>Record ID:</strong> {call.id}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
                <p className="text-sm text-slate-600">
                  Showing <span className="font-medium">{rangeStart}</span> -{" "}
                  <span className="font-medium">{rangeEnd}</span> of{" "}
                  <span className="font-medium">{total}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasPrev}
                    onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasNext}
                    onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
