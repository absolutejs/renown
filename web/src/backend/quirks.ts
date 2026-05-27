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
