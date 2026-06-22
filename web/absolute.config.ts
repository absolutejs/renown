import { defineConfig } from "@absolutejs/absolute";

// React-only Renown web app.
export default defineConfig({
  assetsDirectory: "./src/backend/assets",
  buildDirectory: "./build",
  reactDirectory: "./src/frontend/react",
  stylesConfig: "./src/frontend/styles/indexes",
  // The frontend shares a handful of pure modules with the CLI engine that live
  // in the repo-root ../core (skills, procgen, petLooks, petSvg, shiny). The
  // production bundler inlines them, but the dev server only serves files under
  // its include list — without this, dev 404s on /core/*.ts and the board / pets
  // never hydrate. Pull ../core into the dev pipeline so `bun run dev` matches prod.
  dev: { watchDirs: ["../core"] },
});
