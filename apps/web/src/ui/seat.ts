import { SEAT_COLORS } from '@puzzle-arena/shared';

export { SEAT_COLORS };

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat % SEAT_COLORS.length] as string;
}

/**
 * The two-character monogram shown on every token and chip. Seat identity is
 * never colour-only — this is the non-colour half of it.
 */
export function monogram(displayName: string | null | undefined): string {
  const cleaned = (displayName ?? '').trim();
  if (!cleaned || cleaned === '—' || cleaned === '?') return 'P';
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

export interface PlayerLike {
  id?: string;
  playerId?: string;
  seat?: number;
  displayName?: string;
  avatar?: string | null;
  isBot?: boolean;
}

export function resolvePlayer(
  players: readonly PlayerLike[] | undefined | null,
  idOrSeat: string | number | null | undefined,
  fallbackLabel?: string,
): { displayName: string; avatar: string | null; seat: number; isBot: boolean } {
  if (idOrSeat === null || idOrSeat === undefined) {
    return { displayName: fallbackLabel ?? 'Player', avatar: null, seat: 0, isBot: false };
  }

  const list = players ?? [];

  // 1. Match by id or playerId
  if (typeof idOrSeat === 'string') {
    const found = list.find((p) => (p.id && p.id === idOrSeat) || (p.playerId && p.playerId === idOrSeat));
    if (found) {
      return {
        displayName: found.displayName || (fallbackLabel ?? 'Player'),
        avatar: found.avatar ?? null,
        seat: typeof found.seat === 'number' ? found.seat : 0,
        isBot: Boolean(found.isBot),
      };
    }

    // Check if id is like 'p0', 'p1', etc.
    const pMatch = /^p(\d+)$/i.exec(idOrSeat);
    if (pMatch) {
      const seatNum = parseInt(pMatch[1]!, 10);
      const bySeat = list.find((p) => p.seat === seatNum);
      if (bySeat) {
        return {
          displayName: bySeat.displayName || `Player ${seatNum + 1}`,
          avatar: bySeat.avatar ?? null,
          seat: seatNum,
          isBot: Boolean(bySeat.isBot),
        };
      }
      return {
        displayName: fallbackLabel ?? `Player ${seatNum + 1}`,
        avatar: null,
        seat: seatNum,
        isBot: false,
      };
    }

    // Check if string is a numeric seat
    const num = parseInt(idOrSeat, 10);
    if (!isNaN(num) && String(num) === idOrSeat) {
      const bySeat = list.find((p) => p.seat === num);
      if (bySeat) {
        return {
          displayName: bySeat.displayName || `Player ${num + 1}`,
          avatar: bySeat.avatar ?? null,
          seat: num,
          isBot: Boolean(bySeat.isBot),
        };
      }
      return {
        displayName: fallbackLabel ?? `Player ${num + 1}`,
        avatar: null,
        seat: num,
        isBot: false,
      };
    }
  } else if (typeof idOrSeat === 'number') {
    const bySeat = list.find((p) => p.seat === idOrSeat);
    if (bySeat) {
      return {
        displayName: bySeat.displayName || (fallbackLabel ?? `Player ${idOrSeat + 1}`),
        avatar: bySeat.avatar ?? null,
        seat: idOrSeat,
        isBot: Boolean(bySeat.isBot),
      };
    }
    return {
      displayName: fallbackLabel ?? `Player ${idOrSeat + 1}`,
      avatar: null,
      seat: idOrSeat,
      isBot: false,
    };
  }

  return {
    displayName: fallbackLabel ?? 'Player',
    avatar: null,
    seat: 0,
    isBot: false,
  };
}
