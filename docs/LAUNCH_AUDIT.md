# Launch audit — 2026-10-24

Recommendation: **NO-GO for production launch.** This checkpoint preserves and hardens the existing application; it does not complete the ten-phase product mission.

## Evidence and architecture

- `package.json`, `bun.lock`: TanStack Start 1.168.60, Router 1.170.41, React 19, Vite 7.3.7, Nitro 3 beta, Supabase, Vitest 4. Bun's frozen lockfile installed successfully. No replacement application was created.
- `src/routes/_authenticated/`, `src/components/studio/Workspace.tsx`: authenticated dashboard, persistent navigation, streamed conversations, branching, recovery and optional context panels.
- `src/lib/chat-protocol.server.ts`, `src/routes/api/chat.ts`: neutral messages translated into OpenAI Responses, Anthropic Messages or compatible Chat Completions; browser executes registered tools.
- `provider-keys.functions.ts`, `provider-keys.server.ts`, `api/providers.ts`: authenticated connection management, encrypted provider credentials, model listing and non-generating connection checks.
- `workspace-fs.ts`, `linux-environment.ts`, `linux-worker.ts`, `wasm-processes.ts`: private storage-backed workspace files, revision-checked browser Linux overlays, isolated WASM processes.
- `cloud-git.ts`, `git-http.server.ts`: isomorphic-git repositories and short-lived, repository-scoped read-only clone tokens.
- `skills.ts`, `tools.ts`, `agent-policy.ts`: progressively loaded instructions and browser tool permission checks. Imported instructions are not proof of executable integration.
- `web-preview.ts`, `ProjectsPanel.tsx`: browser bundling and sandboxed previews. Builds/publication are separate permission capabilities.
- `drizzle/schema.ts` is empty; generated Supabase types describe many tables absent from migration history. Database policies and storage must be verified against the actual deployment.

## Feature status

| Area                                                       | Evidence-based status                                                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing conversation, recovery, branching and Git helpers | Implemented; covered by deterministic tests. Live authenticated workflows not verified here.                                                                    |
| OpenAI / Anthropic / Gemini                                | Existing request adapters retained. Account access, model availability and live inference untested.                                                             |
| OpenRouter                                                 | Dedicated key ID and backend discovery added; pricing/capabilities parsed dynamically. Existing custom key IDs preserved. Full picker integration remains work. |
| Ollama Cloud                                               | Separate fixed HTTPS provider and key management added. Compatible request fields tested; live account and quotas untested.                                     |
| Ollama Local                                               | Loopback validation and metadata parsing added. Browser transport/setup UI is not implemented in this checkpoint. Server-side localhost requests are rejected.  |
| Provider connection checks                                 | Authenticated model-list requests; explicitly do not certify inference. No billable inference was performed.                                                    |
| Provider persistent storage                                | Versioned AES-GCM with owner/provider binding, retained rotation keys and legacy ciphertext reads; needs configured master secret.                              |
| Ephemeral credentials                                      | Server header path exists; session-only client lifecycle/UI remains incomplete.                                                                                 |
| Workspace, terminal, preview, export                       | Existing code retained. Unit coverage exists; browser smoke and live storage verification remain required.                                                      |
| Skills                                                     | Import/enable/load exists. Trust review, dependency verification and selection modes are incomplete.                                                            |
| Video/music                                                | Server explicitly rejects these BYOK operations; old selectable UI remains misleading and must be corrected.                                                    |
| Deploy/publish/GitHub actions                              | Do not claim available without their actual integration. No public deployment performed.                                                                        |

## P0: security and integrity

1. **Addressed in source:** arbitrary custom provider bases now require exact operator approval; credential-bearing redirects are rejected. Custom requests use public-IP validation and DNS-pinned sockets.
2. **Addressed in source:** webpage redirects are checked before contact; private/reserved answers, mapped loopback and nonstandard ports are blocked. Reads are bounded before buffering the entire payload.
3. **Addressed in source:** credentials use randomized authenticated encryption with version/key IDs and account/provider additional data; owner filters supplement RLS. Keys are not returned by list/save operations.
4. **Pending database approval:** `0000_provider_keys_open_signups.sql` disables the documented single-owner lock. `0001_restore_single_owner.sql` restores it and serializes concurrent first signups. It has **not been applied or database-tested**. Existing user rows are not removed.
5. **Unverified:** actual RLS, storage policies, first-admin trigger/RPC and cross-account isolation. The full original schema is missing from this export.
6. **Outstanding:** sponsored public gateway usage requires durable quotas/concurrency/spending controls and a shutdown switch before enablement. Do not configure an unrestricted platform key for launch.
7. **Outstanding:** chat request validation/stream completion limits, upstream error redaction and media request lifecycle need further review.

## P1: provider/runtime correctness

- Finish model picker discovery, availability, favorites/default, capability enforcement, context/output limits, usage and labeled estimates.
- Implement consented browser-to-loopback Ollama without a production localhost proxy; document browser origin/local-network restrictions.
- Check actual provider-native account model access. Registry comments about prior gateway verification do not establish direct-provider verification.
- Strengthen default risky-action approvals and skill trust/dependency handling; retain mandatory build/publish approvals.
- Correct selectable video/music UI and unsupported image-model claims.

## P2: quality and operations

- Repository-wide lint still fails; preserve strict rules and repair existing formatting/type debt incrementally.
- Add authenticated browser smoke tests, mobile/accessibility coverage, provider failure tests and deployed isolation checks.
- Validate Node/Vercel and Cloudflare behavior separately. A Cloudflare bundle building successfully does not validate Node DNS/HTTP socket features at runtime.
- Establish monitoring, backup/restore drills, privacy/terms/acceptable-use review and operator release approval.

No production database writes, destructive migrations, provider charges or public deployment occurred.
