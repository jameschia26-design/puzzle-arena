import { describe, expect, it } from 'vitest';
import {
  GAME_REGISTRY,
  mastermindConfigSchema,
  parseGameConfig,
} from './registry.js';

describe('mastermind registry and configuration', () => {
  it('registers mastermind as a concurrent puzzle game', () => {
    const meta = GAME_REGISTRY['mastermind'];
    expect(meta).toBeDefined();
    expect(meta.id).toBe('mastermind');
    expect(meta.kind).toBe('puzzle');
    expect(meta.minPlayers).toBe(1);
    expect(meta.maxPlayers).toBe(200);
    expect(meta.supportsBots).toBe(true);
    expect(meta.defaultTimeLimitSec).toBe(300);
  });

  it('provides the expected defaults', () => {
    const parsed = mastermindConfigSchema.parse({});
    expect(parsed).toEqual({
      colors: 8,
      slots: 4,
      maxTries: 10,
    });
  });

  it('accepts exact boundary values', () => {
    expect(
      mastermindConfigSchema.parse({ colors: 7, slots: 4, maxTries: 6 }),
    ).toEqual({ colors: 7, slots: 4, maxTries: 6 });

    expect(
      mastermindConfigSchema.parse({ colors: 12, slots: 8, maxTries: 30 }),
    ).toEqual({ colors: 12, slots: 8, maxTries: 30 });
  });

  it('rejects out-of-range and fractional values', () => {
    expect(() => mastermindConfigSchema.parse({ colors: 6 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ colors: 13 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ colors: 8.5 })).toThrow();

    expect(() => mastermindConfigSchema.parse({ slots: 3 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ slots: 9 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ slots: 4.2 })).toThrow();

    expect(() => mastermindConfigSchema.parse({ maxTries: 5 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ maxTries: 31 })).toThrow();
    expect(() => mastermindConfigSchema.parse({ maxTries: 10.5 })).toThrow();
  });

  it('parses correctly via parseGameConfig', () => {
    const parsed = parseGameConfig('mastermind', { colors: 10, slots: 5, maxTries: 12 });
    expect(parsed).toEqual({ colors: 10, slots: 5, maxTries: 12 });
  });
});
