// Public repository directory: the full discovery surface behind the small "Top repos"
// slices on the leaderboard and profiles. Server-rendered search keeps results linkable and
// useful without JavaScript; each result opens the repository's Renown leaderboard.
import { Head } from "@absolutejs/absolute/react/components";
import { useEffect, useState } from "react";
import { SiteHeader } from "../components/SiteHeader";

type Repo = { key: string; owner: string; repo: string; name: string; stars: number; oss: boolean; devs: number; xp: number; commits: number };
type Sort = "xp" | "devs" | "stars" | "commits";
type Directory = {
  repos: Repo[]; query: string; contributor: string; contributorFound: boolean;
  sort: Sort; page: number; hasMore: boolean;
};
type Props = { cssPath?: string; directory?: Directory; origin?: string };
type PrivateRepo = { key: string; owner: string; repo: string; name: string; stars: number; pushedAt: string | null; updatedAt: string | null; role: string; private: true };
type PrivateDirectory = { repos: PrivateRepo[]; needsGithubAuth: boolean; reason?: string | null; login?: string };
type PrivateContributor = { login: string; handle: string; avatarSeed: string | null; isAi: boolean; tier: string; xp: number; commits: number; lines: number; verified: boolean };
type PrivateProject = {
  key: string; owner: string; repo: string; name: string; stars: number; private: true; ephemeral: true;
  sort: "xp" | "commits" | "lines"; viewerLogins: string[]; contributors: PrivateContributor[];
  totals: { devs: number; verifiedDevs: number; xp: number; commits: number; lines: number };
};

const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US");
const hrefFor = (d: Directory, page: number) => {
  const p = new URLSearchParams();
  if (d.query) p.set("q", d.query);
  if (d.contributor) p.set("contributor", d.contributor);
  if (d.sort !== "xp") p.set("sort", d.sort);
  if (page > 1) p.set("page", String(page));
  const query = p.toString();
  return `/repos${query ? `?${query}` : ""}`;
};

const EMPTY: Directory = { repos: [], query: "", contributor: "", contributorFound: true, sort: "xp", page: 1, hasMore: false };

const privateHash = (key: string, sort: PrivateProject["sort"] = "xp") => {
  const params = new URLSearchParams({ repo: key });
  if (sort !== "xp") params.set("sort", sort);
  return `#${params.toString()}`;
};

const readPrivateHash = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const sort = params.get("sort");
  const normalizedSort: PrivateProject["sort"] = sort === "commits" || sort === "lines" ? sort : "xp";
  return {
    key: params.get("repo") ?? "",
    sort: normalizedSort,
  };
};

const PrivateProjectBoard = ({ project }: { project: PrivateProject }) => {
  const viewerLogins = new Set(project.viewerLogins.map((login) => login.toLowerCase()));
  const myIndex = project.contributors.findIndex((contributor) => viewerLogins.has(contributor.login.toLowerCase()));
  const labels = { xp: "activity XP", commits: "commits", lines: "additions" } as const;
  return (
    <section className="card" id="private-board" aria-live="polite">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>🔒 {project.key}</h2>
          <p className="muted" style={{ marginTop: 5 }}>{fmt(project.totals.devs)} contributor{project.totals.devs === 1 ? "" : "s"} · {fmt(project.totals.commits)} commits · {fmt(project.totals.lines)} additions</p>
        </div>
        <a href="#" style={{ color: "#c4b5fd", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Close ×</a>
      </div>
      <p className="muted hint" style={{ marginTop: 12 }}>Fetched live with your linked GitHub access. This repository and its board are not stored, indexed, shared, or available through public project, badge, or image routes.</p>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>Contributors <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· ranked by {labels[project.sort]}</span></h3>
        <nav style={{ display: "flex", gap: 4, fontSize: 13 }} aria-label="Sort private repository leaderboard">
          {(["xp", "commits", "lines"] as const).map((sort) => <a key={sort} href={privateHash(project.key, sort)} style={{
            padding: "4px 10px", borderRadius: 999, textDecoration: "none", color: "inherit",
            background: project.sort === sort ? "rgba(134,239,172,.16)" : "rgba(255,255,255,.04)",
            border: `1px solid ${project.sort === sort ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.10)"}`,
            fontWeight: project.sort === sort ? 700 : 500,
          }}>{labels[sort]}</a>)}
        </nav>
      </div>
      {myIndex >= 0 && <p style={{ marginTop: 7, color: "#86efac", fontSize: 13, fontWeight: 700 }}>You're #{myIndex + 1} of {project.contributors.length}.</p>}
      <p className="muted" style={{ marginTop: 7, fontSize: 12.5 }}>Activity XP is a live estimate from GitHub commits and additions. Linked Renown players are marked ✓; no contribution rows are persisted.</p>
      {project.contributors.length === 0 ? <p className="muted" style={{ marginTop: 12 }}>GitHub has not returned contributor activity for this repository yet.</p> :
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {project.contributors.map((contributor, index) => {
            const mine = viewerLogins.has(contributor.login.toLowerCase());
            const stat = { xp: `${fmt(contributor.xp)} XP`, commits: `${fmt(contributor.commits)} commits`, lines: `${fmt(contributor.lines)} additions` } as const;
            const row = <>
              <span style={{ width: 28, textAlign: "right", fontWeight: 700, opacity: .8 }}>{["🥇", "🥈", "🥉"][index] ?? index + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{contributor.login}{contributor.verified && <span title="Linked GitHub identity" style={{ color: "#86efac", fontSize: 12 }}> ✓</span>}{contributor.isAi && <span style={{ fontSize: 11, opacity: .7 }}> 🤖</span>}{mine && <span style={{ color: "#86efac", fontSize: 12 }}> ← you</span>}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{stat[project.sort]}</span>
            </>;
            const style = { display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, textDecoration: "none", color: "inherit", background: mine ? "rgba(134,239,172,.10)" : "rgba(255,255,255,.03)", border: `1px solid ${mine ? "rgba(134,239,172,.4)" : "rgba(255,255,255,.06)"}` };
            return contributor.verified ? <a key={contributor.login} href={`/profile/${encodeURIComponent(contributor.login)}`} style={style}>{row}</a> : <div key={contributor.login} style={style}>{row}</div>;
          })}
        </div>}
    </section>
  );
};

export const RenownRepos = ({ cssPath, directory = EMPTY, origin = "" }: Props) => {
  const [privateDirectory, setPrivateDirectory] = useState<PrivateDirectory | null>(null);
  const [privateSelection, setPrivateSelection] = useState<{ key: string; sort: PrivateProject["sort"] }>({ key: "", sort: "xp" });
  const [privateProject, setPrivateProject] = useState<PrivateProject | null>(null);
  const [privateProjectState, setPrivateProjectState] = useState<"idle" | "loading" | "denied">("idle");
  const [githubCallback, setGithubCallback] = useState<"oauth-error" | "linked" | "reconnected" | null>(null);
  useEffect(() => {
    const callback = new URLSearchParams(window.location.search).get("github");
    if (callback === "oauth-error" || callback === "linked" || callback === "reconnected") setGithubCallback(callback);
    const controller = new AbortController();
    fetch("/api/account/repos", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<PrivateDirectory> : null)
      .then((result) => { if (result) setPrivateDirectory(result); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const update = () => setPrivateSelection(readPrivateHash());
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    setPrivateProject(null);
    if (!privateSelection.key) { setPrivateProjectState("idle"); return; }
    if (!privateDirectory) return;
    const selected = privateDirectory.repos.find((repo) => repo.key.toLowerCase() === privateSelection.key.toLowerCase());
    if (!selected) { setPrivateProjectState("denied"); return; }
    const controller = new AbortController();
    setPrivateProjectState("loading");
    fetch("/api/account/private-project", {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: selected.owner, repo: selected.repo, sort: privateSelection.sort }),
    }).then(async (response) => response.ok ? response.json() as Promise<{ project: PrivateProject }> : null)
      .then((result) => {
        if (result?.project) { setPrivateProject(result.project); setPrivateProjectState("idle"); }
        else setPrivateProjectState("denied");
      }).catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setPrivateProjectState("denied"); });
    return () => controller.abort();
  }, [privateDirectory, privateSelection]);
  const privateRepos = (privateDirectory?.repos ?? []).filter((repo) => {
    const query = directory.query.toLowerCase();
    return !query || repo.key.toLowerCase().includes(query) || repo.name.toLowerCase().includes(query);
  });
  const title = directory.contributor ? `@${directory.contributor}'s repos — Renown` : "Browse repositories — Renown";
  const desc = "Search public repositories tracked by Renown and open each repo's contributor leaderboard.";
  const canonical = `${origin}/repos`;
  return (
    <html lang="en">
      <Head cssPath={cssPath} title={title} description={desc} canonical={canonical}
        openGraph={{ title, description: desc, type: "website", url: canonical, siteName: "Renown" }}
        twitter={{ card: "summary", title, description: desc }} />
      <body>
        <main className="wrap profilePage">
          <SiteHeader current="repos" />

          <section className="card">
            <h1 style={{ marginBottom: 4 }}>{directory.contributor ? `@${directory.contributor}'s repos` : "Explore repos"}</h1>
            <p className="muted">Search every public repository earning Renown, then open its contributor leaderboard.</p>
            {githubCallback === "oauth-error" && <p role="alert" style={{ marginTop: 12, color: "#fca5a5" }}>GitHub did not issue a usable credential. Please reconnect once more; Renown has kept your existing account session intact.</p>}
            {(githubCallback === "linked" || githubCallback === "reconnected") && <p role="status" style={{ marginTop: 12, color: "#86efac" }}>GitHub access updated. Your private repositories are now loaded only for this session.</p>}
            {directory.contributor && (
              <p style={{ marginTop: 10 }}><a href="/repos" style={{ color: "#c4b5fd", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Clear contributor filter ×</a></p>
            )}
            <form action="/repos" method="get" style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              {directory.contributor && <input type="hidden" name="contributor" value={directory.contributor} />}
              <input name="q" defaultValue={directory.query} type="search" placeholder="Search owner or repository…" aria-label="Search repositories"
                style={{ flex: "1 1 260px", minWidth: 0, padding: "11px 13px", color: "inherit", background: "rgba(0,0,0,.22)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, font: "inherit" }} />
              <select name="sort" defaultValue={directory.sort} aria-label="Sort repositories"
                style={{ padding: "10px 12px", color: "inherit", background: "#171923", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, font: "inherit" }}>
                <option value="xp">Most renown</option><option value="devs">Most developers</option><option value="stars">Most stars</option><option value="commits">Most commits</option>
              </select>
              <button type="submit" style={{ padding: "10px 18px", border: "1px solid rgba(196,181,253,.45)", borderRadius: 8, color: "inherit", background: "rgba(196,181,253,.14)", cursor: "pointer", fontWeight: 700 }}>Search</button>
            </form>
          </section>

          {privateProjectState === "loading" && <section className="card" aria-live="polite"><p className="muted">Checking linked GitHub access and loading the private leaderboard…</p></section>}
          {privateProjectState === "denied" && <section className="card" role="alert"><p>Renown could not load that private repository with a currently linked GitHub account.</p><p className="muted" style={{ marginTop: 8 }}><a href="/oauth2/github/authorization" style={{ color: "#c4b5fd", fontWeight: 700 }}>Reconnect GitHub access →</a></p></section>}
          {privateProject && <PrivateProjectBoard project={privateProject} />}

          {privateDirectory && (privateDirectory.repos.length > 0 || privateDirectory.needsGithubAuth) && (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Your private repos <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· visible only to you</span></h2>
              <p className="muted hint">Fetched live from GitHub. Renown does not store these names or include them in public boards.</p>
              {privateDirectory.needsGithubAuth && (
                <p style={{ marginTop: 12 }}>{privateDirectory.reason} <a href="/oauth2/github/authorization" style={{ color: "#c4b5fd", fontWeight: 700 }}>Reconnect GitHub →</a></p>
              )}
              {privateDirectory.repos.length > 0 && privateRepos.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No private repositories match this search.</p>}
              {privateRepos.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))", gap: 8, marginTop: 12 }}>
                {privateRepos.map((repo) => (
                  <a key={repo.key} href={privateHash(repo.key)} style={{ display: "block", padding: "13px 14px", borderRadius: 10, color: "inherit", textDecoration: "none", background: privateSelection.key.toLowerCase() === repo.key.toLowerCase() ? "rgba(134,239,172,.08)" : "rgba(255,255,255,.025)", border: `1px solid ${privateSelection.key.toLowerCase() === repo.key.toLowerCase() ? "rgba(134,239,172,.3)" : "rgba(255,255,255,.07)"}` }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span aria-hidden>🔒</span><strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.key}</strong></div>
                    <div className="muted" style={{ marginTop: 5, fontSize: 12.5 }}>{repo.role} access{repo.stars > 0 ? ` · ★ ${fmt(repo.stars)}` : ""}{repo.pushedAt ? ` · pushed ${new Date(repo.pushedAt).toLocaleDateString()}` : ""} · open board →</div>
                  </a>
                ))}
              </div>}
            </section>
          )}

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Repositories <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{directory.query ? `· matching “${directory.query}”` : "· ranked by real work"}</span></h2>
            {!directory.contributorFound ? <p className="muted">That contributor isn't a verified Renown player yet.</p>
              : directory.repos.length === 0 ? <p className="muted">No public repositories match this search.</p>
              : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))", gap: 8, marginTop: 10 }}>
                {directory.repos.map((r) => (
                  <a key={r.key} href={`/project/${r.key}`} style={{ display: "block", padding: "13px 14px", borderRadius: 10, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                    <div style={{ fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</div>
                    <div className="muted" style={{ marginTop: 5, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                      {r.stars > 0 && <>★ {fmt(r.stars)} · </>}{r.devs} dev{r.devs === 1 ? "" : "s"} · {fmt(r.xp)} XP · {fmt(r.commits)} commits
                    </div>
                  </a>
                ))}
              </div>}

            {(directory.page > 1 || directory.hasMore) && <nav aria-label="Repository pages" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
              {directory.page > 1 ? <a href={hrefFor(directory, directory.page - 1)} style={{ color: "#c4b5fd", fontWeight: 700, textDecoration: "none" }}>← Previous</a> : <span />}
              <span className="muted" style={{ fontSize: 13 }}>Page {directory.page}</span>
              {directory.hasMore ? <a href={hrefFor(directory, directory.page + 1)} style={{ color: "#c4b5fd", fontWeight: 700, textDecoration: "none" }}>Next →</a> : <span />}
            </nav>}
          </section>
        </main>
      </body>
    </html>
  );
};
