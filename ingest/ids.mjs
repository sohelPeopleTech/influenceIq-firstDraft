// Stable ID helpers. Ingested nodes use a distinct namespace so they can
// never collide with the synthetic scenario IDs already in the graph
// (P-0303, CN-4001, etc.) — every ingested ID carries a -LIVE- marker plus
// the source's own natural key, so re-running ingestion always MERGEs onto
// the same node instead of creating duplicates.

import { createHash } from 'node:crypto';

export function shortHash(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 10);
}

export const creatorId = (platform, nativeId) => `P-LIVE-${platform}-${nativeId}`;
export const accountId = (platform, nativeId) => `ACC-LIVE-${platform}-${nativeId}`;
export const contentId = (platform, nativeId) => `CN-LIVE-${platform}-${nativeId}`;
export const evidenceId = (source, key) => `EV-LIVE-${source}-${shortHash(key)}`;
export const geographyId = (code) => `GE-LGD-${code}`;
export const organisationId = (name) => `OR-LIVE-${shortHash(name.toLowerCase())}`;

export function truncate(text, max = 500) {
  if (!text) return text;
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
