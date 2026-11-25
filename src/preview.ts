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

function formatSecondsShort(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function durationForItem(item: ManifestItem): string {
  if (item.kind === 'youtube') {
    const start = item.start ?? 0;
    const capEnd = item.maxDurationSeconds !== null ? start + item.maxDurationSeconds : undefined;
    const effectiveEnd =
      item.end !== undefined && capEnd !== undefined ? Math.min(item.end, capEnd) : (item.end ?? capEnd);

    if (item.start || item.end) {
      return `${start}s–${effectiveEnd !== undefined ? `${effectiveEnd}s` : 'end'}`;
    }
    if (item.maxDurationSeconds !== null) {
      return `max ${formatSecondsShort(item.maxDurationSeconds)}`;
    }
    return 'full video';
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

function githubFileUrl(repoUrl: string | undefined, filePath: string | undefined, line?: number): string | null {
  if (!repoUrl || !filePath) return null;
  const cleanRepo = repoUrl.replace(/\/$/, '');
  const cleanFile = filePath.replace(/^\//, '');
  return `${cleanRepo}/blob/main/${cleanFile}${line ? `#L${line}` : ''}`;
}

const CONFIG_SHORTCUTS: Array<{ file: string; label: string; desc: string }> = [
  { file: 'config/youtube.yaml', label: 'youtube.yaml', desc: 'YouTube channels, Shorts & curated videos' },
  { file: 'config/feeds.yaml', label: 'feeds.yaml', desc: 'RSS / Atom blog feeds' },
  { file: 'config/urls.yaml', label: 'urls.yaml', desc: 'Explicit web pages & interstitials' },
  { file: 'config/groups.yaml', label: 'groups.yaml', desc: 'Display groups & playlists' },
  { file: 'config/settings.yaml', label: 'settings.yaml', desc: 'Global timing & player defaults' },
];

function renderContributeBar(repoUrl: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'contribute-bar';
  section.setAttribute('aria-label', 'Edit configuration files on GitHub');

  const top = document.createElement('div');
  top.className = 'contribute-head';
  const heading = document.createElement('h2');
  heading.textContent = 'Add or edit content via Pull Request';
  const repoLink = document.createElement('a');
  repoLink.className = 'btn';
  repoLink.href = repoUrl;
  repoLink.target = '_blank';
  repoLink.rel = 'noopener noreferrer';
  repoLink.textContent = 'Open repository on GitHub ↗';
  top.append(heading, repoLink);
  section.appendChild(top);

  const list = document.createElement('div');
  list.className = 'config-links';
  for (const item of CONFIG_SHORTCUTS) {
    const a = document.createElement('a');
    a.className = 'config-link-card';
    a.href = githubFileUrl(repoUrl, item.file) ?? repoUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const name = document.createElement('span');
    name.className = 'config-link-name';
    name.textContent = item.label;

    const desc = document.createElement('span');
    desc.className = 'config-link-desc';
    desc.textContent = item.desc;

    a.append(name, desc);
    list.appendChild(a);
  }
  section.appendChild(list);
  return section;
}

function renderGroup(
  group: ManifestGroup,
  baseUrl: string,
  defaultSeconds: number,
  repoUrl?: string,
): HTMLElement {
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

  const editGroupHref = githubFileUrl(repoUrl, group.configFile ?? 'config/groups.yaml', group.configLine);
  if (editGroupHref) {
    const editBtn = document.createElement('a');
    editBtn.className = 'btn';
    editBtn.href = editGroupHref;
    editBtn.target = '_blank';
    editBtn.rel = 'noopener noreferrer';
    editBtn.textContent = 'Edit group ↗';
    editBtn.title = `Edit "${group.id}" in config/groups.yaml`;
    actions.appendChild(editBtn);
  }

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
    const sourceHref = githubFileUrl(repoUrl, item.configFile, item.configLine);
    if (sourceHref) {
      const sourceLink = document.createElement('a');
      sourceLink.className = 'source-edit-link';
      sourceLink.href = sourceHref;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.textContent = item.sourceId;
      sourceLink.title = `Edit "${item.sourceId}" in ${item.configFile}`;
      sourceTd.appendChild(sourceLink);
    } else {
      sourceTd.textContent = item.sourceId;
    }

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
  const maxVideoLabel =
    manifest.youtube.maxDurationSeconds !== null
      ? `max video ${formatSecondsShort(manifest.youtube.maxDurationSeconds)}`
      : 'max video unlimited';
  meta.textContent = `Built ${new Date(manifest.generatedAt).toLocaleString()} · default duration ${manifest.defaultDurationSeconds}s · ${maxVideoLabel} · captions ${manifest.youtube.captions ? manifest.youtube.captionLang : 'off'}`;
  titleBlock.append(h1, meta);
  header.appendChild(titleBlock);
  page.appendChild(header);

  if (manifest.repoUrl) {
    page.appendChild(renderContributeBar(manifest.repoUrl));
  }

  const grid = document.createElement('div');
  grid.className = 'group-grid';
  for (const group of Object.values(manifest.groups)) {
    grid.appendChild(renderGroup(group, baseUrl, manifest.defaultDurationSeconds, manifest.repoUrl));
  }
  page.appendChild(grid);

  root.innerHTML = '';
  root.appendChild(page);
}

void boot();
