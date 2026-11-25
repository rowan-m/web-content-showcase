import { loadConfig } from './lib/config.js';
import {
  checkUrlEmbeddable,
  fetchFeedEntries,
  fetchYouTubeChannelItems,
  fetchYouTubeOEmbed,
  resolveYouTubeChannelId,
} from './lib/fetchers.js';

async function main() {
  const checkLive = process.argv.includes('--check-live');
  const config = loadConfig();

  console.log(
    `Schema OK: ${Object.keys(config.youtube).length} YouTube source(s), ` +
      `${Object.keys(config.feeds).length} feed(s), ` +
      `${Object.keys(config.urls).length} URL list(s), ` +
      `${Object.keys(config.groups).length} group(s).`,
  );

  if (!checkLive) {
    return;
  }

  const errors: string[] = [];

  for (const [sourceId, src] of Object.entries(config.youtube)) {
    if ('videos' in src) {
      await Promise.all(
        src.videos.map(async (entry) => {
          try {
            await fetchYouTubeOEmbed(entry.id);
          } catch (err) {
            errors.push(`[youtube:${sourceId}] ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    } else {
      try {
        const cid = await resolveYouTubeChannelId(src.channelId ?? src.handle!);
        const items = await fetchYouTubeChannelItems(sourceId, cid, src.kind, 1, null);
        if (items.length === 0) {
          console.warn(`[youtube:${sourceId}] warning: feed currently returned 0 ${src.kind}`);
        }
      } catch (err) {
        errors.push(`[youtube:${sourceId}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  for (const [sourceId, feed] of Object.entries(config.feeds)) {
    try {
      const entries = await fetchFeedEntries(feed.url, 1, false);
      if (entries.length === 0) {
        console.warn(`[feed:${sourceId}] warning: parsed 0 entries from ${feed.url}`);
      }
    } catch (err) {
      errors.push(`[feed:${sourceId}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [sourceId, entries] of Object.entries(config.urls)) {
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.display !== 'iframe') return;
        const probe = await checkUrlEmbeddable(entry.url);
        if (!probe.embeddable) {
          errors.push(
            `[urls:${sourceId}] ${entry.url} is set to display: iframe, but framing is blocked (${probe.reason}). Change to display: redirect or auto.`,
          );
        }
      }),
    );
  }

  if (errors.length > 0) {
    console.error('\nLive validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log('Live feed, YouTube, and iframe-header checks passed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
