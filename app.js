/* InfluenceIQ prototype — views + routing over baked-in Tunnel-scenario data.
   Vanilla JS, no build step. Data: window.IIQ (data.js). Graph: vis-network (CDN). */
(function () {
  "use strict";
  const IIQ = window.IIQ || {};
  const $ = (id) => document.getElementById(id);

  /* --------------- campaign state layer --------------- */
  // `D` is the merged working view every render reads (ref ⊕ active campaign). Reassigned on switch,
  // so the ~12 views keep reading D.<key> unchanged. See useCampaign().
  let ACTIVE = null;
  let MODULE = "pulse";        // which IQ we are inside: 'pulse' | 'brand'
  let D = {};
  const platform = () => IIQ.platform || { suite: {}, modules: [] };
  const moduleDefs = () => platform().modules || [];
  function moduleDef(key) { return moduleDefs().find((m) => m.key === (key || MODULE)) || moduleDefs()[0] || {}; }
  function allCampaignIds() {
    const cs = IIQ.campaigns || {};
    return cs.__order || Object.keys(cs).filter((k) => k !== "__order");
  }
  // A campaign declares its module in its own config; PulseIQ campaigns predate the field.
  function moduleOfCampaign(id) { return (((IIQ.campaigns || {})[id] || {}).config || {}).module || "pulse"; }
  function campaignList(modKey) {
    const want = modKey || MODULE;
    return allCampaignIds().filter((id) => moduleOfCampaign(id) === want)
      .map((id) => Object.assign({ id }, (IIQ.campaigns || {})[id] || {}));
  }
  function buildD(id) {
    const ref = IIQ.ref || {};
    const camp = (IIQ.campaigns || {})[id] || {};
    const m = Object.assign({}, ref, camp);
    m.glossary = IIQ.glossary || {};
    m.cfg = camp.config || {};
    // BrandIQ layers a reference delta on the shared engine, and hangs the campaign off a brand
    // account — the structural difference between an episodic module and an always-on one.
    m.brandRef = IIQ.brandRef || {};
    m.account = (IIQ.accounts || {})[m.cfg.account] || null;
    // graph = reference layer ⊕ this campaign's operational layer (edges resolved to present nodes)
    const gref = ref.graphRef || { nodes: [], edges: [] };
    const gops = camp.graphOps || { nodes: [], edges: [] };
    const nodes = (gref.nodes || []).concat(gops.nodes || []);
    const nid = new Set(nodes.map((n) => n.id));
    const edges = (gref.edges || []).concat(gops.edges || []).filter((e) => nid.has(e.from) && nid.has(e.to));
    m.graph = { nodes, edges };
    // recommendations: shared KB list, per-campaign highlight
    const hi = new Set(camp.recHighlights || []);
    m.recommendations = (ref.recommendations || []).map((r) => Object.assign({}, r, { highlight: hi.has(r.id) ? 1 : 0 }));
    return m;
  }
  function useCampaign(id) {
    const cs = IIQ.campaigns || {};
    if (!cs[id]) { const l = allCampaignIds(); if (!l.length) return; id = l[0]; }
    MODULE = moduleOfCampaign(id);
    ACTIVE = id;
    try { localStorage.setItem("pulse.campaign", id); } catch (e) {}
    D = buildD(id);
    if (typeof initLiveCampaign === "function" && window.__LIVE) { try { initLiveCampaign(id); } catch (e) {} }
    route();
  }
  // active-campaign config accessors (de-hardcode the single-campaign literals)
  const NARR_DEFAULT = ["#3987e5", "#199e70", "#c98500", "#d95926", "#9085e9", "#e66767", "#d55181", "#008300"];
  function heroNarr() { const c = D.cfg || {}; return (c.heroNarratives && c.heroNarratives.length) ? c.heroNarratives : (D.narratives || []).map((n) => n.id); }
  function narrColorMap() {
    const c = D.cfg || {}; if (c.narrColor) return c.narrColor;
    const m = {}; heroNarr().forEach((id, i) => { m[id] = NARR_DEFAULT[i % NARR_DEFAULT.length]; }); return m;
  }
  function defSpread() { const c = D.cfg || {}; return c.defaultSpreadNarrative || heroNarr()[0] || null; }
  function ppOutcome() { return (D.outcomes || []).find((o) => /[+-]?\d[\d.]*\s*pp/i.test(String(o.value || ""))); }
  function cfgName() { return (D.cfg && (D.cfg.fullName || D.cfg.name)) || "Campaign"; }
  function latestCounterShare() {
    const nid = defSpread(); if (!nid) return null;
    const rows = (D.trending || []).filter((r) => r.narrative === nid).sort((a, b) => String(a.week).localeCompare(String(b.week)));
    return rows.length ? rows[rows.length - 1].counterShare : null;
  }
  function qualifiedReachLabel() {
    const o = (D.outcomes || []).find((x) => /reach/i.test(String(x.outcome || "")));
    if (o && o.value) return String(o.value);
    const q = (D.exposures || []).reduce((a, x) => a + (firstNum(x.qualified) || 0), 0);
    return q ? compact(q) : "—";
  }
  function riskFailCreator() {
    const nr = (D.creators || []).filter((c) => c.suitability && /not recommended|excluded/i.test(c.suitability.decision || ""))
      .sort((a, b) => (a.suitability.index || 0) - (b.suitability.index || 0));
    if (nr.length) return nr[0];
    const pair = (D.cfg && D.cfg.collapseStory && D.cfg.collapseStory.pair) || [];
    return pair.length ? by(D.creators, pair[0]) : null;
  }

  /* ---------------- helpers ---------------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (k === "dataset") for (const d in v) e.dataset[d] = v[d];
      else if (k.startsWith("on") && typeof v === "function") e[k.toLowerCase()] = v;
      else e.setAttribute(k, v);
    }
    append(e, kids);
    return e;
  }
  function append(e, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(e, k);
      else e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("en-IN");
  function compact(n) { n = Number(n); if (isNaN(n)) return "—";
    if (n >= 1e7) return (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + " Cr";
    if (n >= 1e5) return (n / 1e5).toFixed(1) + " L";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
    return String(Math.round(n)); }
  const pct = (n) => (n == null || isNaN(n)) ? "—" : Math.round(Number(n) * 100) + "%";
  const rs = (n) => "₹" + compact(n);
  const firstNum = (s) => { const m = String(s ?? "").match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const twoNums = (s) => { const m = String(s ?? "").match(/(-?\d+(?:\.\d+)?)\D+(-?\d+(?:\.\d+)?)/); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; };
  const by = (arr, id) => (arr || []).find((x) => x.id === id);

  /* --------------- semantic color mapping --------------- */
  function confClass(c) { c = (c || "").toLowerCase();
    if (/platform-verified|campaign-validated|survey-validated|verified|very high/.test(c)) return "good";
    if (/strongly/.test(c)) return "blue";
    if (/moderately|medium/.test(c)) return "warn";
    if (/weakly|low/.test(c)) return "serious";
    return "muted"; }
  function stageClass(s) { s = (s || "").toLowerCase();
    if (/growing/.test(s)) return "warn";
    if (/peak/.test(s)) return "critical";
    if (/emerging/.test(s)) return "blue";
    if (/declin/.test(s)) return "good";
    return "muted"; }
  const STAGE_HEX = { warn: "#fab219", critical: "#d03b3b", blue: "#3987e5", good: "#199e70", muted: "#898781" };
  function stanceClass(s) { s = (s || "").toLowerCase();
    if (/anti|oppos/.test(s)) return "critical";
    if (/pro|incumbent|support|champion/.test(s)) return "blue";
    if (/mixed|neutral|coverage/.test(s)) return "warn";
    return "muted"; }
  function decisionClass(d) { d = (d || "").toLowerCase();
    if (/blocked|not recommended|excluded|conflict|collapse/.test(d)) return "critical";
    if (/holdout/.test(d)) return "blue";          // before activate: "HOLDOUT (not activated…)"
    if (/activate/.test(d)) return "good";
    if (/engage|monitor/.test(d)) return "warn";
    return "muted"; }
  const badge = (text, cls) => h("span", { class: "badge b-" + cls }, text);
  const confBadge = (c) => explain(badge(c || "Unknown", confClass(c)), "confidence", c);

  /* --------------- SVG line chart (the one hand-rolled chart) --------------- */
  function lineChart(weeks, seriesMap, colorMap, labelMap) {
    const W = 840, H = 300, L = 44, R = 104, T = 16, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const names = Object.keys(seriesMap);
    let maxY = 0; names.forEach((n) => seriesMap[n].forEach((v) => { if (v > maxY) maxY = v; }));
    const step = niceStep(maxY / 4); maxY = Math.max(step * 4, step);
    const n = weeks.length;
    const x = (i) => L + (n <= 1 ? pw / 2 : pw * i / (n - 1));
    const y = (v) => T + ph * (1 - v / maxY);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">`;
    for (let g = 0; g <= 4; g++) { const yy = T + ph * g / 4; const val = maxY * (1 - g / 4);
      s += `<line class="grid-line" x1="${L}" y1="${yy}" x2="${L + pw}" y2="${yy}"/>`;
      s += `<text class="axis-tx" x="${L - 8}" y="${yy + 3}" text-anchor="end">${compact(val)}</text>`; }
    const tickEvery = Math.max(1, Math.round(n / 6));
    for (let i = 0; i < n; i += tickEvery) s += `<text class="axis-tx" x="${x(i)}" y="${H - 10}" text-anchor="middle">${shortDate(weeks[i])}</text>`;
    names.forEach((nm) => { const col = colorMap[nm] || "#3987e5"; const arr = seriesMap[nm];
      let pts = arr.map((v, i) => `${x(i)},${y(v)}`).join(" ");
      s += `<polyline class="serie" points="${pts}" stroke="${col}"/>`;
      arr.forEach((v, i) => { s += `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${col}"><title>${esc(labelMap[nm] || nm)} · ${shortDate(weeks[i])}: ${nf(v)} items</title></circle>`; });
      const ly = Math.max(T + 6, Math.min(H - B, y(arr[arr.length - 1])));
      s += `<text x="${L + pw + 8}" y="${ly + 3}" fill="${col}" font-size="11" font-weight="600">${esc(nm)}</text>`; });
    s += `<line class="axis-line" x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}"/></svg>`;
    return s;
  }
  function niceStep(x) { if (x <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  const shortDate = (d) => { const m = String(d).match(/\d{4}-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[1]}` : String(d); };

  /* --------------- trending aggregation --------------- */
  function trendSeries(narrs) {
    const rows = D.trending || [];
    const weeks = [...new Set(rows.map((r) => r.week))].sort();
    const wi = Object.fromEntries(weeks.map((w, i) => [w, i]));
    const series = {};
    narrs.forEach((nr) => { series[nr] = weeks.map(() => 0); });
    rows.forEach((r) => { if (series[r.narrative] && r.week in wi && r.volume != null) series[r.narrative][wi[r.week]] += Number(r.volume) || 0; });
    return { weeks, series };
  }
  // narrative colours are campaign-specific — see narrColorMap()

  /* --------------- factor bars --------------- */
  function factorBars(suit, creator) {
    if (!suit) return h("div", { class: "muted" }, "No suitability score for this brief.");
    const wrap = h("div", { class: "fbars" });
    (D.factors || []).forEach((f) => {
      const v = suit[f.key]; if (v == null) return;
      const b = bandOf(v); const crit = v < 0.2;
      const bar = h("div", { class: "fbar" + (crit ? " crit" : "") },
        h("div", { class: "fb-label" }, f.label),
        h("div", { class: "fb-track" }, h("div", { class: "fb-fill", style: { width: Math.max(2, v * 100) + "%" } })),
        h("div", { class: "fb-val" }, v.toFixed(2)));
      explain(bar, "factors", v, creator);
      // When we know the creator, print the real-world "why" under the bar — the whole point of the drill-down.
      if (creator && creator.suitability) {
        wrap.appendChild(h("div", { class: "fbar-row" }, bar,
          h("div", { class: "fb-why" },
            h("span", { class: "fb-why-tag " + BAND_CLASS[b] }, BAND_LABEL[b]),
            h("span", { class: "fb-why-text" }, factorReason(creator, f.key, v)))));
      } else {
        wrap.appendChild(bar);
      }
    });
    return wrap;
  }

  /* ================= VIEWS ================= */
  const views = {};

  /* ---- Command Center ---- */
  views.command = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Command Center", (D.cfg && D.cfg.scenarioBlurb) || ("One contest, end to end — " + cfgName() + ".")));

    // KPIs
    const acts = D.activations || [];
    const sum = (k) => acts.reduce((a, x) => a + (firstNum(x[k]) || 0), 0);
    const fb = (D.cfg && D.cfg.fundedBrief) || {};
    const lift = ppOutcome();
    const kpis = [
      ["Tracked narratives", String((D.narratives || []).length), cfgName() + " · " + heroNarr().join(", "), null, "stage"],
      ["Creators evaluated", String((D.creators || []).length), "fully evidenced actors"],
      ["Campaign budget", rs(firstNum(D.campaign?.["Budget / spend"]) || (D.cfg && D.cfg.budget) || 0), (D.cfg && D.cfg.id) + " · " + (D.cfg && D.cfg.objectiveLabel || "campaign"), null, "budget"],
      ["Portal submissions", nf(sum("submissions")), "+ " + nf(sum("registrations")) + " townhall regs"],
      ["Cost per action", fb.cpa ? "₹" + nf(fb.cpa) : "—", "observed", "good", "reach"],
      lift ? ["Net lift", String(lift.value).replace(/\s*->.*/, ""), (lift.interval || "vs holdout"), "good", "incrementality"]
           : ["Counter-share", pct(latestCounterShare()), "on " + (defSpread() || "lead narrative"), "good", "counterShare"],
    ];
    wrap.appendChild(h("div", { class: "kpis" }, kpis.map((k) => {
      const tile = h("div", { class: "kpi" }, h("div", { class: "k-label" }, k[0]),
        h("div", { class: "k-val" }, k[1]), h("div", { class: "k-sub" + (k[3] ? " " + k[3] : "") }, k[2]));
      return k[4] ? explain(tile, k[4], k[1]) : tile;
    })));

    // Narrative board
    wrap.appendChild(sectionTitle("Narrative board", "stage classified per corridor · click a card for the hub"));
    wrap.appendChild(narrativeBoard());

    // Live Signals — real items pulled from YouTube/GDELT/RSS for this
    // campaign, via graph/scripts/ingest/. Only renders once ingestion has
    // actually written something for this campaignId; silently absent
    // otherwise (new campaign, ingestion still running, or static mode).
    const liveCard = liveSignalsCard();
    if (liveCard) {
      wrap.appendChild(sectionTitle("Live signals", "pulled just now from YouTube · GDELT · RSS — real, not scenario data"));
      wrap.appendChild(liveCard);
    }

    // Trending + timeline
    wrap.appendChild(sectionTitle("Narrative velocity", "weekly item volume across tracked narratives"));
    const two = h("div", { class: "two-col" });
    const heroes = heroNarr(); const cmap = narrColorMap();
    const { weeks, series } = trendSeries(heroes);
    const labelMap = Object.fromEntries((D.narratives || []).map((x) => [x.id, x.name]));
    two.appendChild(h("div", { class: "card" },
      h("div", { class: "chart-wrap", html: lineChart(weeks, series, cmap, labelMap) }),
      legend(heroes, cmap, labelMap)));
    two.appendChild(h("div", { class: "card" },
      h("div", { class: "card-h" }, h("h3", null, "Event timeline & early-warning"), h("span", { class: "sub" }, "E1–E4")),
      timeline()));
    wrap.appendChild(two);
    wrap.appendChild(decisionStrip());
    return wrap;
  };

  // The mutation ladder — BrandIQ's central strategic mechanic. Renders only where the campaign
  // config declares one, so PulseIQ views are untouched.
  function mutationLadder() {
    const L = (D.cfg && D.cfg.ladder); if (!L) return h("div", { style: { display: "none" } });
    const wrap = h("div");
    wrap.appendChild(sectionTitle("Mutation ladder", "each rung up, the brand is less able to respond"));
    const box = h("div", { class: "card ladder-card" });
    if (L.note) box.appendChild(h("div", { class: "ladder-note" }, L.note));
    (L.rungs || []).forEach((r, i) => {
      if (i) box.appendChild(h("div", { class: "ladder-arrow" }, h("span", null, "↓ mutates"),
        h("span", { class: "la-note" }, i === 1 ? "the story stops being about one customer" : "if it lands here, the whole category loses")));
      box.appendChild(h("div", { class: "rung tone-" + (r.tone || "warn"), onclick: () => openNarrative(r.id) },
        h("div", { class: "rung-l" }, h("span", { class: "id" }, r.id), h("span", { class: "rung-tier" }, r.tier)),
        h("div", { class: "rung-m" }, h("div", { class: "rung-label" }, r.label), h("div", { class: "rung-why" }, r.why)),
        h("div", { class: "rung-r" }, badge(r.verdict, r.tone === "critical" ? "critical" : "warn"))));
    });
    const cs = L.counters || [];
    if (cs.length) {
      box.appendChild(h("div", { class: "ladder-split" }, "The two counters"));
      cs.forEach((c) => box.appendChild(h("div", { class: "rung tone-good", onclick: () => openNarrative(c.id) },
        h("div", { class: "rung-l" }, h("span", { class: "id" }, c.id), h("span", { class: "rung-tier" }, c.kind)),
        h("div", { class: "rung-m" }, h("div", { class: "rung-label" }, c.label)),
        h("div", { class: "rung-r" }, badge(c.worksAt, "good")))));
    }
    if (L.strategy) box.appendChild(h("div", { class: "ladder-strategy" },
      h("span", { class: "ls-tag" }, "The move"), h("span", null, L.strategy)));
    wrap.appendChild(box);
    return wrap;
  }

  // The six decision points — where the platform earns its fee. Config-driven, BrandIQ only.
  function decisionStrip() {
    const DS = (D.cfg && D.cfg.decisions); if (!DS || !DS.length) return h("div", { style: { display: "none" } });
    const wrap = h("div");
    wrap.appendChild(sectionTitle("Where the fee was earned", DS.length + " decisions, " + DS.length + " wrong instincts"));
    const list = h("div", { class: "dec-list" });
    DS.forEach((d) => list.appendChild(h("div", { class: "dec-card tone-" + (d.tone || "warn") },
      h("div", { class: "dec-hd" }, h("span", { class: "dec-no" }, d.no + " · " + d.day),
        h("span", { class: "dec-q" }, d.q), badge(d.stamp, d.tone === "critical" ? "critical" : d.tone === "good" ? "good" : "warn")),
      h("div", { class: "dec-row" }, h("span", { class: "dec-k" }, "Instinct"), h("span", { class: "dec-v muted" }, d.instinct)),
      h("div", { class: "dec-row" }, h("span", { class: "dec-k" }, "Platform"), h("span", { class: "dec-v" }, d.platform)),
      h("div", { class: "dec-row" }, h("span", { class: "dec-k" }, "Proves"), h("span", { class: "dec-v dec-proves" }, d.proves)))));
    wrap.appendChild(list);
    return wrap;
  }

  // Real items ingested for the active campaign from YouTube/GDELT/RSS
  // (graph/scripts/ingest/), shown separately from the templated/scripted
  // narrative board above. Returns null (renders nothing) when there's
  // nothing yet — new campaign, ingestion still running in the background,
  // static/offline mode, or every source failed for this run.
  function liveSignalsCard() {
    const rows = window.__LIVE_SIGNALS;
    const pulling = window.__INGESTING && window.__INGESTING === ACTIVE;
    if ((!rows || !rows.length) && !pulling) return null;
    if ((!rows || !rows.length) && pulling) {
      return h("div", { class: "card" },
        h("div", { class: "card-h" }, h("h3", null, "Real items pulled for this campaign")),
        h("div", { class: "n-desc" }, "Pulling from YouTube, GDELT and RSS now — this can take up to a minute. This section updates itself the moment it's ready; no need to refresh."));
    }
    const SOURCE_LABEL = { youtube: "YouTube", gdelt: "GDELT news", rss: "RSS news" };
    const fmtDate = (s) => {
      if (!s) return "";
      // GDELT dates look like 20260828T013000Z; everything else is ISO already
      const iso = /^\d{8}T\d{6}Z$/.test(s) ? s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z") : s;
      const d = new Date(iso);
      return isNaN(d) ? s : d.toLocaleDateString();
    };
    return h("div", { class: "card" },
      h("div", { class: "card-h" }, h("h3", null, "Real items pulled for this campaign"),
        h("span", { class: "sub" }, rows.length + " items")),
      h("div", { class: "co-list" }, rows.slice(0, 12).map((r) =>
        h("div", { class: "co-li", style: { display: "flex", flexDirection: "column", gap: "2px", padding: "8px 0", borderBottom: "1px solid var(--line, #333)" } },
          h("div", null,
            badge(SOURCE_LABEL[r.source] || r.source, "blue"),
            h("span", { style: { marginLeft: "8px" } }, r.outlet || "")),
          r.url
            ? h("a", { href: r.url, target: "_blank", rel: "noopener", style: { color: "inherit" } }, r.title)
            : h("span", null, r.title),
          h("div", { class: "n-desc" }, fmtDate(r.publishedAt) +
            (r.views != null ? " · " + nf(r.views) + " views" : "")
          )))));
  }

  function narrativeBoard() {
    const board = h("div", { class: "nboard" });
    (D.narratives || []).forEach((nr) => {
      const rows = (D.trending || []).filter((r) => r.narrative === nr.id);
      const latest = rows.slice().sort((a, b) => String(a.week).localeCompare(String(b.week))).pop();
      const stage = latest?.stage || "—"; const sc = stageClass(stage);
      const cs = latest?.counterShare;
      board.appendChild(h("div", { class: "ncard", onclick: () => openNarrative(nr.id) },
        h("div", { class: "stage-strip", style: { background: STAGE_HEX[sc] } }),
        h("div", { class: "n-id" }, nr.id + " · " + (nr.class || "")),
        h("h4", null, nr.name),
        h("div", { class: "n-desc" }, nr.description),
        h("div", { class: "n-meta" },
          sbadge(stage, sc, "stage", stage),
          badge((nr.amplifiers || []).length + " carriers →", "blue"),
          cs != null ? sbadge("counter " + pct(cs), "muted", "counterShare", cs) : null)));
    });
    return board;
  }

  function timeline() {
    const events = ((D.cfg && D.cfg.timeline) || []).map((e) => [e.date, e.label, e.desc, e.tone]);
    const tl = h("div", { class: "timeline" });
    events.forEach((e) => tl.appendChild(h("div", { class: "tl-item" },
      h("div", { class: "tl-dot", style: { background: STAGE_HEX[e[3]] || "#898781" } }),
      h("div", { class: "tl-when" }, e[0]),
      h("div", { class: "tl-title" }, e[1]),
      h("div", { class: "tl-desc" }, e[2]))));
    return tl;
  }

  /* ---- Discovery & Decisions ---- */
  views.discovery = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Discovery & Search", "Resolve a plain-language brief to ranked creators. Suitability is multiplicative across eleven factors — one weak critical factor collapses the score. Scores are brief-specific, never universal."));
    wrap.appendChild(discoveryToolbar());

    const ranked = (D.creators || []).filter((c) => c.suitability).sort((a, b) => (b.suitability.index || 0) - (a.suitability.index || 0));

    // portfolio summary
    const activated = ranked.filter((c) => /activated/i.test(c.suitability.decision));
    const fees = (D.activations || []).reduce((a, x) => a + (firstNum(x.fee) || 0), 0);
    wrap.appendChild(h("div", { class: "kpis" }, [
      ["Candidates ranked", String(ranked.length), "for brief " + ((D.cfg && D.cfg.id) || "")],
      ["Portfolio selected", String(activated.length) + " creators", "low-overlap carriers"],
      ["Committed fees", rs(fees), "of " + rs((D.cfg && D.cfg.budget) || 0) + " budget"],
      ["Qualified reach", qualifiedReachLabel(), "non-overlapping", "good"],
    ].map((k) => h("div", { class: "kpi" }, h("div", { class: "k-label" }, k[0]), h("div", { class: "k-val" }, k[1]), h("div", { class: "k-sub" + (k[3] ? " " + k[3] : "") }, k[2])))));

    wrap.appendChild(sectionTitle("Ranked candidates", "click any creator for the eleven-factor breakdown & Creator 360"));
    const tbl = h("table", { class: "tbl" },
      h("thead", null, h("tr", null,
        h("th", null, "#"), h("th", null, "Creator"), h("th", null, "Reach"),
        h("th", { class: "num" }, "Aud"), h("th", { class: "num" }, "Geo"), h("th", { class: "num" }, "Authority"),
        h("th", { class: "num" }, "Trust"), h("th", { class: "num" }, "Suitability"), h("th", null, "Decision"))));
    const tb = h("tbody");
    ranked.forEach((c, i) => {
      const s = c.suitability; const r = decisionRationale(c);
      tb.appendChild(h("tr", { onclick: () => openCreator(c.id) },
        h("td", { class: "rank" }, i + 1),
        h("td", null, h("div", { style: { fontWeight: "600" } }, c.name), h("div", { class: "id" }, c.id + " · " + (c.type || "")),
          h("div", { class: "row-why" }, r.lead)),
        h("td", null, compact(c.followers || 0)),
        miniCell(s.audMatch, c, "audMatch"), miniCell(s.geoMatch, c, "geoMatch"), miniCell(s.issueAuth, c, "issueAuth"), miniCell(s.trust, c, "trust"),
        h("td", { class: "num" }, explain(h("span", { style: { fontWeight: "700", color: "#fff" } }, (s.index ?? 0).toFixed(3)), "suitabilityIndex", s.index)),
        h("td", null, sbadge(shortDecision(s.decision), decisionClass(s.decision), "decision", s.decision, c))));
    });
    tbl.appendChild(tb);
    wrap.appendChild(h("div", { class: "card pad0" }, tbl));

    // The collapse story
    wrap.appendChild(sectionTitle("The collapses", "why the multiplicative model rejects two strong-looking candidates"));
    const collapses = h("div", { class: "two-col" });
    (((D.cfg && D.cfg.collapseStory && D.cfg.collapseStory.pair) || [])).forEach((pid) => {
      const c = by(D.creators, pid); if (!c || !c.suitability) return;
      const killer = (D.factors || []).map((f) => [f, c.suitability[f.key]]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1])[0];
      collapses.appendChild(h("div", { class: "card" },
        h("div", { class: "card-h" }, h("h3", null, c.name), badge((c.suitability.index).toFixed(3), "critical")),
        h("div", { class: "muted", style: { fontSize: "12.5px", marginBottom: "10px" } }, compact(c.followers) + " followers · " + (c.stance || "")),
        factorBars(c.suitability),
        h("div", { class: "note-box crit", style: { marginTop: "12px" } },
          h("b", null, killer[0].label + " = " + killer[1].toFixed(2) + ". "),
          "A near-zero critical factor collapses the product (raw " + (c.suitability.rawProduct ?? 0) + "). Reach without " + killer[0].label.toLowerCase() + ", made visible.")));
    });
    wrap.appendChild(collapses);
    return wrap;
  };
  const miniCell = (v, c, key) => h("td", { class: "num" }, v == null ? "—" :
    explain(h("span", null, h("span", { class: "mbar" }, h("i", { style: { width: (v * 100) + "%", background: v < 0.2 ? "#d03b3b" : "#3987e5" } }))), key || "factors", v, c));
  const shortDecision = (d) => { d = d || ""; if (/activated/i.test(d)) return "Activated"; if (/holdout/i.test(d)) return "Holdout";
    if (/not recommended/i.test(d)) return "Rejected"; return d.slice(0, 18); };

  /* ---- Creator Intelligence (list) ---- */
  views.creators = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Creator Intelligence", "Every attribute is evidence-priced: accounts carry a verification basis, audience numbers carry provenance, risk is banded before contracting."));
    wrap.appendChild(h("div", { class: "hint-line" }, "Each card shows the best narrative to use this creator on — click through for the full why, the eleven-factor breakdown and content ideas."));
    const grid = h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" } });
    (D.creators || []).forEach((c) => {
      const best = c.suitability ? bestNarrativeFit(c) : null;
      grid.appendChild(h("div", { class: "card clickable", onclick: () => openCreator(c.id) },
        h("div", { class: "card-h" }, h("h3", null, c.name), c.isLive ? badge("Live · YouTube", "blue") : badge(c.stance || "—", stanceClass(c.stance))),
        h("div", { class: "id", style: { marginBottom: "8px" } }, c.id + (c.type && c.type !== "—" ? " · " + c.type : "")),
        h("div", { style: { fontSize: "12.5px", color: "var(--ink-2)", minHeight: "34px" } }, c.role || ""),
        best ? h("div", { class: "card-bestfor" },
          h("span", { class: "bf-tag badge b-" + best.tone }, best.fit),
          h("span", { class: "bf-nr" }, "on " + best.nr.name)) : null,
        h("div", { class: "divider" }),
        h("div", { class: "pill-row" },
          c.isLive
            ? [badge(c.subscriberCount != null ? compact(c.subscriberCount) + " subscribers" : "subscribers hidden", "muted"),
               badge(compact(c.totalViews || 0) + " views", "muted"),
               badge((c.videoCount || 0) + " video" + (c.videoCount === 1 ? "" : "s"), "muted"),
               badge("not yet scored", "muted")]
            : [badge(compact(c.followers || 0) + " reach", "muted"),
               badge((c.accounts || []).length + " accounts", "muted"),
               c.consent ? badge("consent " + c.consent, "good") : badge("no consent", "muted"),
               c.suitability ? badge("fit " + c.suitability.index.toFixed(2), decisionClass(c.suitability.decision)) : null])));
    });
    wrap.appendChild(grid);
    return wrap;
  };
  // The single most useful narrative for a creator (best usable fit, else the attack he carries / his conflict).
  function bestNarrativeFit(c) {
    const fits = narrativeFitsFor(c); const order = { good: 0, warn: 1, critical: 2, muted: 3 };
    return fits.slice().sort((a, b) => order[a.tone] - order[b.tone])[0];
  }

  /* ---- Audience & Evidence ---- */
  views.audience = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Audience & Evidence", "Audiences are aggregate estimates with ranges — never individuals. Every number displays value + interval + provenance, and walks back to its evidence in a click."));
    const ests = D.estimates || [];
    wrap.appendChild(h("div", { class: "kpis" }, [
      ["Audience estimates", String(ests.length), "across 16 creators"],
      ["Evidence records", String(Object.keys(D.evidence || {}).length), "provenance-linked"],
      ["Provenance classes", "6", "Platform-Verified → Inferred"],
      ["Individual rows", "0", "DPDP aggregate-only, by design", "good"],
    ].map((k) => h("div", { class: "kpi" }, h("div", { class: "k-label" }, k[0]), h("div", { class: "k-val" }, k[1]), h("div", { class: "k-sub" + (k[3] ? " " + k[3] : "") }, k[2])))));

    wrap.appendChild(sectionTitle("Where each creator's audience is", "pick a creator to see their geography made human — which areas, how strong, and what it means"));
    const filt = h("div", { class: "filters" });
    const sel = h("select", { onchange: () => renderRows(sel.value) },
      h("option", { value: "" }, "All creators"),
      (D.creators || []).map((c) => h("option", { value: c.id }, c.name)));
    filt.appendChild(sel);
    wrap.appendChild(filt);
    // Per-creator geography picture (only shown when one creator is selected).
    const geoHost = h("div");
    wrap.appendChild(geoHost);
    const host = h("div", { class: "card pad0" });
    wrap.appendChild(host);
    function renderRows(subj) {
      host.innerHTML = ""; geoHost.innerHTML = "";
      if (subj) { const c = by(D.creators, subj); const gb = c && geoBlock(c);
        if (gb) { geoHost.appendChild(h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", null, "Audience geography — " + c.name), h("span", { class: "sub" }, "corridor-aware")), gb)); } }
      const rows = ests.filter((e) => !subj || e.subject === subj).slice(0, 120);
      const tbl = h("table", { class: "tbl" },
        h("thead", null, h("tr", null,
          h("th", null, "Estimate"), h("th", null, "Creator"), h("th", null, "Dimension · area"),
          h("th", { class: "num" }, "Value"), h("th", null, "Range"), h("th", null, "Provenance"), h("th", null, "Confidence"))));
      const tb = h("tbody");
      rows.forEach((e) => { const c = by(D.creators, e.subject);
        const g = e.dimension === "geography" ? (by(D.geographies, e.geoScope || e.key) || {}) : {};
        tb.appendChild(h("tr", { onclick: () => openEstimate(e.id) },
          h("td", { class: "id" }, e.id),
          h("td", null, c ? c.name : e.subject),
          h("td", null, (e.dimension || "") + (g.name ? " · " + g.name : (e.key ? " · " + e.key : ""))),
          h("td", { class: "num", style: { color: "#fff", fontWeight: "600" } }, e.value == null ? "—" : e.value),
          h("td", { class: "num", style: { fontSize: "12px" } }, (e.lo != null && e.hi != null) ? e.lo + "–" + e.hi : "—"),
          h("td", null, badge(e.provenance || "—", confClass(e.provenance))),
          h("td", null, confBadge(e.confidence)))); });
      tbl.appendChild(tb); host.appendChild(tbl);
    }
    renderRows("");
    wrap.appendChild(audienceExtras());
    return wrap;
  };

  /* ---- Narratives & Prediction ---- */
  views.narratives = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Narratives & Prediction", "Velocity-based early-warning fires at the Emerging → Growing transition, days before peak. Spread is mapped per constituency, each with its own stage."));
    wrap.appendChild(mutationLadder());
    wrap.appendChild(sectionTitle("The tracked narratives", cfgName()));
    wrap.appendChild(narrativeBoard());
    wrap.appendChild(sectionTitle("Velocity (weekly volume, city-wide)", ""));
    const heroes = heroNarr(); const cmap = narrColorMap();
    const { weeks, series } = trendSeries(heroes);
    const labelMap = Object.fromEntries((D.narratives || []).map((x) => [x.id, x.name]));
    wrap.appendChild(h("div", { class: "card" }, h("div", { class: "chart-wrap", html: lineChart(weeks, series, cmap, labelMap) }),
      legend(heroes, cmap, labelMap)));

    // Spread table for the lead narrative (stage per geography, latest week)
    const lead = defSpread();
    wrap.appendChild(sectionTitle("Spread & penetration — " + nName(lead) + " by geography", "latest tracked week per constituency"));
    const rows = (D.trending || []).filter((r) => r.narrative === lead);
    const byGeo = {};
    rows.forEach((r) => { if (!byGeo[r.geo] || String(r.week) > String(byGeo[r.geo].week)) byGeo[r.geo] = r; });
    const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
      h("th", null, "Geography"), h("th", { class: "num" }, "Volume"), h("th", { class: "num" }, "Velocity"),
      h("th", null, "Stage"), h("th", null, "Sentiment"), h("th", null, "Top signal"))));
    const tb = h("tbody");
    Object.values(byGeo).sort((a, b) => (b.volume || 0) - (a.volume || 0)).forEach((r) =>
      tb.appendChild(h("tr", null,
        h("td", null, geoName(r.geo)), h("td", { class: "num" }, nf(r.volume)),
        h("td", { class: "num" }, r.velocity ?? "—"), h("td", null, badge(r.stage || "—", stageClass(r.stage))),
        h("td", null, r.sentiment || "—"), h("td", { class: "id" }, r.topSignal || "—"))));
    tbl.appendChild(tb);
    wrap.appendChild(h("div", { class: "card pad0" }, tbl));
    return wrap;
  };
  const geoName = (id) => { const g = by(D.geographies, id); return g ? g.name : id; };

  /* ================= BrandIQ views =================
     Reputation Radar is the one genuinely new surface: PulseIQ has no equivalent because
     campaigns end and brands do not. Compliance Gate and Category are small screens with
     disproportionate selling power in a regulated pitch. */

  // day-indexed series for any numeric trending field (brand tempo is daily, not weekly)
  function daySeries(narrs, field, geoFilter) {
    const rows = (D.trending || []).filter((r) => !geoFilter || r.geo === geoFilter);
    const days = [...new Set(rows.map((r) => r.week))].sort();
    const di = Object.fromEntries(days.map((w, i) => [w, i]));
    const series = {}; narrs.forEach((n) => { series[n] = days.map(() => 0); });
    rows.forEach((r) => { if (series[r.narrative] && r.week in di && r[field] != null) series[r.narrative][di[r.week]] = Number(r[field]) || 0; });
    return { days, series };
  }

  views.radar = function () {
    const wrap = h("div");
    const A = D.account || {}; const R = (D.cfg && D.cfg.radar) || {};
    wrap.appendChild(pageHead("Reputation Radar", "Always-on. What is forming about this brand right now, how fast it is moving, and how long before it matters. The alert fires on the velocity of new amplifiers — not on volume, which is why it fires days early."));

    // --- the brand account ---
    if (A.name) {
      const card = h("div", { class: "card acct-card" },
        h("div", { class: "acct-top" },
          h("div", null,
            h("div", { class: "acct-name" }, A.name),
            h("div", { class: "acct-sector" }, A.sector || ""),
            h("div", { class: "acct-blurb" }, A.blurb || "")),
          h("div", { class: "acct-facts" }, (A.facts || []).map((f) =>
            h("div", { class: "acct-fact" }, h("div", { class: "af-v" }, f.v), h("div", { class: "af-k" }, f.k))))));
      if (A.vulnerability) card.appendChild(h("div", { class: "acct-vuln" },
        h("span", { class: "av-tag" }, "Structural vulnerability"), h("span", null, A.vulnerability)));
      wrap.appendChild(card);
    }

    // --- the detection claim ---
    if (R.detectedAt) {
      wrap.appendChild(sectionTitle("Detection", "the five days that are the whole product"));
      const det = h("div", { class: "det-grid" },
        h("div", { class: "det-cell good" }, h("div", { class: "det-k" }, "Platform detected"), h("div", { class: "det-v" }, R.detectedAt),
          h("div", { class: "det-s" }, "on amplifier velocity (" + (R.triggerRule || "rule") + ")")),
        h("div", { class: "det-cell crit" }, h("div", { class: "det-k" }, "Volume-threshold equivalent"), h("div", { class: "det-v" }, R.humanEquivalent || "—"),
          h("div", { class: "det-s" }, "once it reached mainstream volume")),
        h("div", { class: "det-cell hero" }, h("div", { class: "det-k" }, "Warning advantage"), h("div", { class: "det-v" }, (R.advantageDays ?? "—") + " days"),
          h("div", { class: "det-s" }, "before peak, while response was still cheap")));
      wrap.appendChild(det);
      if (R.triggerText) wrap.appendChild(h("div", { class: "note-box" },
        h("b", null, "Why it fired: "), R.triggerText));
    }

    // --- watch list ---
    const W = R.watch || [];
    if (W.length) {
      wrap.appendChild(sectionTitle("Watch list", "every tracked story, its tier, and where it ended"));
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
        h("th", null, "Narrative"), h("th", null, "Tier"), h("th", null, "State"),
        h("th", { class: "num" }, "Velocity"), h("th", { class: "num" }, "Peak"), h("th", { class: "num" }, "Counter-share"), h("th", null, "Read"))));
      const tb = h("tbody");
      W.forEach((w) => {
        const tierCls = w.tier === "Counter" ? "good" : w.tier === "Brand" ? "warn" : w.tier === "Terminal" ? "critical" : "serious";
        tb.appendChild(h("tr", { class: "clickable", onclick: () => openNarrative(w.id) },
          h("td", null, h("span", { class: "id" }, w.id + " · "), nName(w.id)),
          h("td", null, badge(w.tier, tierCls)),
          h("td", null, badge(w.state, stageClass(w.state))),
          h("td", { class: "num" }, explain(h("span", null, (w.vel ?? "—") + "/d"), "velocity", w.vel)),
          h("td", { class: "num muted" }, (w.peak ?? "—") + "/d"),
          h("td", { class: "num" }, explain(h("span", null, pct(w.counter)), "counterShare", w.counter)),
          h("td", { class: "muted small-td" }, w.note || "")));
      });
      tbl.appendChild(tb);
      wrap.appendChild(h("div", { class: "card pad0" }, tbl));
    }

    // --- velocity curve (the shape the alert predicted) ---
    const heroes = heroNarr(); const cmap = narrColorMap();
    const labelMap = Object.fromEntries((D.narratives || []).map((x) => [x.id, x.name]));
    const { days, series } = daySeries(heroes, "velocity");
    if (days.length) {
      wrap.appendChild(sectionTitle("Amplifier velocity, day by day", "new amplifiers per day — the early-warning metric (MC-03)"));
      wrap.appendChild(h("div", { class: "card" },
        h("div", { class: "chart-wrap", html: lineChart(days, series, cmap, labelMap) }),
        legend(heroes, cmap, labelMap)));
    }

    if (A.fiction) wrap.appendChild(h("div", { class: "note-box warn", style: { marginTop: "18px" } },
      h("b", null, "Fully synthetic. "), A.fiction));
    return wrap;
  };

  views.compliance = function () {
    const wrap = h("div");
    const C = (D.cfg && D.cfg.compliance) || {};
    wrap.appendChild(pageHead("Compliance Gate", "Every activation passes the gate before it can go live. Blocks and refusals are logged with their rule and their basis — this log is the first thing a regulated buyer asks to see."));
    const checks = C.checks || [];
    const n = (s) => checks.filter((c) => c.state === s).length;
    wrap.appendChild(h("div", { class: "kpis" }, [
      ["Checks run", String(checks.length), "before any activation went live", null],
      ["Passed", String(n("pass")), "disclosure + consent verified", "good"],
      ["Blocked", String(n("block")), "would have made the episode worse", "warn"],
      ["Refused", String(n("refuse")), "request declined and logged", "crit"],
    ].map((k) => h("div", { class: "kpi" }, h("div", { class: "k-label" }, k[0]),
      h("div", { class: "k-val" }, k[1]), h("div", { class: "k-sub" + (k[3] ? " " + k[3] : "") }, k[2])))));

    if (C.note) wrap.appendChild(h("div", { class: "note-box" }, C.note));
    wrap.appendChild(sectionTitle("Gate log", "subject · rule · verdict · basis"));
    const list = h("div", { class: "gate-list" });
    const STATE = { pass: ["PASS", "good"], block: ["BLOCKED", "warn"], refuse: ["REFUSED", "critical"] };
    checks.forEach((c) => {
      const st = STATE[c.state] || ["—", "muted"];
      list.appendChild(h("div", { class: "gate-row gs-" + c.state },
        h("div", { class: "gate-hd" },
          h("span", { class: "gate-stamp b-" + st[1] }, st[0]),
          h("span", { class: "gate-subj" }, c.name || c.subject),
          h("span", { class: "id gate-id" }, c.subject),
          h("span", { class: "gate-rule id" }, c.rule)),
        h("div", { class: "gate-check" }, c.check),
        h("div", { class: "gate-detail" }, c.detail)));
    });
    wrap.appendChild(list);
    return wrap;
  };

  views.category = function () {
    const wrap = h("div");
    const S = (D.cfg && D.cfg.sov) || {};
    wrap.appendChild(pageHead("Category & Competitors", "Share of voice on the category conversation, and what the competition did about it. A rival's amplification and its retreat are both recorded, dated and evidenced — normally sensed, never proven."));
    const brands = S.brands || []; const days = S.days || [];
    if (brands.length && days.length) {
      if (S.note) wrap.appendChild(h("div", { class: "note-box" }, S.note));
      wrap.appendChild(sectionTitle("Share of voice", "claims-and-settlement conversation, by day"));
      const chart = h("div", { class: "sov" });
      days.forEach((d, i) => {
        const col = h("div", { class: "sov-col" });
        const stack = h("div", { class: "sov-stack" });
        brands.forEach((b) => {
          const v = (b.series || [])[i] || 0;
          stack.appendChild(h("div", { class: "sov-seg" + (b.self ? " self" : ""), style: { height: (v * 100) + "%", background: b.color },
            title: b.name + " · " + pct(v) }));
        });
        col.appendChild(stack);
        col.appendChild(h("div", { class: "sov-day" }, d));
        chart.appendChild(col);
      });
      wrap.appendChild(h("div", { class: "card" }, chart,
        h("div", { class: "legend" }, brands.map((b) => h("span", { class: "lg" },
          h("span", { class: "sw", style: { background: b.color } }), b.name + (b.self ? " (us)" : ""))))));
    }
    const ev = S.events || [];
    if (ev.length) {
      wrap.appendChild(sectionTitle("What the competition did", "dated, evidenced, and kept in the account's memory"));
      const tl = h("div", { class: "timeline" });
      ev.forEach((e) => tl.appendChild(h("div", { class: "tl-item" },
        h("div", { class: "tl-dot", style: { background: STAGE_HEX[e.tone] || "#898781" } }),
        h("div", { class: "tl-when" }, e.day),
        h("div", { class: "tl-desc" }, e.text))));
      wrap.appendChild(h("div", { class: "card" }, tl));
    }
    const orgs = D.organisations || [];
    if (orgs.length) {
      wrap.appendChild(sectionTitle("Market ecosystem", "who else is in this contest — the brand analogue of the political ecosystem"));
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
        h("th", null, "Actor"), h("th", null, "Kind"), h("th", null, "Role in this episode"))));
      const tb = h("tbody");
      orgs.forEach((o) => tb.appendChild(h("tr", null,
        h("td", null, h("span", { class: "id" }, o.id + " · "), o.name),
        h("td", null, o.kind || "—"),
        h("td", { class: "small-td" }, o.roleInScenario || o.note || "—"))));
      tbl.appendChild(tb);
      wrap.appendChild(h("div", { class: "card pad0" }, tbl));
    }
    return wrap;
  };

  // Commerce funnel + the counterfactual. The whole point: both markets fell together, only the
  // exposed markets came back — the gap is the response, everything else is decay. BrandIQ only.
  function commerceFunnel() {
    const F = (D.cfg && D.cfg.funnel); if (!F) return h("div", { style: { display: "none" } });
    const wrap = h("div");
    wrap.appendChild(sectionTitle("Commercial impact vs the holdout", F.unit || "against pre-episode baseline"));
    if (F.note) wrap.appendChild(h("div", { class: "note-box" }, F.note));
    const card = h("div", { class: "card" });
    const worst = Math.max(...(F.stages || []).flatMap((s) => [Math.abs(s.exposed), Math.abs(s.holdout)]), 1);
    (F.stages || []).forEach((s) => {
      const row = h("div", { class: "cf-row" },
        h("div", { class: "cf-stage" }, s.stage),
        h("div", { class: "cf-bars" },
          h("div", { class: "cf-bar" }, h("span", { class: "cf-tag" }, "exposed"),
            h("div", { class: "cf-track" }, h("div", { class: "cf-fill good", style: { width: (Math.abs(s.exposed) / worst * 100) + "%" } })),
            h("span", { class: "cf-num" }, s.exposed + "%")),
          h("div", { class: "cf-bar" }, h("span", { class: "cf-tag" }, "holdout"),
            h("div", { class: "cf-track" }, h("div", { class: "cf-fill crit", style: { width: (Math.abs(s.holdout) / worst * 100) + "%" } })),
            h("span", { class: "cf-num" }, s.holdout + "%"))),
        h("div", { class: "cf-note muted" }, s.note || ""));
      card.appendChild(row);
    });
    wrap.appendChild(card);
    const I = F.incremental;
    if (I) {
      const inc = h("div", { class: "card inc-card" },
        h("div", { class: "inc-top" },
          h("div", { class: "inc-val" }, "+" + I.value + I.unit),
          h("div", { class: "inc-meta" },
            h("div", { class: "inc-label" }, "Incremental recovery attributable to the response"),
            h("div", { class: "inc-sub" }, (I.interval || "") + " · " + (I.method || "")))),
        h("div", { class: "inc-read" }, I.read || ""));
      wrap.appendChild(explain(inc, "incrementality", I.value));
    }
    return wrap;
  }

  /* ---- Performance ---- */
  views.performance = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Performance & Orchestration", "Measurement designed before launch: instrumentation at birth, holdouts by default, attribution method-stamped. Every number reconciles to the rupee."));
    wrap.appendChild(commerceFunnel());
    const acts = D.activations || [];
    const sum = (k) => acts.reduce((a, x) => a + (firstNum(x[k]) || 0), 0);
    const impressions = sum("impressions"), clicks = sum("clicks"), subs = sum("submissions"), regs = sum("registrations");

    // Carrier-level lifecycle simulation (press Play)
    wrap.appendChild(sectionTitle("Carrier performance simulation", "each carrier tracked window by window across the " + cfgName() + " run — press Play"));
    wrap.appendChild(simulationPanel());

    // Funnel
    wrap.appendChild(sectionTitle("Live funnel (campaign totals)", "exposures → qualified reach → tracked actions"));
    const funnel = [
      ["Raw impressions", impressions, "#3987e5"],
      ["Qualified unique reach", 204000, "#199e70"],
      ["Link clicks", clicks, "#c98500"],
      ["Portal submissions", subs, "#9085e9"],
      ["Townhall registrations", regs, "#d95926"],
    ];
    const fmax = Math.max(...funnel.map((f) => f[1]));
    const fcard = h("div", { class: "card" });
    funnel.forEach((f, i) => {
      const convo = i === 0 ? null : (f[1] / funnel[i - 1][1]);
      fcard.appendChild(h("div", { style: { margin: "9px 0" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "4px" } },
          h("span", null, f[0]), h("span", { class: "mono" }, nf(f[1]) + (convo != null ? "  ·  " + pct(convo) : ""))),
        h("div", { class: "fb-track", style: { height: "20px" } },
          h("div", { class: "fb-fill", style: { width: Math.max(3, f[1] / fmax * 100) + "%", background: f[2], height: "100%" } }))));
    });
    const two = h("div", { class: "two-col" });
    two.appendChild(fcard);

    // Incrementality
    const lifts = (D.outcomes || []).filter((o) => /lift/i.test(o.outcome));
    const ivcard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", null, "Incrementality vs holdouts"), h("span", { class: "sub" }, "exposed − holdout")));
    lifts.forEach((o) => {
      const pt = firstNum(o.value); const iv = twoNums(o.interval) || [pt, pt];
      const scaleMax = 25;
      ivcard.appendChild(h("div", { class: "iv-row" },
        h("div", { class: "iv-name" }, o.outcome, h("div", { class: "id" }, o.id + " · " + (o.provenance || ""))),
        h("div", { class: "iv-track" }, ivBar(iv[0], iv[1], pt, scaleMax)),
        h("div", { class: "num", style: { fontWeight: "700", color: "#54d15a" } }, o.value)));
    });
    ivcard.appendChild(h("div", { class: "note-box", style: { marginTop: "8px" } }, "Lift claims exist only where a counterfactual exists: the geo holdout (AC-169) and the untouched creator (P-0231) are the platform arguing with itself, honestly."));
    two.appendChild(ivcard);
    wrap.appendChild(two);

    // Attribution
    wrap.appendChild(sectionTitle("Method-stamped attribution", "deterministic and modelled never blur"));
    const attr = D.attribution || [];
    const acard = h("div", { class: "card pad0" });
    const atbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
      h("th", null, "Outcome"), h("th", null, "Activation"), h("th", { class: "num" }, "Credited"), h("th", null, "Method"), h("th", null, "Basis"))));
    const atb = h("tbody");
    attr.slice(0, 20).forEach((a) => atb.appendChild(h("tr", null,
      h("td", { class: "id" }, a.outcome), h("td", { class: "id" }, a.activation),
      h("td", { class: "num", style: { color: "#fff" } }, a.credited),
      h("td", { style: { fontSize: "12px" } }, a.method),
      h("td", null, badge(a.oip || "—", /observed/i.test(a.oip) ? "good" : "warn")))));
    atbl.appendChild(atb); acard.appendChild(atbl);
    wrap.appendChild(acard);

    // Survey
    wrap.appendChild(sectionTitle("Survey-integrated measurement", "pre/post waves, exposed vs holdout"));
    const surv = (D.surveys || []).filter((s) => /->/.test(s.exposed || "") || /->/.test(s.holdout || ""));
    const scard = h("div", { class: "card pad0" });
    const stbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
      h("th", null, "Item"), h("th", { class: "num" }, "n"), h("th", null, "Exposed (pre→post)"), h("th", null, "Holdout (pre→post)"), h("th", { class: "num" }, "Net lift"))));
    const stb = h("tbody");
    surv.forEach((s) => { const e = twoNums(s.exposed), ho = twoNums(s.holdout);
      const lift = (e && ho) ? ((e[1] - e[0]) - (ho[1] - ho[0])) : null;
      stb.appendChild(h("tr", null,
        h("td", null, s.item, s.detail ? h("div", { class: "id" }, s.detail) : null),
        h("td", { class: "num" }, s.n || "—"),
        h("td", { class: "num", style: { fontSize: "12px" } }, s.exposed || "—"),
        h("td", { class: "num", style: { fontSize: "12px" } }, s.holdout || "—"),
        h("td", { class: "num", style: { color: lift > 0 ? "#54d15a" : "var(--ink-2)", fontWeight: "600" } }, lift == null ? "—" : (lift > 0 ? "+" : "") + lift.toFixed(1) + "pp"))); });
    stbl.appendChild(stb); scard.appendChild(stbl);
    wrap.appendChild(scard);
    wrap.appendChild(briefWorkspace());
    wrap.appendChild(learningLoop());
    return wrap;
  };
  function ivBar(lo, hi, pt, max) {
    const L = Math.max(0, lo) / max * 100, Hh = Math.min(max, hi) / max * 100, P = Math.min(max, Math.max(0, pt)) / max * 100;
    return h("div", { html:
      `<svg viewBox="0 0 300 26" width="100%"><line x1="0" y1="13" x2="300" y2="13" stroke="#2c2c2a"/>` +
      `<line x1="${L * 3}" y1="13" x2="${Hh * 3}" y2="13" stroke="#199e70" stroke-width="6" stroke-linecap="round" opacity="0.55"/>` +
      `<circle cx="${P * 3}" cy="13" r="5" fill="#0ca30c" stroke="#161615" stroke-width="1.5"/></svg>` });
  }

  /* ================= Performance: carrier-level lifecycle simulation =================
     Not real-time yet, so we make it feel real-time: press Play and the six carriers ramp week by week
     across the CP-11 window. Cumulative curves sum to each carrier's known totals; a holdout stays flat
     as the visible control. Click any carrier for their week-by-week detail. */
  // Six simulation windows. PulseIQ campaigns run in weeks; BrandIQ episodes run in days, so the
  // labels come from the campaign config where it declares them.
  const SIM_WEEKS_DEFAULT = [["W21", "18 May"], ["W22", "25 May"], ["W23", "01 Jun"], ["W24", "08 Jun"], ["W25", "15 Jun"], ["W26", "22 Jun"]];
  const simWeeks = () => ((D.cfg && D.cfg.simWindows) || SIM_WEEKS_DEFAULT);
  const SIM_EVENTS_DEFAULT = ["CP-11 launches — first explainers go live",
    "Thread series + reels ramp across the corridor",
    "Ground reports; Jayanagar townhall drive begins",
    "Townhall day (548 registered); portal submissions surge",
    "Counter-share climbs; podcast deep-dive lands",
    "Endline survey wave (SV-02) — the campaign effect is measured"];
  const simEvents = () => ((D.cfg && D.cfg.simEvents) || SIM_EVENTS_DEFAULT);
  // Cumulative S-curve for a metric total over N weeks, starting at launchIdx.
  function weeklyCumulative(total, launchIdx, N) {
    const raw = []; for (let i = 0; i < N; i++) { if (i < launchIdx) { raw.push(0); continue; }
      const t = (i - launchIdx + 1) / (N - launchIdx); raw.push(1 / (1 + Math.exp(-8 * (t - 0.5)))); }
    const last = raw[N - 1] || 1; return raw.map((s) => Math.round((s / last) * total));
  }
  function makeCarrier(c, totals, format, message, fee, holdout, N, idx) {
    const launch = holdout ? 0 : (idx % 3); // staggered go-live
    const series = {};
    ["impressions", "clicks", "submissions", "registrations"].forEach((k) => {
      series[k] = holdout ? new Array(N).fill(Math.round((totals[k] || 0))) : weeklyCumulative(totals[k] || 0, launch, N); });
    return { id: c.id, name: c.name, c, format: format || "—", message: message || "", fee: fee || 0, holdout, launch, totals, series };
  }
  function synthTotals(c) { const f = c.followers || 40000; const s = c.suitability || {};
    const imp = Math.round(f * 2.4 * (0.4 + (s.audMatch || 0.5))); return { impressions: imp, clicks: Math.round(imp * 0.019), submissions: Math.round(imp * 0.0055), registrations: Math.round(imp * 0.0018) }; }
  function simCarriers(N) {
    const out = [];
    (D.activations || []).forEach((a) => { const c = by(D.creators, a.creator); if (!c) return;
      out.push(makeCarrier(c, { impressions: firstNum(a.impressions) || 0, clicks: firstNum(a.clicks) || 0, submissions: firstNum(a.submissions) || 0, registrations: firstNum(a.registrations) || 0 },
        a.format, a.message, firstNum(a.fee) || 0, false, N, out.length)); });
    // the deliberate creator holdout, shown flat as the control
    const ho = by(D.creators, "P-0231") || (D.creators || []).find((c) => /holdout/i.test((c.suitability || {}).decision || ""));
    if (ho && !out.some((x) => x.id === ho.id)) { const t = synthTotals(ho);
      out.push(makeCarrier(ho, { impressions: Math.round(t.impressions * 0.04), clicks: 0, submissions: 0, registrations: 0 }, "not activated", "— (control)", 0, true, N, out.length)); }
    // top up to six with the strongest Activate-decision creators not already carrying
    evaluated().filter((c) => /activat/i.test((c.suitability || {}).decision || "") && !out.some((x) => x.id === c.id))
      .sort((a, b) => (b.suitability.index || 0) - (a.suitability.index || 0))
      .slice(0, Math.max(0, 6 - out.length))
      .forEach((c, i) => out.push(makeCarrier(c, synthTotals(c), (D.activations && D.activations[0] && D.activations[0].format) || "native", "MSG-11A", feeOf(c), false, N, out.length + i)));
    return out.slice(0, 6);
  }
  function simulationPanel() {
    const N = simWeeks().length; const carriers = simCarriers(N);
    const maxImp = Math.max(1, ...carriers.map((cr) => cr.series.impressions[N - 1]));
    let wk = 0;
    const card = h("div", { class: "card sim-card" });

    const playBtn = h("button", { class: "btn primary sm", onclick: () => toggle() }, "▶ Play");
    const resetBtn = h("button", { class: "btn sm", onclick: () => { pause(); setWeek(0); } }, "⏮ Reset");
    const slider = h("input", { type: "range", min: "0", max: String(N - 1), value: "0", class: "sim-slider", oninput: (e) => { pause(); setWeek(+e.target.value); } });
    const weekLabel = h("span", { class: "sim-week" });
    card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Carrier performance — lifecycle simulation"),
      h("span", { class: "sub" }, "press Play to run the campaign week by week")));
    card.appendChild(h("div", { class: "sim-controls" }, playBtn, resetBtn, slider, weekLabel));
    const eventLine = h("div", { class: "sim-event" });
    card.appendChild(eventLine);
    const kpiHost = h("div", { class: "sim-kpis" }); card.appendChild(kpiHost);
    card.appendChild(h("div", { class: "sim-rows-h" }, "Carriers (click any for week-by-week detail)"));
    const rowsHost = h("div", { class: "sim-rows" }); card.appendChild(rowsHost);

    // build carrier rows once, keep field refs to update on each tick
    const refs = carriers.map((cr) => {
      const bar = h("i");
      const impEl = h("span", { class: "sim-imp mono" });
      const subEl = h("span", { class: "sim-sub mono" });
      const cpaEl = h("span", { class: "sim-cpa mono" });
      const deltaEl = h("span", { class: "sim-delta" });
      const row = h("div", { class: "sim-row" + (cr.holdout ? " holdout" : ""), onclick: () => openCarrier(cr, N) },
        h("div", { class: "sim-name" }, h("b", null, cr.name),
          h("div", { class: "id" }, cr.holdout ? "holdout · not activated (control)" : (cr.message || "") + (cr.format && cr.format !== "—" ? " · " + trunc(cr.format, 26) : ""))),
        h("div", { class: "sim-bar" }, h("div", { class: "sim-track" }, bar), deltaEl),
        h("div", { class: "sim-nums" }, h("span", null, impEl, h("span", { class: "sim-lbl" }, " impr")),
          h("span", null, subEl, h("span", { class: "sim-lbl" }, " subs")),
          h("span", null, cpaEl, h("span", { class: "sim-lbl" }, " /sub"))));
      rowsHost.appendChild(row);
      return { cr, bar, impEl, subEl, cpaEl, deltaEl };
    });

    function render() {
      weekLabel.textContent = simWeeks()[wk][0] + " · " + simWeeks()[wk][1] + "  (week " + (wk + 1) + " of " + N + ")";
      slider.value = String(wk);
      eventLine.innerHTML = ""; eventLine.appendChild(h("span", { class: "sim-ev-dot" })); eventLine.appendChild(h("span", null, simEvents()[wk]));
      // aggregate KPIs (cumulative to this week, activated carriers only)
      const act = carriers.filter((c) => !c.holdout);
      const sumAt = (k) => act.reduce((a, c) => a + (c.series[k][wk] || 0), 0);
      const imp = sumAt("impressions"), clk = sumAt("clicks"), sub = sumAt("submissions"), reg = sumAt("registrations");
      const qr = Math.round(imp * 0.33);
      kpiHost.innerHTML = "";
      [["Impressions", compact(imp)], ["Qualified reach", compact(qr)], ["Link clicks", nf(clk)],
       ["Portal submissions", nf(sub)], ["Townhall regs", nf(reg)]].forEach((k) =>
        kpiHost.appendChild(h("div", { class: "sim-kpi" }, h("div", { class: "sim-kpi-v" }, k[1]), h("div", { class: "sim-kpi-l" }, k[0]))));
      // per-carrier rows
      refs.forEach((r) => { const cr = r.cr; const imp = cr.series.impressions[wk] || 0; const sub = cr.series.submissions[wk] || 0;
        const prev = wk > 0 ? (cr.series.impressions[wk - 1] || 0) : 0; const d = imp - prev;
        r.bar.style.width = Math.max(1, imp / maxImp * 100) + "%";
        r.bar.style.background = cr.holdout ? "#5a5a55" : "linear-gradient(90deg,#3987e5,#199e70)";
        r.impEl.textContent = compact(imp); r.subEl.textContent = nf(sub);
        r.cpaEl.textContent = sub > 0 ? "₹" + nf(Math.round(cr.fee / sub)) : "—";
        r.deltaEl.textContent = (d > 0 && !cr.holdout) ? "+" + compact(d) : "";
      });
    }
    function setWeek(w) { wk = Math.max(0, Math.min(N - 1, w)); render(); }
    let playing = false;
    function play() { if (wk >= N - 1) wk = 0; playing = true; playBtn.textContent = "⏸ Pause";
      if (VIEW_TIMER) clearInterval(VIEW_TIMER); VIEW_TIMER = setInterval(() => { if (wk >= N - 1) { pause(); return; } setWeek(wk + 1); }, 1150); }
    function pause() { playing = false; playBtn.textContent = wk >= N - 1 ? "▶ Replay" : "▶ Play"; if (VIEW_TIMER) { clearInterval(VIEW_TIMER); VIEW_TIMER = null; } }
    function toggle() { playing ? pause() : play(); }
    render();
    return card;
  }
  // Per-carrier drill: the week-by-week story behind one carrier's numbers.
  function openCarrier(cr, N) {
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, cr.id + (cr.holdout ? " · holdout (control)" : " · carrier")));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px", fontSize: "19px", cursor: "pointer" }, onclick: () => openCreator(cr.id) }, cr.name));
    node.appendChild(h("div", { class: "pill-row", style: { margin: "8px 0" } },
      cr.message ? badge(cr.message, "blue") : null, cr.format && cr.format !== "—" ? badge(trunc(cr.format, 30), "muted") : null,
      cr.fee ? badge("fee " + rs(cr.fee), "muted") : null));
    if (cr.holdout) node.appendChild(h("div", { class: "reading-box" }, h("b", null, "Why he's here doing nothing: "),
      "He was scored, qualified — and deliberately NOT activated. He is the control. The gap between the activated carriers and this flat line is what proves the campaign caused the movement, not the news cycle."));
    const T = cr.totals; const cpa = T.submissions > 0 ? Math.round(cr.fee / T.submissions) : null;
    node.appendChild(h("div", { class: "kpis", style: { marginTop: "10px" } }, [
      ["Impressions", compact(T.impressions || 0)], ["Link clicks", nf(T.clicks || 0)],
      ["Submissions", nf(T.submissions || 0)], ["Cost / submission", cpa ? "₹" + nf(cpa) : "—"],
    ].map((k) => h("div", { class: "kpi" }, h("div", { class: "k-label" }, k[0]), h("div", { class: "k-val" }, k[1])))));
    node.appendChild(h("div", { class: "section-title" }, "Week by week (cumulative)"));
    const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
      h("th", null, "Week"), h("th", { class: "num" }, "Impressions"), h("th", { class: "num" }, "Clicks"), h("th", { class: "num" }, "Submissions"), h("th", { class: "num" }, "Regs"))));
    const tb = h("tbody");
    for (let i = 0; i < N; i++) tb.appendChild(h("tr", null,
      h("td", null, simWeeks()[i][0] + " · " + simWeeks()[i][1]),
      h("td", { class: "num" }, compact(cr.series.impressions[i] || 0)),
      h("td", { class: "num" }, nf(cr.series.clicks[i] || 0)),
      h("td", { class: "num", style: { color: "#fff" } }, nf(cr.series.submissions[i] || 0)),
      h("td", { class: "num" }, nf(cr.series.registrations[i] || 0))));
    tbl.appendChild(tb); node.appendChild(h("div", { class: "card pad0" }, tbl));
    node.appendChild(h("div", { class: "note-box", style: { marginTop: "10px" } }, "Every action is source-coded (tracked links / QR), so these numbers reconcile to the rupee. Open the full creator page for suitability and audience evidence."));
    openDrawer(node);
  }

  /* ---- Knowledge Graph ---- */
  const TYPE_COLOR = { Creator: "#3987e5", "Person/Creator": "#3987e5", CreatorAccount: "#199e70", Content: "#9085e9",
    Narrative: "#d95926", Estimate: "#5a5a55", Evidence: "#c98500", Campaign: "#008300", CampaignActivation: "#008300",
    Geography: "#d55181", Outcome: "#e66767", Organisation: "#eda100", Position: "#7a7a72", SignalSource: "#c98500",
    Issue: "#3987e5", AudienceSegment: "#199e70", Survey: "#9085e9", Message: "#d55181" };
  const typeColor = (t) => TYPE_COLOR[t] || "#6f6f68";
  let netInstance = null;
  views.graph = function () {
    const wrap = h("div");
    const gc = (D.graph && D.graph.nodes || []).length, ge = (D.graph && D.graph.edges || []).length;
    wrap.appendChild(pageHead("Knowledge Graph", gc + " nodes · " + ge + " relationships. Any node is a doorway: person → accounts → content → narratives → campaign. Reference ontology + the operational " + cfgName() + " scenario."));
    const filt = h("div", { class: "filters" });
    const layerSel = h("select", { id: "g-layer" },
      h("option", { value: "operational" }, "Operational layer (" + cfgName() + ")"),
      h("option", { value: "all" }, "Everything (" + gc + " nodes — dense)"),
      h("option", { value: "reference" }, "Reference ontology"));
    filt.appendChild(layerSel);
    filt.appendChild(h("button", { class: "btn sm", onclick: () => draw(layerSel.value) }, "Redraw"));
    filt.appendChild(h("span", { class: "muted", style: { fontSize: "12px" } }, "click a node to inspect · scroll to zoom · drag to pan"));
    wrap.appendChild(filt);
    wrap.appendChild(h("div", { id: "graph-canvas" }));
    wrap.appendChild(graphLegend());
    setTimeout(() => draw("operational"), 60);
    return wrap;
    function draw(layer) {
      const canvas = $("graph-canvas");
      if (!window.vis) { canvas.innerHTML = '<div style="padding:40px;text-align:center;color:#898781">vis-network failed to load (offline?). The graph needs the CDN script. Everything else works offline.</div>'; return; }
      const G = (window.__LIVE_GRAPH && layer === "operational") ? window.__LIVE_GRAPH : (D.graph || {});
      const nodesRaw = (G.nodes || []).filter((n) => layer === "all" || n.layer === layer);
      const keep = new Set(nodesRaw.map((n) => n.id));
      const nodes = nodesRaw.map((n) => ({ id: n.id, label: n.label && n.label.length < 22 ? n.label : n.id,
        color: { background: typeColor(n.type), border: "#0d0d0d" }, font: { color: "#c3c2b7", size: 11 },
        shape: "dot", size: n.type && /Creator|Narrative|Campaign/.test(n.type) ? 15 : 9, title: n.type + " · " + n.id }));
      const edges = (G.edges || []).filter((e) => keep.has(e.from) && keep.has(e.to))
        .map((e) => ({ from: e.from, to: e.to, label: undefined, arrows: { to: { enabled: true, scaleFactor: 0.35 } },
          color: { color: "rgba(255,255,255,0.10)", highlight: "#3987e5" }, width: 0.6, title: e.type }));
      try { if (netInstance) netInstance.destroy(); } catch (e) {}
      netInstance = new vis.Network(canvas, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, {
        physics: { stabilization: { iterations: 180 }, barnesHut: { gravitationalConstant: -9000, springLength: 120, avoidOverlap: 0.4 } },
        interaction: { hover: true, tooltipDelay: 120 }, nodes: { borderWidth: 1.5 } });
      netInstance.on("click", (p) => { if (p.nodes && p.nodes.length) { const id = p.nodes[0];
        if (by(D.creators, id)) openCreator(id); else openNode(id); } });
    }
  };
  function graphLegend() {
    const items = [["Creator", "#3987e5"], ["Account", "#199e70"], ["Content", "#9085e9"], ["Narrative", "#d95926"],
      ["Evidence", "#c98500"], ["Campaign", "#008300"], ["Geography", "#d55181"], ["Outcome", "#e66767"]];
    return h("div", { class: "graph-legend" }, items.map((i) =>
      h("span", { class: "lg", style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--ink-2)" } },
        h("span", { class: "sw dotm", style: { width: "10px", height: "10px", borderRadius: "50%", background: i[1] } }), i[0])));
  }

  /* ---- Governance ---- */
  views.governance = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Trust, Governance & Safety", "Not a filter bolted on top — architecture. Consent is revocable and cascades; sub-threshold queries return a designed refusal; absent evidence returns Unknown, never a guess."));

    // Revocation cascade
    wrap.appendChild(sectionTitle("The revocation cascade", "revoke a creator's consent on stage and watch dependent estimates recompute"));
    const rcid = (D.cfg && D.cfg.revocationCreator) || "";
    const c = by(D.creators, rcid);
    const consentId = ((c && c.consent) || "").match(/O[AN][-\w]*/) ? ((c.consent).match(/O[AN][-\w]*/)[0]) : "consent";
    const affected = (D.estimates || []).filter((e) => e.subject === rcid);
    const casc = h("div", { class: "card" });
    const head = h("div", { class: "card-h" },
      h("h3", null, (c ? c.name : rcid) + " — consent " + consentId),
      h("div", { class: "btn-row" },
        h("button", { class: "btn danger", id: "revoke-btn", onclick: doRevoke }, "⏻ Revoke " + consentId),
        h("button", { class: "btn sm", onclick: () => renderCasc(false) }, "Reset")));
    casc.appendChild(head);
    const cascHost = h("div"); casc.appendChild(cascHost);
    wrap.appendChild(casc);
    function renderCasc(revoked) {
      cascHost.innerHTML = "";
      cascHost.appendChild(h("div", { class: revoked ? "note-box crit" : "note-box", style: { marginBottom: "12px" } },
        revoked ? "Consent revoked. The OAuth evidence rows are void; platform-verified estimates recompute from weaker signals — ranges widen, confidence downgrades, inside the SLA clock (KC-030 · RR-082)."
                : "OAuth-verified analytics currently anchor " + affected.length + " estimates for this creator. Tight ranges, Platform-Verified confidence."));
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
        h("th", null, "Estimate"), h("th", null, "Key"), h("th", { class: "num" }, "Value"), h("th", null, "Range"), h("th", null, "Confidence"))));
      const tb = h("tbody");
      affected.slice(0, 10).forEach((e) => {
        const downgraded = revoked && /verified/i.test(e.provenance || "");
        const lo = e.lo, hi = e.hi, span = (hi != null && lo != null) ? (hi - lo) : 0.1;
        const nlo = downgraded ? Math.max(0, (lo - span * 0.9)).toFixed(2) : (lo ?? "—");
        const nhi = downgraded ? Math.min(1, (hi + span * 0.9)).toFixed(2) : (hi ?? "—");
        tb.appendChild(h("tr", { style: downgraded ? { background: "rgba(208,59,59,0.08)" } : null },
          h("td", { class: "id" }, e.id), h("td", null, e.key || e.dimension),
          h("td", { class: "num", style: { color: "#fff" } }, e.value ?? "—"),
          h("td", { class: "num", style: { fontSize: "12px" } }, nlo + "–" + nhi),
          h("td", null, downgraded ? badge("Weakly Inferred ↓", "serious") : confBadge(e.confidence))));
      });
      tbl.appendChild(tb); cascHost.appendChild(tbl);
    }
    function doRevoke() { renderCasc(true); }
    renderCasc(false);

    // Other governance moments
    wrap.appendChild(honestUnknownPanel());
    wrap.appendChild(sectionTitle("More moments that sell in procurement", ""));
    const three = h("div", { class: "three-col" });
    three.appendChild(govCard("The refusal that sells", "A query below minimum segment size returns a designed refusal — not a number. The dataset contains no individual rows to leak, by construction.", "RR-080 · EC-14 aggregate-only",
      h("button", { class: "btn sm", onclick: (ev) => { ev.target.parentNode.querySelector(".ref-out").classList.remove("hidden"); } }, "Query segment n<50 →"),
      h("div", { class: "ref-out hidden note-box crit", style: { marginTop: "10px" } }, "REFUSED · aggregate-only floor. Segments below the minimum size are not queryable — this is a designed boundary, not a missing feature.")));
    const rf = riskFailCreator();
    three.appendChild(govCard("Inauthenticity quarantine", "A bot-inflated spike is discounted and quarantined before it distorts rankings." + (rf ? " " + rf.name + " is the worked example — a near-zero critical factor collapses its suitability to " + ((rf.suitability && rf.suitability.index) ?? 0).toFixed(3) + "." : ""), "RR-069 · KC-026 · KPI-044",
      rf ? h("button", { class: "btn sm", onclick: () => openCreator(rf.id) }, "Inspect " + rf.id + " →") : null));
    const sn = (D.cfg && D.cfg.sensitiveNarrative); const snName = sn ? ((by(D.narratives, sn) || {}).name || sn) : null;
    three.appendChild(govCard("Sensitive-tier routing", sn ? "Touching " + sn + " (" + snName + ") reroutes to restricted handling: transparency content only, no counter-mobilisation of the affected actors. Restraint as a feature." : "Sensitive narratives reroute to restricted handling: transparency content only. Restraint as a feature.", "RC-18 · RR-081",
      sn ? h("button", { class: "btn sm", onclick: () => openNarrative(sn) }, "Open " + sn + " posture →") : null));
    wrap.appendChild(three);
    return wrap;
  };
  const govCard = (title, body, mach, ...actions) => h("div", { class: "card" },
    h("h3", { style: { margin: "0 0 8px", fontSize: "14px" } }, title),
    h("div", { style: { fontSize: "12.5px", color: "var(--ink-2)", marginBottom: "10px" } }, body),
    h("div", { class: "id", style: { marginBottom: "10px" } }, mach), actions);

  /* ---- Ontology browser ---- */
  // The module delta, made visible: what BrandIQ had to author versus what it inherited untouched.
  // This is the "module two costs less than module one" argument, on screen, in real row counts.
  function moduleDelta() {
    if (MODULE !== "brand") return h("div", { style: { display: "none" } });
    const B = D.brandRef || {};
    const wrap = h("div");
    wrap.appendChild(sectionTitle("The BrandIQ delta", "what module two had to author — everything else is inherited from the shared engine, unchanged"));
    const groups = [
      ["Rebuilt", "these did not survive the move from politics to brands", [
        ["outcomeTypes", "Outcome types", "turnout and opinion give way to trust recovery, quote recovery and avoided loss"],
        ["geoLevels", "Geography levels", "constituencies and wards give way to catchments, pincodes and language zones"],
        ["ecosystem", "Market ecosystem", "parties give way to competitors, regulators, ombudsman and the agency"],
      ]],
      ["New rows", "brand-side vocabulary the engine had no instances for", [
        ["narrativeClasses", "Narrative classes", "institutional betrayal, category contamination, delivery proof, educational reframe"],
        ["signals", "Signal sources", "grievance forums, reviews, the first-party quote funnel, search demand, disclosure register"],
        ["creatorTypes", "Creator types", "affected customer, grievance aggregator, competitor brand account"],
        ["issues", "Issues", "claims and settlement, disclosure, category trust, pricing"],
        ["interventions", "Interventions", "third-party review, domain-authority explainer, consented testimony, grievance routing"],
        ["rules", "Reasoning rules", "disclosure and refusal gates, plus brand-tempo re-thresholding of the shared models"],
      ]],
    ];
    groups.forEach((g) => {
      wrap.appendChild(h("div", { class: "delta-head" }, h("span", { class: "dh-tag" }, g[0]), h("span", { class: "dh-note" }, g[1])));
      const grid = h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" } });
      g[2].forEach((row) => {
        const n = (B[row[0]] || []).length;
        grid.appendChild(h("div", { class: "card delta-card" },
          h("div", { class: "delta-n" }, n, h("span", { class: "delta-unit" }, n === 1 ? " row" : " rows")),
          h("div", { class: "delta-name" }, row[1]),
          h("div", { class: "delta-why" }, row[2])));
      });
      wrap.appendChild(grid);
    });
    const total = Object.values(B).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    wrap.appendChild(h("div", { class: "note-box", style: { marginTop: "12px" } },
      h("b", null, total + " authored rows. "),
      "Everything else — the evidence and confidence architecture, identity, accounts, content, audience, the narrative machinery, the consent architecture and all ten reasoning models — is inherited from the shared engine without a single change. That ratio is the reason a second module costs less than the first, and a third will cost less again."));
    return wrap;
  }

  views.ontology = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Ontology Browser", "The Knowledge Base as a navigable application: five layers, the narrative hub, and the recommendation pack — the zero-model demo that teaches the buyer the ontology while looking like a product."));
    const layers = [
      ["1 · Schema", "14 domains · 45 node types · 56 edge types", "The graph's vocabulary"],
      ["2 · Reference model", "Platforms, creator types, 12 issues, 24 narratives, 24 signals", "The Karnataka pack"],
      ["3 · Knowledge", "Cause-and-effect chains · narrative progressions", "Trigger → indicator → consequence"],
      ["4 · Reasoning", "83 IF/THEN rules across 10 models", "Operationalises the chains"],
      ["5 · Application", "24 use cases · 56 KPIs · 60 recommendations", "The value layer"],
    ];
    wrap.appendChild(h("div", { class: "kpis" }, layers.map((l) => h("div", { class: "kpi" },
      h("div", { class: "k-label" }, l[0]), h("div", { class: "k-val", style: { fontSize: "13px", fontWeight: "600", lineHeight: "1.4", marginTop: "8px" } }, l[1]),
      h("div", { class: "k-sub" }, l[2])))));

    wrap.appendChild(moduleDelta());
    wrap.appendChild(sectionTitle("Narrative hub", "each narrative is a governed page — click to open its cross-link panels"));
    const board = narrativeBoard(); wrap.appendChild(board);

    wrap.appendChild(ruleBrowser());
    wrap.appendChild(sectionTitle("Recommendation pack", "typed action templates · trigger → action → KPI"));
    const recs = (D.recommendations || []).filter((r) => r.highlight).slice(0, 12);
    const grid = h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" } });
    (recs.length ? recs : (D.recommendations || []).slice(0, 9)).forEach((r) => grid.appendChild(h("div", { class: "card" },
      h("div", { class: "card-h" }, h("span", { class: "id" }, r.id), badge(r.type || "—", "muted")),
      h("div", { style: { fontWeight: "600", fontSize: "13px", margin: "2px 0 6px" } }, r.name),
      h("div", { style: { fontSize: "12px", color: "var(--ink-2)" } }, r.action || r.trigger || ""),
      r.improves ? h("div", { class: "id", style: { marginTop: "8px" } }, "improves " + r.improves) : null)));
    wrap.appendChild(grid);
    return wrap;
  };

  /* ---- Guided Demo ---- */
  views.demo = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Guided Demo — one contest, end to end", "The anchor-customer walkthrough the dataset was built to support: twelve screens, one continuous thread. Every step cites rows you can inspect."));
    if (ACTIVE !== "CP-11") wrap.appendChild(h("div", { class: "note-box warn", style: { marginBottom: "12px" } },
      "This guided demo is scripted for the Tunnel Road (CP-11) scenario. You're currently in " + cfgName() + " — ",
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); useCampaign("CP-11"); location.hash = "#/demo"; } }, "switch to CP-11"),
      " to follow it exactly, or explore the same views on this campaign's live data."));
    const steps = [
      ["Open on the narrative board", "Four tunnel narratives, stage-classified per geography. NR-25 is Growing in the corridor; NR-26 barely present.", "command"],
      ["Rewind to the E1 spike", "The tender story breaks; velocity crosses threshold; early-warning fires days before peak.", "narratives"],
      ["Open NR-25's hub page", "Class, susceptible audiences, detection wiring, its contradiction with NR-26 — and the Respond recommendation queued.", "N:NR-25"],
      ["Accept the recommendation → the brief", "CP-11 assembles: segments, corridor geos, the confidence floor, the NR-27 restraint posture.", "performance"],
      ["Run discovery", "The plain-language ask returns eight candidates with eleven-factor breakdowns.", "discovery"],
      ["Show the collapses", "A 1.24M entertainer dies on authority (0.09); a perfect-fit civic voice dies on stance (0.15).", "discovery"],
      ["Build the portfolio", "Four low-overlap carriers, ₹13.1L of ₹32L; Creator A reserved as the holdout.", "discovery"],
      ["Launch instrumented", "Every item carries tracked links from birth; the A/B split (MSG-11A vs 11B) is in the content tags.", "performance"],
      ["Watch the funnel live", "Weekly exposures reconcile to totals; 803 submissions, 548 registrations, 361 in the room; CPA ₹1,517.", "performance"],
      ["Attribute with method stamps", "Deterministic rows sum exactly; modelled shares wear the Predicted flag. Then the holdouts speak: +16pp recall, +4.2pp support.", "performance"],
      ["Close the loop", "Predicted vs actual seeds calibration; results write to creator history; the next brief starts smarter.", "audience"],
      ["End on governance", "Revoke OA-203 live and watch the cascade; run the sub-threshold query and get the designed refusal.", "governance"],
    ];
    const stepper = h("div", { class: "stepper" });
    steps.forEach((s, i) => {
      stepper.appendChild(h("div", { class: "step" + (i === 0 ? " on" : "") },
        h("div", { class: "step-num" }, i + 1),
        h("div", { class: "step-body" },
          h("div", { class: "step-title" }, s[0]),
          h("div", { class: "step-desc" }, s[1]),
          h("button", { class: "btn sm", onclick: () => go(s[2]) }, "Go to this screen →"))));
    });
    wrap.appendChild(stepper);
    return wrap;
    function go(target) { if (target.startsWith("N:")) openNarrative(target.slice(2)); else location.hash = "#/" + target; }
  };

  /* ================= drawers ================= */
  function openDrawer(node) {
    const body = $("drawer-body"); body.innerHTML = "";
    body.appendChild(h("button", { class: "drawer-close", onclick: closeDrawer }, "✕"));
    body.appendChild(node);
    try { linkifyCodesIn(body); } catch (e) {}
    $("drawer").classList.remove("hidden"); $("drawer-scrim").classList.remove("hidden");
  }
  function closeDrawer() { $("drawer").classList.add("hidden"); $("drawer-scrim").classList.add("hidden"); }

  function openCreator(id) {
    const c = by(D.creators, id); if (!c) return openNode(id);
    const ests = (D.estimates || []).filter((e) => e.subject === id);
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, c.id + " · " + (c.type || "")));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px" } }, c.name));
    node.appendChild(h("div", { class: "pill-row", style: { margin: "10px 0 4px" } },
      badge(c.stance || "—", stanceClass(c.stance)),
      c.offline && /yes/i.test(c.offline) ? badge("offline-capable", "good") : null,
      c.consent ? badge("consent " + c.consent, "good") : badge("no consent record", "muted"),
      c.suitability ? badge(((D.cfg && D.cfg.id) || "") + " fit " + (c.suitability.index ?? 0).toFixed(3), decisionClass(c.suitability.decision)) : null));
    node.appendChild(h("div", { style: { fontSize: "13px", color: "var(--ink-2)", margin: "8px 0" } }, c.role || ""));
    // WHY this decision — answered first, in plain English, before any numbers.
    if (c.suitability) {
      const r = decisionRationale(c);
      node.appendChild(h("div", { class: "why-card " + r.tone },
        h("div", { class: "why-head" }, h("span", { class: "why-verdict badge b-" + r.tone }, r.verdict),
          h("span", { class: "why-lead" }, r.lead)),
        r.why ? h("div", { class: "why-body" }, r.why) : null));
    }
    node.appendChild(h("div", { class: "note-box", style: { margin: "10px 0" } }, h("b", null, "Audience note: "), c.audienceNote || "—"));
    if (c.isLive && c.sampleUrl) {
      node.appendChild(h("div", { class: "note-box", style: { margin: "10px 0" } },
        h("b", null, "Sample content pulled: "),
        h("a", { href: c.sampleUrl, target: "_blank", rel: "noopener" }, c.sampleTitle || c.sampleUrl)));
    }
    node.appendChild(trustRiskPanel(c));

    node.appendChild(h("div", { class: "section-title" }, "Accounts & verification"));
    (c.accounts || []).forEach((a) => node.appendChild(h("div", { class: "card", style: { padding: "11px", marginBottom: "8px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("div", null, h("b", null, a.platform || "—"), " ", h("span", { class: "muted" }, a.handle || ""),
          h("div", { class: "id" }, a.id)),
        h("div", { style: { textAlign: "right" } }, h("div", { style: { fontWeight: "700" } }, compact(a.followers || 0)),
          badge(a.linkBasis || "—", /oauth|verified/i.test(a.linkBasis) ? "good" : /probabil/i.test(a.linkBasis) ? "warn" : "muted"))))));

    if (c.suitability) {
      node.appendChild(h("div", { class: "section-title" }, "Why each score — eleven factors (brief " + ((D.cfg && D.cfg.id) || "") + ")"));
      node.appendChild(h("div", { class: "hint-line" }, "Hover any bar for the metric; the line under each is what it means for THIS creator on THIS brief."));
      node.appendChild(factorBars(c.suitability, c));
      node.appendChild(h("div", { class: "note-box", style: { marginTop: "10px" } },
        "Raw product " + (c.suitability.rawProduct ?? "—") + " → index " + (c.suitability.index ?? "—") + ". ",
        badge(c.suitability.decision || "—", decisionClass(c.suitability.decision))));
    }
    // Where his audience actually sits — geography made human, not GE-codes.
    const geoNode = geoBlock(c);
    if (geoNode) { node.appendChild(h("div", { class: "section-title" }, "Where his audience is")); node.appendChild(geoNode); }
    // Which narratives can I use him on, and for WHAT — the drill-down the user asked for.
    // Skipped for live (ingested) creators: narrativeFitsFor() defaults to
    // "Poor fit — he'd add noise, not signal" for anyone with no
    // suitability data, which is a confident-sounding verdict we have no
    // actual basis for on a creator we only just discovered.
    if (c.isLive) {
      node.appendChild(h("div", { class: "section-title" }, "Which narrative can I use him on?"));
      node.appendChild(h("div", { class: "note-box" }, "Not yet scored. A YouTube keyword search only returns channel/video metadata — no audience overlap, trust, or issue-authority evidence, which is what narrative fit is actually based on. Treat this as a discovery lead to research further, not a ranked recommendation."));
    } else {
      node.appendChild(h("div", { class: "section-title" }, "Which narrative can I use him on?"));
      node.appendChild(narrativeFitBlock(c));
    }
    if (ests.length) {
      node.appendChild(h("div", { class: "section-title" }, "All audience estimates (" + ests.length + ")"));
      node.appendChild(h("div", { class: "hint-line" }, "Click any row to see the value read in plain English and the evidence behind it."));
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null,
        h("th", null, "Dimension · area"), h("th", { class: "num" }, "Value"), h("th", null, "Range"), h("th", null, "Confidence"))));
      const tb = h("tbody");
      ests.slice(0, 12).forEach((e) => { const g = e.dimension === "geography" ? (by(D.geographies, e.geoScope || e.key) || {}) : {};
        tb.appendChild(h("tr", { onclick: () => openEstimate(e.id) },
          h("td", null, (e.dimension || "") + (g.name ? " · " + g.name : (e.key ? " · " + e.key : ""))),
          h("td", { class: "num", style: { color: "#fff" } }, e.value ?? "—"),
          h("td", { class: "num", style: { fontSize: "12px" } }, (e.lo != null ? e.lo + "–" + e.hi : "—")),
          h("td", null, confBadge(e.confidence)))); });
      tbl.appendChild(tb); node.appendChild(h("div", { class: "card pad0" }, tbl));
    }
    openDrawer(node);
  }

  // Per-creator narrative fit list: for each tracked narrative, can I use him, why, and for what content.
  function narrativeFitBlock(c) {
    const box = h("div", { class: "nfit-list" });
    narrativeFitsFor(c).forEach((f) => {
      const angleWrap = h("div", { class: "nfit-angle hidden" });
      const anglesBuilt = { done: false };
      const toggle = h("button", { class: "nfit-toggle", onclick: (e) => { e.stopPropagation();
        if (!anglesBuilt.done) { angleWrap.appendChild(contentDrillNode(c, f.nr)); anglesBuilt.done = true; }
        angleWrap.classList.toggle("hidden");
        toggle.textContent = angleWrap.classList.contains("hidden") ? "What content to give him →" : "Hide content & scripts";
      } }, "What content to give him →");
      box.appendChild(h("div", { class: "nfit-item " + f.tone },
        h("div", { class: "nfit-head" },
          h("span", { class: "nfit-fit badge b-" + f.tone }, f.fit),
          h("span", { class: "nfit-name", style: { cursor: "pointer" }, onclick: () => openNarrative(f.nr.id) }, f.nr.name),
          h("span", { class: "id" }, f.nr.id)),
        h("div", { class: "nfit-why" }, f.why),
        h("div", { class: "nfit-use" }, h("b", null, "Use him to: "), f.use),
        (f.tone === "good" || f.tone === "warn") ? h("div", null, toggle, angleWrap) : null));
    });
    return box;
  }

  // "Where his audience is" — turns the geography estimates into a readable, corridor-aware picture.
  function geoBlock(c) {
    const geos = topGeosFor(c).slice(0, 7); if (!geos.length) return null;
    const max = Math.max(0.01, ...geos.map((g) => g.share || 0));
    const list = h("div", { class: "geo-list" });
    geos.forEach((g) => list.appendChild(h("div", { class: "geo-row" },
      h("div", { class: "geo-name" }, g.name,
        g.corridor ? h("span", { class: "geo-flag corridor" }, "corridor") : null,
        g.holdout ? h("span", { class: "geo-flag holdout" }, "holdout") : null),
      h("div", { class: "fb-track", style: { height: "10px" } }, h("div", { class: "fb-fill", style: { width: Math.max(3, (g.share / max) * 100) + "%", background: g.corridor ? "#3987e5" : "#5a5a55" } })),
      h("div", { class: "geo-share" }, pct(g.share) + (g.lo != null ? " (" + pct(g.lo) + "–" + pct(g.hi) + ")" : "")))));
    const corr = corridorShareOf(c);
    const reading = corr >= 0.4 ? "His audience is concentrated on the corridor — " + pct(corr) + " sits in the constituencies you're contesting, so he reaches the affected voters directly, not the whole city."
      : corr > 0 ? "Only " + pct(corr) + " of his audience is on the corridor; the rest is elsewhere in the city, so some reach lands outside your target."
      : "His audience sits largely outside the corridor constituencies — geography is where this creator is weakest for the brief.";
    return h("div", null, list, h("div", { class: "reading-box" }, h("b", null, "What this says: "), reading));
  }

  // Plain-English reading of a single audience estimate — what the value and the range actually mean.
  function estimateReading(e, c) {
    const who = c ? c.name : e.subject; const val = e.value;
    const isShare = /share/i.test(e.unit || "") || (val != null && val <= 1);
    let what;
    if (e.dimension === "geography") { const g = by(D.geographies, e.geoScope || e.key) || {};
      const where = g.name || (e.geoScope || e.key);
      what = "About " + (isShare ? pct(val) : val) + " of " + who + "'s audience sits in " + where + (g.level ? " — a " + g.level.toLowerCase() : "")
        + (/yes/i.test(g.corridor || "") ? ", one of the tunnel-corridor constituencies you're contesting" : "")
        + (/holdout/i.test(g.notes || "") ? " (your designed measurement holdout — deliberately not activated)" : "") + ".";
    } else { what = "This is " + (isShare ? pct(val) : val) + " on “" + (e.key || e.dimension) + "” for " + who + "."; }
    const rangeTxt = (e.lo != null && e.hi != null)
      ? "The band " + (isShare ? pct(e.lo) + "–" + pct(e.hi) : e.lo + "–" + e.hi) + " is the honest uncertainty — "
        + (/verified|observed/i.test(e.provenance || "") ? "tight, because it's platform-verified." : "wide, because it's inferred from signals rather than platform-verified, so read the mid-point as a best guess, not a fact.")
      : "";
    return { what, rangeTxt };
  }

  function openEstimate(id) {
    const e = by(D.estimates, id); if (!e) return;
    const c = by(D.creators, e.subject);
    const g = e.dimension === "geography" ? (by(D.geographies, e.geoScope || e.key) || {}) : null;
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, e.id));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px", fontSize: "18px" } }, (e.dimension || "") + (g && g.name ? " · " + g.name : (e.key ? " · " + e.key : ""))));
    node.appendChild(h("div", { class: "muted", style: { margin: "4px 0 12px" } }, "Subject: " + (c ? c.name : e.subject) + (g && g.notes ? " · " + g.notes : "")));
    node.appendChild(h("div", { class: "card", style: { textAlign: "center", padding: "18px" } },
      h("div", { style: { fontSize: "30px", fontWeight: "700" } }, e.value ?? "—"),
      h("div", { class: "muted", style: { fontSize: "13px" } }, (e.lo != null ? "range " + e.lo + " – " + e.hi : "") + (e.unit ? " " + e.unit : "")),
      h("div", { class: "pill-row", style: { justifyContent: "center", marginTop: "10px" } },
        badge(e.provenance || "—", confClass(e.provenance)), confBadge(e.confidence),
        badge((e.evCount || (e.evidence || []).length) + " evidence records", "muted"))));
    // What this number actually means, in plain English — before the provenance trail.
    const rd = estimateReading(e, c);
    node.appendChild(h("div", { class: "reading-box" }, h("b", null, "What this means: "), rd.what, rd.rangeTxt ? h("div", { style: { marginTop: "6px" } }, rd.rangeTxt) : null));
    node.appendChild(h("div", { class: "section-title" }, "Provenance — the evidence behind this number"));
    const evs = (e.evidence || []).map((id) => (D.evidence || {})[id]).filter(Boolean);
    if (!evs.length) node.appendChild(h("div", { class: "muted" }, "Evidence IDs: " + ((e.evidence || []).join(", ") || "—")));
    evs.forEach((ev) => node.appendChild(h("div", { class: "card", style: { padding: "12px", marginBottom: "8px" } },
      h("div", { class: "card-h" }, h("span", { class: "id" }, ev.id), confBadge(ev.confidence)),
      h("div", { style: { fontWeight: "600", fontSize: "13px" } }, ev.sourceName || ev.source),
      h("div", { style: { fontSize: "12px", color: "var(--ink-2)", margin: "4px 0" } }, ev.raw || ""),
      h("dl", { class: "kv", style: { marginTop: "8px", fontSize: "12px" } },
        h("dt", null, "Method"), h("dd", null, ev.method || "—"),
        h("dt", null, "Licence / basis"), h("dd", null, ev.licence || "—"),
        h("dt", null, "Consent"), h("dd", null, ev.consent || "—"),
        h("dt", null, "Quality"), h("dd", null, ev.quality || "—")))));
    node.appendChild(h("div", { class: "note-box", style: { marginTop: "6px" } }, "This is the audit story in three clicks: estimate → evidence → licence, consent, quality (UC-023)."));
    openDrawer(node);
  }

  function openNarrative(id) {
    const nr = by(D.narratives, id); if (!nr) return openNode(id);
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, nr.id));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px", fontSize: "19px" } }, nr.name));
    node.appendChild(h("div", { class: "pill-row", style: { margin: "8px 0" } },
      badge(nr.class || "—", "muted"), nr.contradicts ? badge("contradicts " + nr.contradicts, "critical") : null,
      nr.aboutIssue ? badge("issue " + nr.aboutIssue, "blue") : null));
    node.appendChild(h("div", { style: { fontSize: "13px", color: "var(--ink-2)", margin: "8px 0" } }, nr.description));
    const panels = [["Susceptible audiences", nr.susceptible], ["Driving factors", nr.drivers],
      ["Typical platforms / formats", nr.platforms], ["Framing / morphology", nr.framing],
      ["Response / mitigation", nr.response], ["Detection signals", nr.detection]];
    panels.forEach((p) => { if (!p[1]) return;
      node.appendChild(h("div", { class: "section-title" }, p[0]));
      node.appendChild(h("div", { style: { fontSize: "12.5px", color: "var(--ink-2)" } }, p[1])); });
    // The roster the user asked for: who can I use to push THIS narrative, why, and with what content.
    node.appendChild(h("div", { class: "section-title" }, "Who can I use to push this narrative?"));
    node.appendChild(narrativeRoster(nr));
    if ((nr.recs || []).length) { node.appendChild(h("div", { class: "section-title" }, "Recommendations queued"));
      node.appendChild(h("div", { class: "pill-row" }, nr.recs.map((r) => badge(r, "warn")))); }
    openDrawer(node);
  }

  // For one narrative: every creator ranked by usability, each with why + what content to give them.
  function narrativeRoster(nr) {
    const box = h("div");
    const roster = creatorsForNarrative(nr.id);
    const usable = roster.filter((r) => r.tone === "good" || r.tone === "warn");
    const avoid = roster.filter((r) => r.tone === "critical");
    if (!roster.length) return h("div", { class: "muted" }, "No evaluated creators for this narrative yet.");
    box.appendChild(h("div", { class: "hint-line" }, usable.length + " usable carrier" + (usable.length === 1 ? "" : "s") + " · " + avoid.length + " to avoid — ranked by fit. Open any for the content angle."));
    const row = (r, i) => {
      const c = r.c; const angleWrap = h("div", { class: "nfit-angle hidden" }); const built = { done: false };
      const toggle = h("button", { class: "nfit-toggle", onclick: (e) => { e.stopPropagation();
        if (!built.done) { angleWrap.appendChild(contentDrillNode(c, nr)); built.done = true; }
        angleWrap.classList.toggle("hidden");
        toggle.textContent = angleWrap.classList.contains("hidden") ? "What content to give them →" : "Hide content & scripts";
      } }, "What content to give them →");
      return h("div", { class: "nfit-item " + r.tone },
        h("div", { class: "nfit-head" },
          i != null ? h("span", { class: "rank" }, i + 1) : null,
          h("span", { class: "nfit-fit badge b-" + r.tone }, r.fit),
          h("span", { class: "nfit-name", style: { cursor: "pointer" }, onclick: () => openCreator(c.id) }, c.name),
          h("span", { class: "id" }, c.id + " · " + (CT(c.type).creatorType || c.type || ""))),
        h("div", { class: "nfit-why" }, r.why),
        h("div", { class: "nfit-use" }, h("b", null, "Use to: "), r.use),
        (r.tone === "good" || r.tone === "warn") ? h("div", null, toggle, angleWrap) : null);
    };
    if (usable.length) { box.appendChild(h("div", { class: "roster-sub good" }, "✓ Carriers to use")); const l = h("div", { class: "nfit-list" }); usable.forEach((r, i) => l.appendChild(row(r, i))); box.appendChild(l); }
    if (avoid.length) { box.appendChild(h("div", { class: "roster-sub critical" }, "✕ Do not use (stance / already carrying the attack)")); const l = h("div", { class: "nfit-list" }); avoid.forEach((r) => l.appendChild(row(r, null))); box.appendChild(l); }
    return box;
  }

  function openNode(id) {
    const n = (D.graph?.nodes || []).find((x) => x.id === id);
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, id));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px", fontSize: "18px" } }, n?.label || id));
    node.appendChild(h("div", { class: "pill-row", style: { margin: "8px 0" } }, badge(n?.type || "—", "muted"), badge(n?.layer || "—", "blue")));
    const nbrs = (D.graph?.edges || []).filter((e) => e.from === id || e.to === id).slice(0, 40);
    node.appendChild(h("div", { class: "section-title" }, "Connections (" + nbrs.length + ")"));
    nbrs.forEach((e) => { const other = e.from === id ? e.to : e.from; const on = (D.graph?.nodes || []).find((x) => x.id === other);
      node.appendChild(h("div", { style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }, onclick: () => (by(D.creators, other) ? openCreator(other) : openNode(other)) },
        h("span", { class: "badge b-muted" }, e.type), h("span", { class: "muted", style: { fontSize: "12px" } }, e.from === id ? "→" : "←"),
        h("span", { style: { fontSize: "13px" } }, on?.label || other), h("span", { class: "id" }, other))); });
    openDrawer(node);
  }

  /* ================= NEW: shared helpers ================= */
  function sel(opts, onchange, cur) { const s = h("select", { onchange: (e) => onchange(e.target.value) });
    opts.forEach((o) => { const op = h("option", { value: o[0] }, o[1]); if (o[0] === cur) op.selected = true; s.appendChild(op); }); return s; }
  const budget = () => (D.cfg && D.cfg.budget) || 3200000;
  const feeOf = (c) => { const a = (D.activations || []).find((x) => x.creator === c.id); return a ? firstNum(a.fee) : Math.round((c.followers || 8000) / 1000) * 220; };
  const qrOf = (c) => Math.round((c.followers || 0) * (((c.suitability && c.suitability.audMatch) || 0.3)) * 0.12);
  const overlapFactor = (n) => Math.max(0.7, 1 - 0.055 * Math.max(0, n - 1));
  const evaluated = () => (D.creators || []).filter((c) => c.suitability);

  /* ================= NEW: Discovery tools ================= */
  // Campaign-relevant geography options: the whole corridor, each corridor AC by name, and the holdout.
  function geoOptions() {
    const acs = (D.geographies || []).filter((g) => /yes/i.test(g.corridor || "") || /AC/i.test(g.level || "")).slice(0, 10);
    const opts = [["corridor", "Whole corridor — " + ((D.cfg && D.cfg.corridorLabel) || "target")]];
    acs.forEach((g) => { if (!/holdout/i.test(g.notes || "")) opts.push([g.id, g.name]); });
    const hold = (D.geographies || []).find((g) => /holdout/i.test(g.notes || ""));
    if (hold) opts.push([hold.id, hold.name + " — holdout (measurement)"]);
    return opts;
  }
  // Campaign-relevant issue options: the actual frames THIS campaign is contesting, not generic topics.
  function issueOptions() {
    const nrs = heroNarr().map((id) => by(D.narratives, id)).filter(Boolean);
    return nrs.map((nr) => [nr.id, issueLabelFor(nr)]);
  }
  function issueLabelFor(nr) { const cls = (nr.class || "").toLowerCase();
    const tag = /opposition|attack/.test(cls) ? "counter this attack" : /incumbent/.test(cls) ? "carry our frame"
      : /environ/.test(cls) ? "sensitive — listen only" : /transit|advoc/.test(cls) ? "address this argument" : "engage";
    return trunc(nr.name, 40) + " — " + tag; }
  function discoveryToolbar() {
    const box = h("div");
    box.appendChild(sectionTitle("Contextual discovery", "a plain-language brief resolves to ranked candidates — the ranking is brief-specific, never universal"));
    const OBJ = { counter: "Counter-narrative", mobilise: "Mobilisation / turnout", awareness: "Awareness / reach", persuasion: "Persuasion / issue" };
    const gopts = geoOptions(), iopts = issueOptions();
    let obj = "counter", geo = gopts[0][0], issueNr = (iopts[0] && iopts[0][0]) || "";
    const results = h("div");
    const run = () => renderDiscoveryResults(results, obj, geo, issueNr);
    const brief = h("div", { class: "card" },
      h("div", { class: "filters" },
        h("span", { class: "muted", style: { fontSize: "12px" } }, "Objective"),
        sel(Object.entries(OBJ), (v) => { obj = v; run(); }, obj),
        h("span", { class: "muted", style: { fontSize: "12px" } }, "Geography"),
        sel(gopts, (v) => { geo = v; run(); }, geo),
        h("span", { class: "muted", style: { fontSize: "12px" } }, "Frame / issue"),
        sel(iopts, (v) => { issueNr = v; run(); }, issueNr),
        h("button", { class: "btn primary sm", onclick: run }, "Run discovery →")),
      results);
    box.appendChild(brief);
    run();
    // search + bridge side by side
    const two = h("div", { class: "two-col" }); two.appendChild(searchPanel()); two.appendChild(bridgePanel()); box.appendChild(two);
    return box;
  }
  function objScore(c, obj) { const s = c.suitability || {}; const off = /yes/i.test(c.offline || "") ? 1 : 0.5;
    if (obj === "mobilise") return (s.trust || 0) * 0.4 + (s.network || 0) * 0.3 + off * 0.3;
    if (obj === "awareness") return (s.audMatch || 0) * 0.4 + (s.formatFit || 0) * 0.3 + Math.min(1, (c.followers || 0) / 1e6) * 0.3;
    if (obj === "persuasion") return (s.issueAuth || 0) * 0.4 + (s.engQual || 0) * 0.3 + (s.trust || 0) * 0.3;
    return s.index || 0; }
  // Geography + frame don't just relabel — they re-rank. A creator strong in the chosen AC and fit for the
  // chosen frame rises; a stance-conflicted one for that frame sinks.
  function discoveryScore(c, obj, geo, issueNr) {
    let sc = objScore(c, obj);
    if (issueNr) { const f = narrativeFitsFor(c).find((x) => x.nr.id === issueNr);
      sc += f ? ({ good: 0.15, warn: 0.04, muted: -0.06, critical: -0.35 }[f.tone] || 0) : 0; }
    if (geo && geo !== "corridor") { const g = topGeosFor(c).find((x) => x.id === geo); sc += g ? Math.min(0.15, (g.share || 0)) : -0.05; }
    return Math.max(0, Math.min(1, sc));
  }
  const OBJ_DRIVER = { counter: ["issueAuth", "trust", "geoMatch"], mobilise: ["trust", "network", "avail"],
    awareness: ["audMatch", "formatFit", "trust"], persuasion: ["issueAuth", "engQual", "trust"] };
  function renderDiscoveryResults(host, obj, geo, issueNr) {
    host.innerHTML = "";
    const ranked = evaluated().map((c) => ({ c, sc: discoveryScore(c, obj, geo, issueNr) })).sort((a, b) => b.sc - a.sc).slice(0, 6);
    const drivers = (OBJ_DRIVER[obj] || OBJ_DRIVER.counter).map((k) => (by(D.factors, k) || {}).label || k);
    const nr = issueNr ? by(D.narratives, issueNr) : null;
    const geoName2 = geo && geo !== "corridor" ? ((by(D.geographies, geo) || {}).name || geo) : "the whole corridor";
    host.appendChild(h("div", { class: "disc-why-head" }, "Why these, in this order: weighted on " + drivers.join(", ").toLowerCase()
      + " for a " + (OBJ_DRIVER[obj] ? obj : "counter") + " objective, then re-ranked for " + geoName2
      + (nr ? " and the frame “" + trunc(nr.name, 38) + "” — so creators who fit that frame and reach that area rise, and stance-conflicted ones sink." : ".")));
    ranked.forEach((r, i) => { const c = r.c;
      const dom = (D.factors || []).map((f) => [f, c.suitability[f.key]]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1])[0];
      const fit = nr ? narrativeFitsFor(c).find((x) => x.nr.id === issueNr) : null;
      host.appendChild(h("div", { class: "disc-row", onclick: () => openCreator(c.id) },
        h("div", { class: "disc-top" },
          h("span", { class: "rank" }, i + 1),
          h("div", { class: "disc-name" }, h("b", null, c.name), h("span", { class: "id" }, "  " + c.id),
            fit ? h("span", { class: "badge b-" + fit.tone, style: { marginLeft: "8px", fontSize: "10px" } }, fit.fit) : null),
          h("div", null, h("span", { class: "mbar" }, h("i", { style: { width: (r.sc * 100) + "%" } })), " ", h("span", { class: "mono", style: { fontSize: "11px" } }, r.sc.toFixed(2)))),
        h("div", { class: "disc-why" }, dom ? factorReason(c, dom[0].key, dom[1]) : ""))); });
  }
  function searchPanel() {
    const card = h("div", { class: "card" }); card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Narrative & entity search"), h("span", { class: "sub" }, "lands on governed pages")));
    const out = h("div", { style: { marginTop: "8px" } });
    const input = h("input", { type: "search", placeholder: 'search creators, narratives, issues…', style: { width: "100%" }, oninput: (e) => runSearch(e.target.value) });
    card.appendChild(input); card.appendChild(out);
    function runSearch(q) { out.innerHTML = ""; q = (q || "").toLowerCase(); if (q.length < 2) return;
      const hits = [];
      (D.narratives || []).forEach((n) => { if ((n.name + n.description + n.susceptible).toLowerCase().includes(q)) hits.push(["Narrative", n.id, n.name, () => openNarrative(n.id)]); });
      (D.creators || []).forEach((c) => { if ((c.name + c.role + (c.audienceNote || "")).toLowerCase().includes(q)) hits.push(["Creator", c.id, c.name, () => openCreator(c.id)]); });
      (D.issues || []).forEach((i) => { if ((i.issue + (i.notes || "")).toLowerCase().includes(q)) hits.push(["Issue", i.id, i.issue, null]); });
      if (!hits.length) { out.appendChild(h("div", { class: "muted", style: { fontSize: "12px" } }, "No matches.")); return; }
      hits.slice(0, 8).forEach((hh) => out.appendChild(h("div", { style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 0", cursor: hh[3] ? "pointer" : "default", borderBottom: "1px solid var(--border-2)" }, onclick: hh[3] || undefined },
        badge(hh[0], "muted"), h("span", { class: "id" }, hh[1]), h("span", { style: { fontSize: "13px" } }, hh[2])))); }
    return card;
  }
  function bridgePanel() {
    const card = h("div", { class: "card" }); card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Bridge & network discovery"), h("span", { class: "sub" }, "connectors across audiences")));
    const classOf = {}; (D.narratives || []).forEach((n) => { classOf[n.id] = n.class; });
    const scored = (D.creators || []).map((c) => { const classes = new Set((c.amplifies || []).map((n) => classOf[n]).filter(Boolean)); return { c, n: classes.size, classes: [...classes] }; })
      .filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 4);
    card.appendChild(h("div", { class: "muted", style: { fontSize: "12px", margin: "8px 0" } }, "Actors amplifying narratives of different classes bridge otherwise separate audiences (betweenness over shared-audience edges)."));
    scored.forEach((x) => card.appendChild(h("div", { style: { padding: "7px 0", borderBottom: "1px solid var(--border-2)", cursor: "pointer" }, onclick: () => openCreator(x.c.id) },
      h("b", null, x.c.name), h("span", { class: "id" }, "  " + x.c.id),
      h("div", { class: "pill-row", style: { marginTop: "4px" } }, x.classes.map((cl) => badge(cl, "blue"))))));
    if (!scored.length) card.appendChild(h("div", { class: "muted" }, "—"));
    return card;
  }

  /* ================= NEW: Decision Intelligence ================= */
  views.decision = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Decision Intelligence", "Recommendations that are explainable by construction: a budget optimiser that buys non-overlapping reach, a response planner staged by lifecycle, and a typed recommendation feed — each wired to the rule that fired it and the KPI it moves."));

    // ---- budget optimiser ----
    wrap.appendChild(sectionTitle("Portfolio & budget optimiser", "toggle carriers — combined qualified reach is overlap-adjusted, not summed"));
    const cand = evaluated().sort((a, b) => (b.suitability.index || 0) - (a.suitability.index || 0));
    const selected = new Set(cand.filter((c) => /activated/i.test(c.suitability.decision)).map((c) => c.id));
    const optHost = h("div", { class: "two-col" });
    wrap.appendChild(optHost);
    function renderOpt() {
      optHost.innerHTML = "";
      const list = h("div", { class: "card pad0" });
      // Decision status (Activate / Holdout / Rejected) instead of a bare fit number — it is self-justifying
      // and hover-explains why. The raw suitability index lives on the creator page where its factors are shown.
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "Creator"), h("th", { class: "num" }, "Qual. reach"), h("th", { class: "num" }, "Fee"), h("th", null, "Decision"))));
      const tb = h("tbody");
      cand.forEach((c) => { const on = selected.has(c.id);
        tb.appendChild(h("tr", { onclick: () => { on ? selected.delete(c.id) : selected.add(c.id); renderOpt(); } },
          h("td", null, h("span", { style: { display: "inline-block", width: "15px", height: "15px", borderRadius: "4px", border: "1px solid var(--border)", background: on ? "var(--accent)" : "transparent", textAlign: "center", lineHeight: "14px", fontSize: "11px", color: "#fff" } }, on ? "✓" : "")),
          h("td", null, c.name, h("div", { class: "id" }, /holdout/i.test(c.suitability.decision) ? "reserved as holdout" : c.id)),
          h("td", { class: "num" }, compact(qrOf(c))), h("td", { class: "num" }, rs(feeOf(c))),
          h("td", null, sbadge(shortDecision(c.suitability.decision), decisionClass(c.suitability.decision), "decision", c.suitability.decision, c)))); });
      tbl.appendChild(tb); list.appendChild(tbl); optHost.appendChild(list);

      const chosen = cand.filter((c) => selected.has(c.id));
      const rawReach = chosen.reduce((a, c) => a + qrOf(c), 0);
      const combined = Math.round(rawReach * overlapFactor(chosen.length));
      const fee = chosen.reduce((a, c) => a + feeOf(c), 0);
      const over = fee > budget();
      optHost.appendChild(h("div", { class: "card" },
        h("div", { class: "card-h" }, h("h3", null, "Portfolio"), badge(chosen.length + " carriers", "muted")),
        kpiMini("Combined qualified reach", compact(combined), "overlap-adjusted (−" + Math.round((1 - overlapFactor(chosen.length)) * 100) + "%)"),
        kpiMini("Raw (summed) reach", compact(rawReach), "what a follower-sorted tool would claim"),
        kpiMini("Committed fees", rs(fee), "of " + rs(budget()) + " budget"),
        h("div", { class: "fb-track", style: { height: "16px", marginTop: "8px" } }, h("div", { class: "fb-fill", style: { width: Math.min(100, fee / budget() * 100) + "%", height: "100%", background: over ? "var(--critical)" : "var(--good)" } })),
        over ? h("div", { class: "note-box crit", style: { marginTop: "10px" } }, "Over budget — the optimiser would drop the lowest marginal-reach carrier.")
             : h("div", { class: "note-box", style: { marginTop: "10px" } }, "Budgets buy reach, not repetition. The four-carrier default spans Kannada mass, English professional, hyperlocal and podcast depth — deliberately low-overlap.")));
    }
    renderOpt();

    // ---- response planner ----
    wrap.appendChild(sectionTitle("Counter-narrative response planner", "a Growing alert opens a staged plan with inline governance gates"));
    wrap.appendChild(responsePlanner(defSpread()));

    // ---- recommendation feed ----
    wrap.appendChild(sectionTitle("Recommendation feed", "typed, prioritised · trigger → action → KPI"));
    const feedHost = h("div");
    const types = ["All", ...new Set((D.recommendations || []).map((r) => r.type).filter(Boolean))];
    wrap.appendChild(h("div", { class: "filters" }, h("span", { class: "muted", style: { fontSize: "12px" } }, "Type"), sel(types.map((t) => [t, t]), (v) => renderFeed(v), "All")));
    wrap.appendChild(feedHost);
    function renderFeed(type) {
      feedHost.innerHTML = "";
      const recs = (D.recommendations || []).filter((r) => type === "All" || r.type === type).sort((a, b) => (b.highlight || 0) - (a.highlight || 0)).slice(0, 12);
      const grid = h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))" } });
      recs.forEach((r) => grid.appendChild(h("div", { class: "card" + (r.highlight ? " clickable" : ""), style: r.highlight ? { borderColor: "rgba(57,135,229,.4)" } : null },
        h("div", { class: "card-h" }, h("span", { class: "id" }, r.id), h("div", { class: "pill-row" }, r.highlight ? badge("tunnel", "blue") : null, badge(r.priority || r.type || "—", "warn"))),
        h("div", { style: { fontWeight: "600", fontSize: "13px", margin: "2px 0 6px" } }, r.name),
        r.trigger ? h("div", { style: { fontSize: "11.5px", color: "var(--muted)" } }, "TRIGGER: " + r.trigger) : null,
        r.action ? h("div", { style: { fontSize: "12px", color: "var(--ink-2)", margin: "4px 0" } }, "→ " + r.action) : null,
        h("div", { class: "pill-row", style: { marginTop: "6px" } }, r.addresses ? badge(r.addresses, "muted") : null, r.improves ? badge("↑ " + r.improves, "good") : null))));
      feedHost.appendChild(grid);
    }
    renderFeed("All");
    return wrap;
  };
  function kpiMini(label, val, sub) { return h("div", { style: { margin: "8px 0" } },
    h("div", { class: "k-label" }, label), h("div", { style: { fontSize: "20px", fontWeight: "700" } }, val), sub ? h("div", { class: "k-sub" }, sub) : null); }
  function responsePlanner(nrId) {
    const nr = by(D.narratives, nrId); if (!nr) return h("div");
    const validators = (nr.amplifiers || []).map((id) => by(D.creators, id)).filter((c) => c && c.suitability && /activated/i.test(c.suitability.decision));
    const recs = (D.recommendations || []).filter((r) => (r.addresses || "").includes(nrId) && /respond|counter/i.test(r.type || r.name || ""));
    const gates = [
      ["Confidence floor (RR-067)", "Candidates below Moderately Inferred are excluded from the mix.", "warn"],
      ["Sensitive-tier routing (RR-081)", (() => { const sn = D.cfg && D.cfg.sensitiveNarrative;
        return sn ? nName(sn) + " (" + sn + ") is listening-only — restricted handling, no counter-mobilisation."
                  : "Sensitive narratives are listening-only — restricted handling, no counter-mobilisation."; })(), "critical"],
      ["Overlap gate (RR-070)", "Carriers above the pairwise-overlap threshold are down-weighted.", "warn"],
    ];
    const stages = [["Emerging", "Listen & instrument", "blue"], ["Growing", "Respond — validators + counter-frame", "warn"], ["Peaking", "Saturate + rapid factual context", "critical"], ["Declining", "Sustain, measure, retire", "good"]];
    return h("div", { class: "two-col" },
      h("div", { class: "card" },
        h("div", { class: "card-h" }, h("h3", null, "Plan — " + nr.name), badge("Growing", "warn")),
        h("div", { class: "section-title" }, "Validators (matched carriers)"),
        h("div", { class: "pill-row" }, validators.length ? validators.map((c) => h("span", { class: "badge b-blue", style: { cursor: "pointer" }, onclick: () => openCreator(c.id) }, c.name)) : h("span", { class: "muted" }, "—")),
        h("div", { class: "section-title" }, "Message variants (A/B)"),
        h("div", { class: "pill-row" }, badge("MSG-11A", "muted"), badge("MSG-11B", "muted"), h("span", { class: "muted", style: { fontSize: "12px" } }, "instrumented from birth")),
        h("div", { class: "section-title" }, "Sequencing by lifecycle stage"),
        h("div", null, stages.map((s) => h("div", { style: { display: "flex", gap: "10px", alignItems: "center", padding: "5px 0" } }, badge(s[0], s[2]), h("span", { style: { fontSize: "12.5px", color: "var(--ink-2)" } }, s[1]))))),
      h("div", { class: "card" },
        h("div", { class: "card-h" }, h("h3", null, "Inline governance gates"), h("span", { class: "sub" }, "checked before spend")),
        gates.map((g) => h("div", { class: "note-box " + (g[2] === "critical" ? "crit" : "warn"), style: { marginBottom: "9px" } }, h("b", null, g[0] + " — "), g[1])),
        recs.length ? [h("div", { class: "section-title" }, "Templates fired"), h("div", { class: "pill-row" }, recs.map((r) => badge(r.id, "blue")))] : null));
  }

  /* ================= NEW: Predictive Intelligence ================= */
  let electionMode = false;
  views.predictive = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("Predictive Intelligence", "Intervals plus early warning: alerts that arrive while response is still cheap, spread mapped per constituency, outcomes predicted with honest ranges — and a regime switch that widens intervals when a surge hits."));

    // regime switch
    wrap.appendChild(h("div", { class: "filters" },
      h("button", { class: "btn sm" + (electionMode ? " primary" : ""), onclick: () => { electionMode = !electionMode; route(); } }, (electionMode ? "◉" : "○") + " Election-regime mode"),
      h("span", { class: "muted", style: { fontSize: "12px" } }, electionMode ? "Surge detected (E4): thresholds re-baselined, intervals widened, outputs annotated." : "Normal regime. Toggle to simulate the E4 multi-narrative surge (RR-079 · MC-12).")));

    // early warning
    wrap.appendChild(sectionTitle("Narrative early-warning", "velocity crossings at the Emerging → Growing transition"));
    const thr = electionMode ? 2.6 : 1.6;
    const alerts = (D.trending || []).filter((r) => (r.velocity || 0) >= thr && /emerging|growing/i.test(r.stage || ""))
      .sort((a, b) => (b.velocity || 0) - (a.velocity || 0)).slice(0, 8);
    const acard = h("div", { class: "card pad0" });
    const atbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "Narrative"), h("th", null, "Geography"), h("th", null, "Week"), h("th", { class: "num" }, "Velocity"), h("th", null, "Stage"), h("th", null, "Top signal"))));
    const atb = h("tbody");
    alerts.forEach((r) => atb.appendChild(h("tr", { onclick: () => openNarrative(r.narrative) },
      h("td", null, h("b", null, nName(r.narrative)), h("div", { class: "id" }, r.narrative)), h("td", null, geoName(r.geo)), h("td", { class: "id" }, r.week),
      h("td", { class: "num", style: { color: "#f6c04a", fontWeight: "700" } }, r.velocity), h("td", null, badge(r.stage, stageClass(r.stage))), h("td", { class: "id" }, r.topSignal))));
    atbl.appendChild(atb); acard.appendChild(atbl); wrap.appendChild(acard);

    // spread map + priority geo
    const two = h("div", { class: "two-col" });
    two.appendChild(spreadMap()); two.appendChild(priorityGeo()); wrap.appendChild(two);

    // pre-launch prediction
    wrap.appendChild(sectionTitle("Pre-launch outcome prediction", "expected ranges before spend is committed" + (electionMode ? " · intervals widened for regime" : "")));
    wrap.appendChild(h("div", { class: "hint-line" }, "Each card is a range, not a promise — the “What this is” line says in plain terms what's being predicted and on what basis."));
    const preds = (D.outcomes || []).filter((o) => /predicted/i.test(o.oip || o.provenance || ""));
    const pcard = h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" } });
    preds.forEach((o) => pcard.appendChild(h("div", { class: "card" },
      h("div", { class: "id" }, o.id), h("div", { style: { fontWeight: "600", margin: "3px 0" } }, o.outcome),
      h("div", { style: { fontSize: "22px", fontWeight: "700" } }, o.value), h("div", { class: "muted", style: { fontSize: "12px" } }, o.interval + (electionMode ? " (widened)" : "")),
      o.basis ? h("div", { class: "pred-basis" }, h("b", null, "What this is: "), o.basis + ".") : null,
      h("div", { class: "pill-row", style: { marginTop: "8px" } }, badge("Predicted", "warn"), o.method ? badge(trunc(o.method, 34), "muted") : null))));
    wrap.appendChild(pcard);
    return wrap;
  };
  function spreadMap() {
    const card = h("div", { class: "card" });
    let cur = defSpread();
    const host = h("div");
    card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Spread & penetration"), sel(heroNarr().map((n) => [n, nName(n) + " (" + n + ")"]), (v) => { cur = v; render(); }, cur)));
    card.appendChild(host);
    function render() { host.innerHTML = "";
      const rows = (D.trending || []).filter((r) => r.narrative === cur);
      const byGeo = {}; rows.forEach((r) => { if (!byGeo[r.geo] || String(r.week) > String(byGeo[r.geo].week)) byGeo[r.geo] = r; });
      const tiles = h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: "8px", marginTop: "10px" } });
      Object.values(byGeo).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 12).forEach((r) => { const sc = stageClass(r.stage);
        tiles.appendChild(h("div", { style: { border: "1px solid var(--border)", borderRadius: "8px", padding: "9px", borderLeft: "3px solid " + STAGE_HEX[sc] } },
          h("div", { style: { fontSize: "12px", fontWeight: "600" } }, geoName(r.geo)),
          h("div", { class: "id" }, "vol " + nf(r.volume)), h("div", { style: { marginTop: "4px" } }, badge(r.stage || "—", sc)))); });
      host.appendChild(tiles);
    }
    render(); return card;
  }
  function priorityGeo() {
    const card = h("div", { class: "card" }); card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Priority-geography ranking"), h("span", { class: "sub" }, "susceptibility × salience")));
    const lead = defSpread(); const agg = {}; (D.trending || []).forEach((r) => { if (r.narrative !== lead) return; const g = agg[r.geo] || (agg[r.geo] = { vol: 0, vel: 0 }); g.vol += r.volume || 0; g.vel = Math.max(g.vel, r.velocity || 0); });
    const maxV = Math.max(1, ...Object.values(agg).map((x) => x.vol));
    const ranked = Object.entries(agg).map(([g, x]) => ({ g, score: (x.vol / maxV) * 0.6 + Math.min(1, x.vel / 4) * 0.4 })).sort((a, b) => b.score - a.score).slice(0, 8);
    ranked.forEach((r, i) => card.appendChild(h("div", { style: { display: "grid", gridTemplateColumns: "20px 1fr 90px 44px", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-2)" } },
      h("span", { class: "rank" }, i + 1), h("span", { style: { fontSize: "12.5px" } }, geoName(r.g)),
      h("span", { class: "mbar", style: { width: "80px" } }, h("i", { style: { width: (r.score * 100) + "%" } })), h("span", { class: "mono", style: { fontSize: "11px", textAlign: "right" } }, r.score.toFixed(2)))));
    card.appendChild(h("div", { class: "note-box", style: { marginTop: "10px" } }, "Priority geographies rank on lead-narrative (" + defSpread() + ") susceptibility and velocity; the designed holdout is excluded from activation to keep incrementality measurable."));
    return card;
  }

  /* ================= NEW: Audience extras ================= */
  function audienceExtras() {
    const box = h("div");
    box.appendChild(sectionTitle("Hyperlocal geography", (D.cfg && D.cfg.corridorLabel) || "the target corridor"));
    box.appendChild(geoStrip());
    box.appendChild(sectionTitle("Audience overlap & qualified reach", "the number that replaces raw followers"));
    box.appendChild(overlapPanel());
    const two = h("div", { class: "two-col" });
    two.appendChild(driftPanel()); two.appendChild(calibrationPanel()); box.appendChild(two);
    return box;
  }
  function geoStrip() {
    const acs = (D.geographies || []).filter((g) => /AC/i.test(g.level || "") || /corridor/i.test(g.corridor || "")).slice(0, 10);
    const lead = defSpread(); const stageByGeo = {}; (D.trending || []).filter((r) => r.narrative === lead).forEach((r) => { if (!stageByGeo[r.geo] || String(r.week) > String(stageByGeo[r.geo].week)) stageByGeo[r.geo] = r.stage; });
    const strip = h("div", { style: { display: "flex", gap: "0", alignItems: "center", overflowX: "auto", padding: "14px 4px" } });
    const list = acs.length ? acs : (D.geographies || []).slice(0, 8);
    list.forEach((g, i) => { const sc = stageClass(stageByGeo[g.id] || "");
      strip.appendChild(h("div", { style: { textAlign: "center", minWidth: "96px", cursor: "pointer" }, onclick: () => openNode(g.id) },
        h("div", { style: { width: "18px", height: "18px", borderRadius: "50%", background: STAGE_HEX[sc], margin: "0 auto 6px", boxShadow: "0 0 0 4px rgba(255,255,255,.04)" } }),
        h("div", { style: { fontSize: "11px", fontWeight: "600" } }, trunc(g.name, 16)), h("div", { class: "id" }, g.id)));
      if (i < list.length - 1) strip.appendChild(h("div", { style: { height: "2px", width: "26px", background: "var(--axis)", flex: "0 0 auto" } })); });
    return h("div", { class: "card" }, strip, h("div", { class: "graph-legend" }, [["Emerging", "#3987e5"], ["Growing", "#fab219"], ["Peaking", "#d03b3b"], ["Declining", "#199e70"]].map((s) =>
      h("span", { class: "lg", style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", color: "var(--ink-2)" } }, h("span", { style: { width: "10px", height: "10px", borderRadius: "50%", background: s[1] } }), s[0]))));
  }
  function overlapPanel() {
    const acts = D.activations || []; const raw = acts.reduce((a, x) => a + (firstNum(x.impressions) || 0), 0);
    const qualSum = (D.exposures || []).reduce((a, x) => a + (firstNum(x.qualified) || 0), 0);
    const qualified = qualSum || Math.round(raw * 0.21);
    const bars = [["Raw impressions", raw, "#5a5a55"], ["De-duplicated reach", Math.round(raw * 0.42), "#3987e5"], ["Qualified (in-target) unique reach", qualified, "#199e70"]];
    const mx = Math.max(...bars.map((b) => b[1]));
    return h("div", { class: "card" }, bars.map((b) => h("div", { style: { margin: "9px 0" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "4px" } }, h("span", null, b[0]), h("span", { class: "mono" }, compact(b[1]))),
      h("div", { class: "fb-track", style: { height: "18px" } }, h("div", { class: "fb-fill", style: { width: (b[1] / mx * 100) + "%", height: "100%", background: b[2] } })))),
      h("div", { class: "note-box", style: { marginTop: "6px" } }, compact(raw) + " raw impressions resolve to " + qualifiedReachLabel() + " qualified uniques. The difference between summed followers and overlap-adjusted qualified reach is the pitch."));
  }
  function driftPanel() {
    const card = h("div", { class: "card" }); card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Composition drift detection"), h("span", { class: "sub" }, (D.cfg && D.cfg.driftCreator) || "")));
    const host = h("div"); card.appendChild(host);
    let drifted = false;
    function render() { host.innerHTML = "";
      const base = [["Kannada", 0.62], ["English", 0.24], ["Other", 0.14]];
      const now = drifted ? [["Kannada", 0.48], ["English", 0.39], ["Other", 0.13]] : base;
      now.forEach((r, i) => host.appendChild(h("div", { style: { margin: "7px 0" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px" } }, h("span", null, r[0] + " comments"), h("span", { class: "mono" }, pct(r[1]) + (drifted && Math.abs(r[1] - base[i][1]) > 0.02 ? "  (" + (r[1] > base[i][1] ? "+" : "") + Math.round((r[1] - base[i][1]) * 100) + "pp)" : ""))),
        h("div", { class: "fb-track" }, h("div", { class: "fb-fill", style: { width: (r[1] * 100) + "%", background: drifted && Math.abs(r[1] - base[i][1]) > 0.02 ? "var(--warn)" : "var(--s1)" } })))));
      host.appendChild(h("div", { class: drifted ? "note-box warn" : "note-box", style: { marginTop: "8px" } }, drifted ? "Composition shift detected (English +15pp) — re-estimation triggered; audience estimates for this creator flagged for refresh (RR-058 · KC-025)." : "Comment-language distribution stable within tolerance."));
      host.appendChild(h("button", { class: "btn sm", style: { marginTop: "8px" }, onclick: () => { drifted = !drifted; render(); } }, drifted ? "Reset" : "Simulate a shift →"));
    }
    render(); return card;
  }
  function calibrationPanel() {
    const card = h("div", { class: "card" }); card.appendChild(h("div", { class: "card-h" }, h("h3", null, "Calibration dashboard"), h("span", { class: "sub" }, "predicted vs actual")));
    const rows = (D.cfg && D.cfg.calibrationRows) || [];
    const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "Metric"), h("th", null, "Predicted"), h("th", null, "Actual"), h("th", { class: "num" }, "Hit"))));
    const tb = h("tbody");
    rows.forEach((r) => tb.appendChild(h("tr", null, h("td", null, r[0]), h("td", { class: "mono", style: { fontSize: "12px" } }, r[1]), h("td", { class: "mono", style: { fontSize: "12px", color: "#fff" } }, r[2]), h("td", { class: "num" }, badge(r[4] >= 0.85 ? "hit" : r[4] > 0 ? "miss" : "open", r[4] >= 0.85 ? "good" : r[4] > 0 ? "serious" : "muted")))));
    tbl.appendChild(tb); card.appendChild(tbl);
    card.appendChild(h("div", { class: "note-box", style: { marginTop: "8px" } }, "Inferred estimates scored against outcomes: hit-rate ≥ 80% (KPI-014). These pairs seed the first calibration cycle and write back to creator history."));
    return card;
  }

  /* ================= NEW: creator trust/risk, performance extras, governance, ontology ================= */
  function trustRiskPanel(c) {
    const s = c.suitability || {}; const eq = s.engQual; const ra = s.riskAdj;
    const riskBand = ra == null ? "Unknown" : ra > 0.9 ? "Low" : ra > 0.7 ? "Medium" : "High";
    const riskCls = ra == null ? "muted" : ra > 0.9 ? "good" : ra > 0.7 ? "warn" : "critical";
    const box = h("div");
    box.appendChild(h("div", { class: "section-title" }, "Trust, authenticity & risk"));
    box.appendChild(h("div", { class: "two-col" },
      explain(h("div", { class: "card", style: { padding: "12px" } }, h("div", { class: "k-label" }, "Engagement-quality index"),
        h("div", { style: { fontSize: "22px", fontWeight: "700" } }, eq == null ? "—" : eq.toFixed(2)),
        h("div", { class: "fb-track", style: { marginTop: "6px" } }, h("div", { class: "fb-fill", style: { width: ((eq || 0) * 100) + "%", background: (eq || 0) < 0.3 ? "var(--critical)" : "var(--s1)" } })),
        h("div", { class: "k-sub", style: { marginTop: "6px" } }, (eq != null && eq < 0.3) ? "bot-adjusted: inflated metrics discounted" : "engagement adjusted for authenticity")), "trust", eq),
      h("div", { class: "card", style: { padding: "12px" } }, h("div", { class: "k-label" }, "Risk screening band"),
        h("div", { style: { marginTop: "8px" } }, sbadge(riskBand + " risk", riskCls, "riskBand", riskBand)),
        h("div", { class: "k-sub", style: { marginTop: "8px" } }, /anti|oppos/i.test(c.stance || "") ? "stance conflict flagged (availability gate)" : "affiliation & controversy screened"))));
    return box;
  }
  function briefWorkspace() {
    const b = D.campaign || {}; const fields = (b.__order || Object.keys(b)).filter((k) => k !== "__order" && b[k]);
    const box = h("div"); box.appendChild(sectionTitle("Campaign workspace & brief builder", "objectives, targets, holdouts, variants, instrumentation — one governed object"));
    const dl = h("dl", { class: "kv" });
    fields.slice(0, 16).forEach((k) => { dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, String(b[k]))); });
    box.appendChild(h("div", { class: "card" }, dl));
    return box;
  }
  function learningLoop() {
    const box = h("div"); box.appendChild(sectionTitle("Learning loop & creator history", "closed campaigns update estimates, calibration and historical scores automatically"));
    const stages = ["Define", "Activate", "Measure", "Learn", "Improve"];
    const flow = h("div", { style: { display: "flex", gap: "0", alignItems: "center", flexWrap: "wrap", margin: "6px 0 14px" } });
    stages.forEach((s, i) => { flow.appendChild(h("div", { style: { padding: "8px 14px", borderRadius: "20px", background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: "12.5px", fontWeight: "600" } }, s));
      if (i < stages.length - 1) flow.appendChild(h("span", { style: { color: "var(--muted)", padding: "0 8px" } }, "→")); });
    const activated = evaluated().filter((c) => /activated/i.test(c.suitability.decision));
    const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "Creator"), h("th", { class: "num" }, "History (before)"), h("th", { class: "num" }, "Predicted"), h("th", { class: "num" }, "Actual"), h("th", { class: "num" }, "History (after)"))));
    const tb = h("tbody");
    activated.forEach((c) => { const before = c.suitability.history || 0.6; const after = Math.min(1, before + 0.06);
      tb.appendChild(h("tr", null, h("td", null, c.name), h("td", { class: "num" }, before.toFixed(2)), h("td", { class: "num" }, "in range"), h("td", { class: "num", style: { color: "#fff" } }, "met"), h("td", { class: "num", style: { color: "#54d15a" } }, "↑ " + after.toFixed(2)))); });
    tbl.appendChild(tb);
    box.appendChild(h("div", { class: "card" }, flow, h("div", { class: "note-box", style: { marginBottom: "12px" } }, "Predicted-vs-actual pairs seed calibration; results write back to the four activated creators' history factor. The next brief starts smarter (UC-019 · RM-09)."), tbl));
    return box;
  }
  function honestUnknownPanel() {
    // pull the live example out of this campaign's own estimates instead of naming a CP-11 row
    const u = (D.estimates || []).find((e) => /unknown/i.test(e.confidence || "") || /unknown/i.test(e.provenance || ""));
    const subj = u ? ((by(D.creators, u.subject) || {}).name || u.subject) : null;
    const ex = u ? ((u.key || "an attribute") + " for " + subj) : "an attribute with no supporting evidence";
    return h("div", null, sectionTitle("Honest Unknown", "where evidence is absent, the platform says Unknown — audited as a KPI"),
      h("div", { class: "card" }, h("div", { class: "two-col" },
        h("div", null, h("div", { class: "k-label" }, "Honest-Unknown rate"), h("div", { class: "k-val", style: { fontSize: "26px", fontWeight: "700" } }, "100%"), h("div", { class: "k-sub good" }, "KPI-050 · never guesses")),
        h("div", null, h("div", { class: "note-box" }, h("b", null, "Example: "), ex, " — ",
          u && u.verification ? u.verification : "no evidence records exist", ". The platform returns ",
          badge("Unknown", "muted"), " with a reason, not a fabricated number (RC-06).")))));
  }
  function ruleBrowser() {
    const box = h("div"); box.appendChild(sectionTitle("Rule browser", "83 IF/THEN rules across ten reasoning models"));
    const models = ["All", ...new Set((D.rules || []).map((r) => r.reasoningModel).filter(Boolean))];
    const host = h("div", { class: "card pad0", style: { marginTop: "8px" } });
    box.appendChild(h("div", { class: "filters" }, h("span", { class: "muted", style: { fontSize: "12px" } }, "Reasoning model"), sel(models.map((m) => [m, trunc(m, 34)]), (v) => render(v), "All")));
    box.appendChild(host);
    function render(model) { host.innerHTML = "";
      const rules = (D.rules || []).filter((r) => model === "All" || r.reasoningModel === model).slice(0, 20);
      const tbl = h("table", { class: "tbl" }, h("thead", null, h("tr", null, h("th", null, "Rule"), h("th", null, "IF"), h("th", null, "THEN"), h("th", null, "NR"))));
      const tb = h("tbody");
      rules.forEach((r) => tb.appendChild(h("tr", null, h("td", null, h("div", { class: "id" }, r.id), h("div", { style: { fontSize: "11px", color: "var(--muted)" } }, trunc(r.reasoningModel, 20))),
        h("td", { style: { fontSize: "12px", maxWidth: "260px" } }, trunc(r.ifCondition, 120)), h("td", { style: { fontSize: "12px", maxWidth: "260px" } }, trunc(r.thenActionConclusion, 120)), h("td", { class: "id" }, r.appliesToNr || "—"))));
      tbl.appendChild(tb); host.appendChild(tbl);
    }
    render("All"); return box;
  }

  /* ================= score explainability ================= */
  function metricEntry(key) { return (D.glossary || IIQ.glossary || {})[key]; }
  function interpret(key, value) {
    if (value == null || value === "") return "";
    const v = typeof value === "number" ? value : parseFloat(String(value));
    const c = String(value).toLowerCase();
    switch (key) {
      case "suitabilityIndex": if (!isNaN(v)) return v >= 0.75 ? "top band → Activate" : v >= 0.55 ? "conditional → often Holdout" : "a critical factor has collapsed the product → Not recommended"; break;
      case "confidence": if (/verified|validated/.test(c)) return "strong evidence — safe to act on directly"; if (/strongly/.test(c)) return "well-supported inference"; if (/moderately|medium/.test(c)) return "act with corroboration; widen the range"; if (/weakly|low/.test(c)) return "weak — treat as a hint, seek stronger evidence"; if (/unknown/.test(c)) return "no evidence — stated honestly, never fabricated"; break;
      case "riskBand": if (/high/.test(c)) return "gates activation regardless of reach or fit"; if (/med/.test(c)) return "proceed with conditions + monitoring"; if (/low/.test(c)) return "clear to activate"; break;
      case "trust": if (!isNaN(v)) return v >= 0.75 ? "high — a real, reliable audience" : v >= 0.5 ? "mixed — verify before scaling" : "low — likely bot / coordination inflated"; break;
      case "counterShare": if (!isNaN(v)) return Math.round(v * 100) + "% of the conversation is the counter framing"; break;
      case "velocity": if (!isNaN(v)) return v >= 40 ? "fast — new carriers joining quickly; early-warning territory" : "steady accumulation of new carriers"; break;
      case "stage": return "read with velocity — Emerging/Growing: act · Peaking: contest · Declining: usually don't spend";
      case "decision": if (/activ/.test(c)) return "recommended carrier for this brief"; if (/holdout/.test(c)) return "reserved control — this is what makes lift measurable"; if (/not recommended|excluded/.test(c)) return "a hard gate fired (risk / stance / authenticity)"; break;
    }
    return "";
  }
  function openMetric(key, value) {
    const g = metricEntry(key); if (!g) return;
    const node = h("div");
    node.appendChild(h("div", { class: "id" }, "METRIC · " + key));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px" } }, g.title));
    if (g.unit) node.appendChild(h("div", { class: "pill-row", style: { margin: "6px 0" } }, badge(g.unit, "blue")));
    if (value != null && value !== "") { const rd = interpret(key, value);
      node.appendChild(h("div", { class: "metric-val-box" }, h("div", { class: "mv-label" }, "This value"), h("div", { class: "mv-val" }, String(value)), rd ? h("div", { class: "mv-read" }, rd) : null)); }
    const sec = (t, b) => b ? h("div", null, h("div", { class: "section-title" }, t), h("p", { class: "metric-p" }, b)) : null;
    node.appendChild(sec("What it means", g.meaning));
    node.appendChild(sec("How it's computed", g.howComputed));
    node.appendChild(sec("How to read it", g.howToRead));
    if (g.refs && g.refs.length) { node.appendChild(h("div", { class: "section-title" }, "Grounded in")); node.appendChild(h("div", { class: "pill-row" }, g.refs.map((r) => badge(r, "muted")))); }
    openDrawer(node);
  }

  /* ================= WHY-ENGINE — contextual, real-world "what this means for you" =================
     The glossary answers "what is this metric?" generically. This engine answers the questions the
     user actually asks in front of a specific creator: WHY is his audience match good? WHY is he (not)
     for this brief? WHICH narrative can I use him on, and for WHAT content? Everything here is derived
     from THIS creator's own evidence (audience-geography estimates, type, stance, factor scores, the
     narratives he already carries) — honest templates, never invented numbers. */
  const CT = (id) => by(D.creatorTypes, id) || {};
  const bandOf = (v) => v == null ? "unknown" : v >= 0.7 ? "strong" : v >= 0.45 ? "ok" : "weak";
  const BAND_LABEL = { strong: "Strength", ok: "Workable", weak: "Weak — moves the decision", unknown: "Not evidenced" };
  const BAND_CLASS = { strong: "good", ok: "warn", weak: "critical", unknown: "muted" };

  // Where a creator's audience actually sits — from the audience-geography estimates, richest first.
  function topGeosFor(c) {
    return (D.estimates || [])
      .filter((e) => e.subject === c.id && e.dimension === "geography" && e.value != null)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .map((e) => { const g = by(D.geographies, e.geoScope || e.key) || {};
        return { id: e.geoScope || e.key, name: g.name || (e.geoScope || e.key), corridor: /yes/i.test(g.corridor || ""),
          holdout: /holdout/i.test(g.notes || ""), notes: g.notes || "", share: e.value, lo: e.lo, hi: e.hi, prov: e.provenance }; });
  }
  const corridorShareOf = (c) => topGeosFor(c).filter((g) => g.corridor).reduce((a, g) => a + (g.share || 0), 0);

  // Per-factor, per-creator real-world rationale. Returns a plain-English "why this score, for you".
  function factorReason(c, key, v) {
    const s = c.suitability || {}; const b = bandOf(v); const ct = CT(c.type);
    const geos = topGeosFor(c); const topGeo = geos[0]; const corr = corridorShareOf(c);
    const aud = c.audienceNote || "his audience"; const fmt = ct.typicalPlatforms || "his native formats";
    const strength = (ct.primaryStrengths || "").toLowerCase();
    const where = topGeo ? topGeo.name + " (" + pct(topGeo.share) + " of his audience)" : "the target area";
    switch (key) {
      case "audMatch": return b === "strong"
        ? "His followers ARE the people this brief needs — you reach the audience that already listens to him (" + aud + "), so little spend is wasted on strangers."
        : b === "ok" ? "Only part of his audience is your target (" + aud + ") — real reach, but you also pay for people outside the brief."
        : "His audience is largely NOT who this brief targets (" + aud + ") — most reach here misses the people you care about.";
      case "geoMatch": return b === "strong"
        ? "He lands where it counts: " + where + (corr ? ", and " + pct(corr) + " of his audience sits on the tunnel corridor" : "") + " — so he reaches the affected constituencies directly, not the whole city."
        : b === "ok" ? "Partial geographic fit — some audience is in-corridor (" + where + "), but a chunk sits outside the constituencies you're contesting."
        : "Wrong map: his audience sits mostly outside the corridor constituencies, so even good content reaches the wrong places.";
      case "issueAuth": return b === "strong"
        ? "On this brief's issue he speaks with earned authority — as a " + (ct.creatorType || "creator") + " his credibility is in " + (strength || "this domain") + ", so the audience takes the message as informed, not paid."
        : b === "ok" ? "Some authority here, but not his home turf — he can carry the message, though it won't land with the weight of a specialist."
        : "This isn't his lane — pushing this issue through him reads as off-brand and the audience discounts it.";
      case "engQual": return b === "strong"
        ? "His engagement is real debate, not empty likes — comments and shares show a live audience that actually argues the issue, which is what moves opinion."
        : b === "ok" ? "Engagement is decent but not deep — people watch, fewer respond; expect reach more than persuasion."
        : "Thin or inflated engagement relative to reach — the followers are there on paper but barely react, so persuasion is unlikely.";
      case "trust": return b === "strong"
        ? "After discounting bots and coordinated activity, this is a genuine, reliable audience — safe to scale spend behind."
        : b === "ok" ? "Mixed authenticity — a real core with some noise; verify before you scale budget behind him."
        : "Low authenticity — the audience is likely bot- or coordination-inflated, so headline reach overstates real people.";
      case "network": return b === "strong"
        ? "He bridges audiences others can't — carries narratives across separate communities, so one activation spreads further than his own followers."
        : b === "ok" ? "Moderately connected — some cross-audience reach, but mostly speaks to his own circle."
        : "Siloed — his reach stops at his own followers, so he won't seed the message beyond them.";
      case "history": return b === "strong"
        ? "Proven track record — past campaigns delivered what was predicted, so his numbers here are trustworthy to plan on."
        : b === "ok" ? "Limited history — some prior signal, but not enough to fully trust the projection yet."
        : "Little to no track record — treat his projected impact as unproven until a first activation calibrates it.";
      case "formatFit": return b === "strong"
        ? "His native format (" + fmt + ") is exactly what this message needs — no awkward retrofit, the content sits naturally in his feed."
        : b === "ok" ? "Format is workable — the message can be adapted to " + fmt + ", though not a perfect native fit."
        : "Format mismatch — the message would have to be forced into " + fmt + ", where it reads as an ad.";
      case "avail": return b === "strong"
        ? "Cleared and available — consent on file and no stance conflict, so he can actually carry the campaign message."
        : b === "ok" ? "Available with conditions — booking or consent needs to be firmed up before he can run."
        : "Effectively unavailable for THIS message — " + (s.note ? s.note.toLowerCase() : "a stance or consent conflict blocks activation") + ". This is the gate that collapses his score.";
      case "costEff": return b === "strong"
        ? "Strong value — the qualified reach he delivers is cheap per in-target person, so budget goes far here."
        : b === "ok" ? "Fair value — priced roughly in line with the reach he brings."
        : "Expensive for what he delivers — the fee buys little qualified reach relative to cheaper carriers.";
      case "riskAdj": return b === "strong"
        ? "Low compliance and reputational risk — clean screening, so activating him won't blow back on the campaign."
        : b === "ok" ? "Some risk to manage — proceed with conditions and monitoring; nothing disqualifying."
        : "High risk — screening flagged issues serious enough to gate activation regardless of how good the reach looks.";
    }
    return interpret(key, v) || "";
  }

  // The single lowest factor — the one that decides a multiplicative score.
  function collapseFactor(c) { const s = c.suitability || {}; let min = null;
    (D.factors || []).forEach((f) => { const v = s[f.key]; if (v != null && (min == null || v < min.v)) min = { f, v }; }); return min; }
  // Plain-English "why this decision" — the answer to "why did you (not) choose him?"
  function decisionRationale(c) {
    const s = c.suitability || {}; const d = (s.decision || "").toLowerCase();
    const strong = (D.factors || []).map((f) => [f, s[f.key]]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0].label.toLowerCase());
    const col = collapseFactor(c);
    if (/not recommended|excluded/.test(d)) return { verdict: "Not recommended", tone: "critical",
      lead: "Strong on paper — " + strong.join(", ") + " — but " + (col ? col.f.label.toLowerCase() + " collapses to " + col.v.toFixed(2) : "a hard gate fired") + ".",
      why: (s.note ? s.note + ". " : "") + "The eleven factors multiply, so one near-zero factor collapses the whole index — reach and format can't buy it back. The gate is working as designed." };
    if (/holdout/.test(d)) return { verdict: "Holdout — reserved control", tone: "warn",
      lead: "Deliberately held back, not rejected.", why: "He's a strong fit, which is exactly why he's kept as a matched control. The gap between his held-out geography and the activated ones is what makes your campaign lift provable rather than just correlation." };
    if (/activ/.test(d)) return { verdict: "Activated", tone: "good",
      lead: "Chosen because " + strong.join(", ") + " all line up and no risk or stance gate fired.",
      why: "He carries the message into the right audience and geography at acceptable risk — and adds qualified reach the other carriers don't already cover." };
    return { verdict: s.decision || "—", tone: "muted", lead: "", why: "" };
  }

  // Which tracked narratives can this creator be used on, and for WHAT — the drill-down the user wants
  // from both the creator side and the narrative side.
  function narrativeFitsFor(c) {
    const s = c.suitability || {};
    return heroNarr().map((id) => by(D.narratives, id)).filter(Boolean).map((nr) => {
      const carries = (c.amplifies || []).includes(nr.id);
      const hostile = /opposition|hostile|attack/i.test(nr.class || "");
      const anti = /anti|opp|critique/i.test(c.stance || "");
      const geoOK = (s.geoMatch || 0) >= 0.55, authOK = (s.issueAuth || 0) >= 0.55;
      let fit, tone, why, use;
      if (carries && hostile) { fit = "Carries the attack"; tone = "critical";
        why = "He already amplifies this opposition narrative (" + c.stance + "), so for your counter-campaign he is a do-not-activate — but he's the bellwether to watch: what he posts is the leading edge of the attack.";
        use = "Monitor, don't book. Track his posts as early-warning for where the attack goes next."; }
      else if (carries) { fit = "Already carries it"; tone = "good";
        why = "He already amplifies this narrative and his audience expects it from him — the most natural, lowest-friction carrier you have.";
        use = "Give him the freshest evidence and let him run in his own voice — a " + (CT(c.type).creatorType || "native") + " post, not a scripted line."; }
      else if (anti && !hostile) { fit = "Stance conflict"; tone = "critical";
        why = "His public position runs against this frame — putting your message through him would ring false and could backfire.";
        use = "Not for this narrative. Consider him only where his real stance aligns."; }
      else if (geoOK && authOK) { fit = "Strong potential carrier"; tone = "good";
        why = "He has the issue authority and reaches the right constituencies for this frame, even though he hasn't carried it yet — a credible new voice on it.";
        use = "Brief him to introduce this frame: pair his authority (" + (CT(c.type).primaryStrengths || "his strengths") + ") with your evidence pack."; }
      else if (geoOK || authOK) { fit = "Usable with support"; tone = "warn";
        why = "Half the fit is there (" + (authOK ? "issue authority" : "geographic reach") + ") but not the other — he can carry it with the right framing and co-signers.";
        use = "Use as a secondary voice alongside a stronger carrier; don't lead with him."; }
      else { fit = "Poor fit"; tone = "muted";
        why = "Neither his authority nor his geography lines up with this frame — he'd add noise, not signal.";
        use = "Skip for this narrative."; }
      return { nr, fit, tone, why, use, carries };
    });
  }
  // Inverse: for one narrative, the creators you can actually use to push it, ranked and reasoned.
  function creatorsForNarrative(nrId) {
    const nr = by(D.narratives, nrId); if (!nr) return [];
    return (D.creators || []).map((c) => {
      const f = narrativeFitsFor(c).find((x) => x.nr.id === nrId); if (!f) return null;
      const s = c.suitability || {}; const score = (s.issueAuth || 0) * 0.4 + (s.geoMatch || 0) * 0.3 + (s.trust || 0) * 0.3;
      return { c, ...f, score };
    }).filter(Boolean).sort((a, b) => {
      const rank = { good: 0, warn: 1, muted: 2, critical: 3 };
      return (rank[a.tone] - rank[b.tone]) || (b.score - a.score);
    });
  }
  // What content to give a creator for a narrative — grounded in what they already do + the frame's response line.
  function contentAngle(c, nr) {
    const ct = CT(c.type); const geos = topGeosFor(c); const topGeo = geos[0];
    const ideas = [];
    if (nr.response) ideas.push("Lead line: " + nr.response);
    ideas.push("His format: a " + (ct.typicalPlatforms || "native") + " piece in his own voice — " + (c.role || ct.creatorType || "his usual beat") + ".");
    if (topGeo) ideas.push("Localise it: ground the frame in " + topGeo.name + ", where " + pct(topGeo.share) + " of his audience is.");
    if (c.audienceNote) ideas.push("Speak to his audience: " + c.audienceNote + ".");
    if (nr.framing) ideas.push("Counter the opposing frame (“" + nr.framing + "”) with evidence, don't dismiss the concern.");
    return ideas;
  }
  function toneClass(t) { return t === "critical" ? "critical" : t === "good" ? "good" : t === "warn" ? "warn" : "muted"; }

  /* ---- content drill-down: from "what to give him" down to an actual example script per format ---- */
  const PLAT_FORMAT = { YT: "YouTube explainer", X: "X / thread", IG: "Instagram reel", FB: "Facebook post",
    TG: "Telegram broadcast", LI: "LinkedIn post", OF: "Townhall / offline", NW: "News segment", RE: "Reel" };
  // The one or two formats that are genuinely this creator's — their booked format first, then their platforms.
  function creatorFormats(c) {
    const list = []; const act = (D.activations || []).find((a) => a.creator === c.id);
    if (act && act.format) list.push({ code: (act.format.match(/ACT-\d+/) || ["FMT"])[0], label: act.format.replace(/^ACT-\d+\s*/, ""), booked: true });
    (CT(c.type).typicalPlatforms || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean).forEach((p) => {
      const lbl = PLAT_FORMAT[p]; if (lbl && !list.some((x) => x.label.toLowerCase().includes(lbl.toLowerCase().split(" ")[0]))) list.push({ code: p, label: lbl }); });
    if (!list.length) list.push({ code: "POST", label: "Native post" });
    return list.slice(0, 2);
  }
  // A concrete, grounded example script for a creator + narrative + one format. Clearly a draft to adapt.
  function scriptFor(c, nr, fmt) {
    const geos = topGeosFor(c); const where = (geos[0] && geos[0].name) || (D.cfg && D.cfg.corridorLabel) || "the corridor";
    const msg = messageInfo("MSG-11"); const va = (msg.variants && msg.variants[0]) || {}; const vb = (msg.variants && msg.variants[1]) || {};
    const lead = nr.response || "our verified position on the corridor";
    const evidence = (nr.drivers || "").split(";")[0] || "the published DPR figures";
    const proof = "source-coded link + QR (so every action is tracked)";
    const label = (fmt.label || "").toLowerCase();
    let title, hook, beats, cta;
    cta = "Share the feedback-portal link (" + proof + "); mention the " + where + " townhall.";
    if (/thread|^x\b/.test(label)) {
      title = "Thread: “" + trunc(nr.name, 40) + "” — what the numbers actually say";
      hook = "1/ Everyone in " + where + " is arguing about the tunnel. I pulled the real figures. A thread. 🧵";
      beats = ["2/ The claim: “" + trunc(nr.framing || nr.name, 80) + "”.",
        "3/ What the record shows: " + lead + ".",
        "4/ The number people miss: " + evidence + " — here's the receipt.",
        "5/ Both/and, not either/or — " + (va.text || "tunnel AND transit commitments"),
        "6/ If you commute this corridor, tell them what you need 👇 " + proof];
    } else if (/reel|instagram|^ig\b/.test(label)) {
      title = "30s reel: the tunnel argument in one commute";
      hook = "[0–3s] “They say the tunnel is just for cars.” (walking the " + where + " stretch)";
      beats = ["[3–10s] Show the jam: “90 minutes, Hebbal to Silk Board, today.”",
        "[10–18s] Cut to the fact card: " + lead + ".",
        "[18–25s] “" + (va.text || "Tunnel AND metro — here's the commitment, in writing.") + "”",
        "[25–30s] To camera: “Your commute, your call — link in bio.” " + proof];
    } else if (/explainer|youtube|^yt\b|segment|news/.test(label)) {
      title = "Explainer: “Is the tunnel really just for 10% car users?”";
      hook = "Open on the corridor map of " + where + ": “Let's separate the claim from the costing.”";
      beats = ["Beat 1 — Steelman the concern honestly: “" + trunc(nr.framing || nr.name, 90) + "”.",
        "Beat 2 — The evidence: " + lead + ".",
        "Beat 3 — The arithmetic: " + (vb.text || evidence) + ".",
        "Beat 4 — The commitment on record: " + (va.text || "transit-complement annexure") + ".",
        "Beat 5 — “Judge it on delivery — here's how to hold them to it.”"];
    } else if (/townhall|offline/.test(label)) {
      title = "Townhall run-of-show — " + where;
      hook = "Frame: “A room of corridor residents, not a rally.” Neutral venue, mixed panel.";
      beats = ["Segment 1 — Residents state what they need from the corridor (listen first).",
        "Segment 2 — Facts on the board: " + lead + ".",
        "Segment 3 — The both/and commitment: " + (va.text || "tunnel + transit") + ".",
        "Segment 4 — Sign-ups to the feedback portal; capture registrations by code."];
    } else {
      title = "Post: the corridor question, answered straight";
      hook = "“Getting a lot of DMs about the tunnel. Here's my honest read for " + where + ".”";
      beats = ["The concern, fairly stated: " + trunc(nr.framing || nr.name, 80) + ".",
        "What changed my read: " + lead + ".",
        "The commitment worth holding them to: " + (va.text || "transit-complement pledge") + "."];
    }
    return { format: fmt.label, booked: fmt.booked, title, hook, beats, cta,
      note: "Example draft — grounded in his format and this frame, using DPR-consistent claims only. Adapt to his voice; this is a starting point, not published copy." };
  }
  // Shared node: the content ideas, then a per-format "see an example script" reveal.
  function contentDrillNode(c, nr) {
    const box = h("div", { class: "cdrill" });
    contentAngle(c, nr).forEach((a) => box.appendChild(h("div", { class: "nfit-idea" }, a)));
    box.appendChild(h("div", { class: "cdrill-sub" }, "Example scripts — pick his format:"));
    const scriptHost = h("div", { class: "cdrill-scripts" });
    const fmts = creatorFormats(c);
    const btns = h("div", { class: "cdrill-fmts" });
    const renderScript = (fmt) => { scriptHost.innerHTML = ""; const sc = scriptFor(c, nr, fmt);
      scriptHost.appendChild(h("div", { class: "script-card" },
        h("div", { class: "script-h" }, h("span", { class: "badge b-blue" }, sc.format + (sc.booked ? " · booked" : "")), h("b", { class: "script-title" }, sc.title)),
        h("div", { class: "script-hook" }, h("span", { class: "script-k" }, "Hook"), sc.hook),
        h("div", { class: "script-beats" }, sc.beats.map((b) => h("div", { class: "script-beat" }, b))),
        h("div", { class: "script-cta" }, h("span", { class: "script-k" }, "Call to action"), sc.cta),
        h("div", { class: "script-note" }, sc.note)));
    };
    fmts.forEach((fmt, i) => btns.appendChild(h("button", { class: "cdrill-fmt-btn" + (i === 0 ? " active" : ""),
      onclick: (e) => { e.stopPropagation(); btns.querySelectorAll(".cdrill-fmt-btn").forEach((b) => b.classList.remove("active")); e.target.classList.add("active"); renderScript(fmt); } }, fmt.label)));
    box.appendChild(btns); box.appendChild(scriptHost);
    if (fmts[0]) renderScript(fmts[0]);
    return box;
  }

  // The eleven factor keys don't each have a glossary card — they share the "factors" card for the
  // how-it's-computed drawer, but keep their OWN contextual reason on hover.
  const FACTOR_KEYS = new Set((IIQ.factors || (IIQ.ref && IIQ.ref.factors) || []).map((f) => f.key));
  // wrap a rendered score node so it explains itself (hover = meaning for YOU; click → how-it's-computed)
  function explain(node, key, value, ctx) {
    if (!node) return node;
    const gKey = metricEntry(key) ? key : (FACTOR_KEYS.has(key) ? "factors" : key);
    const g = metricEntry(gKey); if (!g) return node;
    node.classList.add("explainable");
    // Prefer the contextual "why, for you" line when we know the creator; fall back to the generic reading.
    const ctxReason = (ctx && ctx.suitability && key !== "suitabilityIndex") ? factorReason(ctx, key, value) : "";
    const rd = ctxReason || interpret(key, value);
    node.setAttribute("title", g.title + (rd ? " — " + rd : "") + "  (click for how it's computed)");
    node.onclick = (e) => { e.stopPropagation(); openMetric(gKey, value); };
    return node;
  }
  const sbadge = (text, cls, key, value, ctx) => explain(badge(text, cls), key, value, ctx);

  /* ================= ontology code resolver + universal "hover to understand" ================= */
  // Every ID in the data is a terse ontology code (NR-30, RR-081, IS-03…) that means nothing to a
  // campaign user. codeInfo() resolves any code to a human label + kind; linkifyCodesIn() then makes
  // every code that appears anywhere in the rendered UI hover-explaining (and click-through for
  // narratives/creators). So the shorthand is defined in place, never left ambiguous.
  const PREFIX_KIND = { SUITE: "Suite", MOD: "Module", KPI: "KPI", REC: "Recommendation", OUT: "Outcome",
    SIG: "Signal source", ACT: "Content format", MSG: "Campaign message", ATT: "Attribution", EXP: "Exposure",
    POS: "Position", EST: "Audience estimate", NR: "Narrative", CP: "Campaign", IS: "Issue", GE: "Geography",
    CT: "Creator type", RR: "Reasoning rule", KC: "Knowledge chain", OC: "Outcome type", EC: "Evidence-confidence method",
    RC: "Risk / governance rule", MC: "Measurement concept", OA: "Consent record", AC: "Creator account",
    EV: "Evidence record", CA: "Activation", SW: "Survey wave", CI: "Content item", RS: "Response", TR: "Trend row", P: "Creator" };
  const firstText = (o) => { for (const k in o) { if (k !== "id" && k !== "__order" && typeof o[k] === "string" && o[k]) return o[k]; } return ""; };
  const findId = (arr, id) => (arr || []).find((x) => x && x.id === id);
  const nName = (id) => (by(D.narratives, id) || {}).name || id;   // narrative → human name

  /* ---- campaign messages (MSG-*) — resolve the terse code to the actual message + its variants ---- */
  const gNodeLabel = (id) => { const n = (D.graph && D.graph.nodes || []).find((x) => x.id === id); return n ? n.label : ""; };
  function messageInfo(id) {
    const b = D.campaign || {};
    const short = gNodeLabel(id);
    const text = b["Message " + id] || "";
    // A bare family code (e.g. MSG-11) fans out to its A/B variants defined in the brief.
    const variants = Object.keys(b).filter((k) => /^Message MSG-/.test(k) && (id === "MSG-11" ? k.indexOf(id) === 8 : k === "Message " + id))
      .map((k) => ({ id: k.replace("Message ", ""), label: gNodeLabel(k.replace("Message ", "")), text: b[k] }));
    return { id, label: short || "Campaign message", text, variants };
  }
  function openMessage(id) {
    const m = messageInfo(id); const node = h("div");
    node.appendChild(h("div", { class: "id" }, id + " · Campaign message"));
    node.appendChild(h("h2", { class: "page-title", style: { marginTop: "4px", fontSize: "19px" } }, m.label));
    node.appendChild(h("div", { class: "reading-box" }, h("b", null, "What a “message” is: "),
      "The actual line creators deliver on the campaign's behalf — the argument itself, not the creator. The suitability “availability” factor asks whether a creator can credibly carry THIS message; a stance conflict there is exactly what makes a strong creator read as “would not carry " + id + "”."));
    if (m.variants && m.variants.length) {
      node.appendChild(h("div", { class: "section-title" }, "The message" + (m.variants.length > 1 ? " — A/B variants" : "")));
      m.variants.forEach((v) => node.appendChild(h("div", { class: "msg-variant" },
        h("div", { class: "msg-variant-h" }, h("span", { class: "badge b-blue" }, v.id), h("b", null, v.label || "")),
        h("div", { class: "msg-variant-t" }, v.text || "—"))));
    } else if (m.text) { node.appendChild(h("div", { class: "msg-variant" }, h("div", { class: "msg-variant-t" }, m.text))); }
    // which creators carry it / can't
    const carriers = (D.activations || []).filter((a) => (a.message || "").indexOf(id.replace(/[AB]$/, "")) === 0)
      .map((a) => ({ a, c: by(D.creators, a.creator) })).filter((x) => x.c);
    if (carriers.length) { node.appendChild(h("div", { class: "section-title" }, "Carried by"));
      node.appendChild(h("div", { class: "pill-row" }, carriers.map((x) =>
        h("span", { class: "badge b-good", style: { cursor: "pointer" }, onclick: () => openCreator(x.c.id) }, x.c.name + " · " + x.a.message)))); }
    openDrawer(node);
  }
  function codeInfo(id) {
    if (!id) return null; const pre = String(id).split("-")[0]; const kind = PREFIX_KIND[pre]; if (!kind) return null;
    let label = "", tip = "", open = null;
    switch (pre) {
      case "NR": { const n = by(D.narratives, id); if (n) { label = n.name; tip = n.class || n.description; open = () => openNarrative(id); } break; }
      case "P": { const c = by(D.creators, id); if (c) { label = c.name; tip = c.role || c.type; open = () => openCreator(id); } break; }
      case "IS": { const x = findId(D.issues, id); if (x) { label = x.issue; tip = x.family; } break; }
      case "GE": { const g = by(D.geographies, id); if (g) { label = g.name; tip = g.level; } break; }
      case "CP": { const c = (IIQ.campaigns && IIQ.campaigns[id] && IIQ.campaigns[id].config); if (c) { label = c.fullName || c.name; } break; }
      case "MOD": case "SUITE": { const P = IIQ.platform || {}; const m = (P.modules || []).find((x) => x.id === id); if (m) { label = m.name; tip = m.tagline; } else if (P.suite && P.suite.id === id) { label = P.suite.name; tip = P.suite.tagline; } break; }
      case "CT": { const t = findId(D.creatorTypes, id); if (t) label = t.creatorType || firstText(t); break; }
      case "RR": { const r = findId(D.rules, id); if (r) { label = trunc(r.thenActionConclusion || r.reasoningModel || firstText(r), 64); tip = trunc(r.ifCondition || "", 90); } break; }
      case "REC": { const r = findId(D.recommendations, id); if (r) { label = r.name; tip = r.action; } break; }
      case "MSG": { const m = messageInfo(id); label = m.label || "Campaign message";
        tip = m.text ? trunc(m.text, 120) : (m.variants && m.variants.length ? m.variants.map((v) => v.label).filter(Boolean).join(" / ") : ""); open = () => openMessage(id); break; }
      case "OUT": { const o = findId(D.outcomes, id); if (o) { label = o.outcome;
        tip = [o.value != null ? "value " + o.value : "", o.interval && !/interval as stated/i.test(o.interval) ? o.interval : "", o.basis || o.method || ""].filter(Boolean).join(" · "); } break; }
      case "KPI": { const k = findId(D.kpis, id); if (k) label = trunc(k.kpi || firstText(k), 60); break; }
      case "KC": { const k = findId(D.knowledgeChains, id); if (k) label = trunc(firstText(k), 60); break; }
      case "OC": { const o = findId(D.outcomeTypes, id); if (o) label = trunc(firstText(o), 50); break; }
      case "SIG": { const s = findId(D.signals, id); if (s) label = s.code || trunc(firstText(s), 40); break; }
      case "MC": { const m = findId(D.measures, id); if (m) label = trunc(firstText(m), 50); break; }
      case "EST": { const e = findId(D.estimates, id); if (e) label = e.key || e.dimension; break; }
      case "EV": { const e = D.evidence && D.evidence[id]; if (e) label = e.sourceName || e.method; break; }
      case "CA": { const a = findId(D.activations, id); if (a) label = a.format; break; }
      case "AC": { for (const c of (D.creators || [])) { const a = (c.accounts || []).find((x) => x.id === id); if (a) { label = a.handle + " · " + a.platform; break; } } break; }
    }
    return { id, kind, label, tip, open };
  }
  function codeTitle(id) { const i = codeInfo(id); if (!i) return null; return i.label ? (i.kind + " · " + i.label + (i.tip ? " — " + i.tip : "")) : (i.kind + " (" + id + ")"); }
  const CODE_RE = /\b(SUITE|MOD|KPI|REC|OUT|SIG|ACT|MSG|ATT|EXP|POS|EST|NR|CP|IS|GE|CT|RR|KC|OC|EC|RC|MC|OA|AC|EV|CA|SW|CI|RS|TR|P)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g;
  const CODE_HAS = /\b(SUITE|MOD|KPI|REC|OUT|SIG|ACT|MSG|ATT|EXP|POS|EST|NR|CP|IS|GE|CT|RR|KC|OC|EC|RC|MC|OA|AC|EV|CA|SW|CI|RS|TR|P)-[A-Za-z0-9]/;
  function linkifyCodesIn(root) {
    if (!root || !root.querySelectorAll) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(n) {
      if (!n.nodeValue || !CODE_HAS.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      const p = n.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
      const t = p.nodeName; if (t === "SCRIPT" || t === "STYLE" || t === "OPTION" || t === "TEXTAREA") return NodeFilter.FILTER_REJECT;
      if (p.closest && p.closest(".codeword, input, select, textarea, svg")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    const nodes = []; let x; while ((x = walker.nextNode())) nodes.push(x);
    nodes.forEach((n) => {
      const text = n.nodeValue; CODE_RE.lastIndex = 0; let last = 0, m, any = false; const frag = document.createDocumentFragment();
      while ((m = CODE_RE.exec(text))) {
        const code = m[0]; if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const title = /\d/.test(code) ? codeTitle(code) : null;
        if (title) { const info = codeInfo(code);
          frag.appendChild(h("span", { class: "codeword" + (info && info.open ? " cw-link" : ""), title: title,
            onclick: info && info.open ? (e) => { e.stopPropagation(); info.open(); } : null }, code)); any = true; }
        else frag.appendChild(document.createTextNode(code));
        last = m.index + code.length;
      }
      if (any) { if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last))); n.parentNode.replaceChild(frag, n); }
    });
  }

  /* ================= Add-campaign builder + scripted co-pilot ================= */
  let NEWSEQ = 0;
  const CARRIER_POOL = {
    counter: [["Solutions-journalism explainer", "CT-03", 0.84, "Activate"], ["Domain expert (credible counter)", "CT-06", 0.79, "Activate"], ["Community organiser (offline)", "CT-10", 0.74, "Activate"], ["Hyperlocal news (coverage)", "CT-02", 0.60, "Holdout"]],
    mobilise: [["Beneficiary-testimony micro creator", "CT-14", 0.80, "Activate"], ["Women-collective organiser", "CT-10", 0.77, "Activate"], ["Youth / student leader", "CT-05", 0.70, "Activate"], ["Regional news (coverage)", "CT-02", 0.58, "Holdout"]],
    awareness: [["Explainer creator (broad reach)", "CT-03", 0.78, "Activate"], ["Podcast host (depth)", "CT-08", 0.72, "Activate"], ["Cultural / entertainment creator", "CT-09", 0.66, "Activate"], ["Mainstream journalist (coverage)", "CT-07", 0.55, "Holdout"]],
    persuasion: [["Subject-matter expert", "CT-06", 0.82, "Activate"], ["Professional voice (doctor/lawyer)", "CT-11", 0.75, "Activate"], ["Political commentator", "CT-01", 0.68, "Activate"], ["Hyperlocal news (coverage)", "CT-02", 0.57, "Holdout"]],
  };
  function runCopilot(f) {
    const obj = f.objective || "counter";
    const issue = f.issue || "the core issue";
    const geo = f.geo || "the target geography";
    const opp = f.opponent || "the opposing attack narrative";
    const ourFrame = { counter: "Evidence-priced rebuttal that reframes " + issue + " around verified delivery and accountability.",
      mobilise: "Dignity-and-delivery framing that converts " + issue + " into pride and turnout.",
      awareness: "Clear, sharable explainer that raises informed awareness of " + issue + ".",
      persuasion: "Credible, expert-led case that shifts opinion on " + issue + "." }[obj];
    const segments = ["Core: directly-affected households in " + geo, "Persuadable: undecided middle in " + geo, "Amplifier: high-trust local voices", "Holdout: a matched control segment for measurement"];
    const carriers = (CARRIER_POOL[obj] || CARRIER_POOL.counter);
    const kpis = { counter: ["Counter-share on the attack narrative", "Qualified reach in priority geos", "Net sentiment lift vs holdout"],
      mobilise: ["Registrations / turnout intent", "Beneficiary-pride index lift", "Qualified reach among target segment"],
      awareness: ["Informed-awareness lift vs holdout", "Qualified unique reach", "Message recall"],
      persuasion: ["Opinion movement vs holdout", "Message recall", "Qualified reach among persuadables"] }[obj];
    const gov = "Sensitive framing around " + issue + " routes to restricted handling (transparency content only); creator consent + risk-screening verified before any activation.";
    return { ourFrame, oppFrame: opp, segments, carriers, kpis, budgetSplit: [["Priority carriers", 0.55], ["Offline / townhalls", 0.2], ["Measurement (survey + holdout)", 0.15], ["Reserve", 0.1]], gov };
  }
  function buildDraftCampaign(f, draft) {
    NEWSEQ += 1; const id = "CP-N" + (10 + NEWSEQ);
    const gp = id.replace(/[^A-Za-z0-9]/g, "");
    const our = "NR-" + gp + "A", opp = "NR-" + gp + "B";
    const narratives = [
      { id: our, name: "Our frame — " + (f.name || "campaign"), class: "Counter / drafted", description: draft.ourFrame, susceptible: draft.segments[0], drivers: "co-pilot draft", platforms: "—", framing: draft.ourFrame, response: "—", detection: "—", aboutIssue: "", contradicts: opp, rules: [], recs: [], amplifiers: [] },
      { id: opp, name: "Opposing frame", class: "Hostile / drafted", description: draft.oppFrame, susceptible: "—", drivers: "—", platforms: "—", framing: draft.oppFrame, response: "—", detection: "—", aboutIssue: "", contradicts: our, rules: [], recs: [], amplifiers: [] },
    ];
    const creators = draft.carriers.map((c, i) => {
      const idx = c[2]; const base = idx;
      const su = { audMatch: +(base).toFixed(2), geoMatch: +(base - 0.02).toFixed(2), issueAuth: +(base + 0.02).toFixed(2), engQual: +(base - 0.04).toFixed(2), trust: +(base).toFixed(2), network: 0.6, history: 0.62, formatFit: +(base - 0.02).toFixed(2), avail: 0.8, costEff: 0.72, riskAdj: /holdout/i.test(c[3]) ? 0.7 : 0.85, rawProduct: +(Math.pow(base, 4)).toFixed(4), index: idx, confidence: "Moderately Inferred", decision: c[3], note: "Co-pilot suggested carrier (draft)." };
      const pid = "P-" + gp + "-" + (i + 1);
      return { id: pid, name: c[0], type: c[1], role: "Suggested carrier", onboarded: "Draft", consent: "Pending", offline: /organiser|community/i.test(c[0]) ? "Yes" : "No", stance: /coverage/i.test(c[0]) ? "Coverage" : "Pro", amplifies: [our], audienceNote: "Drafted by co-pilot — not yet evidenced.", accounts: [{ id: "AC-" + pid, platform: "—", handle: "@draft", followers: 40000 + i * 15000, linkBasis: "Draft" }], followers: 40000 + i * 15000, suitability: su };
    });
    creators.forEach((c) => { narratives[0].amplifiers.push(c.id); });
    const weeks = ["2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06"];
    const trending = [];
    weeks.forEach((w, i) => { trending.push({ narrative: opp, week: w, geo: "GE-" + gp, volume: 800 + i * 600, velocity: 20 + i * 8, sentiment: "Negative", emotion: "Concern", counterShare: 0.1 + i * 0.12, stage: i < 2 ? "Growing" : "Peaking", topSignal: "drafted" });
      trending.push({ narrative: our, week: w, geo: "GE-" + gp, volume: 200 + i * 500, velocity: 8 + i * 7, sentiment: "Positive", emotion: "Pride", counterShare: 0.7 + i * 0.03, stage: i < 1 ? "Emerging" : "Growing", topSignal: "drafted" }); });
    const brief = { "Campaign ID": id, "Campaign": f.name || "New campaign", "Objective": draft.ourFrame, "Primary issues": f.issue || "—", "Geographies": f.geo || "—", "Window": f.timeframe || "—", "Budget / spend": String(f.budget || 0), "Governance": draft.gov, __order: ["Campaign ID", "Campaign", "Objective", "Primary issues", "Geographies", "Window", "Budget / spend", "Governance"] };
    const config = { id, name: f.name || "New campaign", fullName: f.name || "New campaign", stage: "Draft", objective: f.objective || "counter",
      scenarioBlurb: "Draft campaign assembled by the PulseIQ co-pilot. " + draft.ourFrame + " (Unsaved prototype — no backend persistence.)",
      budget: +f.budget || 0, corridorLabel: f.geo || "target geography", heroNarratives: [our, opp],
      narrColor: { [our]: "#199e70", [opp]: "#e66767" },
      timeline: [{ date: weeks[0], label: "E1 · Attack builds", desc: draft.oppFrame, tone: "critical" }, { date: weeks[2], label: "E2 · Co-pilot plan drafted", desc: "Segments, carriers and KPIs assembled.", tone: "blue" }],
      collapseStory: { killerFactor: "riskAdj", pair: [] }, revocationCreator: creators[0] ? creators[0].id : "", driftCreator: creators[0] ? creators[0].id : "",
      sensitiveNarrative: opp, defaultSpreadNarrative: opp, places: [f.geo || "—"], objectiveLabel: draft.ourFrame.slice(0, 40),
      fundedBrief: { spent: 0, cpa: 0, submissions: 0, registrations: 0 }, calibrationRows: [] };
    return { config, campaign: brief, narratives, creators, geographies: [{ id: "GE-" + gp, name: f.geo || "Target geography", level: "Region", parent: "-", corridor: "core", notes: "draft" }],
      trending, activations: [], exposures: [], outcomes: [], attribution: [], surveys: [], estimates: [], evidence: {}, content: [], positions: [], responses: [],
      graphOps: { nodes: [], edges: [] }, recHighlights: [] };
  }
  views.newCampaign = function () {
    const wrap = h("div");
    wrap.appendChild(pageHead("New campaign", "Answer a few prompts and the PulseIQ co-pilot drafts the campaign narrative, segments, carriers, KPIs and governance posture. Create it to explore it live (prototype draft — not persisted)."));
    const cols = h("div", { class: "builder" });
    const form = { name: "", objective: "counter", geo: "", issue: "", opponent: "", budget: "", timeframe: "" };
    const field = (label, el) => h("label", { class: "bfield" }, h("span", { class: "bf-label" }, label), el);
    const inp = (k, ph) => h("input", { type: "text", placeholder: ph, oninput: (e) => { form[k] = e.target.value; } });
    const issueOpts = [["", "Choose an issue…"], ...((D.issues || []).map((i) => [i.issue, i.issue]))];
    const left = h("div", { class: "builder-form card" },
      h("div", { class: "card-h" }, h("h3", null, "Campaign brief")),
      field("Campaign name", inp("name", "e.g. Coastal Roads Accountability")),
      field("Objective", sel([["counter", "Counter-narrative"], ["mobilise", "Mobilisation / turnout"], ["awareness", "Awareness / reach"], ["persuasion", "Persuasion / issue"]], (v) => { form.objective = v; }, "counter")),
      field("Primary issue", sel(issueOpts, (v) => { form.issue = v; }, "")),
      field("Geography / scope", inp("geo", "e.g. Coastal Karnataka")),
      field("Opponent framing to counter", inp("opponent", "e.g. 'the roads money was wasted'")),
      field("Budget (₹)", h("input", { type: "number", placeholder: "e.g. 2500000", oninput: (e) => { form.budget = e.target.value; } })),
      field("Timeframe", inp("timeframe", "e.g. 6 weeks")),
      h("button", { class: "btn primary block", onclick: () => draftIt() }, "✦ Draft with co-pilot"));
    const right = h("div", { class: "copilot card" },
      h("div", { class: "card-h copilot-h" }, h("span", { class: "co-avatar" }, waveMark()), h("h3", null, "PulseIQ co-pilot")));
    const chat = h("div", { class: "co-chat" }); right.appendChild(chat);
    const foot = h("div", { class: "co-foot" }); right.appendChild(foot);
    cols.appendChild(left); cols.appendChild(right); wrap.appendChild(cols);
    let lastDraft = null;
    function bubble(role, node, delay) { const b = h("div", { class: "co-bubble " + role }, node); b.style.opacity = "0"; chat.appendChild(b);
      setTimeout(() => { b.style.opacity = "1"; chat.scrollTop = chat.scrollHeight; }, delay || 0); return b; }
    bubble("bot", "Tell me the objective, issue, geography and the opposing frame — I'll assemble a full campaign plan you can create and explore.", 0);
    function draftIt() {
      if (!form.name) { bubble("bot", "Give the campaign a name first, then I'll draft it.", 0); return; }
      chat.innerHTML = ""; foot.innerHTML = "";
      bubble("user", "Draft a " + (form.objective) + " campaign — “" + form.name + "”" + (form.issue ? " on " + form.issue : "") + (form.geo ? " in " + form.geo : "") + ".", 0);
      const d = runCopilot(form); lastDraft = d; let t = 350;
      const step = (title, node) => { bubble("bot", h("div", null, h("div", { class: "co-step" }, title), node), t); t += 550; };
      step("Campaign narrative", h("div", null, h("div", { class: "co-frame ours" }, "Our frame · " + d.ourFrame), h("div", { class: "co-frame theirs" }, "Counters · " + d.oppFrame)));
      step("Target segments", h("div", { class: "co-list" }, d.segments.map((s) => h("div", { class: "co-li" }, s))));
      step("Suggested carriers", h("div", { class: "co-list" }, d.carriers.map((c) => h("div", { class: "co-li" }, h("b", null, c[0]), " — " + c[1] + " · fit " + c[2].toFixed(2) + " · " + c[3]))));
      step("KPIs & budget split", h("div", null, h("div", { class: "co-list" }, d.kpis.map((k) => h("div", { class: "co-li" }, "▸ " + k))),
        h("div", { class: "co-split" }, d.budgetSplit.map((b) => h("div", { class: "co-split-row" }, h("span", null, b[0]), h("span", { class: "mono" }, Math.round(b[1] * 100) + "%"))))));
      step("Governance posture", h("div", { class: "co-gov" }, "⛨ " + d.gov));
      setTimeout(() => { foot.innerHTML = ""; foot.appendChild(h("button", { class: "btn primary block", onclick: () => createIt() }, "Create campaign → open Command Center")); }, t);
    }
    function createIt() {
      if (!lastDraft) return;
      const camp = buildDraftCampaign(form, lastDraft);
      const id = camp.config.id;
      IIQ.campaigns = IIQ.campaigns || {};
      IIQ.campaigns[id] = camp;
      IIQ.campaigns.__order = (IIQ.campaigns.__order || campaignList().map((c) => c.id)).concat([id]);
      PENDING = id;
      useCampaign(id);
      location.hash = "#/command";
      triggerLiveIngestion(id, form);
    }
    return wrap;
  };

  /* ================= NEW: live data (Neo4j Aura via /api) ================= */
  async function liveFetch(q, cid) { const u = "/api/query?q=" + encodeURIComponent(q) + (cid ? "&c=" + encodeURIComponent(cid) : ""); const r = await fetch(u); if (!r.ok) throw new Error("api " + r.status); return r.json(); }
  // Fire-and-forget: pulls real signal (YouTube/GDELT/RSS/geography) for a
  // just-created campaign from graph/scripts/ingest via /api/ingest. Never
  // awaited by the caller and wrapped so a failure here (API down, no
  // internet, missing keys) can NEVER surface as a UI error — it only ever
  // shows up in graph/logs/ingest-*.log. Silently does nothing on a static
  // (non-live) deployment, same convention as initLive().
  //
  // /api/ingest itself blocks server-side until all 4 sources finish (or
  // fail) — so the moment this fetch resolves, real data is in Neo4j. We
  // use that to auto-refresh the screen the instant it's ready, instead of
  // requiring a manual reload. window.__INGESTING drives the "pulling live
  // data…" indicator shown in liveSignalsCard() while this is in flight.
  function triggerLiveIngestion(campaignId, form) {
    try {
      const issue = (D.issues || []).find((i) => i.issue === form.issue);
      window.__INGESTING = campaignId;
      try { route(); } catch (e) {}   // show the "pulling live data…" state immediately, not just when it's done
      fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: form.name || form.issue || "campaign",
          campaignId,
          geo: form.geo || undefined,
          issueId: issue ? issue.id : undefined,
        }),
      })
        .catch(() => { /* offline / static mode / server not running — expected, ignore */ })
        .then(() => {
          window.__INGESTING = null;
          // only refresh if the person is still looking at this campaign
          if (window.__LIVE && ACTIVE === campaignId) initLiveCampaign(campaignId);
        });
    } catch (e) { /* never let ingestion kick-off break campaign creation */ }
  }
  async function initLive() {
    try {
      const j = await liveFetch("health");
      if (!j || !j.rows || !j.rows.length) return;
      window.__LIVE = true;
      const b = document.querySelector(".env-badge");
      if (b) b.innerHTML = '<span class="dot" style="background:var(--good)"></span> Live · Neo4j Aura';
      if (ACTIVE) await initLiveCampaign(ACTIVE);   // pull the active campaign's live subgraph
    } catch (e) { /* static mode (expected on file://) */ }
  }
  // re-pull per-campaign live data (graph + suitability) on connect and on every campaign switch
  // Real Creator nodes ingested from YouTube for this campaign. When
  // present, REPLACES D.creators — Creator Intelligence then shows the
  // actual channels the API returned instead of the hardcoded CARRIER_POOL
  // list. Deliberately has no .suitability object: every place that reads
  // it (openCreator, narrativeFitsFor, the card grid) already null-checks
  // c.suitability and degrades gracefully — we're not fabricating an
  // 11-factor score for data a keyword search can't actually support.
  function mapLiveCreators(rows) {
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: "—",
        role: "Live · pulled from YouTube for this campaign — not yet scored.",
        onboarded: "Live",
        consent: null,
        offline: "No",
        stance: "Coverage",
        isLive: true,
        videoCount: r.videoCount || 0,
        subscriberCount: r.subscriberCount != null ? Number(r.subscriberCount) : null,
        totalViews: r.totalViews || 0,
        accounts: [{ id: r.id + "-YT", platform: "YouTube", handle: "", followers: r.subscriberCount != null ? Number(r.subscriberCount) : (r.totalViews || 0), linkBasis: "API" }],
        followers: r.subscriberCount != null ? Number(r.subscriberCount) : (r.totalViews || 0),
        sampleUrl: r.sampleUrl || null,
        sampleTitle: r.sampleTitle || null,
        audienceNote: "Pulled from a YouTube keyword search for this campaign's topic. Subscriber count is real (from YouTube's channels API); everything else — audience, trust, historical performance — is not available from this source. Treat as a discovery lead, not a scored recommendation.",
      }))
      // Highest subscribers first (most-followed creator on top). Unknown/
      // hidden counts (null) always sort last — never mixed in among real
      // zero- or low-subscriber channels.
      .sort((a, b) => (b.subscriberCount ?? -1) - (a.subscriberCount ?? -1));
  }

  async function initLiveCampaign(cid) {
    if (!window.__LIVE) return;
    try { const g = await liveFetch("graph", cid); if (g && g.rows && g.rows[0] && g.rows[0].nodes) window.__LIVE_GRAPH = g.rows[0]; } catch (e) {}
    try {
      const su = await liveFetch("suitability", cid);
      if (su && su.rows) su.rows.forEach((r) => { const c = (D.creators || []).find((x) => x.id === r.id);
        if (c) { const { id, ...f } = r; c.suitability = Object.assign({}, c.suitability, f); } });
    } catch (e) {}
    // real items pulled from YouTube/GDELT/RSS for this campaign (via
    // graph/scripts/ingest/) — separate from the synthetic scenario data,
    // so it's shown in its own clearly-labeled card rather than mixed in
    // with the templated narrative board.
    try { const ls = await liveFetch("liveSignals", cid); window.__LIVE_SIGNALS = (ls && ls.rows) || []; } catch (e) { window.__LIVE_SIGNALS = []; }
    try {
      const lc = await liveFetch("liveCreators", cid);
      const rows = (lc && lc.rows || []).filter((r) => r.id);
      if (rows.length) D.creators = mapLiveCreators(rows);
    } catch (e) {}
    try { route(); } catch (e) {}   // re-render current view now that live data is in
  }

  /* ================= chrome ================= */
  function pageHead(title, lede) { return h("div", { style: { marginBottom: "6px" } },
    h("h1", { class: "page-title" }, title), lede ? h("p", { class: "page-lede" }, lede) : null); }
  function sectionTitle(t, note) { return h("div", { class: "section-title" }, t, note ? h("span", { class: "st-note" }, "— " + note) : null); }
  function legend(keys, colorMap, labelMap) { return h("div", { class: "legend" }, keys.map((k) =>
    h("span", { class: "lg" }, h("span", { class: "sw", style: { background: colorMap[k] } }), (labelMap && labelMap[k] ? k + " · " + trunc(labelMap[k], 26) : k)))); }
  const trunc = (s, n) => String(s || "").length > n ? String(s).slice(0, n) + "…" : s;

  // Nav is per-module. PulseIQ is unchanged; BrandIQ adds Reputation Radar (always-on),
  // Category & Competitors, and the Compliance Gate — everything else is shared machinery.
  const NAV_PULSE = [
    ["OVERVIEW", [["command", "Command Center", "◆"], ["warroom", "War Room", "◉"]]],
    ["INTELLIGENCE", [["discovery", "Discovery & Search", "◈"], ["creators", "Creator Intelligence", "◐"],
      ["audience", "Audience & Evidence", "◔"], ["decision", "Decision Intelligence", "✦"],
      ["predictive", "Predictive Intelligence", "◇"], ["narratives", "Narratives & Trends", "◊"]]],
    ["EXPLORE", [["graph", "Knowledge Graph", "❋"], ["ontology", "Ontology Browser", "▤"]]],
    ["CAMPAIGN", [["performance", "Performance", "▮"]]],
    ["GOVERNANCE", [["governance", "Trust & Safety", "⛨"]]],
    ["", [["demo", "Guided Demo", "▷"]]],
  ];
  const NAV_BRAND = [
    ["ALWAYS-ON", [["radar", "Reputation Radar", "◎"], ["warroom", "War Room", "◉"], ["category", "Category & Competitors", "◑"]]],
    ["THIS EPISODE", [["command", "Command Center", "◆"], ["narratives", "Narratives & Ladder", "◊"],
      ["decision", "Decision Intelligence", "✦"], ["predictive", "Predictive Intelligence", "◇"]]],
    ["ADVOCACY", [["discovery", "Discovery & Search", "◈"], ["creators", "Creator Intelligence", "◐"],
      ["audience", "Audience & Evidence", "◔"]]],
    ["PROOF", [["performance", "Performance & Proof", "▮"]]],
    ["COMPLIANCE", [["compliance", "Compliance Gate", "⛉"], ["governance", "Trust & Safety", "⛨"]]],
    ["EXPLORE", [["graph", "Knowledge Graph", "❋"], ["ontology", "Ontology Browser", "▤"]]],
    ["", [["demo", "Guided Demo", "▷"]]],
  ];
  const navFor = () => (MODULE === "brand" ? NAV_BRAND : NAV_PULSE);
  const TITLES = Object.fromEntries(NAV_PULSE.concat(NAV_BRAND).flatMap((g) => g[1]).map((i) => [i[0], i[1]]));

  function renderNav(active) {
    const nav = $("nav"); nav.innerHTML = "";
    navFor().forEach((group) => {
      if (group[0]) nav.appendChild(h("div", { class: "nav-group" }, group[0]));
      group[1].forEach((item) => nav.appendChild(h("div", { class: "nav-item" + (item[0] === active ? " active" : ""), onclick: () => (location.hash = "#/" + item[0]) },
        h("span", { class: "ni-ico" }, item[2]), h("span", { class: "lbl" }, item[1]))));
    });
  }

  let PENDING = null;   // campaign to enter when the user opens PulseIQ from the suite
  let VIEW_TIMER = null; // per-view auto-refresh interval (War Room); cleared on navigation

  function route() {
    if (VIEW_TIMER) { clearInterval(VIEW_TIMER); VIEW_TIMER = null; }
    const raw = (location.hash || "").replace(/^#\//, "");
    // suite gate: no campaign entered, or explicit #/suite → the InfluenceIQ landing
    if (raw === "suite" || raw === "" || !ACTIVE) { showSuite(); return; }
    enterApp();
    // a view only resolves if this module's nav offers it (BrandIQ has no #/radar in PulseIQ, etc.)
    const inNav = new Set(navFor().flatMap((g) => g[1]).map((i) => i[0]));
    const home = MODULE === "brand" ? "radar" : "command";
    const name = (raw === "new") ? "new" : (views[raw] && inNav.has(raw) ? raw : home);
    renderNav(views[name] ? name : null);
    renderSwitcher();
    renderAlertBell();
    const M = moduleDef();
    document.body.dataset.module = MODULE;
    // shared bones, module skin: accent + brand mark follow the module you are inside
    document.documentElement.style.setProperty("--module-accent", M.accent || "#3987e5");
    const bm = $("brand-mark"); if (bm) { bm.innerHTML = ""; bm.appendChild(brandMarkFor()); }
    const bn = $("brand-name"); if (bn) bn.textContent = M.name || "PulseIQ";
    const bs = $("brand-sub"); if (bs) bs.textContent = M.tagline || "";
    const crumbView = (name === "new") ? "New campaign" : (TITLES[name] || "Command Center");
    const mid = MODULE === "brand" ? ((D.account && D.account.short) || cfgName()) : cfgName();
    $("crumb").innerHTML = 'InfluenceIQ <span class="crumb-sep">›</span> <b class="crumb-mod">' + esc(M.name || "PulseIQ") +
      '</b> <span class="crumb-sep">›</span> <span class="crumb-camp">' + esc(mid) + '</span> <span class="crumb-sep">›</span> ' + esc(crumbView);
    const host = $("view"); host.innerHTML = "";
    const fn = (name === "new") ? views.newCampaign : views[name];
    try { host.appendChild(fn()); }
    catch (err) { host.appendChild(h("div", { class: "note-box crit" }, "View error: " + (err && err.message))); console.error(err); }
    try { linkifyCodesIn(host); } catch (e) {}   // make every ontology code hover-explaining
    window.scrollTo(0, 0);
  }

  /* ================= suite landing (InfluenceIQ → modules) ================= */
  function enterApp() { document.body.classList.remove("mode-suite"); }
  function showSuite() {
    document.body.classList.add("mode-suite");
    const host = $("suite"); if (!host) return; host.innerHTML = "";
    const P = IIQ.platform || { suite: {}, modules: [] };
    const s = P.suite || {};
    host.appendChild(h("div", { class: "suite-hero" },
      h("div", { class: "suite-wordmark" }, h("span", { class: "wm-wave" }, waveMark()), h("span", null, s.name || "InfluenceIQ")),
      h("p", { class: "suite-tag" }, s.tagline || ""),
      h("p", { class: "suite-blurb" }, s.blurb || "")));
    const grid = h("div", { class: "module-grid" });
    (P.modules || []).forEach((m) => {
      // what sits under a module differs by module: PulseIQ holds campaigns, BrandIQ holds brands
      const n = m.entity === "account" ? (m.accounts || []).length : (m.campaigns || []).length;
      const unit = m.entityLabel || "campaigns";
      const tile = h("div", { class: "module-tile" + (m.locked ? " locked" : " open"), style: { "--accent": m.accent || "#3987e5" },
        onclick: m.locked ? null : () => enterModule(m) },
        h("div", { class: "mt-top" },
          h("div", { class: "mt-badge" }, m.locked ? "🔒 Coming soon" : "● Live"),
          h("div", { class: "mt-ico" }, moduleIcon(m.icon))),
        h("h3", { class: "mt-name" }, m.name),
        h("div", { class: "mt-tag" }, m.tagline || ""),
        h("p", { class: "mt-blurb" }, m.blurb || ""),
        m.locked ? h("div", { class: "mt-foot muted" }, "Locked in this workspace")
                 : h("div", { class: "mt-foot" },
                     h("span", null, n + " " + (n === 1 ? unit.replace(/s$/, "") : unit)),
                     h("span", { class: "mt-enter" }, "Enter " + m.name + " →")));
      grid.appendChild(tile);
    });
    host.appendChild(grid);
    host.appendChild(h("div", { class: "suite-foot muted" },
      "One engine, many IQs · every module answers the same four questions for a different principal — what story is forming, who can credibly carry the answer, did it work, and can we defend how we know."));
  }
  function enterModule(m) {
    const key = (m && m.key) || "pulse";
    const inMod = campaignList(key);
    const id = (PENDING && moduleOfCampaign(PENDING) === key) ? PENDING
             : ((m && m.campaigns && m.campaigns[0]) || (inMod[0] || {}).id);
    if (!id) return;
    useCampaign(id);
    const home = key === "brand" ? "#/radar" : "#/command";
    if (location.hash !== home) location.hash = home; else route();
  }
  function goSuite() { location.hash = "#/suite"; }

  /* ================= campaign switcher (topbar) ================= */
  let switcherOpen = false;
  function renderSwitcher() {
    const host = $("switcher"); if (!host) return; host.innerHTML = "";
    const cur = (D.cfg || {}); const M = moduleDef(); const isBrand = MODULE === "brand";
    // In BrandIQ the switcher names the BRAND (the always-on account); the episode sits under it.
    const topName = isBrand ? ((D.account && D.account.short) || cur.name || "Brand") : (cur.name || "Campaign");
    const topId = isBrand ? (cur.account || "") : (cur.id || "");
    const btn = h("button", { class: "sw-btn" + (switcherOpen ? " open" : ""), onclick: (e) => { e.stopPropagation(); switcherOpen = !switcherOpen; renderSwitcher(); } },
      h("span", { class: "sw-dot", style: { background: stageDot(cur.stage) } }),
      h("span", { class: "sw-name" }, topName),
      h("span", { class: "sw-id" }, topId),
      h("span", { class: "sw-caret" }, switcherOpen ? "▲" : "▼"));
    host.appendChild(btn);
    if (switcherOpen) {
      const menu = h("div", { class: "sw-menu", onclick: (e) => e.stopPropagation() });
      menu.appendChild(h("div", { class: "sw-menu-h" }, (M.name || "PulseIQ") + " " + (M.entityLabel || "campaigns")));
      campaignList().forEach((c) => {
        const cf = c.config || {};
        const nNarr = (c.narratives || []).length;
        const acct = (IIQ.accounts || {})[cf.account];
        const nm = isBrand ? ((acct && acct.short) || cf.name || c.id) : (cf.name || c.id);
        const sub = isBrand
          ? (cf.account || c.id) + " · " + ((acct && acct.sector) || "—") + " · " + nNarr + " narratives"
          : c.id + " · " + (cf.stage || "—") + " · " + nNarr + " narratives" + (cf.budget ? " · " + rs(cf.budget) : "");
        menu.appendChild(h("div", { class: "sw-item" + (c.id === ACTIVE ? " active" : ""), onclick: () => { switcherOpen = false; useCampaign(c.id); } },
          h("span", { class: "sw-dot", style: { background: stageDot(cf.stage) } }),
          h("div", { class: "sw-item-main" }, h("div", { class: "sw-item-name" }, nm),
            h("div", { class: "sw-item-sub" }, sub)),
          c.id === ACTIVE ? h("span", { class: "sw-check" }, "✓") : null));
      });
      if (!isBrand) menu.appendChild(h("div", { class: "sw-add", onclick: () => { switcherOpen = false; renderSwitcher(); location.hash = "#/new"; } },
        h("span", { class: "sw-add-ico" }, "＋"), "Add a campaign"));
      menu.appendChild(h("div", { class: "sw-add", onclick: () => { switcherOpen = false; goSuite(); } },
        h("span", { class: "sw-add-ico" }, "⌂"), "All modules"));
      host.appendChild(menu);
    }
  }
  function stageDot(stage) { const s = (stage || "").toLowerCase(); return /active|live/.test(s) ? "var(--good)" : /draft/.test(s) ? "var(--warn)" : "var(--muted)"; }
  document.addEventListener("click", () => { if (switcherOpen) { switcherOpen = false; renderSwitcher(); } });

  /* brand marks */
  function waveMark() { return h("span", { class: "wave-ekg", html: '<svg viewBox="0 0 48 20" width="48" height="20" preserveAspectRatio="none"><polyline points="0,10 8,10 12,3 16,17 20,10 28,10 32,6 36,14 40,10 48,10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>' }); }
  function moduleIcon(kind) {
    const m = { pulse: "◔", brand: "◈", market: "◇", creator: "◐" };
    return h("span", null, m[kind] || "◆");
  }
  // BrandIQ shares PulseIQ's bones and swaps the skin — same suite, different room.
  function shieldMark() { return h("span", { class: "wave-ekg", html: '<svg viewBox="0 0 48 20" width="48" height="20" preserveAspectRatio="none"><path d="M6,3 L18,3 L18,10 C18,15 12,17.5 12,17.5 C12,17.5 6,15 6,10 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polyline points="22,10 27,10 30,5 34,15 37,10 46,10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>' }); }
  function brandMarkFor() { return MODULE === "brand" ? shieldMark() : waveMark(); }

  /* ================= alert center + war room ================= */
  const SEV_RANK = { critical: 0, warn: 1, info: 2 };
  const SEV_HEX = { critical: "var(--critical)", warn: "var(--warn)", info: "var(--s1)" };
  // Derive campaign-aware alerts from the loaded data (velocity crossings, peaking, counter-share
  // slips, sensitive-tier activity, high-risk carriers, open predictions). Honesty-true: no
  // fabricated numbers — everything traces to a trending row / creator / outcome.
  function computeAlerts() {
    const out = []; const trend = D.trending || [];
    const nm = (id) => (by(D.narratives, id) || {}).name || id;
    heroNarr().forEach((nid) => {
      const rows = trend.filter((r) => r.narrative === nid).slice().sort((a, b) => String(a.week).localeCompare(String(b.week)));
      if (!rows.length) return;
      const byGeo = {}; rows.forEach((r) => { if (!byGeo[r.geo] || String(r.week) > String(byGeo[r.geo].week)) byGeo[r.geo] = r; });
      // Brand tempo: commercial stories move on smaller absolute amplifier counts than political
      // ones, so the early-warning threshold is re-fitted per module (RR-B06), not shared.
      const VEL_HI = MODULE === "brand" ? 26 : 60, VEL_LO = MODULE === "brand" ? 14 : 40;
      Object.keys(byGeo).forEach((g) => { const r = byGeo[g];
        if ((r.velocity || 0) >= VEL_LO && /emerging|growing/i.test(r.stage || "")) out.push({ sev: r.velocity >= VEL_HI ? "critical" : "warn", kind: "Early-warning",
          title: nm(nid) + " · velocity " + r.velocity + "/day", detail: nm(nid) + " (" + nid + ") is " + (r.stage || "").toLowerCase() + " in " + geoName(r.geo) + " — respond window open.",
          ev: [nid, "velocity " + r.velocity, r.stage], go: () => openNarrative(nid), goLabel: "Open narrative" }); });
      const latest = rows[rows.length - 1], prev = rows[rows.length - 2];
      if (/peak/i.test(latest.stage || "")) out.push({ sev: "warn", kind: "Lifecycle", title: nm(nid) + " peaking",
        detail: nm(nid) + " (" + nid + ") has peaked in " + geoName(latest.geo) + " (volume " + compact(latest.volume) + ").", ev: [nid, "peaking"], go: () => openNarrative(nid), goLabel: "Open narrative" });
      if (prev && latest.counterShare != null && prev.counterShare != null) { const d = latest.counterShare - prev.counterShare;
        if (d <= -0.04) out.push({ sev: "warn", kind: "Counter-share", title: nm(nid) + " counter-share slipping",
          detail: "Counter-share fell " + pct(prev.counterShare) + " → " + pct(latest.counterShare) + " in " + geoName(latest.geo) + ".", ev: [nid, Math.round(d * 100) + "pp"], go: () => openNarrative(nid), goLabel: "Open narrative" }); }
    });
    const sn = D.cfg && D.cfg.sensitiveNarrative;
    if (sn && trend.some((r) => r.narrative === sn)) out.push({ sev: "warn", kind: "Governance", title: "Sensitive-tier: " + nm(sn),
      detail: nm(sn) + " (" + sn + ") is in play — restricted handling engaged: transparency content only, no counter-mobilisation (RC-18).", ev: [sn, "restraint"], go: () => openNarrative(sn), goLabel: "Open posture" });
    const rf = riskFailCreator();
    if (rf) out.push({ sev: "warn", kind: "Trust & safety", title: "High-risk carrier " + rf.name,
      detail: "Risk-screen fail (bot-adjusted authenticity low). Amplifying " + ((rf.amplifies || []).join(", ") || "—") + " — do not activate.", ev: ["fit " + ((rf.suitability && rf.suitability.index) ?? 0).toFixed(2), "Not recommended"], go: () => openCreator(rf.id), goLabel: "Inspect creator" });
    // BrandIQ-only, and both data-backed: the ladder mutation and the compliance gate log.
    const L = D.cfg && D.cfg.ladder;
    if (L && (L.rungs || []).length > 1) { const r = L.rungs[1];
      out.push({ sev: "critical", kind: "Mutation", title: "Story mutated to " + (r.tier || "category").toLowerCase() + " tier",
        detail: nm(L.rungs[0].id) + " generalised into " + nm(r.id) + " (" + r.id + "). " + (r.why || "") + " Brand-voice response effectiveness drops sharply above brand tier (RR-B07).",
        ev: [r.id, r.verdict || "escalated"], go: () => openNarrative(r.id), goLabel: "Open narrative" }); }
    const CH = ((D.cfg && D.cfg.compliance) || {}).checks || [];
    const blocked = CH.filter((c) => c.state === "block" || c.state === "refuse");
    if (blocked.length) out.push({ sev: "warn", kind: "Compliance", title: blocked.length + " gate action" + (blocked.length === 1 ? "" : "s") + " logged",
      detail: blocked.map((c) => (c.state === "refuse" ? "REFUSED " : "BLOCKED ") + (c.name || c.subject) + " (" + c.rule + ")").join(" · ") + ".",
      ev: blocked.map((c) => c.rule), go: () => (location.hash = "#/compliance"), goLabel: "Open gate log" });
    const pend = (D.outcomes || []).find((o) => /predicted/i.test(o.oip || "") || /pending/i.test(String(o.value || "")));
    if (pend) out.push({ sev: "info", kind: "Prediction", title: "Prediction open — " + trunc(pend.outcome, 36),
      detail: String(pend.value) + " " + (pend.interval || "") + " — awaiting outcome to close the calibration loop.", ev: [pend.oip || "Predicted"], go: () => (location.hash = "#/predictive"), goLabel: "Open predictive" });
    return out.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
  }
  function alertRow(a) {
    return h("div", { class: "alert-row sev-" + a.sev },
      h("span", { class: "alert-dot", style: { background: SEV_HEX[a.sev] } }),
      h("div", { class: "alert-main" },
        h("div", { class: "alert-head" }, h("span", { class: "alert-kind" }, a.kind), h("span", { class: "alert-title" }, a.title)),
        h("div", { class: "alert-detail" }, a.detail),
        h("div", { class: "pill-row", style: { marginTop: "5px" } }, (a.ev || []).map((e) => badge(e, "muted")).concat(
          a.go ? [h("span", { class: "alert-go", onclick: (ev) => { ev.stopPropagation(); alertsOpen = false; renderAlertBell(); a.go(); } }, (a.goLabel || "Open") + " →")] : []))));
  }
  let alertsOpen = false;
  function renderAlertBell() {
    const host = $("alertbell"); if (!host) return; host.innerHTML = "";
    const alerts = computeAlerts();
    const crit = alerts.filter((a) => a.sev === "critical").length;
    const active = alerts.filter((a) => a.sev !== "info").length;
    host.appendChild(h("button", { class: "bell-btn" + (alertsOpen ? " open" : "") + (crit ? " has-crit" : ""), title: alerts.length + " active alerts",
      onclick: (e) => { e.stopPropagation(); alertsOpen = !alertsOpen; renderAlertBell(); } },
      h("span", { class: "bell-ico" }, "◎"), active ? h("span", { class: "bell-count" + (crit ? " crit" : "") }, String(active)) : null));
    if (alertsOpen) {
      const menu = h("div", { class: "alert-menu", onclick: (e) => e.stopPropagation() });
      menu.appendChild(h("div", { class: "alert-menu-h" }, h("span", null, "Live alerts · " + cfgName()),
        h("span", { class: "alert-warroom", onclick: () => { alertsOpen = false; location.hash = "#/warroom"; } }, "War room →")));
      if (!alerts.length) menu.appendChild(h("div", { class: "alert-empty" }, "No active alerts for this campaign."));
      else alerts.forEach((a) => menu.appendChild(alertRow(a)));
      host.appendChild(menu);
      try { linkifyCodesIn(menu); } catch (e) {}
    }
  }
  document.addEventListener("click", () => { if (alertsOpen) { alertsOpen = false; renderAlertBell(); } });

  views.warroom = function () {
    const wrap = h("div", { class: "warroom" }); const host = h("div"); wrap.appendChild(host);
    function render() {
      host.innerHTML = "";
      const cmap = narrColorMap(); const now = new Date();
      host.appendChild(h("div", { class: "wr-top" },
        h("div", { class: "wr-title" }, h("span", { class: "wr-live" }, h("span", { class: "wr-live-dot" }), "LIVE"), "War Room — " + cfgName()),
        h("div", { class: "wr-clock" }, h("span", { class: "mono" }, now.toLocaleTimeString()), h("span", { class: "wr-scan" }, "auto-refresh 5s"))));
      const grid = h("div", { class: "wr-grid" });
      grid.appendChild(h("div", { class: "wr-tile span2" }, h("div", { class: "wr-tile-h" }, "Narrative board"), narrativeBoard()));
      // velocity leaders
      const seen = {}; const lead = [];
      (D.trending || []).slice().sort((a, b) => (b.velocity || 0) - (a.velocity || 0)).forEach((r) => { const k = r.narrative + "|" + r.geo; if (!seen[k]) { seen[k] = 1; lead.push(r); } });
      const velTile = h("div", { class: "wr-tile" }, h("div", { class: "wr-tile-h" }, "Velocity leaders"));
      lead.slice(0, 6).forEach((r) => velTile.appendChild(h("div", { class: "wr-vel" },
        h("span", { class: "wr-vel-dot", style: { background: cmap[r.narrative] || "#3987e5" } }),
        h("span", { class: "wr-vel-nm", title: r.narrative }, nName(r.narrative) + " · " + geoName(r.geo)),
        explain(h("span", { class: "wr-vel-n mono" }, (r.velocity || 0) + "/d"), "velocity", r.velocity),
        sbadge(r.stage || "—", stageClass(r.stage), "stage", r.stage))));
      grid.appendChild(velTile);
      // counter-share trajectory (lead narrative)
      const lc = defSpread();
      const cs = (D.trending || []).filter((r) => r.narrative === lc).sort((a, b) => String(a.week).localeCompare(String(b.week)));
      const csTile = h("div", { class: "wr-tile" }, h("div", { class: "wr-tile-h" }, "Counter-share · " + nName(lc)));
      if (cs.length) { const series = {}; series[lc] = cs.map((r) => Math.round((r.counterShare || 0) * 100));
        csTile.appendChild(h("div", { class: "chart-wrap", html: lineChart(cs.map((r) => r.week), series, { [lc]: cmap[lc] || "#199e70" }, { [lc]: "counter %" }) })); }
      else csTile.appendChild(h("div", { class: "muted" }, "No trajectory for this campaign."));
      grid.appendChild(csTile);
      // campaign pulse (KPIs)
      const acts = D.activations || []; const sum = (k) => acts.reduce((a, x) => a + (firstNum(x[k]) || 0), 0);
      const fb = (D.cfg && D.cfg.fundedBrief) || {};
      const kpis = [["Counter-share", pct(latestCounterShare()), "counterShare"], ["Qualified reach", qualifiedReachLabel(), "reach"], ["Submissions", nf(sum("submissions")), null], ["CPA", fb.cpa ? "₹" + nf(fb.cpa) : "—", "reach"]];
      grid.appendChild(h("div", { class: "wr-tile" }, h("div", { class: "wr-tile-h" }, "Campaign pulse"),
        h("div", { class: "wr-kpis" }, kpis.map((k) => { const t = h("div", { class: "wr-kpi" }, h("div", { class: "wr-kpi-v" }, k[1]), h("div", { class: "wr-kpi-l" }, k[0])); return k[2] ? explain(t, k[2], k[1]) : t; }))));
      // alert feed
      const alerts = computeAlerts();
      const feed = h("div", { class: "wr-tile span2" }, h("div", { class: "wr-tile-h" }, "Alert feed", h("span", { class: "wr-tile-sub" }, alerts.length + " active")));
      if (!alerts.length) feed.appendChild(h("div", { class: "alert-empty" }, "No active alerts."));
      else alerts.forEach((a) => feed.appendChild(alertRow(a)));
      grid.appendChild(feed);
      host.appendChild(grid);
      host.appendChild(h("div", { class: "wr-foot muted" }, "Prototype tick: the board re-evaluates alerts every 5s from the loaded data — wire a live signal source and this becomes a real-time contest monitor."));
      try { linkifyCodesIn(host); } catch (e) {}
      renderAlertBell();
    }
    render();
    if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) VIEW_TIMER = setInterval(() => { try { render(); } catch (e) {} }, 5000);
    return wrap;
  };

  /* ================= init ================= */
  function init() {
    if (!window.IIQ) { $("view").innerHTML = '<div class="note-box crit">data.js failed to load. Open index.html from the web/ folder so the relative script paths resolve.</div>'; return; }
    $("drawer-scrim").onclick = closeDrawer;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); if (switcherOpen) { switcherOpen = false; renderSwitcher(); } if (alertsOpen) { alertsOpen = false; renderAlertBell(); } } });
    window.addEventListener("hashchange", route);
    const backBtn = $("to-suite"); if (backBtn) backBtn.onclick = goSuite;
    const bm = $("brand-mark"); if (bm) { bm.innerHTML = ""; bm.appendChild(waveMark()); }
    const brand = $("brand"); if (brand) brand.onclick = () => { location.hash = "#/command"; };
    // preselect the campaign we'll enter when opening PulseIQ
    let stored = null; try { stored = localStorage.getItem("pulse.campaign"); } catch (e) {}
    PENDING = (stored && (IIQ.campaigns || {})[stored]) ? stored : (campaignList()[0] || {}).id;
    const raw = (location.hash || "").replace(/^#\//, "");
    if (raw && raw !== "suite" && (views[raw] || raw === "new")) {
      // deep link → straight into the module that actually owns this view
      const BRAND_ONLY = new Set(["radar", "compliance", "category"]);
      let target = PENDING;
      if (BRAND_ONLY.has(raw) && moduleOfCampaign(target) !== "brand") target = (campaignList("brand")[0] || {}).id || target;
      useCampaign(target);
    }
    else { route(); }   // otherwise the suite landing
    initLive();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
