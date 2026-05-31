import { asset } from "@absolutejs/absolute";
import { handleReactPageRequest } from "@absolutejs/absolute/react";
import { Elysia } from "elysia";
import { RenownAdmin } from "../../frontend/react/pages/RenownAdmin";
import { RenownHome } from "../../frontend/react/pages/RenownHome";
import { RenownProfile } from "../../frontend/react/pages/RenownProfile";
import { RenownProject } from "../../frontend/react/pages/RenownProject";
import { RenownRecap } from "../../frontend/react/pages/RenownRecap";
import { profileOgEtag, renderProfileOgPng } from "../ogImage";
import { loadProfile, profileShareSnippet } from "../profile";
import { loadProject, normalizeProjectSort, projectShareSnippet } from "../project";
import { projectOgEtag, renderProjectOgPng } from "../projectOg";
import { projectBadgeEtag, renderProjectBadge } from "../projectBadge";
import { loadRecap, recapShareSnippet } from "../recap";
import { recapOgEtag, renderRecapOgPng } from "../recapOg";

// Resolve the absolute origin (https://host) the request was made to. Used
// for OG/canonical URL tags so shared profile links produce fully-qualified
// references regardless of which host renown is reverse-proxied behind.
// Honors x-forwarded-{proto,host} so Cloudflare/Caddy/Nginx in front works
// without extra config.
const originOf = (request: Request) => {
  const url = new URL(request.url);
  const fwdProto = request.headers.get("x-forwarded-proto");
  const fwdHost = request.headers.get("x-forwarded-host");
  const proto = fwdProto ?? url.protocol.replace(":", "");
  const host = fwdHost ?? url.host;
  return `${proto}://${host}`;
};

export const pagesPlugin = (manifest: Record<string, string>) => {
  const cssPath = asset(manifest, "RenownCSS");
  const home = ({ request }: { request: Request }) =>
    handleReactPageRequest({ index: asset(manifest, "RenownHomeIndex"), Page: RenownHome, props: { cssPath }, request });
  const admin = ({ request }: { request: Request }) =>
    handleReactPageRequest({ index: asset(manifest, "RenownAdminIndex"), Page: RenownAdmin, props: { cssPath }, request });
  // /profile/:login — public, no-auth, SSR-prefetched profile data so OG tags
  // can vary per-profile and crawlers see real content. Pre-fetch via the
  // shared loader so the page and the /api/profile/:login JSON endpoint
  // can't drift on what "a profile" is.
  const profile = async ({ request, params }: { request: Request; params: { login: string } }) => {
    // Normalize to lowercase for stable URLs. GitHub logins are case-
    // insensitive so capitalize-different links should serve the same page —
    // they'll share OG cache entries downstream when we add image caching.
    const loginParam = String(params.login ?? "").toLowerCase();
    const data = await loadProfile(loginParam);
    return handleReactPageRequest({
      index: asset(manifest, "RenownProfileIndex"),
      Page: RenownProfile,
      props: {
        cssPath,
        // null when not-found — the page renders ProfileNotFound. We still
        // serve a 200 so crawlers see the "no renown for X yet" landing
        // (a 404 would suppress OG previews entirely; the soft-not-found
        // surface keeps the brand-link discoverable).
        profile: data,
        login: loginParam,
        origin: originOf(request),
        shareSnippet: data ? profileShareSnippet(data) : "Not on Renown yet.",
      },
      request,
    });
  };
  const profileOg = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const loginParam = String(params.login ?? "").toLowerCase();
    const data = await loadProfile(loginParam);
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });

    const etag = profileOgEtag(data);
    const headers = {
      "cache-control": "public, max-age=300",
      etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    const png = renderProfileOgPng(data);
    return new Response(png, {
      headers: {
        ...headers,
        "content-type": "image/png",
      },
    });
  };
  // --- per-repo leaderboard: page + README badge + OG card (mirrors the profile trio) ---
  const projKey = (params: { owner: string; repo: string }) => `${params.owner}/${params.repo}`.toLowerCase();
  const projectPage = async ({ request, params, query }: { request: Request; params: { owner: string; repo: string }; query: Record<string, string | undefined> }) => {
    const key = projKey(params);
    const data = await loadProject(key, normalizeProjectSort(query.sort));
    return handleReactPageRequest({
      index: asset(manifest, "RenownProjectIndex"),
      Page: RenownProject,
      props: { cssPath, project: data, keyParam: key, origin: originOf(request), shareSnippet: data ? projectShareSnippet(data) : "Not on Renown yet." },
      request,
    });
  };
  const projectOg = async ({ request, params }: { request: Request; params: { owner: string; repo: string } }) => {
    const data = await loadProject(projKey(params));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = projectOgEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderProjectOgPng(data), { headers: { ...headers, "content-type": "image/png" } });
  };
  const projectBadge = async ({ request, params }: { request: Request; params: { owner: string; repo: string } }) => {
    const data = await loadProject(projKey(params));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = projectBadgeEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderProjectBadge(data), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  // --- "your week" recap: shareable page + OG card (mirrors the profile/project trio) ---
  const recapPage = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const login = String(params.login ?? "").toLowerCase();
    const data = await loadRecap(login);
    return handleReactPageRequest({
      index: asset(manifest, "RenownRecapIndex"),
      Page: RenownRecap,
      props: { cssPath, recap: data, login, origin: originOf(request), shareSnippet: data ? recapShareSnippet(data) : "Not on Renown yet." },
      request,
    });
  };
  const recapOg = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const data = await loadRecap(String(params.login ?? "").toLowerCase());
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = recapOgEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderRecapOgPng(data), { headers: { ...headers, "content-type": "image/png" } });
  };
  return new Elysia()
    .get("/", home)
    .get("/admin", admin)
    .get("/profile/:login/og.png", profileOg)
    .get("/profile/:login", profile)
    .get("/project/:owner/:repo/og.png", projectOg)
    .get("/project/:owner/:repo/badge.svg", projectBadge)
    .get("/project/:owner/:repo", projectPage)
    .get("/recap/:login/og.png", recapOg)
    .get("/recap/:login", recapPage);
};
