/** Toutes les dates sont lues et affichées en fuseau Europe/Paris. */
export const TZ = 'Europe/Paris';

const ymdFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parisYMD(date: Date | string): YMD {
  const parts = ymdFmt.formatToParts(new Date(date));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Date à midi UTC (donc même jour à Paris, été comme hiver). */
export function makeDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 11, 0, 0));
}

/** Décale un (année, mois) de n mois. */
export function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isSameDay(a: YMD, b: YMD): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function isInMonth(iso: string, y: number, m: number): boolean {
  const p = parisYMD(iso);
  return p.y === y && p.m === m;
}

/** Date ISO d'il y a n jours (à l'heure actuelle). */
export function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Nombre de jours entre aujourd'hui et une date (négatif si passée). */
export function daysUntil(iso: string): number {
  const t = parisYMD(new Date());
  const p = parisYMD(iso);
  const a = Date.UTC(t.y, t.m - 1, t.d);
  const b = Date.UTC(p.y, p.m - 1, p.d);
  return Math.round((b - a) / 86_400_000);
}

export function formatDayLabel(iso: string): string {
  const today = parisYMD(new Date());
  const p = parisYMD(iso);
  if (isSameDay(today, p)) return "Aujourd'hui";
  const yesterday = parisYMD(new Date(Date.now() - 86_400_000));
  if (isSameDay(yesterday, p)) return 'Hier';
  return new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short' });
}

export function formatMonthTitle(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}
