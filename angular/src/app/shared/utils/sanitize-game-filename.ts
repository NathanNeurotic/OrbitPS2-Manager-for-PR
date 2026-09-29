const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Renderer-side mirror of the backend filename sanitizer. Canonical display
 * titles may contain characters that cannot be used as RiptOPL storage names.
 */
export function sanitizeGameFilename(name: string): string {
  if (!name) return '_';

  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned) return '_';

  const baseUpper = cleaned.toUpperCase().split('.')[0];
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    cleaned = `${cleaned}_`;
  }

  return cleaned;
}
