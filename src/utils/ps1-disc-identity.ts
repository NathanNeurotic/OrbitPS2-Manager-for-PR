import { createHash } from "crypto";
import * as fs from "fs/promises";
import conflicts from "../data/ps1-disc-conflicts.json";

interface ConflictRule {
  internalId: string;
  md5: string;
  title: string;
  discId: string;
  size?: number;
}

export interface Ps1ConflictMatch {
  /** Serial read from the disc before conflict resolution. */
  internalId: string;
  /** Disc-specific identifier selected by the verified checksum rule. */
  discId: string;
  /** Disc-specific title selected by the verified checksum rule. */
  title: string;
  method: "md5";
}

const knownConflicts = new Set(
  (conflicts.conflicts as string[]).map((id) => normalizeDiscId(id)),
);
const wholeFileRules = conflicts.wholeFile as ConflictRule[];
const dataTrackRules = conflicts.dataTrack as ConflictRule[];

function normalizeDiscId(id: string): string {
  return id.trim().toUpperCase().replace("-", "_");
}

export function isKnownPs1Conflict(gameId: string): boolean {
  return knownConflicts.has(normalizeDiscId(gameId));
}

async function md5Range(
  filePath: string,
  start: number,
  length: number,
): Promise<string | null> {
  if (start < 0 || length < 0) return null;

  const handle = await fs.open(filePath, "r");
  try {
    const hash = createHash("md5");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = start;
    let remaining = length;

    while (remaining > 0) {
      const requested = Math.min(buffer.length, remaining);
      const { bytesRead } = await handle.read(buffer, 0, requested, position);
      if (bytesRead <= 0) return null;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }

    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

/**
 * Resolve a PS1 disc whose internal serial is known to be shared by multiple
 * discs/editions.
 *
 * GDX-X/PFS-BatchKit-Manager provides checksum rules over the complete input
 * file. Redump-derived rules provide checksums/sizes for raw data tracks. The
 * two inputs are deliberately kept separate: a POPS VCD header or a CUE track
 * offset must never be treated as part of a Redump data-track checksum.
 */
export async function matchPs1Conflict(
  filePath: string,
  internalGameId: string,
  dataTrackOffset = 0,
): Promise<Ps1ConflictMatch | null> {
  const internalId = normalizeDiscId(internalGameId);
  if (!knownConflicts.has(internalId)) return null;

  const stat = await fs.stat(filePath);
  const fullRules = wholeFileRules.filter(
    (rule) => normalizeDiscId(rule.internalId) === internalId,
  );

  if (fullRules.length > 0) {
    const digest = await md5Range(filePath, 0, stat.size);
    const match = digest
      ? fullRules.find((rule) => rule.md5.toLowerCase() === digest)
      : undefined;
    if (match) {
      return {
        internalId,
        discId: normalizeDiscId(match.discId),
        title: match.title,
        method: "md5",
      };
    }
  }

  const trackRules = dataTrackRules.filter(
    (rule) => normalizeDiscId(rule.internalId) === internalId && !!rule.size,
  );
  const digests = new Map<number, string | null>();

  for (const rule of trackRules) {
    const size = Number(rule.size);
    if (!Number.isFinite(size) || size <= 0 || dataTrackOffset + size > stat.size) {
      continue;
    }
    if (!digests.has(size)) {
      digests.set(size, await md5Range(filePath, dataTrackOffset, size));
    }
    if (digests.get(size)?.toLowerCase() === rule.md5.toLowerCase()) {
      return {
        internalId,
        discId: normalizeDiscId(rule.discId),
        title: rule.title,
        method: "md5",
      };
    }
  }

  return null;
}
