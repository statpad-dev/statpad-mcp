export const DEFAULT_TIME_ZONE = 'America/New_York';

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date and wall-clock time of an instant in a time zone. */
export function localParts(instant: Date, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** Resolves today, yesterday or tomorrow to a YYYY-MM-DD date in tz, and passes a date through. */
export function resolveDate(spec: string, now: Date, tz: string): string {
  const today = localParts(now, tz).date;
  if (spec === 'today') return today;
  if (spec === 'yesterday') return addDays(today, -1);
  if (spec === 'tomorrow') return addDays(today, 1);
  return spec;
}

/** Seconds as a game clock, such as 7:02. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.round(seconds / size);
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }
  return `${Math.max(0, Math.round(seconds))} seconds`;
}
