/**
 * Identidade publica e versao dos textos legais.
 *
 * Os textos no ar sao PRELIMINARES: escritos a partir do que o produto faz
 * hoje, sem revisao de advogado. Quando a revisao chegar, troca-se o texto e
 * esta versao — que e o que permite saber sobre qual texto alguem concordou.
 */

/** Termos de Uso e Politica de Privacidade: aceitos por quem usa o painel. */
export const LEGAL_VERSION = "2026-11-06-preliminar";

export const LEGAL_UPDATED_AT = "6 de novembro de 2026";

/**
 * Contrato de Licenca e Anexo de Tratamento de Dados: aceitos por quem responde
 * pela organizacao, em nome dela. Versao separada da dos Termos porque quem
 * aceita e o que se aceita sao outros (ADR 0006): trocar uma nao pode obrigar
 * a aceitar de novo a outra.
 */
export const CONTRACT_VERSION = "2026-11-06-preliminar";

export const CONTRACT_UPDATED_AT = "6 de novembro de 2026";

/** Quem responde pelo servico. Vira razao social e CNPJ quando houver empresa. */
export const OPERATOR_LEGAL_NAME = "Guilherme Luizatto";

/**
 * Contato unico: suporte e pedidos sobre dados. Sai do dominio proprio desde
 * 21/09/2026 — endereco pessoal nao serve de canal de titular de dados.
 */
export const CONTACT_EMAIL = "suporte@atendara.app";

/**
 * Onde o dado fica. `BRAZIL` so quando a regiao foi conferida na configuracao;
 * na duvida, o texto publico nao pode prometer Brasil.
 */
export type SubprocessorLocation = "BRAZIL" | "ABROAD" | "GLOBAL";

export interface Subprocessor {
  id: string;
  name: string;
  /** Para que o servico recebe dados. */
  purpose: string;
  /** Quais dados chegam a ele. */
  data: string;
  location: SubprocessorLocation;
  /** Detalhe do local, quando ajuda a entender o rotulo. */
  locationNote: string;
}

/**
 * Suboperadores EM USO hoje. O anexo de tratamento e a Politica leem daqui:
 * uma lista so, para que os dois textos nunca divirjam.
 *
 * Servico previsto (WhatsApp, n8n de producao, emissor fiscal) so entra quando
 * for ligado — listar o que nao existe prometeria um tratamento que nao ocorre.
 * Stripe fica de fora de proposito: trata a cobranca do assinante, em que o
 * Atendara e controlador, nao operador.
 */
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    id: "google-cloud",
    name: "Google Cloud e Firebase",
    purpose: "Guardar e processar os dados da organização: banco, funções, filas e arquivos.",
    data: "Todos os dados que a organização registra no painel.",
    location: "BRAZIL",
    // functions/*.js fixam southamerica-east1; o banco segue a mesma regiao.
    locationNote: "Banco, funções e filas em São Paulo.",
  },
  {
    id: "google-identity",
    name: "Google Identity Platform",
    purpose: "Login da equipe da organização.",
    data: "Nome, e-mail e dados de acesso de quem usa o painel.",
    location: "GLOBAL",
    locationNote: "Serviço global do Google.",
  },
  {
    id: "google-hosting",
    name: "Firebase Hosting",
    purpose: "Entregar o site e o painel ao navegador.",
    data: "Endereço IP e dados técnicos da requisição.",
    location: "GLOBAL",
    locationNote: "Rede global de entrega do Google.",
  },
  {
    id: "google-recaptcha",
    name: "Google reCAPTCHA Enterprise",
    purpose: "Confirmar que o acesso vem do aplicativo oficial.",
    data: "Sinais técnicos do navegador.",
    location: "GLOBAL",
    locationNote: "Serviço global do Google.",
  },
  {
    id: "google-gemini",
    name: "Google Gemini API",
    purpose:
      "Classificar mensagens recebidas que a regra local não resolve, só nas organizações em que a função foi liberada.",
    // functions/gemini.js troca link, e-mail, CPF e telefone antes de enviar.
    data: "Texto da mensagem, sem links, e-mails, CPF e telefones, que são trocados por marcadores antes do envio.",
    location: "ABROAD",
    locationNote: "Processado fora do Brasil, em plano pago, que não usa o conteúdo para treinar modelos.",
  },
  {
    id: "amazon-ses",
    name: "Amazon SES",
    purpose: "Enviar e-mails do sistema à equipe da organização, como chamados de suporte e pedidos de equipe.",
    data: "Nome e e-mail de quem usa o painel e o conteúdo do aviso.",
    location: "ABROAD",
    // SES_REGION=us-east-2 em functions/.env.
    locationNote: "Estados Unidos (Ohio).",
  },
];

export const SUBPROCESSOR_LOCATION_LABEL: Record<SubprocessorLocation, string> = {
  BRAZIL: "Brasil",
  ABROAD: "Fora do Brasil",
  GLOBAL: "Global",
};
