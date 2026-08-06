export type DateRangeKey = "Today" | "WTD" | "MTD" | "QTD" | "YTD" | "Custom";

export interface DateBounds {
  startISO: string;
  endISO: string;
  days: number;
  label: string;
  prevStartISO: string;
  prevEndISO: string;
  /**
   * Stable, deterministic string suitable for use in React Query cache keys.
   * Does NOT contain `now.toISOString()` so it never changes on re-render.
   * Format: "<Range>|<startDate>|<endDate>" where dates are YYYY-MM-DD in store TZ.
   */
  cacheKey: string;
}

// ─── Timezone-aware helpers ───────────────────────────────────────────────────

/**
 * Returns the UTC instant for midnight (start of day) of `date` in `tz`.
 *
 * Strategy: get YYYY-MM-DD in `tz`, then back-solve what UTC time is 00:00:00
 * on that date in `tz`.
 */
export function tzMidnight(date: Date, tz: string): Date {
  const ymd      = date.toLocaleDateString("sv-SE", { timeZone: tz }); // "YYYY-MM-DD"
  const rough    = new Date(ymd + "T00:00:00Z");
  const roughYmd = rough.toLocaleDateString("sv-SE", { timeZone: tz });
  const roughHms = rough.toLocaleTimeString("sv-SE", { timeZone: tz, hour12: false });
  const [h, m, s] = roughHms.split(":").map(Number);
  let offsetMs = (h * 3600 + m * 60 + s) * 1000;
  if (roughYmd < ymd) offsetMs -= 86_400_000; // TZ is behind UTC — rough landed on prev day
  else if (roughYmd > ymd) offsetMs += 86_400_000;
  return new Date(rough.getTime() - offsetMs);
}

/** Returns 23:59:59.999 for the day containing `date` in `tz`. */
export function tzEndOfDay(date: Date, tz: string): Date {
  return new Date(tzMidnight(date, tz).getTime() + 86_400_000 - 1);
}

/** UTC-safe noon for a calendar date — avoids day-boundary DST issues. */
export function utcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getDateBounds(range: DateRangeKey, timezone = "Asia/Karachi"): DateBounds {
  const now = new Date();
  const DAY = 86_400_000;
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: timezone });

  // Current date components in the store's timezone
  const nowYmd = now.toLocaleDateString("sv-SE", { timeZone: timezone }); // "YYYY-MM-DD"
  const [year, month, day] = nowYmd.split("-").map(Number);

  const today    = tzMidnight(now, timezone);
  const todayDow = new Date(Date.UTC(year, month - 1, day)).getDay(); // 0=Sun, 1=Mon…

  let start: Date;
  let prevStart: Date;
  let prevEnd: Date;

  switch (range) {
    case "Today": {
      start     = today;
      prevStart = new Date(today.getTime() - DAY);
      prevEnd   = new Date(today.getTime() - 1);
      break;
    }
    case "WTD": {
      const offset = todayDow === 0 ? 6 : todayDow - 1;
      start     = new Date(today.getTime() - offset * DAY);
      prevStart = new Date(start.getTime() - 7 * DAY);
      prevEnd   = tzEndOfDay(new Date(today.getTime() - 7 * DAY + 43_200_000), timezone);
      break;
    }
    case "MTD": {
      start     = tzMidnight(utcNoon(year, month, 1), timezone);
      prevStart = tzMidnight(utcNoon(year, month - 1, 1), timezone);
      const lastOfPrev = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      prevEnd   = tzEndOfDay(utcNoon(year, month - 1, Math.min(day, lastOfPrev)), timezone);
      break;
    }
    case "QTD": {
      const q   = Math.floor((month - 1) / 3);
      start     = tzMidnight(utcNoon(year, q * 3 + 1, 1), timezone);
      prevStart = tzMidnight(utcNoon(year, q * 3 - 2, 1), timezone); // JS handles negative months
      const elapsed = Math.round((today.getTime() - start.getTime()) / DAY);
      prevEnd   = tzEndOfDay(new Date(prevStart.getTime() + elapsed * DAY + 43_200_000), timezone);
      break;
    }
    case "YTD": {
      start     = tzMidnight(utcNoon(year, 1, 1), timezone);
      prevStart = tzMidnight(utcNoon(year - 1, 1, 1), timezone);
      prevEnd   = tzEndOfDay(utcNoon(year - 1, month, day), timezone);
      break;
    }
    default: {
      start     = tzMidnight(utcNoon(year, month, 1), timezone);
      prevStart = tzMidnight(utcNoon(year, month - 1, 1), timezone);
      const lastOfPrevDef = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      prevEnd   = tzEndOfDay(utcNoon(year, month - 1, Math.min(day, lastOfPrevDef)), timezone);
    }
  }

  const days     = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / DAY));
  const label    = range === "Today" ? fmt(now) : `${fmt(start)} – ${fmt(now)}`;
  const startKey = start.toLocaleDateString("sv-SE", { timeZone: timezone }); // "YYYY-MM-DD"
  const cacheKey = `${range}|${startKey}|${nowYmd}`;

  return {
    startISO:     start.toISOString(),
    endISO:       now.toISOString(),
    days,
    label,
    prevStartISO: prevStart.toISOString(),
    prevEndISO:   prevEnd.toISOString(),
    cacheKey,
  };
}

export function comparePeriodLabel(range: DateRangeKey): string {
  const map: Record<DateRangeKey, string> = {
    Today:  "vs yesterday",
    WTD:    "vs last week",
    MTD:    "vs last month",
    QTD:    "vs last quarter",
    YTD:    "vs last year",
    Custom: "vs prev period",
  };
  return map[range];
}

export function getCustomDateBounds(from: Date, to: Date, timezone = "Asia/Karachi"): DateBounds {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: timezone });
  const DAY = 86_400_000;

  const startDay = tzMidnight(from, timezone);
  const endDay   = tzMidnight(to, timezone);
  const endOfTo  = tzEndOfDay(to, timezone);

  const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / DAY) + 1);

  // Multi-day ranges shift back by whole weeks so the comparison lands on the same
  // weekdays. A single-day pick should just compare to the immediately preceding
  // day ("yesterday"), not jump a full week back — Math.ceil(1/7) would otherwise
  // still round up to 7 days, silently comparing e.g. "3 Aug" to "27 Jul" instead
  // of "2 Aug". Found 2026-08-04 when the dashboard's single-day "vs prev period"
  // didn't match the daily Shopify-sourced report.
  const shiftMs   = days === 1 ? DAY : Math.ceil(days / 7) * 7 * DAY;
  const prevStart = tzMidnight(new Date(from.getTime() - shiftMs), timezone);
  const prevEnd   = tzEndOfDay(new Date(to.getTime() - shiftMs + 43_200_000), timezone);

  const startKey = startDay.toLocaleDateString("sv-SE", { timeZone: timezone });
  const endKey   = endDay.toLocaleDateString("sv-SE", { timeZone: timezone });
  const cacheKey = `Custom|${startKey}|${endKey}`;

  return {
    startISO:     startDay.toISOString(),
    endISO:       endOfTo.toISOString(),
    days,
    label:        `${fmt(from)} – ${fmt(to)}`,
    prevStartISO: prevStart.toISOString(),
    prevEndISO:   prevEnd.toISOString(),
    cacheKey,
  };
}
