import { describe, expect, it } from 'vitest';
import { maskEmail } from './leaderboard.js';

describe('maskEmail', () => {
  it('keeps the first local-part character and the full domain', () => {
    expect(maskEmail('jsmith@gmail.com')).toBe('j***@gmail.com');
  });

  it('masks a single-character local part the same way', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('preserves a multi-label domain untouched', () => {
    expect(maskEmail('host.player@mail.sub.example.co.uk')).toBe('h***@mail.sub.example.co.uk');
  });

  it('returns the input unchanged when there is no @', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});
