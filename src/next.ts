import { resetGroupCursor, resolveGroup, selectNextIndex } from './router.js';
import './styles.css';
import type { ShowcaseManifest } from './types.js';

function renderMessage(title: string, html: string) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="status-screen">
      <div class="status-panel">
        <h1>${title}</h1>
        ${html}
      </div>
    </div>
  `;
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const requestedGroup = params.get('group');
  const orderOverride = params.get('order');
  const shouldReset = params.get('reset') === '1';
  const dryRun = params.get('dry') === '1';

  const rootUrl = new URL(window.location.pathname.endsWith('/') ? '../' : './', window.location.href);
  const manifestUrl = new URL('manifest.json', rootUrl).toString();

  let manifest: ShowcaseManifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as ShowcaseManifest;
  } catch (err) {
    renderMessage(
      'Unable to load showcase manifest',
      `<p>Could not fetch <code>${manifestUrl}</code>.</p>
       <pre>${err instanceof Error ? err.message : String(err)}</pre>`,
    );
    return;
  }

  const group = resolveGroup(manifest, requestedGroup);
  if (group.items.length === 0) {
    renderMessage(
      `Group "${group.id}" is empty`,
      `<p>No items were resolved for this group.</p>
       <a class="btn btn-primary" href="${new URL('preview/', rootUrl).toString()}">Open Preview</a>`,
    );
    return;
  }

  if (shouldReset) {
    resetGroupCursor(window.localStorage, group.id);
  }

  const effectiveOrder =
    orderOverride === 'random' || orderOverride === 'sequential' ? orderOverride : group.order;

  const nextIndex = selectNextIndex(window.localStorage, group.id, group.items.length, effectiveOrder);
  const item = group.items[nextIndex];
  const playerUrl = new URL(rootUrl);
  playerUrl.searchParams.set('group', group.id);
  playerUrl.searchParams.set('index', String(nextIndex));
  playerUrl.searchParams.set('single', '1');
  const maxVideo = params.get('maxVideo');
  if (maxVideo) {
    playerUrl.searchParams.set('maxVideo', maxVideo);
  }

  const targetUrl = item.kind === 'web' && item.display === 'redirect' ? item.url : playerUrl.toString();

  if (dryRun) {
    const previewHref = new URL('preview/', rootUrl).toString();
    renderMessage(
      `Next item for "${group.id}"`,
      `<p>Index <code>${nextIndex + 1} / ${group.items.length}</code> (order: <code>${effectiveOrder}</code>)</p>
       <p><strong>${item.title}</strong> (${item.kind}${item.kind === 'web' ? ` / ${item.display}` : ''})</p>
       <pre>${targetUrl}</pre>
       <p style="display:flex;gap:10px;flex-wrap:wrap">
         <a class="btn btn-primary" href="${targetUrl}">Go to item</a>
         <a class="btn" href="?group=${encodeURIComponent(group.id)}&order=${effectiveOrder}&dry=1">Advance cursor</a>
         <a class="btn" href="${previewHref}">Preview all</a>
       </p>`,
    );
    return;
  }

  window.location.replace(targetUrl);
}

void boot();
