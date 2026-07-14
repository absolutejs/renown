import { Head } from "@absolutejs/absolute/react/components";
import { useState } from "react";

const Command = ({ children }: { children: string }) => {
  const [copied, setCopied] = useState(false);
  return <button className="guideCommand" onClick={async () => {
    try { await navigator.clipboard.writeText(children); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* clipboard unavailable */ }
  }}><span>$</span><code>{children}</code><em>{copied ? "Copied" : "Copy"}</em></button>;
};

const agents = [
  {
    id: "claude", name: "Claude Code", label: "First-party automatic setup",
    command: "renown install-agent claude",
    details: [
      "Adds a native Claude status line that refreshes every five seconds.",
      "Counts one Claude session at SessionStart and checks for Renown updates in the background.",
      "Runs a heartbeat after each completed turn so agent progress, achievements, the HUD, and your submitted state stay current.",
    ],
  },
  {
    id: "codex", name: "Codex", label: "First-party hooks + optional tmux HUD",
    command: "renown install-agent codex",
    details: [
      "Enables Codex hooks, adds ~/.renown as a writable root, and preserves a backup of config.toml.",
      "Counts one Codex session at SessionStart and runs a heartbeat after each completed turn.",
      "Renown prints progress after turns; run `renown install-agent tmux` for a persistent bottom status bar.",
      "If Codex prompts about new hooks, open /hooks and trust them.",
    ],
  },
  {
    id: "portable", name: "Cursor, Copilot, Aider, Gemini & others", label: "Portable integration",
    command: "renown agent cursor --quiet",
    details: [
      "At session start, run `renown agent <provider> --quiet` using codex, claude, cursor, copilot, aider, gemini, goose, windsurf, openhands, devin, or other.",
      "After substantive work or from a turn-ending hook, run `renown heartbeat`.",
      "Use `renown statusline` for a command-backed footer, or display ~/.renown/hud.txt from file-backed UI chrome.",
      "This contract is editor-agnostic: an integration only needs a session hook, a heartbeat hook, and optionally a status surface.",
    ],
  },
] as const;

type RenownGuideProps = { cssPath?: string; origin?: string };

export const RenownGuide = ({ cssPath, origin = "" }: RenownGuideProps) => {
  const title = "Renown guide — install, link, and wire your coding agent";
  const description = "Install Renown with Bun, link GitHub, and configure Codex, Claude Code, Cursor, Copilot, Aider, Gemini, and other coding agents.";
  const url = `${origin}/guide`;
  return <html lang="en">
    <Head cssPath={cssPath} title={title} description={description} canonical={url}
      openGraph={{ title, description, type: "website", url, siteName: "Renown" }}
      twitter={{ card: "summary", title, description }} />
    <body>
      <main className="wrap guidePage">
        <header className="topbar guideTopbar">
          <a className="brand" href="/">Renown</a>
          <nav className="guideNav"><a href="/">Home</a><a className="on" href="/guide">Guide</a><a href="/pets">Collection</a><a href="/leaderboard">Leaderboard</a></nav>
        </header>

        <section className="guideHero">
          <span className="landingKicker">FROM ZERO TO EARNING</span>
          <h1>Set up Renown once.<br /><span>Keep your workflow.</span></h1>
          <p>Installation gives you the CLI. Linking GitHub proves which public work is yours. Agent wiring keeps progress fresh automatically while you use Codex, Claude, or another coding tool.</p>
          <div className="guideHeroActions"><a className="btn solid" href="#quick-start">Quick start</a><a className="btn ghost" href="#agents">Choose an agent</a></div>
        </section>

        <section className="guideSection" id="quick-start">
          <div className="guideSectionIntro"><span className="landingKicker">QUICK START</span><h2>Four small steps, then play</h2><p>Installing alone does not identify your GitHub work. Complete the link step once; agent wiring is recommended automation.</p></div>
          <ol className="guideSetup">
            <li><span>1</span><div><h3>Install with Bun</h3><p>Install the published CLI globally so <code>renown</code> is available in every repository.</p><Command>bun add -g @absolutejs/renown</Command></div></li>
            <li><span>2</span><div><h3>Authenticate GitHub</h3><p>If <code>gh auth status</code> already succeeds, skip this. Renown uses GitHub CLI authentication; it never asks you to paste a token into the website.</p><Command>gh auth login</Command></div></li>
            <li><span>3</span><div><h3>Link your account</h3><p>This opens the ownership flow, associates your GitHub identity, verifies public work, and pulls the score and pets you have earned.</p><Command>renown link</Command></div></li>
            <li><span>4</span><div><h3>Wire Codex and Claude</h3><p>This installs first-party hooks for both agents and a tmux HUD. Use an individual target if you only want one integration.</p><Command>renown install-agent all</Command></div></li>
          </ol>
          <div className="guideCallout"><strong>That’s enough.</strong><span>Run <code>renown --help</code> to explore the CLI, or keep coding and let the installed hooks refresh your progress. Re-run <code>renown link</code> when you intentionally add another GitHub identity.</span></div>
        </section>

        <section className="guideSection" id="agents">
          <div className="guideSectionIntro"><span className="landingKicker">AGENT INTEGRATIONS</span><h2>Same game, native wiring</h2><p>Every integration reports the same three signals: a session starts, meaningful work happens, and a small HUD can show progress. The host-specific setup only decides where those signals plug in.</p></div>
          <div className="guideAgentGrid">{agents.map((agent) => <article id={`agent-${agent.id}`} key={agent.id}>
            <span className="guideAgentLabel">{agent.label}</span><h3>{agent.name}</h3><Command>{agent.command}</Command>
            <ul>{agent.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </article>)}</div>
        </section>

        <section className="guideSection" id="commands">
          <div className="guideSectionIntro"><span className="landingKicker">WHAT’S AVAILABLE</span><h2>The useful commands</h2></div>
          <div className="guideCommandGrid">
            <article><code>renown link</code><span>Link this install to your GitHub identity and pull verified progress.</span></article>
            <article><code>renown heartbeat</code><span>Refresh agent progress, achievements, the local HUD, and submitted state.</span></article>
            <article><code>renown pet</code><span>Show your current avatar pet, animated in the terminal.</span></article>
            <article><code>renown rarest</code><span>Show the rarest pet in your linked collection.</span></article>
            <article><code>renown switch</code><span>List pets you own and choose a new avatar.</span></article>
            <article><code>renown board</code><span>Show the current repository’s leaderboard, or pass an owner/repo.</span></article>
            <article><code>renown weekly</code><span>Review seven-day attribution, score changes, and new achievements.</span></article>
            <article><code>renown statusline</code><span>Print one compact line for terminal or agent chrome.</span></article>
            <article><code>renown upgrade</code><span>Check for and install the latest published version.</span></article>
          </div>
        </section>

        <section className="guideSection guideHow">
          <div><span className="landingKicker">HOW IT WORKS</span><h2>Local detail, public proof</h2><p>The installed CLI keeps agent activity and the HUD on your machine while the server verifies public GitHub work for rankings, attribution, achievements, and pet ownership. A pet’s commit SHA is its deterministic seed: the same seed always produces the same creature. The Renown source checkout adds the richer local scoring engine and interactive TUI for contributors developing Renown itself.</p></div>
          <div><span className="landingKicker">AUTOMATE A REPOSITORY</span><h2>Credit every contributor in CI</h2><p>Add the Renown GitHub Action when a repository should refresh linked contributors after pushes. Unlinked contributors simply no-op and Renown does not fail their build.</p><pre><code>{`- uses: absolutejs/renown@v1`}</code></pre></div>
        </section>

        <section className="landingFinal guideFinal"><span className="landingKicker">READY</span><h2>Pull your first collection.</h2><p>Install with Bun, link GitHub, then open the game or keep working through your agent.</p><Command>bun add -g @absolutejs/renown</Command></section>
      </main>
    </body>
  </html>;
};
