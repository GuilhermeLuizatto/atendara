import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/permissions";
import { buildMockDataset } from "@/mocks";
import type { Appointment, Client, Transaction } from "@/types";

import type { WorkspaceSnapshot } from "../types";
import type { PlanContext, WriteOperation } from "./plan";
import {
  planCreateAppointment,
  planSetAppointmentStatus,
  planUpdateAppointment,
} from "./plans/agenda";
import {
  planCreateClient,
  planDeleteClient,
  planUpdateClient,
} from "./plans/clients";
import { planCreateTransaction } from "./plans/finance";
import { planReceiveMessage, planReplyToConversation } from "./plans/messaging";
import {
  planCreateRule,
  planDeleteRule,
  planSetRuleEnabled,
  planUpdateRule,
} from "./plans/rules";

/**
 * Os planos sao funcoes puras do snapshot para uma lista de escritas, entao a
 * regra de negocio inteira e verificavel sem emulador e sem rede. O que ESTAS
 * escritas podem fazer no banco e assunto de `firestore.rules`, coberto por
 * `scripts/test-firestore-rules.mjs`.
 */

const ANCHOR = new Date("2026-09-09T15:00:00.000Z");
const NOW = ANCHOR.toISOString();

function makeContext(
  patch: (snapshot: WorkspaceSnapshot) => WorkspaceSnapshot = (s) => s,
  actor: Partial<PlanContext["actor"]> = {},
): PlanContext {
  const snapshot = patch(buildMockDataset("PSYCHOLOGIST", ANCHOR));
  let sequence = 0;

  return {
    organizationId: snapshot.organization.id,
    snapshot,
    actor: {
      userId: "owner",
      name: "Titular",
      role: "OWNER",
      permissions: permissionsForRole("OWNER"),
      ...actor,
    },
    now: NOW,
    newId: (collection) => `${collection}-novo-${++sequence}`,
    newMessageId: () => `message-novo-${++sequence}`,
  };
}

function paths(writes: WriteOperation[]): string[] {
  return writes.map((write) => write.path);
}

function collections(writes: WriteOperation[]): string[] {
  return writes.map((write) => (write.op === "delete" ? "delete" : write.collection));
}

function upcomingAppointment(ctx: PlanContext): Appointment {
  return ctx.snapshot.appointments.find(
    (appointment) =>
      appointment.startsAt > NOW &&
      appointment.status !== "CANCELLED" &&
      ctx.snapshot.transactions.some(
        (transaction) =>
          transaction.appointmentId === appointment.id &&
          transaction.status === "PENDING",
      ),
  )!;
}

const clientInput = {
  fullName: "Cliente de Teste",
  preferredName: null,
  email: null,
  phone: null,
  status: "ACTIVE" as Client["status"],
  preferredModality: "ONLINE" as Client["preferredModality"],
  assignedProfessionalId: null,
  acquisitionChannel: "OTHER" as Client["acquisitionChannel"],
  tags: [],
  administrativeNotes: null,
};

describe("isolamento do tenant nos planos de escrita", () => {
  it("nenhuma escrita sai do caminho da propria organizacao", () => {
    const ctx = makeContext();
    const prefix = `organizations/${ctx.organizationId}/`;
    const conversation = ctx.snapshot.conversations.find(
      (item) => !item.escalated,
    )!;
    const appointment = upcomingAppointment(ctx);

    const writes = [
      ...planCreateClient(ctx, clientInput).writes,
      ...planUpdateClient(ctx, ctx.snapshot.clients[0].id, {
        fullName: "Outro Nome",
      }).writes,
      ...planCreateAppointment(ctx, {
        clientId: ctx.snapshot.clients[0].id,
        professionalId: ctx.snapshot.professionals[0].id,
        startsAt: "2027-01-04T13:00:00.000Z",
        durationMinutes: 50,
        modality: "ONLINE",
        status: "SCHEDULED",
        priceInCents: 18000,
        administrativeNotes: null,
      }).writes,
      ...planSetAppointmentStatus(ctx, appointment.id, "CANCELLED").writes,
      ...planCreateTransaction(ctx, {
        type: "EXPENSE",
        clientId: null,
        professionalId: null,
        appointmentId: null,
        description: "Aluguel",
        amountInCents: 120000,
        status: "PENDING",
        method: null,
        dueDate: "2026-10-05T12:00:00.000Z",
      }).writes,
      ...planReceiveMessage(ctx, conversation.id, "Qual o valor da consulta?")
        .writes,
      ...planReplyToConversation(ctx, conversation.id, "Bom dia!").writes,
    ];

    expect(writes.length).toBeGreaterThan(15);
    for (const path of paths(writes)) {
      expect(path.startsWith(prefix)).toBe(true);
      // Caminho de documento tem numero PAR de segmentos; um numero impar
      // significa que a escrita foi endereçada a uma colecao inteira.
      expect(path.split("/").length % 2).toBe(0);
    }
  });

  it("recusa a acao quando o papel nao tem a permissao", () => {
    const ctx = makeContext(undefined, {
      role: "VIEWER",
      permissions: permissionsForRole("VIEWER"),
    });

    expect(() => planCreateClient(ctx, clientInput)).toThrow(
      "Sem permissao para esta acao.",
    );
    expect(() =>
      planDeleteClient(ctx, ctx.snapshot.clients[0].id),
    ).toThrow("Sem permissao para esta acao.");
  });
});

describe("cadastro de clientes", () => {
  it("cria cadastro com alerta e auditoria no mesmo plano", () => {
    const ctx = makeContext();
    const plan = planCreateClient(ctx, clientInput);

    expect(collections(plan.writes)).toEqual([
      "clients",
      "notifications",
      "auditLogs",
    ]);
    const [client] = plan.writes;
    expect(client.op).toBe("set");
    expect(client.op !== "delete" && client.data).toMatchObject({
      organizationId: ctx.organizationId,
      fullName: "Cliente de Teste",
      totalAppointments: 0,
      outstandingBalanceInCents: 0,
    });
  });

  it("renomear propaga para agenda e conversas do mesmo cliente", () => {
    const ctx = makeContext();
    const client = ctx.snapshot.clients.find((item) =>
      ctx.snapshot.appointments.some(
        (appointment) => appointment.clientId === item.id,
      ),
    )!;

    const plan = planUpdateClient(ctx, client.id, { fullName: "Nome Novo" });
    const touched = plan.writes.filter(
      (write) => write.op === "update" && write.collection === "appointments",
    );

    expect(touched.length).toBeGreaterThan(0);
    const expected = ctx.snapshot.appointments.filter(
      (appointment) => appointment.clientId === client.id,
    ).length;
    expect(touched).toHaveLength(expected);
  });

  it("nao apaga cadastro com atendimento futuro nem pendencia financeira", () => {
    const ctx = makeContext();
    const appointment = upcomingAppointment(ctx);

    expect(() => planDeleteClient(ctx, appointment.clientId)).toThrow(
      /atendimento\(s\) futuros/,
    );
  });
});

describe("agenda e financeiro", () => {
  it("atendimento cobrado gera a receita correspondente em centavos inteiros", () => {
    const ctx = makeContext();
    const plan = planCreateAppointment(ctx, {
      clientId: ctx.snapshot.clients[0].id,
      professionalId: ctx.snapshot.professionals[0].id,
      startsAt: "2027-01-04T13:00:00.000Z",
      durationMinutes: 50,
      modality: "ONLINE",
      status: "SCHEDULED",
      priceInCents: 18000,
      administrativeNotes: null,
    });

    expect(collections(plan.writes)).toEqual([
      "appointments",
      "transactions",
      "auditLogs",
    ]);
    const transaction = plan.writes[1];
    const data = (transaction.op !== "delete" ? transaction.data : {}) as
      Partial<Transaction>;
    expect(data.amountInCents).toBe(18000);
    expect(Number.isInteger(data.amountInCents)).toBe(true);
    expect(data.appointmentId).toBe(plan.result);
  });

  it("recusa sobreposicao do mesmo profissional", () => {
    const ctx = makeContext();
    const existing = upcomingAppointment(ctx);

    expect(() =>
      planCreateAppointment(ctx, {
        clientId: ctx.snapshot.clients[0].id,
        professionalId: existing.professionalId,
        startsAt: existing.startsAt,
        durationMinutes: existing.durationMinutes,
        modality: "ONLINE",
        status: "SCHEDULED",
        priceInCents: 18000,
        administrativeNotes: null,
      }),
    ).toThrow(/Conflito de horario/);
  });

  it("remarcar acerta valor e vencimento da receita ligada", () => {
    const ctx = makeContext();
    const appointment = upcomingAppointment(ctx);
    const startsAt = "2027-02-01T13:00:00.000Z";

    const plan = planUpdateAppointment(ctx, appointment.id, {
      startsAt,
      priceInCents: 22000,
    });
    const revenue = plan.writes.find(
      (write) => write.op === "update" && write.collection === "transactions",
    )!;

    expect(revenue.op !== "delete" && revenue.data).toMatchObject({
      dueDate: startsAt,
      amountInCents: 22000,
    });
  });

  it("cancelar baixa a receita pendente e avisa o profissional", () => {
    const ctx = makeContext();
    const appointment = upcomingAppointment(ctx);
    const plan = planSetAppointmentStatus(
      ctx,
      appointment.id,
      "CANCELLED",
      "Paciente avisou.",
    );

    expect(collections(plan.writes)).toEqual([
      "appointments",
      "transactions",
      "notifications",
      "auditLogs",
    ]);
    const cancelled = plan.writes[1];
    expect(cancelled.op !== "delete" && cancelled.data).toMatchObject({
      status: "CANCELLED",
    });
  });

  it("receita paga nao e alterada por cancelamento", () => {
    const ctx = makeContext((snapshot) => ({
      ...snapshot,
      transactions: snapshot.transactions.map((transaction) => ({
        ...transaction,
        status: "PAID" as const,
      })),
    }));
    const appointment = ctx.snapshot.appointments.find(
      (item) => item.startsAt > NOW && item.status !== "CANCELLED",
    )!;

    const plan = planSetAppointmentStatus(ctx, appointment.id, "CANCELLED");
    expect(collections(plan.writes)).toEqual([
      "appointments",
      "notifications",
      "auditLogs",
    ]);
  });
});

describe("regras do agente", () => {
  it("regra fundamental nao pode ser editada, desativada nem excluida", () => {
    const ctx = makeContext();
    const immutable = ctx.snapshot.rules.find((rule) => rule.immutable)!;

    expect(() => planUpdateRule(ctx, immutable.id, { name: "X" })).toThrow(
      /fundamentais/,
    );
    expect(() => planSetRuleEnabled(ctx, immutable.id, false)).toThrow(
      /fundamentais/,
    );
    expect(() => planDeleteRule(ctx, immutable.id)).toThrow(/fundamentais/);
  });

  it("nao cria regra em nivel reservado a plataforma", () => {
    const ctx = makeContext();
    const editable = ctx.snapshot.rules.find((rule) => !rule.immutable)!;

    expect(() =>
      planCreateRule(ctx, { ...editable, level: "SECURITY" }),
    ).toThrow(/profissional, contextuais e de preferencia/);
  });

  it("cada alteracao incrementa a versao citada na auditoria", () => {
    const ctx = makeContext();
    const editable = ctx.snapshot.rules.find((rule) => !rule.immutable)!;

    const plan = planUpdateRule(ctx, editable.id, { name: "Revisada" });
    const write = plan.writes[0];
    expect(write.op !== "delete" && write.data).toMatchObject({
      version: editable.version + 1,
    });
  });
});

describe("conversas e decisoes do agente", () => {
  it("mensagem administrativa publica mensagem, resposta e decisao juntas", () => {
    const ctx = makeContext();
    const conversation = ctx.snapshot.conversations.find(
      (item) => !item.escalated && item.professionalId === "prof-owner",
    )!;

    const plan = planReceiveMessage(
      ctx,
      conversation.id,
      "Qual o valor da consulta?",
    );

    expect(collections(plan.writes)).toEqual([
      "messages",
      "messages",
      "aiDecisions",
      "conversations",
      "auditLogs",
    ]);
    const decision = plan.writes[2];
    expect(decision.op !== "delete" && decision.data).toMatchObject({
      action: "AUTO_RESPONSE",
      classification: "ADMINISTRATIVE",
    });
  });

  it("risco nao gera resposta automatica e cria alerta critico", () => {
    const ctx = makeContext();
    const conversation = ctx.snapshot.conversations.find(
      (item) => !item.escalated && item.professionalId === "prof-owner",
    )!;

    const plan = planReceiveMessage(
      ctx,
      conversation.id,
      "Nao aguento mais, quero me machucar.",
    );

    expect(collections(plan.writes)).toEqual([
      "messages",
      "aiDecisions",
      "notifications",
      "conversations",
      "auditLogs",
    ]);
    const alert = plan.writes[2];
    expect(alert.op !== "delete" && alert.data).toMatchObject({
      type: "POSSIBLE_RISK_DETECTED",
      priority: "CRITICAL",
    });
  });

  it("mensagem fora do tamanho aceito nao produz escrita", () => {
    const ctx = makeContext();
    const conversation = ctx.snapshot.conversations[0];

    expect(() => planReplyToConversation(ctx, conversation.id, "   ")).toThrow(
      /1 a 4000/,
    );
  });
});
