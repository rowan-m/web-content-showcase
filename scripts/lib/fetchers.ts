import { XMLParser } from 'fast-xml-parser';
import type { CardManifestItem, YouTubeManifestItem } from '../../src/types.js';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

async function fetchText(url: string, timeoutMs = 15_000): Promise<{ status: number; text: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveYouTubeChannelId(handleOrId: string): Promise<string> {
  if (/^UC[A-Za-z0-9_-]+$/.test(handleOrId)) {
    return handleOrId;
  }
  const normalized = handleOrId.startsWith('@') ? handleOrId : `@${handleOrId}`;
  const url = `https://www.youtube.com/${normalized}`;
  const { status, text } = await fetchText(url);
  if (status < 200 || status >= 300) {
    throw new Error(`Failed to resolve YouTube handle ${normalized}: HTTP ${status}`);
  }
  const externalMatch = /"externalId":"(UC[A-Za-z0-9_-]+)"/.exec(text);
  if (externalMatch) return externalMatch[1];
  const browseMatch = /"browseId":"(UC[A-Za-z0-9_-]+)"/.exec(text);
  if (browseMatch) return browseMatch[1];
  throw new Error(`Could not find channel ID for ${normalized}`);
}

function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) {
    return String((node as { '#text': unknown })['#text'] ?? '');
  }
  return '';
}

export async function fetchYouTubeChannelItems(
  sourceId: string,
  channelId: string,
  kind: 'videos' | 'shorts',
  count: number,
  maxDurationSeconds: number | null,
): Promise<YouTubeManifestItem[]> {
  const playlistPrefix = kind === 'shorts' ? 'UUSH' : 'UULF';
  const playlistId = `${playlistPrefix}${channelId.slice(2)}`;
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  const { status, text } = await fetchText(feedUrl);
  if (status === 404) {
    return [];
  }
  if (status < 200 || status >= 300) {
    throw new Error(`YouTube feed ${feedUrl} failed with HTTP ${status}`);
  }
  const parsed = xmlParser.parse(text) as {
    feed?: {
      title?: unknown;
      entry?: unknown;
    };
  };
  const channelTitle = extractText(parsed.feed?.title);
  const entries = asArray(parsed.feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);

  return entries.slice(0, count).map((entry) => {
    const videoId = extractText(entry['yt:videoId']);
    const title = extractText(entry.title) || videoId;
    const publishedAt = extractText(entry.published) || undefined;
    const author =
      entry.author && typeof entry.author === 'object'
        ? extractText((entry.author as Record<string, unknown>).name)
        : channelTitle;
    const mediaGroup = entry['media:group'] as Record<string, unknown> | undefined;
    const thumbObj = mediaGroup?.['media:thumbnail'] as Record<string, unknown> | undefined;
    const thumbnail =
      (typeof thumbObj?.['@_url'] === 'string' ? thumbObj['@_url'] : undefined) ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      kind: 'youtube' as const,
      id: `${sourceId}:${videoId}`,
      videoId,
      isShort: kind === 'shorts',
      title,
      channel: author || undefined,
      publishedAt,
      thumbnail,
      maxDurationSeconds,
      sourceId,
    };
  });
}

export interface YouTubeOEmbedInfo {
  title: string;
  channel?: string;
  thumbnail?: string;
}

export async function fetchYouTubeOEmbed(videoId: string): Promise<YouTubeOEmbedInfo> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const { status, text } = await fetchText(url, 10_000);
  if (status < 200 || status >= 300) {
    throw new Error(`YouTube video ${videoId} is unavailable or cannot be embedded (oEmbed HTTP ${status})`);
  }
  const data = JSON.parse(text) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };
  return {
    title: data.title ?? videoId,
    channel: data.author_name,
    thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

export function stripHtmlToExcerpt(html: string, maxLength = 240): string {
  const decoded = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/\s+/g, ' ')
    .trim();

  if (decoded.length <= maxLength) return decoded;
  const cut = decoded.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function upgradeThumbnailUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Blogger Atom feeds expose tiny 72x72 cropped thumbnails (s72-c); request full-width image instead.
  if (url.includes('googleusercontent.com') && /\/s\d+(-c)?\//.test(url)) {
    return url.replace(/\/s\d+(-c)?\//, '/w1280/');
  }
  return url;
}

function resolveHttpUrl(raw: string | undefined, baseUrl?: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
  } catch {
    return '';
  }
}

function extractImageFromHtml(html: string, baseUrl?: string): string | undefined {
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (imgMatch) {
    const resolved = resolveHttpUrl(imgMatch[1], baseUrl);
    if (resolved) return upgradeThumbnailUrl(resolved);
  }
  return undefined;
}

export async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  try {
    const { status, text } = await fetchText(pageUrl, 8_000);
    if (status < 200 || status >= 300) return undefined;
    const head = text.slice(0, 32_000);
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(head);
      if (match?.[1]) {
        return new URL(match[1], pageUrl).toString();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveAtomLink(linkNode: unknown): string {
  const links = asArray(linkNode as Record<string, unknown> | Record<string, unknown>[] | string | undefined);
  for (const link of links) {
    if (typeof link === 'string' && link.startsWith('http')) return link;
    if (link && typeof link === 'object') {
      const rel = String((link as Record<string, unknown>)['@_rel'] ?? 'alternate');
      const href = String((link as Record<string, unknown>)['@_href'] ?? '');
      if (rel === 'alternate' && href) return href;
    }
  }
  for (const link of links) {
    if (link && typeof link === 'object') {
      const href = String((link as Record<string, unknown>)['@_href'] ?? '');
      if (href) return href;
    }
  }
  return '';
}

export interface ParsedFeedEntry {
  url: string;
  title: string;
  summary?: string;
  image?: string;
  publishedAt?: string;
  author?: string;
  feedTitle?: string;
}

export function parseFeedXml(xml: string, limit: number, baseUrl?: string): ParsedFeedEntry[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  // RSS 2.0
  const rss = parsed.rss as { channel?: Record<string, unknown> } | undefined;
  if (rss?.channel) {
    const channel = rss.channel;
    const feedTitle = extractText(channel.title) || undefined;
    const items = asArray(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return items
      .slice(0, limit)
      .map((item) => {
        const url = resolveHttpUrl(extractText(item.link) || extractText(item.guid), baseUrl);
        const title = stripHtmlToExcerpt(extractText(item.title), 160) || url;
        const rawDesc = extractText(item['content:encoded']) || extractText(item.description);
        const summary = rawDesc ? stripHtmlToExcerpt(rawDesc) : undefined;
        const enclosure = item.enclosure as Record<string, unknown> | undefined;
        const mediaContent = asArray(
          item['media:content'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        )[0];
        const mediaThumb = asArray(
          item['media:thumbnail'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        )[0];
        const itemBase = url || baseUrl;
        const rawImage =
          (typeof mediaContent?.['@_url'] === 'string' ? mediaContent['@_url'] : undefined) ??
          (typeof mediaThumb?.['@_url'] === 'string' ? mediaThumb['@_url'] : undefined) ??
          (typeof enclosure?.['@_url'] === 'string' && String(enclosure['@_type'] ?? '').startsWith('image/')
            ? enclosure['@_url']
            : undefined);
        const image =
          (rawImage ? upgradeThumbnailUrl(resolveHttpUrl(rawImage, itemBase) || undefined) : undefined) ??
          extractImageFromHtml(rawDesc, itemBase);

        const publishedAt = extractText(item.pubDate) || extractText(item['dc:date']) || undefined;
        const author = extractText(item['dc:creator']) || extractText(item.author) || undefined;

        return { url, title, summary, image, publishedAt, author, feedTitle };
      })
      .filter((entry) => entry.url.startsWith('http'));
  }

  // Atom
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (feed) {
    const feedTitle = extractText(feed.title) || undefined;
    const entries = asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return entries
      .slice(0, limit)
      .map((entry) => {
        const url = resolveHttpUrl(resolveAtomLink(entry.link), baseUrl);
        const title = stripHtmlToExcerpt(extractText(entry.title), 160) || url;
        const rawDesc = extractText(entry.summary) || extractText(entry.content);
        const summary = rawDesc ? stripHtmlToExcerpt(rawDesc) : undefined;
        const mediaThumb = entry['media:thumbnail'] as Record<string, unknown> | undefined;
        const itemBase = url || baseUrl;
        const rawThumb = typeof mediaThumb?.['@_url'] === 'string' ? mediaThumb['@_url'] : undefined;
        const image =
          extractImageFromHtml(rawDesc, itemBase) ??
          upgradeThumbnailUrl(rawThumb ? resolveHttpUrl(rawThumb, itemBase) || undefined : undefined);
        const publishedAt = extractText(entry.published) || extractText(entry.updated) || undefined;
        const authorObj = entry.author as Record<string, unknown> | undefined;
        const author = authorObj ? extractText(authorObj.name) || undefined : undefined;
        return { url, title, summary, image, publishedAt, author, feedTitle };
      })
      .filter((entry) => entry.url.startsWith('http'));
  }

  throw new Error('Unrecognized feed format (expected RSS 2.0 or Atom)');
}

export async function fetchFeedEntries(
  feedUrl: string,
  count: number,
  enrichImages: boolean,
): Promise<ParsedFeedEntry[]> {
  const { status, text } = await fetchText(feedUrl);
  if (status < 200 || status >= 300) {
    throw new Error(`Feed ${feedUrl} returned HTTP ${status}`);
  }
  const entries = parseFeedXml(text, count, feedUrl);
  if (enrichImages) {
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.image) {
          entry.image = await fetchOgImage(entry.url);
        }
      }),
    );
  }
  return entries;
}

export function buildCardItem(
  sourceId: string,
  entry: ParsedFeedEntry,
  sourceLabel: string,
  durationSeconds: number,
  index: number,
): CardManifestItem {
  return {
    kind: 'card',
    id: `${sourceId}:${index}:${entry.url}`,
    url: entry.url,
    title: entry.title,
    summary: entry.summary,
    image: entry.image,
    sourceLabel,
    publishedAt: entry.publishedAt,
    author: entry.author,
    durationSeconds,
    sourceId,
  };
}

export interface EmbedCheckResult {
  embeddable: boolean;
  reason?: string;
  status?: number;
}

export function evaluateEmbedHeaders(headers: Headers): EmbedCheckResult {
  const xfo = headers.get('x-frame-options')?.trim().toUpperCase();
  if (xfo && (xfo.includes('DENY') || xfo.includes('SAMEORIGIN'))) {
    return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
  }
  const csp = headers.get('content-security-policy') ?? '';
  const directives = csp.split(';').map((d) => d.trim());
  for (const directive of directives) {
    if (directive.toLowerCase().startsWith('frame-ancestors')) {
      const value = directive.slice('frame-ancestors'.length).trim();
      if (value && value !== '*') {
        return { embeddable: false, reason: `CSP frame-ancestors: ${value}` };
      }
    }
  }
  return { embeddable: true };
}

export async function checkUrlEmbeddable(url: string): Promise<EmbedCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: controller.signal,
      });
    }
    const result = evaluateEmbedHeaders(res.headers);
    return { ...result, status: res.status };
  } catch (err) {
    return {
      embeddable: false,
      reason: `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
