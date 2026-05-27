import { Head } from "@absolutejs/absolute/react/components";
import { createSyncSubscriber } from "@absolutejs/sync/client";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Tier = "free" | "supporter" | "pro";
type Admin = { sub: string; email: string; name: string | null; last_login_at: string | null };
type AdminUser = {
  sub: string; email: string | null; name: string | null;
  tier: Tier; status: string | null; hasCustomer: boolean;
  currentPeriodEnd: string | null; identities: string[]; created_at: string;
};

const Logomark = ({ size = 22 }: { size?: number }) => (
  <svg className="logo" viewBox="0 0 300 300" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M66.4,274.3c68.4,46.3,161.5,28.4,207.8-40,46.3-68.4,28.4-161.5-40-207.8C165.8-19.9,72.7-2,26.4,66.4-19.9,134.9-2,227.9,66.4,274.3ZM48,116.7c-17.1,52.6-11.4,105.2,11.3,139.7C18,217.4,7.3,150.3,36.9,92.3,55.9,55.2,87.6,29.4,122.5,18.3c-31.9,18.4-59.9,53.5-74.5,98.3ZM175.3,283.1c36-10.5,68.9-36.8,88.3-74.8,29.4-57.5,19.1-123.9-21.3-163.1,21.8,34.5,27,86.3,10.2,138-15,46.1-44.2,82-77.3,99.8ZM183.6,266.2c24.3-20.8,44.4-55.6,53.3-97.4,14.1-66.1-4.4-127.6-41.8-148.1,19.9,26.7,29.9,78.6,23.7,136.7-4.7,44.4-18,83.3-35.2,108.9ZM63.7,131.8c-14.2,66.6,4.7,128.5,42.7,148.6-20.4-26.4-30.8-78.9-24.5-137.7,4.7-43.7,17.6-82,34.3-107.6-24,20.9-43.7,55.4-52.5,96.7ZM199.8,149.6c1.1,67.9-20.2,123.3-47.6,123.7-27.4.4-50.4-54.3-51.5-122.2-1.1-67.9,20.2-123.3,47.6-123.7,27.4-.4,50.4,54.3,51.5,122.2Z" />
  </svg>
);

const Login = ({ onAuthed }: { onAuthed: () => void }) => {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const r = await fetch("/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (r.ok) onAuthed();
    else setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${r.status})`);
  };
  return (
    <section className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
      <h2>Admin sign in</h2>
      <p className="hint">Restricted area. Admin credentials only — separate from regular accounts.</p>
      <form className="form" onSubmit={submit}>
        <div className="field"><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        <div className="field"><label>Password</label><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        {err && <div className="field"><span className="err">{err}</span></div>}
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "…" : "Sign in"}</button>
      </form>
    </section>
  );
};

const Dashboard = ({ admin, onSignOut }: { admin: Admin; onSignOut: () => void }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (r.ok) setUsers(await r.json());
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const setTier = async (sub: string, tier: Tier) => {
    setBusy(sub);
    const r = await fetch(`/api/admin/users/${sub}/tier`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier }) });
    setBusy(null);
    if (r.ok) { setBanner({ kind: "ok", text: `Tier set to ${tier}.` }); load(); }
    else setBanner({ kind: "warn", text: `Failed to set tier.` });
  };

  const stats = {
    total: users.length,
    paying: users.filter(u => u.tier !== "free").length,
    pro: users.filter(u => u.tier === "pro").length,
    supporter: users.filter(u => u.tier === "supporter").length,
  };

  return (
    <>
      {banner && <div className={`banner ${banner.kind}`}><span>{banner.text}</span><button onClick={() => setBanner(null)}>✕</button></div>}
      <section className="card">
        <div className="acctHead">
          <div>
            <h2>Overview</h2>
            <p className="muted">Signed in as <strong>{admin.email}</strong></p>
          </div>
          <div className="row" style={{ marginTop: 0 }}>
            <span className="tierChip free">{stats.total} users</span>
            <span className="tierChip supporter">{stats.supporter} supporter</span>
            <span className="tierChip pro">{stats.pro} pro</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Users</h2>
        <p className="hint">Override a tier with the dropdown — sets <code>users.tier</code> and mirrors to the player's leaderboard badge.</p>
        <div className="form" style={{ maxWidth: 320, marginTop: 0 }}>
          <div className="field"><input type="search" placeholder="Search by email or name…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <table className="atable">
          <thead><tr><th>Email</th><th>Tier</th><th>Status</th><th>Logins</th><th>Created</th><th>Override</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.sub}>
                <td>{u.email ?? <span className="muted">(no email)</span>}{u.name && <div className="muted" style={{ fontSize: 12 }}>{u.name}</div>}</td>
                <td><span className={`tierChip ${u.tier}`}>{u.tier}</span></td>
                <td className="muted">{u.status ?? "—"}{u.currentPeriodEnd && <div style={{ fontSize: 11 }}>until {new Date(u.currentPeriodEnd).toLocaleDateString()}</div>}</td>
                <td className="muted">{u.identities.length ? u.identities.join(", ") : "—"}</td>
                <td className="muted">{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <select disabled={busy === u.sub} value={u.tier} onChange={(e) => setTier(u.sub, e.target.value as Tier)}>
                    <option value="free">free</option><option value="supporter">supporter</option><option value="pro">pro</option>
                  </select>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>No users found.</td></tr>}
          </tbody>
        </table>
      </section>

      <AttestationsPanel />
      <WebhookDeliveriesPanel />
      <button className="link signout" onClick={onSignOut}>Sign out</button>
    </>
  );
};

// Outbound webhook delivery log — one row per attempt. Filtering on `failed` is the
// useful default for ops; flipping it off shows every successful delivery too. Each
// row gets a Replay button calling the existing /:id/replay endpoint.
type DeliveryRow = { id: string; eventKind: string; url: string; payload: unknown; attempt: number; statusCode: number | null; attemptedAt: string; lastError: string | null };
const WebhookDeliveriesPanel = () => {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [failedOnly, setFailedOnly] = useState(true);
  const [eventKind, setEventKind] = useState("");
  const load = useCallback(async () => {
    const q = new URLSearchParams({ n: "100" });
    if (failedOnly) q.set("failed", "true");
    if (eventKind) q.set("eventKind", eventKind);
    const r = await fetch(`/api/admin/webhook-deliveries?${q.toString()}`);
    if (r.ok) setRows(await r.json());
  }, [failedOnly, eventKind]);
  useEffect(() => { load(); }, [load]);
  const replay = async (id: string) => {
    if (!confirm("Replay this delivery? It re-runs the retry-and-log loop against the currently-configured webhook URL (RENOWN_ATTESTATION_WEBHOOK), adding fresh rows to this log for each attempt.")) return;
    const res = await fetch(`/api/admin/webhook-deliveries/${id}/replay`, { method: "POST" });
    if (res.ok) load();
    else alert("replay failed");
  };
  return (
    <section className="card">
      <h2>Webhook deliveries <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {rows.length} {failedOnly ? "failed" : "recent"}</span></h2>
      <p className="hint">One row per delivery attempt to <code>RENOWN_ATTESTATION_WEBHOOK</code>. Failed deliveries (no status, or HTTP &ge; 400) are the dead-letter pile — use Replay to re-run them through the same retry-and-log loop.</p>
      <div className="form" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 0 }}>
        <label className="field" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> failed only
        </label>
        <div className="field"><input type="text" placeholder="event kind (e.g. attestation.verified)" value={eventKind} onChange={(e) => setEventKind(e.target.value)} /></div>
      </div>
      <table className="atable" style={{ marginTop: 12 }}>
        <thead><tr><th>When</th><th>Event</th><th>URL</th><th>Attempt</th><th>Status</th><th>Error</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="muted" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{new Date(r.attemptedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
              <td><code style={{ fontSize: 11 }}>{r.eventKind}</code></td>
              <td className="muted" style={{ fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>{r.url}</td>
              <td>{r.attempt}</td>
              <td>{r.statusCode == null ? <span className="muted">net err</span> : r.statusCode >= 200 && r.statusCode < 300 ? <span style={{ color: "#86efac" }}>{r.statusCode}</span> : <span style={{ color: "#ffb478" }}>{r.statusCode}</span>}</td>
              <td className="muted" style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.lastError ?? ""}>{r.lastError ?? "—"}</td>
              <td><button className="link" style={{ fontSize: 11 }} onClick={() => replay(r.id)}>replay</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 20 }}>No deliveries match these filters.</td></tr>}
        </tbody>
      </table>
    </section>
  );
};

// Admin attestations dashboard — every claim/verify/clear across the platform with
// per-field filters. Paired with the webhook_deliveries replay endpoint (same admin
// realm), this is the real ops console for the AI participation layer.
type AttEvent = { id: string; at: string; kind: string; provider: string | null; evidenceUrl: string | null; verified: boolean; actorKind: string | null; actorSub: string | null; playerId: string; login: string | null; handle: string };
const AttestationsPanel = () => {
  const [rows, setRows] = useState<AttEvent[]>([]);
  const [providerFilter, setProviderFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState<"" | "true" | "false">("");
  const [loginFilter, setLoginFilter] = useState("");
  const load = useCallback(async () => {
    const q = new URLSearchParams({ n: "100" });
    if (providerFilter) q.set("provider", providerFilter);
    if (kindFilter) q.set("kind", kindFilter);
    if (verifiedFilter) q.set("verified", verifiedFilter);
    if (loginFilter) q.set("login", loginFilter);
    const r = await fetch(`/api/admin/attestations?${q.toString()}`);
    if (r.ok) setRows(await r.json());
  }, [providerFilter, kindFilter, verifiedFilter, loginFilter]);
  useEffect(() => { load(); }, [load]);
  // Live subscribe — applyAttestation publishes to 'attestation-events' on every
  // claim / verify / clear. Re-runs load() on each event so the table reflects the
  // current filtered view without polling.
  useEffect(() => {
    const sub = createSyncSubscriber({ topics: ["attestation-events"], onEvent: load });
    return () => sub.close();
  }, [load]);
  return (
    <section className="card">
      <h2>Attestations <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {rows.length} events</span></h2>
      <p className="hint">Append-only log of every AI attestation state change. Read-only — clears, claims, and verifications all show up. Use filters to scope a specific provider, kind, or player.</p>
      <div className="form" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 0 }}>
        <div className="field"><input type="text" placeholder="provider (anthropic / dev / …)" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} /></div>
        <div className="field"><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">all kinds</option><option value="claimed">claimed</option><option value="verified">verified</option><option value="cleared">cleared</option></select></div>
        <div className="field"><select value={verifiedFilter} onChange={(e) => setVerifiedFilter(e.target.value as "" | "true" | "false")}><option value="">verified: any</option><option value="true">verified only</option><option value="false">unverified only</option></select></div>
        <div className="field"><input type="text" placeholder="login (e.g. claude)" value={loginFilter} onChange={(e) => setLoginFilter(e.target.value)} /></div>
      </div>
      <table className="atable" style={{ marginTop: 12 }}>
        <thead><tr><th>When</th><th>Login</th><th>Kind</th><th>Provider</th><th>Verified</th><th>Actor</th><th>Evidence</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{new Date(r.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
              <td>@{r.login ?? "(unlinked)"}</td>
              <td><span className={`tierChip ${r.kind === "verified" ? "pro" : r.kind === "cleared" ? "free" : "supporter"}`}>{r.kind}</span></td>
              <td>{r.provider ?? <span className="muted">—</span>}</td>
              <td>{r.verified ? "✓" : <span className="muted">—</span>}</td>
              <td className="muted" style={{ fontSize: 11 }}>{r.actorKind ? r.actorKind : <span style={{ opacity: .6 }}>—</span>}</td>
              <td>{r.evidenceUrl ? <a href={r.evidenceUrl} target="_blank" rel="noreferrer">link ↗</a> : <span className="muted">—</span>}</td>
              <td>
                {r.login && r.kind !== "cleared" && (
                  <button
                    className="link"
                    style={{ fontSize: 11, color: "#ffb478" }}
                    onClick={async () => {
                      if (!confirm(`Force-clear @${r.login}'s attestation? They lose is_ai + the attestation jsonb; attribution_query is reset to author:${r.login}. The action is logged.`)) return;
                      const res = await fetch(`/api/admin/attestations/${encodeURIComponent(r.login!)}/clear`, { method: "POST" });
                      if (res.ok) load();
                      else alert("clear failed");
                    }}
                  >force-clear</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 20 }}>No events match these filters.</td></tr>}
        </tbody>
      </table>
    </section>
  );
};

const App = () => {
  const [admin, setAdmin] = useState<Admin | null | undefined>(undefined);
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/me");
    setAdmin(r.ok ? await r.json() : null);
  }, []);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { await fetch("/admin/logout", { method: "DELETE" }); setAdmin(null); };

  return (
    <main className="wrap">
      <header className="topbar">
        <a className="brand" href="/" style={{ textDecoration: "none" }}><Logomark size={24} /><span>Renown <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>· admin</span></span></a>
        <div className="authbox">
          {admin && <a className="adminLink" href="/">← user site</a>}
        </div>
      </header>
      {admin === undefined ? <p className="muted" style={{ textAlign: "center", padding: 40 }}>Loading…</p>
        : admin ? <Dashboard admin={admin} onSignOut={signOut} />
        : <Login onAuthed={load} />}
      <footer className="foot">by AbsoluteJS · admin portal</footer>
    </main>
  );
};

type Props = { cssPath?: string };
export const RenownAdmin = ({ cssPath }: Props) => (
  <html lang="en">
    <Head cssPath={cssPath} title="Renown — admin" />
    <body><App /></body>
  </html>
);
