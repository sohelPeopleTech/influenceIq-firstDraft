// S9 — GDELT Project DOC API. Free, no key, updated continuously.
// Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
//
// GDELT's DOC/ArtList endpoint only ever returns a headline + link + date —
// never full article text, author, or a clean publisher name (confirmed
// limitation from the tracker doc). So each result becomes:
//   Content  (CN-LIVE-GDELT-<hash of url>) — headline-level record only
//   Evidence (EV-LIVE-gdelt-<hash>)        — provenance: where this came
//                                             from, when we fetched it
// Edge: MENTIONS(Content->Issue) if issueId given.
//
// NOTE: GDELT does not classify *which narrative* an article advances —
// that's an interpretive/ML step, not something an API returns. This
// ingestion deliberately does NOT invent Narrative nodes; it only lands
// raw signal (Content + Evidence) for a human or a later scoring step to
// classify. Flagging this so it's not mistaken for a gap/bug.

import { mergeNode, mergeEdge } from '../neo4j.mjs';
import { contentId, evidenceId, truncate } from '../ids.mjs';

const DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

// GDELT's connection occasionally hangs past Node's default ~10s connect
// timeout (seen in practice, not just theoretical) — retrying once or
// twice on exactly that failure fixes it most of the time, since it's a
// transient network stall, not a bad request.
async function fetchWithRetry(url, options, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      console.log(`[gdelt] attempt ${i}/${attempts} failed: ${err.cause?.message || err.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

export async function ingestGdelt({ topic, campaignId, issueId, maxRecords = 15 }) {
  const url = new URL(DOC_URL);
  url.searchParams.set('query', topic);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('format', 'json');

  console.log(`[gdelt] GET ${url.toString()}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetchWithRetry(url, {
      // GDELT's edge (Cloudflare) silently drops requests with no
      // User-Agent — Node's fetch sends none by default. This is what was
      // causing the generic "fetch failed" with no real error detail.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfluenceIQ/1.0)' },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`GDELT request failed (network, after retries): ${err.cause?.message || err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`GDELT request failed: HTTP ${res.status}`);

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // GDELT returns HTML instead of JSON on some malformed/edge-case queries
    throw new Error(`GDELT returned non-JSON (first 200 chars): ${raw.slice(0, 200)}`);
  }
  console.log(`[gdelt] raw response:`, JSON.stringify(data).slice(0, 2000));

  const articles = data.articles || [];
  if (!articles.length) return { count: 0, note: 'no articles matched this topic' };

  let written = 0;
  for (const a of articles) {
    if (!a.url) continue;
    const cId = contentId('GDELT', a.url);
    const eId = evidenceId('gdelt', a.url);

    await mergeNode(['Content'], {
      id: cId,
      name: truncate(a.title, 200),
      nodeType: 'Content',
      layer: 'operational',
      source: 'gdelt',
      campaignId,
      contentType: 'article',
      url: a.url,
      publishedAt: a.seendate || null, // format e.g. 20260623T150000Z
      language: a.language || null,
      publisherDomain: a.domain || null,
      publisherCountry: a.sourcecountry || null,
      image: a.socialimage || null,
    });

    await mergeNode(['Evidence'], {
      id: eId,
      name: `GDELT article record — ${a.domain || 'unknown source'}`,
      nodeType: 'Evidence',
      layer: 'operational',
      source: 'gdelt',
      campaignId,
      evidenceType: 'observed',
      fetchedAt: new Date().toISOString(),
      sourceUrl: a.url,
    });

    await mergeEdge(eId, 'SUPPORTS', cId).catch(() => {}); // best-effort; edge type may not exist in every ontology build
    if (issueId) await mergeEdge(cId, 'MENTIONS', issueId);
    written++;
  }

  return { count: written };
}
