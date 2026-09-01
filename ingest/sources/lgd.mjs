// G1 — Local Government Directory (data.gov.in). Free key.
// Confirmed working resource (per tracker doc): state/local-body codes +
// census mapping. Missing from this resource: sub-district/block/village
// breakdown and valid-from/to dates — not available from this endpoint at
// all, not a bug in this script.
//
// This is reference/lookup data, not a per-topic signal — call it once per
// place name you care about (e.g. the campaign's geography), not per
// keyword search like the other sources.

import { ENV } from '../env.mjs';
import { mergeNode } from '../neo4j.mjs';
import { geographyId } from '../ids.mjs';

const LGD_URL = 'https://api.data.gov.in/resource/1a6c26ed-d67c-40ea-aa20-d38d35f341a5';

export async function ingestLgd({ placeName, campaignId, limit = 20 }) {
  if (!ENV.DATA_GOV_IN_API_KEY) {
    return { skipped: true, reason: 'DATA_GOV_IN_API_KEY not set in graph/.env' };
  }
  if (!placeName) return { skipped: true, reason: 'no placeName given for this campaign' };

  const url = new URL(LGD_URL);
  url.searchParams.set('api-key', ENV.DATA_GOV_IN_API_KEY);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  // data.gov.in filters use filters[<field>]=<value>
  url.searchParams.set('filters[localBodyNameEnglish]', placeName);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`data.gov.in LGD request failed: HTTP ${res.status}`);
  const data = await res.json();
  console.log(`[lgd] raw response:`, JSON.stringify(data).slice(0, 2000));
  const records = data.records || [];
  if (!records.length) return { count: 0, note: `no LGD match for "${placeName}"` };

  let written = 0;
  for (const r of records) {
    const code = r.localBodyCode || r.entityCode;
    if (!code) continue;
    await mergeNode(['Geography'], {
      id: geographyId(code),
      name: r.localBodyNameEnglish || r.entityName || placeName,
      nodeType: 'Geography',
      layer: 'operational',
      source: 'lgd',
      campaignId,
      stateCode: r.stateCode || null,
      stateName: r.stateNameEnglish || null,
      localBodyType: r.localBodyTypeName || null,
      census2011StateCode: r.stateCensus2011Code || null,
      census2011LocalBodyCode: r.localBodyCensus2011Code || null,
    });
    written++;
  }

  return { count: written };
}
