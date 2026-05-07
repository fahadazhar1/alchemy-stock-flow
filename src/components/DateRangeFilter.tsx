import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

interface DateRangeFilterProps {
  selectedDates: Date[];
  selectedMonths: number[]; // 0-11
  selectedYears: number[];
  onDatesChange: (d: Date[]) => void;
  onMonthsChange: (m: number[]) => void;
  onYearsChange: (y: number[]) => void;
  onReset: () => void;
}

export function DateRangeFilter({ selectedDates, selectedMonths, selectedYears, onDatesChange, onMonthsChange, onYearsChange, onReset }: DateRangeFilterProps) {
  const [tab, setTab] = useState<"date" | "month" | "year">("date");
  const hasFilters = selectedDates.length > 0 || selectedMonths.length > 0 || selectedYears.length > 0;

  const toggleMonth = (m: number) => {
    onMonthsChange(selectedMonths.includes(m) ? selectedMonths.filter(x => x !== m) : [...selectedMonths, m]);
  };
  const toggleYear = (y: number) => {
    onYearsChange(selectedYears.includes(y) ? selectedYears.filter(x => x !== y) : [...selectedYears, y]);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-8 text-xs gap-1", hasFilters && "border-primary text-primary")}>
            <CalendarIcon className="h-3 w-3" />
            Date Filter
            {hasFilters && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{selectedDates.length + selectedMonths.length + selectedYears.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex gap-1 mb-2">
            {(["date", "month", "year"] as const).map(t => (
              <Button key={t} variant={tab === t ? "default" : "ghost"} size="sm" className="h-7 text-xs capitalize" onClick={() => setTab(t)}>{t}</Button>
            ))}
          </div>
          {tab === "date" && (
            <Calendar
              mode="multiple"
              selected={selectedDates}
              onSelect={(days) => onDatesChange(days || [])}
              className="p-2 pointer-events-auto"
            />
          )}
          {tab === "month" && (
            <div className="grid grid-cols-3 gap-1.5 w-[240px]">
              {MONTHS.map((m, i) => (
                <Button key={m} variant={selectedMonths.includes(i) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => toggleMonth(i)}>{m}</Button>
              ))}
            </div>
          )}
          {tab === "year" && (
            <div className="grid grid-cols-3 gap-1.5 w-[200px]">
              {YEARS.map(y => (
                <Button key={y} variant={selectedYears.includes(y) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => toggleYear(y)}>{y}</Button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onReset}>
          <X className="h-3 w-3" /> Reset
        </Button>
      )}
    </div>
  );
}

/** Build a Supabase date filter condition from selections */
export function buildDateFilterConditions(dates: Date[], months: number[], years: number[]): { startDates: string[], monthYears: string[], years: number[] } {
  return {
    startDates: dates.map(d => format(d, "yyyy-MM-dd")),
    monthYears: months.map(m => `${new Date().getFullYear()}-${String(m + 1).padStart(2, '0')}`),
    years,
  };
}

/** Check if a date string matches the filter criteria */
export function matchesDateFilter(dateStr: string | null, dates: Date[], months: number[], years: number[]): boolean {
  if (!dateStr) return false;
  if (dates.length === 0 && months.length === 0 && years.length === 0) return true;
  const d = new Date(dateStr);
  if (dates.length > 0 && dates.some(sd => format(sd, "yyyy-MM-dd") === format(d, "yyyy-MM-dd"))) return true;
  if (months.length > 0 && months.includes(d.getMonth()) && (years.length === 0 || years.includes(d.getFullYear()))) return true;
  if (years.length > 0 && years.includes(d.getFullYear()) && months.length === 0) return true;
  return false;
}
