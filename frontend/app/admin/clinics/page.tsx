"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Plus, Loader2, Bot } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api, Clinic, CreateClinicData } from "@/lib/api";

export default function ClinicsPage() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<CreateClinicData>({
    name: "",
    slug: "",
    phone: "",
    address: "",
  });

  // System prompt dialog state
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptClinic, setPromptClinic] = useState<Clinic | null>(null);
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);


  const loadClinics = async () => {
    try {
      const res = await api.admin.clinics();
      setClinics(res.clinics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clinics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClinics();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setCreating(true);

    try {
      await api.admin.createClinic(form);
      setDialogOpen(false);
      setForm({ name: "", slug: "", phone: "", address: "" });
      setLoading(true);
      await loadClinics();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create clinic"
      );
    } finally {
      setCreating(false);
    }
  };

  const openPromptDialog = async (clinic: Clinic) => {
    setPromptClinic(clinic);
    setPromptText("");
    setPromptDialogOpen(true);
    try {
      const { clinic: full } = await api.admin.clinic(clinic.id);
      setPromptText((full as any).systemPromptOverrides || "");
    } catch {
      // No override yet — blank is fine
    }
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptClinic) return;
    setPromptLoading(true);
    try {
      await api.admin.updateClinic(promptClinic.id, {
        systemPromptOverrides: promptText.trim() || null,
      });
      toast.success(`System prompt updated for ${promptClinic.name}`);
      setPromptDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setPromptLoading(false);
    }
  };


  const statusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 ring-1 ring-green-600/20">
            Active
          </span>
        );
      case "onboarding":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20">
            Onboarding
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 ring-1 ring-slate-500/20">
            Inactive
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 rounded-lg p-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Clinics</h1>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button className="bg-teal-600 hover:bg-teal-700 text-white" />
            }
          >
            <Plus className="w-4 h-4" />
            Add Clinic
          </DialogTrigger>

          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Clinic</DialogTitle>
              <DialogDescription>
                Create a new clinic in the system.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="clinic-name">Clinic Name *</Label>
                <Input
                  id="clinic-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Pearl Smile Dental"
                  required
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clinic-slug">Slug *</Label>
                <Input
                  id="clinic-slug"
                  value={form.slug}
                  onChange={(e) =>
                    setForm({ ...form, slug: e.target.value })
                  }
                  placeholder="pearl-smile-dental"
                  required
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clinic-phone">Phone</Label>
                <Input
                  id="clinic-phone"
                  value={form.phone || ""}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value })
                  }
                  placeholder="+1 (555) 123-4567"
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clinic-address">Address</Label>
                <Input
                  id="clinic-address"
                  value={form.address || ""}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  placeholder="123 Main St, City, State"
                  disabled={creating}
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}

              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" disabled={creating} />}
                >
                  Cancel
                </DialogClose>
                <Button
                  type="submit"
                  disabled={creating}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Clinic"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total Calls</TableHead>
              <TableHead className="text-right">Bookings</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>AI Prompt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clinics.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                  No clinics found. Add your first clinic to get started.
                </TableCell>
              </TableRow>
            ) : (
              clinics.map((clinic) => (
                <TableRow key={clinic.id}>
                  <TableCell className="font-medium text-slate-900">
                    {clinic.name}
                  </TableCell>
                  <TableCell className="text-slate-500 font-mono text-xs">
                    {clinic.slug}
                  </TableCell>
                  <TableCell>{statusBadge(clinic.status)}</TableCell>
                  <TableCell className="text-right">
                    {(clinic.total_calls ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {(clinic.total_bookings ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {new Date(clinic.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => openPromptDialog(clinic)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-md transition-colors"
                    >
                      <Bot className="w-3 h-3" />
                      Edit Prompt
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* System Prompt Dialog */}
      {promptDialogOpen && promptClinic && (
        <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-violet-600" />
                AI System Prompt — {promptClinic.name}
              </DialogTitle>
              <DialogDescription>
                Override the auto-generated prompt for this clinic. Leave blank to use the default prompt
                built from the clinic's name, hours, providers, and services.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSavePrompt} className="space-y-4 pt-2">
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="You are the AI receptionist for [Clinic Name]..."
                rows={14}
                className="font-mono text-xs resize-y"
              />
              <p className="text-xs text-slate-400">
                {promptText.length > 0
                  ? `${promptText.length} characters — custom prompt active`
                  : "Empty — default auto-built prompt will be used"}
              </p>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" type="button" disabled={promptLoading} />}>
                  Cancel
                </DialogClose>
                <Button
                  type="submit"
                  disabled={promptLoading}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {promptLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  ) : (
                    "Save Prompt"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
