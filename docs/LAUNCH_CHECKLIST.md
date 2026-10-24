# Browser harness launch checklist

Recommendation: **NO-GO for a production multi-user browser/AI platform**. See the existing [release checklist](RELEASE_CHECKLIST.md) and [audit](LAUNCH_AUDIT.md).

- [x] Preserve and push the verified original application checkpoint to `main`.
- [x] Develop further changes on a separate branch with grouped commits.
- [x] Harden request bodies, SSE framing/completion, credential errors and health checks.
- [x] Implement and test a real local read-only Playwright companion with actual observations and receipts.
- [x] Verify denied redirects, pairing/origin boundaries and owner/workspace scope in local browser fixtures.
- [x] Connect Browser QA UI and agent tool approval gates without launching browsers in the production app server.
- [x] Default new settings to Ask; keep deletion/build/publication approval requirements explicit.
- [x] Import skills disabled for review and expose their full instructions before enablement.
- [ ] Finish and independently review hardened browser OS/container CPU, memory, process and network isolation.
- [ ] Add authenticated hosted browser adapters with server-verified workspace ownership and scoped credentials.
- [ ] Add click/fill/write tools only with explicit high-impact action approvals and source repair diff workflows.
- [ ] Finish local Ollama inference, capability-aware model picker, usage and cost display.
- [x] Disable unsupported video/music controls and omit them from executable model tools.
- [ ] Audit all other legacy controls and model-specific availability claims.
- [ ] Resolve remaining lint/type debt in legacy v86, backup and provider code without weakening rules.
- [ ] Verify live Supabase RLS/auth/admin/storage and the complete schema; approve/staging-test signup repair.
- [ ] Configure durable sponsored inference budgets or keep it disabled.
- [ ] Complete authenticated end-to-end, accessibility, backup/restore and deployed-host validation.
- [ ] Approve privacy, terms, acceptable use and operational ownership.
- [ ] Obtain separate approval for production migrations and public deployment.
