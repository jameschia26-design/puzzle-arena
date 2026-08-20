/**
 * Bundled themed word lists. These are the fallback when the AI provider is
 * unreachable, times out, or returns something that fails schema validation —
 * a Word Search room must still start. See apps/server/src/ai/client.ts.
 */
export const FALLBACK_WORD_LISTS: Record<string, string[]> = {
  space: ['COMET', 'GALAXY', 'NEBULA', 'ORBIT', 'PLANET', 'QUASAR', 'ROCKET', 'SATURN', 'SOLAR', 'STAR', 'VENUS', 'COSMOS'],
  'deep sea': ['ABYSS', 'CORAL', 'DIVER', 'KRILL', 'OCTOPUS', 'REEF', 'SHARK', 'SQUID', 'TRENCH', 'WHALE', 'KELP', 'MANTA'],
  ocean: ['ANCHOR', 'BEACH', 'CURRENT', 'HARBOUR', 'ISLAND', 'LAGOON', 'SAILOR', 'TIDE', 'WAVE', 'MARINE', 'SHORE', 'VESSEL'],
  jungle: ['CANOPY', 'FERN', 'JAGUAR', 'LIANA', 'MONKEY', 'PARROT', 'PYTHON', 'RIVER', 'TOUCAN', 'VINE', 'ORCHID', 'TAPIR'],
  desert: ['CACTUS', 'CAMEL', 'DUNE', 'MIRAGE', 'OASIS', 'SCORPION', 'SUNSET', 'MESA', 'NOMAD', 'SAND', 'ARID', 'CANYON'],
  arctic: ['BLIZZARD', 'FROST', 'GLACIER', 'ICEBERG', 'IGLOO', 'POLAR', 'SEAL', 'TUNDRA', 'WALRUS', 'AURORA', 'SLEDGE', 'PARKA'],
  kitchen: ['APRON', 'BLENDER', 'BOWL', 'FLOUR', 'GRATER', 'KETTLE', 'LADLE', 'PANTRY', 'SKILLET', 'SPATULA', 'WHISK', 'OVEN'],
  music: ['BALLAD', 'CHORD', 'DRUMS', 'FLUTE', 'GUITAR', 'HARMONY', 'MELODY', 'OCTAVE', 'PIANO', 'RHYTHM', 'TEMPO', 'VIOLIN'],
  sport: ['ARENA', 'ATHLETE', 'DERBY', 'HURDLE', 'MEDAL', 'RELAY', 'REFEREE', 'SPRINT', 'STADIUM', 'TENNIS', 'TROPHY', 'UMPIRE'],
  castle: ['ARCHER', 'BANNER', 'DRAWBRIDGE', 'DUNGEON', 'HERALD', 'KNIGHT', 'MOAT', 'RAMPART', 'SIEGE', 'TOWER', 'TURRET', 'CREST'],
  weather: ['BREEZE', 'CLOUD', 'DRIZZLE', 'FROST', 'HAIL', 'MONSOON', 'RAINBOW', 'SQUALL', 'THUNDER', 'TORNADO', 'HUMID', 'GALE'],
  garden: ['BLOSSOM', 'COMPOST', 'DAHLIA', 'HEDGE', 'LAVENDER', 'MEADOW', 'PETAL', 'SEEDLING', 'SHOVEL', 'SPROUT', 'TRELLIS', 'TULIP'],
  science: ['ATOM', 'BEAKER', 'CATALYST', 'ENZYME', 'FOSSIL', 'GRAVITY', 'ISOTOPE', 'MAGNET', 'MOLECULE', 'NEUTRON', 'PRISM', 'VECTOR'],
  city: ['AVENUE', 'BRIDGE', 'MARKET', 'METRO', 'PLAZA', 'SKYLINE', 'SUBWAY', 'TAXI', 'TERRACE', 'TRAFFIC', 'TUNNEL', 'DISTRICT'],
  farm: ['BARLEY', 'BARN', 'CATTLE', 'CLOVER', 'HARVEST', 'MEADOW', 'ORCHARD', 'PLOUGH', 'SILO', 'STABLE', 'TRACTOR', 'WHEAT'],
  mythology: ['CENTAUR', 'CHIMERA', 'GRIFFIN', 'HYDRA', 'KRAKEN', 'MEDUSA', 'ORACLE', 'PEGASUS', 'PHOENIX', 'SIREN', 'TITAN', 'VALKYRIE'],
  computing: ['BUFFER', 'CACHE', 'COMPILER', 'CURSOR', 'KERNEL', 'MEMORY', 'NETWORK', 'PACKET', 'PIXEL', 'ROUTER', 'SERVER', 'SOCKET'],
  travel: ['AIRPORT', 'CABIN', 'COMPASS', 'FERRY', 'JOURNEY', 'LUGGAGE', 'PASSPORT', 'SAFARI', 'SHUTTLE', 'TICKET', 'VOYAGE', 'HOSTEL'],
  cinema: ['ACTOR', 'CAMERA', 'CREDITS', 'DIRECTOR', 'EDITOR', 'MONTAGE', 'PREMIERE', 'SCREEN', 'SCRIPT', 'STUDIO', 'TRAILER', 'SCENE'],
  autumn: ['ACORN', 'AMBER', 'CHESTNUT', 'CIDER', 'CRISP', 'HARVEST', 'LANTERN', 'MAPLE', 'ORCHARD', 'PUMPKIN', 'RUSSET', 'SWEATER'],
  transportation: ['AIRPLANE', 'BICYCLE', 'CARAVAN', 'CARGO', 'COMMUTE', 'FERRY', 'FREIGHT', 'HIGHWAY', 'LOCOMOTIVE', 'PILOT', 'RAILWAY', 'VEHICLE'],
};

export const DEFAULT_WORDS = FALLBACK_WORD_LISTS.space as string[];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` appears in `haystack` as a whole word/phrase, not merely
 *  as a raw substring — a plain `.includes()` would wrongly match e.g.
 *  "transportation" against "sport" ("tran-SPORT-ation"). */
function wordBoundaryMatch(haystack: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack);
}

/** Best bundled list for a theme, falling back to Space. */
export function fallbackWordsFor(theme: string): string[] {
  const key = theme.trim().toLowerCase();
  const exact = FALLBACK_WORD_LISTS[key];
  if (exact) return exact;
  for (const [name, words] of Object.entries(FALLBACK_WORD_LISTS)) {
    if (wordBoundaryMatch(key, name) || wordBoundaryMatch(name, key)) return words;
  }
  return DEFAULT_WORDS;
}
