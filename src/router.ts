import type { ManifestGroup, ManifestItem, ShowcaseManifest, YouTubeManifestItem } from './types.js';

export function parseMaxVideoParam(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === '0' || normalized === '0s' || normalized === 'none' || normalized === 'unlimited' || normalized === 'false') {
    return null;
  }
  const match = /^(\d+)(s|m|h)?$/.exec(normalized);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount < 1) return undefined;
  switch (match[2]) {
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    default:
      return amount;
  }
}

export interface EffectiveYouTubePlayback {
  start: number;
  end: number | undefined;
  maxDurationSeconds: number | null;
  fallbackLimitSeconds: number | null;
}

export function resolveEffectiveYouTubePlayback(
  item: Pick<YouTubeManifestItem, 'start' | 'end' | 'maxDurationSeconds'>,
  urlMaxOverride?: number | null,
): EffectiveYouTubePlayback {
  const start = item.start ?? 0;
  const maxDurationSeconds = urlMaxOverride !== undefined ? urlMaxOverride : item.maxDurationSeconds;
  const capEnd = maxDurationSeconds !== null ? start + maxDurationSeconds : undefined;

  let end: number | undefined;
  if (item.end !== undefined && capEnd !== undefined) {
    end = Math.min(item.end, capEnd);
  } else {
    end = item.end ?? capEnd;
  }

  const fallbackLimitSeconds = end !== undefined ? Math.max(1, end - start) : null;
  return { start, end, maxDurationSeconds, fallbackLimitSeconds };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function selectNextIndex(
  storage: StorageLike,
  groupId: string,
  itemCount: number,
  order: 'sequential' | 'random',
  rng: () => number = Math.random,
): number {
  if (itemCount <= 0) return -1;
  if (itemCount === 1) {
    storage.setItem(`showcase:idx:${groupId}`, '0');
    return 0;
  }

  const key = `showcase:idx:${groupId}`;
  const rawPrev = storage.getItem(key);
  const prev = rawPrev !== null ? Number.parseInt(rawPrev, 10) : Number.NaN;
  const hasValidPrev = Number.isInteger(prev) && prev >= 0 && prev < itemCount;

  let next: number;
  if (order === 'random') {
    if (!hasValidPrev) {
      next = Math.floor(rng() * itemCount);
    } else {
      // Pick uniformly among the (itemCount - 1) other items so nothing repeats back-to-back.
      const offset = 1 + Math.floor(rng() * (itemCount - 1));
      next = (prev + offset) % itemCount;
    }
  } else {
    next = hasValidPrev ? (prev + 1) % itemCount : 0;
  }

  storage.setItem(key, String(next));
  return next;
}

export function resetGroupCursor(storage: StorageLike, groupId: string): void {
  storage.removeItem(`showcase:idx:${groupId}`);
}

export function resolveGroup(manifest: ShowcaseManifest, requestedGroup: string | null): ManifestGroup {
  const id = requestedGroup && manifest.groups[requestedGroup] ? requestedGroup : manifest.defaultGroup;
  const group = manifest.groups[id];
  if (!group) {
    const first = Object.values(manifest.groups)[0];
    if (!first) {
      throw new Error('Manifest contains no configured groups');
    }
    return first;
  }
  return group;
}

export function shuffleCopy<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildYouTubeEmbedUrl(
  videoId: string,
  options: {
    mute: boolean;
    captions: boolean;
    captionLang: string;
    controls: boolean;
    loopSingle?: boolean;
    start?: number;
    end?: number;
    origin?: string;
    enableJsApi?: boolean;
  },
): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: options.mute ? '1' : '0',
    controls: options.controls ? '1' : '0',
    iv_load_policy: '3',
    rel: '0',
    playsinline: '1',
  });
  if (options.captions) {
    params.set('cc_load_policy', '1');
    params.set('cc_lang_pref', options.captionLang);
  }
  if (options.loopSingle) {
    params.set('loop', '1');
    params.set('playlist', videoId);
  }
  if (options.start !== undefined && options.start > 0) {
    params.set('start', String(options.start));
  }
  if (options.end !== undefined && options.end > 0) {
    params.set('end', String(options.end));
  }
  if (options.enableJsApi) {
    params.set('enablejsapi', '1');
    if (options.origin && options.origin.startsWith('http')) {
      params.set('origin', options.origin);
    }
  }
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export function isInPagePlayable(item: ManifestItem): boolean {
  if (item.kind === 'web' && item.display === 'redirect') return false;
  return true;
}
