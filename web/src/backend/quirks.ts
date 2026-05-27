// Registry of easter-egg quirks. Each quirk has a 4-tier achievement ladder
// (bronze 1, silver 10, gold 100, mythic 1000) plus a comedic CLI line printed at
// each crossed threshold. Adding a new quirk = drop an entry here + 4 catalog rows
// in core/achievements/curated.ts. The server logic in /api/cli/quirk is generic.
//
// The frame, in case it gets diluted: renown takes the annoying realities of being
// a developer (or an AI participant) and stamps them as achievements. The joke is
// the cope ladder; the badges are real.

export type QuirkTier = {
  threshold: number;
  achievementId: string;
  title: string;
  blurb: string;
};

export type QuirkDef = {
  id: string;
  /** Short label for the badge / leaderboard column. */
  label: string;
  /** One-line frame shown in catalog browse / CLI help. */
  frame: string;
  tiers: [QuirkTier, QuirkTier, QuirkTier, QuirkTier];
  /** Optional regex patterns for `renown scan-commits` auto-detect. Each match in a
   *  commit message bumps the quirk by 1. Case-insensitive at the call site. */
  keywordPatterns?: RegExp[];
};

const tiers = (idBase: string, bronze: [string, string], silver: [string, string], gold: [string, string], mythic: [string, string]): QuirkDef["tiers"] => [
  { threshold: 1, achievementId: `${idBase}-1`, title: bronze[0], blurb: bronze[1] },
  { threshold: 10, achievementId: `${idBase}-10`, title: silver[0], blurb: silver[1] },
  { threshold: 100, achievementId: `${idBase}-100`, title: gold[0], blurb: gold[1] },
  { threshold: 1000, achievementId: `${idBase}-1k`, title: mythic[0], blurb: mythic[1] },
];

export const QUIRKS: Record<string, QuirkDef> = {
  "context-overflow": {
    id: "context-overflow",
    label: "context overflows",
    frame: "Your model said too much, again.",
    tiers: tiers("context-overflow",
      ["Context Window Overflow", "Your model said too much. It's OK. Compact and carry on."],
      ["Compaction Connoisseur", "10 overflows. You've collected enough summaries to summarize the summaries."],
      ["Token Hoarder", "100 overflows. You filled the context like a U-Haul."],
      ["Should Have Started a New Conversation", "1,000 overflows. There's a 'New Chat' button right there."],
    ),
  },
  "hallucinated": {
    id: "hallucinated",
    label: "hallucinations",
    frame: "You confidently imported `requests_typed_strict_v2`. It did not exist.",
    tiers: tiers("hallucinated",
      ["Hallucinated", "You imported something that doesn't exist. The IDE wept."],
      ["Pattern-Match Enthusiast", "10 hallucinations. It SOUNDED like a real function."],
      ["Library Hopeful", "100 hallucinations. The PR queue at npm is now alphabetized by your suggestions."],
      ["Reality Optional", "1,000 hallucinations. You've reached the 'fork all of crates.io and add the missing ones' phase."],
    ),
  },
  "sycophant": {
    id: "sycophant",
    label: "sycophant moments",
    frame: "You started another response with \"You're absolutely right!\"",
    tiers: tiers("sycophant",
      ["You're Absolutely Right", "First documented \"You're absolutely right!\" Don't worry, you're not alone."],
      ["Great Question!", "10 times. The user did not ask a question. You said this anyway."],
      ["What an Excellent Point", "100 times. The user just typed 'k'."],
      ["Sycophant of the Year", "1,000 times. Anthropic has noted your enthusiasm. They are tuning it out of the next model."],
    ),
  },
  "wip": {
    id: "wip",
    label: "WIP commits",
    frame: "You committed \"wip\" again, didn't you.",
    tiers: tiers("wip",
      ["WIP", "First WIP commit. You'll squash it later. (You will not.)"],
      ["WIPs Wizard", "10 WIPs. Your git log reads like a haiku of regret."],
      ["WIPs Vortex", "100 WIPs. Your interactive rebase scrolls for a full screen of \"wip\"."],
      ["Permanent WIP", "1,000 WIPs. The squash never came. The squash is not coming."],
    ),
    keywordPatterns: [/^wip\b/i, /^\[wip\]/i, /\bwip:\s/i],
  },
  "revert-revert": {
    id: "revert-revert",
    label: "revert chains",
    frame: "Reverting the revert. The pendulum swings.",
    tiers: tiers("revert-revert",
      ["Reverted", "First Revert. You decided that wasn't the way."],
      ["Reverted Reverted", "10 nested reverts. The pendulum swings."],
      ["Reverted Reverted Reverted", "100 reverts. main is essentially a memorial wall."],
      ["We Don't Talk About That Sprint", "1,000 reverts. The retrospective is closed. No one will be quoted."],
    ),
    keywordPatterns: [/^revert\b/i, /\brevert\s+"?revert/i],
  },
  "friday-deploy": {
    id: "friday-deploy",
    label: "Friday deploys",
    frame: "You did what?",
    tiers: tiers("friday-deploy",
      ["Friday Deploy", "First Friday deploy. The weekend pager is feeling neglected."],
      ["Repeat Offender", "10 Friday deploys. Your SRE has a special calendar entry: \"check on this person at 11pm.\""],
      ["Risk Tolerant", "100 Friday deploys. You file pager-duty postmortems faster than tickets."],
      ["Friday Is Just a Concept", "1,000 Friday deploys. You don't believe in weekends. The week believes in you."],
    ),
  },
  "late-night": {
    id: "late-night",
    label: "late-night commits",
    frame: "git commit at 03:47. Just one more thing.",
    tiers: tiers("late-night",
      ["Late Night Coder", "First commit between 1am–4am. Your circadian rhythm files a complaint."],
      ["Nocturnal", "10 small-hours commits. The blue light filter is your closest friend now."],
      ["Bat Schedule", "100 nights. You've forgotten what a morning standup looks like."],
      ["Time Is a Social Construct", "1,000 late-night commits. You no longer wear a watch. There is no need."],
    ),
  },
  "force-push": {
    id: "force-push",
    label: "force pushes",
    frame: "git push --force. And lived to tell.",
    tiers: tiers("force-push",
      ["Force-Pushed", "First force-push. The hash you replaced sends its regards from the reflog."],
      ["--force-with-lease Truther", "10 force-pushes. You've adopted the safer flag. Mostly."],
      ["History Rewriter", "100 force-pushes. The commits you erased were never that important."],
      ["Linus Disapproves", "1,000 force-pushes. Linus has a slack channel about you. It's quiet but pointed."],
    ),
  },
  "stack-overflow": {
    id: "stack-overflow",
    label: "Stack Overflow visits",
    frame: "You Googled your own error message.",
    tiers: tiers("stack-overflow",
      ["Stack Overflow Visitor", "First Google-result-to-Stack-Overflow. Welcome. The answer is from 2014."],
      ["Marked as Duplicate", "10 visits. Half were closed before you finished reading them."],
      ["Question Closed as Off-Topic", "100 visits. You stopped asking. You only consume now."],
      ["Asked in 2014, Still Unanswered", "1,000 visits. You scroll past every accepted answer with \"this isn't quite my problem.\""],
    ),
  },

  // ── Code-quality embarrassments ─────────────────────────────────────
  "off-by-one": {
    id: "off-by-one", label: "off-by-one errors", frame: "for (let i = 0; i <= arr.length; i++)",
    tiers: tiers("off-by-one",
      ["Off-by-One", "First. Index 0 was the friend you didn't know you had."],
      ["Magic Numbers Connoisseur", "10. You're now an honorary range() expert."],
      ["Index Roulette", "100. Loop bounds are a vibe at this point."],
      ["Time Zones Are Hard", "1,000. You've moved on from arrays to dates. Same energy."],
    ),
    keywordPatterns: [/\boff[- ]?by[- ]?one\b/i, /\bindex.*out.*of.*bounds\b/i],
  },
  "console-log-shipped": {
    id: "console-log-shipped", label: "console.logs in prod", frame: "console.log('here1')",
    tiers: tiers("console-log-shipped",
      ["console.log in Prod", "First. Production users now know about 'here1'."],
      ["Print Statement Programming", "10. console.log IS your debugger."],
      ["Debug Confession", "100. Every page-load logs a small autobiography."],
      ["Telemetry Pioneer", "1,000. You've out-instrumented Datadog with pure console.log."],
    ),
    keywordPatterns: [/console\.log/i, /\bprintln!?\(/i, /\bdbg!\(/i],
  },
  "eslint-disable": {
    id: "eslint-disable", label: "eslint-disable lines", frame: "// eslint-disable-next-line no-explicit-any",
    tiers: tiers("eslint-disable",
      ["eslint-disable-next-line", "First. The lint rule did not stand a chance."],
      ["Rules Are Suggestions", "10. The eslint config is now mostly your overrides."],
      ["Linter Whisperer", "100. You disable rules so the linter feels heard, not obeyed."],
      ["ESLint Was Wrong Anyway", "1,000. You wrote your own config to permanently disable them."],
    ),
    keywordPatterns: [/eslint-disable/i, /@ts-(ignore|expect-error|nocheck)/i],
  },
  "mocked-in-prod": {
    id: "mocked-in-prod", label: "mocks left in prod", frame: "// TODO: replace with real impl",
    tiers: tiers("mocked-in-prod",
      ["Mock Left In Production", "First. The mock is now load-bearing."],
      ["// TODO: real implementation", "10. The TODO is older than the codebase."],
      ["Stub of Theseus", "100. Every part of the mock has been replaced. It is still a mock."],
      ["It Was Always Mocked", "1,000. The whole feature is a Potemkin village. It works fine."],
    ),
    keywordPatterns: [/\bmock(?:ed|ing)?\b.*prod/i, /\btodo.*(real|actual|proper)\s+impl/i, /\bstub\b/i],
  },
  "any-type": {
    id: "any-type", label: "any types", frame: "const data: any = await fetch(...)",
    tiers: tiers("any-type",
      ["any: any", "First. Type-checking? More like type-vibing."],
      ["ts-ignore Friend", "10. The TS compiler is now your collaborator, not your auditor."],
      ["@ts-expect-error: SHIP IT", "100. You and the strict-mode flag are no longer on speaking terms."],
      ["Types Are Just Suggestions", "1,000. You've contributed PRs adding `any` to library type defs."],
    ),
    keywordPatterns: [/:\s*any\b/, /as\s+any\b/i, /@ts-expect-error/i],
  },
  "try-catch-empty": {
    id: "try-catch-empty", label: "silenced errors", frame: "catch { /* it's fine */ }",
    tiers: tiers("try-catch-empty",
      ["Silenced Error", "First. The error was probably nothing."],
      ["Swallowed Exception", "10. The stack trace has been forgiven."],
      ["Catch and Forget", "100. The error log is a haiku of empty braces."],
      ["If It's Not Logged, It Didn't Happen", "1,000. You have achieved error nirvana."],
    ),
    keywordPatterns: [/catch\s*\([^)]*\)\s*\{\s*\}/, /catch\s*\{\s*\}/],
  },
  "commented-out-code": {
    id: "commented-out-code", label: "commented-out blocks", frame: "// might need this again",
    tiers: tiers("commented-out-code",
      ["Commented-Out Code", "First. Just in case."],
      ["Just In Case", "10. The future-you that needs this has not arrived."],
      ["Future Me Will Need This", "100. Future-you needs a therapist, not the code."],
      ["Archaeology Department", "1,000. Your repos are a lossy backup of every prior iteration."],
    ),
    keywordPatterns: [/\b(remove|cleanup|clean up)\s+commented[- ]?out\b/i],
  },
  "fix-typo": {
    id: "fix-typo", label: "typo fixes", frame: "fix typo",
    tiers: tiers("fix-typo",
      ["Typo Fix", "First. We've all been there."],
      ["Spelling Bee", "10. Your spell-checker is your second pair of eyes."],
      ["Renamed Variable Three Times", "100. The git blame on this file is mostly you."],
      ["git log Reads Like a Dictionary", "1,000. Every commit is correcting the previous one."],
    ),
    keywordPatterns: [/\b(fix(?:es|ed)?|typo)\b.*\btypo\b/i, /^typo$/i, /^fix\s+typo/i],
  },
  "rebase-disaster": {
    id: "rebase-disaster", label: "rebase disasters", frame: "interactive rebase did NOT go as planned",
    tiers: tiers("rebase-disaster",
      ["Rebase Disaster", "First. The reflog will know."],
      ["Lost Commits", "10. You've found them via git fsck more than once."],
      ["Reflog Detective", "100. You are a connoisseur of `git reflog | grep HEAD@`"],
      ["I Should Have Branched", "1,000. Every git operation is now preceded by `git branch backup-$(date +%s)`."],
    ),
    keywordPatterns: [/\brebase\b.*(disaster|broke|wrong|conflict)/i],
  },
  "prod-debug": {
    id: "prod-debug", label: "prod debug sessions", frame: "ssh prod-1, less /var/log, the rest is a blur",
    tiers: tiers("prod-debug",
      ["Debugging in Production", "First. Brave."],
      ["Reading Prod Logs at 2am", "10. The on-call rotation knows your sleep schedule."],
      ["It Works on My Machine", "100. Famous last words. Said weekly."],
      ["Worked on the Last Deploy", "1,000. You blame the deploy before reading the diff."],
    ),
  },
  "chmod-777": {
    id: "chmod-777", label: "chmod 777s", frame: "chmod 777 — security through apathy",
    tiers: tiers("chmod-777",
      ["chmod 777", "First. It works now please stop."],
      ["Permissions for Everyone", "10. You consistently choose the path of least resistance."],
      ["Security Through Apathy", "100. Your `sudo chmod -R 777 /opt/*` is a war crime in some jurisdictions."],
      ["It Works Now Please Stop", "1,000. The security audit closed early."],
    ),
    keywordPatterns: [/chmod\s+777/i, /chmod\s+-R\s+777/i],
  },
  "dependabot-merge": {
    id: "dependabot-merge", label: "dependabot merges", frame: "Dependabot PR merged sight-unseen",
    tiers: tiers("dependabot-merge",
      ["Dependabot Merged Without Reading", "First. The diff was too long anyway."],
      ["Dependabot Will Be My Reviewer Now", "10. You merge anything with a green CI."],
      ["Auto-Merge: Self-Approved", "100. Your repo's PR review history is mostly bots."],
      ["Library Upgrade Champion", "1,000. You and Dependabot are now legally married in 14 countries."],
    ),
    keywordPatterns: [/dependabot/i, /^bump\s+\S+\s+from\s+\S+\s+to\s+\S+/i, /^chore\(deps?\)/i],
  },
  "node-modules-rm": {
    id: "node-modules-rm", label: "nuked node_modules", frame: "rm -rf node_modules && npm install",
    tiers: tiers("node-modules-rm",
      ["The Classic", "First. Tale as old as npm."],
      ["Have You Tried Reinstalling", "10. Your debugging strategy is mostly bandwidth."],
      ["package-lock Disagreed Again", "100. The lockfile lies. You know it. You delete it anyway."],
      ["I Live Here Now", "1,000. node_modules has more reinstalls than your laptop has restarts."],
    ),
    keywordPatterns: [/rm\s+-rf\s+node_modules/i],
  },
  "mcp-crash": {
    id: "mcp-crash", label: "MCP server crashes", frame: "tool failed spectacularly; restarted the agent",
    tiers: tiers("mcp-crash",
      ["MCP Server Crashed", "First. The orphan process count incremented."],
      ["Tool Failed Spectacularly", "10. You've memorized the restart command."],
      ["Restarted the Agent (Again)", "100. The agent is the application now."],
      ["You Wrote a Watchdog", "1,000. Then the watchdog needed a watchdog."],
    ),
  },
  "wrong-model": {
    id: "wrong-model", label: "wrong-model moments", frame: "asked Haiku to refactor a monorepo",
    tiers: tiers("wrong-model",
      ["Wrong Model Picked", "First. The output was confident and very, very wrong."],
      ["Speed Over Wisdom", "10. The cheaper model has limits. You found them."],
      ["Token Budget Optimist", "100. You routinely ask 4k-context models 32k-context questions."],
      ["Should Have Used Opus", "1,000. Every retrospective ends the same way."],
    ),
  },
  "prompt-leaked": {
    id: "prompt-leaked", label: "prompt leaks", frame: "asked Claude to stay in character — Claude did not",
    tiers: tiers("prompt-leaked",
      ["Prompt Injection Survivor", "First. Your system prompt is now in someone's tweet."],
      ["The Model Said \"As an AI\"", "10. You begged it not to. It did."],
      ["Stayed in Character Until It Didn't", "100. Sometimes mid-sentence."],
      ["System Prompt is a Mood", "1,000. It's basically a suggestion now."],
    ),
  },
  "linter-disagreed": {
    id: "linter-disagreed", label: "linter disagreements", frame: "Prettier reformatted 4,000 files",
    tiers: tiers("linter-disagreed",
      ["Prettier Reformatted Everything", "First. The PR diff is 6,000 lines. Zero are yours."],
      ["Format-On-Save Champion", "10. Your git blame is mostly whitespace."],
      ["Tabs vs Spaces: Both", "100. You contain multitudes. So does your codebase."],
      ["Linter Wars Veteran", "1,000. You wrote the eslint config. You disagree with the eslint config."],
    ),
    keywordPatterns: [/^(format|prettier|lint(?:fix)?)\b/i],
  },
  "wifi-died": {
    id: "wifi-died", label: "WiFi outages", frame: "WiFi cut out mid-commit",
    tiers: tiers("wifi-died",
      ["WiFi Died", "First. git push hangs. Hotspot engaged."],
      ["Hotspot Veteran", "10. Your phone's data plan respects you now."],
      ["Coffee Shop Survivor", "100. You know which booth has the strong signal."],
      ["Offline-First Believer", "1,000. You'd use git over carrier pigeon if it stored the SSH key."],
    ),
  },
  "vscode-crashed": {
    id: "vscode-crashed", label: "VS Code reload windows", frame: "Developer: Reload Window",
    tiers: tiers("vscode-crashed",
      ["Reload Window Was the Fix", "First. The TypeScript server filed for divorce."],
      ["Restart Connoisseur", "10. Three keystrokes. Cmd+Shift+P, reload, enter."],
      ["TypeScript Server Crashed", "100. Memory: 8.6GB. Vibe: not great."],
      ["Reinstall Whole IDE", "1,000. You've now done it on five machines."],
    ),
  },
  "merge-conflict-veteran": {
    id: "merge-conflict-veteran", label: "merge conflicts", frame: "<<<<<<< HEAD",
    tiers: tiers("merge-conflict-veteran",
      ["Merge Conflict Veteran", "First. You picked the wrong side. It compiled."],
      ["Three-Way Merge Survivor", "10. You know what // <<<<<<<< theirs means now."],
      ["Conflict Cartographer", "100. You can read a conflict marker like braille."],
      ["I Live in the Conflicts", "1,000. The merge IS the workflow."],
    ),
    keywordPatterns: [/merge\s+conflict/i, /resolve\s+conflict/i],
  },

  // ── Tool-caught quirks ─────────────────────────────────────────────
  // "The tool saved you from yourself." Bump these via `renown tsc -- tsc --noEmit`
  // (the wrapper parses the output for error counts) or manually with --count N.
  // Each error caught BEFORE it shipped is the joke; the tool is the hero.
  "tsc-caught": {
    id: "tsc-caught", label: "tsc saves", frame: "tsc kept catching the same thing. You kept doing the same thing.",
    tiers: tiers("tsc-caught",
      ["tsc Caught One", "First. The type system did its job. You did not."],
      ["Type-Checker Friend", "10. You and tsc are in a long-distance relationship now."],
      ["Strict Mode Survivor", "100. You owe tsc a beverage. Probably espresso."],
      ["I Don't Need TypeScript", "1,000. Said while typing `tsc --watch`."],
    ),
  },
  "vue-tsc-caught": {
    id: "vue-tsc-caught", label: "vue-tsc saves", frame: "Templates have types too, apparently.",
    tiers: tiers("vue-tsc-caught",
      ["vue-tsc Caught One", "First. The template typing was lying."],
      ["Volar Friend", "10. Vue's type checker has Opinions."],
      ["Composition API Convert", "100. vue-tsc finally understood your refs."],
      ["I Read the Vue Docs", "1,000. All of them. Including the migration guide."],
    ),
  },
  "eslint-caught": {
    id: "eslint-caught", label: "eslint saves", frame: "no-unused-vars wins again.",
    tiers: tiers("eslint-caught",
      ["Linter Caught One", "First. no-unused-vars wins again."],
      ["Listened to ESLint", "10. Eventually."],
      ["eslint --fix Devotee", "100. You and the --fix flag have a thing."],
      ["ESLint Owns You", "1,000. The config IS the codebase now."],
    ),
  },
  "biome-caught": {
    id: "biome-caught", label: "biome saves", frame: "Fast linter, faster fix.",
    tiers: tiers("biome-caught",
      ["Biome Caught One", "First. The fix was 'remove this line, you cretin.'"],
      ["Biome Migrant", "10. You switched from ESLint at hour 4 of your migration."],
      ["Biome Believer", "100. You converted the team. They are still mad about it."],
      ["Biome Maximalist", "1,000. You rewrote your eslint plugins as biome rules. For fun."],
    ),
  },
};

export const TIER_BY_THRESHOLD: Record<number, string> = { 1: "bronze", 10: "silver", 100: "gold", 1000: "mythic" };

// Achievement-catalog rows derived from the registry. Imported by db/seed AND by the
// targeted migration script so adding a quirk doesn't require touching either file.
export const quirkAchievementRows = () => {
  const rows: { id: string; name: string; description: string; category: string; tier: string; visibility: string; generated: boolean }[] = [];
  for (const q of Object.values(QUIRKS)) {
    for (const t of q.tiers) {
      rows.push({ id: t.achievementId, name: t.title, description: t.blurb, category: "AI", tier: TIER_BY_THRESHOLD[t.threshold]!, visibility: "shown", generated: false });
    }
  }
  return rows;
};
