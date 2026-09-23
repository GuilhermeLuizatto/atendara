"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import {
  AUTOMATION_STATUS_LABELS,
  AUTOMATION_TASK_META,
} from "@/config/automation";
import { CHANNEL_META, DELIVERY_FAILURE_LABELS } from "@/config/notifications";
import { stopReasonLabel } from "@/lib/automation/effects";
import {
  filterQueue,
  taskNeedsAttention,
  type QueueFilter,
} from "@/lib/automation/queue-view";
import { isTaskExpired, isTerminalStatus } from "@/lib/automation/tasks";
import { formatDateTime } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import {
  AUTOMATION_TASK_STATUSES,
  AUTOMATION_TASK_TYPES,
  type AutomationTask,
} from "@/types";
import type { CollectionPage } from "@/services/types";

export function AutomationQueue() {
  const { data, session, repository, loadState, retry } = useWorkspace();
  const actions = useWorkspaceActions();
  if (!session?.permissions.includes("automationQueue:read")) return null;
  if (!data || loadState.status === "loading")
    return <p role="status">Carregando a fila de automações…</p>;
  if (
    loadState.status !== "ready" ||
    loadState.failed.includes("automationTasks")
  ) {
    return (
      <Card className="space-y-3 p-4">
        <p role="alert">
          Não foi possível consultar a fila. Nenhuma conclusão sobre os envios
          pode ser feita agora.
        </p>
        <Button onClick={retry}>Tentar novamente</Button>
      </Card>
    );
  }
  return (
    <AutomationQueuePanel
      tasks={data.automationTasks}
      page={data.pagination?.automationTasks}
      demo={repository?.mode === "memory"}
      onLoadMore={() => void actions.loadMore("automationTasks")}
    />
  );
}

export function AutomationQueuePanel({
  tasks,
  page,
  demo,
  onLoadMore,
}: {
  tasks: AutomationTask[];
  page?: CollectionPage;
  demo: boolean;
  onLoadMore: () => void;
}) {
  const now = useNow().toISOString();
  const [filter, setFilter] = useState<QueueFilter>({
    status: "ALL",
    type: "NOTICES",
    channel: "ALL",
  });
  const notices = tasks.filter(
    (task) => AUTOMATION_TASK_META[task.type].executor === "EXTERNAL",
  );
  const attention = notices.filter((task) =>
    taskNeedsAttention(task, now),
  ).length;
  const pending = notices.filter(
    (task) => !isTerminalStatus(task.status),
  ).length;
  const visible = filterQueue(tasks, filter, now);
  return (
    <section className="space-y-4" aria-label="Fila de automações">
      <div>
        <h2 className="font-semibold">Fila de automações</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Acompanhe os avisos de atendimento e o motivo de cada resultado.
          Concluída significa execução aceita; não comprova leitura pelo
          destinatário.
        </p>
      </div>
      {demo && (
        <p className="bg-info-soft text-info-soft-foreground rounded-lg p-3 text-sm">
          Demonstração: esta fila não está conectada a envios reais.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">Avisos pendentes</p>
          <p className="mt-1 text-2xl font-semibold">{pending}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">Precisam de atenção</p>
          <p className="mt-1 text-2xl font-semibold">{attention}</p>
        </Card>
      </div>
      <p className="text-muted-foreground text-xs">
        Indicadores e filtros consideram apenas as {tasks.length} tarefas
        carregadas.{" "}
        {page?.hasMore
          ? "Há tarefas anteriores; carregue mais para ampliar a consulta."
          : "Todo o histórico disponível foi carregado."}
      </p>
      {attention > 0 && (
        <p
          role="status"
          className="bg-warning-soft text-warning-soft-foreground rounded-lg p-3 text-sm"
        >
          Há avisos com falha, vencidos ou sem retorno no prazo. Consulte os
          detalhes antes de tomar qualquer ação.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Situação
          <Select
            value={filter.status}
            onChange={(event) =>
              setFilter({
                ...filter,
                status: event.target.value as QueueFilter["status"],
              })
            }
          >
            <option value="ALL">Todas</option>
            <option value="ATTENTION">Precisam de atenção</option>
            {AUTOMATION_TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {AUTOMATION_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Tipo
          <Select
            value={filter.type}
            onChange={(event) =>
              setFilter({
                ...filter,
                type: event.target.value as QueueFilter["type"],
              })
            }
          >
            <option value="NOTICES">Avisos de atendimento</option>
            <option value="ALL">Todas as tarefas</option>
            {AUTOMATION_TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {AUTOMATION_TASK_META[type].label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Canal
          <Select
            value={filter.channel}
            onChange={(event) =>
              setFilter({
                ...filter,
                channel: event.target.value as QueueFilter["channel"],
              })
            }
          >
            <option value="ALL">Todos</option>
            {Object.entries(CHANNEL_META).map(([channel, meta]) => (
              <option key={channel} value={channel}>
                {meta.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {visible.length === 0 ? (
        <Card className="p-5 text-sm">
          <p>
            {tasks.length === 0
              ? "Nenhuma tarefa registrada."
              : "Nenhuma tarefa carregada corresponde aos filtros."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((task) => (
            <TaskDetails key={task.id} task={task} now={now} />
          ))}
        </div>
      )}
      <LoadMore
        page={page}
        summary={`${visible.length} de ${tasks.length} tarefas carregadas correspondem aos filtros.`}
        label="Carregar tarefas anteriores"
        onLoadMore={onLoadMore}
      />
    </section>
  );
}

function TaskDetails({ task, now }: { task: AutomationTask; now: string }) {
  const attention = taskNeedsAttention(task, now);
  const overdue = !isTerminalStatus(task.status) && isTaskExpired(task, now);
  const uncertain =
    task.status === "DISPATCHED" ||
    task.status === "DISPATCHING" ||
    task.failureCode === "DISPATCH_INTERRUPTED";
  return (
    <Card className="p-4">
      <details>
        <summary className="cursor-pointer text-sm">
          <span className="font-medium">
            {AUTOMATION_TASK_META[task.type].label}
            {task.channel ? ` · ${CHANNEL_META[task.channel].label}` : ""}
          </span>{" "}
          <Badge
            tone={
              attention
                ? "warning"
                : task.status === "SUCCEEDED"
                  ? "success"
                  : "neutral"
            }
          >
            {AUTOMATION_STATUS_LABELS[task.status]}
          </Badge>
          <span className="text-muted-foreground mt-2 block text-xs">
            Programada para {formatDateTime(task.scheduledFor)} · Tentativa{" "}
            {task.attempt} de {task.maxAttempts}
          </span>
        </summary>
        <div className="mt-4 space-y-3 text-sm">
          {task.providerMessageId?.startsWith("sim_") && (
            <p>Resultado simulado: nenhuma mensagem real foi enviada.</p>
          )}
          {overdue && (
            <p className="text-warning-soft-foreground">
              Prazo encerrado em {formatDateTime(task.expiresAt)}.{" "}
              {uncertain
                ? "O resultado ainda não foi confirmado; a mensagem pode ter saído. Confira antes de repetir."
                : "A verificação automática registrará o vencimento e o alerta no painel."}
            </p>
          )}
          {!overdue && task.status === "DISPATCHING" && attention && (
            <p className="text-warning-soft-foreground">
              A execução está sem confirmação além do tempo esperado. Confira o
              resultado antes de repetir.
            </p>
          )}
          {task.failureCode && (
            <p>{DELIVERY_FAILURE_LABELS[task.failureCode]}</p>
          )}
          {task.stopReason && <p>{stopReasonLabel(task.stopReason)}</p>}
          <dl className="text-muted-foreground space-y-1">
            <div>
              <dt className="inline">Validade: </dt>
              <dd className="inline">{formatDateTime(task.expiresAt)}</dd>
            </div>
            {task.appointmentStartsAt && (
              <div>
                <dt className="inline">Atendimento: </dt>
                <dd className="inline">
                  {formatDateTime(task.appointmentStartsAt)}
                </dd>
              </div>
            )}
            <div className="break-all">
              <dt className="inline">Referência: </dt>
              <dd className="inline">{task.id}</dd>
            </div>
          </dl>
          <h3 className="font-medium">Histórico de execução</h3>
          <ol className="border-border space-y-2 border-l pl-4">
            {task.history.map((step, index) => (
              <li key={index}>
                <p>
                  {AUTOMATION_STATUS_LABELS[step.to]} · tentativa {step.attempt}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(step.at)}
                  {step.code ? ` · ${step.code}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </Card>
  );
}
