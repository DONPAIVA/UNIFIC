CREATE TABLE public.acessos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text,
  action text NOT NULL DEFAULT 'visita',
  path text,
  user_agent text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.acessos TO anon;
GRANT SELECT, INSERT ON public.acessos TO authenticated;
GRANT ALL ON public.acessos TO service_role;
ALTER TABLE public.acessos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acessos leitura publica" ON public.acessos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "acessos insercao publica" ON public.acessos FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.ml_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ml_user_id text NOT NULL UNIQUE,
  nickname text,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ml_connections TO service_role;
ALTER TABLE public.ml_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ml_oauth_states (
  state text NOT NULL PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ml_oauth_states TO service_role;
ALTER TABLE public.ml_oauth_states ENABLE ROW LEVEL SECURITY;