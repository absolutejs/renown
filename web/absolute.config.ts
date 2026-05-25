import { defineConfig } from "@absolutejs/absolute";

// React-only Renown web app.
export default defineConfig({
  assetsDirectory: "./src/backend/assets",
  buildDirectory: "./build",
  reactDirectory: "./src/frontend/react",
  stylesConfig: "./src/frontend/styles/indexes",
});
