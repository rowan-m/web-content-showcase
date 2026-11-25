import QRCode from 'qrcode';
import {
  buildYouTubeEmbedUrl,
  isInPagePlayable,
  parseMaxVideoParam,
  resolveEffectiveYouTubePlayback,
  resolveGroup,
  shuffleCopy,
} from './router.js';
import './styles.css';
import type { CardManifestItem, ManifestItem, ShowcaseManifest, YouTubeManifestItem } from './types.js';

interface YTPlayerInstance {
  destroy(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      events?: {
        onReady?: (ev: { target: YTPlayerInstance }) => void;
        onStateChange?: (ev: { data: number; target: YTPlayerInstance }) => void;
        onError?: (ev: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API loaded without YT.Player'));
      }
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function formatDate(raw: string | undefined): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDisplayUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return rawUrl;
  }
}

function renderStatus(title: string, bodyHtml: string) {
  const stage = document.getElementById('stage');
  if (!stage) return;
  document.body.classList.remove('kiosk-mode');
  stage.innerHTML = `
    <div class="status-screen">
      <div class="status-panel">
        <h1>${title}</h1>
        ${bodyHtml}
      </div>
    </div>
  `;
}

async function renderCard(item: CardManifestItem): Promise<HTMLElement> {
  const slide = document.createElement('article');
  slide.className = item.image ? 'slide card-slide' : 'slide card-slide no-image';

  const body = document.createElement('div');
  body.className = 'card-body';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const source = document.createElement('span');
  source.className = 'card-source';
  source.textContent = item.sourceLabel;
  meta.appendChild(source);

  const formattedDate = formatDate(item.publishedAt);
  if (formattedDate) {
    const dot = document.createElement('span');
    dot.className = 'card-dot';
    const time = document.createElement('time');
    time.textContent = formattedDate;
    meta.append(dot, time);
  }

  const copy = document.createElement('div');
  copy.className = 'card-copy';
  const heading = document.createElement('h1');
  heading.className = 'card-title';
  heading.textContent = item.title;
  copy.appendChild(heading);

  if (item.summary) {
    const summary = document.createElement('p');
    summary.className = 'card-summary';
    summary.textContent = item.summary;
    copy.appendChild(summary);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const qrBox = document.createElement('div');
  qrBox.className = 'card-qr';
  qrBox.setAttribute('aria-hidden', 'true');
  try {
    qrBox.innerHTML = await QRCode.toString(item.url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0e1116', light: '#ffffff' },
    });
  } catch {
    qrBox.style.display = 'none';
  }

  const linkInfo = document.createElement('div');
  linkInfo.className = 'card-link-info';
  const scanLabel = document.createElement('span');
  scanLabel.className = 'card-scan-label';
  scanLabel.textContent = 'Scan to read full article';
  const urlText = document.createElement('span');
  urlText.className = 'card-url';
  urlText.textContent = formatDisplayUrl(item.url);
  linkInfo.append(scanLabel, urlText);

  footer.append(qrBox, linkInfo);
  body.append(meta, copy, footer);
  slide.appendChild(body);

  if (item.image) {
    const media = document.createElement('div');
    media.className = 'card-media';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      media.remove();
      slide.classList.add('no-image');
    };
    media.appendChild(img);
    slide.appendChild(media);
  }

  return slide;
}

class ShowcasePlayer {
  private manifest: ShowcaseManifest;
  private groupId: string;
  private items: ManifestItem[];
  private currentIndex = 0;
  private singleMode: boolean;
  private maxVideoOverride: number | null | undefined;
  private paused = false;
  private timerHandle: number | null = null;
  private progressAnim: Animation | null = null;
  private activeYtPlayer: YTPlayerInstance | null = null;

  private stage = document.getElementById('stage')!;
  private progressTrack = document.getElementById('progress-track')!;
  private progressFill = document.getElementById('progress-fill')!;
  private hud = document.getElementById('hud')!;
  private hudText = document.getElementById('hud-text')!;

  constructor(
    manifest: ShowcaseManifest,
    groupId: string,
    items: ManifestItem[],
    startIndex: number,
    singleMode: boolean,
    showHud: boolean,
    maxVideoOverride?: number | null,
  ) {
    this.manifest = manifest;
    this.groupId = groupId;
    this.items = items;
    this.currentIndex = Math.max(0, Math.min(startIndex, items.length - 1));
    this.singleMode = singleMode;
    this.maxVideoOverride = maxVideoOverride;

    if (showHud) {
      this.hud.classList.add('is-visible');
      document.body.classList.add('cursor-active');
    }

    this.bindControls();
  }

  start() {
    void this.showCurrent();
  }

  private bindControls() {
    document.getElementById('hud-prev')?.addEventListener('click', () => this.step(-1));
    document.getElementById('hud-next')?.addEventListener('click', () => this.step(1));
    document.getElementById('hud-pause')?.addEventListener('click', () => this.togglePause());

    let cursorTimeout: number | null = null;
    window.addEventListener('mousemove', () => {
      document.body.classList.add('cursor-active');
      if (cursorTimeout !== null) window.clearTimeout(cursorTimeout);
      cursorTimeout = window.setTimeout(() => {
        if (!this.hud.classList.contains('is-visible')) {
          document.body.classList.remove('cursor-active');
        }
      }, 2500);
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === ' ') {
        ev.preventDefault();
        this.step(1);
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        this.step(-1);
      } else if (ev.key.toLowerCase() === 'p') {
        this.togglePause();
      } else if (ev.key.toLowerCase() === 'i') {
        this.hud.classList.toggle('is-visible');
      }
    });
  }

  private togglePause() {
    this.paused = !this.paused;
    const btn = document.getElementById('hud-pause');
    if (btn) btn.textContent = this.paused ? 'Resume' : 'Pause';
    if (this.paused) {
      this.clearTimers();
    } else {
      const item = this.items[this.currentIndex];
      if (item && item.kind !== 'youtube') {
        this.scheduleAdvance(item.durationSeconds);
      }
    }
  }

  private step(delta: number) {
    if (this.items.length === 0) return;
    this.singleMode = false;
    this.currentIndex = (this.currentIndex + delta + this.items.length) % this.items.length;
    void this.showCurrent();
  }

  private clearTimers() {
    if (this.timerHandle !== null) {
      window.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.progressAnim) {
      this.progressAnim.cancel();
      this.progressAnim = null;
    }
    this.progressFill.style.width = '0%';
  }

  private cleanupPlayer() {
    this.clearTimers();
    if (this.activeYtPlayer) {
      try {
        this.activeYtPlayer.destroy();
      } catch {
        // Ignore teardown errors on already-removed frames
      }
      this.activeYtPlayer = null;
    }
  }

  private scheduleAdvance(durationSeconds: number) {
    this.clearTimers();
    if (this.singleMode || this.items.length <= 1) {
      this.progressTrack.classList.add('is-hidden');
      return;
    }
    this.progressTrack.classList.remove('is-hidden');
    const ms = Math.max(1000, durationSeconds * 1000);
    this.progressAnim = this.progressFill.animate([{ width: '0%' }, { width: '100%' }], {
      duration: ms,
      easing: 'linear',
      fill: 'forwards',
    });
    if (!this.paused) {
      this.timerHandle = window.setTimeout(() => {
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        void this.showCurrent();
      }, ms);
    }
  }

  private updateHud(item: ManifestItem) {
    const label = `${this.groupId} · ${this.currentIndex + 1}/${this.items.length} · ${item.title}`;
    this.hudText.textContent = label;
    document.title = `${item.title} — Showcase`;
  }

  private async showCurrent() {
    this.cleanupPlayer();
    const item = this.items[this.currentIndex];
    if (!item) return;

    this.updateHud(item);

    let slide: HTMLElement;
    if (item.kind === 'card') {
      slide = await renderCard(item);
      this.mountSlide(slide);
      this.scheduleAdvance(item.durationSeconds);
    } else if (item.kind === 'web') {
      slide = document.createElement('div');
      slide.className = 'slide';
      const iframe = document.createElement('iframe');
      iframe.className = 'full-iframe is-web';
      iframe.src = item.url;
      iframe.title = item.title;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      slide.appendChild(iframe);
      this.mountSlide(slide);
      this.scheduleAdvance(item.durationSeconds);
    } else {
      this.progressTrack.classList.add('is-hidden');
      slide = this.buildYouTubeSlide(item);
      this.mountSlide(slide);
      this.attachYouTubeController(slide, item);
    }
  }

  private mountSlide(slide: HTMLElement) {
    this.stage.innerHTML = '';
    this.stage.appendChild(slide);
    requestAnimationFrame(() => slide.classList.add('is-visible'));
  }

  private buildYouTubeSlide(item: YouTubeManifestItem): HTMLElement {
    const loopSingle = this.singleMode || this.items.length === 1;
    const playback = resolveEffectiveYouTubePlayback(item, this.maxVideoOverride);
    const src = buildYouTubeEmbedUrl(item.videoId, {
      mute: this.manifest.youtube.mute,
      captions: this.manifest.youtube.captions,
      captionLang: this.manifest.youtube.captionLang,
      controls: this.manifest.youtube.controls,
      loopSingle,
      start: playback.start > 0 ? playback.start : undefined,
      end: playback.end,
      origin: window.location.origin,
      enableJsApi: true,
    });

    const iframe = document.createElement('iframe');
    iframe.id = 'yt-player';
    iframe.src = src;
    iframe.title = item.title;
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');

    if (item.isShort) {
      const slide = document.createElement('div');
      slide.className = 'slide shorts-stage';

      if (item.thumbnail) {
        const bg = document.createElement('div');
        bg.className = 'shorts-backdrop';
        bg.style.backgroundImage = `url("${item.thumbnail}")`;
        slide.appendChild(bg);
      }

      const wrap = document.createElement('div');
      wrap.className = 'shorts-frame-wrap';
      wrap.appendChild(iframe);
      slide.appendChild(wrap);

      const caption = document.createElement('div');
      caption.className = 'shorts-caption';
      const kicker = document.createElement('p');
      kicker.className = 'shorts-caption-kicker';
      kicker.textContent = item.channel ? `${item.channel} · Short` : 'Short';
      const title = document.createElement('h1');
      title.className = 'shorts-caption-title';
      title.textContent = item.title;
      caption.append(kicker, title);
      slide.appendChild(caption);
      return slide;
    }

    const slide = document.createElement('div');
    slide.className = 'slide';
    iframe.className = 'full-iframe';
    slide.appendChild(iframe);
    return slide;
  }

  private attachYouTubeController(slide: HTMLElement, item: YouTubeManifestItem) {
    const iframe = slide.querySelector<HTMLIFrameElement>('#yt-player');
    if (!iframe) return;

    const playback = resolveEffectiveYouTubePlayback(item, this.maxVideoOverride);

    const advanceNow = () => {
      if (this.singleMode || this.items.length <= 1) {
        if (this.activeYtPlayer) {
          this.activeYtPlayer.seekTo(playback.start, true);
          this.activeYtPlayer.playVideo();
        }
        return;
      }
      if (!this.paused) {
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        void this.showCurrent();
      }
    };

    const armFallbackTimer = (extraBufferSeconds: number) => {
      if (this.singleMode || this.items.length <= 1 || playback.fallbackLimitSeconds === null || this.paused) {
        return;
      }
      if (this.timerHandle !== null) {
        window.clearTimeout(this.timerHandle);
      }
      this.timerHandle = window.setTimeout(
        advanceNow,
        (playback.fallbackLimitSeconds + extraBufferSeconds) * 1000,
      );
    };

    // Fallback safety timer in case the IFrame API fails to load or ENDED doesn't fire.
    armFallbackTimer(10);

    void loadYouTubeApi()
      .then((YT) => {
        if (!document.body.contains(iframe)) return;
        this.activeYtPlayer = new YT.Player(iframe, {
          events: {
            onReady: (ev) => {
              ev.target.playVideo();
            },
            onStateChange: (ev) => {
              if (ev.data === YT.PlayerState.PLAYING) {
                armFallbackTimer(5);
              } else if (ev.data === YT.PlayerState.ENDED) {
                advanceNow();
              }
            },
            onError: () => {
              // Skip broken or restricted videos rather than stalling the display.
              if (!this.singleMode && this.items.length > 1) {
                if (this.timerHandle !== null) window.clearTimeout(this.timerHandle);
                this.timerHandle = window.setTimeout(advanceNow, 3000);
              }
            },
          },
        });
      })
      .catch(() => {
        // Iframe still plays via URL query parameters; fallback timer handles advancing.
      });
  }
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const requestedGroup = params.get('group');
  const singleMode = params.get('single') === '1';
  const showHud = params.get('hud') === '1';
  const orderOverride = params.get('order');
  const explicitIndex = params.get('index');
  const maxVideoOverride = parseMaxVideoParam(params.get('maxVideo'));

  let manifest: ShowcaseManifest;
  try {
    const res = await fetch('./manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as ShowcaseManifest;
  } catch (err) {
    renderStatus(
      'Unable to load showcase manifest',
      `<p>Expected <code>./manifest.json</code> to be built and deployed alongside the player.</p>
       <pre>${err instanceof Error ? err.message : String(err)}</pre>`,
    );
    return;
  }

  const group = resolveGroup(manifest, requestedGroup);

  if (singleMode && explicitIndex !== null) {
    const idx = Number.parseInt(explicitIndex, 10);
    const item = group.items[idx];
    if (!item) {
      renderStatus(
        'Item not found',
        `<p>Group <code>${group.id}</code> has no item at index <code>${explicitIndex}</code>.</p>
         <a class="btn btn-primary" href="./preview/">Open Preview</a>`,
      );
      return;
    }
    if (item.kind === 'web' && item.display === 'redirect') {
      window.location.replace(item.url);
      return;
    }
    const player = new ShowcasePlayer(manifest, group.id, [item], 0, true, showHud, maxVideoOverride);
    player.start();
    return;
  }

  const playable = group.items.filter(isInPagePlayable);
  if (playable.length === 0) {
    renderStatus(
      `Group "${group.id}" uses top-level redirects`,
      `<p>Every item in <code>${group.id}</code> blocks iframe embedding and must be opened via the persistent <code>/next</code> router.</p>
       <p><a class="btn btn-primary" href="./next/?group=${encodeURIComponent(group.id)}">Open /next?group=${group.id}</a>
       <a class="btn" href="./preview/">View all groups</a></p>`,
    );
    return;
  }

  const effectiveOrder =
    orderOverride === 'random' || orderOverride === 'sequential' ? orderOverride : group.order;
  const queue = effectiveOrder === 'random' ? shuffleCopy(playable) : playable;
  const startIndex = explicitIndex !== null ? Number.parseInt(explicitIndex, 10) || 0 : 0;

  const player = new ShowcasePlayer(manifest, group.id, queue, startIndex, false, showHud, maxVideoOverride);
  player.start();
}

void boot();
