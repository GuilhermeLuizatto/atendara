"use client";

import { MessagesSquare } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/skeleton";
import { classificationMeta } from "@/config/classifications";
import {
  AI_ACTION_LABELS,
  ATTENTION_LABELS,
  CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
} from "@/config/labels";
import { DecisionDetails } from "@/features/ai-agent/decision-details";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { Conversation, Message } from "@/types";

export function MessagesView() {
  const { data } = useWorkspace();
  if (!data) return <MessagesSkeleton />;
  return <MessagesWorkspace key={data.organization.id} />;
}

function MessagesSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <p role="status" className="sr-only">
        Carregando mensagens...
      </p>
      <SkeletonCard lines={1} />
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <SkeletonCard lines={6} />
        <SkeletonCard lines={4} />
      </div>
    </div>
  );
}

function MessagesWorkspace() {
  const { data, repository } = useWorkspace();
  const { loadMore } = useWorkspaceActions();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!data) return <MessagesSkeleton />;
  const demonstrative = repository?.mode === "memory";

  // Conversas sao simulacao por decisao do titular: sem canal integrado, uma
  // organizacao real nao recebe nenhuma. A tela diz isso em vez de parecer
  // quebrada — e nao inventa conversa para preencher.
  if (data.conversations.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Mensagens"
          description="Acompanhe as conversas e assuma os casos que precisam de atenção."
        />
        <Card>
          <EmptyState
            icon={<MessagesSquare className="size-5" aria-hidden />}
            title="Nenhuma conversa ainda"
            description={
              demonstrative
                ? "Os dados de demonstração foram esvaziados. Restaure-os pelo menu da sua conta."
                : "A central recebe conversas quando um canal de mensagens estiver integrado. Hoje nenhum canal está ativo: nenhuma mensagem chega nem sai por aqui."
            }
          />
        </Card>
      </div>
    );
  }
  const rank = { CRITICAL: 0, HIGH: 1, ATTENTION: 2, NORMAL: 3 };
  const conversations = data.conversations
    .filter(
      (item) =>
        item.clientName
          .toLocaleLowerCase("pt-BR")
          .includes(search.toLocaleLowerCase("pt-BR")) &&
        (filter === "ALL" ||
          (filter === "CRITICAL"
            ? item.attention === "CRITICAL"
            : item.status === filter)),
    )
    .sort(
      (a, b) =>
        rank[a.attention] - rank[b.attention] ||
        b.lastMessageAt.localeCompare(a.lastMessageAt),
    );
  const selected = data.conversations.find((item) => item.id === selectedId);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Mensagens"
        description="Acompanhe as conversas e assuma os casos que precisam de atenção."
        actions={demonstrative ? <Badge tone="info">Conversas de demonstração</Badge> : null}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className={cn(selected && "hidden lg:block")}>
          <div className="border-border space-y-2 border-b p-3">
            <Input
              aria-label="Buscar conversa"
              placeholder="Buscar por nome"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Filtrar conversas"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="ALL">
                Todas as conversas ({data.conversations.length})
              </option>
              <option value="WAITING_PROFESSIONAL">
                Aguardando profissional
              </option>
              <option value="CRITICAL">Prioridade crítica</option>
              <option value="RESOLVED">Resolvidas</option>
            </Select>
          </div>
          <div className="max-h-[65dvh] overflow-y-auto">
            {conversations.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={selectedId === item.id}
                className={cn(
                  "border-border hover:bg-surface-hover block w-full space-y-2 border-b p-4 text-left",
                  selectedId === item.id && "bg-primary-soft",
                  item.attention === "CRITICAL" && "border-l-danger border-l-4",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {item.clientName}
                  </span>
                  {item.unreadCount > 0 && (
                    <Badge tone="primary">{item.unreadCount}</Badge>
                  )}
                </div>
                <p className="text-muted-foreground line-clamp-2 text-xs">
                  {item.lastMessagePreview}
                </p>
                <div className="flex flex-wrap gap-1">
                  <Badge
                    tone={
                      item.attention === "CRITICAL"
                        ? "danger"
                        : item.escalated
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {ATTENTION_LABELS[item.attention]}
                  </Badge>
                  {item.lastClassification && (
                    <Badge>
                      {classificationMeta(item.lastClassification).label}
                    </Badge>
                  )}
                </div>
                <p className="text-subtle-foreground text-xs">
                  {CONVERSATION_STATUS_LABELS[item.status]} ·{" "}
                  {formatDateTime(item.lastMessageAt)}
                </p>
              </button>
            ))}
            {!conversations.length && (
              <p role="status" className="text-muted-foreground p-5 text-sm">
                Nenhuma conversa com essa busca ou filtro.
              </p>
            )}
          </div>
          <LoadMore
            className="border-border border-t"
            page={data.pagination?.conversations}
            summary={`Mostrando as ${data.conversations.length} conversas mais recentes.`}
            label="Carregar conversas anteriores"
            onLoadMore={() => void loadMore("conversations")}
          />
        </Card>
        {selected ? (
          <ConversationPanel
            key={selected.id}
            conversation={selected}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <Card className="text-muted-foreground flex min-h-80 items-center justify-center p-5 text-sm">
            Selecione uma conversa para ver mensagens e decisões.
          </Card>
        )}
      </div>
    </div>
  );
}

function ConversationPanel({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const { data, session } = useWorkspace();
  const { run } = useWorkspaceActions();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const messages = data.messages
    .filter((message) => message.conversationId === conversation.id)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const canReply = session?.permissions.includes("conversation:reply");
  const change = (
    patch: Partial<
      Pick<
        Conversation,
        | "status"
        | "escalated"
        | "escalationReason"
        | "attention"
        | "unreadCount"
      >
    >,
  ) => run((repo) => repo.updateConversation(conversation.id, patch));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await run(
      (repo) => repo.replyToConversation(conversation.id, text),
      "Resposta registrada na demonstração.",
    );
    if (result !== null) setText("");
    setBusy(false);
  };
  return (
    <Card className="min-w-0">
      <div className="border-border space-y-3 border-b p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Voltar para conversas
        </Button>
        <div>
          <h2 className="font-semibold">{conversation.clientName}</h2>
          <p className="text-muted-foreground text-xs">
            {CHANNEL_LABELS[conversation.channel]} ·{" "}
            {CONVERSATION_STATUS_LABELS[conversation.status]}
          </p>
        </div>
        {conversation.escalated && (
          <p className="bg-warning-soft text-warning-soft-foreground rounded-lg p-3 text-sm">
            Automação pausada. {conversation.escalationReason}
          </p>
        )}
        {canReply && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                change({
                  escalated: true,
                  escalationReason: "Conversa assumida pelo profissional.",
                  status: "WAITING_PROFESSIONAL",
                  unreadCount: 0,
                })
              }
            >
              Assumir conversa
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => change({ status: "RESOLVED", unreadCount: 0 })}
            >
              Marcar resolvida
            </Button>
            {conversation.escalated && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  change({
                    escalated: false,
                    escalationReason: null,
                    attention: "NORMAL",
                    status: "OPEN",
                    unreadCount: 0,
                  })
                }
              >
                Liberar agente
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="max-h-[55dvh] space-y-4 overflow-y-auto p-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
      {canReply && (
        <form
          className="border-border space-y-3 border-t p-4"
          onSubmit={submit}
        >
          <Field
            label="Resposta do profissional"
            hint="Neste protótipo, a resposta fica somente nesta conversa de demonstração."
          >
            {(props) => (
              <Textarea
                {...props}
                required
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? "Registrando..." : "Registrar resposta"}
          </Button>
        </form>
      )}
    </Card>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const { data } = useWorkspace();
  const decision = data?.decisions.find(
    (item) => item.id === message.aiDecisionId || item.messageId === message.id,
  );
  return (
    <article
      className={cn(
        "max-w-[95%] space-y-2 rounded-xl p-3 text-sm",
        message.direction === "OUTBOUND"
          ? "bg-primary-soft ml-auto"
          : "bg-surface-muted",
      )}
    >
      <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
        <span>
          {message.authorName}
          {message.authorType === "AI_AGENT" ? " · Agente IA" : ""}
        </span>
        <time dateTime={message.sentAt}>{formatDateTime(message.sentAt)}</time>
      </div>
      <p className="break-words whitespace-pre-wrap">{message.body}</p>
      {decision && (
        <details>
          <summary className="text-primary cursor-pointer text-xs">
            Decisão da IA · {AI_ACTION_LABELS[decision.action]}
          </summary>
          <div className="mt-3">
            <DecisionDetails decision={decision} />
          </div>
        </details>
      )}
    </article>
  );
}
