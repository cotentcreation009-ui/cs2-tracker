// Presentation helpers: rating colours, time formatting, number helpers.

/** Tailwind text-colour class for an HLTV-style rating. */
export function ratingColor(rating: number): string {
  if (rating >= 1.15) return "text-good";
  if (rating >= 1.0) return "text-brand2";
  if (rating >= 0.9) return "text-mid";
  return "text-bad";
}

/** Generic good/mid/bad colouring around a neutral midpoint. */
export function tierColor(
  value: number,
  good: number,
  mid: number,
): string {
  if (value >= good) return "text-good";
  if (value >= mid) return "text-mid";
  return "text-bad";
}

export function kdColor(kd: number): string {
  if (kd >= 1.1) return "text-good";
  if (kd >= 0.95) return "text-mid";
  return "text-bad";
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function mapLabel(map: string): string {
  return map.replace(/^de_/, "").replace(/^cs_/, "");
}

/** Country code -> regional-indicator flag emoji (best effort). */
export function flag(country?: string): string {
  if (!country || country.length !== 2) return "";
  const cc = country.toUpperCase();
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}
