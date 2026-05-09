export type DateRangeKey = "Today" | "WTD" | "MTD" | "QTD" | "YTD" | "Custom";

export interface DateBounds {
  startISO: string;
  endISO: string;
  days: number;
  label: string;
  prevStartISO: string;
  prevEndISO: string;
}

function midnight(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function getDateBounds(range: DateRangeKey): DateBounds {
  const now = new Date();
  const today = midnight(now);
  const DAY = 86_400_000;
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });

  let start: Date;
  let prevStart: Date;
  let prevEnd: Date;

  switch (range) {
    case "Today": {
      start = today;
      prevStart = new Date(today.getTime() - DAY);
      prevEnd = new Date(today.getTime() - 1);
      break;
    }
    case "WTD": {
      const dow = today.getDay(); // 0=Sun
      const offset = dow === 0 ? 6 : dow - 1;
      start = new Date(today.getTime() - offset * DAY);
      prevStart = new Date(start.getTime() - 7 * DAY);
      prevEnd = new Date(today.getTime() - 7 * DAY + DAY - 1);
      break;
    }
        case "MTD": {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 23, 59, 59, 999); // ✅ same day last month
      break;
    }
    case "QTD": {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      prevStart = new Date(now.getFullYear(), q * 3 - 3, 1);
      const elapsed = now.getDate() - 1; // days elapsed since quarter start
      const prevQStart = new Date(now.getFullYear(), q * 3 - 3, 1);
      prevEnd = new Date(prevQStart.getTime() + elapsed * DAY + DAY - 1); // ✅ same elapsed days last quarter
      break;
    }
    case "YTD": {
      start = new Date(now.getFullYear(), 0, 1);
      prevStart = new Date(now.getFullYear() - 1, 0, 1);
      prevEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59, 999); // ✅ same calendar date last year
      break;
    }
    default: {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 23, 59, 59, 999);
    }
  }

  const days = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / DAY));
  const label =
    range === "Today"
      ? fmt(today)
      : `${fmt(start)} – ${fmt(now)}`;

  return {
    startISO: start.toISOString(),
    endISO: now.toISOString(),
    days,
    label,
    prevStartISO: prevStart.toISOString(),
    prevEndISO: prevEnd.toISOString(),
  };
}

export function comparePeriodLabel(range: DateRangeKey): string {
  const map: Record<DateRangeKey, string> = {
    Today: "vs yesterday",
    WTD: "vs last week",
    MTD: "vs last month",
    QTD: "vs last quarter",
    YTD: "vs last year",
    Custom: "vs prev period",
  };
  return map[range];
}

export function getCustomDateBounds(from: Date, to: Date): DateBounds {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  const DAY = 86_400_000;
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY));
  const prevEnd = new Date(from.getTime() - 1);
  const prevStart = new Date(from.getTime() - days * DAY);
  return {
    startISO:    from.toISOString(),
    endISO:      to.toISOString(),
    days,
    label:       `${fmt(from)} – ${fmt(to)}`,
    prevStartISO: prevStart.toISOString(),
    prevEndISO:   prevEnd.toISOString(),
  };
}