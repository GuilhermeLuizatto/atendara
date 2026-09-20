// Gerado por scripts/build-functions.mjs.
/**
 * Política da mensagem que chega (Fase 3, 13.5), como DADO.
 *
 * `lib/automation/inbound.ts` executa; este arquivo decide.
 */
/**
 * Janela em que o WhatsApp aceita texto livre, aberta pela própria pessoa ao
 * escrever. Fora dela só sai modelo aprovado — e é por isso que lembrete é
 * modelo, e resposta a dúvida não é.
 *
 * O número é da Meta, não nosso: mudá-lo aqui não muda o que ela aceita.
 */
export const INBOUND_WINDOW_HOURS = 24;
/**
 * O que a pessoa escreve para parar de receber.
 *
 * **Sem acento e em maiúsculas de propósito:** a comparação é feita sobre o
 * texto normalizado (`foldInbound`), e acentuar qualquer termo desta lista faz
 * a comparação falhar em silêncio — a pessoa pediria para sair e continuaria
 * recebendo.
 *
 * A lista é curta por escolha: quanto mais palavras, maior a chance de alguém
 * sair sem querer ("PARAR de mandar remédio às 8h" não é pedido de saída). Uma
 * frase que só contém o termo é pedido; uma frase em volta dele vai para o
 * motor de decisão, como qualquer outra.
 */
export const INBOUND_OPT_OUT_TERMS = ["SAIR", "PARAR", "CANCELAR AVISOS", "NAO QUERO RECEBER"];
/** Quanto do texto recebido entra no resumo da conversa e na decisão. */
export const INBOUND_PREVIEW_LENGTH = 140;
/** Texto registrado quando a própria pessoa confirma pelo botão. */
export const INBOUND_CONFIRMATION_NOTE = "Confirmado pela própria pessoa, pelo WhatsApp.";
/** Texto registrado quando a própria pessoa retira o consentimento. */
export const INBOUND_OPT_OUT_NOTE = "Consentimento retirado pela própria pessoa, pelo WhatsApp.";
