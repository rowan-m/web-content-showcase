import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ManifestGroup, ManifestItem, ShowcaseManifest, WebManifestItem } from '../src/types.js';
import { findTopLevelYamlKeyLines, loadConfig, normalizeGitHubRepoUrl } from './lib/config.js';
import {
  buildCardItem,
  checkUrlEmbeddable,
  fetchFeedEntries,
  fetchYouTubeChannelItems,
  fetchYouTubeOEmbed,
  resolveYouTubeChannelId,
} from './lib/fetchers.js';

const OUTPUT_PATH = join(process.cwd(), 'public', 'manifest.json');

function loadPreviousManifest(): ShowcaseManifest | null {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as ShowcaseManifest;
  } catch {
    return null;
  }
}

function fallbackItemsForSource(prev: ShowcaseManifest | null, sourceId: string): ManifestItem[] {
  if (!prev) return [];
  for (const group of Object.values(prev.groups)) {
    const matching = group.items.filter((item) => item.sourceId === sourceId);
    if (matching.length > 0) return matching;
  }
  return [];
}

function defaultTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

function detectRepoUrl(): string | undefined {
  if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
    return `${process.env.GITHUB_SERVER_URL.replace(/\/$/, '')}/${process.env.GITHUB_REPOSITORY}`;
  }
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return normalizeGitHubRepoUrl(remote);
  } catch {
    return undefined;
  }
}

async function main() {
  const configDir = join(process.cwd(), 'config');
  const config = loadConfig(configDir);
  const previous = loadPreviousManifest();
  const repoUrl = detectRepoUrl();

  const youtubeLines = findTopLevelYamlKeyLines(join(configDir, 'youtube.yaml'));
  const feedLines = findTopLevelYamlKeyLines(join(configDir, 'feeds.yaml'));
  const urlLines = findTopLevelYamlKeyLines(join(configDir, 'urls.yaml'));
  const groupLines = findTopLevelYamlKeyLines(join(configDir, 'groups.yaml'));

  const sourceLocations = new Map<string, { configFile: string; configLine?: number }>();
  for (const id of Object.keys(config.youtube)) {
    sourceLocations.set(id, { configFile: 'config/youtube.yaml', configLine: youtubeLines.get(id) });
  }
  for (const id of Object.keys(config.feeds)) {
    sourceLocations.set(id, { configFile: 'config/feeds.yaml', configLine: feedLines.get(id) });
  }
  for (const id of Object.keys(config.urls)) {
    sourceLocations.set(id, { configFile: 'config/urls.yaml', configLine: urlLines.get(id) });
  }

  const resolvedSources = new Map<string, ManifestItem[]>();
  const channelIdCache = new Map<string, string>();
  const embedCache = new Map<string, { embeddable: boolean; reason?: string }>();

  const getEmbedStatus = async (url: string) => {
    const cached = embedCache.get(url);
    if (cached) return cached;
    const res = await checkUrlEmbeddable(url);
    embedCache.set(url, res);
    return res;
  };

  // 1. Resolve YouTube sources
  // Store explicit source/entry override separately (undefined = inherit group/global default).
  const sourceHasExplicitMax = new Map<string, boolean>();
  const itemHasExplicitMax = new Map<string, boolean>();

  for (const [sourceId, src] of Object.entries(config.youtube)) {
    const sourceMax = src.maxDuration;
    if (sourceMax !== undefined) sourceHasExplicitMax.set(sourceId, true);
    const defaultForSource = sourceMax !== undefined ? sourceMax : config.settings.youtube.maxDuration;

    try {
      if ('videos' in src) {
        const items: ManifestItem[] = await Promise.all(
          src.videos.map(async (entry) => {
            const itemId = `${sourceId}:${entry.id}`;
            if (entry.maxDuration !== undefined) itemHasExplicitMax.set(itemId, true);
            const resolvedMax = entry.maxDuration !== undefined ? entry.maxDuration : defaultForSource;
            try {
              const info = await fetchYouTubeOEmbed(entry.id);
              return {
                kind: 'youtube' as const,
                id: itemId,
                videoId: entry.id,
                isShort: Boolean(entry.isShort),
                title: entry.title ?? info.title,
                channel: info.channel,
                thumbnail: info.thumbnail,
                start: entry.start,
                end: entry.end,
                maxDurationSeconds: resolvedMax,
                sourceId,
              };
            } catch (err) {
              console.warn(`[youtube:${sourceId}] oEmbed lookup failed for ${entry.id}: ${String(err)}`);
              return {
                kind: 'youtube' as const,
                id: itemId,
                videoId: entry.id,
                isShort: Boolean(entry.isShort),
                title: entry.title ?? entry.id,
                thumbnail: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
                start: entry.start,
                end: entry.end,
                maxDurationSeconds: resolvedMax,
                sourceId,
              };
            }
          }),
        );
        resolvedSources.set(sourceId, items);
        console.log(`[youtube:${sourceId}] resolved ${items.length} curated video(s)`);
      } else {
        const lookupKey = src.channelId ?? src.handle!;
        let channelId = channelIdCache.get(lookupKey);
        if (!channelId) {
          channelId = await resolveYouTubeChannelId(lookupKey);
          channelIdCache.set(lookupKey, channelId);
        }
        const items = await fetchYouTubeChannelItems(sourceId, channelId, src.kind, src.count, defaultForSource);
        resolvedSources.set(sourceId, items);
        console.log(`[youtube:${sourceId}] resolved ${items.length} ${src.kind} from ${lookupKey}`);
      }
    } catch (err) {
      const fallback = fallbackItemsForSource(previous, sourceId);
      console.warn(
        `[youtube:${sourceId}] failed (${err instanceof Error ? err.message : String(err)}); using ${fallback.length} cached item(s)`,
      );
      resolvedSources.set(sourceId, fallback);
    }
  }

  // 2. Resolve RSS / Atom feeds
  for (const [sourceId, feed] of Object.entries(config.feeds)) {
    try {
      const entries = await fetchFeedEntries(feed.url, feed.count, feed.display === 'card');
      const durationSeconds = feed.duration ?? config.settings.duration;
      const items: ManifestItem[] = entries.map((entry, idx) => {
        if (feed.display === 'redirect') {
          const webItem: WebManifestItem = {
            kind: 'web',
            id: `${sourceId}:${idx}:${entry.url}`,
            url: entry.url,
            title: entry.title,
            display: 'redirect',
            durationSeconds,
            sourceId,
            embeddable: false,
          };
          return webItem;
        }
        return buildCardItem(
          sourceId,
          entry,
          feed.label ?? entry.feedTitle ?? defaultTitleFromUrl(feed.url),
          durationSeconds,
          idx,
        );
      });
      resolvedSources.set(sourceId, items);
      console.log(`[feed:${sourceId}] resolved ${items.length} item(s) (${feed.display})`);
    } catch (err) {
      const fallback = fallbackItemsForSource(previous, sourceId);
      console.warn(
        `[feed:${sourceId}] failed (${err instanceof Error ? err.message : String(err)}); using ${fallback.length} cached item(s)`,
      );
      resolvedSources.set(sourceId, fallback);
    }
  }

  // 3. Resolve explicit URL lists
  for (const [sourceId, entries] of Object.entries(config.urls)) {
    const items: WebManifestItem[] = await Promise.all(
      entries.map(async (entry, idx) => {
        let display: 'iframe' | 'redirect';
        let embeddable: boolean | undefined;
        if (entry.display === 'auto') {
          const probe = await getEmbedStatus(entry.url);
          embeddable = probe.embeddable;
          display = probe.embeddable ? 'iframe' : 'redirect';
        } else {
          display = entry.display;
          embeddable = entry.display === 'iframe';
        }
        return {
          kind: 'web',
          id: `${sourceId}:${idx}:${entry.url}`,
          url: entry.url,
          title: entry.title ?? defaultTitleFromUrl(entry.url),
          display,
          durationSeconds: entry.duration ?? config.settings.duration,
          sourceId,
          embeddable,
        };
      }),
    );
    resolvedSources.set(sourceId, items);
    console.log(`[urls:${sourceId}] resolved ${items.length} URL(s)`);
  }

  // 4. Assemble groups
  const groups: Record<string, ManifestGroup> = {};
  for (const [groupId, groupCfg] of Object.entries(config.groups)) {
    const seenIds = new Set<string>();
    const items: ManifestItem[] = [];
    for (const sourceId of groupCfg.sources) {
      const loc = sourceLocations.get(sourceId);
      for (const item of resolvedSources.get(sourceId) ?? []) {
        // Deduplicate YouTube videos that appear in both recent channel feed and curated list
        const dedupeKey = item.kind === 'youtube' ? `yt:${item.videoId}` : `${item.kind}:${item.url}`;
        if (seenIds.has(dedupeKey)) continue;
        seenIds.add(dedupeKey);
        const withLoc: ManifestItem = {
          ...item,
          configFile: loc?.configFile,
          configLine: loc?.configLine,
        };
        if (
          withLoc.kind === 'youtube' &&
          groupCfg.maxVideoDuration !== undefined &&
          !itemHasExplicitMax.has(withLoc.id) &&
          !sourceHasExplicitMax.has(sourceId)
        ) {
          items.push({ ...withLoc, maxDurationSeconds: groupCfg.maxVideoDuration });
        } else {
          items.push(withLoc);
        }
      }
    }
    groups[groupId] = {
      id: groupId,
      description: groupCfg.description,
      order: groupCfg.order,
      configFile: 'config/groups.yaml',
      configLine: groupLines.get(groupId),
      items,
    };
  }

  const manifest: ShowcaseManifest = {
    generatedAt: new Date().toISOString(),
    repoUrl,
    defaultGroup: config.settings.defaultGroup,
    defaultDurationSeconds: config.settings.duration,
    youtube: {
      mute: config.settings.youtube.mute,
      captions: config.settings.youtube.captions,
      captionLang: config.settings.youtube.captionLang,
      controls: config.settings.youtube.controls,
      maxDurationSeconds: config.settings.youtube.maxDuration,
    },
    groups,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH} with ${Object.keys(groups).length} groups.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
