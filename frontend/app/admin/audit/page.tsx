"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { api, AuditLog, Clinic } from "@/lib/api";

const PAGE_SIZE = 20;

const actionOptions = [
  { value: "__all__", label: "All Actions" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "create_clinic", label: "Create Clinic" },
  { value: "update_clinic", label: "Update Clinic" },
  { value: "create_user", label: "Create User" },
  { value: "update_user", label: "Update User" },
  { value: "delete_user", label: "Delete User" },
  { value: "create_appointment", label: "Create Appointment" },
  { value: "update_settings", label: "Update Settings" },
];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("__all__");
  const [clinicFilter, setClinicFilter] = useState("__all__");
  const [clinics, setClinics] = useState<Clinic[]>([]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        limit: number;
        offset: number;
        action?: string;
        clinic_id?: string;
      } = {
        limit: PAGE_SIZE,
        offset,
      };
      if (actionFilter !== "__all__") params.action = actionFilter;
      if (clinicFilter !== "__all__") params.clinic_id = clinicFilter;

      const res = await api.admin.auditLogs(params);
      setLogs(res.logs);
      setTotal(res.total);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load audit logs"
      );
    } finally {
      setLoading(false);
    }
  }, [offset, actionFilter, clinicFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    async function loadClinics() {
      try {
        const res = await api.admin.clinics();
        setClinics(res.clinics);
      } catch {
        // Non-critical, filter will just not have clinic names
      }
    }
    loadClinics();
  }, []);

  const handleFilterChange = () => {
    setOffset(0);
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 rounded-lg p-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Audit Logs</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          value={actionFilter}
          onValueChange={(val) => {
            setActionFilter(val as string);
            handleFilterChange();
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            {actionOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={clinicFilter}
          onValueChange={(val) => {
            setClinicFilter(val as string);
            handleFilterChange();
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by clinic" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Clinics</SelectItem>
            {clinics.map((clinic) => (
              <SelectItem key={clinic.id} value={clinic.id}>
                {clinic.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-slate-500"
                  >
                    No audit logs found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-slate-500 text-xs">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {log.user_id || "--"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs font-mono">
                      {log.resource_type}
                      {log.resource_id ? `:${log.resource_id.slice(0, 8)}` : ""}
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs font-mono">
                      {log.ip_address || "--"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-slate-500">
                      {log.details
                        ? JSON.stringify(log.details).slice(0, 60)
                        : "--"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Showing {offset + 1}--{Math.min(offset + PAGE_SIZE, total)} of{" "}
            {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </Button>
            <span className="text-sm text-slate-600">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
