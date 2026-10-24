# Test results — 2026-10-24

## Baseline from the local initial checkpoint

- Frozen Bun install: succeeded (802 packages; no lockfile upgrade).
- Vitest: **187 passed, 23 files**.
- TypeScript: failed on `Mascot.tsx`, because `custom` was used to index a three-provider sprite map.
- Build: first baseline attempt was blocked by the Windows sandbox's parent-directory access restriction. This is an environment failure, not evidence of an application build defect.
- Full lint: existing source formatting and explicit-any debt. The initial vendor-inclusive invocation was too expensive; vendored third-party code and generated audit artifacts are now excluded from application lint.

## Current checkpoint

- Vitest: **233 passed, 26 files** after adding encryption/rotation, legacy migration-read, caller authentication, SSRF/DNS pinning, redirect, response size and provider metadata tests.
- TypeScript: **passed** after fixing both the baseline mascot issue and the new test mock typings.
- Production Vite/Nitro build: **passed**, including server and Cloudflare worker packaging. Sandbox escalation was needed for esbuild's filesystem reads.
- Targeted ESLint for new security/provider modules and their tests: **passed**.
- Repository-wide ESLint: **failed** at the recorded run: 2,317 errors and 12 warnings, including 2,286 auto-fixable formatting errors. No rule was weakened to claim success. Further UI/document changes will be checked before the final checkpoint.
- Secret scan: scans safe project files and reachable text history without printing candidate values. Final result is recorded in the checkpoint report; a dummy URL fixture was corrected after a false positive.

## Not run / not certified

- Live provider inference: no API keys or billable-request authorization used.
- Live Supabase onboarding, persisted key workflows, per-user RLS/storage isolation and concurrent signup migration: not executed.
- Local Ollama inference: browser transport is not yet implemented.
- Authenticated browser/mobile/accessibility smoke tests: not executed.
- Vercel/Cloudflare deployed runtime tests, deploy integrations and restore drills: not executed.

Local logs under ignored `artifacts/` retain command details. Passing mocks and a build do not certify external connections or launch readiness.
