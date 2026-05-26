import { Head } from "@absolutejs/absolute/react/components";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Tier = "free" | "supporter" | "pro";
type Entry = { id?: string; name: string; login?: string; score?: number; level: number; totalLevel?: number; xp: number; streak: number; ach: number; tier?: Tier };
type Skill = { id: string; name: string; icon: string; level: number; pct: number; xp: number };
type SkillSheet = { id: string; name: string | null; totalLevel: number; skills: Skill[] };
type Identity = { id: string; provider: string; subject: string; isPrimary: boolean; linkedAt?: string };
type MergeReq = { id: string; provider: string; subject: string };
type Billing = { tier: Tier; status: string | null; currentPeriodEnd: string | null; hasCustomer: boolean };
type GithubSync = { login: string; verified: boolean; verifiedScore: number; baseScore: number; attributionScore: number; attributionQuery: string | null; lastAttributionSyncAt: string | null; verifiedAt: string | null; totalLevel: number; playerId: string | null };
type Account = { sub: string; billing: Billing; github: GithubSync | null; identities: Identity[]; mergeRequests: MergeReq[] };
type TierInfo = { name: string; blurb: string; perks: string[] };
type Amount = { amount: number | null; currency: string; interval?: string };
type StripeConfig = { configured: boolean; tiers: Record<Tier, TierInfo>; prices: Record<string, string | null>; amounts: Record<string, Amount> };

const PROVIDERS: Record<string, { label: string; cls: string; href: string }> = {
  github: { label: "GitHub", cls: "gh", href: "/oauth2/github/authorization" },
  google: { label: "Google", cls: "gg", href: "/oauth2/google/authorization?client=login" },
};
const providerLabel = (p: string) => PROVIDERS[p]?.label ?? p;
const ORDER: Tier[] = ["free", "supporter", "pro"];

const money = (a?: Amount) =>
  a && a.amount != null ? `$${(a.amount / 100).toFixed(a.amount % 100 ? 2 : 0)}/${a.interval ?? "mo"}` : "";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

const api = async (url: string, opts?: RequestInit) => {
  const r = await fetch(url, opts);
  return { ok: r.ok, status: r.status, data: r.ok ? await r.json().catch(() => null) : null };
};
const post = (url: string, body?: unknown) =>
  api(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const TierBadge = ({ tier }: { tier?: Tier }) =>
  tier && tier !== "free" ? <span className={`tierBadge ${tier}`}>{tier === "pro" ? "PRO" : "SUPPORTER"}</span> : null;

// AbsoluteJS logomark — embedded inline so it follows currentColor.
const Logomark = ({ size = 22 }: { size?: number }) => (
  <svg className="logo" viewBox="0 0 300 300" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M66.4,274.3c68.4,46.3,161.5,28.4,207.8-40,46.3-68.4,28.4-161.5-40-207.8C165.8-19.9,72.7-2,26.4,66.4-19.9,134.9-2,227.9,66.4,274.3ZM48,116.7c-17.1,52.6-11.4,105.2,11.3,139.7C18,217.4,7.3,150.3,36.9,92.3,55.9,55.2,87.6,29.4,122.5,18.3c-31.9,18.4-59.9,53.5-74.5,98.3ZM175.3,283.1c36-10.5,68.9-36.8,88.3-74.8,29.4-57.5,19.1-123.9-21.3-163.1,21.8,34.5,27,86.3,10.2,138-15,46.1-44.2,82-77.3,99.8ZM183.6,266.2c24.3-20.8,44.4-55.6,53.3-97.4,14.1-66.1-4.4-127.6-41.8-148.1,19.9,26.7,29.9,78.6,23.7,136.7-4.7,44.4-18,83.3-35.2,108.9ZM63.7,131.8c-14.2,66.6,4.7,128.5,42.7,148.6-20.4-26.4-30.8-78.9-24.5-137.7,4.7-43.7,17.6-82,34.3-107.6-24,20.9-43.7,55.4-52.5,96.7ZM199.8,149.6c1.1,67.9-20.2,123.3-47.6,123.7-27.4.4-50.4-54.3-51.5-122.2-1.1-67.9,20.2-123.3,47.6-123.7,27.4-.4,50.4,54.3,51.5,122.2Z" />
  </svg>
);

// ── Leaderboard ────────────────────────────────────────────────────────────
const Board = ({ top, sel, setSel, sheet }: { top: Entry[]; sel: string | null; setSel: (id: string) => void; sheet: SkillSheet | null }) => {
  const skills = (sheet?.skills ?? []).slice().sort((a, b) => b.level - a.level || b.xp - a.xp);
  return (
    <>
      <section className="card">
        <h2>Global leaderboard</h2>
        <p className="muted hint">Ranked by <strong>Score</strong> — same formula for everyone: GitHub-verified base + windowed Co-Authored-By attribution. Lvl is your CLI's local total, shown for context.</p>
        {top.length === 0 ? (
          <p className="muted">No players yet — be the first.</p>
        ) : (
          <ol className="ranks">
            {top.map((e, i) => (
              <li key={e.id ?? i} className={e.id === sel ? "sel" : ""} onClick={() => e.id && setSel(e.id)}>
                <span className="rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                <span className="who">{e.name}<TierBadge tier={e.tier} /></span>
                <span className="score">{(e.score ?? 0).toLocaleString()}</span>
                <span className="muted">Lvl {e.totalLevel ?? e.level} · 🔥{e.streak} · {e.ach}🏆</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {sheet && (
        <section className="card">
          <h2>{sheet.name ?? "Player"} — Total Level {sheet.totalLevel} <span className="muted">/ {skills.length}</span></h2>
          <div className="grid">
            {skills.map((s) => (
              <div className={`skill${s.level >= 99 ? " maxed" : ""}`} key={s.id} title={`${s.xp.toLocaleString()} xp · ${s.pct}% to ${s.level + 1}`}>
                <span className="ic">{s.icon}</span>
                <span className="nm">{s.name}</span>
                <span className="lv">{s.level}</span>
                <span className="barT"><span className="barF" style={{ width: `${s.pct}%` }} /></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};

// ── Pricing ────────────────────────────────────────────────────────────────
const Pricing = ({ cfg, account, onSubscribe, busy, onLogIn }: { cfg: StripeConfig | null; account: Account | null; onSubscribe: (t: Tier) => void; busy: string | null; onLogIn: () => void }) => {
  const current = account?.billing.tier ?? "free";
  const info = cfg?.tiers;
  return (
    <section className="card">
      <h2>Plans</h2>
      <p className="muted hint">Renown is <strong>free forever</strong> — every skill, achievement, 1-of-1 and your leaderboard rank. Paid tiers are a thank-you that keeps the lights on. No pay-to-win, ever.</p>
      <div className="tiers">
        {ORDER.map((t) => {
          const ti = info?.[t];
          const isCurrent = current === t;
          const amt = t === "free" ? "Free" : money(cfg?.amounts[t]) || "—";
          return (
            <div className={`tier ${t}${isCurrent ? " current" : ""}`} key={t}>
              {isCurrent && <span className="pill">Your plan</span>}
              <h3>{ti?.name ?? t}</h3>
              <div className="price">{amt}{t !== "free" && <span className="per"> </span>}</div>
              <p className="blurb">{ti?.blurb}</p>
              <ul className="perks">{(ti?.perks ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
              {t === "free" ? (
                <button className="btn ghost" disabled>{current === "free" ? "Current" : "Included"}</button>
              ) : !account ? (
                <button className="btn solid" onClick={onLogIn}>Log in to subscribe</button>
              ) : isCurrent ? (
                <button className="btn ghost" disabled>Current plan</button>
              ) : !cfg?.configured ? (
                <button className="btn ghost" disabled>Coming soon</button>
              ) : (
                <button className="btn solid" disabled={busy === t} onClick={() => onSubscribe(t)}>
                  {busy === t ? "Redirecting…" : current === "free" ? `Get ${ti?.name}` : current === "supporter" && t === "pro" ? "Upgrade to Pro" : `Switch to ${ti?.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ── GitHub sync card ───────────────────────────────────────────────────────
const GithubSyncCard = ({ gh, refresh, onBanner }: { gh: GithubSync | null; refresh: () => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const [busy, setBusy] = useState(false);
  if (!gh) return (
    <section className="card">
      <h2>GitHub sync</h2>
      <p className="hint">Link your GitHub account above to start earning a <strong>verified score</strong> on the leaderboard. We recompute from your real public repos, stars, contributions to others' projects, and account age — never anything you can fake locally.</p>
    </section>
  );
  const sync = async () => {
    setBusy(true);
    const r = await post("/api/verify", { login: gh.login });
    setBusy(false);
    const j = r.data as { ok?: boolean; score?: number; attributionDelta?: number; throttled?: boolean; tier?: string; error?: string } | null;
    if (!r.ok || j?.error) { onBanner({ kind: "warn", text: j?.error ?? "Sync failed." }); return; }
    refresh();
    if (j?.throttled) onBanner({ kind: "info", text: `Sync cooldown hit (${j.tier ?? "your tier"}). Showing the last verified score.` });
    else {
      const delta = j?.attributionDelta ?? 0;
      onBanner({ kind: "ok", text: `✓ Synced from GitHub — verified score ${(j?.score ?? gh.verifiedScore).toLocaleString()}${delta ? ` (+${delta.toLocaleString()} new attributions)` : ""}.` });
    }
  };
  return (
    <section className="card">
      <div className="acctHead">
        <div>
          <h2>GitHub sync</h2>
          <p className="muted">Linked to <strong>@{gh.login}</strong> {gh.verified ? <span className="primary">verified</span> : <span className="tierBadge supporter">unverified</span>}</p>
        </div>
        <button className="btn solid" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
      </div>
      <div className="syncStats">
        <div className="stat">
          <span className="num">{gh.verifiedScore.toLocaleString()}</span>
          <span className="lbl">verified score</span>
          {gh.attributionScore > 0 && <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>{gh.baseScore.toLocaleString()} base + {gh.attributionScore.toLocaleString()} attribution</span>}
        </div>
        <div className="stat"><span className="num">{gh.totalLevel.toLocaleString()}</span><span className="lbl">total level</span></div>
        <div className="stat"><span className="num">{gh.verifiedAt ? when(gh.verifiedAt) : "—"}</span><span className="lbl">last synced</span></div>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Verified score = base (your public repos/stars/ext-contribs/account age){gh.attributionQuery ? <> + attribution (commits where you're credited via <code>{gh.attributionQuery}</code>, counted only since your last sync — never double-counted)</> : null}. Refresh cadence is tier-based (free 10 min · supporter 2 min · pro ~on demand).
      </p>
    </section>
  );
};

// ── CLI sync (push your local progress to the web) ────────────────────────
const CliSyncCard = ({ onBanner }: { onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const CMD = "renown sync";
  const copy = async () => {
    try { await navigator.clipboard.writeText(CMD); onBanner({ kind: "ok", text: "Copied — paste it in your terminal." }); }
    catch { onBanner({ kind: "warn", text: "Copy failed — select and copy the command manually." }); }
  };
  return (
    <section className="card">
      <h2>Sync from your CLI</h2>
      <p className="hint">Your terminal tracks XP locally and pushes to the web on every tick. If the web feels out of sync, force an immediate push:</p>
      <div className="cliBox">
        <code>{CMD}</code>
        <button className="btn ghost sm" onClick={copy}>Copy</button>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>This sends your local skill levels + activity to the server so this page matches your terminal. Reload after.</p>
    </section>
  );
};

// ── Account ────────────────────────────────────────────────────────────────
const AccountView = ({ account, cfg, user, refresh, onManage, onSubscribe, busy, act, onBanner }:
  { account: Account; cfg: StripeConfig | null; user: { email?: string; first_name?: string } | null; refresh: () => void; onManage: () => void; onSubscribe: (t: Tier) => void; busy: string | null; act: (fn: () => Promise<{ ok: boolean; data: unknown }>) => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const { billing, identities, mergeRequests } = account;
  const name = user?.first_name || user?.email || "your account";
  const paid = billing.tier !== "free";
  return (
    <>
      <section className="card">
        <div className="acctHead">
          <div>
            <h2>Subscription</h2>
            <p className="muted">Signed in as <strong>{name}</strong></p>
          </div>
          <span className={`tierChip ${billing.tier}`}>{(cfg?.tiers[billing.tier]?.name ?? billing.tier)}</span>
        </div>
        {paid ? (
          <>
            <p className="subline">
              {billing.status === "active" ? "Active" : billing.status ?? "—"}
              {billing.currentPeriodEnd && ` · ${billing.status === "canceled" ? "ends" : "renews"} ${when(billing.currentPeriodEnd)}`}
            </p>
            <div className="row">
              <button className="btn solid" disabled={busy === "portal"} onClick={onManage}>{busy === "portal" ? "Opening…" : "Manage subscription"}</button>
              {billing.tier === "supporter" && cfg?.configured && (
                <button className="btn ghost" disabled={busy === "pro"} onClick={() => onSubscribe("pro")}>Upgrade to Pro</button>
              )}
            </div>
            <p className="muted hint">Manage billing, change plan, update card, or cancel anytime in the Stripe portal.</p>
          </>
        ) : (
          <>
            <p className="subline">You're on the free plan — the whole game, forever.</p>
            <div className="row">
              {cfg?.configured ? (
                <>
                  <button className="btn solid" disabled={busy === "supporter"} onClick={() => onSubscribe("supporter")}>Become a Supporter {money(cfg.amounts.supporter) && `· ${money(cfg.amounts.supporter)}`}</button>
                  <button className="btn ghost" disabled={busy === "pro"} onClick={() => onSubscribe("pro")}>Go Pro {money(cfg.amounts.pro) && `· ${money(cfg.amounts.pro)}`}</button>
                </>
              ) : <p className="muted">Billing isn't configured on this server yet.</p>}
            </div>
          </>
        )}
      </section>

      <GithubSyncCard gh={account.github} refresh={refresh} onBanner={onBanner} />
      <CliSyncCard onBanner={onBanner} />

      <section className="card">
        <h2>Your logins</h2>
        <p className="muted hint">Sign in with any of these — they all reach this one account.</p>
        <ul className="idents">
          {identities.map((id) => (
            <li key={id.id}>
              <span className={`dot ${PROVIDERS[id.provider]?.cls ?? ""}`} />
              <span className="idp">{providerLabel(id.provider)}</span>
              {id.isPrimary && <span className="primary">primary</span>}
              <span className="idsub muted">{id.subject}</span>
              <span className="idActions">
                {!id.isPrimary && <button className="link" onClick={() => act(() => post(`/api/account/identities/${id.id}/primary`))}>Make primary</button>}
                {identities.length > 1 && !id.isPrimary && <button className="link danger" onClick={() => act(() => api(`/api/account/identities/${id.id}`, { method: "DELETE" }))}>Unlink</button>}
              </span>
            </li>
          ))}
        </ul>
        <div className="row">
          {Object.entries(PROVIDERS).filter(([p]) => !identities.some((i) => i.provider === p)).map(([p, v]) => (
            <a className={`btn ${v.cls}`} href={v.href} key={p}>Link {v.label}</a>
          ))}
        </div>
      </section>

      {mergeRequests.length > 0 && (
        <section className="card warn">
          <h2>Pending account merges</h2>
          <p className="muted hint">A login you tried to add already belongs to another account. Accept to fold it into this one.</p>
          <ul className="idents">
            {mergeRequests.map((m) => (
              <li key={m.id}>
                <span className={`dot ${PROVIDERS[m.provider]?.cls ?? ""}`} />
                <span className="idp">{providerLabel(m.provider)}</span>
                <span className="idsub muted">{m.subject}</span>
                <span className="idActions">
                  <button className="link" onClick={() => act(() => post(`/api/account/merge-requests/${m.id}/merge`))}>Accept</button>
                  <button className="link danger" onClick={() => act(() => api(`/api/account/merge-requests/${m.id}`, { method: "DELETE" }))}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="link signout" onClick={() => act(async () => { const r = await api("/oauth2/signout", { method: "DELETE" }); refresh(); return r; })}>Sign out</button>
    </>
  );
};

// ── Auth (email + password) ────────────────────────────────────────────────
const AuthView = ({ initial, onAuthed, onBanner }: { initial: "login" | "register" | "forgot"; onAuthed: () => void; onBanner: (b: { kind: "ok" | "info" | "warn"; text: string }) => void }) => {
  const [mode, setMode] = useState<"login" | "register" | "forgot">(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const url = mode === "login" ? "/auth/login" : mode === "register" ? "/auth/register" : "/auth/reset-password/request";
    const body = mode === "forgot" ? { email } : { email, password };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) {
      if (mode === "login") { onAuthed(); }
      else if (mode === "register") { onBanner({ kind: "info", text: "✉ Account created — check the server console for your verify link." }); setMode("login"); }
      else { onBanner({ kind: "info", text: "Reset link generated — check the server console." }); setMode("login"); }
    } else {
      const j = await r.json().catch(() => null) as { error?: string; message?: string } | null;
      setErr(j?.error ?? j?.message ?? `Failed (${r.status}). ${r.status === 403 ? "Verify your email first." : ""}`);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 460, margin: "20px auto" }}>
      <div className="tabRow">
        <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(null); }}>Log in</button>
        <button className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setErr(null); }}>Sign up</button>
        <button className={mode === "forgot" ? "on" : ""} onClick={() => { setMode("forgot"); setErr(null); }}>Forgot</button>
      </div>
      <form className="form" onSubmit={submit}>
        <div className="field"><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        {mode !== "forgot" && (
          <div className="field"><label>Password</label><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>
        )}
        {err && <div className="field"><span className="err">{err}</span></div>}
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "…" : mode === "login" ? "Log in" : mode === "register" ? "Create account" : "Send reset link"}</button>
      </form>
      <div className="muted" style={{ textAlign: "center", margin: "12px 0 8px" }}>or</div>
      <div className="cta">
        <a className="btn gh" href={PROVIDERS.github.href}>GitHub</a>
        <a className="btn gg" href={PROVIDERS.google.href}>Google</a>
      </div>
    </section>
  );
};

// ── Reset password (after clicking the reset link) ────────────────────────
const ResetView = ({ token, onDone }: { token: string; onDone: (ok: boolean, msg: string) => void }) => {
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const r = await fetch("/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: pw }) });
    setBusy(false);
    if (r.ok) onDone(true, "Password updated — please log in.");
    else { const j = await r.json().catch(() => null) as { error?: string } | null; setErr(j?.error ?? `Failed (${r.status})`); }
  };
  return (
    <section className="card" style={{ maxWidth: 460, margin: "20px auto" }}>
      <h2>Set a new password</h2>
      <form className="form" onSubmit={submit}>
        <div className="field"><label>New password</label><input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {err && <div className="field"><span className="err">{err}</span></div>}
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "…" : "Update password"}</button>
      </form>
    </section>
  );
};

const App = () => {
  const [view, setView] = useState<"board" | "pricing" | "account" | "auth" | "reset">("board");
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [top, setTop] = useState<Entry[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SkillSheet | null>(null);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [user, setUser] = useState<{ email?: string; first_name?: string } | null>(null);
  const [cfg, setCfg] = useState<StripeConfig | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "info" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const r = await api("/api/account/");
    setAccount(r.ok ? (r.data as Account) : null);
    if (r.ok) { const s = await api("/oauth2/status"); setUser(s.ok ? ((s.data as { user?: { email?: string; first_name?: string } }).user ?? null) : null); }
    else setUser(null);
  }, []);

  // leaderboard — hydrate once, then refetch when the hub says "top" changed (no polling)
  useEffect(() => {
    const load = () => fetch("/api/top?n=10").then((r) => r.json()).then((d: Entry[]) => { setTop(d); setSel((cur) => cur ?? d[0]?.id ?? null); }).catch(() => {});
    load();
    const es = new EventSource("/sync?topics=top");
    es.onmessage = load;
    return () => es.close();
  }, []);

  // selected player's full skill sheet — live on that player's topic (and any "top" change)
  useEffect(() => {
    if (!sel) return undefined;
    const load = () => fetch(`/api/skills?id=${encodeURIComponent(sel)}`).then((r) => r.json()).then(setSheet).catch(() => {});
    load();
    const es = new EventSource(`/sync?topics=player:${encodeURIComponent(sel)},top`);
    es.onmessage = load;
    return () => es.close();
  }, [sel]);

  // account + pricing config, and any redirect-back banner from Stripe / linking
  useEffect(() => {
    loadAccount();
    api("/stripe/config").then((r) => r.ok && setCfg(r.data as StripeConfig));
    const q = new URLSearchParams(window.location.search);
    const billing = q.get("billing"), linked = q.get("linked"), merge = q.get("merge");
    const verify = q.get("verify"), reset = q.get("reset");
    if (billing === "success") setBanner({ kind: "ok", text: "🎉 Subscription active — thank you for supporting renown!" });
    else if (billing === "cancel") setBanner({ kind: "info", text: "Checkout canceled — no charge made." });
    else if (billing === "portal") setBanner({ kind: "info", text: "Billing updated." });
    else if (linked && linked !== "already") setBanner({ kind: "ok", text: `Linked your ${providerLabel(linked)} login.` });
    else if (linked === "already") setBanner({ kind: "info", text: "That login is already on your account." });
    else if (merge === "pending") setBanner({ kind: "warn", text: "That login belongs to another account — see Account to merge." });
    if (billing || linked || merge) { setView("account"); window.history.replaceState({}, "", window.location.pathname); }
    if (verify) {
      fetch("/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) })
        .then((r) => { if (r.ok) { setBanner({ kind: "ok", text: "Email verified — you can log in now." }); setAuthMode("login"); setView("auth"); } else setBanner({ kind: "warn", text: "Verify link is invalid or expired." }); });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (reset) { setResetToken(reset); setView("reset"); window.history.replaceState({}, "", window.location.pathname); }
  }, [loadAccount]);

  const act = useCallback((fn: () => Promise<{ ok: boolean; data: unknown }>) => {
    (async () => { const r = await fn(); if (r.ok && r.data && typeof r.data === "object" && "identities" in (r.data as object)) setAccount(r.data as Account); else loadAccount(); })();
  }, [loadAccount]);

  const subscribe = useCallback(async (tier: Tier) => {
    setBusy(tier);
    const r = await post("/billing/checkout", { tier });
    if (r.ok && (r.data as { url?: string })?.url) window.location.href = (r.data as { url: string }).url;
    else { setBusy(null); setBanner({ kind: "warn", text: r.status === 401 ? "Please log in first." : "Couldn't start checkout." }); }
  }, []);
  const manage = useCallback(async () => {
    setBusy("portal");
    const r = await post("/billing/portal");
    if (r.ok && (r.data as { url?: string })?.url) window.location.href = (r.data as { url: string }).url;
    else { setBusy(null); setBanner({ kind: "warn", text: "Couldn't open the billing portal." }); }
  }, []);

  const signedIn = !!account;
  return (
    <main className="wrap">
      <header className="topbar">
        <div className="brand" onClick={() => setView("board")}><Logomark size={24} /><span>Renown</span></div>
        <nav className="nav">
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>Leaderboard</button>
          <button className={view === "pricing" ? "on" : ""} onClick={() => setView("pricing")}>Plans</button>
          {signedIn && <button className={view === "account" ? "on" : ""} onClick={() => setView("account")}>Account</button>}
        </nav>
        <div className="authbox">
          {account === undefined ? null : signedIn ? (
            <button className="me" onClick={() => setView("account")}>
              <TierBadge tier={account!.billing.tier} />
              <span>{user?.first_name || user?.email || "Account"}</span>
            </button>
          ) : (
            <button className="btn solid sm" onClick={() => { setAuthMode("login"); setView("auth"); }}>Log in</button>
          )}
        </div>
      </header>

      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span><button onClick={() => setBanner(null)}>✕</button></div>}

      {view === "board" && (
        <>
          {!signedIn && (
            <section className="hero">
              <h1>Earn <span className="accent">renown</span> for real dev work</h1>
              <p className="tag">XP, 100 skills, achievements and 1-of-1s for meritorious work — in any editor. Free, forever.</p>
              <div className="cta">
                <button className="btn solid" onClick={() => { setAuthMode("register"); setView("auth"); }}>Get started</button>
                <button className="btn ghost" onClick={() => { setAuthMode("login"); setView("auth"); }}>I have an account</button>
              </div>
            </section>
          )}
          <Board top={top} sel={sel} setSel={(id) => setSel(id)} sheet={sheet} />
        </>
      )}
      {view === "pricing" && <Pricing cfg={cfg} account={account ?? null} onSubscribe={subscribe} busy={busy} onLogIn={() => { setAuthMode("login"); setView("auth"); }} />}
      {view === "account" && (signedIn
        ? <AccountView account={account!} cfg={cfg} user={user} refresh={loadAccount} onManage={manage} onSubscribe={subscribe} busy={busy} act={act} onBanner={setBanner} />
        : <section className="card"><h2>Account</h2><p className="muted">Log in to manage your account and subscription.</p><div className="cta"><button className="btn solid" onClick={() => { setAuthMode("login"); setView("auth"); }}>Log in</button><button className="btn ghost" onClick={() => { setAuthMode("register"); setView("auth"); }}>Sign up</button></div></section>)}
      {view === "auth" && <AuthView initial={authMode} onAuthed={() => { loadAccount(); setView("account"); setBanner({ kind: "ok", text: "Welcome back." }); }} onBanner={setBanner} />}
      {view === "reset" && resetToken && <ResetView token={resetToken} onDone={(ok, msg) => { setBanner({ kind: ok ? "ok" : "warn", text: msg }); setView("auth"); setResetToken(null); }} />}

      <footer className="foot">by AbsoluteJS · <a href="https://github.com/absolutejs/renown">github.com/absolutejs/renown</a></footer>
    </main>
  );
};

type RenownHomeProps = { cssPath?: string; url?: string };
export const RenownHome = ({ cssPath }: RenownHomeProps) => (
  <html lang="en">
    <Head cssPath={cssPath} title="Renown — earn XP for real dev work" />
    <body>
      <App />
    </body>
  </html>
);
