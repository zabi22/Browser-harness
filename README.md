# OpenChat AI Harness / Browser-harness

An existing Lovable-connected, private developer studio built with TanStack Start, React 19, TypeScript, Tailwind CSS, and Supabase. The repository includes branching conversations, browser-side agents and tools, workspace files, isolated browser Linux, Git, backups, and project previews.

Source: https://github.com/zabi22/Browser-harness

## Development

Use Node 22 or later and Bun. The checked-in `bun.lock` is authoritative; keep Vite on 7.x.

```sh
bun install --frozen-lockfile
# Copy .env.example to an ignored .env.local and configure your own Supabase project.
bun run dev
bun run typecheck
bun run test
bun run lint
bun run build
node tooling/scan-secrets.mjs --history
```

Only `VITE_SUPABASE_*` publishable configuration belongs in the client. Provider encryption secrets, service-role credentials, and provider keys must remain server-side. `.env.example` contains variable names without secret values.

## Status and operations

This is a development checkpoint, not a production launch certification. Read [the audit](docs/LAUNCH_AUDIT.md), [implementation report](docs/IMPLEMENTATION_REPORT.md), [test results](docs/TEST_RESULTS.md), [security review](docs/SECURITY_REVIEW.md), [deployment guide](docs/DEPLOYMENT.md), and [release checklist](docs/RELEASE_CHECKLIST.md).

No database migration or deployment is run automatically. The supplied database migration history is incomplete for a fresh installation; preserve the existing Supabase database and obtain its full schema/policies before attempting a clean self-hosted setup.

## Lovable connection

This project was built with [Lovable](https://lovable.dev). Commits pushed to a connected branch can sync back to the editor. Preserve published history: do not force-push, amend, squash, or rebase pushed commits.
