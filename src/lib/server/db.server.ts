/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Acesso ao Supabase com service_role para as tabelas da CentralML.
 * As novas tabelas ainda não estão em integrations/supabase/types.ts (arquivo gerado),
 * por isso usamos um handle solto aqui em vez de editar o arquivo gerado.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function db(table: string) {
  return (supabaseAdmin as any).from(table);
}

export const admin = supabaseAdmin as any;
