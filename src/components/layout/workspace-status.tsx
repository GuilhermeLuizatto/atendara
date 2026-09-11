"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudOff, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button, buttonStyles } from "@/components/ui/button";
import { OPERATOR_NAME } from "@/config/app";
import { canManageSubscription } from "@/config/access";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import type { WorkspaceCollection } from "@/services";

const COLLECTION_LABELS: Record<WorkspaceCollection, string> = {
  professionals: "profissionais",
  clients: "cadastros",
  appointments: "agenda",
  conversations: "conversas",
  messages: "mensagens",
  transactions: "financeiro",
  rules: "regras do agente",
  decisions: "decisoes do agente",
  notifications: "alertas",
  notificationDeliveries: "fila de avisos",
  auditLogs: "trilha de auditoria",
};

/** Areas que nao dependem do workspace: abrem mesmo com a carga indisponivel. */
const INDEPENDENT_AREAS = new Set(["assinatura", "admin"]);

/**
 * Portao de carga do painel.
 *
 * Carregando, cada tela mostra o proprio esqueleto. Aqui ficam os casos em que
 * esperar nao resolve: sem conexao, organizacao que nao existe, acesso negado
 * ou colecao que falhou. Em nenhum deles a tela aparece vazia fingindo que
 * nao ha dados.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { repository, loadState, retry } = useWorkspace();
  const pathname = usePathname();
  const area = pathname.split("/")[1] ?? "";

  if (!repository || INDEPENDENT_AREAS.has(area)) return <>{children}</>;

  if (loadState.status === "unavailable") {
    return <UnavailablePanel reason={loadState.reason} onRetry={retry} />;
  }

  return (
    <>
      {loadState.status === "loading" && loadState.slow ? (
        <Banner
          role="status"
          icon={<RefreshCw className="size-4" aria-hidden />}
          message="Esta demorando mais que o normal para carregar. A conexao pode estar lenta."
          onRetry={retry}
        />
      ) : null}
      {loadState.status === "ready" && loadState.failed.length > 0 ? (
        <Banner
          role="alert"
          icon={<TriangleAlert className="size-4" aria-hidden />}
          message={`Nao foi possivel carregar: ${loadState.failed.map((name) => COLLECTION_LABELS[name]).join(", ")}. O que aparece vazio nessas areas pode nao estar vazio.`}
          onRetry={retry}
        />
      ) : null}
      {children}
    </>
  );
}

function Banner({
  role,
  icon,
  message,
  onRetry,
}: {
  role: "status" | "alert";
  icon: ReactNode;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role={role}
      className="bg-warning-soft text-warning-soft-foreground mb-5 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
    >
      {icon}
      <p className="min-w-0 flex-1">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

function UnavailablePanel({
  reason,
  onRetry,
}: {
  reason: "offline" | "organization-missing" | "access-denied" | "failed";
  onRetry: () => void;
}) {
  const { user, signOut } = useAuth();

  const content = {
    offline: {
      icon: CloudOff,
      title: "Sem conexao com o servidor",
      body: "Nada foi perdido: seus dados ficam guardados no servidor. Confira a internet e tente de novo.",
    },
    "organization-missing": {
      icon: TriangleAlert,
      title: "Sua area de trabalho ainda nao esta pronta",
      body: `O cadastro existe, mas a organizacao dele nao foi encontrada. Fale com a ${OPERATOR_NAME} para concluir a liberacao.`,
    },
    "access-denied": {
      icon: ShieldAlert,
      title: "Seu acesso nao abre este painel agora",
      body: `A validade do acesso pode ter terminado, o cadastro pode estar suspenso ou a organizacao ainda nao foi liberada. Nenhum dado foi apagado. Se nao souber o motivo, fale com a ${OPERATOR_NAME}.`,
    },
    failed: {
      icon: TriangleAlert,
      title: "Nao foi possivel carregar o painel",
      body: "Tente de novo em instantes. Se continuar, recarregue a pagina.",
    },
  }[reason];
  const Icon = content.icon;

  return (
    <section
      role="alert"
      aria-labelledby="workspace-unavailable-title"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center"
    >
      <span className="bg-surface-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden />
      </span>
      <h1 id="workspace-unavailable-title" className="text-foreground text-xl font-semibold">
        {content.title}
      </h1>
      <p className="text-muted-foreground text-sm leading-relaxed">{content.body}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>Tentar de novo</Button>
        {reason === "access-denied" && canManageSubscription(user?.access) ? (
          <Link href="/assinatura" className={buttonStyles({ variant: "outline" })}>
            Ver minha assinatura
          </Link>
        ) : null}
        <Button variant="ghost" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </section>
  );
}
