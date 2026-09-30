# Progress persistence and recovery

The Node CLI and Bun engine share `~/.renown/state.json`. Their read/modify/write
operations must use `withLocalLock`. Save writes use unique temporary files, fsync
the contents, rename atomically, and fsync the containing directory. Read failures,
invalid JSON, invalid progression fields, unsupported versions, and mismatched
identities must stop the operation rather than initialize a replacement save.

Previously both writers used `state.json.tmp`. A second writer could truncate that
file immediately before the first renamed it onto the live save. The next reader
treated the resulting parse failure as a new installation and persisted empty
progress. Configuration loading also rewrote state during read-only commands,
allowing stale readers to overwrite newer progress. There were no save backups.

Each successful save now keeps the previous valid document in `state.json.bak`
and the first valid document of each UTC day in `save-history/`. Config writes
follow the same backup protocol. These copies are not automatically substituted
for unreadable data: the original evidence stays intact for an explicit recovery.

The server merges cumulative snapshot fields with maxima, skills per key, and
achievement/project sets by identity. Snapshot values must never be added together
as if they were new XP grants. `db/migrate-preserve-progress.ts` installs a database
guard against regressions from older clients or concurrent server instances, plus
daily `player_progress_history` records. Set `RENOWN_PROGRESS_PLAYER_ID` for a
repair authorized for one player; omit it for an approved application-wide rollout.
The guard deliberately does not alter verified scores or identity ownership.

Commit reconciliation checkpoints advance only through successfully processed
commits. A backlog larger than fifty resumes on subsequent heartbeats. The
`scoredCommits` ledger prevents replaying recovered commits or overlapping clones
from awarding the same commit twice. All existing watched repositories are checked;
older entries are no longer silently excluded by a last-forty limit.

For recovery, preserve the local save/config and a database snapshot first. Verify
the canonical player through its auth user and `player_accounts`; multiple GitHub
identities do not imply multiple Renown players. Prefer an intact historical save
or isolated point-in-time database branch. Merge surviving cumulative records and
preserve original achievement timestamps. Keep independent records of every
reconstruction input, commit SHA, scoring rule, and unavailable field. Git replay
under current rules and XP inferred from rounded HUD percentages are reconstructed
values or lower bounds, not an exact copy of a missing historical save.

Regression coverage includes corrupt saves, identity mismatches, concurrent CLI
processes, read-only HUD operations, backup retention, sparse/reordered snapshots,
commit backlogs, and replay idempotency in `tests/progressRecovery.test.ts`.
