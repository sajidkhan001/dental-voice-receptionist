"use client";

import { useState, useEffect } from "react";
import { User, Lock, Save, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, type User as UserType } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountPage() {
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const data = await api.auth.me();
        setUser(data);
        setName(data.name || "");
        setEmail(data.email);
      } catch {
        // redirect to login handled by layout
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await api.auth.updateProfile({ name, email });
      setProfileMsg({ type: "success", text: "Profile updated successfully" });
    } catch (err: unknown) {
      setProfileMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to update profile" });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Password must be at least 8 characters" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match" });
      return;
    }

    setPasswordSaving(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setPasswordMsg({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setPasswordMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to change password" });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your profile and password</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <User className="h-4 w-4 text-teal-600" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleProfileSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <input
                  type="text"
                  value={user?.role || ""}
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-slate-400">Role is assigned by your administrator and cannot be changed</p>
              </div>

              {profileMsg && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  profileMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}>
                  {profileMsg.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {profileMsg.text}
                </div>
              )}

              <button
                type="submit"
                disabled={profileSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Profile
              </button>
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Lock className="h-4 w-4 text-teal-600" />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <p className="mt-1 text-xs text-slate-400">Minimum 8 characters</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              {passwordMsg && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  passwordMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}>
                  {passwordMsg.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {passwordMsg.text}
                </div>
              )}

              <button
                type="submit"
                disabled={passwordSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Change Password
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
