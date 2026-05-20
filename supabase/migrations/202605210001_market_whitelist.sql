CREATE TABLE public.market_whitelist_codes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text NOT NULL UNIQUE,
    is_used boolean DEFAULT false,
    used_by_address text,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.market_whitelist_codes ENABLE ROW LEVEL SECURITY;

-- Allow anon to validate/redeem via API if you expose direct Supabase RPC, 
-- but we are using backend APIs (service role), so we don't strictly need public policies.
-- Let's just keep it locked down to service role.

-- Insert a test code
INSERT INTO public.market_whitelist_codes (code) VALUES ('x7k2');
