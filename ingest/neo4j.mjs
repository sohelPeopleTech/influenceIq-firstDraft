// HTTPS Query API writer (port 443, not Bolt/7687 — same fix that got
// `load_https.mjs` working on networks that block the Bolt port).
//
// Exposes one thing: run(cypher, params) — always parameterized, never
// string-interpolated, so ingested text (creator bios, video titles, article
// headlines) can never break or inject into a query.

import { ENV } from './env.mjs';

function queryUrl() {
  const host = (ENV.NEO4J_URI || '').replace(/^neo4j\+s?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/db/${ENV.NEO4J_DATABASE}/query/v2`;
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${ENV.NEO4J_USERNAME}:${ENV.NEO4J_PASSWORD}`).toString('base64');
}

export async function run(statement, parameters = {}) {
  if (!ENV.NEO4J_URI || !ENV.NEO4J_PASSWORD) {
    throw new Error('Neo4j credentials missing — check graph/.env');
  }
  const res = await fetch(queryUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ statement, parameters }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.errors && data.errors.length)) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Merge one node. `labels` is e.g. ['Creator'] — always gets the shared
 * :Entity label too, matching every other node in this graph.
 * `props` must include `id`; everything else is set on the node.
 */
export async function mergeNode(labels, props) {
  if (!props.id) throw new Error('mergeNode: props.id is required');
  // Merge by id only (never duplicates on re-run), then apply labels + all
  // properties — same idempotent MERGE convention the existing loaders use.
  const cypher =
    'MERGE (n:Entity {id:$id}) ' +
    labels.map((l) => `SET n:${l}`).join(' ') +
    ' SET n += $props';
  return run(cypher, { id: props.id, props });
}

/**
 * Merge one directed edge between two existing node ids.
 */
export async function mergeEdge(fromId, type, toId, props = {}) {
  const cypher =
    'MATCH (a:Entity {id:$fromId}), (b:Entity {id:$toId}) ' +
    `MERGE (a)-[r:${type}]->(b) SET r += $props`;
  return run(cypher, { fromId, toId, props });
}

export async function healthCheck() {
  const r = await run('RETURN 1 AS ok');
  return !!(r.data && r.data.values && r.data.values[0] && r.data.values[0][0] === 1);
}
