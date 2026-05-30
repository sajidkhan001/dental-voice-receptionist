"use client";

import { useState, useEffect } from "react";
import { FileText, Check, Clock, Eye, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface IntakeForm {
  id: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string;
  patient_dob: string | null;
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

const statusConfig: Record<string, { className: string; label: string }> = {
  pending: { className: "bg-yellow-100 text-yellow-700", label: "Pending" },
  submitted: { className: "bg-blue-100 text-blue-700", label: "Submitted" },
  reviewed: { className: "bg-green-100 text-green-700", label: "Reviewed" },
  archived: { className: "bg-gray-100 text-gray-600", label: "Archived" },
};

export default function IntakeFormsDashboard() {
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedForm, setSelectedForm] = useState<IntakeForm | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function fetchForms(status?: string) {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`${API_BASE}/api/dashboard/intake-forms?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load intake forms");
      const json = await res.json();
      setForms(json.forms);
      setTotal(json.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchForms(statusFilter); }, [statusFilter]);

  async function viewDetail(form: IntakeForm) {
    setSelectedForm(form);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/intake-forms/${form.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load form");
      const json = await res.json();
      setDetailData(json);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function markReviewed(formId: string) {
    try {
      await fetch(`${API_BASE}/api/dashboard/intake-forms/${formId}/review`, {
        method: "POST", credentials: "include",
      });
      fetchForms(statusFilter);
      setSelectedForm(null);
    } catch { /* ignore */ }
  }

  const submitted = forms.filter((f) => f.status === "submitted").length;
  const reviewed = forms.filter((f) => f.status === "reviewed").length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patient Intake Forms</h1>
        <p className="text-sm text-gray-500 mt-1">Review submitted patient intake forms before appointments</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Forms</p>
              <p className="text-2xl font-bold text-gray-900">{total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Needs Review</p>
              <p className="text-2xl font-bold text-gray-900">{submitted}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Check className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Reviewed</p>
              <p className="text-2xl font-bold text-gray-900">{reviewed}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {[{ value: "", label: "All" }, { value: "submitted", label: "Needs Review" }, { value: "reviewed", label: "Reviewed" }].map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === f.value ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border">
        {loading ? (
          <div className="p-12 text-center text-gray-400 animate-pulse">Loading forms...</div>
        ) : forms.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-600">No intake forms yet</h3>
            <p className="text-sm text-gray-400 mt-1">Intake form links are sent to patients after booking.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Appointment</TableHead>
                <TableHead>Insurance</TableHead>
                <TableHead>Pain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => {
                const config = statusConfig[form.status] || statusConfig.pending;
                return (
                  <TableRow key={form.id} className="cursor-pointer hover:bg-gray-50" onClick={() => viewDetail(form)}>
                    <TableCell>
                      <div className="font-medium">{form.patient_name}</div>
                      <div className="text-xs text-gray-400">{form.patient_phone}</div>
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {form.appointment_date ? (
                        <>
                          {new Date(form.appointment_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {form.start_time && ` at ${form.start_time}`}
                          {form.provider_name && <div className="text-xs text-gray-400">{form.provider_name}</div>}
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">{form.insurance_carrier || "None"}</TableCell>
                    <TableCell>
                      {form.pain_level != null && form.pain_level > 0 ? (
                        <span className={`text-sm font-medium ${form.pain_level >= 7 ? "text-red-600" : form.pain_level >= 4 ? "text-yellow-600" : "text-green-600"}`}>
                          {form.pain_level}/10
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell><Badge className={config.className}>{config.label}</Badge></TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {form.submitted_at ? new Date(form.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                    </TableCell>
                    <TableCell>
                      <button className="p-2 text-gray-400 hover:text-blue-600 transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Detail Modal */}
      {selectedForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedForm(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedForm.patient_name}</h2>
                <p className="text-sm text-gray-500">Intake Form</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedForm.status === "submitted" && (
                  <button onClick={() => markReviewed(selectedForm.id)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                    Mark Reviewed
                  </button>
                )}
                <button onClick={() => setSelectedForm(null)} className="p-2 text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-6">
              {detailLoading ? (
                <div className="text-center text-gray-400 py-12 animate-pulse">Loading form details...</div>
              ) : detailData ? (
                <div className="space-y-6">
                  <Section title="Personal Information">
                    <Field label="Name" value={detailData.patient_name} />
                    <Field label="DOB" value={detailData.patient_dob} />
                    <Field label="Phone" value={detailData.patient_phone} />
                    <Field label="Email" value={detailData.patient_email} />
                    <Field label="Address" value={detailData.patient_address} />
                    <Field label="Emergency Contact" value={detailData.emergency_contact_name ? `${detailData.emergency_contact_name} (${detailData.emergency_contact_relation}) — ${detailData.emergency_contact_phone}` : null} />
                  </Section>
                  <Section title="Medical History">
                    <Field label="Conditions" value={detailData.medical_history?.conditions?.join(", ")} />
                    <Field label="Medications" value={detailData.current_medications} />
                    <Field label="Allergies" value={detailData.allergies} />
                  </Section>
                  <Section title="Dental History">
                    <Field label="Last Visit" value={detailData.last_dental_visit} />
                    <Field label="Reason" value={detailData.reason_for_visit} />
                    <Field label="Pain Level" value={detailData.pain_level != null ? `${detailData.pain_level}/10` : null} />
                    <Field label="Dental Anxiety" value={detailData.dental_history?.dentalAnxiety ? "Yes" : null} />
                    <Field label="Gum Bleeding" value={detailData.dental_history?.gumBleeding ? "Yes" : null} />
                    <Field label="Jaw Pain" value={detailData.dental_history?.jawPain ? "Yes" : null} />
                    <Field label="Grinds Teeth" value={detailData.dental_history?.grindTeeth ? "Yes" : null} />
                  </Section>
                  <Section title="Insurance">
                    <Field label="Carrier" value={detailData.insurance_carrier} />
                    <Field label="Member ID" value={detailData.insurance_member_id} />
                    <Field label="Group #" value={detailData.insurance_group_number} />
                  </Section>
                  {detailData.signature_data && (
                    <Section title="Signature">
                      <img src={detailData.signature_data} alt="Patient signature" className="border rounded-lg max-w-xs" />
                    </Section>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">Failed to load form details</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}
