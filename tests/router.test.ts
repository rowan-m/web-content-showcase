import { describe, expect, it } from 'vitest';
import {
  buildYouTubeEmbedUrl,
  parseMaxVideoParam,
  resolveEffectiveYouTubePlayback,
  selectNextIndex,
  type StorageLike,
} from '../src/router.js';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

describe('selectNextIndex', () => {
  it('advances sequentially and wraps cleanly', () => {
    const storage = createMemoryStorage();
    expect(selectNextIndex(storage, 'web', 3, 'sequential')).toBe(0);
    expect(selectNextIndex(storage, 'web', 3, 'sequential')).toBe(1);
    expect(selectNextIndex(storage, 'web', 3, 'sequential')).toBe(2);
    expect(selectNextIndex(storage, 'web', 3, 'sequential')).toBe(0);
  });

  it('never repeats the previous index in random mode', () => {
    const storage = createMemoryStorage();
    let prev = selectNextIndex(storage, 'mix', 4, 'random', () => 0.1);
    for (let i = 0; i < 20; i += 1) {
      const next = selectNextIndex(storage, 'mix', 4, 'random', () => (i * 0.17) % 1);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

describe('buildYouTubeEmbedUrl', () => {
  it('builds a muted, captioned, autoplay embed URL with optional end trim and single-loop', () => {
    const url = new URL(
      buildYouTubeEmbedUrl('10oHjdwUIxo', {
        mute: true,
        captions: true,
        captionLang: 'en',
        controls: false,
        loopSingle: true,
        end: 1287,
        enableJsApi: true,
        origin: 'https://example.com',
      }),
    );
    expect(url.pathname).toBe('/embed/10oHjdwUIxo');
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.get('mute')).toBe('1');
    expect(url.searchParams.get('cc_load_policy')).toBe('1');
    expect(url.searchParams.get('cc_lang_pref')).toBe('en');
    expect(url.searchParams.get('controls')).toBe('0');
    expect(url.searchParams.get('loop')).toBe('1');
    expect(url.searchParams.get('playlist')).toBe('10oHjdwUIxo');
    expect(url.searchParams.get('end')).toBe('1287');
    expect(url.searchParams.get('rel')).toBe('0');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
  });
});

describe('parseMaxVideoParam & resolveEffectiveYouTubePlayback', () => {
  it('parses URL override durations and unlimited tokens', () => {
    expect(parseMaxVideoParam(null)).toBeUndefined();
    expect(parseMaxVideoParam('5m')).toBe(300);
    expect(parseMaxVideoParam('90s')).toBe(90);
    expect(parseMaxVideoParam('120')).toBe(120);
    expect(parseMaxVideoParam('0')).toBeNull();
    expect(parseMaxVideoParam('none')).toBeNull();
    expect(parseMaxVideoParam('false')).toBeNull();
    expect(parseMaxVideoParam('invalid')).toBeUndefined();
  });

  it('caps playback at start + maxDuration and respects explicit end trim & URL overrides', () => {
    expect(resolveEffectiveYouTubePlayback({ maxDurationSeconds: 300 })).toEqual({
      start: 0,
      end: 300,
      maxDurationSeconds: 300,
      fallbackLimitSeconds: 300,
    });

    // Respects earlier explicit end trim
    expect(resolveEffectiveYouTubePlayback({ start: 10, end: 120, maxDurationSeconds: 300 })).toEqual({
      start: 10,
      end: 120,
      maxDurationSeconds: 300,
      fallbackLimitSeconds: 110,
    });

    // Clamps longer explicit end trim when maxDuration is active
    expect(resolveEffectiveYouTubePlayback({ end: 1287, maxDurationSeconds: 300 })).toEqual({
      start: 0,
      end: 300,
      maxDurationSeconds: 300,
      fallbackLimitSeconds: 300,
    });

    // URL override of null disables the cap so explicit end trim takes effect
    expect(resolveEffectiveYouTubePlayback({ end: 1287, maxDurationSeconds: 300 }, null)).toEqual({
      start: 0,
      end: 1287,
      maxDurationSeconds: null,
      fallbackLimitSeconds: 1287,
    });

    // Unlimited video without end trim has no fallback limit
    expect(resolveEffectiveYouTubePlayback({ maxDurationSeconds: null })).toEqual({
      start: 0,
      end: undefined,
      maxDurationSeconds: null,
      fallbackLimitSeconds: null,
    });
  });
});
