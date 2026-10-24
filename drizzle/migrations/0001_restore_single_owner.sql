-- Review and apply only with the operator's approval. No users or data are removed.
-- This repairs 0000, which disabled the project's single-owner signup rule.
CREATE OR REPLACE FUNCTION public.enforce_single_owner_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize concurrent first signups; an ordinary EXISTS check alone races.
  PERFORM pg_advisory_xact_lock(743826190);
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Registration Closed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER block_extra_signups
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_owner_signup();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.registration_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT NOT EXISTS (SELECT 1 FROM auth.users) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_single_owner_signup() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.registration_open() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.registration_open() TO anon, authenticated;
