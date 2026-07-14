// One multiplexed SSE connection for the whole browser page. Components register the
// topics they care about; the manager reconnects with the union and dispatches events
// locally. This avoids one EventSource per component (and the HTTP/1.1 six-connection
// trap), while retaining the server's existing topic-filtered /sync protocol.
export type SyncEvent = { topic: string; at: number; payload?: unknown };

type Listener = { topics: Set<string>; onEvent: (event: SyncEvent) => void };

const listeners = new Map<number, Listener>();
let nextId = 1;
let source: EventSource | null = null;
let sourceKey = "";
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

const matches = (topics: Set<string>, topic: string) => {
  if (topics.has(topic)) return true;
  for (const candidate of topics) {
    if (candidate.endsWith("*") && topic.startsWith(candidate.slice(0, -1))) return true;
  }
  return false;
};

const rebuild = () => {
  rebuildTimer = null;
  if (typeof EventSource === "undefined") return;

  const topics = Array.from(new Set(
    Array.from(listeners.values()).flatMap((listener) => Array.from(listener.topics)),
  )).filter(Boolean).sort();
  const key = topics.join(",");
  if (source && sourceKey === key) return;

  source?.close();
  source = null;
  sourceKey = key;
  if (!key) return;

  source = new EventSource(`/sync?${new URLSearchParams({ topics: key })}`);
  source.onmessage = (message) => {
    let event: SyncEvent;
    try { event = JSON.parse(message.data) as SyncEvent; }
    catch { return; }
    for (const listener of listeners.values()) {
      if (matches(listener.topics, event.topic)) listener.onEvent(event);
    }
  };
};

const scheduleRebuild = () => {
  if (rebuildTimer !== null || typeof window === "undefined") return;
  // React mounts sibling effects in one turn. A zero-delay task coalesces them into a
  // single EventSource instead of reconnecting once per component during hydration.
  rebuildTimer = setTimeout(rebuild, 0);
};

export const subscribeSync = (topics: string[], onEvent: (event: SyncEvent) => void) => {
  const id = nextId++;
  const cleanTopics = topics.filter(Boolean);
  if (cleanTopics.length > 0) {
    listeners.set(id, { topics: new Set(cleanTopics), onEvent });
    scheduleRebuild();
  }
  return () => {
    if (!listeners.delete(id)) return;
    scheduleRebuild();
  };
};
