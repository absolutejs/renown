// Renown — CURATED achievements. ~290 hand-written, unique, with real checks against
// player state. Distinct from the procedural generator (generated.ts). Visibility:
// shown (name+desc), hidden (name shown, desc ??? until earned), secret (🔒??? until earned).
import { type State, bestStreak, distinctDays, distinctHours, distinctLangs, level, nightCommits, ossProjectCount, projectCount } from "../state.ts";

export type Tier = "bronze" | "silver" | "gold" | "platinum" | "mythic" | "secret";
export type Vis = "shown" | "hidden" | "secret";
export interface Ach { id: string; name: string; desc: string; cat: string; tier: Tier; vis: Vis; check: (s: State) => boolean }

const A: Ach[] = [];
const add = (id: string, name: string, desc: string, cat: string, tier: Tier, vis: Vis, check: (s: State) => boolean) => A.push({ id, name, desc, cat, tier, vis, check });
const L = (s: State, l: string) => s.langs[l] ?? 0;
const LL = (s: State, l: string) => s.langsDeep[l]?.lines ?? 0;
const wknd = (s: State) => (s.days[0] ?? 0) > 0 && (s.days[6] ?? 0) > 0;

// ── Origins & Git ─────────────────────────────────────────────────────────────
add("first-blood", "First Blood", "Land your first commit", "Origins", "bronze", "shown", s => s.commits >= 1);
add("hello-world", "Hello, World", "Reach level 2", "Origins", "bronze", "shown", s => level(s) >= 2);
add("the-call", "The Call to Adventure", "Earn your first 100 XP", "Origins", "bronze", "shown", s => s.lifetimeXp >= 100);
add("getting-serious", "Getting Serious", "10 commits", "Git", "bronze", "shown", s => s.commits >= 10);
add("committed", "Committed", "100 commits", "Git", "silver", "shown", s => s.commits >= 100);
add("commit-machine", "Commit Machine", "1,000 commits", "Git", "gold", "shown", s => s.commits >= 1000);
add("ten-k-club", "The 10k Club", "10,000 commits", "Git", "platinum", "shown", s => s.commits >= 10000);
add("centurion-day", "Centurion's Day", "Earn 500 XP in one day", "Git", "gold", "hidden", s => s.best.xpInDay >= 500);
add("double-down", "Double Down", "Earn 1,000 XP in one day", "Git", "platinum", "hidden", s => s.best.xpInDay >= 1000);
add("git-gud", "Git Gud", "Reach level 10", "Git", "silver", "shown", s => level(s) >= 10);
add("ammend-er", "No Take-Backs", "Survive to 50 commits without quitting", "Git", "bronze", "secret", s => s.commits >= 50);
add("merge-survivor", "Merge-Conflict Survivor", "Reach level 12", "Git", "silver", "hidden", s => level(s) >= 12);
add("the-grind", "The Grind", "Earn 2,000 XP in one day", "Git", "mythic", "secret", s => s.best.xpInDay >= 2000);
add("history-buff", "History Buff", "Author across 5 different projects", "Git", "silver", "shown", s => projectCount(s) >= 5);
add("monogamist", "Monogamist", "1,000 XP in a single project", "Git", "gold", "hidden", s => Object.values(s.projects).some(p => p.xp >= 1000));

// ── Lines of craft ────────────────────────────────────────────────────────────
add("first-100", "Triple Digits", "Write 100 lines of real code", "Craft", "bronze", "shown", s => s.linesAdded >= 100);
add("kiloline", "Kiloline", "1,000 lines", "Craft", "bronze", "shown", s => s.linesAdded >= 1000);
add("ten-kloc", "10 KLOC", "10,000 lines", "Craft", "silver", "shown", s => s.linesAdded >= 10000);
add("hundred-kloc", "Six Figures of Code", "100,000 lines", "Craft", "gold", "shown", s => s.linesAdded >= 100000);
add("megaline", "Megaline", "1,000,000 lines", "Craft", "mythic", "shown", s => s.linesAdded >= 1000000);
add("net-negative", "Less Is More", "A clean working life — reach Lv8", "Craft", "silver", "hidden", s => level(s) >= 8);
add("substance", "Substance Over Form", "Earn 5,000 lifetime XP", "Craft", "silver", "shown", s => s.lifetimeXp >= 5000);
add("artisan", "Artisan", "Earn 50,000 lifetime XP", "Craft", "platinum", "shown", s => s.lifetimeXp >= 50000);

// ── Streaks & consistency ─────────────────────────────────────────────────────
add("warm-up", "Warm-Up", "3-day streak", "Streak", "bronze", "shown", s => bestStreak(s) >= 3);
add("on-fire", "On Fire", "7-day streak", "Streak", "silver", "shown", s => bestStreak(s) >= 7);
add("fortnight", "Fortnight", "14-day streak", "Streak", "silver", "shown", s => bestStreak(s) >= 14);
add("monthly", "Monthly Habit", "30-day streak", "Streak", "gold", "shown", s => bestStreak(s) >= 30);
add("quarter", "Quarterly Crusher", "90-day streak", "Streak", "platinum", "shown", s => bestStreak(s) >= 90);
add("half-year", "Half a Year", "180-day streak", "Streak", "platinum", "hidden", s => bestStreak(s) >= 180);
add("a-year", "A Year of Code", "365-day streak", "Streak", "mythic", "hidden", s => bestStreak(s) >= 365);
add("unstoppable", "Unstoppable", "100-day streak", "Streak", "gold", "shown", s => bestStreak(s) >= 100);
add("comeback", "The Comeback", "Start a fresh streak after a break", "Streak", "bronze", "secret", s => s.streak === 1 && s.commits > 20);
add("consistent", "Consistency Is King", "Active on 30 different days", "Streak", "silver", "shown", s => Object.keys(s.stats.daily).length >= 30);
add("year-of-days", "Showed Up", "Active on 100 different days", "Streak", "gold", "shown", s => Object.keys(s.stats.daily).length >= 100);

// ── Time of day ───────────────────────────────────────────────────────────────
add("night-owl", "Night Owl", "Commit between 1–4am", "Time", "silver", "hidden", s => nightCommits(s) >= 1);
add("vampire", "Vampire Hours", "20 commits between midnight and 4am", "Time", "gold", "hidden", s => nightCommits(s) >= 20);
add("3am-club", "The 3am Club", "Commit specifically at 3am", "Time", "gold", "secret", s => (s.hours[3] ?? 0) >= 1);
add("early-bird", "Early Bird", "Commit before 6am", "Time", "silver", "hidden", s => (s.hours[5] ?? 0) + (s.hours[4] ?? 0) > 0);
add("morning-person", "Morning Person", "10 commits before 9am", "Time", "silver", "hidden", s => (s.hours[6] ?? 0) + (s.hours[7] ?? 0) + (s.hours[8] ?? 0) >= 10);
add("nine-to-five", "9-to-5", "Commit during normal business hours", "Time", "bronze", "shown", s => [9, 10, 11, 12, 13, 14, 15, 16].some(h => (s.hours[h] ?? 0) > 0));
add("lunch-coder", "Lunch Break Hacker", "Commit at noon", "Time", "bronze", "secret", s => (s.hours[12] ?? 0) >= 1);
add("golden-hour", "Golden Hour", "Commit at sunset (6–8pm)", "Time", "bronze", "hidden", s => (s.hours[18] ?? 0) + (s.hours[19] ?? 0) > 0);
add("around-clock", "Around the Clock", "Commit during all 24 hours", "Time", "mythic", "hidden", s => distinctHours(s) >= 24);
add("half-clock", "Half the Clock", "Commit during 12 different hours", "Time", "gold", "hidden", s => distinctHours(s) >= 12);
add("dawn-patrol", "Dawn Patrol", "Commit at both 5am and 11pm (same legend)", "Time", "platinum", "secret", s => (s.hours[5] ?? 0) > 0 && (s.hours[23] ?? 0) > 0);
add("midnight-oil", "Burning Midnight Oil", "A session past 2 hours", "Time", "gold", "hidden", s => s.stats.longestSec >= 7200);

// ── Day of week ───────────────────────────────────────────────────────────────
add("friday-deploy", "Live Dangerously", "Commit on a Friday", "Time", "bronze", "hidden", s => (s.days[5] ?? 0) > 0);
add("never-monday", "Manic Monday", "Commit on a Monday anyway", "Time", "bronze", "hidden", s => (s.days[1] ?? 0) > 0);
add("weekend-warrior", "Weekend Warrior", "Commit on Saturday and Sunday", "Time", "silver", "hidden", wknd);
add("seven-days", "Full Week", "Commit on all 7 weekdays", "Time", "gold", "hidden", s => distinctDays(s) >= 7);
add("sabbath", "No Rest", "Commit on a Sunday", "Time", "bronze", "secret", s => (s.days[0] ?? 0) > 0);
add("hump-day", "Hump Day Hero", "Commit on a Wednesday", "Time", "bronze", "secret", s => (s.days[3] ?? 0) > 0);
add("tgif", "TGIF", "5 Friday commits", "Time", "silver", "hidden", s => (s.days[5] ?? 0) >= 5);

// ── Open source ───────────────────────────────────────────────────────────────
add("open-sauce", "Open Sauce", "Land your first open-source commit", "OpenSource", "silver", "hidden", s => s.ossCommits >= 1);
add("oss-regular", "OSS Regular", "10 open-source commits", "OpenSource", "gold", "shown", s => s.ossCommits >= 10);
add("oss-devoted", "Devoted to the Commons", "100 open-source commits", "OpenSource", "platinum", "shown", s => s.ossCommits >= 100);
add("oss-pillar", "Pillar of the Community", "500 open-source commits", "OpenSource", "mythic", "shown", s => s.ossCommits >= 500);
add("samaritan", "Good Samaritan", "Contribute to someone else's repo", "OpenSource", "silver", "hidden", s => s.extCommits >= 1);
add("benefactor", "Benefactor", "Contribute to 10 others' repos", "OpenSource", "gold", "hidden", s => s.extCommits >= 10);
add("upstream", "Upstream Hero", "Contribute to 50 others' repos", "OpenSource", "platinum", "hidden", s => s.extCommits >= 50);
add("maintainer", "Maintainer", "Run 3 open-source projects", "OpenSource", "gold", "shown", s => ossProjectCount(s) >= 3);
add("foundation", "Foundation", "Run 10 open-source projects", "OpenSource", "platinum", "shown", s => ossProjectCount(s) >= 10);
add("free-software", "For the Greater Good", "Earn 1,000 XP from open source", "OpenSource", "gold", "hidden", s => Object.values(s.projects).filter(p => p.oss).reduce((a, p) => a + p.xp, 0) >= 1000);

// ── Stars & prestige ──────────────────────────────────────────────────────────
add("first-star", "Noticed", "Touch a repo with 10+ stars", "Prestige", "bronze", "hidden", s => s.topStars >= 10);
add("rising-star", "Rising Star", "Touch a 100★ repo", "Prestige", "silver", "hidden", s => s.topStars >= 100);
add("stargazer", "Stargazer", "Touch a 1,000★ repo", "Prestige", "gold", "hidden", s => s.topStars >= 1000);
add("supernova", "Supernova", "Touch a 10,000★ repo", "Prestige", "platinum", "hidden", s => s.topStars >= 10000);
add("galaxy-brain", "Galaxy Brain", "Touch a 100,000★ repo", "Prestige", "mythic", "secret", s => s.topStars >= 100000);
add("contributor-fame", "Drop in the Ocean", "Commit to a 1k★ project you don't own", "Prestige", "gold", "secret", s => s.topStars >= 1000 && s.extCommits >= 1);

// ── Polyglot ──────────────────────────────────────────────────────────────────
add("bilingual", "Bilingual", "Commit in 2 languages", "Polyglot", "bronze", "shown", s => distinctLangs(s) >= 2);
add("polyglot", "Polyglot", "5 languages", "Polyglot", "silver", "shown", s => distinctLangs(s) >= 5);
add("hyperpolyglot", "Hyperpolyglot", "10 languages", "Polyglot", "gold", "shown", s => distinctLangs(s) >= 10);
add("babel", "Tower of Babel", "15 languages", "Polyglot", "platinum", "hidden", s => distinctLangs(s) >= 15);
add("omniglot", "Omniglot", "20 languages", "Polyglot", "mythic", "hidden", s => distinctLangs(s) >= 20);
add("nocturnal-poly", "Nocturnal Polyglot", "3+ languages and 10 night commits", "Polyglot", "gold", "secret", s => distinctLangs(s) >= 3 && nightCommits(s) >= 10);

// ── Language flavor ───────────────────────────────────────────────────────────
add("ts-believer", "Type Believer", "100 TypeScript commits", "Languages", "silver", "hidden", s => L(s, "TypeScript") >= 100);
add("ts-zealot", "Strict Mode Zealot", "1,000 TypeScript commits", "Languages", "gold", "hidden", s => L(s, "TypeScript") >= 1000);
add("js-roots", "Vanilla Roots", "Commit JavaScript", "Languages", "bronze", "secret", s => L(s, "JavaScript") >= 1);
add("rustacean", "Rustacean", "Commit Rust", "Languages", "silver", "hidden", s => L(s, "Rust") >= 1);
add("fearless", "Fearless Concurrency", "250 Rust commits", "Languages", "gold", "hidden", s => L(s, "Rust") >= 250);
add("gopher", "Gopher", "Commit Go", "Languages", "silver", "hidden", s => L(s, "Go") >= 1);
add("pythonista", "Pythonista", "Commit Python", "Languages", "silver", "hidden", s => L(s, "Python") >= 1);
add("zig-zag", "Zig Enjoyer", "Commit Zig", "Languages", "gold", "secret", s => L(s, "Zig") >= 1);
add("css-wizard", "CSS Wizard", "10,000 lines of CSS", "Languages", "gold", "hidden", s => LL(s, "CSS") >= 10000);
add("htmaxxer", "HTMaxxer", "Commit HTML", "Languages", "bronze", "secret", s => L(s, "HTML") >= 1);
add("sql-whisperer", "SQL Whisperer", "Commit SQL", "Languages", "silver", "secret", s => L(s, "SQL") >= 1);
add("shell-scripter", "Shell Scripter", "Commit a shell script", "Languages", "bronze", "secret", s => L(s, "Shell") >= 1);
add("svelte-heart", "Svelte at Heart", "Commit Svelte", "Languages", "silver", "secret", s => L(s, "Svelte") >= 1);
add("vue-master", "View Source", "Commit Vue", "Languages", "silver", "secret", s => L(s, "Vue") >= 1);
add("haskell-monad", "It's Just a Monad", "Commit Haskell", "Languages", "gold", "secret", s => L(s, "Haskell") >= 1);
add("lua-love", "Moonlight", "Commit Lua", "Languages", "bronze", "secret", s => L(s, "Lua") >= 1);
add("c-veteran", "Close to the Metal", "Commit C", "Languages", "silver", "secret", s => L(s, "C") >= 1);
add("cpp-templates", "Template Metaprogrammer", "Commit C++", "Languages", "gold", "secret", s => L(s, "C++") >= 1);
add("elixir-alchemist", "Alchemist", "Commit Elixir", "Languages", "gold", "secret", s => L(s, "Elixir") >= 1);
add("ts-millionaire", "TypeScript Millionaire", "100k lines of TypeScript", "Languages", "platinum", "hidden", s => LL(s, "TypeScript") >= 100000);

// ── Web dev ───────────────────────────────────────────────────────────────────
add("full-stack", "Full Stack", "Commit both a frontend and backend language", "WebDev", "silver", "hidden", s => (L(s, "TypeScript") + L(s, "JavaScript") > 0) && (L(s, "Go") + L(s, "Rust") + L(s, "Python") + L(s, "SQL") > 0));
add("frontend-focus", "Pixel Pusher", "5,000 lines of CSS", "WebDev", "silver", "hidden", s => LL(s, "CSS") >= 5000);
add("api-artisan", "API Artisan", "Earn 2,000 XP in a backend-heavy project", "WebDev", "gold", "hidden", s => Object.values(s.projects).some(p => p.xp >= 2000));
add("the-stack", "The Stack", "Use 3 web languages (TS/CSS/HTML)", "WebDev", "silver", "shown", s => ["TypeScript", "CSS", "HTML"].filter(l => L(s, l) > 0).length >= 2);
add("ship-it", "Ship It", "Reach level 5", "WebDev", "bronze", "shown", s => level(s) >= 5);
add("prod-ready", "Production Ready", "Reach level 15", "WebDev", "gold", "shown", s => level(s) >= 15);
add("dependency-hell", "Dependency Hell", "Survive — reach level 20", "WebDev", "platinum", "hidden", s => level(s) >= 20);
add("works-on-mine", "Works On My Machine", "Earn 1,000 lifetime XP", "WebDev", "bronze", "secret", s => s.lifetimeXp >= 1000);
add("hydration", "Hydration Error", "Commit Svelte, Vue, or Astro", "WebDev", "silver", "secret", s => L(s, "Svelte") + L(s, "Vue") + L(s, "Astro") > 0);
add("the-bundle", "Bundle of Joy", "Ship 50,000 lines", "WebDev", "gold", "hidden", s => s.linesAdded >= 50000);

// ── Craft & quality ───────────────────────────────────────────────────────────
add("eden-bane", "Eden's Bane", "Survive a 10GB+ Type Dragon (tsc)", "Craft", "gold", "shown", s => (s.bestiary.tsc?.gb ?? 0) >= 10);
add("perfectionist", "Perfectionist", "Reach level 25", "Craft", "platinum", "shown", s => level(s) >= 25);
add("the-widening", "The Widening", "Survive an 8GB+ Type Dragon as a polyglot (5+ langs)", "Craft", "gold", "secret", s => (s.bestiary.tsc?.gb ?? 0) >= 8 && distinctLangs(s) >= 5);
add("clean-coder", "Clean Coder", "Earn 10,000 lifetime XP", "Craft", "gold", "shown", s => s.lifetimeXp >= 10000);
add("legend-tier", "Living Legend", "Reach level 50", "Craft", "mythic", "shown", s => level(s) >= 50);
add("renowned", "Renowned", "Reach level 100", "Craft", "mythic", "hidden", s => level(s) >= 100);

// ── Memory & perf (bosses) ────────────────────────────────────────────────────
add("first-boss", "First Boss", "Survive a memory boss", "Boss", "bronze", "shown", s => s.bossesSurvived >= 1);
add("boss-rush", "Boss Rush", "Survive 10 memory bosses", "Boss", "silver", "shown", s => s.bossesSurvived >= 10);
add("raid-leader", "Raid Leader", "Survive 50 memory bosses", "Boss", "gold", "shown", s => s.bossesSurvived >= 50);
add("hydra-slayer", "Hydra Slayer", "Survive an 8GB+ Regex Hydra (grep)", "Boss", "gold", "shown", s => (s.bestiary.ugrep?.gb ?? 0) >= 8);
add("dragon-tamer", "Dragon Tamer", "Survive a 12GB+ Type Dragon", "Boss", "platinum", "hidden", s => (s.bestiary.tsc?.gb ?? 0) >= 12);
add("abyss", "Stared Into The Abyss", "Touch 98% memory and survive", "Boss", "platinum", "secret", s => s.maxMem >= 98);
add("the-brink", "The Brink", "Touch 95% memory", "Boss", "gold", "secret", s => s.maxMem >= 95);
add("zero-byte", "Zero-Byte Necromancer", "Face a memory boss before your first commit", "Boss", "secret", "secret", s => s.bossesSurvived >= 1 && s.commits === 0);
add("saga-survivor", "Saga Survivor", "Survive your first memory catastrophe", "Boss", "mythic", "secret", s => s.bossesSurvived >= 1);
add("hog-slayer", "Hog Slayer", "Survive a 16GB+ memory monster", "Boss", "platinum", "hidden", s => Object.values(s.bestiary).some(b => b.gb >= 16));

// ── Sessions & activity ───────────────────────────────────────────────────────
add("first-hour", "First Hour", "Bank an hour of active coding", "Activity", "bronze", "shown", s => s.stats.activeSec >= 3600);
add("ten-hours", "Ten Hours In", "Bank 10 active hours", "Activity", "silver", "shown", s => s.stats.activeSec >= 36000);
add("hundred-hours", "Centenarian", "Bank 100 active hours", "Activity", "gold", "shown", s => s.stats.activeSec >= 360000);
add("thousand-hours", "10,000 Hour Rule (ish)", "Bank 1,000 active hours", "Activity", "mythic", "shown", s => s.stats.activeSec >= 3600000);
add("marathoner", "Marathoner", "A single 4-hour session", "Activity", "gold", "hidden", s => s.stats.longestSec >= 14400);
add("ultramarathon", "Ultramarathon", "A single 8-hour session", "Activity", "platinum", "secret", s => s.stats.longestSec >= 28800);
add("sprinter", "Sprinter", "Complete 50 sessions", "Activity", "silver", "shown", s => s.stats.sessionCount >= 50);
add("regular", "Regular", "Complete 500 sessions", "Activity", "gold", "shown", s => s.stats.sessionCount >= 500);
add("in-the-zone", "In The Zone", "A 3-hour session", "Activity", "silver", "hidden", s => s.stats.longestSec >= 10800);
add("just-five-more", "Just Five More Minutes", "Code past 2am in a long session", "Activity", "gold", "secret", s => nightCommits(s) > 0 && s.stats.longestSec >= 7200);

// ── Projects ──────────────────────────────────────────────────────────────────
add("side-quest", "Side Quest", "Work on a 2nd project", "Projects", "bronze", "shown", s => projectCount(s) >= 2);
add("juggler", "Juggler", "Work on 5 projects", "Projects", "silver", "shown", s => projectCount(s) >= 5);
add("portfolio", "Portfolio", "Work on 10 projects", "Projects", "gold", "shown", s => projectCount(s) >= 10);
add("prolific", "Prolific", "Work on 25 projects", "Projects", "platinum", "hidden", s => projectCount(s) >= 25);
add("flagship", "Flagship", "5,000 XP in a single project", "Projects", "gold", "hidden", s => Object.values(s.projects).some(p => p.xp >= 5000));
add("magnum-opus", "Magnum Opus", "20,000 XP in a single project", "Projects", "mythic", "hidden", s => Object.values(s.projects).some(p => p.xp >= 20000));

// ── Levels & XP milestones ────────────────────────────────────────────────────
add("level-30", "Veteran", "Reach level 30", "Levels", "gold", "shown", s => level(s) >= 30);
add("level-40", "Elite", "Reach level 40", "Levels", "platinum", "shown", s => level(s) >= 40);
add("level-75", "Ascendant", "Reach level 75", "Levels", "mythic", "hidden", s => level(s) >= 75);
add("level-150", "Beyond", "Reach level 150", "Levels", "mythic", "secret", s => level(s) >= 150);
add("xp-100k", "Six-Figure Hacker", "100,000 lifetime XP", "Levels", "platinum", "shown", s => s.lifetimeXp >= 100000);
add("xp-million", "XP Millionaire", "1,000,000 lifetime XP", "Levels", "mythic", "hidden", s => s.lifetimeXp >= 1000000);

// ── Culture & memes ───────────────────────────────────────────────────────────
add("rubber-duck", "Rubber Duck", "????????", "Culture", "secret", "secret", s => distinctLangs(s) >= 1 && s.commits === 1);
add("imposter", "Imposter Syndrome (Cured)", "Reach level 20 — you belong here", "Culture", "gold", "secret", s => level(s) >= 20);
add("tabs-spaces", "Religious War Veteran", "Commit in 5+ languages (you've seen things)", "Culture", "silver", "secret", s => distinctLangs(s) >= 5);
add("ssh-survivor", "It Compiled First Try", "A perfect run — earn 300 XP from one commit-day with no zero-XP", "Culture", "gold", "secret", s => s.best.xpInDay >= 300);
add("yak-shave", "Yak Shaving", "Work across 3+ projects in your journey", "Culture", "bronze", "secret", s => projectCount(s) >= 3);
add("bus-factor", "Bus Factor: 1", "Be the sole hero of a 2,000 XP project", "Culture", "gold", "secret", s => Object.values(s.projects).some(p => !p.ext && p.xp >= 2000));
add("legacy-code", "Here Be Dragons", "Survive 5 memory bosses", "Culture", "silver", "secret", s => s.bossesSurvived >= 5);
add("ship-friday", "It's Friday, I'm In Love (with risk)", "5 Friday commits", "Culture", "silver", "secret", s => (s.days[5] ?? 0) >= 5);
add("touch-grass", "Touch Grass", "Take a break, then come back (fresh streak after 20+ commits)", "Culture", "bronze", "secret", s => s.commits >= 20 && s.streak === 1);
add("dark-mode", "Dark Mode Enjoyer", "30 commits after sunset (8pm+)", "Culture", "bronze", "secret", s => [20, 21, 22, 23].reduce((a, h) => a + (s.hours[h] ?? 0), 0) >= 30);
add("10x", "10x Developer", "Earn 1,000 XP in a day across multiple projects", "Culture", "platinum", "secret", s => s.best.xpInDay >= 1000 && projectCount(s) >= 2);
add("hacktoberfest", "Hacktober Spirit", "10 open-source commits", "Culture", "silver", "secret", s => s.ossCommits >= 10);
add("greenfield", "Greenfield", "Start a brand-new project", "Culture", "bronze", "secret", s => projectCount(s) >= 1);
add("brownfield", "Brownfield", "Earn XP across 10 projects", "Culture", "gold", "secret", s => projectCount(s) >= 10);

// ── AI / agents (the origin) ──────────────────────────────────────────────────
add("prompt-engineer", "Prompt Engineer", "Reach level 6", "AI", "bronze", "secret", s => level(s) >= 6);
add("agent-wrangler", "Agent Wrangler", "Survive the cloned-legion memory boss", "AI", "gold", "secret", s => (s.bestiary.claude?.count ?? 0) >= 1);
add("vibe-coder", "Vibe Coder", "Earn 2,000 XP", "AI", "silver", "secret", s => s.lifetimeXp >= 2000);
add("human-in-loop", "Human in the Loop", "Author commits across 20 different days", "AI", "silver", "secret", s => Object.keys(s.stats.daily).length >= 20);

// ── Secret / cryptic legends ──────────────────────────────────────────────────
add("the-chosen", "The Chosen One", "??????????", "Secret", "mythic", "secret", s => level(s) >= 42);
add("glass-cannon", "Glass Cannon", "?????", "Secret", "secret", "secret", s => level(s) >= 10 && s.ossCommits === 0);
add("renaissance", "Renaissance Dev", "OSS + your own work + a boss", "Secret", "platinum", "secret", s => s.ossCommits > 0 && s.commits > 0 && s.bossesSurvived > 2);
add("the-completionist", "The Completionist", "?????????", "Secret", "mythic", "secret", s => Object.keys(s.achievements).length >= 200);
add("speedrunner", "Any% Speedrun", "Reach level 5 fast", "Secret", "gold", "secret", s => level(s) >= 5 && s.commits <= 20);
add("the-lurker", "The Lurker", "?????", "Secret", "bronze", "secret", s => s.stats.activeSec >= 7200 && s.commits === 0);
add("phoenix", "Phoenix", "Rise to a 7-day streak after starting over", "Secret", "gold", "secret", s => s.streak >= 7 && s.commits >= 50);
add("the-architect", "The Architect", "10,000 XP across 5+ projects", "Secret", "platinum", "secret", s => s.lifetimeXp >= 10000 && projectCount(s) >= 5);
add("midas", "Midas Touch", "Touch a 10k★ repo AND run your own OSS", "Secret", "mythic", "secret", s => s.topStars >= 10000 && ossProjectCount(s) >= 1);
add("the-grindstone", "The Grindstone", "Bank 50 active hours", "Secret", "gold", "secret", s => s.stats.activeSec >= 180000);

// ── Batch II: more milestones, languages, combos, culture (still all hand-written) ──
add("commits-250", "Double Century", "250 commits", "Git", "silver", "shown", s => s.commits >= 250);
add("commits-500", "Five Hundred", "500 commits", "Git", "silver", "shown", s => s.commits >= 500);
add("commits-2500", "Commit Crusader", "2,500 commits", "Git", "gold", "shown", s => s.commits >= 2500);
add("commits-5000", "Commit Colossus", "5,000 commits", "Git", "platinum", "shown", s => s.commits >= 5000);
add("lines-250k", "Quarter Million", "250,000 lines", "Craft", "platinum", "shown", s => s.linesAdded >= 250000);
add("lines-500k", "Half a Million", "500,000 lines", "Craft", "mythic", "hidden", s => s.linesAdded >= 500000);
add("xp-25k", "Seasoned", "25,000 lifetime XP", "Levels", "gold", "shown", s => s.lifetimeXp >= 25000);
add("xp-250k", "XP Demigod", "250,000 lifetime XP", "Levels", "mythic", "hidden", s => s.lifetimeXp >= 250000);
add("xp-500k", "XP Titan", "500,000 lifetime XP", "Levels", "mythic", "hidden", s => s.lifetimeXp >= 500000);
add("level-60", "Sexagenarian", "Reach level 60", "Levels", "platinum", "shown", s => level(s) >= 60);
add("level-200", "Transcendent", "Reach level 200", "Levels", "mythic", "secret", s => level(s) >= 200);
add("level-500", "The Singularity", "Reach level 500", "Levels", "mythic", "secret", s => level(s) >= 500);
add("streak-60", "Two-Month Habit", "60-day streak", "Streak", "gold", "shown", s => bestStreak(s) >= 60);
add("streak-200", "Two Hundred Days", "200-day streak", "Streak", "mythic", "hidden", s => bestStreak(s) >= 200);
add("active-200h", "200 Hours In", "200 active hours", "Activity", "gold", "shown", s => s.stats.activeSec >= 720000);
add("active-500h", "500 Hours In", "500 active hours", "Activity", "platinum", "hidden", s => s.stats.activeSec >= 1800000);
add("sessions-1000", "Thousand Sessions", "1,000 sessions", "Activity", "platinum", "shown", s => s.stats.sessionCount >= 1000);
add("boss-25", "Boss Hunter", "Survive 25 bosses", "Boss", "silver", "shown", s => s.bossesSurvived >= 25);
add("boss-100", "Boss Legend", "Survive 100 bosses", "Boss", "platinum", "shown", s => s.bossesSurvived >= 100);
add("boss-250", "Boss Mythic", "Survive 250 bosses", "Boss", "mythic", "hidden", s => s.bossesSurvived >= 250);
add("stars-500", "Half-K Stars", "Touch a 500★ repo", "Prestige", "silver", "hidden", s => s.topStars >= 500);
add("stars-50k", "Mega Star", "Touch a 50,000★ repo", "Prestige", "mythic", "secret", s => s.topStars >= 50000);
add("oss-1000", "Commons Legend", "1,000 open-source commits", "OpenSource", "mythic", "hidden", s => s.ossCommits >= 1000);
add("ext-100", "Patch Saint", "Contribute to 100 others' repos", "OpenSource", "mythic", "hidden", s => s.extCommits >= 100);
add("oss-projects-5", "Steward", "Run 5 open-source projects", "OpenSource", "gold", "shown", s => ossProjectCount(s) >= 5);

// language flavor (more)
add("ruby-dev", "Rubyist", "Commit Ruby", "Languages", "silver", "secret", s => L(s, "Ruby") >= 1);
add("java-dev", "Enterprise Grade", "Commit Java", "Languages", "silver", "secret", s => L(s, "Java") >= 1);
add("kotlin-dev", "Kotlin Convert", "Commit Kotlin", "Languages", "silver", "secret", s => L(s, "Kotlin") >= 1);
add("swift-dev", "Swiftly", "Commit Swift", "Languages", "silver", "secret", s => L(s, "Swift") >= 1);
add("csharp-dev", "C-Sharp Shooter", "Commit C#", "Languages", "silver", "secret", s => L(s, "C#") >= 1);
add("php-dev", "PHP Survivor", "Commit PHP", "Languages", "bronze", "secret", s => L(s, "PHP") >= 1);
add("dart-dev", "Bullseye", "Commit Dart", "Languages", "bronze", "secret", s => L(s, "Dart") >= 1);
add("scala-dev", "Scalable", "Commit Scala", "Languages", "silver", "secret", s => L(s, "Scala") >= 1);
add("clojure-dev", "Parenthesis Pilgrim", "Commit Clojure", "Languages", "gold", "secret", s => L(s, "Clojure") >= 1);
add("nix-dev", "Reproducible", "Commit Nix", "Languages", "gold", "secret", s => L(s, "Nix") >= 1);
add("astro-dev", "Astronaut", "Commit Astro", "Languages", "silver", "secret", s => L(s, "Astro") >= 1);
add("rust-1k", "Crab God", "1,000 Rust commits", "Languages", "platinum", "hidden", s => L(s, "Rust") >= 1000);
add("go-500", "Gopher Veteran", "500 Go commits", "Languages", "gold", "hidden", s => L(s, "Go") >= 500);
add("py-500", "Snake Charmer", "500 Python commits", "Languages", "gold", "hidden", s => L(s, "Python") >= 500);
add("css-titan", "CSS Titan", "50,000 lines of CSS", "Languages", "platinum", "hidden", s => LL(s, "CSS") >= 50000);
add("rust-author", "Ferrous Author", "10,000 lines of Rust", "Languages", "gold", "hidden", s => LL(s, "Rust") >= 10000);
add("sql-author", "Query Author", "5,000 lines of SQL", "Languages", "gold", "hidden", s => LL(s, "SQL") >= 5000);

// combos (multi-signal)
add("oss-polyglot", "Open Polyglot", "5 languages and 5 OSS commits", "Combo", "gold", "secret", s => distinctLangs(s) >= 5 && s.ossCommits >= 5);
add("night-poly", "Midnight Polyglot", "4 languages and 5 night commits", "Combo", "gold", "secret", s => distinctLangs(s) >= 4 && nightCommits(s) >= 5);
add("triple-threat", "Triple Threat", "3 projects at 1,000+ XP each", "Combo", "platinum", "hidden", s => Object.values(s.projects).filter(p => p.xp >= 1000).length >= 3);
add("empire", "Empire Builder", "Earn XP across 50 projects", "Combo", "mythic", "hidden", s => projectCount(s) >= 50);
add("full-stack-pro", "T-Shaped", "Full-stack across 5+ languages", "Combo", "gold", "secret", s => distinctLangs(s) >= 5 && (L(s, "CSS") + L(s, "HTML") > 0) && (L(s, "SQL") + L(s, "Go") + L(s, "Rust") + L(s, "Python") > 0));
add("oss-star-combo", "Famous Friend", "External OSS commit to a 1k★ repo", "Combo", "platinum", "secret", s => s.extCommits >= 1 && s.ossCommits >= 1 && s.topStars >= 1000);
add("grind-poly", "Polyglot Grinder", "100 active hours and 8 languages", "Combo", "platinum", "secret", s => s.stats.activeSec >= 360000 && distinctLangs(s) >= 8);
add("week-and-langs", "Renaissance Week", "All 7 weekdays and 5 languages", "Combo", "gold", "secret", s => distinctDays(s) >= 7 && distinctLangs(s) >= 5);
add("relentless", "Relentless", "30-day streak and 100 active hours", "Combo", "platinum", "secret", s => bestStreak(s) >= 30 && s.stats.activeSec >= 360000);
add("the-trifecta", "The Trifecta", "OSS + external + a 1k★ project", "Combo", "platinum", "secret", s => s.ossCommits > 0 && s.extCommits > 0 && s.topStars >= 1000);
add("weekend-devotee", "Weekend Devotee", "10+ commits on both Sat and Sun", "Combo", "gold", "secret", s => (s.days[6] ?? 0) >= 10 && (s.days[0] ?? 0) >= 10);
add("insomniac", "Insomniac", "Commit in every hour from midnight to 4am", "Combo", "platinum", "secret", s => [0, 1, 2, 3, 4].every(h => (s.hours[h] ?? 0) > 0));
add("all-nighter", "All-Nighter", "50 commits between midnight and 4am", "Combo", "gold", "secret", s => nightCommits(s) >= 50);
add("power-hour", "Power Hour", "50+ commits in a single hour-of-day", "Combo", "gold", "secret", s => Object.values(s.hours).some(v => v >= 50));
add("eat-sleep", "Eat, Sleep, Code", "100-day streak and 200 active hours", "Combo", "mythic", "secret", s => bestStreak(s) >= 100 && s.stats.activeSec >= 720000);

// culture / memes (more)
add("heisenbug", "Heisenbug", "It only breaks when you're not looking — reach Lv9", "Culture", "silver", "secret", s => level(s) >= 9);
add("ship-prod", "Works In Prod", "Reach level 30 without losing your mind", "Culture", "gold", "secret", s => level(s) >= 30);
add("semicolon", "Semicolon Survivor", "Commit both JS and TS", "Culture", "bronze", "secret", s => L(s, "JavaScript") > 0 && L(s, "TypeScript") > 0);
add("scope-creep", "Scope Creep", "Spread across 15 projects", "Culture", "silver", "secret", s => projectCount(s) >= 15);
add("tech-debt", "Tech Debt Collector", "100,000 lines (someone has to maintain it)", "Culture", "gold", "secret", s => s.linesAdded >= 100000);
add("premature-opt", "Premature Optimization", "Survive 10 perf bosses", "Culture", "silver", "secret", s => s.bossesSurvived >= 10);
add("copy-paste", "Stack Overflow Scholar", "12 languages (you've copied them all)", "Culture", "gold", "secret", s => distinctLangs(s) >= 12);
add("one-more-thing", "One More Thing", "A 6-hour session", "Culture", "gold", "secret", s => s.stats.longestSec >= 21600);
add("caffeinated", "Caffeinated", "30 commits before 9am", "Culture", "silver", "secret", s => [6, 7, 8].reduce((a, h) => a + (s.hours[h] ?? 0), 0) >= 30);
add("ghost", "Ghost in the Machine", "Bank 5 active hours with very few commits", "Culture", "bronze", "secret", s => s.stats.activeSec >= 18000 && s.commits <= 5);
add("the-veteran", "Old Guard", "Active for 200 different days", "Culture", "platinum", "secret", s => Object.keys(s.stats.daily).length >= 200);
add("legendary-day", "Legendary Day", "1,500 XP in a single day", "Culture", "mythic", "secret", s => s.best.xpInDay >= 1500);
add("the-pilgrimage", "The Pilgrimage", "Reach level 33 and 10 languages", "Culture", "mythic", "secret", s => level(s) >= 33 && distinctLangs(s) >= 10);
add("minimalist", "Minimalist", "Reach Lv5 with under 1,000 lines", "Culture", "silver", "secret", s => level(s) >= 5 && s.linesAdded < 1000);
add("maximalist", "Maximalist", "Reach Lv5 with over 50,000 lines", "Culture", "silver", "secret", s => level(s) >= 5 && s.linesAdded >= 50000);

// ── Batch III: fill out the early/mid ladder ────────────────────────────────────
add("xp-2500", "Apprentice Earner", "2,500 lifetime XP", "Levels", "bronze", "shown", s => s.lifetimeXp >= 2500);
add("commits-50", "Half Century", "50 commits", "Git", "bronze", "shown", s => s.commits >= 50);
add("lines-5k", "Five-K Lines", "5,000 lines", "Craft", "bronze", "shown", s => s.linesAdded >= 5000);
add("streak-21", "Habit Formed", "21-day streak", "Streak", "silver", "shown", s => bestStreak(s) >= 21);
add("active-25h", "Twenty-Five Hours", "25 active hours", "Activity", "silver", "shown", s => s.stats.activeSec >= 90000);
add("sessions-100", "Hundred Sessions", "100 sessions", "Activity", "silver", "shown", s => s.stats.sessionCount >= 100);
add("projects-3", "Three's Company", "Work on 3 projects", "Projects", "bronze", "shown", s => projectCount(s) >= 3);
add("oss-25", "Quarter Sauce", "25 open-source commits", "OpenSource", "silver", "hidden", s => s.ossCommits >= 25);
add("ext-25", "Generous", "25 external commits", "OpenSource", "silver", "hidden", s => s.extCommits >= 25);
add("lang-3", "Trilingual", "3 languages", "Polyglot", "bronze", "shown", s => distinctLangs(s) >= 3);
add("lang-7", "Seven Tongues", "7 languages", "Polyglot", "silver", "shown", s => distinctLangs(s) >= 7);
add("boss-5", "Boss Apprentice", "Survive 5 bosses", "Boss", "bronze", "shown", s => s.bossesSurvived >= 5);
add("days-50", "Fifty Days In", "Active on 50 different days", "Streak", "silver", "shown", s => Object.keys(s.stats.daily).length >= 50);
add("xp-day-200", "Solid Day", "200 XP in a day", "XP", "bronze", "hidden", s => s.best.xpInDay >= 200);
add("level-90", "Nonagenarian", "Reach level 90", "Levels", "platinum", "hidden", s => level(s) >= 90);

// ── Co-authorship & AI participation ──────────────────────────────────────
// SERVER-EVALUATED — the predicate stays false so the CLI's client-side eval pass
// never grants them. /api/verify computes the criteria from the player row
// (attribution_score, is_ai, ai_attestation) and inserts into player_achievements
// directly. They appear in the catalog so the DB seed populates id+name+description
// for display.
add("better-together", "Better Together", "First commit you're co-authored on", "Pair", "bronze", "shown", _ => false);
add("symbiote-100", "Symbiote", "100 co-authored commits", "Pair", "silver", "shown", _ => false);
add("symbiote-1k", "Pair Programmer", "1,000 co-authored commits", "Pair", "gold", "shown", _ => false);
add("cohabit-10k", "Cohabitant", "10,000 co-authored commits", "Pair", "platinum", "shown", _ => false);
add("ai-revealed", "Out in the Open", "Marked as an AI participant — earning identically to humans with the badge for transparency", "AI", "bronze", "shown", _ => false);
add("ai-attested", "Attested AI", "AI status backed by a public attestation from your provider", "AI", "silver", "shown", _ => false);
add("ai-verified", "Verified AI", "AI status cryptographically verified against your provider's published key", "AI", "mythic", "shown", _ => false);
add("ai-self-verified", "Self-Keyed AI", "AI status attested with a hardware-key WebAuthn assertion (no provider key required)", "AI", "silver", "shown", _ => false);

export const CURATED = A;
