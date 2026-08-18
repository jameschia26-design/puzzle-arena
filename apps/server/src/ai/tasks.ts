import { z } from 'zod';
import { complete } from './client.js';
import { fallbackMysteryFlavour, fallbackPuzzleTitle, fallbackWordsFor } from './fallbacks.js';

/* ---------------- wordsearch_theme ---------------- */

const wordsSchema = z.object({ words: z.array(z.string()) });

/**
 * 10-18 entries, 4-9 letters, /^[A-Z]+$/, deduped. Rejected entries are dropped
 * BEFORE the schema check so one bad word does not discard the whole reply.
 */
export async function getThemeWords(theme: string): Promise<{
  words: string[];
  source: 'cache' | 'provider' | 'fallback';
}> {
  const fallback = fallbackWordsFor(theme);

  const cleaned = z
    .unknown()
    .transform((raw) => {
      const parsed = wordsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const words = [
        ...new Set(
          parsed.data.words
            .map((w) => String(w).toUpperCase().replace(/[^A-Z]/g, ''))
            .filter((w) => w.length >= 4 && w.length <= 9),
        ),
      ];
      return words.length >= 10 ? { words: words.slice(0, 18) } : null;
    })
    .pipe(wordsSchema);

  const result = await complete({
    task: 'wordsearch_theme',
    system:
      'You generate word lists for word-search puzzles. Reply with ONLY a JSON object of the form {"words":["ALPHA","BETA"]}. Every word must be a single English word, 4 to 9 letters, uppercase A-Z only, with no spaces, hyphens or proper nouns. Give between 12 and 18 words. No commentary.',
    user: `Theme: ${theme}`,
    schema: cleaned,
    fallback: { words: fallback },
  });

  return { words: result.value.words, source: result.source };
}

/* ---------------- mystery_flavour ---------------- */

const flavourSchema = z.object({
  victim: z.string().min(1).max(60),
  setting: z.string().min(1).max(120),
  blurb: z.string().min(1).max(400),
});

/** Purely cosmetic — this never touches the solution. */
export async function getMysteryFlavour(seed: number): Promise<{
  victim: string;
  setting: string;
  blurb: string;
  source: 'cache' | 'provider' | 'fallback';
}> {
  const result = await complete({
    task: 'mystery_flavour',
    system:
      'You write flavour text for a detective board game. Reply with ONLY a JSON object of the form {"victim":"...","setting":"...","blurb":"..."}. The blurb is at most two sentences. Do not name a murderer, weapon or room. No commentary.',
    user: `Write flavour for a manor-house mystery. Variation seed: ${seed}.`,
    schema: flavourSchema,
    fallback: fallbackMysteryFlavour(seed),
  });
  return { ...result.value, source: result.source };
}

/* ---------------- puzzle_title ---------------- */

const titleSchema = z.object({ title: z.string().min(1).max(40) });

export async function getPuzzleTitle(
  gameId: string,
  difficulty: string,
): Promise<{ title: string; source: 'cache' | 'provider' | 'fallback' }> {
  const result = await complete({
    task: 'puzzle_title',
    system:
      'You name puzzles. Reply with ONLY a JSON object of the form {"title":"..."}. The title is at most four words, evocative, and contains no punctuation. No commentary.',
    user: `Name a ${difficulty} ${gameId} puzzle.`,
    schema: titleSchema,
    fallback: fallbackPuzzleTitle(gameId, difficulty),
  });
  return { title: result.value.title, source: result.source };
}
