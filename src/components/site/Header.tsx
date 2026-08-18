import { Link, useRouter } from "@tanstack/react-router";
import { useSessao } from "@/lib/useSessao";

const NAV = [
  { to: "/", label: "Rastreio" },
  { to: "/cotacao", label: "Cotação de Frete" },
  { to: "/nota-fiscal", label: "2ª Via NF/Garantia" },
  { to: "/meus-pedidos", label: "Meus Pedidos" },
  { to: "/notificacoes", label: "Notificações" },
] as const;

export function Header() {
  const { autenticado, email, sair } = useSessao();
  const router = useRouter();

  return (
    <header className="bg-navy/75 pt-6 text-navy-foreground backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-4">
       <div className="flex h-25 w-25 items-center justify-center rounded-lg bg-card shadow-lg overflow-hidden">
  <img
    src="https://i.postimg.cc/JhRd8085/logo-unific.png"
    alt="Únific+"
    className="h-full w-auto object-contain p-1"
  />
</div>
        <h1 className="mt-2 font-display text-xl font-bold tracking-tight">Únific+</h1>
        <p className="text-[11px] font-semibold text-navy-foreground/70">
          Rastreamento profissional — sua carga em boas mãos
        </p>
        <nav className="mt-4 flex w-full flex-wrap items-stretch justify-center gap-1 pb-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "nav-tab-active" }}
              className="nav-tab flex-1 whitespace-nowrap rounded-t-md px-3 py-2 text-center text-xs font-bold"
            >
              {item.label}
            </Link>
          ))}
          {autenticado ? (
            <button
              type="button"
              onClick={async () => {
                await sair();
                void router.navigate({ to: "/" });
              }}
              className="nav-tab rounded-t-md px-4 py-2 text-xs font-bold"
              title={email ?? undefined}
            >
              Sair
            </button>
          ) : (
            <Link
              to="/entrar"
              activeProps={{ className: "nav-tab-active" }}
              className="nav-tab rounded-t-md px-4 py-2 text-xs font-bold"
            >
              Entrar
            </Link>
          )}
        </nav>

        {autenticado && email && (
          <p className="mt-1 pb-1 text-[11px] text-navy-foreground/70">Conectado como {email}</p>
        )}
      </div>
    </header>
  );
}
