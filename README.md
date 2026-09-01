# InfluenceIQ — Frontend Prototype

A **zero-install, runnable design prototype** of the **InfluenceIQ** suite — a dark "intelligence
console" over one shared engine, served through two live modules:

- **PulseIQ** — political & civic influence intelligence, across three campaign scenarios
- **BrandIQ** — brand reputation & advocacy intelligence, on one always-on brand account

Both run on the same views, the same evidence architecture and the same reasoning models. BrandIQ
adds exactly three new screens; everything else re-renders on brand data unchanged.

> A *design prototype*, not the production app. It runs entirely in the browser on baked-in data
> (`data.js`) so you can react to the product **before** installing Node or wiring the live API. It
> ports directly to Next.js + the Neo4j/Aura API later.

## Open it (no install, no build)

**Double-click `index.html`** — or drag it into a browser. You land on the **InfluenceIQ suite**
(module tiles: PulseIQ and BrandIQ, both live). Click either module to enter, then:

- use the **switcher** in the topbar to move between that module's campaigns (PulseIQ) or brands
  (BrandIQ), or **⌂ All modules** to go back to the shelf;
- **click any score** (a suitability index, a confidence badge, a stage, a factor bar…) — hover
  shows a one-line plain meaning, click opens a drawer explaining what it means, how it's computed,
  and how to read *that* value.

Everything works offline **except** the Knowledge Graph view, which loads `vis-network` from a CDN.

## The scenarios

**PulseIQ** — enters on Command Center

| ID | Campaign | Contest |
|---|---|---|
| **CP-11** | Bengaluru Tunnel Road | infrastructure vs environment; the deep reference scenario |
| **CP-12** | Brand Bengaluru — Civic Governance | Tejasvi Surya vs the state govt: "collapse / power grab" vs "rebuild / reform" |
| **CP-13** | Guarantee Schemes — Welfare | statewide: "empowerment & delivery" vs "freebies bankrupt the state" |

**BrandIQ** — enters on Reputation Radar

| ID | Account / episode | Contest |
|---|---|---|
| **ACCT-B01** | Vachan Health Insurance | always-on brand account (fictional health insurer) |
| **CP-B01** | The Vachan Incident | a rejected cancer claim, filmed by the policyholder's son, turns the insurer's own name into the accusation against it |

Switching re-renders **every** view against that scenario's own creators, narratives, trending,
estimates, evidence, activations and graph.

## What you'll see

**Shared across both modules:** Command Center · Discovery & Search · Creator Intelligence ·
Audience & Evidence · Decision Intelligence · Predictive Intelligence · Narratives · Knowledge
Graph · Ontology Browser · Performance · Trust & Safety · War Room · Guided Demo.

**New in BrandIQ (three screens):**
- **Reputation Radar** — always-on, account-level. The brand account, the detection claim (platform
  fired day 1 08:40 on amplifier velocity; a volume threshold would have fired day 6 — a five-day
  advantage), the watch list by narrative tier, and the day-by-day velocity curve.
- **Compliance Gate** — every activation checked before it goes live, with blocks and refusals
  logged against their rule and basis. The audit trail a regulated buyer asks to see first.
- **Category & Competitors** — share of voice, plus the competitor amplifying on day 3 and
  retreating on day 6, dated and evidenced.

**Extended for BrandIQ (config-driven, invisible in PulseIQ):** the **mutation ladder** on
Narratives (brand → category → terminal tier, and why you cannot fight upward), the **six decision
points** on Command Center, the **commerce funnel vs holdout** and **+16pp incrementality** panel on
Performance, and **The BrandIQ delta** on the Ontology Browser — the authored-rows-versus-inherited
count that is the economic argument for a suite.

## Add a campaign (co-pilot)
**＋ Add a campaign** (topbar switcher, or `#/new`) opens a builder: answer a short brief
(objective, issue, geography, opposing frame, budget, timeframe) and the **PulseIQ co-pilot** drafts
the campaign narrative, target segments, suggested carriers, KPIs + budget split, and a governance
posture. Create it to explore it live as a new campaign (prototype draft — session-only, not
persisted without a backend). The co-pilot is scripted by default; set `ANTHROPIC_API_KEY` on Vercel
to route it through the real model via `api/copilot.js`.

## Design system
Dark "narrative-intelligence" console: the pre-validated **dataviz reference palette** for data
marks, plus a **PulseIQ identity** for chrome — pulse/waveform brand mark, gradient + soft glow,
glassmorphism panels, an animated velocity accent, and campaign-aware narrative colours.
Accessibility-safe contrast; `prefers-reduced-motion` disables the animations.

## Structure
```
web/
├── index.html            # shell: suite landing, sidebar (PulseIQ brand), topbar switcher, drawer
├── app.css               # dark-console design system + PulseIQ redesign
├── app.js                # campaign-state layer + all views + routing + suite/switcher/co-pilot/explainability
├── data.js               # window.IIQ — { meta, platform(modules), glossary, ref, campaigns{CP-11/12/13} }
├── api/query.js          # serverless: per-campaign live Neo4j reads (name-only queries, $cid param)
├── api/copilot.js        # serverless: OPTIONAL Anthropic co-pilot seam (ANTHROPIC_API_KEY)
├── scripts/gen_data.pl   # regenerates data.js from ../graph/data
└── README.md
```

### The campaign-state layer (how switching works)
`window.IIQ` is namespaced: shared reference/ontology under `ref` (factors, rules, KPIs, risk bands,
graph reference layer), the BrandIQ reference delta under `brandRef`, brand accounts under
`accounts`, a `campaigns` map (each with its own operational slice + UI `config`), and a `glossary`
(the score explanations). In `app.js`, `D` is a merged working view (`ref ⊕ active campaign`)
reassigned on switch, so every view keeps reading `D.<key>` unchanged; per-campaign literals (hero
narratives, timeline, budget, hero creators…) come from `D.cfg`.

### The module layer (how BrandIQ was added without touching PulseIQ)
A campaign declares its module in its own `config.module`; PulseIQ campaigns predate the field and
default to `pulse`. `MODULE` follows the active campaign, and it drives the nav (`NAV_PULSE` /
`NAV_BRAND`), the breadcrumb, the accent colour, the brand mark, the switcher labels, and the
early-warning velocity thresholds (brand stories move on smaller absolute amplifier counts — the
re-thresholding is rule `RR-B06`, not a magic number).

Every BrandIQ-only surface renders **only where the config declares its block** — `ladder`, `radar`,
`decisions`, `compliance`, `sov`, `funnel`. That is why PulseIQ is byte-for-byte unchanged in
behaviour: those functions return a hidden node when the block is absent.

## Regenerate the data
`data.js` is generated from the same TSVs that build the Neo4j graph:
```bash
perl graph/scripts/seed_campaigns.pl        # (re)writes the PulseIQ CP-12/CP-13 scenario TSVs + configs
perl graph/scripts/seed_brandiq.pl          # (re)writes the BrandIQ delta + ACCT-B01/CP-B01 + modules.json
perl web/scripts/gen_data.pl > web/data.js  # rebuilds the UI bundle (all 3 campaigns)
```

## Path to production
1. **This prototype** → agree the look, features, and flows across the three campaigns.
2. **Next.js port** — same views as React components.
3. **Live API** — `api/query.js` already reads live per-campaign data from Aura; the badge flips to
   "Live · Neo4j Aura" and switching campaigns re-fetches (`?q=graph&c=CP-12`).
4. **Deploy to Vercel** — `NEO4J_*` (and optional `ANTHROPIC_API_KEY`) become Vercel env vars.

> Note: this prototype was structurally validated (bracket/quote balance, `data.js` parses, Cypher
> lints) but **not yet opened in a browser on this machine** (no GUI here). Open it and flag
> anything visually off — iteration is expected.
