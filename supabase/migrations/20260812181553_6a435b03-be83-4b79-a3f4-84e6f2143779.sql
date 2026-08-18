CREATE TABLE public.pedidos (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique,
  marketplace text not null default 'unific',
  sender text not null default 'Centro de CDI SP',
  recipient text not null,
  dest_address text,
  dest_city text not null,
  dest_state text not null,
  dest_cep text,
  origin_city text not null default 'São Paulo',
  origin_state text not null default 'SP',
  status text not null default 'Em trânsito',
  ship_date date not null default current_date,
  delivery_date date,
  cpf text,
  product text,
  product_value numeric default 0,
  weight numeric default 1,
  invoice_number text,
  invoice_series text default '001',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos TO anon, authenticated;
GRANT ALL ON public.pedidos TO service_role;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pedidos publicos" ON public.pedidos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.reclamacoes (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null,
  name text not null,
  email text,
  phone text,
  message text not null,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reclamacoes TO anon, authenticated;
GRANT ALL ON public.reclamacoes TO service_role;
ALTER TABLE public.reclamacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reclamacoes publicas" ON public.reclamacoes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.solicitacoes_nf (
  id uuid primary key default gen_random_uuid(),
  order_code text not null,
  doc_type text not null,
  full_name text not null,
  cpf text not null,
  phone text,
  email text,
  status text not null default 'Em análise',
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitacoes_nf TO anon, authenticated;
GRANT ALL ON public.solicitacoes_nf TO service_role;
ALTER TABLE public.solicitacoes_nf ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nf publicas" ON public.solicitacoes_nf FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.cotacoes_frete (
  id uuid primary key default gen_random_uuid(),
  cep_origin text not null,
  cep_dest text not null,
  weight numeric not null default 1,
  height numeric,
  width numeric,
  length numeric,
  declared_value numeric default 0,
  price numeric not null default 0,
  days integer not null default 15,
  cpf text,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cotacoes_frete TO anon, authenticated;
GRANT ALL ON public.cotacoes_frete TO service_role;
ALTER TABLE public.cotacoes_frete ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cotacoes publicas" ON public.cotacoes_frete FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER pedidos_touch BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.pedidos (tracking_code, marketplace, recipient, dest_address, dest_city, dest_state, dest_cep, status, ship_date, delivery_date, cpf, product, product_value, weight, invoice_number)
VALUES ('801055','mercado_livre','Fernando Teixeira Fernandes','Bairro Alvorada, Praça João Pintor 11','Guanambi','BA','46430-000','Em trânsito', current_date - 11, current_date + 4, '123.456.789-00','Motor de Popa 15HP 2 Tempos', 18990.00, 42, '000012345');