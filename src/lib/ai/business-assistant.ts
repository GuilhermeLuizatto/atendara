import type {
  Appointment,
  Client,
  ISODateString,
  Permission,
  Transaction,
} from "@/types";

export type BusinessAssistantTopic =
  "AGENDA" | "FINANCE" | "LEADS" | "UNSUPPORTED";

export interface BusinessAssistantContext {
  professionalId: string | null;
  timezone: string;
  locale: string;
  currency: string;
  permissions: readonly Permission[];
  appointments: readonly Appointment[];
  clients: readonly Client[];
  transactions: readonly Transaction[];
  now: ISODateString;
}

export interface BusinessAssistantAnswer {
  topic: BusinessAssistantTopic;
  text: string;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function classifyBusinessQuestion(
  question: string,
): BusinessAssistantTopic {
  const text = fold(question);
  if (
    /\b(agenda|atendimento|horario|hoje|proxim[oa]|sessao|consulta)\b/.test(
      text,
    )
  )
    return "AGENDA";
  if (
    /\b(financeir|saldo|receita|despesa|pagamento|atrasad|receber|fatur)\w*/.test(
      text,
    )
  )
    return "FINANCE";
  if (/\b(leads?|prospects?|primeiro contato|nov[oa]s? cliente)\b/.test(text))
    return "LEADS";
  return "UNSUPPORTED";
}

function dateKey(value: ISODateString, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function time(value: ISODateString, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function money(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    value / 100,
  );
}

function denied(
  topic: Exclude<BusinessAssistantTopic, "UNSUPPORTED">,
): BusinessAssistantAnswer {
  return {
    topic,
    text: "Seu acesso não permite consultar essa área. A Dara não amplia as permissões da sua conta.",
  };
}

export function answerBusinessQuestion(
  question: string,
  context: BusinessAssistantContext,
): BusinessAssistantAnswer {
  const topic = classifyBusinessQuestion(question);
  const professionalId = context.professionalId;

  if (!professionalId) {
    return {
      topic,
      text: "Selecione um profissional ativo para consultar os dados do negócio.",
    };
  }

  if (topic === "AGENDA") {
    if (!context.permissions.includes("appointment:read")) return denied(topic);
    const today = dateKey(context.now, context.timezone);
    const appointments = context.appointments
      .filter(
        (item) =>
          item.professionalId === professionalId &&
          dateKey(item.startsAt, context.timezone) === today &&
          item.status !== "CANCELLED" &&
          item.status !== "RESCHEDULED",
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    if (!appointments.length)
      return { topic, text: "Você não tem atendimentos na agenda de hoje." };
    const lines = appointments
      .slice(0, 6)
      .map(
        (item) =>
          `${time(item.startsAt, context.locale, context.timezone)} — ${item.clientName}`,
      );
    const remaining = appointments.length - lines.length;
    return {
      topic,
      text: `Hoje há ${appointments.length} atendimento${appointments.length === 1 ? "" : "s"}:\n${lines.join("\n")}${remaining > 0 ? `\nE mais ${remaining} na agenda.` : ""}`,
    };
  }

  if (topic === "FINANCE") {
    if (!context.permissions.includes("transaction:read")) return denied(topic);
    const transactions = context.transactions.filter(
      (item) => item.professionalId === professionalId,
    );
    const sum = (predicate: (item: Transaction) => boolean) =>
      transactions
        .filter(predicate)
        .reduce((total, item) => total + item.amountInCents, 0);
    const received = sum(
      (item) => item.type === "INCOME" && item.status === "PAID",
    );
    const pending = sum(
      (item) =>
        item.type === "INCOME" &&
        (item.status === "PENDING" || item.status === "OVERDUE"),
    );
    const overdue = sum(
      (item) => item.type === "INCOME" && item.status === "OVERDUE",
    );
    const expenses = sum(
      (item) => item.type === "EXPENSE" && item.status === "PAID",
    );
    return {
      topic,
      text: `Nos dados carregados do seu financeiro: recebido ${money(received, context.locale, context.currency)}, a receber ${money(pending, context.locale, context.currency)}, sendo ${money(overdue, context.locale, context.currency)} em atraso, e despesas pagas de ${money(expenses, context.locale, context.currency)}.`,
    };
  }

  if (topic === "LEADS") {
    if (!context.permissions.includes("client:read")) return denied(topic);
    const leads = context.clients
      .filter(
        (item) =>
          item.status === "LEAD" &&
          item.assignedProfessionalIds.includes(professionalId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!leads.length)
      return {
        topic,
        text: "Você não tem leads abertos no cadastro carregado.",
      };
    const names = leads
      .slice(0, 6)
      .map((item) => item.preferredName ?? item.fullName);
    return {
      topic,
      text: `Há ${leads.length} lead${leads.length === 1 ? "" : "s"} aberto${leads.length === 1 ? "" : "s"}: ${names.join(", ")}${leads.length > names.length ? ` e mais ${leads.length - names.length}` : ""}.`,
    };
  }

  return {
    topic: "UNSUPPORTED",
    text: "Posso responder somente sobre sua agenda de hoje, financeiro e leads. Não consulto conteúdo clínico, conversas de clientes nem dados de outro profissional.",
  };
}
