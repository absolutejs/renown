import { networking, prepare } from "@absolutejs/absolute";
import { sync } from "@absolutejs/sync";
import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/apiPlugin";
import { pagesPlugin } from "./plugins/pagesPlugin";
import { hub, playerCache } from "./sync";

const { absolutejs, manifest } = await prepare();

// flush any pending write-behind writes to Neon on shutdown so nothing is lost
const flushOnExit = async () => { try { await playerCache.flush(); } catch {} process.exit(0); };
process.on("SIGINT", flushOnExit);
process.on("SIGTERM", flushOnExit);

const server = new Elysia()
  .use(absolutejs)
  .use(sync({ hub }))   // live push to browsers: GET /sync?topics=top,player:<id>
  .use(apiPlugin())
  .use(pagesPlugin(manifest))
  .use(networking)
  .onStop(async () => { await playerCache.flush(); })
  .on("error", (error) => {
    const { request } = error;
    console.error(`Server error on ${request.method} ${request.url}: ${error.message}`);
  });

export type Server = typeof server;
