export interface YouTubeDefaults {
  mute: boolean;
  captions: boolean;
  captionLang: string;
  controls: boolean;
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
  sourceId: string;
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
}

export type ManifestItem = YouTubeManifestItem | CardManifestItem | WebManifestItem;

export interface ManifestGroup {
  id: string;
  description: string;
  order: 'sequential' | 'random';
  items: ManifestItem[];
}

export interface ShowcaseManifest {
  generatedAt: string;
  defaultGroup: string;
  defaultDurationSeconds: number;
  youtube: YouTubeDefaults;
  groups: Record<string, ManifestGroup>;
}
