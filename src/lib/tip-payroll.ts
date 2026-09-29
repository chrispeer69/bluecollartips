// Pay-week dates shared by the tip payroll page and server. Weeks run Saturday–Friday.

/** "YYYY-MM-DD" of the Saturday that starts the pay week containing `day`. */
export function payWeekStart(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 1) % 7; // Sat=0 … Fri=6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The most recent full pay week (Sat–Fri) that has already ended by `today`. */
export function lastCompletedWeekStart(today: string) {
  return payWeekStart(addDaysYmd(today, -7));
}
