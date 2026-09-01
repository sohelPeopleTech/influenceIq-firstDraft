#!/usr/bin/env node
// InfluenceIQ live ingestion — pulls real data from 4 free/cheap public
// APIs and writes it into Neo4j under a campaign's campaignId, using the
// same node/edge shapes as the existing synthetic scenarios so the
// dashboard needs zero changes to display it.
//
// Usage:
//   node run.mjs --topic "student protest" --campaign CP-LIVE-01
//   node run.mjs --topic "student protest" --campaign CP-LIVE-01 --geo Bengaluru --issue IS-03
//
// Every source is wrapped in safeRun — if one API is down, misconfigured,
// or rate-limited, it's logged and skipped; it never stops the others and
// never throws up to a caller (e.g. the API endpoint / UI button).

import { createLogger, safeRun } from './logger.mjs';
import { healthCheck } from './neo4j.mjs';
import { ingestYoutube } from './sources/youtube.mjs';
import { ingestGdelt } from './sources/gdelt.mjs';
import { ingestRss } from './sources/rss.mjs';
import { ingestLgd } from './sources/lgd.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

export async function ingestCampaign({ topic, campaignId, geo, issueId }) {
  const logger = createLogger(campaignId);
  logger.info(`Starting ingestion — topic="${topic}" campaign=${campaignId}${geo ? ` geo=${geo}` : ''}${issueId ? ` issue=${issueId}` : ''}`);

  try {
    await healthCheck();
  } catch (err) {
    logger.fail('neo4j', err);
    return { ok: false, error: 'Could not reach Neo4j — check graph/.env', log: logger.file };
  }
  logger.ok('neo4j', 'connected');

  const results = {};
  results.youtube = await safeRun(logger, 'youtube', () => ingestYoutube({ topic, campaignId, issueId }));
  results.gdelt = await safeRun(logger, 'gdelt', () => ingestGdelt({ topic, campaignId, issueId }));
  results.rss = await safeRun(logger, 'rss', () => ingestRss({ topic, campaignId, issueId }));
  if (geo) {
    results.lgd = await safeRun(logger, 'lgd', () => ingestLgd({ placeName: geo, campaignId }));
  }

  const totalWritten = Object.values(results).reduce((sum, r) => sum + (r.count || 0), 0);
  logger.info(`Done. ${totalWritten} items written across ${Object.keys(results).length} sources.`);

  return { ok: true, totalWritten, results, log: logger.file };
}

// Run directly from the CLI (not when imported by web/api/ingest.js)
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.topic || !args.campaign) {
    console.error('Usage: node run.mjs --topic "..." --campaign CP-XX [--geo "..."] [--issue IS-XX]');
    process.exit(1);
  }
  const summary = await ingestCampaign({
    topic: args.topic,
    campaignId: args.campaign,
    geo: args.geo,
    issueId: args.issue,
  });
  console.log('\n' + JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}
