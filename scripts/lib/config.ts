import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const DURATION_RE = /^(\d+)(s|m|h)$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseDurationSeconds(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Invalid duration: ${value} (must be a positive integer)`);
    }
    return value;
  }
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" (expected e.g. "10s", "2m", "1h", or seconds)`);
  }
  const amount = Number.parseInt(match[1], 10);
  if (amount < 1) {
    throw new Error(`Duration must be at least 1 second: "${value}"`);
  }
  switch (match[2]) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    default:
      return amount;
  }
}

export function extractYouTubeId(input: string): string {
  const trimmed = input.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) {
    return trimmed;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid YouTube video ID or URL: "${input}"`);
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    if (YOUTUBE_ID_RE.test(id)) return id;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = parsed.searchParams.get('v');
    if (v && YOUTUBE_ID_RE.test(v)) return v;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if ((segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') && segments[1]) {
      if (YOUTUBE_ID_RE.test(segments[1])) return segments[1];
    }
  }

  throw new Error(`Could not extract an 11-character YouTube video ID from "${input}"`);
}

const DurationSchema = z.union([z.number().int().positive(), z.string().regex(DURATION_RE)]).transform(parseDurationSeconds);

const HttpUrlSchema = z.string().url().refine(
  (u) => u.startsWith('https://') || u.startsWith('http://'),
  'URL must use http:// or https://',
);

const SettingsSchema = z.object({
  duration: DurationSchema.default(40),
  defaultGroup: z.string().min(1).default('web'),
  youtube: z.object({
    mute: z.boolean().default(true),
    captions: z.boolean().default(true),
    captionLang: z.string().min(2).default('en'),
    controls: z.boolean().default(false),
  }).default({ mute: true, captions: true, captionLang: 'en', controls: false }),
});

const YouTubeVideoEntrySchema = z.union([
  z.string().min(1).transform((raw) => ({
    id: extractYouTubeId(raw),
    title: undefined as string | undefined,
    start: undefined as number | undefined,
    end: undefined as number | undefined,
    isShort: undefined as boolean | undefined,
  })),
  z.object({
    id: z.string().min(1).transform(extractYouTubeId),
    title: z.string().min(1).optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().positive().optional(),
    isShort: z.boolean().optional(),
  }).refine(
    (entry) => entry.start === undefined || entry.end === undefined || entry.end > entry.start,
    'Video end time must be greater than start time',
  ),
]);

const YouTubeChannelSourceSchema = z.object({
  handle: z.string().regex(/^@?[A-Za-z0-9._-]+$/).optional(),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]+$/).optional(),
  kind: z.enum(['videos', 'shorts']).default('videos'),
  count: z.number().int().min(1).max(15).default(5),
}).refine(
  (src) => Boolean(src.handle || src.channelId),
  'YouTube channel source must specify either handle or channelId',
);

const YouTubeListSourceSchema = z.object({
  videos: z.array(YouTubeVideoEntrySchema).min(1),
});

const YouTubeSourceSchema = z.union([YouTubeListSourceSchema, YouTubeChannelSourceSchema]);
const YouTubeFileSchema = z.record(z.string().min(1), YouTubeSourceSchema).default({});

const FeedSourceSchema = z.object({
  url: HttpUrlSchema,
  label: z.string().min(1).optional(),
  count: z.number().int().min(1).max(25).default(5),
  display: z.enum(['card', 'redirect']).default('card'),
  duration: DurationSchema.optional(),
});
const FeedsFileSchema = z.record(z.string().min(1), FeedSourceSchema).default({});

const UrlEntrySchema = z.union([
  HttpUrlSchema.transform((url) => ({
    url,
    title: undefined as string | undefined,
    display: 'auto' as const,
    duration: undefined as number | undefined,
  })),
  z.object({
    url: HttpUrlSchema,
    title: z.string().min(1).optional(),
    display: z.enum(['auto', 'iframe', 'redirect']).default('auto'),
    duration: DurationSchema.optional(),
  }),
]);
const UrlsFileSchema = z.record(z.string().min(1), z.array(UrlEntrySchema).min(1)).default({});

const GroupSchema = z.object({
  description: z.string().default(''),
  order: z.enum(['sequential', 'random']).default('sequential'),
  sources: z.array(z.string().min(1)).min(1),
});
const GroupsFileSchema = z.record(z.string().min(1), GroupSchema);

export type SettingsConfig = z.infer<typeof SettingsSchema>;
export type YouTubeSourceConfig = z.infer<typeof YouTubeSourceSchema>;
export type FeedSourceConfig = z.infer<typeof FeedSourceSchema>;
export type UrlEntryConfig = z.infer<typeof UrlEntrySchema>;
export type GroupConfig = z.infer<typeof GroupSchema>;

export interface LoadedConfig {
  settings: SettingsConfig;
  youtube: Record<string, YouTubeSourceConfig>;
  feeds: Record<string, FeedSourceConfig>;
  urls: Record<string, UrlEntryConfig[]>;
  groups: Record<string, GroupConfig>;
}

function readYamlFile(path: string, required: boolean): unknown {
  if (!existsSync(path)) {
    if (required) {
      throw new Error(`Missing required config file: ${path}`);
    }
    return {};
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw);
  return parsed ?? {};
}

function formatZodError(filename: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid config in ${filename}:\n${lines.join('\n')}`;
}

export function loadConfig(configDir = join(process.cwd(), 'config')): LoadedConfig {
  const settingsRaw = readYamlFile(join(configDir, 'settings.yaml'), true);
  const youtubeRaw = readYamlFile(join(configDir, 'youtube.yaml'), false);
  const feedsRaw = readYamlFile(join(configDir, 'feeds.yaml'), false);
  const urlsRaw = readYamlFile(join(configDir, 'urls.yaml'), false);
  const groupsRaw = readYamlFile(join(configDir, 'groups.yaml'), true);

  const settingsRes = SettingsSchema.safeParse(settingsRaw);
  if (!settingsRes.success) throw new Error(formatZodError('config/settings.yaml', settingsRes.error));

  const youtubeRes = YouTubeFileSchema.safeParse(youtubeRaw);
  if (!youtubeRes.success) throw new Error(formatZodError('config/youtube.yaml', youtubeRes.error));

  const feedsRes = FeedsFileSchema.safeParse(feedsRaw);
  if (!feedsRes.success) throw new Error(formatZodError('config/feeds.yaml', feedsRes.error));

  const urlsRes = UrlsFileSchema.safeParse(urlsRaw);
  if (!urlsRes.success) throw new Error(formatZodError('config/urls.yaml', urlsRes.error));

  const groupsRes = GroupsFileSchema.safeParse(groupsRaw);
  if (!groupsRes.success) throw new Error(formatZodError('config/groups.yaml', groupsRes.error));

  const seenSources = new Map<string, string>();
  const registerSource = (id: string, file: string) => {
    const existing = seenSources.get(id);
    if (existing) {
      throw new Error(`Duplicate source ID "${id}" defined in both ${existing} and ${file}`);
    }
    seenSources.set(id, file);
  };

  for (const id of Object.keys(youtubeRes.data)) registerSource(id, 'config/youtube.yaml');
  for (const id of Object.keys(feedsRes.data)) registerSource(id, 'config/feeds.yaml');
  for (const id of Object.keys(urlsRes.data)) registerSource(id, 'config/urls.yaml');

  const groups = groupsRes.data;
  if (Object.keys(groups).length === 0) {
    throw new Error('config/groups.yaml must define at least one group');
  }

  for (const [groupId, group] of Object.entries(groups)) {
    for (const sourceId of group.sources) {
      if (!seenSources.has(sourceId)) {
        throw new Error(
          `Group "${groupId}" in config/groups.yaml references unknown source "${sourceId}"`,
        );
      }
    }
  }

  if (!groups[settingsRes.data.defaultGroup]) {
    throw new Error(
      `defaultGroup "${settingsRes.data.defaultGroup}" in config/settings.yaml does not exist in config/groups.yaml`,
    );
  }

  return {
    settings: settingsRes.data,
    youtube: youtubeRes.data,
    feeds: feedsRes.data,
    urls: urlsRes.data,
    groups,
  };
}
