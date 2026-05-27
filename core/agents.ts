export interface AgentDef {
  id: string;
  name: string;
  icon: string;
  skillId: string;
  aliases: string[];
  blurb: string;
}

const agent = (id: string, name: string, icon: string, blurb: string, aliases: string[] = []): AgentDef => ({
  id,
  name,
  icon,
  blurb,
  skillId: `agent-${id}`,
  aliases: [id, ...aliases],
});

export const AGENTS: AgentDef[] = [
  agent("claude", "Claude Code", "🟣", "Polite until the context window becomes a landfill.", ["anthropic", "claude-code", "claude_code"]),
  agent("codex", "Codex", "🧠", "Edits files, asks for approvals, pretends the sandbox was your idea.", ["openai", "gpt", "chatgpt", "gpt-codex", "codex-cli"]),
  agent("cursor", "Cursor", "↗️", "Autocomplete with opinions and a mortgage-sized chat history.", ["cursor-agent"]),
  agent("copilot", "Copilot", "✈️", "Pairs with you by finishing the line you were about to delete.", ["github-copilot", "copilot-swe-agent", "copilot-agent"]),
  agent("aider", "Aider", "🧩", "Patch-first, asks questions later, somehow still wants a clean git tree.", []),
  agent("gemini", "Gemini CLI", "💎", "Large context. Larger confidence. Results may contain astrology.", ["google", "gemini-cli"]),
  agent("goose", "Goose", "🪿", "An agent framework with enough tools to need a chaperone.", ["block-goose"]),
  agent("windsurf", "Windsurf", "🏄", "Cascade enthusiast. May refactor nearby furniture.", ["codeium", "windsurf-editor"]),
  agent("openhands", "OpenHands", "👐", "Autonomy cosplay, but with logs.", ["open-hands"]),
  agent("devin", "Devin", "🧑‍💻", "The teammate who files tickets for the tickets it created.", []),
  agent("other", "Other Agent", "🤖", "Mystery helper. Suspiciously confident. Legally a provider.", ["agent", "ai", "unknown"]),
];

const ALIAS_TO_ID = new Map<string, string>();
for (const a of AGENTS) for (const alias of a.aliases) ALIAS_TO_ID.set(alias, a.id);

export const normalizeAgentId = (raw?: string | null) => {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return ALIAS_TO_ID.get(key) ?? (key ? "other" : undefined);
};

export const agentById = (id?: string | null) => AGENTS.find((a) => a.id === normalizeAgentId(id));
export const agentSkillId = (id: string) => agentById(id)?.skillId ?? "agent-other";

export const agentFromEnv = () =>
  normalizeAgentId(process.env.RENOWN_AGENT)
  ?? (process.env.CODEX_HOME ? "codex" : undefined)
  ?? (process.env.CLAUDECODE || process.env.CLAUDE_CODE ? "claude" : undefined);

