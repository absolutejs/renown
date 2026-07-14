// Public /achievement/:id page — a shareable page for one achievement: its tier emoji, name,
// description, live rarity %, and recent earners (with pets, linking to profiles). Secret/hidden
// achievements are shown redacted. Lightweight (no three.js). OG meta → the achievement OG card.
import { Head } from "@absolutejs/absolute/react/components";
import { SiteHeader } from "../components/SiteHeader";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

const petSvgHtml = (seed: string, box: number) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box });
  return `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>`;
};
const PetSprite = ({ seed, box }: { seed: string; box: number }) => (
  <span style={{ width: box, height: box, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: petSvgHtml(seed, box) }} />
);

type Earner = { login: string; avatarSeed: string | null; isAi: boolean; tier: string; at: string | null };
type AchievementForUI = {
  id: string; name: string; description: string; category: string; tier: string; generated: boolean; secret: boolean;
  unlocks: number; players: number; rarity: number; earners: Earner[];
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n.toLocaleString("en-US"));
const TIER_EMOJI: Record<string, string> = { mythic: "🏆", platinum: "💠", gold: "🥇", silver: "🥈", bronze: "🥉", secret: "🔒" };

const NotFound = ({ id }: { id: string }) => (
  <main className="wrap profilePage">
    <SiteHeader back={{ href: "/achievements", label: "Back to achievements" }} />
    <section className="card" style={{ textAlign: "center" }}>
      <h1>No such achievement</h1>
      <p className="muted"><code>{id}</code> isn't in the catalog.</p>
    </section>
  </main>
);

const Body = ({ a }: { a: AchievementForUI }) => {
  const emoji = TIER_EMOJI[a.tier] ?? (a.secret ? "🔒" : "✦");
  const rarityText = a.unlocks === 0 ? "No one has unlocked it yet — be the first." : `${a.rarity}% of ${fmt(a.players)} players have it (${fmt(a.unlocks)} unlock${a.unlocks === 1 ? "" : "s"}).`;
  return (
    <main className="wrap profilePage">
      <SiteHeader back={{ href: "/achievements", label: "Back to achievements" }} />

      <section className="card" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ fontSize: 64, lineHeight: 1, flexShrink: 0 }}>{emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="muted" style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 12, fontWeight: 700 }}>{a.category}{a.generated ? " · generated" : ""}{a.tier ? ` · ${a.tier}` : ""}</p>
          <h1 style={{ margin: "2px 0 6px" }}>{a.name}</h1>
          <p className="muted">{a.description}</p>
          <p style={{ marginTop: 10, fontWeight: 700, color: "#c4b5fd" }}>{rarityText}</p>
        </div>
      </section>

      {a.earners.length > 0 && (
        <section className="card">
          <h2>Recently earned by</h2>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {a.earners.map((e) => (
              <a key={e.login} href={`/profile/${encodeURIComponent(e.login)}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, textDecoration: "none", color: "inherit", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                {e.avatarSeed && <PetSprite seed={e.avatarSeed} box={34} />}
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{e.login}{e.isAi && <span style={{ fontSize: 11, opacity: 0.7 }}> 🤖</span>}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Earn it</h2>
        <p className="muted">Renown awards thousands of achievements for real dev work — earned by the craft and importance of what you ship.</p>
        <p className="muted" style={{ marginTop: 8 }}><code>bun add -g @absolutejs/renown</code> → <code>renown link</code>.</p>
      </section>
    </main>
  );
};

type RenownAchievementProps = { cssPath?: string; achievement?: AchievementForUI | null; id?: string; origin?: string; shareSnippet?: string };

export const RenownAchievement = ({ cssPath, achievement = null, id = "", origin = "", shareSnippet = "A renown achievement for real dev work." }: RenownAchievementProps) => {
  const aid = achievement?.id ?? id;
  const fullUrl = `${origin}/achievement/${encodeURIComponent(aid)}`;
  const title = achievement ? `${achievement.name} · renown achievement` : `${id} — not found`;
  const image = achievement ? `${origin}/achievement/${encodeURIComponent(achievement.id)}/og.png` : undefined;
  return (
    <html lang="en">
      <Head
        cssPath={cssPath}
        title={title}
        description={shareSnippet}
        canonical={fullUrl}
        openGraph={{ title, description: shareSnippet, type: "website", url: fullUrl, image, imageAlt: title, imageWidth: 1200, imageHeight: 630, siteName: "Renown" }}
        twitter={{ card: "summary_large_image", title, description: shareSnippet, image, imageAlt: title }}
      />
      <body>{achievement ? <Body a={achievement} /> : <NotFound id={aid} />}</body>
    </html>
  );
};
