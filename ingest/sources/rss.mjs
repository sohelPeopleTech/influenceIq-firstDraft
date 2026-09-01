// S11 — own news crawl via each outlet's RSS feed. Free, no key.
// RSS only ever gives headline + link + date + short summary (confirmed
// limitation from the tracker doc) — full article body needs a per-outlet
// HTML parser, explicitly out of scope for this pass.
//
// Add more feeds to OUTLETS as you find them (tracker doc: "find a specific
// Indian outlet's real feed via page-source search for 'rss+xml'").
//
// Modeling note: the ontology's PUBLISHED edge is defined as
// CreatorAccount->Content. A news outlet isn't a CreatorAccount, so this
// source uses Organisation->Content instead — a reasonable, minimal
// extension rather than forcing outlets into the creator model.

import { mergeNode, mergeEdge } from '../neo4j.mjs';
import { contentId, organisationId, truncate } from '../ids.mjs';

export const OUTLETS = [
  { name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'The Hindu', url: 'https://www.thehindu.com/news/national/karnataka/feeder/default.rss' },
  { name: 'Times of India — India', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms' },
];

function textBetween(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const chunk = '<item ' + block.split(/<\/item>/i)[0] + '</item>';
    items.push({
      title: textBetween(chunk, 'title'),
      link: textBetween(chunk, 'link'),
      pubDate: textBetween(chunk, 'pubDate'),
      description: textBetween(chunk, 'description'),
    });
  }
  return items;
}

function matchesTopic(item, topicWords) {
  const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return topicWords.some((w) => haystack.includes(w));
}

export async function ingestRss({ topic, campaignId, issueId, outlets = OUTLETS, maxPerOutlet = 10 }) {
  const topicWords = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let written = 0;
  let outletsTried = 0;
  const perOutletErrors = [];

  for (const outlet of outlets) {
    outletsTried++;
    let xml;
    try {
      const res = await fetch(outlet.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
      console.log(`[rss] ${outlet.name} raw response (first 1000 chars):`, xml.slice(0, 1000));
    } catch (err) {
      // one bad feed should never stop the others
      perOutletErrors.push(`${outlet.name}: ${err.message}`);
      continue;
    }

    const items = parseRssItems(xml).filter((it) => matchesTopic(it, topicWords)).slice(0, maxPerOutlet);
    if (!items.length) continue;

    const orgId = organisationId(outlet.name);
    await mergeNode(['Organisation'], {
      id: orgId,
      name: outlet.name,
      nodeType: 'Organisation',
      layer: 'operational',
      source: 'rss',
      campaignId,
    });

    for (const it of items) {
      if (!it.link) continue;
      const cId = contentId('RSS', it.link);
      await mergeNode(['Content'], {
        id: cId,
        name: truncate(it.title, 200),
        nodeType: 'Content',
        layer: 'operational',
        source: 'rss',
        campaignId,
        contentType: 'article',
        url: it.link,
        publishedAt: it.pubDate || null,
        description: truncate(it.description, 500),
        outlet: outlet.name,
      });
      await mergeEdge(orgId, 'PUBLISHED', cId);
      if (issueId) await mergeEdge(cId, 'MENTIONS', issueId);
      written++;
    }
  }

  return { count: written, outletsTried, errors: perOutletErrors };
}
