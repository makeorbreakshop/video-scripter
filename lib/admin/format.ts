const ET = 'America/New_York';

export function n(x: number | string | null | undefined) {
  if (x == null) return '–';
  return Number(x).toLocaleString('en-US');
}

export function compact(x: number | string | null | undefined) {
  if (x == null) return '–';
  const v = Number(x);
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K';
  return String(v);
}

export function etDateTime(iso: string | Date | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function etDate(iso: string | Date | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric', year: 'numeric' });
}

export function ago(iso: string | Date | null | undefined, now: number = Date.now()) {
  if (!iso) return '–';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Age of a video, in the largest unit that is not zero ('23h old', not '0d old').
export function ageLabel(published: string | Date | null | undefined, now: number = Date.now()) {
  if (!published) return '–';
  const mins = Math.floor((now - new Date(published).getTime()) / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m old`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h old`;
  return `${Math.floor(hrs / 24)}d old`;
}

export function ageDays(published: string | Date | null | undefined) {
  if (!published) return null;
  return Math.floor((Date.now() - new Date(published).getTime()) / 86400000);
}

export function score(x: number | string | null | undefined) {
  if (x == null) return '–';
  return Number(x).toFixed(2) + '×';
}
