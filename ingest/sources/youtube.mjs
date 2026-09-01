// S2 — YouTube Data API v3. Free Google Cloud key, 10,000 quota units/day.
// Three calls: search (topic -> candidate videos), videos (stats for those
// specific videos), channels (real subscriber counts for the channels that
// posted them). Docs: https://developers.google.com/youtube/v3
//
// Maps into the existing ontology:
//   Creator        (P-LIVE-YT-<channelId>)     — one per channel, carries
//                                                 real subscriberCount
//   CreatorAccount (ACC-LIVE-YT-<channelId>)   — the channel's YT presence
//   Content        (CN-LIVE-YT-<videoId>)      — one per video
//   Platform       YT (already exists, ref layer) — HOSTED_ON target
// Edges: OPERATES(Creator->Account), HOSTED_ON(Account->Platform),
//        PUBLISHED(Account->Content), DISCUSSES(Creator->Issue) if issueId given

import { ENV } from '../env.mjs';
import { mergeNode, mergeEdge } from '../neo4j.mjs';
import { creatorId, accountId, contentId, truncate } from '../ids.mjs';

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

export async function ingestYoutube({ topic, campaignId, issueId, maxResults = 10 }) {
  if (!ENV.YOUTUBE_API_KEY) {
    return { skipped: true, reason: 'YOUTUBE_API_KEY not set in graph/.env' };
  }

  // 1) search by topic -> candidate video ids
  const searchUrl = new URL(SEARCH_URL);
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', topic);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', String(maxResults));
  searchUrl.searchParams.set('key', ENV.YOUTUBE_API_KEY);

  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  console.log(`[youtube] search raw response:`, JSON.stringify(searchData).slice(0, 2000));
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchData.error?.message || searchRes.status}`);
  }
  const videoIds = (searchData.items || [])
    .map((it) => it.id && it.id.videoId)
    .filter(Boolean);
  if (!videoIds.length) return { count: 0, note: 'no videos matched this topic' };

  // 2) fetch full stats for those specific video ids
  const videosUrl = new URL(VIDEOS_URL);
  videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails,status');
  videosUrl.searchParams.set('id', videoIds.join(','));
  videosUrl.searchParams.set('key', ENV.YOUTUBE_API_KEY);

  const videosRes = await fetch(videosUrl);
  const videosData = await videosRes.json();
  console.log(`[youtube] videos raw response:`, JSON.stringify(videosData).slice(0, 2000));
  if (!videosRes.ok) {
    throw new Error(`YouTube videos lookup failed: ${videosData.error?.message || videosRes.status}`);
  }
  const items = videosData.items || [];

  // 3) fetch real subscriber counts for every distinct channel found above.
  // channels.list accepts up to 50 comma-separated ids per call — one
  // request covers everything from a single ingestion run.
  const uniqueChannelIds = [...new Set(items.map((v) => v.snippet.channelId))];
  const subscriberCounts = {}; // channelId -> number | null (null = hidden by the channel owner)
  if (uniqueChannelIds.length) {
    const channelsUrl = new URL(CHANNELS_URL);
    channelsUrl.searchParams.set('part', 'statistics');
    channelsUrl.searchParams.set('id', uniqueChannelIds.join(','));
    channelsUrl.searchParams.set('key', ENV.YOUTUBE_API_KEY);

    const channelsRes = await fetch(channelsUrl);
    const channelsData = await channelsRes.json();
    console.log(`[youtube] channels raw response:`, JSON.stringify(channelsData).slice(0, 2000));
    if (channelsRes.ok) {
      for (const ch of channelsData.items || []) {
        const stats = ch.statistics || {};
        // Some channels hide their subscriber count publicly — YouTube
        // flags this rather than just omitting the field. Store null
        // (unknown), not 0, so we never sort/display a hidden count as
        // "this channel genuinely has zero subscribers".
        subscriberCounts[ch.id] = stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0);
      }
    } else {
      // Non-fatal — proceed without subscriber counts rather than losing
      // the whole ingestion run over a third, non-essential call.
      console.log(`[youtube] channels.list failed (${channelsData.error?.message || channelsRes.status}) — continuing without subscriber counts`);
    }
  }

  let written = 0;
  const seenChannels = new Set();

  for (const v of items) {
    const channelId = v.snippet.channelId;
    const cId = creatorId('YT', channelId);
    const aId = accountId('YT', channelId);
    const vId = contentId('YT', v.id);

    if (!seenChannels.has(channelId)) {
      seenChannels.add(channelId);
      const subs = Object.prototype.hasOwnProperty.call(subscriberCounts, channelId) ? subscriberCounts[channelId] : null;
      await mergeNode(['Creator'], {
        id: cId,
        name: v.snippet.channelTitle,
        nodeType: 'Creator',
        layer: 'operational',
        source: 'youtube',
        campaignId,
        subscriberCount: subs, // real figure from channels.list, or null if hidden/unavailable
      });
      await mergeNode(['CreatorAccount'], {
        id: aId,
        name: v.snippet.channelTitle + ' (YouTube)',
        nodeType: 'CreatorAccount',
        layer: 'operational',
        source: 'youtube',
        platform: 'YT',
        campaignId,
        subscriberCount: subs,
      });
      await mergeEdge(cId, 'OPERATES', aId);
      await mergeEdge(aId, 'HOSTED_ON', 'YT');
      if (issueId) await mergeEdge(cId, 'DISCUSSES', issueId);
    }

    await mergeNode(['Content'], {
      id: vId,
      name: truncate(v.snippet.title, 200),
      nodeType: 'Content',
      layer: 'operational',
      source: 'youtube',
      campaignId,
      contentType: v.snippet.liveBroadcastContent === 'none' ? 'video' : v.snippet.liveBroadcastContent,
      description: truncate(v.snippet.description, 1000),
      publishedAt: v.snippet.publishedAt,
      views: Number(v.statistics?.viewCount || 0),
      likes: Number(v.statistics?.likeCount || 0),
      commentCount: Number(v.statistics?.commentCount || 0),
      thumbnail: v.snippet.thumbnails?.medium?.url || null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
    });
    await mergeEdge(aId, 'PUBLISHED', vId);
    written++;
  }

  return { count: written, channels: seenChannels.size };
}
