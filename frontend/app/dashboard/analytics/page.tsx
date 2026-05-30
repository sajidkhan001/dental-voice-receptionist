"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, TrendingUp, AlertCircle } from "lucide-react";
import { api, type Analytics } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const TEAL = "#0D9488";
const TEAL_LIGHT = "#99F6E4";

const timeRanges = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const intentBarColors: Record<string, string> = {
  booking: "#059669",
  question: "#2563EB",
  emergency: "#DC2626",
  cancel: "#EA580C",
  reschedule: "#CA8A04",
};

function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.dashboard.analytics(days);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">Call volume and intent distribution over time</p>
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {timeRanges.map((range) => (
          <button
            key={range.value}
            onClick={() => setDays(range.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              days === range.value
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm font-medium text-red-800">Unable to load analytics</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && !error && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-80 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
        </div>
      )}

      {/* Charts and Stats */}
      {!loading && !error && data && (
        <>
          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-100">
                  <TrendingUp className="h-6 w-6 text-teal-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900 tabular-nums">
                    {data.booking_rate.toFixed(1)}%
                  </p>
                  <p className="text-sm text-slate-600">Booking Rate</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-100">
                  <AlertCircle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-slate-900 tabular-nums">
                    {data.escalation_rate.toFixed(1)}%
                  </p>
                  <p className="text-sm text-slate-600">Escalation Rate</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Calls Over Time */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-base font-semibold text-slate-900">
                  Calls Over Time
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {data.calls_by_day.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm font-medium text-slate-600">No calls in this period</p>
                    <p className="text-xs text-slate-400">Try selecting a longer date range</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={data.calls_by_day.map((d) => ({
                        ...d,
                        label: formatDateShort(d.date),
                      }))}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: "#64748B" }}
                        tickLine={false}
                        axisLine={{ stroke: "#E2E8F0" }}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: "#64748B" }}
                        tickLine={false}
                        axisLine={{ stroke: "#E2E8F0" }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #E2E8F0",
                          borderRadius: "8px",
                          fontSize: "13px",
                          boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        }}
                        labelStyle={{ fontWeight: 600, color: "#1E293B" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        name="Calls"
                        stroke={TEAL}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: TEAL, strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: TEAL, stroke: TEAL_LIGHT, strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Intent Distribution */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-base font-semibold text-slate-900">
                  Intent Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {data.intents.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
                    <p className="text-sm font-medium text-slate-600">No intent data in this period</p>
                    <p className="text-xs text-slate-400">Try selecting a longer date range</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={data.intents.map((d) => ({
                        ...d,
                        label: d.intent.charAt(0).toUpperCase() + d.intent.slice(1),
                      }))}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: "#64748B" }}
                        tickLine={false}
                        axisLine={{ stroke: "#E2E8F0" }}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: "#64748B" }}
                        tickLine={false}
                        axisLine={{ stroke: "#E2E8F0" }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #E2E8F0",
                          borderRadius: "8px",
                          fontSize: "13px",
                          boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        }}
                        labelStyle={{ fontWeight: 600, color: "#1E293B" }}
                      />
                      <Bar dataKey="count" name="Calls" radius={[6, 6, 0, 0]}>
                        {data.intents.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={intentBarColors[entry.intent] || TEAL}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
