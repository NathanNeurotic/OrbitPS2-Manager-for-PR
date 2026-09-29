import { sanitizeGameFilename } from './sanitize-game-filename';

describe('sanitizeGameFilename', () => {
  it('matches the storage-safe canonical naming rules', () => {
    expect(sanitizeGameFilename('Game: Subtitle?')).toBe('Game Subtitle');
    expect(sanitizeGameFilename('  Spyro   2  ')).toBe('Spyro 2');
    expect(sanitizeGameFilename('CON')).toBe('CON_');
  });
});
