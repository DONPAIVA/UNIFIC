import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LoaderCircle, LogIn, ShieldCheck, UserPlus } from "lucide-react";

import { Layout } from "@/components/site/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useSessao } from "@/lib/useSessao";
import { salvarMeuPerfil } from "@/lib/perfil.functions";
import {
  cpfValido,
  digitos,
  formatarCpf,
  formatarTelefone,
  nomeCompletoValido,
  pinValido,
  telefoneValido,
} from "@/lib/cpf";

export const Route = createFileRoute("/entrar")({
  head: () => ({ meta: [{ title: "Entrar | Únific+" }] }),
  component: Entrar,
});

/**
 * Login/cadastro do CLIENTE.
 *
 * É a peça que faltava para o isolamento: sem uma identidade por cliente,
 * a conexão do Mercado Livre não tem dono e todo mundo enxerga a mesma coisa.
 * A autenticação usa o Supabase Auth que já existia no projeto.
 */
function Entrar() {
  const router = useRouter();
  const { autenticado, email: emailSessao, carregando, sair } = useSessao();

  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Cadastro comercial — só usado no modo "criar".
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cpf, setCpf] = useState("");
  const [pin, setPin] = useState("");

  // Mensagem vinda de um redirect (ex.: tentou conectar sem estar logado).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const msg = p.get("msg");
    if (msg) setAviso(msg);
  }, []);

  /**
   * Confere o cadastro ANTES de criar a conta no Supabase.
   *
   * A ordem importa: se a conta fosse criada primeiro e o cadastro falhasse
   * depois, o cliente ficaria com login válido e sem perfil — e o CPF, que é
   * obrigatório, nunca chegaria. Validando antes, ou entra tudo, ou nada.
   */
  const validarCadastro = (): string | null => {
    if (!nomeCompletoValido(nome)) return "Informe seu nome completo (nome e sobrenome).";
    if (!telefoneValido(telefone)) return "Telefone inválido. Use DDD + número, como (11) 98765-4321.";
    if (!cpfValido(cpf)) return "CPF inválido. Confira os números digitados.";
    const p = pinValido(pin);
    if (!p.ok) return p.erro;
    return null;
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setAviso(null);

    if (modo === "criar") {
      const problema = validarCadastro();
      if (problema) {
        setErro(problema);
        return;
      }
    }

    setOcupado(true);

    const credenciais = { email: email.trim(), password: senha };
    const { error } =
      modo === "entrar"
        ? await supabase.auth.signInWithPassword(credenciais)
        : await supabase.auth.signUp(credenciais);

    if (error) {
      setOcupado(false);
      setErro(traduzir(error.message));
      return;
    }

    if (modo === "criar") {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Confirmação de e-mail ainda ligada no Supabase: sem sessão não dá
        // para gravar o cadastro agora. Desligue em Authentication >
        // Sign In / Providers > Email > Confirm email.
        setOcupado(false);
        setAviso("Conta criada. Confirme o e-mail para entrar e completar seu cadastro.");
        setModo("entrar");
        return;
      }

      try {
        await salvarMeuPerfil({
          data: { nomeCompleto: nome, telefone: digitos(telefone), cpf: digitos(cpf), pin: digitos(pin) },
        });
      } catch (e2) {
        setOcupado(false);
        setErro(e2 instanceof Error ? e2.message : "Não foi possível salvar seu cadastro.");
        return;
      }
    }

    setOcupado(false);

    const proximo = new URLSearchParams(window.location.search).get("next");
    void router.navigate({ to: proximo === "conectar" ? "/" : "/" });
  };

  if (carregando) {
    return (
      <Layout>
        <div className="mx-auto mt-10 flex max-w-md justify-center">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (autenticado) {
    return (
      <Layout>
        <section className="card-panel mx-auto mt-6 max-w-md p-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 font-display text-xl font-bold">Você já está conectado</h1>
          <p className="mt-1 text-sm text-muted-foreground">{emailSessao}</p>
          {/* Sem atalho para painel: o cliente usa o rastreio e as compras. */}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => router.navigate({ to: "/" })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Ir para o rastreio
            </button>
            <button
              onClick={() => router.navigate({ to: "/meus-pedidos" })}
              className="rounded-lg border border-border px-4 py-2 text-sm font-bold"
            >
              Minhas compras
            </button>
            <button onClick={sair} className="rounded-lg border border-border px-4 py-2 text-sm font-bold">
              Sair
            </button>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-md p-6">
        <h1 className="font-display text-xl font-bold">
          {modo === "entrar" ? "Entrar na sua conta" : "Criar sua conta"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua conta identifica você no Únific+. É ela que mantém seus pedidos do Mercado Livre separados dos de
          qualquer outro cliente.
        </p>

        {aviso && <p className="mt-4 rounded-lg bg-primary/10 p-3 text-xs font-medium">{aviso}</p>}

        <form onSubmit={enviar} className="mt-5">
          <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">E-mail</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />

          <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Senha</label>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={modo === "entrar" ? "current-password" : "new-password"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />

          {modo === "criar" && (
            <>
              <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Nome completo</label>
              <input
                type="text"
                required
                autoComplete="name"
                placeholder="Maria Silva Santos"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />

              <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Telefone</label>
              <input
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(11) 98765-4321"
                value={formatarTelefone(telefone)}
                onChange={(e) => setTelefone(digitos(e.target.value))}
                className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />

              <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">CPF</label>
              <input
                type="text"
                required
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={formatarCpf(cpf)}
                onChange={(e) => setCpf(digitos(e.target.value))}
                className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />

              <label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">
                PIN de atendimento
              </label>
              <input
                type="password"
                required
                inputMode="numeric"
                placeholder="4 a 6 números"
                value={pin}
                onChange={(e) => setPin(digitos(e.target.value).slice(0, 6))}
                className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="mb-4 text-[11px] leading-snug text-muted-foreground">
                Um código curto só seu. Serve para consultar seus pedidos rapidamente e para confirmarmos sua
                identidade no atendimento. Não é a sua senha — e ninguém, nem nossa equipe, consegue vê-lo.
              </p>
            </>
          )}

          {erro && <p className="mb-3 text-xs font-semibold text-destructive">{erro}</p>}

          <button
            type="submit"
            disabled={ocupado}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {ocupado ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : modo === "entrar" ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {modo === "entrar" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          onClick={() => {
            setModo(modo === "entrar" ? "criar" : "entrar");
            setErro(null);
          }}
          className="mt-4 w-full text-center text-xs font-semibold text-muted-foreground underline"
        >
          {modo === "entrar" ? "Não tenho conta — criar agora" : "Já tenho conta — entrar"}
        </button>
      </section>
    </Layout>
  );
}

function traduzir(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (m.includes("user already registered")) return "Já existe uma conta com esse e-mail.";
  if (m.includes("password should be")) return "A senha precisa ter pelo menos 6 caracteres.";
  return mensagem;
}
