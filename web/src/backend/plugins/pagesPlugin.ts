import { asset } from "@absolutejs/absolute";
import { handleReactPageRequest } from "@absolutejs/absolute/react";
import { Elysia } from "elysia";
import { RenownAdmin } from "../../frontend/react/pages/RenownAdmin";
import { RenownHome } from "../../frontend/react/pages/RenownHome";
import { RenownProfile } from "../../frontend/react/pages/RenownProfile";
import { RenownProject } from "../../frontend/react/pages/RenownProject";
import { RenownRecap } from "../../frontend/react/pages/RenownRecap";
import { RenownOrg } from "../../frontend/react/pages/RenownOrg";
import { RenownAchievement } from "../../frontend/react/pages/RenownAchievement";
import { RenownPet } from "../../frontend/react/pages/RenownPet";
import { RenownPets } from "../../frontend/react/pages/RenownPets";
import { loadRecentPets } from "../petGallery";
import { RenownAchievements } from "../../frontend/react/pages/RenownAchievements";
import { loadAchievementsIndex } from "../achievementsIndex";
import { RenownRivals } from "../../frontend/react/pages/RenownRivals";
import { loadRivals } from "../rivals";
import { RenownSeason } from "../../frontend/react/pages/RenownSeason";
import { loadSeason } from "../season";
import { RenownVersus } from "../../frontend/react/pages/RenownVersus";
import { loadVersus } from "../versus";
import { renderVersusOgPng, versusOgEtag } from "../versusOg";
import { RenownQuests } from "../../frontend/react/pages/RenownQuests";
import { loadQuests } from "../quests";
import { profileOgEtag, renderProfileOgPng } from "../ogImage";
import { profileBadgeEtag, renderProfileBadge } from "../profileBadge";
import { profilePetsEtag, renderProfilePets } from "../profilePets";
import { petCardEtag, renderPetCard } from "../petCard";
import { petOgEtag, renderPetOgPng } from "../petOg";
import { findPetOwner } from "../petOwner";
import { generate } from "../../../../core/procgen.ts";
import { loadProfile, profileShareSnippet } from "../profile";
import { loadProject, normalizeProjectSort, projectShareSnippet } from "../project";
import { projectOgEtag, renderProjectOgPng } from "../projectOg";
import { projectBadgeEtag, renderProjectBadge } from "../projectBadge";
import { projectBoardEtag, renderProjectBoardSvg } from "../projectBoardSvg";
import { loadRecap, recapShareSnippet } from "../recap";
import { recapOgEtag, renderRecapOgPng } from "../recapOg";
import { loadOrg, orgShareSnippet } from "../org";
import { orgBadgeEtag, renderOrgBadge } from "../orgBadge";
import { orgOgEtag, renderOrgOgPng } from "../orgOg";
import { achievementShareSnippet, loadAchievement } from "../achievement";
import { achievementOgEtag, renderAchievementOgPng } from "../achievementOg";
import { renderCached } from "../renderCache";

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

    const png = renderCached(etag, () => renderProfileOgPng(data));
    return new Response(png, {
      headers: {
        ...headers,
        "content-type": "image/png",
      },
    });
  };
  const profileBadge = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const data = await loadProfile(String(params.login ?? "").toLowerCase());
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = profileBadgeEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderProfileBadge(data)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  const profilePets = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const data = await loadProfile(String(params.login ?? "").toLowerCase());
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = profilePetsEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderProfilePets(data)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  const petCard = async ({ request, params }: { request: Request; params: { seed: string } }) => {
    const seed = String(params.seed ?? "").trim();
    if (!seed) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = petCardEtag(seed);
    const headers = { "cache-control": "public, max-age=86400", etag };   // a seed → creature is deterministic; cache hard
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderPetCard(seed)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  const petPage = async ({ request, params }: { request: Request; params: { seed: string } }) => {
    const seed = String(params.seed ?? "").trim();
    const c = seed ? generate(seed) : null;   // a seed deterministically generates the creature (pure, no DB)
    const pet = c ? { seed, name: c.name, tier: c.tier, sizeN: c.sizeN, statRarity: c.statRarity, rarestTrait: c.rarestTrait, oneOfOne: c.oneOfOne, mythicAura: c.mythicAura, traits: c.traits } : null;
    const owner = c ? await findPetOwner(seed) : null;   // 1/1 → at most one owner; links back to their profile
    return handleReactPageRequest({ index: asset(manifest, "RenownPetIndex"), Page: RenownPet, props: { cssPath, pet, owner, origin: originOf(request) }, request });
  };
  const petsPage = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const page = await loadRecentPets({ limit: 24, mode: url.searchParams.get("mode") });
    return handleReactPageRequest({ index: asset(manifest, "RenownPetsIndex"), Page: RenownPets, props: { cssPath, ...page, origin: originOf(request) }, request });
  };
  const achievementsPage = async ({ request }: { request: Request }) => {
    const index = await loadAchievementsIndex();
    return handleReactPageRequest({ index: asset(manifest, "RenownAchievementsIndex"), Page: RenownAchievements, props: { cssPath, index, origin: originOf(request) }, request });
  };
  const rivalsPage = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const login = String(params.login ?? "").toLowerCase();
    const rivals = await loadRivals(login);
    return handleReactPageRequest({ index: asset(manifest, "RenownRivalsIndex"), Page: RenownRivals, props: { cssPath, rivals, login, origin: originOf(request) }, request });
  };
  const seasonPage = async ({ request }: { request: Request }) => {
    const season = await loadSeason(25);
    return handleReactPageRequest({ index: asset(manifest, "RenownSeasonIndex"), Page: RenownSeason, props: { cssPath, season, origin: originOf(request) }, request });
  };
  const versusPage = async ({ request, params }: { request: Request; params: { a: string; b: string } }) => {
    const a = String(params.a ?? "").toLowerCase(), b = String(params.b ?? "").toLowerCase();
    const vs = await loadVersus(a, b);
    return handleReactPageRequest({ index: asset(manifest, "RenownVersusIndex"), Page: RenownVersus, props: { cssPath, vs, a, b, origin: originOf(request) }, request });
  };
  const questsPage = async ({ request, params }: { request: Request; params: { login: string } }) => {
    const login = String(params.login ?? "").toLowerCase();
    const quests = await loadQuests(login);
    return handleReactPageRequest({ index: asset(manifest, "RenownQuestsIndex"), Page: RenownQuests, props: { cssPath, quests, login, origin: originOf(request) }, request });
  };
  const versusOg = async ({ request, params }: { request: Request; params: { a: string; b: string } }) => {
    const vs = await loadVersus(String(params.a ?? "").toLowerCase(), String(params.b ?? "").toLowerCase());
    if ("error" in vs) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = versusOgEtag(vs);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderVersusOgPng(vs)), { headers: { ...headers, "content-type": "image/png" } });
  };
  const petOg = async ({ request, params }: { request: Request; params: { seed: string } }) => {
    const seed = String(params.seed ?? "").trim();
    if (!seed) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = petOgEtag(seed);
    const headers = { "cache-control": "public, max-age=86400", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderPetOgPng(seed)), { headers: { ...headers, "content-type": "image/png" } });
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
  const projectBoard = async ({ request, params, query }: { request: Request; params: { owner: string; repo: string }; query: Record<string, string | undefined> }) => {
    const data = await loadProject(projKey(params));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const limit = Math.max(1, Math.min(10, Number(query.limit ?? 5)));
    const etag = projectBoardEtag(data, limit);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderProjectBoardSvg(data, limit)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  const projectOg = async ({ request, params }: { request: Request; params: { owner: string; repo: string } }) => {
    const data = await loadProject(projKey(params));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = projectOgEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderProjectOgPng(data)), { headers: { ...headers, "content-type": "image/png" } });
  };
  const projectBadge = async ({ request, params }: { request: Request; params: { owner: string; repo: string } }) => {
    const data = await loadProject(projKey(params));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = projectBadgeEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderProjectBadge(data)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
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
    return new Response(renderCached(etag, () => renderRecapOgPng(data)), { headers: { ...headers, "content-type": "image/png" } });
  };
  // --- org: a whole owner's renown — page + README badge + OG card (mirrors the project trio) ---
  const orgPage = async ({ request, params }: { request: Request; params: { owner: string } }) => {
    const owner = String(params.owner ?? "");
    const data = await loadOrg(owner);
    return handleReactPageRequest({
      index: asset(manifest, "RenownOrgIndex"),
      Page: RenownOrg,
      props: { cssPath, org: data, owner, origin: originOf(request), shareSnippet: data ? orgShareSnippet(data) : "Not on Renown yet." },
      request,
    });
  };
  const orgOg = async ({ request, params }: { request: Request; params: { owner: string } }) => {
    const data = await loadOrg(String(params.owner ?? ""));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = orgOgEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderOrgOgPng(data)), { headers: { ...headers, "content-type": "image/png" } });
  };
  const orgBadge = async ({ request, params }: { request: Request; params: { owner: string } }) => {
    const data = await loadOrg(String(params.owner ?? ""));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = orgBadgeEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderOrgBadge(data)), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  };
  // --- achievement share page + OG card ---
  const achievementPage = async ({ request, params }: { request: Request; params: { id: string } }) => {
    const id = String(params.id ?? "");
    const data = await loadAchievement(id);
    return handleReactPageRequest({
      index: asset(manifest, "RenownAchievementIndex"),
      Page: RenownAchievement,
      props: { cssPath, achievement: data, id, origin: originOf(request), shareSnippet: data ? achievementShareSnippet(data) : "Not in the catalog." },
      request,
    });
  };
  const achievementOg = async ({ request, params }: { request: Request; params: { id: string } }) => {
    const data = await loadAchievement(String(params.id ?? ""));
    if (!data) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    const etag = achievementOgEtag(data);
    const headers = { "cache-control": "public, max-age=300", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(renderCached(etag, () => renderAchievementOgPng(data)), { headers: { ...headers, "content-type": "image/png" } });
  };
  return new Elysia()
    .get("/", home)
    .get("/admin", admin)
    .get("/achievements", achievementsPage)
    .get("/achievement/:id/og.png", achievementOg)
    .get("/achievement/:id", achievementPage)
    .get("/profile/:login/og.png", profileOg)
    .get("/profile/:login/badge.svg", profileBadge)
    .get("/profile/:login/pets.svg", profilePets)
    .get("/profile/:login", profile)
    .get("/pets", petsPage)
    .get("/season", seasonPage)
    .get("/vs/:a/:b/og.png", versusOg)
    .get("/vs/:a/:b", versusPage)
    .get("/quests/:login", questsPage)
    .get("/pet/:seed/og.png", petOg)
    .get("/pet/:seed/card.svg", petCard)
    .get("/pet/:seed", petPage)
    .get("/project/:owner/:repo/og.png", projectOg)
    .get("/project/:owner/:repo/badge.svg", projectBadge)
    .get("/project/:owner/:repo/board.svg", projectBoard)
    .get("/project/:owner/:repo", projectPage)
    .get("/recap/:login/og.png", recapOg)
    .get("/recap/:login", recapPage)
    .get("/rivals/:login", rivalsPage)
    .get("/org/:owner/og.png", orgOg)
    .get("/org/:owner/badge.svg", orgBadge)
    .get("/org/:owner", orgPage);
};
