/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Entrar com o Mercado Livre".
 *
 * O visitante digita o código de rastreio, autoriza o Únific+ dentro do
 * Mercado Livre e volta já logado — sem formulário de cadastro no caminho.
 *
 * A identidade vem SEMPRE da conta que autorizou (validada pelo /users/me com
 * o token recém-emitido), nunca de algo digitado pelo visitante. É isso que
 * torna seguro criar o acesso automaticamente: quem chega aqui provou, pelo
 * próprio Mercado Livre, que é dono daquela conta.
 *
 * Só é alcançável pelo callback do OAuth (arquivo *.server.ts, importado
 * dinamicamente): nada disso entra no bundle do navegador.
 */

/** Endereço usado quando a conta do Mercado Livre não expõe e-mail. */
function emailDeFallback(mlUserId: string): string {
  // Domínio reservado para exemplos (RFC 2606): nunca vira e-mail de alguém
  // de verdade, então não há risco de tomar a conta de um terceiro.
  return `ml-${mlUserId}@contas-ml.invalid`;
}

/**
 * Procura o cliente já existente com este e-mail.
 *
 * `clientes_perfil` vem primeiro porque é uma consulta indexada e direta: a
 * tabela auth.users não é exposta pelo PostgREST, e varrer a listagem do Admin
 * API página a página fica caro e falha silenciosamente quando a base cresce
 * além do que foi paginado.
 *
 * A varredura só entra como reserva, para o caso de um acesso criado sem
 * perfil (por exemplo, um cadastro antigo).
 */
async function acharUsuarioPorEmail(email: string): Promise<string | null> {
  const { db, admin } = await import("./db.server");
  const alvo = email.trim().toLowerCase();

  const { data: perfil } = await db("clientes_perfil")
    .select("user_id")
    .ilike("email", alvo)
    .maybeSingle();
  if (perfil?.user_id) return String(perfil.user_id);

  // Reserva: percorre a listagem do Auth até achar ou acabar as páginas.
  // O teto de páginas evita prender a requisição do cliente numa base grande.
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) return null;

    const usuarios = data?.users ?? [];
    const achado = usuarios.find((u: any) => String(u.email ?? "").toLowerCase() === alvo);
    if (achado) return String(achado.id);
    if (usuarios.length < 1000) break; // última página
  }

  return null;
}

/**
 * Devolve o cliente do Únific+ dono desta conta do Mercado Livre, criando-o
 * quando ainda não existe.
 *
 * Ordem de busca, da mais confiável para a menos:
 *  1) conexão já existente com este ml_user_id  → é o mesmo dono de antes;
 *  2) usuário do Auth com o mesmo e-mail        → a pessoa já tinha cadastro;
 *  3) cria um acesso novo.
 */
export async function garantirClientePorContaMl(conta: {
  mlUserId: string;
  email: string | null;
  nickname: string | null;
  firstName: string | null;
}): Promise<{ ok: true; userId: string; email: string } | { ok: false; erro: string }> {
  const { db, admin } = await import("./db.server");

  const email = (conta.email ?? "").trim().toLowerCase() || emailDeFallback(conta.mlUserId);

  // 1) Esta conta do ML já esteve conectada? Então o dono continua o mesmo.
  const { data: conexao } = await db("ml_connections")
    .select("owner_user_id")
    .eq("provider", "mercado_livre")
    .eq("ml_user_id", conta.mlUserId)
    .maybeSingle();

  if (conexao?.owner_user_id) {
    return { ok: true, userId: String(conexao.owner_user_id), email };
  }

  // 2) Já existe um acesso com este e-mail (cadastro feito antes, pelo site).
  const existente = await acharUsuarioPorEmail(email);
  if (existente) return { ok: true, userId: existente, email };

  // 3) Cria o acesso.
  //
  // A senha é aleatória e descartada: ninguém a conhece, nem nós. A entrada
  // acontece pelo link de uso único gerado logo em seguida. Quem quiser uma
  // senha própria usa "esqueci minha senha" no e-mail da conta do ML.
  const senhaDescartavel =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const { data: criado, error } = await admin.auth.admin.createUser({
    email,
    password: senhaDescartavel,
    email_confirm: true, // sem etapa de confirmação: a prova de posse foi o OAuth
    user_metadata: {
      origem: "mercado_livre",
      ml_user_id: conta.mlUserId,
      ml_nickname: conta.nickname,
    },
  });

  if (error || !criado?.user?.id) {
    // Corrida ou acesso que a busca não alcançou: se o e-mail já existe, ele
    // é o dono. Barrar aqui deixaria a pessoa presa para sempre.
    const jaExistia = await acharUsuarioPorEmail(email);
    if (jaExistia) return { ok: true, userId: jaExistia, email };

    return {
      ok: false,
      erro: "Não foi possível criar seu acesso a partir da conta do Mercado Livre.",
    };
  }

  const userId = String(criado.user.id);

  /*
   * NÃO criamos linha em `clientes_perfil` aqui.
   *
   * Aquela tabela exige CPF e telefone (NOT NULL, com formato conferido e CPF
   * único). Quem entra pelo Mercado Livre não informa nenhum dos dois, e
   * inventar número para satisfazer a restrição seria pior do que não ter o
   * registro: sujaria o cadastro com dado falso.
   *
   * Quem lista os clientes é que passa a enxergar as duas origens — o cadastro
   * pelo site e a conta que chegou pelo Mercado Livre. Ver `adminClientes`.
   */

  return { ok: true, userId, email };
}

/**
 * Endereço de uso único que estabelece a sessão no navegador.
 *
 * Devolve uma URL DO PRÓPRIO SITE, carregando um código de uso único. A página
 * de entrada troca esse código por sessão e segue para o rastreio.
 *
 * NÃO usamos o `action_link` que o Supabase monta. Aquele link passa pelo
 * domínio dele, que só aceita retornar para endereços cadastrados na lista de
 * "Redirect URLs" do projeto — e quando o endereço não está lá, ele não avisa:
 * manda o cliente para a Site URL, que vem de fábrica como
 * "http://localhost:3000". Foi isso que aconteceu com quem autorizou pelo
 * Mercado Livre: terminava a autorização e caía num endereço morto.
 *
 * Usando o código direto, a volta acontece no nosso domínio e deixa de
 * depender de configuração no painel do Supabase.
 *
 * Devolve `null` quando não é possível gerar, para o chamador seguir por outro
 * caminho em vez de estourar em cima do cliente.
 */
export async function linkDeEntrada(email: string, origem: string): Promise<string | null> {
  const { admin } = await import("./db.server");

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origem}/?ml=ok` },
    });
    if (error) return null;

    const codigo = data?.properties?.hashed_token;
    if (typeof codigo === "string" && codigo) {
      return `${origem}/entrar?acesso=${encodeURIComponent(codigo)}`;
    }

    // Sem o código não há como concluir aqui; o chamador manda para a entrada.
    return null;
  } catch {
    return null;
  }
}
