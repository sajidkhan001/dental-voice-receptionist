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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { api, AdminUser, CreateUserData } from "@/lib/api";

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<CreateUserData>({
    email: "",
    password: "",
    name: "",
    role: "clinic_staff",
    clinicId: "",
  });

  const loadUsers = async () => {
    try {
      const res = await api.admin.users();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setCreating(true);

    try {
      const payload: CreateUserData = {
        email: form.email,
        password: form.password,
        name: form.name || undefined,
        role: form.role,
        clinicId: form.clinicId || undefined,
      };
      await api.admin.createUser(payload);
      setDialogOpen(false);
      setForm({
        email: "",
        password: "",
        name: "",
        role: "clinic_staff",
        clinicId: "",
      });
      setLoading(true);
      await loadUsers();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create user"
      );
    } finally {
      setCreating(false);
    }
  };

  const roleBadge = (role: string) => {
    switch (role) {
      case "superadmin":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-600/20">
            Super Admin
          </span>
        );
      case "clinic_admin":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-600/20">
            Clinic Admin
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 ring-1 ring-slate-500/20">
            Staff
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
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button className="bg-teal-600 hover:bg-teal-700 text-white" />
            }
          >
            <Plus className="w-4 h-4" />
            Add User
          </DialogTrigger>

          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="user-email">Email *</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  placeholder="user@clinic.com"
                  required
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-password">Password *</Label>
                <Input
                  id="user-password"
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder="Minimum 8 characters"
                  required
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-name">Name</Label>
                <Input
                  id="user-name"
                  value={form.name || ""}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Full name"
                  disabled={creating}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select
                  value={form.role}
                  onValueChange={(val) =>
                    setForm({ ...form, role: val as string })
                  }
                  disabled={creating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="superadmin">Super Admin</SelectItem>
                    <SelectItem value="clinic_admin">Clinic Admin</SelectItem>
                    <SelectItem value="clinic_staff">Clinic Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-clinic">Clinic ID (optional)</Label>
                <Input
                  id="user-clinic"
                  value={form.clinicId || ""}
                  onChange={(e) =>
                    setForm({ ...form, clinicId: e.target.value })
                  }
                  placeholder="Clinic UUID"
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
                    "Create User"
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
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Clinic</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                  No users found. Add your first user to get started.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-slate-900">
                    {user.email}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {user.name || "--"}
                  </TableCell>
                  <TableCell>{roleBadge(user.role)}</TableCell>
                  <TableCell className="text-slate-500">
                    {user.clinic_name || "--"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        user.is_active ? "bg-green-500" : "bg-red-400"
                      }`}
                      title={user.is_active ? "Active" : "Inactive"}
                    />
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
