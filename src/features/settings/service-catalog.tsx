"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Service } from "@/types";

import { ServiceForm } from "./service-form";

/**
 * Catalogo de servicos (E2.1).
 *
 * Aparece so para profissao com `features.serviceCatalog` — quem chama decide
 * isso; aqui nao ha `if (profissao === ...)`.
 *
 * Servico usado em atendimento se **arquiva**, nao se apaga: o atendimento
 * guarda o id, e apagar deixaria um registro apontando para o nada.
 */

function detalhe(service: Service): string {
  const partes: string[] = [];
  partes.push(
    service.durationMinutes === null
      ? "sem duração"
      : `${service.durationMinutes} min`,
  );
  partes.push(
    service.priceInCents === null
      ? "sem valor"
      : formatCurrency(service.priceInCents),
  );
  if (service.returnIntervalDays !== null)
    partes.push(`retorno em ${service.returnIntervalDays} dias`);
  return partes.join(" · ");
}

export function ServiceCatalog() {
  const { data, session } = useWorkspace();
  const { archiveService, deleteService } = useWorkspaceActions();
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<{
    service: Service;
    kind: "archive" | "delete";
  } | null>(null);

  const canManage = session?.permissions.includes("service:manage") ?? false;
  const services = useMemo(
    () =>
      [...(data?.services ?? [])].sort(
        (a, b) =>
          a.position - b.position || a.name.localeCompare(b.name, "pt-BR"),
      ),
    [data?.services],
  );
  const usados = useMemo(
    () =>
      new Set(
        (data?.appointments ?? [])
          .map((appointment) => appointment.serviceId)
          .filter(Boolean),
      ),
    [data?.appointments],
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Meus serviços</CardTitle>
        {canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            Novo serviço
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-muted-foreground text-sm">
          A duração e o valor são sempre seus. Serviço disponível aparece na
          hora de agendar e já preenche duração e valor do atendimento — que
          continuam editáveis ali.
        </p>

        {services.length === 0 ? (
          <EmptyState
            title="Nenhum serviço no catálogo"
            description="Cadastre o que você faz, com a sua duração e o seu valor."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  Novo serviço
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {services.map((service) => (
              <li
                key={service.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {service.name}
                    </span>
                    {service.archivedAt ? (
                      <Badge tone="neutral">Arquivado</Badge>
                    ) : (
                      <Badge tone={service.enabled ? "success" : "neutral"}>
                        {service.enabled ? "Disponível" : "Rascunho"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {detalhe(service)}
                  </p>
                  {service.description ? (
                    <p className="text-subtle-foreground text-xs">
                      {service.description}
                    </p>
                  ) : null}
                </div>

                {canManage && !service.archivedAt ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(service)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfirming({
                          service,
                          kind: usados.has(service.id) ? "archive" : "delete",
                        })
                      }
                    >
                      {usados.has(service.id) ? "Arquivar" : "Apagar"}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {creating ? (
        <ServiceForm open service={null} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <ServiceForm open service={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.kind === "archive")
            void archiveService(confirming.service.id);
          else void deleteService(confirming.service.id);
        }}
        title={
          confirming?.kind === "archive" ? "Arquivar serviço" : "Apagar serviço"
        }
        message={
          confirming?.kind === "archive"
            ? `"${confirming.service.name}" já foi usado em atendimento. Ele sai da lista de agendamento, e o histórico continua legível.`
            : `"${confirming?.service.name}" nunca foi usado em atendimento e será apagado.`
        }
        confirmLabel={confirming?.kind === "archive" ? "Arquivar" : "Apagar"}
      />
    </Card>
  );
}
