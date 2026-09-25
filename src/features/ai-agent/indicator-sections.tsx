"use client";

import { Card } from "@/components/ui/card";
import { classificationMeta } from "@/config/classifications";
import { CLASSIFIER_STATUS_LABELS } from "@/config/labels";
import { APPOINTMENT_EVENT_META, DELIVERY_FAILURE_LABELS } from "@/config/notifications";
import type {
  summarizeClassifier,
  summarizeReplyDeliveries,
  summarizeReviews,
} from "@/lib/ai/analytics";
import type { ClassifierUsageStatus, ConversationReplyEvent, DeliveryFailureCode } from "@/types";

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const integer = (value: number) => value.toLocaleString("pt-BR");

function Metrics({ items }: { items: Array<[string, string | number]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="border-border rounded-lg border p-3">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className="mt-1 text-xl font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewAccuracy({
  stats,
  failed,
}: {
  stats: ReturnType<typeof summarizeReviews>;
  failed: boolean;
}) {
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-semibold">Acerto nas decisões revisadas</h3>
      <p className="text-muted-foreground text-sm">
        Calculado só sobre as decisões que a administração revisou na aba
        Auditoria. Decisão sem revisão não entra na conta.
      </p>
      {failed ? (
        <p role="alert">Não foi possível carregar as revisões. Tente novamente.</p>
      ) : !stats.reviewed ? (
        <p className="text-sm">Nenhuma decisão revisada neste período e filtro.</p>
      ) : (
        <>
          <Metrics
            items={[
              ["Revisadas", `${integer(stats.reviewed)} de ${integer(stats.decisions)}`],
              ["Acerto", percent(stats.accuracy)],
              [
                `Pelo Gemini (${integer(stats.bySource.GEMINI.reviewed)})`,
                percent(stats.bySource.GEMINI.accuracy),
              ],
              [
                `Pelas regras locais (${integer(stats.bySource.LOCAL.reviewed)})`,
                percent(stats.bySource.LOCAL.accuracy),
              ],
            ]}
          />
          {stats.mistakes.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Erros apontados</h4>
              <ul className="space-y-1 text-sm">
                {stats.mistakes.map((mistake) => (
                  <li key={`${mistake.predicted}>${mistake.expected}`} className="flex justify-between gap-3">
                    <span>
                      Saiu {classificationMeta(mistake.predicted).label}, era{" "}
                      {classificationMeta(mistake.expected).label}
                    </span>
                    <span>{integer(mistake.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ClassifierUsage({ stats }: { stats: ReturnType<typeof summarizeClassifier> }) {
  const statuses = Object.entries(stats.statuses) as Array<[ClassifierUsageStatus, number]>;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-semibold">Uso do Gemini</h3>
      <ul className="space-y-1 text-sm">
        {statuses.map(([status, count]) => (
          <li key={status} className="flex justify-between gap-3">
            <span>{CLASSIFIER_STATUS_LABELS[status]}</span>
            <span>{integer(count)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Tokens: {integer(stats.tokens.input)} de entrada ·{" "}
        {integer(stats.tokens.output)} de saída · {integer(stats.tokens.thinking)}{" "}
        de raciocínio
        {stats.models.length > 0 && ` · ${stats.models.join(", ")}`}
      </p>
      <p className="text-muted-foreground text-xs">
        Contagem de tokens, não custo em reais. Sem resposta válida do Gemini, a
        mensagem vai para a equipe.
      </p>
    </Card>
  );
}

export function ReplyDeliveries({
  stats,
  failed,
  partial,
}: {
  stats: ReturnType<typeof summarizeReplyDeliveries>;
  failed: boolean;
  partial: boolean;
}) {
  const events = Object.entries(stats.events) as Array<[ConversationReplyEvent, number]>;
  const failures = Object.entries(stats.failures) as Array<[DeliveryFailureCode, number]>;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-semibold">Entrega das respostas da Dara</h3>
      <p className="text-muted-foreground text-sm">
        Só as respostas na conversa, pela data prevista de envio. Lembretes e
        confirmações da agenda ficam em Configurações.
      </p>
      {failed ? (
        <p role="alert">Não foi possível carregar os envios. Tente novamente.</p>
      ) : !stats.total ? (
        <p className="text-sm">Nenhuma resposta da Dara neste período e filtro.</p>
      ) : (
        <>
          {partial && (
            <p role="status" className="text-warning-soft-foreground text-sm">
              Amostra parcial: existem envios anteriores ainda não carregados.
            </p>
          )}
          <Metrics
            items={[
              ["Respostas na fila", integer(stats.total)],
              ["Aceitas pelo provedor", integer(stats.accepted)],
              ["Entregues ao aparelho", integer(stats.delivered)],
              ["Lidas", integer(stats.read)],
              ["Simuladas", integer(stats.simulated)],
              ["Falharam", integer(stats.failed)],
              ["Aguardando envio", integer(stats.pending)],
              ["Canceladas", integer(stats.cancelled)],
            ]}
          />
          <p className="text-muted-foreground text-xs">
            Aceita pelo provedor não prova que chegou. Entregue é a confirmação
            do aparelho; lida só aparece quando a pessoa mantém a confirmação de
            leitura ligada. Simulada passou pela fila, mas não saiu para ninguém.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Por tipo de resposta</h4>
              <ul className="space-y-1 text-sm">
                {events.map(([event, count]) => (
                  <li key={event} className="flex justify-between gap-3">
                    <span>{APPOINTMENT_EVENT_META[event].label}</span>
                    <span>{integer(count)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {failures.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium">Motivos de falha</h4>
                <ul className="space-y-1 text-sm">
                  {failures.map(([code, count]) => (
                    <li key={code} className="flex justify-between gap-3">
                      <span>{DELIVERY_FAILURE_LABELS[code]}</span>
                      <span>{integer(count)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
