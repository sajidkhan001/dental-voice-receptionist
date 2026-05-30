"use client";

import { useState, useEffect } from "react";
import { Star, Send, MousePointerClick, MessageSquare, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ReviewStats {
  reviews: ReviewRequest[];
  total: number;
  stats: { sent: number; clicked: number; reviewed: number };
}

interface ReviewRequest {
  id: string;
  patient_name: string;
  patient_phone: string;
  channel: string;
  status: string;
  message_body: string;
  created_at: string;
}

const statusConfig: Record<string, { className: string; label: string; icon: any }> = {
  sent: { className: "bg-blue-100 text-blue-700", label: "Sent", icon: Send },
  clicked: { className: "bg-yellow-100 text-yellow-700", label: "Clicked", icon: MousePointerClick },
  reviewed: { className: "bg-green-100 text-green-700", label: "Reviewed", icon: Star },
  failed: { className: "bg-red-100 text-red-700", label: "Failed", icon: MessageSquare },
};

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

export default function ReviewsDashboard() {
  const [data, setData] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReviews() {
      try {
        const res = await fetch(`${API_BASE}/api/dashboard/reviews`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load reviews");
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchReviews();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Reviews</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    );
  }

  const stats = data?.stats || { sent: 0, clicked: 0, reviewed: 0 };
  const clickRate = stats.sent > 0 ? Math.round((stats.clicked / stats.sent) * 100) : 0;
  const reviewRate = stats.sent > 0 ? Math.round((stats.reviewed / stats.sent) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Management</h1>
          <p className="text-sm text-gray-500 mt-1">Track post-visit review requests and patient feedback</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sent" value={stats.sent} icon={Send} color="bg-blue-500" />
        <StatCard label="Clicked" value={stats.clicked} icon={MousePointerClick} color="bg-yellow-500" />
        <StatCard label="Reviews Left" value={stats.reviewed} icon={Star} color="bg-green-500" />
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Conversion Rate</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{reviewRate}%</p>
              <p className="text-xs text-gray-400 mt-1">Click rate: {clickRate}%</p>
            </div>
            <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Review Requests Table */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900">Review Request History</h2>
          <p className="text-sm text-gray-500">{data?.total || 0} total requests</p>
        </div>

        {(!data?.reviews || data.reviews.length === 0) ? (
          <div className="p-12 text-center">
            <Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-600">No review requests yet</h3>
            <p className="text-sm text-gray-400 mt-1">Review requests are automatically sent 2 hours after completed appointments.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.reviews.map((review) => {
                const config = statusConfig[review.status] || statusConfig.sent;
                return (
                  <TableRow key={review.id}>
                    <TableCell className="font-medium">{review.patient_name}</TableCell>
                    <TableCell className="text-gray-500">{review.patient_phone}</TableCell>
                    <TableCell>
                      <Badge className={config.className}>{config.label}</Badge>
                    </TableCell>
                    <TableCell className="capitalize text-gray-500">{review.channel}</TableCell>
                    <TableCell className="text-gray-500">
                      {new Date(review.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
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
