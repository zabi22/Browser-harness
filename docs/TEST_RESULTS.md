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

## Final development branch verification

Final real Chrome suite: **7 passed**, including browser-native adapter pairing over CORS and a real fixture observation.

| Check                                   | Result                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration suite                  | **275 passed, 34 test files**                                                                                                                      |
| TypeScript                              | **Passed**, including application code, Playwright config and browser test sources                                                                 |
| New browser/security modules ESLint     | **0 errors**; declaration-file matching emits an informational ignore warning when explicitly passed                                               |
| Repository-wide ESLint                  | **Failed: 29 errors, 11 warnings** after formatting cleanup; legacy explicit-any, console-control regex, unused expression and related debt remain |
| Default Vite/Nitro Cloudflare bundle    | **Passed**; deployed Cloudflare behavior is not certified                                                                                          |
| Explicit `build:node` production bundle | **Passed**, Nitro `node-server` preset verified                                                                                                    |
| Running Node production liveness        | **HTTP 200**, `{ "status": "ok" }`                                                                                                                 |
| Running Node anonymous readiness        | **HTTP 401**, as required                                                                                                                          |
| Secret scan                             | **0 potential findings** across safe project text and reachable text history at the recorded run; rerun before publication                         |
| Whitespace/error checks                 | `git diff --check` passed                                                                                                                          |

The real Chrome suite verifies desktop/mobile sign-in rendering and keyboard focus using mocked Supabase endpoints; live app health/auth boundaries; local browser DOM/screenshot/QA findings/tabs; redirect denial before another local origin is contacted; and pairing/origin/account/workspace checks. A browser-native adapter/CORS check additionally pairs the actual browser client to the local runner and reads a real fixture observation. The final browser test count is recorded in the PR verification report.

Early fixture runs exposed two failures: cleanup tried to close an already-closed denied session, and an isolation test depended on another test's earlier pairing. Close is now idempotent, denied sessions become unavailable, and the owner test establishes its own session. Subsequent real browser runs passed. A new UI test typing issue (`exact` on Testing Library's role options) was corrected with an exact regular-expression name matcher.

The browser-native transport check then exposed an actual Chrome-only `fetch` receiver error that injected Node fetch mocks did not catch. The default transport now calls `globalThis.fetch` through a wrapper so its receiver remains correct. That regression is covered by the real browser-origin pairing test.

Reviewable evidence is under `docs/evidence/`: a real mobile fixture screenshot and local app desktop/mobile sign-in screenshots. Screenshots contain no authenticated account or provider credentials. Runtime QA reports, traces and pairing files remain ignored in `artifacts/`.

Live provider inference, real Supabase signup/RLS/storage flows, database migration execution, cloud browsers, deployed Vercel/Cloudflare isolation and production restore drills remain unverified. This is not a full end-to-end production certification.
