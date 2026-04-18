export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export function tomorrowAtNineUtc(baseDate: Date = new Date()): Date {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + 1,
      9,
      0,
      0,
      0,
    ),
  );
}

export function upcomingSundayEndUtc(baseDate: Date = new Date()): Date {
  const start = startOfUtcDay(baseDate);
  const day = start.getUTCDay();
  const daysUntilSunday = (7 - day) % 7;

  return endOfUtcDay(
    new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + daysUntilSunday, 0, 0, 0, 0),
    ),
  );
}

export function tomorrowRangeUtc(baseDate: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + 1, 0, 0, 0, 0),
  );

  return {
    start,
    end: endOfUtcDay(start),
  };
}