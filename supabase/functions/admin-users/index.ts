// Admin user management — create/list/update/delete app users (admin-only)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return json({ ok: false, error: "Not authenticated" }, 401);

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (roleRow?.role !== "admin") return json({ ok: false, error: "Admin access required" }, 403);
  return { userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const gate = await requireAdmin(req);
    if (gate instanceof Response) return gate;
    const callerId = gate.userId;

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data: usersData, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) return json({ ok: false, error: error.message }, 500);
      const { data: roles } = await admin.from("user_roles").select("user_id, role");
      const roleMap = new Map((roles ?? []).map((r: { user_id: string; role: string }) => [r.user_id, r.role]));
      const users = usersData.users.map((u) => ({
        id: u.id,
        email: u.email,
        role: roleMap.get(u.id) ?? "viewer",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }));
      return json({ ok: true, users });
    }

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const role = body.role === "admin" ? "admin" : "viewer";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Invalid email" }, 400);
      if (password.length < 8) return json({ ok: false, error: "Password must be at least 8 characters" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) return json({ ok: false, error: error.message }, 400);

      const { error: roleError } = await admin
        .from("user_roles")
        .upsert({ user_id: data.user.id, role }, { onConflict: "user_id" });
      if (roleError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ ok: false, error: `Role assignment failed: ${roleError.message}` }, 500);
      }
      return json({ ok: true, user: { id: data.user.id, email, role } });
    }

    if (action === "update_role") {
      const userId = String(body.user_id ?? "");
      const role = body.role === "admin" ? "admin" : "viewer";
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);
      if (userId === callerId && role !== "admin") {
        return json({ ok: false, error: "You cannot demote your own account" }, 400);
      }
      const { error } = await admin
        .from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id" });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);
      if (password.length < 8) return json({ ok: false, error: "Password must be at least 8 characters" }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);
      if (userId === callerId) return json({ ok: false, error: "You cannot delete your own account" }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
