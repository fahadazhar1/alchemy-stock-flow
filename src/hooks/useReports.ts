import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedReport {
  id: string;
  name: string;
  templateName: string | null;
  ownerName: string;
  updatedAt: string;
  scheduleLabel: string | null;
}

export interface ReportSchedule {
  id: string;
  name: string;
  recipientsLabel: string;
  frequencyLabel: string;
  nextRunLabel: string;
  isActive: boolean;
  formats: string[];
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

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useSavedReports(search = "") {
  return useQuery({
    queryKey: ["saved-reports", search],
    queryFn: async () => {
      let q = (supabase as any)
        .from("saved_reports")
        .select("id, name, template_name, owner_name, updated_at, report_schedules(frequency_label)")
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
        .select("id, name, recipients, frequency_label, next_run_at, is_active, formats")
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
          recipientsLabel,
          frequencyLabel: r.frequency_label ?? "—",
          nextRunLabel: fmtNextRun(r.next_run_at),
          isActive: r.is_active ?? true,
          formats: (r.formats ?? ["PDF"]) as string[],
        };
      });
    },
  });
}
