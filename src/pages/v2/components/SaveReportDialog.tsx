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
import { useSaveReport, type SavedReport } from "@/hooks/useReports";

// Labels here slugify (lowercase, spaces→dashes) to the ReportKey values used by
// Reports.tsx's TEMPLATE_REPORT_MAP, so a saved report runs the right panel.
export const REPORT_TEMPLATES = [
  "Sales Overview",
  "Top Products",
  "Inventory Health",
  "Fulfillment",
  "Collection Performance",
  "Custom",
] as const;

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, dialog edits this report. */
  report?: SavedReport | null;
  /** Defaults for a fresh save (e.g. from the custom builder). */
  defaultTemplateName?: string;
  defaultConfig?: Record<string, unknown>;
  storeId?: string | null;
  onSaved?: (id: string) => void;
};

export default function SaveReportDialog({
  open, onOpenChange, report, defaultTemplateName, defaultConfig, storeId, onSaved,
}: Props) {
  const save = useSaveReport();
  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState<string>("Custom");

  useEffect(() => {
    if (!open) return;
    setName(report?.name ?? "");
    setTemplateName(report?.templateName ?? defaultTemplateName ?? "Custom");
  }, [open, report, defaultTemplateName]);

  const isEdit = !!report?.id;

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Give the report a name."); return; }
    try {
      const res = await save.mutateAsync({
        id: report?.id,
        name,
        templateName,
        config: report?.config ?? defaultConfig ?? {},
        storeId: report?.storeId ?? storeId ?? null,
      });
      toast.success(isEdit ? "Report updated" : "Report saved");
      onOpenChange(false);
      onSaved?.(res?.id);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save report");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit report" : "Save report"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the report name or type." : "Save this configuration to your library to re-run later."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="report-name" className="text-xs">Name</Label>
            <Input id="report-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Weekly sales by channel" autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleSave(); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={templateName} onValueChange={setTemplateName}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORT_TEMPLATES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending} className="gap-1.5">
            {save.isPending && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? "Save changes" : "Save report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
