// Tiny in-process LRU for rendered OG PNGs / badge+board SVGs, keyed by ETag (a pure hash of the
// data). Rasterizing a 1200×630 SVG with resvg is CPU-heavy and synchronous, and crawler unfurls
// (Slack/Discord/Twitter/iMessage) hit cold + ignore HTTP caching — so without this, every unfurl
// of a distinct card re-renders. Keying by ETag means each card renders once until its underlying
// data changes (which changes the ETag). Bounded; oldest evicted. Single-instance, like sync.ts.
const MAX = 256;
const store = new Map<string, ArrayBuffer | string>();

export const renderCached = <T extends ArrayBuffer | string>(key: string, render: () => T): T => {
  const hit = store.get(key);
  if (hit !== undefined) { store.delete(key); store.set(key, hit); return hit as T; }   // LRU bump
  const val = render();
  store.set(key, val);
  if (store.size > MAX) { const oldest = store.keys().next().value; if (oldest !== undefined) store.delete(oldest); }
  return val;
};
