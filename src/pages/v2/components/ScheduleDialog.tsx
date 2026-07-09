import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useSaveSchedule, useSavedReports, type ReportSchedule,
} from "@/hooks/useReports";

const FREQUENCIES = ["Daily", "Weekly", "Monthly"];
const FORMATS = ["PDF", "CSV"];

const parseEmails = (s: string) =>
  s.split(/[,\s;]+/).map(e => e.trim()).filter(Boolean);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit an existing schedule. */
  schedule?: (ReportSchedule & { savedReportId?: string | null; recipients?: string[] }) | null;
  /** Pre-link to a saved report (e.g. from the Saved tab row action). */
  defaultSavedReportId?: string | null;
  defaultName?: string;
  storeId?: string | null;
};

export default function ScheduleDialog({
  open, onOpenChange, schedule, defaultSavedReportId, defaultName, storeId,
}: Props) {
  const save = useSaveSchedule();
  const savedReports = useSavedReports();

  const [name, setName] = useState("");
  const [savedReportId, setSavedReportId] = useState<string>("none");
  const [recipients, setRecipients] = useState("");
  const [frequency, setFrequency] = useState("Weekly");
  const [formats, setFormats] = useState<string[]>(["PDF"]);

  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? defaultName ?? "");
    setSavedReportId(schedule?.savedReportId ?? defaultSavedReportId ?? "none");
    setRecipients((schedule?.recipients ?? []).join(", "));
    setFrequency(schedule?.frequencyLabel ?? "Weekly");
    setFormats(schedule?.formats ?? ["PDF"]);
  }, [open, schedule, defaultSavedReportId, defaultName]);

  const isEdit = !!schedule?.id;
  const toggleFormat = (f: string) =>
    setFormats(s => (s.includes(f) ? s.filter(x => x !== f) : [...s, f]));

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Give the schedule a name."); return; }
    const emails = parseEmails(recipients);
    if (emails.length === 0) { toast.error("Add at least one recipient email."); return; }
    const bad = emails.filter(e => !EMAIL_RE.test(e));
    if (bad.length) { toast.error(`Invalid email: ${bad[0]}`); return; }
    if (formats.length === 0) { toast.error("Pick at least one format."); return; }

    try {
      await save.mutateAsync({
        id: schedule?.id,
        name,
        savedReportId: savedReportId === "none" ? null : savedReportId,
        recipients: emails,
        frequencyLabel: frequency,
        formats,
        storeId: storeId ?? null,
      });
      toast.success(isEdit ? "Schedule updated" : "Schedule created");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save schedule");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit schedule" : "New schedule"}</DialogTitle>
          <DialogDescription>
            Deliver a report to recipients on a recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="sched-name" className="text-xs">Name</Label>
            <Input id="sched-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Monday sales digest" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Report</Label>
            <Select value={savedReportId} onValueChange={setSavedReportId}>
              <SelectTrigger><SelectValue placeholder="Select a saved report" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(savedReports.data ?? []).map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sched-recipients" className="text-xs">Recipients</Label>
            <Input id="sched-recipients" value={recipients} onChange={e => setRecipients(e.target.value)}
              placeholder="a@store.com, b@store.com" />
            <p className="text-[10px] text-muted-foreground">Comma or space separated.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Formats</Label>
              <div className="flex gap-1.5">
                {FORMATS.map(f => (
                  <button key={f} type="button" onClick={() => toggleFormat(f)}
                    className={cn("flex-1 h-9 rounded-md border text-xs font-medium transition-colors",
                      formats.includes(f)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted text-muted-foreground")}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground border-t pt-3">
            Note: this saves the schedule. Automated email delivery requires the
            reports-delivery edge function + cron (not yet enabled).
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending} className="gap-1.5">
            {save.isPending && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? "Save changes" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
