// One log file per ingestion run: graph/logs/ingest-<campaignId>-<timestamp>.log
// Every line is timestamped. Nothing in here ever throws — a logging failure
// must never be the thing that crashes an ingestion run.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logDir = join(__dirname, '..', '..', 'logs'); // graph/logs

export function createLogger(campaignId) {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const file = join(logDir, `ingest-${campaignId || 'run'}-${Date.now()}.log`);
  const events = [];

  function write(line) {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    events.push(stamped);
    console.log(stamped);
    try {
      appendFileSync(file, stamped + '\n');
    } catch (e) {
      // Logging to disk failed (e.g. read-only filesystem) — still visible
      // on console above, so the run continues either way.
    }
  }

  return {
    file,
    info: (msg) => write(`INFO  ${msg}`),
    ok: (source, msg) => write(`OK    [${source}] ${msg}`),
    warn: (source, msg) => write(`WARN  [${source}] ${msg}`),
    fail: (source, err) => write(`FAIL  [${source}] ${err && err.message ? err.message : err}`),
    events,
  };
}

/**
 * Run one data source safely: catches everything, logs it, and always
 * resolves (never rejects) so one broken API can never take down the rest
 * of the ingestion run or bubble up as a UI error.
 */
export async function safeRun(logger, sourceName, fn) {
  try {
    const result = await fn();
    logger.ok(sourceName, `done — ${result && result.count != null ? result.count + ' items' : 'ok'}`);
    return { source: sourceName, status: 'ok', ...result };
  } catch (err) {
    logger.fail(sourceName, err);
    return { source: sourceName, status: 'failed', error: String(err && err.message || err) };
  }
}
