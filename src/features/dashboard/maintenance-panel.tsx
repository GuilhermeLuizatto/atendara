"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonStyles } from "@/components/ui/button";
import { maintenanceSuggestions } from "@/lib/agenda/maintenance";
import { formatShortDate } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";

/**
 * Quem está no prazo de voltar (E2.4).
 *
 * **Nada é enviado daqui.** A lista existe para ela olhar e decidir chamar —
 * aviso ao cliente é opt-in explícito (regra 11), e o botão leva para a agenda,
 * não para uma mensagem.
 */

/** Uma lista longa vira ruído no painel; o resto está na ficha da cliente. */
const MAX_LINHAS = 5;

export function MaintenancePanel() {
  const { data, profession, terminology } = useWorkspace();

  const sugestoes = useMemo(() => {
    if (!data || !profession.features.maintenanceReminders) return [];
    return maintenanceSuggestions({
      appointments: data.appointments,
      services: data.services,
      now: new Date(),
    });
  }, [data, profession.features.maintenanceReminders]);

  if (!profession.features.maintenanceReminders || sugestoes.length === 0)
    return null;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Hora de voltar</CardTitle>
        <Badge tone="neutral">{sugestoes.length}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Pelo intervalo de retorno do serviço. Nenhuma mensagem é enviada —{" "}
          {byTerm(terminology.client.singularLower)} só sabe se você chamar.
        </p>

        <ul className="divide-border divide-y">
          {sugestoes.slice(0, MAX_LINHAS).map((item) => (
            <li
              key={`${item.clientId}-${item.serviceId}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-medium">
                  {item.clientName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {item.serviceName} ·{" "}
                  {formatShortDate(`${item.lastVisitOn}T12:00:00.000Z`)}
                </p>
              </div>
              <Badge tone={item.status === "DUE" ? "warning" : "neutral"}>
                {item.status === "DUE"
                  ? `${item.daysLate} ${item.daysLate === 1 ? "dia" : "dias"}`
                  : "a vencer"}
              </Badge>
            </li>
          ))}
        </ul>

        <Link
          href="/agenda"
          className={buttonStyles({ variant: "outline", size: "sm" })}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Abrir a agenda
        </Link>
      </CardBody>
    </Card>
  );
}

/** "a cliente" soa melhor que "cliente" solto no meio da frase. */
function byTerm(term: string): string {
  return `a ${term}`;
}
