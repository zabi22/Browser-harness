import { useEffect, useState } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Download,
  Copy,
  ChevronLeft,
  FileText,
  CloudUpload,
  CloudDownload,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listRepos,
  createRepo,
  getRepo,
  cloneUrl,
  repoZip,
  repoTree,
  repoOperation,
  commitChanges,
  type Repository,
} from "@/lib/cloud-git";
import { from64 } from "@/lib/git-fs";
import { supabase } from "@/integrations/supabase/client";
import { downloadBlob } from "./EnvironmentPanel";
import { toast } from "sonner";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Markdown} from './Markdown';
export function GitPanel({ ws }: { ws: string | null }) {
  const [repos, setRepos] = useState<Repository[]>([]),
    [repo, setRepo] = useState<Repository | null>(null),
    [tree, setTree] = useState<Awaited<ReturnType<typeof repoTree>> | null>(null),
    [name, setName] = useState(""),
    [create, setCreate] = useState(false),
    [file, setFile] = useState<{ path: string; text: string } | null>(null),
    [changes,setChanges]=useState<Awaited<ReturnType<typeof commitChanges>>|null>(null),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    if (ws) setRepos(await listRepos(ws));
  };
  useEffect(() => {
    setRepo(null);
    void reload().catch((e) => toast.error(e.message));
  }, [ws]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (repo) {
        const r = await getRepo(repo.id);
        setRepo(r);
        setTree(await repoTree(r));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!ws) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="h-4 w-4 text-primary" />
          Repositories
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="New repository"
          onClick={() => setCreate(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {!repo ? (
        repos.map((r) => (
          <Button
            key={r.id}
            variant="ghost"
            className="h-auto w-full justify-start border-b border-border py-3"
            onClick={() => {
              setRepo(r);
              void repoTree(r).then(setTree);
            }}
          >
            <GitBranch className="h-4 w-4" />
            <span className="truncate">{r.name}</span>
          </Button>
        ))
      ) : (
        <Dialog open={!!repo} onOpenChange={v=>{if(!v)setRepo(null);}}>
        <DialogContent className="h-[85dvh] w-[95vw] max-w-5xl content-start gap-4 overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-primary"/>{repo.name}</DialogTitle></DialogHeader>
          <div className="flex gap-1">
            <Button
              variant="secondary"
              size="icon"
              title="Copy clone URL · expires in 5 minutes"
              aria-label="Copy clone URL"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await navigator.clipboard.writeText(await cloneUrl(repo));
                  toast.success("Clone URL copied · valid for 5 minutes",{description:'Read-only credential. Keep it out of shared clipboard and shell logs.'});
                })
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Download repository"
              title="Download ZIP"
              onClick={() => act(async () => downloadBlob(await repoZip(repo), repo.name + ".zip"))}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Commit workspace"
              title="Commit and push workspace"
              onClick={() => {
                const message = prompt("Commit message");
                if (message) void act(() => repoOperation(ws, repo.name, "commit", { message }));
              }}
            >
              <CloudUpload className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pull repository"
              title="Pull into workspace"
              onClick={() => act(() => repoOperation(ws, repo.name, "pull"))}
            >
              <CloudDownload className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete repository"
              title="Delete repository"
              onClick={() => {
                if (confirm("Delete repository?"))
                  void act(async () => {
                    await supabase.from("git_repositories").delete().eq("id", repo.id);
                    setRepo(null);
                  });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1 border-y border-border py-2 text-xs">
            <Select value={tree?.branch??'main'} onValueChange={branch=>act(()=>repoOperation(ws,repo.name,'checkout',{branch}))}>
              <SelectTrigger aria-label="Repository branch" className="w-44"><GitBranch className="h-3 w-3"/><SelectValue/></SelectTrigger>
              <SelectContent>{(tree?.branches.length?tree.branches:['main']).map(branch=><SelectItem value={branch} key={branch}>{branch}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="icon" variant="ghost" title="New branch" aria-label="New branch" onClick={()=>{const branch=prompt('Branch name');if(branch)void act(()=>repoOperation(ws,repo.name,'branch',{branch}));}}><Plus className="h-4 w-4"/></Button>
            <span className="ml-auto text-muted-foreground">{tree?.files.length ?? 0} files</span>
          </div>
          <div className="grid min-h-0 gap-6 md:grid-cols-[1fr_260px]">
          <section className="min-w-0">
          {tree?.files.map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className="w-full justify-start font-mono text-xs"
              onClick={() =>
                setFile({
                  path: p,
                  text: new TextDecoder().decode(from64(repo.data["/" + p] ?? "")),
                })
              }
            >
              <FileText className="h-3 w-3" />
              <span className="truncate">{p}</span>
            </Button>
          ))}
          {repo.data['/README.md']&&<div className="mt-6 border-t border-border pt-4"><div className="mb-4 text-xs text-muted-foreground">README.md</div><Markdown text={new TextDecoder().decode(from64(repo.data['/README.md']))}/></div>}
          </section><section className="min-w-0 border-t border-border pt-3 md:border-l md:border-t-0 md:pl-4">
          <div className="text-xs font-semibold">Commits</div>
          {tree?.commits.map((c) => (
            <Button variant="ghost" key={c.oid} className="h-auto w-full justify-start gap-2 rounded-none border-b border-border py-3 text-left text-xs" onClick={()=>act(async()=>setChanges(await commitChanges(repo,c.oid)))}>
              <GitCommitHorizontal className="mt-1 h-3 w-3 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="truncate">{c.commit.message}</div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {c.oid.slice(0, 8)} · {c.commit.author.name}
                </span>
              </div>
            </Button>
          ))}
          </section></div>
        </DialogContent></Dialog>
      )}
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New repository</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Repository name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Repository name"
          />
          <DialogFooter>
            <Button
              disabled={busy || !name.trim()}
              onClick={() =>
                act(async () => {
                  await createRepo(ws, name.trim());
                  setCreate(false);
                  setName("");
                })
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!file} onOpenChange={(v) => !v && setFile(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{file?.path}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
            {file?.text}
          </pre>
        </DialogContent>
      </Dialog>
      <Dialog open={!!changes} onOpenChange={v=>{if(!v)setChanges(null);}}><DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Commit changes</DialogTitle></DialogHeader>{changes?.map(c=><section key={c.path} className="min-w-0 border-t border-border pt-3"><div className="mb-3 font-mono text-sm">{c.path}</div><div className="grid gap-2 md:grid-cols-2"><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 font-mono text-xs"><span className="text-muted-foreground">Previous</span>{'\n'+c.before}</pre><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-secondary p-3 font-mono text-xs"><span className="text-primary">Committed</span>{'\n'+c.after}</pre></div></section>)}</DialogContent></Dialog>
    </div>
  );
}
