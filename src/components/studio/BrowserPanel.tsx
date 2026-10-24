import { useEffect, useRef, useState } from "react";
import {
  Globe,
  Play,
  Square,
  Camera,
  ScanText,
  Download,
  Smartphone,
  Monitor,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { download } from "@/lib/studio-client";
import {
  LocalBrowserBackend,
  activeBrowser,
  registerBrowser,
  stopBrowsers,
  type BrowserOperation,
} from "@/lib/browser-engine";

export function BrowserPanel({ workspaceId }: { workspaceId: string | null }) {
  const currentWorkspace = useRef(workspaceId);
  const currentOwner = useRef<string | null>(null);
  const authVersion = useRef(0);
  currentWorkspace.current = workspaceId;
  const [ownerId, setOwner] = useState<string | null>(null),
    [backend, setBackend] = useState<LocalBrowserBackend | null>(null);
  const [, repaint] = useState(0);
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8931/v1/browser"),
    [credential, setCredential] = useState("");
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [snapshot, setSnapshot] = useState(""),
    [image, setImage] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    let current = true;
    const version = ++authVersion.current;
    setBackend(null);
    setImage("");
    setSnapshot("");
    setError("");
    setCredential("");
    setPending(false);
    void supabase.auth.getUser().then(({ data }) => {
      if (current && version === authVersion.current) {
        currentOwner.current = data.user?.id ?? null;
        setOwner(data.user?.id ?? null);
        setBackend(
          data.user && workspaceId
            ? (activeBrowser({ ownerId: data.user.id, workspaceId }) ?? null)
            : null,
        );
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextOwner = session?.user.id ?? null;
      if (nextOwner !== currentOwner.current) {
        authVersion.current++;
        const previousOwner = currentOwner.current;
        currentOwner.current = nextOwner;
        if (previousOwner) void stopBrowsers(previousOwner);
        setOwner(nextOwner);
        setBackend(
          nextOwner && workspaceId
            ? (activeBrowser({ ownerId: nextOwner, workspaceId }) ?? null)
            : null,
        );
        setCredential("");
        setImage("");
        setSnapshot("");
      }
    });
    return () => {
      current = false;
      data.subscription.unsubscribe();
    };
  }, [workspaceId]);
  useEffect(() => backend?.subscribe(() => repaint((value) => value + 1)), [backend]);
  const run = async (operation: BrowserOperation) => {
    if (!backend) return;
    setError("");
    setPending(true);
    try {
      const output = await backend.run(operation);
      if (currentWorkspace.current !== workspaceId || currentOwner.current !== ownerId) return;
      if (typeof output["url"] === "string") setUrl(output["url"]);
      if (
        typeof output["screenshot"] === "string" &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(output["screenshot"])
      )
        setImage(output["screenshot"]);
      setSnapshot(
        JSON.stringify(
          output,
          (key, value: unknown) => (key === "screenshot" ? "(screenshot captured)" : value),
          2,
        ),
      );
    } catch (failure) {
      if (currentWorkspace.current === workspaceId) setError((failure as Error).message);
    } finally {
      if (currentWorkspace.current === workspaceId) setPending(false);
    }
  };
  const start = async () => {
    if (!ownerId || !workspaceId) return;
    setPending(true);
    setError("");
    try {
      const { data, error: ownershipError } = await supabase
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (ownershipError || !data)
        throw new Error("This workspace is not available to the signed-in account");
      if (currentWorkspace.current !== workspaceId || currentOwner.current !== ownerId) return;
      const next = new LocalBrowserBackend({ ownerId, workspaceId }, endpoint, credential.trim());
      await next.start();
      if (currentWorkspace.current !== workspaceId || currentOwner.current !== ownerId) {
        await next.stop();
        return;
      }
      registerBrowser(next);
      setBackend(next);
      setCredential("");
      setUrl(next.origin);
    } catch (failure) {
      setError(
        failure instanceof TypeError
          ? "Could not reach the local browser companion. Check its pairing endpoint, browser local-network permission, and the configured app origin."
          : (failure as Error).message ||
              "Could not reach the local browser runner. Check pairing, local-network browser permission and the runner process.",
      );
    } finally {
      setPending(false);
    }
  };
  const ready = backend?.state === "ready" && !pending;
  return (
    <section className="space-y-4 px-1 py-2 text-sm" aria-label="Browser QA">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <Globe className="h-4 w-4" /> Browser QA
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Experimental local browser. Fresh sessions, read-only controls, snapshots and real
          execution receipts.
        </p>
      </div>
      {!backend || backend.state === "disconnected" ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            Start the separate local runner with your approved website and this app's origin.
            Pairing details are saved in artifacts/browser-runner.local.json. Cloud browser backends
            are unconfigured.
          </p>
          <Label htmlFor="browser-endpoint">Local runner endpoint</Label>
          <Input
            id="browser-endpoint"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <Label htmlFor="browser-pairing">Pairing token</Label>
          <Input
            id="browser-pairing"
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
          <Button
            disabled={pending || !credential || !ownerId || !workspaceId}
            onClick={() => void start()}
          >
            <Play className="h-4 w-4" /> Start isolated session
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span role="status" className="text-xs">
              {backend.state} · expires {new Date(backend.expiresAt).toLocaleTimeString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void backend.stop().catch((failure) => setError((failure as Error).message))
              }
            >
              <Square className="h-3 w-3" /> Stop
            </Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">
            Approved origin: {backend.origin}
          </p>
          <form
            className="flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void run({ action: "navigate", url });
            }}
          >
            <Input
              aria-label="Browser address"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={!ready}>
              Open
            </Button>
            <Button
              type="button"
              size="icon"
              aria-label="Open new tab"
              disabled={!ready}
              onClick={() => void run({ action: "new-tab", url })}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "snapshot" })}
            >
              <ScanText className="h-3 w-3" /> DOM
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "screenshot" })}
            >
              <Camera className="h-3 w-3" /> Snapshot
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "diagnostics" })}
            >
              Run QA
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "viewport", viewport: "mobile" })}
            >
              <Smartphone className="h-3 w-3" /> Mobile
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "viewport", viewport: "desktop" })}
            >
              <Monitor className="h-3 w-3" /> Desktop
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => void run({ action: "tabs" })}
            >
              List tabs
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Screenshots are captured on request; this is not a live video feed. Stop closes the
            browser and cancels automation.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {image && (
        <img src={image} alt="Captured browser screenshot" className="w-full rounded border" />
      )}
      {snapshot && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted p-2 text-[11px]">
          {snapshot}
        </pre>
      )}
      {!!backend?.receipts.length && (
        <div className="space-y-2">
          <div className="flex justify-between gap-2">
            <h4 className="text-xs font-medium">Action timeline</h4>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                download(
                  `browser-qa-${Date.now()}.json`,
                  JSON.stringify(
                    { workspaceId, origin: backend.origin, receipts: backend.receipts },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <Download className="h-3 w-3" /> Report
            </Button>
          </div>
          {backend.receipts.map((receipt) => (
            <div key={receipt.id} className="rounded border px-2 py-1 text-xs">
              <span>
                {receipt.ok ? "Completed" : "Failed"} · {receipt.action}
              </span>
              <span className="ml-2 text-muted-foreground">
                {new Date(receipt.endedAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
