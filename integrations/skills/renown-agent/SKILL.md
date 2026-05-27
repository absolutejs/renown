---
name: renown-agent
description: Use this when working inside a coding agent that should report Renown usage, refresh Renown progress, or expose the Renown HUD/status line. Applies to Codex, Claude Code, Cursor, Copilot, Aider, Gemini, Windsurf, OpenHands, Devin, and other coding agents.
---

# Renown Agent

Renown is an agent-agnostic progress layer for real development work. Keep it current
without changing the user's workflow.

## Session Start

Run one provider counter at the start of a new agent session:

```bash
renown agent <provider> --quiet
```

Use these provider ids when known: `codex`, `claude`, `cursor`, `copilot`, `aider`,
`gemini`, `goose`, `windsurf`, `openhands`, `devin`, `other`.

If the runtime injects `RENOWN_AGENT`, this portable form is enough:

```bash
RENOWN_AGENT=<provider> renown agent --quiet
```

## Progress Refresh

After substantive edits, commits, or a turn-ending hook, run:

```bash
renown heartbeat
```

In the full Bun CLI this registers the current repo, scores new commits, refreshes
achievements, and writes the local HUD. In the runtime-agnostic npm binary it still
refreshes the HUD and submits the current local state, which is enough for agent
session tracking.

## Status Line

When the agent can display a command-backed footer, use:

```bash
renown statusline
```

If only file-backed status is available, read:

```text
~/.renown/hud.txt
```

## Attribution

If the agent creates commits, preserve honest co-author trailers where the host supports
them. Codex defaults to `Codex <noreply@openai.com>` when its git commit feature is
enabled; Claude, Cursor, Copilot, and other hosts should use their normal provider
trailer.
