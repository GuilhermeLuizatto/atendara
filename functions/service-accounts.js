/**
 * Com que identidade cada grupo de functions roda no Google Cloud (H.3).
 *
 * Antes, todas rodavam com a conta padrao do Compute Engine, que tem papel
 * Editor no projeto: uma function comprometida — por dependencia, por falha de
 * validacao — alcancaria o projeto inteiro. Agora cada grupo roda com uma conta
 * propria, e cada conta tem so os papeis que o codigo daquele grupo usa. Os
 * papeis estao em `docs/seguranca/MENOR-PRIVILEGIO.md`, com o motivo de cada um.
 *
 * O `@` no fim e a forma curta que a CLI do Firebase completa com o projeto
 * (`fn-contas@atendo-a3481.iam.gserviceaccount.com`). Assim o codigo nao
 * carrega o id do projeto, e o emulador segue funcionando sem conta nenhuma.
 *
 * Publicar functions com uma conta que ainda nao existe FALHA — por isso as
 * contas precisam ser criadas antes do primeiro deploy depois desta mudanca.
 * O merge nao publica functions: o deploy automatico so leva site e regras.
 */
export const SERVICE_ACCOUNTS = Object.freeze({
  /** Cadastro de profissionais e troca da senha inicial. Firestore e Authentication. */
  contas: "fn-contas@",
  /** Atos da operadora: concessoes e administradores. Firestore e Authentication. */
  operadora: "fn-operadora@",
  /** Direitos do titular: exportar e eliminar. Firestore e Authentication. */
  privacidade: "fn-privacidade@",
  /** Cobranca da plataforma e webhook do gateway. Firestore e os dois segredos da Stripe. */
  cobranca: "fn-cobranca@",
  /** Fila de avisos: gatilho da agenda e despachante. Firestore e Cloud Tasks. */
  automacao: "fn-automacao@",
});

/** Opcao pronta para espalhar nas opcoes de uma function. */
export function runAs(group) {
  const serviceAccount = SERVICE_ACCOUNTS[group];
  if (!serviceAccount) throw new Error(`Grupo de functions sem conta de servico: ${group}`);
  return { serviceAccount };
}
