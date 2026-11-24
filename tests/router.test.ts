import { describe, expect, it } from 'vitest';
import { buildYouTubeEmbedUrl, selectNextIndex, type StorageLike } from '../src/router.js';

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
