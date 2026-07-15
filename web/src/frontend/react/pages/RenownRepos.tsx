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
type PrivateDirectory = { repos: PrivateRepo[]; needsGithubAuth: boolean; reason?: string | null; login?: string; page: number; hasMore: boolean; query: string };

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
const privateProjectHref = (key: string) => `/private-project#${new URLSearchParams({ repo: key }).toString()}`;

export const RenownRepos = ({ cssPath, directory = EMPTY, origin = "" }: Props) => {
  const [privateDirectory, setPrivateDirectory] = useState<PrivateDirectory | null>(null);
  const [privatePage, setPrivatePage] = useState(1);
  const [privateQuery, setPrivateQuery] = useState("");
  const [privateQueryDraft, setPrivateQueryDraft] = useState("");
  const [privateLoading, setPrivateLoading] = useState(true);
  const [githubCallback, setGithubCallback] = useState<"oauth-error" | "linked" | "reconnected" | null>(null);
  useEffect(() => {
    const callback = new URLSearchParams(window.location.search).get("github");
    if (callback === "oauth-error" || callback === "linked" || callback === "reconnected") setGithubCallback(callback);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPrivateLoading(true);
    fetch("/api/account/repos/search", {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: privatePage, query: privateQuery }),
    }).then(async (response) => response.ok ? response.json() as Promise<PrivateDirectory> : null)
      .then((result) => {
        if (result) setPrivateDirectory(result);
        setPrivateLoading(false);
      }).catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setPrivateLoading(false); });
    return () => controller.abort();
  }, [privatePage, privateQuery]);
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

          {(privateLoading || privateDirectory) && (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Your private repos <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· visible only to you</span></h2>
              <p className="muted hint">Fetched one page at a time from GitHub. Open a repository for its full private leaderboard; names and boards are never stored or published.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                setPrivatePage(1);
                setPrivateQuery(privateQueryDraft.trim());
              }} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <input value={privateQueryDraft} onChange={(event) => setPrivateQueryDraft(event.target.value)} type="search" placeholder="Search private repositories…" aria-label="Search private repositories"
                  style={{ flex: "1 1 260px", minWidth: 0, padding: "10px 12px", color: "inherit", background: "rgba(0,0,0,.22)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, font: "inherit" }} />
                <button type="submit" style={{ padding: "9px 16px", border: "1px solid rgba(196,181,253,.45)", borderRadius: 8, color: "inherit", background: "rgba(196,181,253,.14)", cursor: "pointer", fontWeight: 700 }}>Search private</button>
                {privateQuery && <button type="button" onClick={() => { setPrivateQueryDraft(""); setPrivateQuery(""); setPrivatePage(1); }} style={{ padding: "9px 12px", border: 0, color: "#c4b5fd", background: "transparent", cursor: "pointer", fontWeight: 700 }}>Clear</button>}
              </form>
              {privateLoading && <p className="muted" aria-live="polite" style={{ marginTop: 14 }}>Loading private repository page…</p>}
              {privateDirectory?.needsGithubAuth && (
                <p style={{ marginTop: 12 }}>{privateDirectory.reason} <a href="/oauth2/github/authorization" style={{ color: "#c4b5fd", fontWeight: 700 }}>Reconnect GitHub →</a></p>
              )}
              {!privateLoading && privateDirectory && privateDirectory.repos.length === 0 && !privateDirectory.needsGithubAuth && <p className="muted" style={{ marginTop: 14 }}>{privateQuery ? "No private repositories match this search." : "No private repositories on this page."}</p>}
              {!privateLoading && privateDirectory && privateDirectory.repos.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(285px, 1fr))", gap: 8, marginTop: 12 }}>
                {privateDirectory.repos.map((repo) => (
                  <a key={repo.key} href={privateProjectHref(repo.key)} style={{ display: "block", padding: "13px 14px", borderRadius: 10, color: "inherit", textDecoration: "none", background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span aria-hidden>🔒</span><strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.key}</strong></div>
                    <div className="muted" style={{ marginTop: 5, fontSize: 12.5 }}>{repo.role} access{repo.stars > 0 ? ` · ★ ${fmt(repo.stars)}` : ""}{repo.pushedAt ? ` · pushed ${new Date(repo.pushedAt).toLocaleDateString()}` : ""} · view leaderboard →</div>
                  </a>
                ))}
              </div>}
              {!privateLoading && privateDirectory && (privateDirectory.page > 1 || privateDirectory.hasMore) && <nav aria-label="Private repository pages" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
                {privateDirectory.page > 1 ? <button type="button" onClick={() => setPrivatePage((page) => Math.max(1, page - 1))} style={{ border: 0, color: "#c4b5fd", background: "transparent", cursor: "pointer", font: "inherit", fontWeight: 700 }}>← Previous</button> : <span />}
                <span className="muted" style={{ fontSize: 13 }}>Private page {privateDirectory.page}</span>
                {privateDirectory.hasMore ? <button type="button" onClick={() => setPrivatePage((page) => page + 1)} style={{ border: 0, color: "#c4b5fd", background: "transparent", cursor: "pointer", font: "inherit", fontWeight: 700 }}>Next →</button> : <span />}
              </nav>}
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
