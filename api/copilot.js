// Vercel serverless function — OPTIONAL real-model seam for the PulseIQ campaign co-pilot.
// The frontend co-pilot is scripted and works with no backend; if ANTHROPIC_API_KEY is set on
// the deployment, the "Add campaign" builder can POST here to have Claude draft the campaign
// narrative instead. Mirrors api/query.js: no dependencies, built-in fetch, Node runtime.
//
// Request:  POST /api/copilot  { name, objective, geo, issue, opponent, budget, timeframe }
// Response: { ok, draft: { ourFrame, oppFrame, segments[], carriers[], kpis[], governance } }
//
// Model + latency: uses claude-opus-4-8 with a bounded max_tokens and no extended thinking so a
// single non-streaming call comfortably finishes inside the 15s function cap (see vercel.json).

const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM =
  "You are the PulseIQ campaign co-pilot — an expert political & civic influence strategist. " +
  "Given a short campaign brief, draft a counter-/mobilisation narrative plan. " +
  "Respond with ONLY a JSON object (no prose, no code fences) of the exact shape: " +
  '{"ourFrame": string, "oppFrame": string, "segments": string[4], "carriers": string[4], ' +
  '"kpis": string[3], "governance": string}. ' +
  "ourFrame = the evidence-priced frame we advance; oppFrame = the opposing frame it counters; " +
  "segments = target audience segments incl. a matched holdout; carriers = suggested creator " +
  "archetypes; kpis = measurable outcomes; governance = the sensitive-tier / consent posture. " +
  "Keep every string concise (one line). Ground it in the honesty layer (confidence, provenance, restraint).";

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) { res.status(501).json({ error: "co-pilot API not configured — set ANTHROPIC_API_KEY in Vercel to enable the live co-pilot; the scripted co-pilot works without it" }); return; }
    const f = await readBody(req);
    const brief =
      "Campaign name: " + (f.name || "(unnamed)") + "\n" +
      "Objective: " + (f.objective || "counter") + "\n" +
      "Primary issue: " + (f.issue || "(unspecified)") + "\n" +
      "Geography / scope: " + (f.geo || "(unspecified)") + "\n" +
      "Opposing frame to counter: " + (f.opponent || "(unspecified)") + "\n" +
      "Budget (₹): " + (f.budget || "(unspecified)") + "\n" +
      "Timeframe: " + (f.timeframe || "(unspecified)");

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: brief }],
      }),
    });
    const data = await upstream.json();
    if (data.error || data.type === "error") { res.status(502).json({ error: "anthropic", detail: data.error || data }); return; }
    const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
    let draft = null;
    try { draft = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()); } catch (e) { /* fall through */ }
    if (!draft) { res.status(200).json({ ok: false, raw: text }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, draft });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
