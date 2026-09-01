// Loads graph/.env (same file the Neo4j loaders use) plus the new API-key
// variables this ingestion pipeline needs. No dependency on `dotenv` so this
// works even before `npm install` has run.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '..', '.env'); // graph/.env

const fileEnv = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    fileEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function get(name, fallback) {
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

export const ENV = {
  NEO4J_URI: get('NEO4J_URI'),
  NEO4J_USERNAME: get('NEO4J_USERNAME', 'neo4j'),
  NEO4J_PASSWORD: get('NEO4J_PASSWORD'),
  NEO4J_DATABASE: get('NEO4J_DATABASE', 'neo4j'),

  // --- new: ingestion API keys ---
  // YouTube Data API v3 — free Google Cloud key, no card needed, 10,000
  // quota units/day. https://console.cloud.google.com/apis/credentials
  YOUTUBE_API_KEY: get('YOUTUBE_API_KEY'),

  // data.gov.in — free API key from https://data.gov.in/user/register
  // Used for the LGD (Local Government Directory) resource.
  DATA_GOV_IN_API_KEY: get('DATA_GOV_IN_API_KEY'),

  // GDELT and RSS feeds need no key at all.
};

export function requireEnv(names) {
  const missing = names.filter((n) => !ENV[n]);
  return missing; // caller decides whether to skip or throw
}
