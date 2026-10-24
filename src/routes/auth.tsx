import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import "@lovable.dev/cloud-auth-js/styles.css";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — OBH" },
      { name: "description", content: "Sign in to your private Open Browser Harness studio." },
      { property: "og:title", content: "Sign in — OBH" },
      { property: "og:description", content: "Sign in to your private Open Browser Harness studio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    (supabase.rpc as any)("registration_open").then(({ data }: { data: boolean | null }) => {
      setOpen(data === true);
      if (data === true) setMode("up");
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/studio/{-$chatId}", params: { chatId: undefined }, replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/studio/{-$chatId}", params: { chatId: undefined }, replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + "/auth" },
          });
    setBusy(false);
    if (res.error) {
      const closed = mode === "up" && /registration closed|database error/i.test(res.error.message);
      toast.error(closed ? "Registration Closed" : res.error.message);
      if (closed) { setOpen(false); setMode("in"); }
      return;
    }
    if (mode === "up" && !res.data.session) toast.success("Check your email to confirm your account.");
  }

  async function oauth(provider: "google" | "lovable") {
    const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message);
  }

  return (
    <main className="flex min-h-screen flex-col bg-background px-6 py-8">
      <div className="font-display text-3xl">Harness<span className="ml-3 font-sans text-xs text-muted-foreground">Private studio</span></div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center space-y-6 py-12">
        <div>
          <div className="mb-3 text-[10px] text-muted-foreground">OPEN BROWSER HARNESS</div>
          <h1 className="mb-4 text-5xl font-normal text-foreground">
            {mode === "in" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {open ? "No owner yet — the first account created owns this studio." : "Private studio. Only the owner can sign in."}
          </p>
        </div>
        <div className="space-y-2">
          <button type="button" className="lovable-auth-button w-full" onClick={() => oauth("lovable")}>
            Continue with Lovable
          </button>
          <Button variant="outline" className="w-full" onClick={() => oauth("google")}>
            Continue with Google
          </Button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "in" ? "Sign in" : "Sign up"}
          </Button>
        </form>
        {open === false && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Registration Closed
          </div>
        )}
        {open && <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>}
      </div>
    </main>
  );
}
