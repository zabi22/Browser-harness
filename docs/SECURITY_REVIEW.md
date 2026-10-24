# Security review — 2026-10-24

Status: **incomplete; production NO-GO**. This is an engineering review, not independent certification.

## Changes and evidence

- Environment/key files are ignored. `node tooling/scan-secrets.mjs --history` inspects tracked/untracked safe text and reachable Git history, reporting only locations and rule names. Pattern scanning is not proof that every possible secret format is absent.
- Provider saves require verified Supabase claims, caller RLS and explicit `user_id`; list responses exclude ciphertext and decrypted credentials. Deletes have both provider and caller filters.
- New encrypted values are `v2.<key-id>.<iv>.<ciphertext>` using Web Crypto AES-256-GCM, random 96-bit IVs and authenticated account/provider identity. Encryption tests reject tampering, wrong owners and wrong providers.
- New writes require a high-entropy master secret of at least 32 characters. Generate/store it through the host secret manager, never a `VITE_` variable. Minimum length does not establish sufficient entropy.
- Set `PROVIDER_KEY_ID` to a stable identifier. On rotation, retain old ID-to-secret entries in server-only `PROVIDER_KEY_PREVIOUS_SECRETS` JSON; new writes use the active secret. Existing two-part ciphertext can be read using retained secrets. Previously short secrets may be retained solely for compatibility while rotating to a strong active secret. Do not remove old secrets before all affected rows/backups have been re-encrypted and verified.
- No eager plaintext migration or production row rewrite occurs. Account backup does not export provider keys; preserve encrypted key rows and the matching secret ring through separately controlled server backups.
- Custom provider bases require exact HTTPS approval in `PROVIDER_BASE_URL_ALLOWLIST`. Credentials/query strings/fragments and provider endpoint overrides are rejected. Nonstandard ports/private DNS targets are rejected by the pinned transport even if mistakenly allowlisted.
- Public webpage fetch validates each redirect before contact and every DNS answer, then uses the checked IP for the actual socket while preserving host/TLS validation. It sends no app session/cookies upstream. Response buffering is bounded.
- Official fixed provider destinations use fetch with `redirect: error`; custom destinations use DNS-pinned Node sockets. Local inference is not proxied from the production server.

## Open blockers

- Actual database RLS and storage policies, admin claims and full schema were not provided as migrations; inspect/test the deployed database before release.
- The single-owner fix is prepared but unapplied; the older migration deliberately opened registration.
- Durable sponsored-gateway rate/concurrency/budget controls and shutdown switch are incomplete.
- Request-body limits, stream-completion validation, media cancellation/errors, prompt-injection boundary tests and upstream error sanitization need more work.
- Skill enablement does not certify trust, dependencies or executable integrations. Imports must not override runtime permissions.
- No authenticated browser/XSS/CSRF/IDOR penetration test has been completed. Existing bearer-auth routes reduce ambient-cookie CSRF but are not an exhaustive security assessment.
- DNS-pinned transport requires a compatible Node runtime; deployed Cloudflare support remains unverified and must not be advertised based on compilation alone.

Deleting a saved credential removes the application's stored copy; revoke the actual provider key at the provider when full external revocation is needed.
