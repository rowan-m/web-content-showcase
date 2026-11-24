import './styles.css';
import type { ManifestGroup, ManifestItem, ShowcaseManifest } from './types.js';

function tagForItem(item: ManifestItem): { label: string; cls: string } {
  if (item.kind === 'youtube') {
    return item.isShort ? { label: 'Short', cls: 'tag-short' } : { label: 'YouTube', cls: 'tag-youtube' };
  }
  if (item.kind === 'card') {
    return { label: 'RSS Card', cls: 'tag-card' };
  }
  return item.display === 'iframe'
    ? { label: 'Iframe', cls: 'tag-iframe' }
    : { label: 'Redirect', cls: 'tag-redirect' };
}

function durationForItem(item: ManifestItem): string {
  if (item.kind === 'youtube') {
    if (item.start || item.end) {
      return `${item.start ?? 0}s–${item.end ? `${item.end}s` : 'end'}`;
    }
    return 'auto (full)';
  }
  return `${item.durationSeconds}s`;
}

function itemUrl(item: ManifestItem): string {
  if (item.kind === 'youtube') {
    return item.isShort
      ? `https://www.youtube.com/shorts/${item.videoId}`
      : `https://www.youtube.com/watch?v=${item.videoId}`;
  }
  return item.url;
}

function buildPlaylistSnippet(baseUrl: string, group: ManifestGroup, defaultSeconds: number): string {
  const hasRedirect = group.items.some((i) => i.kind === 'web' && i.display === 'redirect');
  if (hasRedirect) {
    return [
      `${defaultSeconds}s ${baseUrl}next/?group=${encodeURIComponent(group.id)}&s=1`,
      `${defaultSeconds}s ${baseUrl}next/?group=${encodeURIComponent(group.id)}&s=2`,
    ].join('\n');
  }
  return `${baseUrl}?group=${encodeURIComponent(group.id)}`;
}

function renderGroup(group: ManifestGroup, baseUrl: string, defaultSeconds: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'group-card';

  const hasRedirect = group.items.some((i) => i.kind === 'web' && i.display === 'redirect');
  const playableCount = group.items.filter((i) => !(i.kind === 'web' && i.display === 'redirect')).length;

  const head = document.createElement('div');
  head.className = 'group-card-head';

  const left = document.createElement('div');
  const titleRow = document.createElement('div');
  titleRow.className = 'group-title-row';
  const h2 = document.createElement('h2');
  h2.textContent = group.id;
  const metaTag = document.createElement('span');
  metaTag.className = 'tag';
  metaTag.textContent = `${group.items.length} items · ${group.order}`;
  titleRow.append(h2, metaTag);
  left.appendChild(titleRow);

  if (group.description) {
    const desc = document.createElement('p');
    desc.className = 'group-desc';
    desc.textContent = group.description;
    left.appendChild(desc);
  }

  const actions = document.createElement('div');
  actions.className = 'group-actions';

  if (playableCount > 0) {
    const playBtn = document.createElement('a');
    playBtn.className = 'btn btn-primary';
    playBtn.href = `../?group=${encodeURIComponent(group.id)}&hud=1`;
    playBtn.textContent = hasRedirect ? `Play in-page (${playableCount})` : 'Play slideshow';
    actions.appendChild(playBtn);
  }

  const nextBtn = document.createElement('a');
  nextBtn.className = 'btn';
  nextBtn.href = `../next/?group=${encodeURIComponent(group.id)}&dry=1`;
  nextBtn.textContent = 'Test /next cursor';
  actions.appendChild(nextBtn);

  head.append(left, actions);
  card.appendChild(head);

  const table = document.createElement('table');
  table.className = 'item-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Title</th>
        <th>Mode</th>
        <th>Source</th>
        <th>Duration</th>
        <th></th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');

  group.items.forEach((item, index) => {
    const tr = document.createElement('tr');
    const tag = tagForItem(item);

    const numTd = document.createElement('td');
    numTd.className = 'item-source';
    numTd.textContent = String(index + 1);

    const titleTd = document.createElement('td');
    titleTd.className = 'item-title-cell';
    const a = document.createElement('a');
    a.href = itemUrl(item);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.title;
    titleTd.appendChild(a);

    const modeTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `tag ${tag.cls}`;
    badge.textContent = tag.label;
    modeTd.appendChild(badge);

    const sourceTd = document.createElement('td');
    sourceTd.className = 'item-source';
    sourceTd.textContent = item.sourceId;

    const durTd = document.createElement('td');
    durTd.className = 'item-source';
    durTd.textContent = durationForItem(item);

    const actionTd = document.createElement('td');
    if (!(item.kind === 'web' && item.display === 'redirect')) {
      const testLink = document.createElement('a');
      testLink.className = 'btn';
      testLink.style.padding = '4px 10px';
      testLink.style.fontSize = '0.8rem';
      testLink.href = `../?group=${encodeURIComponent(group.id)}&index=${index}&single=1&hud=1`;
      testLink.textContent = 'View';
      actionTd.appendChild(testLink);
    }

    tr.append(numTd, titleTd, modeTd, sourceTd, durTd, actionTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  card.appendChild(table);

  const snippetWrap = document.createElement('div');
  snippetWrap.className = 'snippet-box';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = hasRedirect
    ? 'Display playlist snippet (uses /next localStorage router)'
    : 'Direct display URL';
  const pre = document.createElement('pre');
  pre.textContent = buildPlaylistSnippet(baseUrl, group, defaultSeconds);
  details.append(summary, pre);
  snippetWrap.appendChild(details);
  card.appendChild(snippetWrap);

  return card;
}

async function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  const rootUrl = new URL(window.location.pathname.endsWith('/') ? '../' : './', window.location.href);
  const manifestUrl = new URL('manifest.json', rootUrl).toString();

  let manifest: ShowcaseManifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as ShowcaseManifest;
  } catch (err) {
    root.innerHTML = `
      <div class="status-screen">
        <div class="status-panel">
          <h1>Unable to load manifest</h1>
          <pre>${err instanceof Error ? err.message : String(err)}</pre>
        </div>
      </div>
    `;
    return;
  }

  const baseUrl = rootUrl.toString();
  const page = document.createElement('main');
  page.className = 'preview-page';

  const header = document.createElement('header');
  header.className = 'preview-header';
  const titleBlock = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.textContent = 'Web Content Showcase';
  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  meta.textContent = `Built ${new Date(manifest.generatedAt).toLocaleString()} · default duration ${manifest.defaultDurationSeconds}s · captions ${manifest.youtube.captions ? manifest.youtube.captionLang : 'off'}`;
  titleBlock.append(h1, meta);
  header.appendChild(titleBlock);
  page.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'group-grid';
  for (const group of Object.values(manifest.groups)) {
    grid.appendChild(renderGroup(group, baseUrl, manifest.defaultDurationSeconds));
  }
  page.appendChild(grid);

  root.innerHTML = '';
  root.appendChild(page);
}

void boot();
