// POST /api/ingest — triggers real-data ingestion for a campaign.
// Body: { topic, campaignId, geo?, issueId? }
//
// IMPORTANT — a known limitation, not hidden:
// Vercel serverless functions are capped at 15s (see ../vercel.json). This
// pipeline calls 3-4 external APIs in sequence and can easily take longer
// than that once you're pulling real volume. Locally (via devserver.mjs)
// there is no such cap, so this works end-to-end for development. Before
// deploying this endpoint to Vercel for real use, it should become a
// background job (e.g. a queue + polling status endpoint) rather than a
// single synchronous request — flagging this now so it's a planned next
// step, not a surprise later.
//
// CommonJS on purpose (matches query.js / copilot.js in this folder); the
// ingestion pipeline itself is ES modules, loaded here via dynamic import()
// — the standard, version-safe way to call ESM from CommonJS.

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const body = await readBody(req);
  const { topic, campaignId, geo, issueId } = body;
  if (!topic || !campaignId) {
    res.status(400).json({ error: 'topic and campaignId are required' });
    return;
  }
  try {
    const { ingestCampaign } = await import('../../graph/scripts/ingest/run.mjs');
    const summary = await ingestCampaign({ topic, campaignId, geo, issueId });
    res.status(summary.ok ? 200 : 502).json(summary);
  } catch (err) {
    // Belt-and-braces — ingestCampaign already catches internally, but this
    // guarantees the UI never sees a raw crash even if something upstream
    // of that changes later.
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
};
