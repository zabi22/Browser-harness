# Development and deployment

No production deployment or database change was performed. Keep Vite 7.x and the checked-in Bun lockfile.

## Local setup

1. Install Node 22+ and Bun, then run `bun install --frozen-lockfile`.
2. Copy `.env.example` into an ignored `.env.local`; fill Supabase URL/publishable configuration for your own instance. Server variables use `SUPABASE_*`; browser variables use `VITE_SUPABASE_*`.
3. Store a cryptographically random provider encryption secret and stable key ID in the server secret manager. `PROVIDER_KEY_PREVIOUS_SECRETS` is optional JSON for retained rotation secrets; `PROVIDER_BASE_URL_ALLOWLIST` is a comma-separated list of exact trusted HTTPS bases.
4. Run `bun run dev`. Run typecheck, tests, lint and build before release. Never put service-role or provider secrets in public variables.

## Database and migration limits

The export's generated types reference tables, RPCs, RLS policies and private buckets absent from the supplied migration history; `drizzle/schema.ts` is empty. **A blank Supabase project cannot be recreated from this repository alone.** Export/restore the original schema and policies through an operator-approved database workflow first. Do not run schema generation/push against production from the blank schema.

Review `drizzle/migrations/0001_restore_single_owner.sql` against the real database and test two concurrent first signups in staging. It restores signup blocking without deleting existing users, keeps `registration_open()` compatible with the sign-in page, and does not replace existing admin assignment logic. Obtain explicit approval before applying it. Never rerun or edit an already-applied migration as a substitute for a forward migration.

## Node / Vercel

The installed Lovable Vite wrapper supports Nitro target selection via `NITRO_PRESET` and host auto-detection. Build with the intended Node/Vercel target in CI and test actual streaming limits, abort handling, private Supabase storage and DNS-pinned fetch. Configure secrets in the hosting dashboard, HTTPS and request/concurrency limits. Do not assume a successful default build validates a Vercel deployment.

The development branch adds the cross-platform `bun run build:node` script, which selects Nitro's `node-server` preset while preserving the default Lovable/Cloudflare build command. Its generated server was started locally and returned 200 for liveness and 401 for anonymous readiness. This does not certify Vercel-specific limits or deployed networking.

Persistent files live in private Supabase storage, not ephemeral serverless disk. Linux and WASM processes run in browser workers, not persistent server processes. Browser guest memory/CPU depends on the user's device. Long provider streams remain subject to host execution limits.

## Cloudflare

The default Nitro build produces a Cloudflare worker bundle and has compiled locally. The new public/custom-fetch transport uses `node:dns`, `node:http`, `node:https` and Node-to-Web streams. These need actual compatible runtime support; **deployed Cloudflare page/custom-provider fetch is not certified**. Fixed official-provider fetch uses Web fetch. Until a secure target-specific egress solution is verified, use a compatible Node deployment for DNS-pinned features, or fail closed with an unavailable status. Never replace validation with an unrestricted proxy.

## Health, backups and recovery

Dedicated health/readiness endpoints are not implemented in this checkpoint. Add liveness without secrets and authenticated/config-only readiness before launch; do not make billable inference part of health polling.

Development branch update: `/api/health` now provides no-store process liveness; `/api/ready` requires a verified bearer session and reports configuration-only status. It explicitly does not certify provider inference or all database/storage behavior.

The development branch also includes an experimental personal local Playwright companion; see [BROWSER_ENGINE.md](BROWSER_ENGINE.md). It requires development dependencies, Chrome and Node 22.18+ (24 LTS recommended). It is started explicitly on the user's device, not deployed inside Vercel/Cloudflare app functions. Cloudflare Browser Run and hosted browser containers remain unconfigured and untested.

Use the existing password-encrypted account backup and workspace exports. Also back up database schema/data, private storage, encrypted provider rows and matching server encryption key versions through separate access-controlled operator backups. Test recovery into a separate staging project; do not overwrite production as a test. Interrupted replies retain recovery journals and require user consent to resume.

Publishing MVP: user-owned Git repository and provider credentials, a reviewable file/commit diff, explicit build/deploy approval, isolated build runner, scoped deploy token, and deployment receipts. Do not claim existing placeholder controls implement that complete workflow.

## Production checklist

Configure Supabase authentication/redirects and every RLS/storage policy; verify single-owner and admin paths; configure master-key rotation; limit public gateway budgets or leave sponsorship disabled; set security headers and host limits; finish monitoring and backup drills; obtain privacy, terms and acceptable-use approval. Follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
