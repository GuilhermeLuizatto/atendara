"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormActions, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ROLE_LABELS } from "@/config/permissions";
import { TEAM_ADMIN_REASON_LENGTH } from "@/config/platform";
import {
  phaseFiveService,
  type PlatformTeamAdministrationView,
  type PlatformTeamMemberView,
  type PlatformTeamRequestView,
} from "@/services/phase-five";

type PendingAction =
  | { kind: "request"; request: PlatformTeamRequestView; decision: "APPROVED" | "REJECTED" }
  | { kind: "status"; member: PlatformTeamMemberView; status: "ACTIVE" | "SUSPENDED" }
  | { kind: "remove"; member: PlatformTeamMemberView };

const EMPTY: PlatformTeamAdministrationView = { requests: [], members: [] };

export function TeamAdministrationPanel() {
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setData(await phaseFiveService.platformTeam.list());
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível carregar a administração de equipes.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function open(action: PendingAction) {
    setPending(action);
    setReason("");
    setNotice("");
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setNotice("");
    try {
      if (pending.kind === "request") {
        await phaseFiveService.platformTeam.decide(
          pending.request.organizationId,
          pending.request.id,
          pending.decision,
          reason,
        );
        setNotice(pending.decision === "APPROVED" ? "Solicitação aprovada e convite enviado." : "Solicitação recusada.");
      } else if (pending.kind === "status") {
        await phaseFiveService.platformTeam.setStatus(
          pending.member.organizationId,
          pending.member.id,
          pending.status,
          reason,
        );
        setNotice(pending.status === "SUSPENDED" ? "Membro suspenso e sessões revogadas." : "Membro reativado.");
      } else {
        await phaseFiveService.platformTeam.remove(
          pending.member.organizationId,
          pending.member.id,
          reason,
        );
        setNotice("Membro removido, login excluído e cadastro pseudonimizado.");
      }
      setPending(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir o ato administrativo.");
    } finally {
      setSaving(false);
    }
  }

  const reasonValid = reason.trim().length >= TEAM_ADMIN_REASON_LENGTH.min;
  const actionLabel = pending?.kind === "request"
    ? pending.decision === "APPROVED" ? "Aprovar e enviar convite" : "Recusar solicitação"
    : pending?.kind === "status"
      ? pending.status === "SUSPENDED" ? "Suspender membro" : "Reativar membro"
      : pending?.kind === "remove" ? "Remover definitivamente" : undefined;

  return (
    <section className="space-y-6" aria-busy={status === "loading" || undefined}>
      <p className="text-muted-foreground text-sm">
        A operadora decide solicitações e controla o acesso com segundo fator e motivo obrigatório. Esta área mostra somente dados administrativos de conta e vínculo; não abre agenda, clientes, mensagens ou financeiro.
      </p>
      {notice ? <p role="status" className="border-border bg-surface rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}
      {status === "loading" ? <p role="status" className="text-muted-foreground text-sm">Carregando equipes...</p> : null}
      {status === "error" ? <Button variant="outline" onClick={() => void load()}>Tentar novamente</Button> : null}

      <div className="space-y-3">
        <h2 className="text-foreground text-base font-semibold">Solicitações pendentes</h2>
        {status === "ready" && data.requests.length === 0 ? <p className="text-muted-foreground text-sm">Nenhuma solicitação aguardando decisão.</p> : null}
        {data.requests.map((request) => (
          <article key={`${request.organizationId}:${request.id}`} className="border-border bg-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-foreground font-medium">{request.displayName}</h3>
                <p className="text-muted-foreground text-sm">{request.email} · {ROLE_LABELS[request.role]}</p>
                <p className="text-subtle-foreground mt-1 text-xs">{request.organizationName} · {request.organizationId}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => open({ kind: "request", request, decision: "REJECTED" })}>Recusar</Button>
                <Button size="sm" onClick={() => open({ kind: "request", request, decision: "APPROVED" })}>Aprovar</Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-foreground text-base font-semibold">Membros ativos e suspensos</h2>
        {status === "ready" && data.members.length === 0 ? <p className="text-muted-foreground text-sm">Nenhum membro encontrado.</p> : null}
        {data.members.map((member) => (
          <article key={`${member.organizationId}:${member.id}`} className="border-border bg-surface rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-foreground font-medium">{member.account?.displayName ?? "Cadastro preservado"}</h3>
                <p className="text-muted-foreground text-sm">{member.account?.email ?? "Sem dados de conta"} · {ROLE_LABELS[member.role]}</p>
                <p className="text-subtle-foreground mt-1 text-xs">{member.organizationName} · {member.organizationId}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={member.status === "ACTIVE" ? "success" : "warning"}>{member.status === "ACTIVE" ? "Ativo" : "Suspenso"}</Badge>
                {!member.isOrganizationHolder ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => open({ kind: "status", member, status: member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>
                      {member.status === "ACTIVE" ? "Suspender" : "Reativar"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => open({ kind: "remove", member })}>Remover</Button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={pending !== null}
        onClose={() => !saving && setPending(null)}
        title={actionLabel ?? "Confirmar ato"}
        description={pending?.kind === "remove"
          ? "Esta ação apaga o login e pseudonimiza o cadastro. Não pode ser desfeita."
          : "O motivo ficará na trilha append-only da operadora."}
      >
        <div className="space-y-4">
          <Field label="Motivo" required hint={`De ${TEAM_ADMIN_REASON_LENGTH.min} a ${TEAM_ADMIN_REASON_LENGTH.max} caracteres.`}>
            {(props) => <Textarea {...props} value={reason} maxLength={TEAM_ADMIN_REASON_LENGTH.max} onChange={(event) => setReason(event.target.value)} />}
          </Field>
          <FormActions>
            <Button variant="outline" disabled={saving} onClick={() => setPending(null)}>Cancelar</Button>
            <Button disabled={saving || !reasonValid} onClick={() => void confirm()}>{saving ? "Salvando..." : actionLabel}</Button>
          </FormActions>
        </div>
      </Modal>
    </section>
  );
}
