/** Facility overrides inherit their tenant's timezone when unset. Never guess a zone. */
export function validTimezone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 100 ||
    /^[+-]/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en-KE', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function calendarDateInZone(timezone: string, now = new Date()): string {
  if (!validTimezone(timezone)) throw new Error('Facility timezone is missing or invalid.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function welcomeInZone(
  timezone: string,
  now = new Date(),
): { greeting: string; date: string } | null {
  if (!validTimezone(timezone)) return null;
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  return {
    greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    date: new Intl.DateTimeFormat('en-KE', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now),
  };
}
