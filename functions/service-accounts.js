/**
 * Com que identidade cada grupo de functions roda no Google Cloud (H.3).
 *
 * Antes, todas rodavam com a conta padrao do Compute Engine, que tem papel
 * Editor no projeto: uma function comprometida — por dependencia, por falha de
 * validacao — alcancaria o projeto inteiro. Agora cada grupo roda com uma conta
 * propria, e cada conta tem so os papeis que o codigo daquele grupo usa. Os
 * papeis estao em `docs/seguranca/MENOR-PRIVILEGIO.md`, com o motivo de cada um.
 *
 * O e-mail sai COMPLETO (`fn-contas@atendo-a3481.iam.gserviceaccount.com`),
 * montado com o projeto que a CLI do Firebase informa em `GCLOUD_PROJECT` ao ler
 * este codigo para publicar. A forma curta `fn-contas@` parecia bastar, mas a
 * CLI 15.29 so a completa ao criar a function: ao dar acesso aos segredos
 * (`lib/deploy/functions/ensure.js`) e ao criar o agendamento das rotinas
 * (`lib/gcp/cloudscheduler.js`) ela manda a forma curta ao Google, que recusa.
 * Foi o que derrubou a primeira publicacao, em 18/09/2026. Sem projeto
 * conhecido (testes de unidade), fica a forma curta.
 *
 * Publicar functions com uma conta que ainda nao existe FALHA — por isso as
 * contas precisam ser criadas antes do primeiro deploy depois desta mudanca.
 * O merge nao publica functions: o deploy automatico so leva site e regras.
 */
const ACCOUNT_NAMES = Object.freeze({
  /** Cadastro de profissionais e troca da senha inicial. Firestore e Authentication. */
  contas: "fn-contas",
  /** Atos da operadora: concessoes e administradores. Firestore e Authentication. */
  operadora: "fn-operadora",
  /** Direitos do titular: exportar e eliminar. Firestore e Authentication. */
  privacidade: "fn-privacidade",
  /** Cobranca da plataforma e webhook do gateway. Firestore e os dois segredos da Stripe. */
  cobranca: "fn-cobranca",
  /** Fila de avisos: gatilho da agenda e despachante. Firestore e Cloud Tasks. */
  automacao: "fn-automacao",
});

/** As contas de cada grupo para um projeto; sem projeto, na forma curta. */
export function serviceAccountsFor(projectId) {
  const suffix = projectId ? `${projectId}.iam.gserviceaccount.com` : "";
  return Object.freeze(Object.fromEntries(Object.entries(ACCOUNT_NAMES).map(([group, name]) => [group, `${name}@${suffix}`])));
}

export const SERVICE_ACCOUNTS = serviceAccountsFor(process.env.GCLOUD_PROJECT);

/** Opcao pronta para espalhar nas opcoes de uma function. */
export function runAs(group) {
  const serviceAccount = SERVICE_ACCOUNTS[group];
  if (!serviceAccount) throw new Error(`Grupo de functions sem conta de servico: ${group}`);
  return { serviceAccount };
}
