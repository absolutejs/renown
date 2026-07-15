// Public /project/:owner/:repo page — a per-repo leaderboard ranking that repo's renown
// contributors by per-project XP, plus a copyable README badge snippet and an install CTA.
// The viral surface: a badge in a repo's README links here, advertising renown to everyone
// who views the repo. SSR with repo-specific OG tags so shared links produce a real card.
//
// Deliberately LIGHTWEIGHT — unlike RenownProfile this imports NO 3D PetViewer/three.js, so the
// page stays fast + crawlable. Contributor pets live on their own /profile pages; the top pet
// renders server-side in the OG card only.
import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";
import { useEffect, useState } from "react";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

// Each contributor's 1/1 pet, rendered as a static 2D SVG (the same canonical sprite the OG
// card + 3D viewer use) — no three.js, so the board stays fast + crawlable but still shows the
// signature renown pets. Returns a wrapped <svg> string for dangerouslySetInnerHTML.
const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const PetSprite = ({ seed, box, href }: { seed: string; box: number; href?: string }) => {
  const sprite = <span style={{ width: box, height: box, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: petSvgHtml(seed, box) }} />;
  return href ? <a href={href} title="Open this pet's page" style={{ display: "inline-flex" }}>{sprite}</a> : sprite;
};

type Contributor = { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string; xp: number; commits: number; lines: number; verified: boolean };
type ProjectForUI = {
  key: string; owner: string; repo: string; name: string; stars: number; oss: boolean;
  sort: "xp" | "commits" | "lines";
  contributors: Contributor[]; topContributor: Contributor | null;
  totals: { devs: number; verifiedDevs: number; xp: number; commits: number; lines: number };
  private?: true; ephemeral?: true; viewerLogins?: string[];
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const SORT_LABEL = { xp: "renown XP", commits: "commits", lines: "lines" } as const;

const Copyable = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* user can select it */ }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <code style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap", padding: "10px 12px", background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.10)", borderRadius: 8, fontSize: 12.5 }}>{text}</code>
      <button onClick={onCopy} style={{ padding: "6px 12px", background: copied ? "rgba(134,239,172,.18)" : "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "inherit", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy"}</button>
    </div>
  );
};

const ProjectNotFound = ({ keyParam }: { keyParam: string }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: "/leaderboard", label: "Back to leaderboard" }} />
    <section className="card" style={{ textAlign: "center" }}>
      <h1>{keyParam} isn't on Renown yet</h1>
      <p className="muted">No one tracking this repo with renown has a verified contribution here yet. Be the first.</p>
      <div style={{ maxWidth: 560, margin: "18px auto 0", textAlign: "left" }}>
        <Copyable text="bun add -g @absolutejs/renown" />
        <p className="muted" style={{ marginTop: 8 }}>Then <code>gh auth login</code> and <code>renown link</code> — your commits here start earning renown.</p>
      </div>
    </section>
  </main>
);

// The signed-in viewer's GitHub login, so we can highlight their row + show "you're #N".
// Public page, so this is a best-effort client fetch — null when logged out (no highlight).
const useViewerLogin = (): string | null => {
  const [login, setLogin] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/account").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (live) setLogin((d?.github?.login as string | undefined)?.toLowerCase() ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return login;
};

const ProjectBody = ({ project, origin }: { project: ProjectForUI; origin: string }) => {
  const isPrivate = project.private === true;
  const pageUrl = `${origin}/project/${project.key}`;
  const badgeMd = `[![renown](${origin}/project/${project.key}/badge.svg)](${pageUrl})`;
  const boardMd = `[![renown leaderboard](${origin}/project/${project.key}/board.svg)](${pageUrl})`;
  const accountLogin = useViewerLogin();
  const viewerLogins = new Set((project.viewerLogins ?? (accountLogin ? [accountLogin] : [])).map((login) => login.toLowerCase()));
  const myIndex = project.contributors.findIndex((c) => viewerLogins.has(c.login.toLowerCase()));
  const sortHref = (sort: ProjectForUI["sort"]) => isPrivate
    ? `/private-project#${new URLSearchParams({ repo: project.key, ...(sort === "xp" ? {} : { sort }) }).toString()}`
    : `/project/${project.key}?sort=${sort}`;
  const sortLabel = (sort: ProjectForUI["sort"]) => isPrivate && sort === "xp" ? "activity XP" : isPrivate && sort === "lines" ? "additions" : SORT_LABEL[sort];
  return (
    <main className="wrap profilePage">
      <SiteHeader back={{ href: isPrivate ? "/repos" : "/leaderboard", label: isPrivate ? "Back to repositories" : "Back to leaderboard" }} />

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 4 }}>{isPrivate ? <><span aria-hidden>🔒 </span>{project.owner}</> : <a href={`/org/${project.owner}`} style={{ color: "inherit", textDecoration: "none" }} title={`${project.owner} on Renown`}>{project.owner}</a>}<span className="muted">/{project.repo}</span></h1>
          <p className="muted">
            {project.stars > 0 && <>★ {fmt(project.stars)} · </>}
            {project.oss ? "open source · " : ""}
            {fmt(project.totals.devs)} dev{project.totals.devs === 1 ? "" : "s"} · {fmt(project.totals.xp)} {isPrivate ? "activity XP" : "XP"} · {fmt(project.totals.commits)} commits
          </p>
          {isPrivate && <p className="muted hint" style={{ marginTop: 8 }}>Loaded live with your linked GitHub permission. This repository and leaderboard are not stored, indexed, or exposed through public project, badge, or image routes.</p>}
        </div>
        {project.topContributor?.avatarSeed && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <PetSprite seed={project.topContributor.avatarSeed} box={96} href={`/pet/${encodeURIComponent(project.topContributor.avatarSeed)}`} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>top · @{project.topContributor.login}</div>
          </div>
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Contributors <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· ranked by {sortLabel(project.sort)} on this repo</span></h2>
          <nav style={{ display: "flex", gap: 4, fontSize: 13 }}>
            {(["xp", "commits", "lines"] as const).map((s) => (
              <a key={s} href={sortHref(s)} style={{
                padding: "4px 10px", borderRadius: 999, textDecoration: "none",
                background: project.sort === s ? "rgba(134,239,172,.16)" : "rgba(255,255,255,.04)",
                border: `1px solid ${project.sort === s ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.10)"}`,
                color: "inherit", fontWeight: project.sort === s ? 700 : 500,
              }}>{sortLabel(s)}</a>
            ))}
          </nav>
        </div>
        {myIndex >= 0 && (
          <p style={{ marginTop: 6, fontSize: 13 }}>
            <span style={{ color: "#86efac", fontWeight: 700 }}>You're #{myIndex + 1} of {project.contributors.length}</span>
            <span className="muted"> on {project.repo}.</span>
          </p>
        )}
        {viewerLogins.size > 0 && myIndex < 0 && project.contributors.length > 0 && (
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>You haven't earned renown on {project.repo} yet — commit here to claim a spot.</p>
        )}
        {project.contributors.length > 0 && (isPrivate ?
          <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>Live GitHub activity estimate; linked Renown players are marked ✓. No private contribution rows are persisted.</p>
          : (
          <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
            {project.totals.verifiedDevs === project.contributors.length
              ? <><span style={{ color: "#86efac" }}>✓</span> GitHub-verified via the renown Action.</>
              : project.totals.verifiedDevs > 0
                ? <><span style={{ color: "#86efac" }}>✓</span> = GitHub-verified via CI · others self-reported. <a href="https://github.com/absolutejs/renown#github-action--auto-sync-from-ci" target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>Add the renown Action</a> →</>
                : <>Per-repo XP is contributor-reported via the CLI. <a href="https://github.com/absolutejs/renown#github-action--auto-sync-from-ci" target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>Add the renown Action</a> for GitHub-verified scoring →</>}
          </p>
        ))}
        {project.contributors.length === 0
          ? <p className="muted">No verified contributors yet — link your account and commit to claim the top spot.</p>
          : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {project.contributors.map((c, i) => {
                const mine = i === myIndex;
                return (
                <a key={c.login} href={isPrivate && !c.verified ? `https://github.com/${encodeURIComponent(c.login)}` : `/profile/${encodeURIComponent(c.login)}`} target={isPrivate && !c.verified ? "_blank" : undefined} rel={isPrivate && !c.verified ? "noreferrer" : undefined} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: mine ? "rgba(134,239,172,.10)" : "rgba(255,255,255,.03)", border: `1px solid ${mine ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.06)"}` }}>
                  <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: 0.8 }}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                  {c.avatarSeed && <PetSprite seed={c.avatarSeed} box={40} />}
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{c.login}{c.verified && <span title={isPrivate ? "Linked Renown identity" : "GitHub-verified via CI"} style={{ color: "#86efac", fontSize: 12 }}> ✓</span>}{c.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}> 🤖</span>}{mine && <span style={{ color: "#86efac", fontSize: 12, fontWeight: 700 }}> ← you</span>}</span>
                  {(() => {
                    const stat = { xp: `${fmt(c.xp)} ${isPrivate ? "activity XP" : "XP"}`, commits: `${fmt(c.commits)} commits`, lines: `${fmt(c.lines)} ${isPrivate ? "additions" : "lines"}` } as const;
                    const rest = (["xp", "commits", "lines"] as const).filter((s) => s !== project.sort);
                    return (<>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{stat[project.sort]}</span>
                      <span className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, minWidth: 110, textAlign: "right" }}>{rest.map((s) => stat[s]).join(" · ")}</span>
                    </>);
                  })()}
                </a>
                );
              })}
            </div>
          )}
      </section>

      {!isPrivate && <section className="card">
        <h2>Add this badge to your README</h2>
        <p className="muted hint">Show your repo's renown leaderboard right where contributors look. Markdown:</p>
        <div style={{ marginTop: 8 }}><Copyable text={badgeMd} /></div>
        <p style={{ marginTop: 12 }}><img src={`${origin}/project/${project.key}/badge.svg`} alt="renown badge preview" /></p>
        <h2 style={{ marginTop: 20 }}>…or embed the live leaderboard</h2>
        <p className="muted hint">A top-5 board, right in your README — updates as contributors earn renown:</p>
        <div style={{ marginTop: 8 }}><Copyable text={boardMd} /></div>
        <p style={{ marginTop: 12 }}><img src={`${origin}/project/${project.key}/board.svg`} alt="renown leaderboard preview" style={{ maxWidth: "100%" }} /></p>
        <p className="muted" style={{ marginTop: 12 }}>Not earning renown yet? <code>bun add -g @absolutejs/renown</code> → <code>renown link</code>.</p>
      </section>}
    </main>
  );
};

const ProjectApp = ({ project, keyParam, origin }: { project: ProjectForUI | null; keyParam: string; origin: string }) =>
  project ? <ProjectBody project={project} origin={origin} /> : <ProjectNotFound keyParam={keyParam} />;

const readPrivateProjectSelection = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const key = params.get("repo") ?? "";
  const [owner = "", repo = ""] = key.split("/");
  const rawSort = params.get("sort");
  const sort: ProjectForUI["sort"] = rawSort === "commits" || rawSort === "lines" ? rawSort : "xp";
  return { key, owner, repo, sort };
};

const PrivateProjectApp = ({ origin }: { origin: string }) => {
  const [selection, setSelection] = useState({ key: "", owner: "", repo: "", sort: "xp" as ProjectForUI["sort"] });
  const [project, setProject] = useState<ProjectForUI | null>(null);
  const [state, setState] = useState<"loading" | "denied">("loading");
  useEffect(() => {
    const update = () => setSelection(readPrivateProjectSelection());
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    setProject(null);
    if (!selection.owner || !selection.repo) { setState("denied"); return; }
    const controller = new AbortController();
    setState("loading");
    fetch("/api/account/private-project", {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: selection.owner, repo: selection.repo, sort: selection.sort }),
    }).then(async (response) => response.ok ? response.json() as Promise<{ project?: ProjectForUI }> : null)
      .then((result) => {
        if (result?.project) {
          setProject(result.project);
        } else setState("denied");
      }).catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setState("denied"); });
    return () => controller.abort();
  }, [selection]);
  if (project) return <ProjectBody project={project} origin={origin} />;
  return <main className="wrap profilePage">
    <SiteHeader back={{ href: "/repos", label: "Back to repositories" }} />
    <section className="card" style={{ textAlign: "center" }}>
      {state === "loading" ? <><h1>Loading private leaderboard…</h1><p className="muted">Checking your linked GitHub access and fetching this repository live.</p></>
        : <><h1>Private repository unavailable</h1><p className="muted">Renown could not open this repository with any currently linked GitHub account.</p><p style={{ marginTop: 14 }}><a href="/oauth2/github/authorization" style={{ color: "#c4b5fd", fontWeight: 700 }}>Reconnect GitHub access →</a></p></>}
    </section>
  </main>;
};

type RenownProjectProps = {
  cssPath?: string;
  project?: ProjectForUI | null;
  keyParam?: string;       // owner/repo, for the not-found state
  origin?: string;
  shareSnippet?: string;
  privateMode?: boolean;
};

export const RenownProject = ({ cssPath, project = null, keyParam = "", origin = "", shareSnippet = "A repo leaderboard for real, meritorious dev work.", privateMode = false }: RenownProjectProps) => {
  if (privateMode) return (
    <html lang="en">
      <Head cssPath={cssPath} title="Private repository leaderboard — Renown" description="A permission-scoped private repository leaderboard." canonical={`${origin}/repos`} />
      <body><PrivateProjectApp origin={origin} /></body>
    </html>
  );
  const key = project?.key ?? keyParam;
  const fullUrl = `${origin}/project/${key}`;
  const title = project ? `${project.key} on Renown · ${project.totals.devs} dev${project.totals.devs === 1 ? "" : "s"}, ${fmt(project.totals.xp)} XP` : `${keyParam} — not on Renown yet`;
  const image = project ? `${origin}/project/${project.key}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{ title, description: shareSnippet, type: "website", url: fullUrl, image, imageAlt: `${key} on Renown`, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: shareSnippet, image, imageAlt: `${key} on Renown` }}
      />
      <body>
        <ProjectApp project={project} keyParam={key} origin={origin} />
      </body>
    </html>
  );
};
