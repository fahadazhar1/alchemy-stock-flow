import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedReport {
  id: string;
  name: string;
  templateName: string | null;
  ownerName: string;
  updatedAt: string;
  scheduleLabel: string | null;
  config: Record<string, unknown>;
  storeId: string | null;
}

export interface SaveReportInput {
  id?: string;
  name: string;
  templateName?: string | null;
  ownerName?: string;
  config?: Record<string, unknown>;
  storeId?: string | null;
}

export interface SaveScheduleInput {
  id?: string;
  name: string;
  savedReportId?: string | null;
  recipients: string[];
  frequencyLabel: string;
  formats: string[];
  storeId?: string | null;
}

export interface ReportSchedule {
  id: string;
  name: string;
  recipients: string[];
  recipientsLabel: string;
  frequencyLabel: string;
  nextRunLabel: string;
  isActive: boolean;
  formats: string[];
  savedReportId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtNextRun(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// Frequency label → next run timestamp. Daily = tomorrow 08:00; Weekly = next
// Monday 08:00; Monthly = 1st of next month 08:00. Local time.
export function computeNextRun(frequencyLabel: string): string {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  const f = frequencyLabel.toLowerCase();
  if (f.includes("month")) {
    d.setMonth(d.getMonth() + 1, 1);
  } else if (f.includes("week")) {
    const day = d.getDay(); // 0=Sun
    const add = ((8 - day) % 7) || 7; // days until next Monday
    d.setDate(d.getDate() + add);
  } else {
    d.setDate(d.getDate() + 1); // daily
  }
  return d.toISOString();
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useSavedReports(search = "") {
  return useQuery({
    queryKey: ["saved-reports", search],
    queryFn: async () => {
      let q = (supabase as any)
        .from("saved_reports")
        .select("id, name, template_name, owner_name, updated_at, config, store_id, report_schedules(frequency_label)")
        .order("updated_at", { ascending: false });

      if (search.trim()) {
        q = q.ilike("name", `%${search.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      return ((data ?? []) as any[]).map((r: any): SavedReport => {
        const schedules = Array.isArray(r.report_schedules) ? r.report_schedules : [];
        return {
          id: r.id,
          name: r.name,
          templateName: r.template_name ?? null,
          ownerName: r.owner_name ?? "—",
          updatedAt: r.updated_at ? fmtDate(r.updated_at) : "—",
          scheduleLabel: schedules[0]?.frequency_label ?? null,
          config: (r.config ?? {}) as Record<string, unknown>,
          storeId: r.store_id ?? null,
        };
      });
    },
  });
}

export function useReportSchedules() {
  return useQuery({
    queryKey: ["report-schedules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("report_schedules")
        .select("id, name, recipients, frequency_label, next_run_at, is_active, formats, saved_report_id")
        .order("next_run_at", { ascending: true });
      if (error) throw error;

      return ((data ?? []) as any[]).map((r: any): ReportSchedule => {
        const recipients = (r.recipients ?? []) as string[];
        const recipientsLabel =
          recipients.length === 0 ? "—"
          : recipients.length === 1 ? recipients[0]
          : `${recipients[0]}, +${recipients.length - 1}`;
        return {
          id: r.id,
          name: r.name,
          recipients,
          recipientsLabel,
          frequencyLabel: r.frequency_label ?? "—",
          nextRunLabel: fmtNextRun(r.next_run_at),
          isActive: r.is_active ?? true,
          formats: (r.formats ?? ["PDF"]) as string[],
          savedReportId: r.saved_report_id ?? null,
        };
      });
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveReportInput) => {
      const row = {
        name: input.name.trim(),
        template_name: input.templateName ?? null,
        owner_name: input.ownerName ?? "You",
        config: input.config ?? {},
        store_id: input.storeId ?? null,
        updated_at: new Date().toISOString(),
      };
      const q = input.id
        ? (supabase as any).from("saved_reports").update(row).eq("id", input.id).select("id").single()
        : (supabase as any).from("saved_reports").insert(row).select("id").single();
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved-reports"] }); },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("saved_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-reports"] });
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
    },
  });
}

export function useSaveSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveScheduleInput) => {
      const row = {
        name: input.name.trim(),
        saved_report_id: input.savedReportId ?? null,
        recipients: input.recipients,
        frequency_label: input.frequencyLabel,
        formats: input.formats.length ? input.formats : ["PDF"],
        next_run_at: computeNextRun(input.frequencyLabel),
        store_id: input.storeId ?? null,
        updated_at: new Date().toISOString(),
      };
      const q = input.id
        ? (supabase as any).from("report_schedules").update(row).eq("id", input.id).select("id").single()
        : (supabase as any).from("report_schedules").insert(row).select("id").single();
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
      qc.invalidateQueries({ queryKey: ["saved-reports"] });
    },
  });
}

export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await (supabase as any)
        .from("report_schedules")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-schedules"] }); },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("report_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
      qc.invalidateQueries({ queryKey: ["saved-reports"] });
    },
  });
}
