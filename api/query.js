// Vercel serverless function — proxies a FIXED set of read-only Cypher queries to the
// Neo4j Aura HTTP Query API. The client invokes queries by NAME only (never raw Cypher),
// and the campaign filter is passed as a Neo4j query PARAMETER ($cid) — never string-
// interpolated — so there is no injection surface. Credentials come from Vercel env vars
// (NEO4J_QUERY_URL / NEO4J_USER / NEO4J_PASSWORD) and are never shipped to the browser.
// Runs on Vercel's Node runtime — built-in fetch/Buffer, no dependencies, no build.

// Each query: { cy: <cypher>, cid: true if it takes the $cid campaign parameter }
const QUERIES = {
  health: { cy: "RETURN 1 AS ok" },
  meta: { cy: "MATCH (n) RETURN n.layer AS layer, count(*) AS c ORDER BY c DESC" },
  // list campaigns for the switcher: InfluenceIQ → PulseIQ → campaigns
  campaigns: {
    cy:
      "MATCH (c:Campaign) " +
      "OPTIONAL MATCH (c)-[:IN_MODULE]->(m:Module) " +
      "RETURN c.id AS id, coalesce(c.campaign, c.name, c.id) AS name, coalesce(c.stage,'') AS stage, coalesce(m.name,'PulseIQ') AS module " +
      "ORDER BY id",
  },
  // one campaign's operational subgraph (scoped by n.campaignId = $cid)
  graph: {
    cid: true,
    cy:
      "MATCH (n) WHERE n.layer='operational' AND ($cid IS NULL OR n.campaignId=$cid) " +
      "WITH collect({id:n.id, label:coalesce(n.name,n.id), type:n.nodeType, layer:n.layer}) AS nodes " +
      "MATCH (a)-[r]->(b) WHERE a.layer='operational' AND b.layer='operational' " +
      "AND ($cid IS NULL OR (a.campaignId=$cid AND b.campaignId=$cid)) " +
      "RETURN nodes AS nodes, collect({from:a.id, to:b.id, type:type(r)}) AS edges",
  },
  ranking: {
    cid: true,
    cy:
      "MATCH (c:Creator)-[s:SUITABILITY_FOR]->(:Campaign) WHERE s.campaignId=$cid " +
      "RETURN c.id AS id, c.name AS name, s.suitabilityIndex AS idx, s.decision AS decision " +
      "ORDER BY s.suitabilityIndex DESC",
  },
  suitability: {
    cid: true,
    cy:
      "MATCH (c:Creator)-[s:SUITABILITY_FOR]->(:Campaign) WHERE s.campaignId=$cid " +
      "RETURN c.id AS id, s.audMatch AS audMatch, s.geoMatch AS geoMatch, s.issueAuth AS issueAuth, " +
      "s.engQual AS engQual, s.trust AS trust, s.network AS network, s.history AS history, " +
      "s.formatFit AS formatFit, s.avail AS avail, s.costEff AS costEff, s.riskAdj AS riskAdj, " +
      "s.rawProduct AS rawProduct, s.suitabilityIndex AS index, s.confidence AS confidence, s.decision AS decision " +
      "ORDER BY s.suitabilityIndex DESC",
  },
  // real content pulled in by graph/scripts/ingest/ (youtube/gdelt/rss), scoped
  // to one campaign — this is what actually came from the live APIs, distinct
  // from the synthetic scenario Content nodes that ship with the demo.
  liveSignals: {
    cid: true,
    cy:
      "MATCH (n:Content) WHERE n.campaignId=$cid AND n.source IN ['youtube','gdelt','rss'] " +
      "RETURN n.id AS id, n.name AS title, n.source AS source, n.url AS url, " +
      "n.publishedAt AS publishedAt, coalesce(n.publisherDomain, n.outlet) AS outlet, " +
      "n.views AS views, n.likes AS likes " +
      "ORDER BY n.publishedAt DESC LIMIT 30",
  },
  // real Creator nodes ingested from YouTube for this campaign — this is the
  // ONLY thing behind Creator Intelligence that is not hardcoded (see
  // CARRIER_POOL in app.js). No suitability scoring here on purpose: a
  // YouTube keyword search gives no audience-overlap, trust, or historical
  // data, so we do not fabricate an 11-factor score for these.
  liveCreators: {
    cid: true,
    cy:
      "MATCH (c:Creator) WHERE c.campaignId=$cid AND c.source='youtube' " +
      "OPTIONAL MATCH (c)-[:OPERATES]->(:CreatorAccount)-[:PUBLISHED]->(content:Content) " +
      "WITH c, count(content) AS videoCount, sum(coalesce(content.views,0)) AS totalViews, " +
      "collect(content)[0] AS sample " +
      "RETURN c.id AS id, c.name AS name, videoCount, totalViews, c.subscriberCount AS subscriberCount, " +
      "sample.url AS sampleUrl, sample.name AS sampleTitle, sample.thumbnail AS thumbnail " +
      // highest subscribers first; channels with an unknown/hidden count
      // (null) sort last, never mixed in among real zero-subscriber channels
      "ORDER BY coalesce(c.subscriberCount, -1) DESC",
  },
};

module.exports = async (req, res) => {
  try {
    const name = (req.query && req.query.q) || "health";
    const spec = QUERIES[name];
    if (!spec) {
      res.status(400).json({ error: "unknown query", allowed: Object.keys(QUERIES) });
      return;
    }
    const url = process.env.NEO4J_QUERY_URL;
    const user = process.env.NEO4J_USER;
    const pass = process.env.NEO4J_PASSWORD;
    if (!url || !user || !pass) {
      res.status(500).json({ error: "server not configured — set NEO4J_QUERY_URL / NEO4J_USER / NEO4J_PASSWORD in Vercel" });
      return;
    }
    // campaign filter passed as a bound parameter (never interpolated); defaults to CP-11
    const body = { statement: spec.cy };
    if (spec.cid) {
      const cid = (req.query && req.query.c) || "CP-11";
      body.parameters = { cid: String(cid) };
    }
    const auth = Buffer.from(user + ":" + pass).toString("base64");
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + auth },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    if (data.errors && data.errors.length) {
      res.status(502).json({ error: "neo4j", detail: data.errors });
      return;
    }
    const fields = (data.data && data.data.fields) || [];
    const values = (data.data && data.data.values) || [];
    const rows = values.map((v) => Object.fromEntries(fields.map((f, i) => [f, v[i]])));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ query: name, rows });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
