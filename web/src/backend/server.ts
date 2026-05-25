import { networking, prepare } from "@absolutejs/absolute";
import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/apiPlugin";
import { pagesPlugin } from "./plugins/pagesPlugin";

const { absolutejs, manifest } = await prepare();

const server = new Elysia()
  .use(absolutejs)
  .use(apiPlugin())
  .use(pagesPlugin(manifest))
  .use(networking)
  .on("error", (error) => {
    const { request } = error;
    console.error(`Server error on ${request.method} ${request.url}: ${error.message}`);
  });

export type Server = typeof server;
