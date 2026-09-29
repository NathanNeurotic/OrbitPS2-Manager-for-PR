import { createHash } from "crypto";
import * as fs from "fs/promises";
import conflicts from "../data/ps1-disc-conflicts.json";
import { VCD_HEADER_SIZE } from "./game-id-patterns";

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

function normalizeDiscId(id: string): string {
  const compact = id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^([A-Z]{4})(\d{5})$/);
  if (!match) return id.trim().toUpperCase().replace("-", "_");
  return `${match[1]}_${match[2].slice(0, 3)}.${match[2].slice(3)}`;
}

export function isKnownPs1Conflict(gameId: string): boolean {
  return knownConflicts.has(normalizeDiscId(gameId));
}


export function resolveKnownPs1ConflictDigest(
  internalGameId: string,
  md5: string,
): Ps1ConflictMatch | null {
  const internalId = normalizeDiscId(internalGameId);
  const digest = md5.trim().toLowerCase();
  const match = wholeFileRules.find(
    (rule) =>
      normalizeDiscId(rule.internalId) === internalId &&
      rule.md5.toLowerCase() === digest,
  );
  if (!match) return null;
  return {
    internalId,
    discId: normalizeDiscId(match.discId),
    title: match.title,
    method: "md5",
  };
}

async function md5Segments(
  filePath: string,
  segments: Array<{ start: number; length: number }>,
): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const hash = createHash("md5");
    const buffer = Buffer.alloc(1024 * 1024);

    for (const segment of segments) {
      if (segment.start < 0 || segment.length < 0) return null;
      let position = segment.start;
      let remaining = segment.length;
      while (remaining > 0) {
        const requested = Math.min(buffer.length, remaining);
        const { bytesRead } = await handle.read(buffer, 0, requested, position);
        if (bytesRead <= 0) return null;
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
        remaining -= bytesRead;
      }
    }

    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function fromBcd(value: number): number {
  return Math.floor(value / 16) * 10 + (value % 16);
}

async function vcdInsertedGapOffset(
  filePath: string,
  fileSize: number,
): Promise<number | null> {
  if (fileSize <= VCD_HEADER_SIZE) return null;

  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(1037);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead < header.length ||
      header.subarray(1024, 1028).toString("ascii") !== "kHn "
    ) {
      return null;
    }

    const trackCount = fromBcd(header[17]);
    if (!trackCount || trackCount > 99) return null;

    let firstAudio = -1;
    for (let i = 0; i < trackCount; i++) {
      const offset = 30 + i * 10;
      if (offset + 9 >= header.length) return null;
      if (header[offset] !== 0x41) {
        firstAudio = i;
        break;
      }
    }
    if (firstAudio <= 0) return null;

    const offset = 30 + firstAudio * 10;
    const mm = fromBcd(header[offset + 7]);
    const ss = fromBcd(header[offset + 8]);
    const ff = fromBcd(header[offset + 9]);
    const adjustedFrames = mm * 60 * 75 + ss * 75 + ff - 4 * 75;
    if (adjustedFrames < 0) return null;

    const gapOffset = adjustedFrames * 2352;
    const gapSize = 150 * 2352;
    const payloadSize = fileSize - VCD_HEADER_SIZE;
    if (gapOffset + gapSize > payloadSize) return null;

    const gap = Buffer.alloc(gapSize);
    const probe = await handle.read(
      gap,
      0,
      gap.length,
      VCD_HEADER_SIZE + gapOffset,
    );
    if (probe.bytesRead !== gap.length || !gap.every((byte) => byte === 0)) {
      return null;
    }
    return gapOffset;
  } finally {
    await handle.close();
  }
}

async function wholeInputMd5Candidates(
  filePath: string,
  fileSize: number,
): Promise<string[]> {
  const digests: string[] = [];
  const exact = await md5Range(filePath, 0, fileSize);
  if (exact) digests.push(exact);

  const handle = await fs.open(filePath, "r");
  let isVcd = false;
  try {
    const signature = Buffer.alloc(4);
    const result = await handle.read(signature, 0, 4, 1024);
    isVcd =
      result.bytesRead === 4 && signature.toString("ascii") === "kHn ";
  } finally {
    await handle.close();
  }

  if (!isVcd) {
    return digests;
  }
  const payloadSize = fileSize - VCD_HEADER_SIZE;
  const direct = await md5Range(filePath, VCD_HEADER_SIZE, payloadSize);
  if (direct && !digests.includes(direct)) digests.push(direct);

  const gapOffset = await vcdInsertedGapOffset(filePath, fileSize);
  if (gapOffset !== null) {
    const gapSize = 150 * 2352;
    const reconstructed = await md5Segments(filePath, [
      { start: VCD_HEADER_SIZE, length: gapOffset },
      {
        start: VCD_HEADER_SIZE + gapOffset + gapSize,
        length: payloadSize - gapOffset - gapSize,
      },
    ]);
    if (reconstructed && !digests.includes(reconstructed)) {
      digests.push(reconstructed);
    }
  }

  return digests;
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
 * GDX-X/PFS-BatchKit-Manager provides the small shared-serial checksum table.
 * Orbit checks the exact input first and, for POPS VCDs, the payload forms that
 * can correspond to the original BIN before deciding a shared serial is safe.
 */
export async function matchPs1Conflict(
  filePath: string,
  internalGameId: string,
  _dataTrackOffset = 0,
): Promise<Ps1ConflictMatch | null> {
  const internalId = normalizeDiscId(internalGameId);
  if (!knownConflicts.has(internalId)) return null;

  const stat = await fs.stat(filePath);
  const fullRules = wholeFileRules.filter(
    (rule) => normalizeDiscId(rule.internalId) === internalId,
  );

  if (fullRules.length > 0) {
    const digests = await wholeInputMd5Candidates(filePath, stat.size);
    for (const digest of digests) {
      const match = resolveKnownPs1ConflictDigest(internalId, digest);
      if (match) return match;
    }
  }


  return null;
}
