import { describe, expect, it } from 'vitest';
import {
  extractYouTubeId,
  loadConfig,
  parseDurationSeconds,
  parseOptionalMaxDuration,
} from '../scripts/lib/config.js';
import { evaluateEmbedHeaders, parseFeedXml, stripHtmlToExcerpt } from '../scripts/lib/fetchers.js';

describe('parseDurationSeconds', () => {
  it('parses s/m/h strings and positive integers', () => {
    expect(parseDurationSeconds('10s')).toBe(10);
    expect(parseDurationSeconds('2m')).toBe(120);
    expect(parseDurationSeconds('1h')).toBe(3600);
    expect(parseDurationSeconds(45)).toBe(45);
  });

  it('rejects invalid duration values', () => {
    expect(() => parseDurationSeconds('0s')).toThrow();
    expect(() => parseDurationSeconds('abc')).toThrow();
    expect(() => parseDurationSeconds(-5)).toThrow();
  });
});

describe('extractYouTubeId', () => {
  it('extracts IDs from bare IDs and common YouTube URL formats', () => {
    expect(extractYouTubeId('H2naJinRzDA')).toBe('H2naJinRzDA');
    expect(extractYouTubeId('https://www.youtube.com/watch?v=lUHN48dhACY&t=12')).toBe('lUHN48dhACY');
    expect(extractYouTubeId('https://youtu.be/2xdV-xut7EQ')).toBe('2xdV-xut7EQ');
    expect(extractYouTubeId('https://www.youtube.com/embed/3BmYR--3z8M?autoplay=1')).toBe('3BmYR--3z8M');
    expect(extractYouTubeId('https://www.youtube.com/shorts/FITK1JK5bg4')).toBe('FITK1JK5bg4');
  });

  it('throws on invalid video inputs', () => {
    expect(() => extractYouTubeId('too-short')).toThrow();
    expect(() => extractYouTubeId('invalid!id!')).toThrow();
    expect(() => extractYouTubeId('https://example.com/watch?v=123')).toThrow();
  });
});

describe('evaluateEmbedHeaders', () => {
  it('detects blocked headers and allows open headers', () => {
    expect(evaluateEmbedHeaders(new Headers({ 'X-Frame-Options': 'DENY' })).embeddable).toBe(false);
    expect(evaluateEmbedHeaders(new Headers({ 'X-Frame-Options': 'SAMEORIGIN' })).embeddable).toBe(false);
    expect(
      evaluateEmbedHeaders(new Headers({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" }))
        .embeddable,
    ).toBe(false);
    expect(evaluateEmbedHeaders(new Headers({})).embeddable).toBe(true);
  });
});

describe('parseFeedXml & stripHtmlToExcerpt', () => {
  it('parses RSS 2.0 feeds and strips HTML tags', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Test Blog</title>
        <item>
          <title>Hello &amp; Welcome</title>
          <link>https://example.com/post-1</link>
          <description>&lt;p&gt;First &lt;strong&gt;paragraph&lt;/strong&gt; here.&lt;/p&gt;</description>
          <pubDate>Tue, 06 Oct 2026 07:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
    const entries = parseFeedXml(xml, 5);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Hello & Welcome');
    expect(entries[0].summary).toBe('First paragraph here.');
  });

  it('truncates long excerpts on a word boundary', () => {
    const long = `<p>${'word '.repeat(80)}</p>`;
    const excerpt = stripHtmlToExcerpt(long, 50);
    expect(excerpt.length).toBeLessThanOrEqual(52);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('parseOptionalMaxDuration', () => {
  it('parses duration caps and disable values', () => {
    expect(parseOptionalMaxDuration('5m')).toBe(300);
    expect(parseOptionalMaxDuration('90s')).toBe(90);
    expect(parseOptionalMaxDuration(600)).toBe(600);
    expect(parseOptionalMaxDuration(false)).toBeNull();
    expect(parseOptionalMaxDuration(null)).toBeNull();
    expect(parseOptionalMaxDuration(0)).toBeNull();
    expect(parseOptionalMaxDuration('none')).toBeNull();
    expect(parseOptionalMaxDuration('unlimited')).toBeNull();
  });

  it('rejects true', () => {
    expect(() => parseOptionalMaxDuration(true)).toThrow();
  });
});

describe('repository config', () => {
  it('loads and validates the checked-in config/ files cleanly', () => {
    const config = loadConfig();
    expect(config.settings.duration).toBe(40);
    expect(config.settings.youtube.maxDuration).toBe(300);
    expect(Object.keys(config.groups)).toContain('web');
    expect(Object.keys(config.groups)).toContain('videos');
    expect(Object.keys(config.groups)).toContain('shorts');
  });
});
