import { asset } from "@absolutejs/absolute";
import { handleReactPageRequest } from "@absolutejs/absolute/react";
import { Elysia } from "elysia";
import { RenownHome } from "../../frontend/react/pages/RenownHome";

export const pagesPlugin = (manifest: Record<string, string>) => {
  const cssPath = asset(manifest, "RenownCSS");
  const home = ({ request }: { request: Request }) =>
    handleReactPageRequest({ index: asset(manifest, "RenownHomeIndex"), Page: RenownHome, props: { cssPath }, request });
  return new Elysia().get("/", home);
};
