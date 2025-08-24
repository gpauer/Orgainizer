// Range + heuristic helpers extracted from original assistantHandlers
export interface NormalizedRange { start: string; end: string; reason: string; }

export function parseDateISO(v: any, now: Date): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  if (Math.abs(d.getTime() - now.getTime()) > 1000 * 60 * 60 * 24 * 366 * 3) return null; // >3y away
  return d;
}
export function normalizeRange(r: any, now: Date): NormalizedRange | null {
  if (!r) return null;
  const start = parseDateISO(r.start, now);
  const end = parseDateISO(r.end, now);
  if (!start || !end) return null;
  if (end < start) return null;
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), reason: (r.reason || '').toString().slice(0, 160) };
}
function inferYear(monthIdx: number, now: Date) {
  if (monthIdx < now.getMonth() - 1) return now.getFullYear() + 1;
  return now.getFullYear();
}
export function buildHeuristicRanges(query: string, now: Date) {
  const lower = query.toLowerCase();
  const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const found: { m: number; y: number }[] = [];
  monthNames.forEach((m,i)=>{
    const regex = new RegExp(`\\b${m}(?:\\s+(\\d{4}))?`,'g');
    let match; while ((match = regex.exec(lower))) { const y = match[1]? parseInt(match[1],10): inferYear(i, now); found.push({ m:i, y }); }
  });
  let ranges: NormalizedRange[] = [];
  if (found.length) {
    const min = found.reduce((a,c)=> !a || c.y<a.y || (c.y===a.y && c.m<a.m)?c:a, null as any);
    const max = found.reduce((a,c)=> !a || c.y>a.y || (c.y===a.y && c.m>a.m)?c:a, null as any);
    const start = new Date(min.y, min.m,1);
    const end = new Date(max.y, max.m+1,0,23,59,59,999);
    ranges = [{ start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), reason:'Referenced months' }];
  } else if (/next\s+(\d+)\s+month/.test(lower)) {
    const m = Math.min(parseInt(/next\s+(\d+)\s+month/.exec(lower)![1],10),12);
    const start = now;
    const end = new Date(now.getFullYear(), now.getMonth()+m+1,0,23,59,59,999);
    ranges = [{ start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), reason:`Next ${m} months` }];
  } else if (/next\s+year/.test(lower)) {
    const start = now;
    const end = new Date(now.getFullYear()+1, now.getMonth()+1,0,23,59,59,999);
    ranges = [{ start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), reason:'Next year' }];
  } else if (/this\s+week/.test(lower)) {
    const day = now.getDay();
    const weekStart = addDays(now, -day);
    const weekEnd = addDays(weekStart,6);
    ranges = [{ start: weekStart.toISOString().slice(0,10), end: weekEnd.toISOString().slice(0,10), reason:'This week' }];
  } else if (/today|now/.test(lower)) {
    ranges = [{ start: now.toISOString().slice(0,10), end: now.toISOString().slice(0,10), reason:'Today only' }];
  } else if (/tomorrow/.test(lower)) {
    const t = addDays(now,1);
    ranges = [{ start: t.toISOString().slice(0,10), end: t.toISOString().slice(0,10), reason:'Tomorrow' }];
  } else if (/next\s+week/.test(lower)) {
    const day = now.getDay();
    const nextWeekStart = addDays(now, 7 - day);
    const nextWeekEnd = addDays(nextWeekStart,6);
    ranges = [{ start: nextWeekStart.toISOString().slice(0,10), end: nextWeekEnd.toISOString().slice(0,10), reason:'Next week' }];
  } else if (/upcoming|plan|schedule|what.*coming/.test(lower)) {
    const start = addDays(now,-7);
    const end = new Date(now.getFullYear(), now.getMonth()+3, now.getDate());
    ranges = [{ start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), reason:'Recent past + 3 months ahead' }];
  } else {
    const start = addDays(now,-3);
    const end = new Date(now.getFullYear(), now.getMonth()+1, now.getDate());
    ranges = [{ start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), reason:'Default small window' }];
  }
  return { ranges, union: { start: ranges[0].start, end: ranges[ranges.length-1].end }, strategy: 'heuristic', source: 'heuristic' };
}
