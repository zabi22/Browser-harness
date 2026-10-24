DROP TRIGGER IF EXISTS block_extra_signups ON auth.users;
CREATE OR REPLACE FUNCTION public.registration_open() RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT true $$;

CREATE TABLE public.provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  provider text NOT NULL,
  ciphertext text NOT NULL,
  hint text NOT NULL DEFAULT '',
  base_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_keys TO authenticated;
GRANT ALL ON public.provider_keys TO service_role;
ALTER TABLE public.provider_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own keys select" ON public.provider_keys FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own keys insert" ON public.provider_keys FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own keys update" ON public.provider_keys FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own keys delete" ON public.provider_keys FOR DELETE TO authenticated USING (auth.uid() = user_id);