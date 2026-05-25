# Anti-gaming: rewarding true users

renown is open source and commit-driven. So the formula is public and "just make commits"
is the obvious exploit. The strategy is **not** secrecy — it's making the *rewarded* signals
ones that a formula-reader still can't fake, plus server-side verification. Defense in depth:

### 1. Separate the fun layer from the reward layer
Local XP, skills, levels, the HUD, `summon` previews — **ungated on purpose**. Faking your
own dashboard is pointless and the motivation is the point. Nothing here confers status.

### 2. Ownership/rewards require work *other humans validated*
Coins, crates, **ownable** collectibles, on-chain 1/1s, and leaderboard rank draw on
`rewardValue = xp × genuineness` (`core/trust.ts`), where `genuineness` only rises from
signals you can't fake by knowing the formula:
- **public + licensed OSS** — accountable, tied to your real identity, reputationally costly;
- **stars** — other people valued it;
- **commits to repos you don't own** — maintainers accepted/merged your work.
Private throwaway commits, bot-farmed history, and edited local state → **genuineness 0 →
0 reward value**, however much "XP" they generate. (Ownable wild creatures are gated on
`isOwnable`.)

### 3. Server-side verification is the real gate
The client is untrusted (anyone can edit `~/.renown/state.json`). The reward path
**recomputes from the GitHub API**: the commit exists, you authored it, and the repo's
stars/license/owner are real. The on-chain **Attestation** (`@absolutejs/onchain`) only signs
a `fact` that GitHub independently confirms — so neither a player nor the operator can mint a
token without the genuine interaction having happened.

### 4. Substance scoring already nukes low-effort
`craft.ts`: generated/lockfile/dist/minified ≈ 0, near-duplicate ×0.35, junk/empty message
×0.6, tiny commits capped, per-day diminishing returns. Padding doesn't pay.

### 5. Caps, diversity & anomaly detection (server-side, thresholds kept private)
Per-day and per-repo caps so you can't farm one repo; require contribution spread; and an
anomaly model flags robotic patterns — uniform commit sizes, machine-gun timing, brand-new
accounts with sudden huge history, mass backfills. The *algorithm* can be open while the
*thresholds + model* stay server-side.

### 6. Provably-fair rare rolls
The genuine 1/1 / legendary roll uses **Chainlink VRF** (or commit-reveal) so eligibility
can't be re-rolled or validator-gamed. Eligibility (genuine work) gates *entry*; VRF makes
the *draw* fair.

### Honest limits
Perfect Sybil-resistance is impossible. The goal is to make gaming **cost more than the
reward** and to make the **top rewards require real human validation** (stars, merges,
adoption) that a lone attacker can't manufacture. A solo dev's genuine *private* work earns
full personal XP but not public status — public status requires public, accountable work.
Tunable: `OWNABLE_THRESHOLD` in `core/trust.ts`; integrate Gitcoin Passport / account-age
signals server-side later for stronger sybil-resistance.
