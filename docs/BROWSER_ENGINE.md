# Browser engine and Browser QA

Status: **experimental local read-only implementation, tested against real local fixtures**. No cloud browser, production account, third-party authenticated website or paid service was used.

## Run locally

Use Node **22.18+ or 24 LTS**, Bun, and an installed Google Chrome. Node's TypeScript stripping is needed by the companion's shared network-policy import. Install development dependencies with `bun install --frozen-lockfile`.

Start the app, then explicitly start the separate companion for a website you own or are authorized to inspect:

```sh
bun run dev
bun run browser:local --target https://your-owned-site.example --app-origin http://localhost:8080
```

Replace the app origin with the exact origin shown by your dev server. To test your own loopback development site, add `--allow-local-target` explicitly:

```sh
bun run browser:local --target http://127.0.0.1:3000 --app-origin http://localhost:8080 --allow-local-target
```

The runner binds only to `127.0.0.1:8931` and writes pairing details to ignored `artifacts/browser-runner.local.json`. Do not share or commit that file. In Studio → Browser, enter its endpoint and pairing token. The token is cleared from the form after connection and retained only in the adapter's private memory until Stop. Restarting the runner invalidates its old token. HTTPS-to-loopback requests may require your browser's local-network permission; do not expose the runner publicly to work around a browser restriction.

## Implemented controls

- Start/Stop; fresh, sandbox-enabled Chrome per session; no persistent login profile or inherited app/provider environment secrets.
- Address navigation and new tabs restricted to the runner-approved origin; maximum three tabs, with tab listing/selection through the backend interface.
- Real DOM accessibility snapshots; screenshot capture labeled as snapshots rather than live video.
- Desktop/mobile viewport changes; console/runtime errors, HTTP failures, broken-image and overflow observations; heuristic unnamed-button checks.
- Structured findings with severity, expected/observed behavior, reproduction steps and URL/viewport evidence. Findings explicitly do not claim a verified source-code fix.
- Timestamped success/failure receipts, action timeline and JSON report download.
- A `BrowserBackend` interface, a `LocalBrowserBackend` implementation and a scoped `browser_read` model tool. Start a session manually before requesting an agent observation; Ask mode requires approval at runtime. Denials, scope changes and unsupported actions cannot be overridden by webpage instructions.

## Limits and security

The runner requires an exact app Origin, exact loopback Host and a random pairing token. It locks to the first paired account label. Every later operation checks session and workspace labels; unknown/wrong scopes do not return observations. These labels are not proof of a cloud identity: this is a single-user workstation companion. Do not host it as a multi-user service.

Each session expires after ten minutes and allows 50 actions. Only one session is active per runner, tabs are bounded, action/navigation timeouts apply, and proxy transfer budget is 64 MB per runner lifetime. Stop closes the actual browser, including pending navigation. Close is idempotent when an expired or denied session already closed. Receipts remain in memory and can be downloaded; persistent remote recording is not provided.

The egress proxy pins validated public DNS addresses and restricts every connection to the single approved origin, including redirects. Private/LAN targets are blocked; explicit loopback allowance is only for the user's own local target. Service workers and downloads are disabled; the exposed actions do not accept scripts, selectors, form submissions, file uploads, cookie/storage access or publication. Page interception blocks non-GET/HEAD requests as additional protection. An HTTPS tunnel cannot enforce arbitrary application semantics, and even GET endpoints can cause side effects: use authorized read-only targets and fresh profiles.

Cross-origin assets are deliberately blocked. A network failure caused by that policy is not automatically a website bug. QA checks are heuristic observations, not comprehensive accessibility certification or proof that all links/features work. OS-level hard CPU/memory quotas and hardened containers are still required for a production remote browser platform.

## Real tests and evidence

```sh
bun run test:browser
```

Playwright tests launch actual Chrome against a local fixture, capture a screenshot, detect intentional JavaScript/404/broken-image/mobile-overflow failures, exercise tabs and reject redirected requests before another local origin is contacted. Additional checks reject incorrect pairing, origin, owner and workspace. App smoke tests use a local dev server and mocked Supabase endpoints; they do not certify live authentication.

Ignored evidence: `artifacts/browser-evidence/`, including screenshots and a QA report; failures can produce Playwright traces. Only sanitized fixture/auth-screen screenshots are copied into `docs/evidence/` for review.

Cloudflare Browser Run and other remote adapters, live streaming, take-control mode, high-impact interaction approvals, authenticated sessions, arbitrary Playwright execution, automatic crawling and patch/rebuild/rerun workflows remain planned. Existing MCP integration is preserved separately; imported MCP tool descriptions do not establish isolation or trust.
