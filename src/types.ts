export interface YouTubeDefaults {
  mute: boolean;
  captions: boolean;
  captionLang: string;
  controls: boolean;
  maxDurationSeconds: number | null;
}

export interface YouTubeManifestItem {
  kind: 'youtube';
  id: string;
  videoId: string;
  isShort: boolean;
  title: string;
  channel?: string;
  publishedAt?: string;
  thumbnail?: string;
  start?: number;
  end?: number;
  maxDurationSeconds: number | null;
  sourceId: string;
  configFile?: string;
  configLine?: number;
}

export interface CardManifestItem {
  kind: 'card';
  id: string;
  url: string;
  title: string;
  summary?: string;
  image?: string;
  sourceLabel: string;
  publishedAt?: string;
  author?: string;
  durationSeconds: number;
  sourceId: string;
  configFile?: string;
  configLine?: number;
}

export interface WebManifestItem {
  kind: 'web';
  id: string;
  url: string;
  title: string;
  display: 'iframe' | 'redirect';
  durationSeconds: number;
  sourceId: string;
  embeddable?: boolean;
  configFile?: string;
  configLine?: number;
}

export type ManifestItem = YouTubeManifestItem | CardManifestItem | WebManifestItem;

export interface ManifestGroup {
  id: string;
  description: string;
  order: 'sequential' | 'random';
  configFile?: string;
  configLine?: number;
  items: ManifestItem[];
}

export interface ShowcaseManifest {
  generatedAt: string;
  repoUrl?: string;
  defaultGroup: string;
  defaultDurationSeconds: number;
  youtube: YouTubeDefaults;
  groups: Record<string, ManifestGroup>;
}
