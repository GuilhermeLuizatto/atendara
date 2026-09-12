"use client";

import { useCallback, useMemo } from "react";

import {
  RepositoryError,
  type AppointmentInput,
  type ClientInput,
  type DecisionInput,
  type MessageInput,
  type RuleInput,
  type TransactionInput,
  type WorkspaceCollection,
  type WorkspaceRepository,
} from "@/services";
import type {
  AgendaSettings,
  AppointmentStatus,
  ID,
  OrganizationNotificationSettings,
} from "@/types";

import { useToast } from "./toast-provider";
import { useWorkspace } from "./workspace-provider";

/**
 * Acoes de escrita, com tratamento de erro e feedback unificados.
 *
 * As telas nunca chamam o repositorio direto. Assim, `RepositoryError` (regra de
 * negocio) sempre vira mensagem util para o usuario, e falha tecnica sempre vira
 * mensagem generica — em vez de cada tela decidir isso por conta.
 *
 * As acoes devolvem `null` em caso de falha, entao quem chama consegue decidir
 * se fecha o formulario ou mantem aberto para correcao.
 */
export function useWorkspaceActions() {
  const { repository } = useWorkspace();
  const { show } = useToast();

  const run = useCallback(
    async <T,>(
      work: (repository: WorkspaceRepository) => Promise<T>,
      successMessage?: string,
    ): Promise<T | null> => {
      if (!repository) return null;

      try {
        const result = await work(repository);
        if (successMessage) show(successMessage, "success");
        return result;
      } catch (error) {
        show(
          error instanceof RepositoryError
            ? error.message
            : "Não foi possível concluir a ação. Tente novamente.",
          "danger",
        );
        return null;
      }
    },
    [repository, show],
  );

  return useMemo(
    () => ({
      run,

      createClient: (input: ClientInput) =>
        run((repo) => repo.createClient(input), "Cadastro criado."),
      updateClient: (id: ID, input: Partial<ClientInput>) =>
        run((repo) => repo.updateClient(id, input), "Cadastro atualizado."),
      deleteClient: (id: ID) =>
        run((repo) => repo.deleteClient(id), "Cadastro excluído."),

      createAppointment: (input: AppointmentInput) =>
        run((repo) => repo.createAppointment(input), "Atendimento agendado."),
      updateAppointment: (id: ID, input: Partial<AppointmentInput>) =>
        run(
          (repo) => repo.updateAppointment(id, input),
          "Atendimento atualizado.",
        ),
      setAppointmentStatus: (
        id: ID,
        status: AppointmentStatus,
        reason?: string,
      ) =>
        run(
          (repo) => repo.setAppointmentStatus(id, status, reason),
          STATUS_MESSAGES[status],
        ),

      createTransaction: (input: TransactionInput) =>
        run((repo) => repo.createTransaction(input), "Lançamento criado."),
      updateTransaction: (id: ID, input: Partial<TransactionInput>) =>
        run(
          (repo) => repo.updateTransaction(id, input),
          "Lançamento atualizado.",
        ),
      deleteTransaction: (id: ID) =>
        run((repo) => repo.deleteTransaction(id), "Lançamento excluído."),

      createRule: (input: RuleInput) =>
        run((repo) => repo.createRule(input), "Regra criada."),
      updateRule: (id: ID, input: Partial<RuleInput>) =>
        run((repo) => repo.updateRule(id, input), "Regra atualizada."),
      deleteRule: (id: ID) =>
        run((repo) => repo.deleteRule(id), "Regra excluída."),
      setRuleEnabled: (id: ID, enabled: boolean) =>
        run(
          (repo) => repo.setRuleEnabled(id, enabled),
          enabled ? "Regra ativada." : "Regra desativada.",
        ),

      appendMessage: (input: MessageInput) =>
        run((repo) => repo.appendMessage(input)),
      recordDecision: (input: DecisionInput) =>
        run((repo) => repo.recordDecision(input)),

      updateNotificationSettings: (settings: OrganizationNotificationSettings) =>
        run(
          (repo) => repo.updateNotificationSettings(settings),
          settings.enabled
            ? "Avisos de atendimento atualizados."
            : "Avisos de atendimento desligados.",
        ),
      updateAgendaSettings: (settings: AgendaSettings) =>
        run(
          (repo) => repo.updateAgendaSettings(settings),
          "Horário de atendimento salvo.",
        ),
      loadMore: (collection: WorkspaceCollection) =>
        run((repo) => repo.loadMore(collection)),
      // Provedor simulado: nenhuma mensagem sai do processo. O rotulo diz isso
      // na propria mensagem de sucesso, para nao dar a impressao contraria.
      dispatchDueNotifications: () =>
        run(
          (repo) => repo.dispatchDueNotifications(),
          "Simulação executada. Nenhuma mensagem real foi enviada.",
        ),

      acknowledgeNotification: (id: ID) =>
        run((repo) => repo.acknowledgeNotification(id)),
      markAllNotificationsRead: () =>
        run((repo) => repo.markAllNotificationsRead()),

      reset: () => run((repo) => repo.reset(), "Dados restaurados."),
    }),
    [run],
  );
}

const STATUS_MESSAGES: Record<AppointmentStatus, string> = {
  SCHEDULED: "Atendimento reaberto.",
  CONFIRMED: "Atendimento confirmado.",
  COMPLETED: "Atendimento marcado como realizado.",
  CANCELLED: "Atendimento cancelado.",
  NO_SHOW: "Falta registrada.",
  RESCHEDULED: "Atendimento remarcado.",
};
