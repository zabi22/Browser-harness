# Project builder: websites, Go and Windows desktop apps

## What exists today (audited)
- Workspace files with read/write/edit/search tools, Git (cloud repos), ZIP export, Block/Ask/Allow permissions.
- In-browser Linux (Pentium-class, single core) and isolated WASI processes. Too slow and limited for real Go/Wails builds; it cannot run or test Windows programs.
- No website preview panel, no project templates, no build tracking, no GitHub or Vercel link.

## What we add (smallest set)

### 1. Project templates (saved as real files)
"New project" picker in the workspace menu: Website, Web app, Browser game, Go CLI, Windows desktop (Wails), Go GUI (Fyne). Each writes real starter files into a folder in the workspace (Vite + React + TypeScript + Tailwind + Lucide for web; go.mod, main.go, tests and a build workflow for Go). The AI gets a `create_project` tool that uses the same templates.

### 2. Website preview
A Preview tab that bundles a web project's files in the browser and shows it in a sandboxed frame (no app login or keys reachable). Errors from the build show in the panel. Works for website, web app and game templates, and the frontend half of Wails.

### 3. Builds on GitHub Actions
- Connect a GitHub account (one-time). A new `run_build` tool pushes the project to a GitHub repo you pick and starts a workflow included in the template: gofmt, go vet, go test, go build, and for Wails/Fyne a build on a real Windows runner that also launches the .exe briefly as a smoke test.
- Build panel shows logs, test results and downloadable artifacts.
- Each project shows a clear status ladder: Source generated, Web preview available, Compiled, Tested on Windows, Artifact downloadable. A step only lights up when GitHub reports it succeeded.
- Builds always ask first (never auto-approved, including under YOLO). Public repos are free; private repos use your GitHub minutes, shown before starting.

### 4. OpenChat Publish (replaces Vercel; hosted on Cloudflare)
A Publish button in the workspace opens a compact dashboard: live URL and status, preview vs production, build and deploy logs, release history with times and source revision, Publish update, Roll back, Unpublish (with confirmation), and domain settings.

```text
OpenChat (ownership, approvals, history)
   |  1. prepare: validate project, record source revision
   v
GitHub Actions build runner (no Cloudflare secrets)
   |  2. npm ci + build + tests -> artifact with hash
   v
OpenChat trusted deploy step (server-only Cloudflare token)
   |  3. show what/where/revision -> you approve
   |  4. upload artifact as a Worker with static assets
   v
Cloudflare  -> 5. read real deployment/version ID
            -> 6. fetch the workers.dev URL to verify it responds
```

- First version uses Cloudflare's own `<project>.<account>.workers.dev` URLs; no invented subdomains. A URL is only shown after Cloudflare returns it and the check passes.
- Source saved, build passed, deployed and verified are separate states; a save is never shown as a deploy.
- Rollback picks an earlier verified release, needs approval, and only reverts the website (not data or other services).
- AI tools: `publish_prepare`, `publish_deploy`, `publish_status`, `publish_history`, `publish_rollback`, `publish_logs`, `publish_domains`. The AI can build, preview, test and prepare a proposal; deploy, rollback, unpublish and domain changes always need your click, even in YOLO.
- Custom domains (Phase 5, separate approval): DNS guidance, ownership and HTTPS status; never changes DNS of existing sites automatically. Multi-user hosting (Cloudflare for Platforms) is research only, nothing paid.

### 5. Review before saving
AI file changes to a project can be shown as a diff with Accept/Reject when the session is in Ask mode (reuses the existing permission prompt).

## Order and approvals
1. Audit (done above; no Cloudflare or GitHub link exists yet).
2. Templates, preview, ZIP, review-before-save.
3. Publish dashboard and release records (needs your OK for the database change).
4. GitHub build runner + Cloudflare deploy (needs you to connect GitHub and a Cloudflare account with a narrowly scoped Workers token).
5. Real end-to-end test, then Go/Wails builds, then custom domains on separate approval.

## Testing
- Sample A: small React site with nav and a contact form that sends nothing. Show saved files, preview, build, ZIP, publish proposal and prompt, live deploy after your approval, verified URL, a second version, history, and a rollback. Also test cancel, failed build cleanup, and that another account cannot see or publish it.
- Sample B: Wails calculator with unit tests; run the GitHub build and confirm the .exe artifact and Windows test step for real before reporting it works.
- Run all existing tests.
- Final report lists each capability as working, partial, blocked or not done.

## Technical details
- Templates in `src/lib/project-templates.ts`, tested for file lists.
- Preview: esbuild-wasm bundle into a blob served to `<iframe sandbox="allow-scripts">`; Tailwind via its browser build.
- One server module `src/lib/publish.server.ts` + `publish.functions.ts` (`requireSupabaseAuth`, owner checks). Cloudflare calls via the Cloudflare connector gateway (Workers Scripts edit only): assets upload session, script upload with `assets` binding, `deployments`/`versions` API for rollback. Token never reaches browser, preview, generated code or the GitHub workflow.
- GitHub workflow uploads the built `dist/` as an Actions artifact; the deploy step downloads it server-side, checks its hash against the approved proposal, then deploys.
- New capability categories `build` and `publish` in agent-policy, fixed to "ask" in every mode including YOLO, with tests.
- New owner-only tables `projects`, `project_builds`, `project_releases` (revision, artifact hash, Cloudflare version ID, environment, time, result, verification status/code) with RLS and grants.
