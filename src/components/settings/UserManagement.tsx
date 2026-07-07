import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, UserPlus, KeyRound, Trash2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface AppUser {
  id: string;
  email: string;
  role: "admin" | "viewer";
  created_at: string;
  last_sign_in_at: string | null;
}

async function callAdminUsers(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: payload });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error || error.message);
  }
  if (data && (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { error?: string }).error || "Request failed");
  }
  return data;
}

export function UserManagement() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const r = await callAdminUsers({ action: "list" }) as { users: AppUser[] };
      return r.users;
    },
    staleTime: 300_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  // ---- Create form ----
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    setPassword(Array.from(bytes, b => chars[b % chars.length]).join(""));
  };

  const handleCreate = async () => {
    if (!email.trim()) { toast.error("Enter an email"); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setBusy(true);
    try {
      await callAdminUsers({ action: "create", email, password, role });
      toast.success(`${role === "admin" ? "Admin" : "Viewer"} account created for ${email.trim()}`);
      setEmail(""); setPassword(""); setRole("viewer");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally { setBusy(false); }
  };

  // ---- Row actions ----
  const handleRoleChange = async (u: AppUser, newRole: string) => {
    if (newRole === u.role) return;
    setBusy(true);
    try {
      await callAdminUsers({ action: "update_role", user_id: u.id, role: newRole });
      toast.success(`${u.email} is now ${newRole}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Role update failed");
    } finally { setBusy(false); }
  };

  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const handleReset = async () => {
    if (!resetTarget) return;
    if (resetPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setBusy(true);
    try {
      await callAdminUsers({ action: "reset_password", user_id: resetTarget.id, password: resetPassword });
      toast.success(`Password updated for ${resetTarget.email}`);
      setResetTarget(null); setResetPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Password reset failed");
    } finally { setBusy(false); }
  };

  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await callAdminUsers({ action: "delete", user_id: deleteTarget.id });
      toast.success(`${deleteTarget.email} deleted`);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> User Management
        </CardTitle>
        <p className="text-xs text-muted-foreground">Create and manage dashboard accounts. Admins can edit everything; viewers get read-only access to the pages you enable below.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading users…</p>}

        {users?.map(u => (
          <div key={u.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {u.email}
                {u.id === currentUser?.id && <span className="text-muted-foreground font-normal"> (you)</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {u.last_sign_in_at ? `Last login ${format(new Date(u.last_sign_in_at), "PP")}` : "Never logged in"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {u.id === currentUser?.id ? (
                <Badge variant="default">admin</Badge>
              ) : (
                <>
                  <Select value={u.role} onValueChange={v => handleRoleChange(u, v)} disabled={busy}>
                    <SelectTrigger className="h-8 w-[92px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="viewer">viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Reset password" disabled={busy}
                    onClick={() => { setResetPassword(""); setResetTarget(u); }}>
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete user" disabled={busy}
                    onClick={() => setDeleteTarget(u)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        <Separator />

        <div className="space-y-3">
          <Label className="flex items-center gap-1.5"><UserPlus className="h-4 w-4" /> Add User</Label>
          <Input type="email" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          <div className="flex gap-2">
            <Input type="text" placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)} />
            <Button variant="outline" size="icon" className="shrink-0" title="Generate password" onClick={generatePassword}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Select value={role} onValueChange={v => setRole(v as "admin" | "viewer")}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreate} disabled={busy} className="flex-1">
              {busy ? "Working…" : "Create Account"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Share the password with the user securely — it won't be shown again.</p>
        </div>
      </CardContent>

      <Dialog open={!!resetTarget} onOpenChange={open => { if (!open) setResetTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Reset password — {resetTarget?.email}</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input type="text" placeholder="New password (min 8 chars)" value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
            <Button variant="outline" size="icon" className="shrink-0" title="Generate password" onClick={() => {
              const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
              const bytes = crypto.getRandomValues(new Uint8Array(14));
              setResetPassword(Array.from(bytes, b => chars[b % chars.length]).join(""));
            }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={handleReset} disabled={busy}>Update Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account and its access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
