<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Public OpenAI-compatible API at `src/routes/api/public/v1/chat/completions.ts` (server route, not an Edge Function) authenticates with SHA-256 hashes in `api_keys`; its admin UI is retired but the columns must stay. Fallback model only on 429/5xx/network, never 4xx denials.
- First-admin assignment has two paths: the auth.users signup trigger and the claim_first_admin() RPC called from getIsAdmin; the RPC covers remixes where the trigger never fired.
- Single-owner lock: BEFORE INSERT trigger on auth.users raises 'Registration Closed' once any user exists; `registration_open()` lets the sign-in page show that state.
- Studio `/api/chat` verifies bearer sessions and translates neutral messages via `chat-protocol.server.ts`; SSE carries text, reasoning, tools, truncation, keepalives. Why: bounded browser follow-ups continue token-limited work resending only partial answer text plus a neutral "[Earlier thinking omitted]" marker; never replay thinking text in any role (also applies to resume).
- Tool loop runs in the browser (`src/lib/tools.ts`, Workspace `generate`): search and MCP (`src/lib/mcp-client.ts`, browser-direct so LAN servers work) run client-side; page fetch and tool image loads go through `/api/fetch` (private hosts blocked), OCR via `/api/media` action `ocr`. Traces persist as `type: "tool"`, reasoning as `type: "reasoning"` attachments.
- Skills use owner-only RLS and progressive disclosure: list enabled names/descriptions, load content on demand, normalize GitHub imports to raw URLs. Why: keep prompts lean.
- Failed/interrupted runs auto-save partial replies to the account and retain owner/chat-scoped journals with stable IDs; resume only with consent. Why: offline writes can fail.
- Branching: messages form a tree via `parent_id`; `conversations.current_leaf_id` stores the visible branch; helpers in `src/lib/tree.ts`.
- Backups: encrypted account in Settings, workspace copies in its menu. Chat JSON imports use `chat-import.ts`: validate, reject cycles, re-key as copies; insert IDs before parents. Why: never overwrite originals.
- Workspaces own chats (`conversations.workspace_id`) and files: bytes in private `workspace-files` at `{user}/{workspace}/{path}`, index rows in `workspace_files`; helpers in `src/lib/workspace-fs.ts`. Why: per-workspace isolation with owner-only RLS.
- Model `bash` runs integrity-pinned v86 and Alpine in a dedicated worker per workspace, with no network relay or app credentials; IndexedDB caches immutable base assets and disk overlays mirror to private storage with revision checks. Why: full browser Linux with persisted changes.
- Workspace opening starts its guest without teardown on panel/chat changes; explicit controls own stopping/restarting, and command scripts use unique root-share paths with serial markers. Why: guest /tmp can be separately mounted and inode replacement can leave cached stale scripts.
- Agent tools enforce live None/Ask/YOLO/custom capability decisions before execution; session settings persist on conversations and reasoning/tool attachments stay ordered. Why: permissions remain explicit and replies survive reloads.
- Cloud Git uses isomorphic-git repositories with revision-checked saves and read-only smart HTTP upload-pack behind five-minute repository-scoped hashed tokens. Why: native Git clone/pull works without exposing owner auth sessions.
- Pin Vite 7.x (8 builds were SIGKILLed). `tooling/browser-buffer.ts` resolves the absolute Buffer package for client builds, optimized `buffer/` in dev, native SSR; avoids Nitro's unloadable redirect.
- `build` and `publish` capabilities are in `ALWAYS_ASK` (agent-policy): never auto-approved by YOLO or presets. Why: deploys and remote builds need an explicit click.

- `src/lib/` has its own `AGENTS.md`; read it before changing files there.
- Studio presentation uses a persistent dashboard navigation/sidebar, conversation canvas, and optional context inspector; keep these controls separate from agent-run state so navigation never cancels work.