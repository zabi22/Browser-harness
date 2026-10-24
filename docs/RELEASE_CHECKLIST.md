# Release checklist

Current recommendation: **NO-GO**. The GitHub checkpoint is source backup and review material, not authorization to deploy.

- [x] Preserve the existing app and create an initial local checkpoint.
- [x] Exclude local environment values, private keys, dependencies and generated outputs.
- [x] Add owner-bound encrypted credentials and rotation regression tests.
- [x] Harden public/custom outbound destinations, redirects and response limits.
- [x] Run deterministic tests and production build; repair TypeScript regression.
- [ ] Clear repository-wide lint debt without suppressing checks.
- [ ] Obtain the full database schema/RLS/storage migration history.
- [ ] Review, approve and staging-test the single-owner registration repair.
- [ ] Verify both first-admin paths and authenticated cross-user/workspace isolation.
- [ ] Test provider add/replace/delete and real inference using authorized test accounts.
- [ ] Complete discovered model picker, capabilities, favorites/default and usage display.
- [ ] Complete consented browser-local Ollama discovery/streaming and diagnostics.
- [x] Disable unsupported video/music selection and model tool registration on the development branch.
- [ ] Audit the remaining unavailable integration/model claims.
- [ ] Audit command/destructive-action approvals, skill trust and dependencies.
- [ ] Add durable sponsored quotas, concurrency/spend limits and shutdown switch, or leave sponsorship disabled.
- [ ] Finish request/stream/error redaction hardening and secret-leak tests.
- [ ] Run authenticated browser, refresh/recovery, mobile, keyboard and accessibility smoke tests.
- [ ] Validate the actual Node/Vercel target and Cloudflare limitations separately.
- [x] Add liveness and authenticated configuration-only readiness on the development branch.
- [ ] Add monitoring and a tested backup/restore drill.
- [ ] Approve privacy policy, terms, acceptable-use requirements and support process.
- [ ] Obtain explicit operator approval for production migration and public deployment.
