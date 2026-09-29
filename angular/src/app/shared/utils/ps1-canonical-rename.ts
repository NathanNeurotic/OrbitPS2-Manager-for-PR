import { Game } from '@shared/types/game.type';
import { ConfirmDialogOptions } from '@shared/services/confirm-dialog.service';
import { sanitizeRiptOplPs1StorageName } from '@shared/utils/sanitize-game-filename';

/** A PS1 storage name that normalization will change. */
export interface Ps1CanonicalRename {
  from: string;
  to: string;
}

/**
 * Name RiptOPL keys a PS1 game's artwork by: the Ember game-folder name, or
 * the VCD filename without its extension. Undefined for non-PS1 entries.
 */
export function ps1StorageIdentity(game: Game): string | undefined {
  if (game.format === 'EMBER') return game.emberFolder;
  if (game.system === 'PS1' && game.filename) {
    return game.filename.replace(/\.[^./\\]+$/, '');
  }
  return undefined;
}

/**
 * Artwork identities RiptOPL will actually try for this PS1 row.
 *
 * The storage name is always primary. VCDs additionally accept a GameID-keyed
 * loose artwork fallback only when that same GameID is a strict prefix of the
 * VCD filename. Ember has no GameID fallback because its folder name is the
 * storage/config/art identity.
 */
export function ps1ArtworkIdentities(game: Game): string[] {
  const primary = ps1StorageIdentity(game);
  if (!primary) return [];

  const identities = [primary];
  if (game.format !== 'EMBER' && game.gameId) {
    const stem = primary.toUpperCase();
    const gameId = game.gameId.toUpperCase();
    if (stem === gameId || stem.startsWith(`${gameId}.`)) {
      identities.push(game.gameId);
    }
  }

  return [...new Set(identities)];
}

export function ps1CanonicalStorageName(game: Game): string | undefined {
  if (game.isPs1Launcher || !game.canonicalTitle) return undefined;
  const kind = game.format === 'EMBER' ? 'EMBER' : 'VCD';
  return sanitizeRiptOplPs1StorageName(game.canonicalTitle, kind);
}

/** The rename normalization will apply to this game, if any. */
export function ps1CanonicalRename(game: Game): Ps1CanonicalRename | undefined {
  if (game.isPs1Launcher) return undefined;
  const from = ps1StorageIdentity(game);
  const to = ps1CanonicalStorageName(game);
  return from && to && from !== to ? { from, to } : undefined;
}

/**
 * Yes/No warning shown before any artwork run renames PS1 storage. RiptOPL
 * keys artwork by the VCD/Ember folder name, so the canonical name is not
 * optional — "No" cancels the run rather than downloading mismatched art.
 */
export function ps1CanonicalRenameConfirm(
  renames: Ps1CanonicalRename[],
): ConfirmDialogOptions {
  const count = renames.length;
  const limit = 20;
  const lines = renames.slice(0, limit).map((r) => `${r.from} → ${r.to}`);
  if (count > limit) lines.push(`…and ${count - limit} more`);

  return {
    title: 'Rename to canonical titles?',
    message:
      `${count === 1 ? 'This filename is' : `${count} filenames are`} going to be ` +
      `changed to match ${count === 1 ? 'its' : 'their'} canonical name and artwork ` +
      '(VMC folders and existing artwork are renamed with them). Proceed?',
    detail: lines.join('\n'),
    confirmLabel: 'Yes',
    cancelLabel: 'No',
    backdropClose: false,
  };
}
