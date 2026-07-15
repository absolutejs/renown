# Repository privacy boundary

Repository identity is sensitive. Knowing that `org/codename` exists can disclose a product,
customer, acquisition, or internal initiative even when GitHub correctly returns 404.

Renown therefore uses these invariants:

1. The CLI keeps private and unknown repository names and per-repository metrics on-device.
   They may contribute to local gameplay and aggregate personal progress, but `selfEntry` sends
   only repositories that local GitHub metadata confirms are public.
2. The server never trusts a client-provided public flag. Before accepting repository data it
   independently asks GitHub. Private or unverifiable repositories are not inserted.
3. Every anonymous repository surface (`trending`, project/org boards, profiles, JSON, badges,
   board SVGs, and OG images) requires `projects.visibility = 'public'`. The default is
   `unknown`, so legacy data and lookup failures fail closed.
4. A confirmed public-to-private transition deletes the shared project row and cascades its
   contributor rows. A transient verification failure changes an existing project to `unknown`,
   hiding it until public status is confirmed again.
5. The legacy migration marks every row `unknown`, including historical `oss=true` rows because
   a formerly public repository may since have become private. The cleanup script checks every
   row and purges private, deleted, or inaccessible repositories.

## Private collaboration

Private work remains fully usable locally. Renown deliberately does not offer a cloud private
team board yet: the existing anonymous ingest and a repository-name-based ACL cannot prove
GitHub access and would not be a real privacy boundary.

A future private team board must use a GitHub App installation with least-privilege repository
selection. Installation access is the membership authority; every read and write must verify
the requesting Renown user against the installation, private responses must use `Cache-Control:
private, no-store`, and repository webhooks must revoke/purge access immediately when an
installation is removed or repository visibility changes. Until all of those properties exist,
private repository data stays local.

## Deployment

Run these before deploying code that reads `projects.visibility`:

```sh
bun run db/migrate-add-project-visibility.ts
bun run db/purge-nonpublic-projects.ts
```

The cleanup stops on GitHub rate limits or transient server errors; unprocessed rows remain
`unknown` and hidden. It is safe to rerun.
