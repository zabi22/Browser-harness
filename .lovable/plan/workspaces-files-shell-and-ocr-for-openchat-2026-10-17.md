# Workspaces, files, shell and OCR for OpenChat

## What you get
- **Workspaces** (DeepSeek Harness style): a switcher at the top of the left bar. Each workspace has its own chats, its own files, and its own skills/MCP settings. Every existing chat moves into a "Default" workspace.
- **Files panel**: a file tree for the current workspace. Upload, create folders, rename, delete, and open a file in a built-in editor (code highlighting, Save). Files are stored in your private cloud storage, so they survive reloads and devices.
- **Model file tools**: `list_files`, `read_file`, `write_file`, `edit_file` (find-and-replace), `search_files`. Shown in the chat as tool traces like the others.
- **Model shell (`bash`)**: each chat gets its own sandbox shell that runs in your browser (ls, cat, grep, sed, find, echo, pipes, redirects, etc.). It starts with a copy of the workspace files; a "Save to workspace" step (or the model calling `sync_workspace`) writes changes back. No real server machine, so no installs, Python or network from inside the shell.
- **Image ingestion tool** `view_image`: the model gives a web link or a workspace file path and the picture is added to the conversation so it can see it.
- **OCR tool** `ocr_image`: reads the text from an image (link or workspace file) or a scanned PDF page and returns it as text.
- **Export** per workspace: "Text only" (all chats as Markdown) or "Text + files" (a ZIP with chats plus every workspace file).

## Not included (tell me if you want them)
- Remote SSH/SFTP folders and real local-folder linking. Browsers can't open SSH; local folders could be added later via the browser's folder picker (Chrome/Edge only).
- Per-workspace job queues / subagents.

## Technical details
- DB: `workspaces` (owner RLS), `conversations.workspace_id` (backfilled to a Default workspace per user), `workspace_files` index table (path, size, mime, updated_at). File bytes in a private `workspace-files` storage bucket under `{user}/{workspace}/{path}`, owner-only RLS on `storage.objects`.
- Shell: `just-bash` (TypeScript bash interpreter with in-memory FS) running in the browser, one instance per chat, hydrated from workspace files; diffs written back on sync. Recorded in AGENTS.md.
- `view_image` / `ocr_image` from links go through the existing `/api/fetch` (private hosts still blocked); OCR runs via a vision model on a new `/api/media` action (`ocr`), image bytes as input parts.
- Tool registry in `src/lib/tools.ts` extended; file/shell tools always available inside a workspace, image/OCR behind toggles like search.
- Export ZIP built client-side with JSZip (already installed).
