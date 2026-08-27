/**
 * Constantes do OAuth do Mercado Livre compartilhadas entre navegador e servidor.
 *
 * Fica separado de `ml.functions.ts` de propósito: aquele arquivo declara
 * server functions, e o callback (rota de servidor) só precisa desta string.
 */

/**
 * Marca, no próprio `state`, que a autorização começou SEM cliente logado.
 *
 * O callback precisa distinguir "state sem dono porque a sessão caiu" (erro,
 * continua recusado) de "state sem dono porque é entrada pelo Mercado Livre"
 * (esperado, cria o acesso no fim). Guardar isso no prefixo do state evita uma
 * coluna nova — e portanto evita mais um SQL para rodar em produção.
 */
export const PREFIXO_STATE_PUBLICO = "pub-";
