/**
 * The Puzzle Arena mark, defined once as pixel geometry.
 *
 * A 32x32 unit canvas: an arcade cabinet frame ("arena") around a 3x3 tile
 * grid with two cells missing on the diagonal and a lit centre — a puzzle
 * mid-solve. Everything is an axis-aligned rectangle on integer units, so it
 * renders crisply at any size with no anti-aliasing, which is the whole point
 * of a pixel mark.
 */

export const UNITS = 32;

export const PALETTE = {
  bg: '#0b0d17',
  surface: '#161a2e',
  border: '#2f3660',
  cyan: '#22e0ff',
  magenta: '#ff3f8e',
  amber: '#ffb020',
  shadow: '#05060d',
};

/** A hollow rectangle, as four filled bars. */
function frame(x, y, w, h, t, fill) {
  return [
    { x, y, w, h: t, fill },
    { x, y: y + h - t, w, h: t, fill },
    { x, y: y + t, w: t, h: h - 2 * t, fill },
    { x: x + w - t, y: y + t, w: t, h: h - 2 * t, fill },
  ];
}

const TILE = 6;
const STARTS = [5, 13, 21];

/**
 * Which grid cells are filled. The two blanks sit on the diagonal so the
 * silhouette is not a plain square, and the centre is the accent.
 */
const CELLS = [
  [null, 'cyan', 'amber'],
  ['cyan', 'magenta', 'cyan'],
  ['cyan', 'cyan', null],
];

/**
 * @param {{ background?: boolean, inset?: number }} options
 *   `background` paints the full canvas (icons must not be transparent).
 *   `inset` shrinks the artwork toward the centre, for maskable icons whose
 *   corners get cropped to a circle.
 */
export function shapes({ background = true, inset = 0 } = {}) {
  const out = [];
  if (background) out.push({ x: 0, y: 0, w: UNITS, h: UNITS, fill: PALETTE.bg });

  const art = [];

  // The arena frame, with magenta corner caps.
  art.push(...frame(2, 2, 28, 28, 2, PALETTE.cyan));
  for (const [cx, cy] of [
    [2, 2],
    [28, 2],
    [2, 28],
    [28, 28],
  ]) {
    art.push({ x: cx, y: cy, w: 2, h: 2, fill: PALETTE.magenta });
  }

  // The 3x3 grid.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = STARTS[col];
      const y = STARTS[row];
      const cell = CELLS[row][col];
      if (cell === null) {
        // An unsolved cell: a recess, not a hole, so it still reads at 16px.
        art.push({ x, y, w: TILE, h: TILE, fill: PALETTE.surface });
        art.push(...frame(x, y, TILE, TILE, 1, PALETTE.border));
      } else {
        // Each tile carries the design system's hard drop shadow.
        art.push({ x: x + 1, y: y + 1, w: TILE, h: TILE, fill: PALETTE.shadow });
        art.push({ x, y, w: TILE, h: TILE, fill: PALETTE[cell] });
      }
    }
  }

  if (inset === 0) return [...out, ...art];

  // Scale the artwork about the centre of the canvas.
  const scale = (UNITS - 2 * inset) / UNITS;
  const shift = inset;
  return [
    ...out,
    ...art.map((r) => ({
      x: r.x * scale + shift,
      y: r.y * scale + shift,
      w: r.w * scale,
      h: r.h * scale,
      fill: r.fill,
    })),
  ];
}

/** The mark as an SVG document. */
export function toSvg({ background = true, inset = 0 } = {}) {
  const rects = shapes({ background, inset })
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNITS} ${UNITS}" width="${UNITS}" height="${UNITS}" shape-rendering="crispEdges" role="img" aria-label="Puzzle Arena">${rects}</svg>`;
}
