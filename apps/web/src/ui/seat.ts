import { SEAT_COLORS } from '@puzzle-arena/shared';

export { SEAT_COLORS };

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length] as string;
}

/**
 * The two-character monogram shown on every token and chip. Seat identity is
 * never colour-only — this is the non-colour half of it.
 */
export function monogram(displayName: string): string {
  const cleaned = displayName.trim();
  if (!cleaned) return '??';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/** Seat colours are bright; dark ink reads better on most of them. */
export function inkOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#0b0d17' : '#e8ecff';
}
