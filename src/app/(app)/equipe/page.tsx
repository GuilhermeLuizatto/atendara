"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormActions, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { ROLE_LABELS } from "@/config/permissions";
import { useWorkspace } from "@/providers/workspace-provider";
import { phaseFiveService, type TeamInviteInput, type TeamView } from "@/services/phase-five";
import type { Role } from "@/types";

const EMPTY: TeamView = { members: [], professionals: [], requests: [], invitations: [] };

export default function TeamPage() {
  const { session } = useWorkspace();
  const [data, setData] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamInviteInput>({ displayName: "", email: "", role: "ASSISTANT", linkedProfessionalIds: [] });
  const canInvite = session?.permissions.includes("member:invite") ?? false;
  const canRequest = session?.permissions.includes("member:request") ?? false;

  const load = useCallback(async () => {
    try { setData(await phaseFiveService.team.list()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar a equipe."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function submit() {
    setBusy(true); setNotice("");
    try {
      if (canInvite) await phaseFiveService.team.invite(form);
      else if (canRequest && form.role !== "ADMIN") await phaseFiveService.team.request({ ...form, role: form.role });
      setNotice(canInvite ? "Convite enviado por e-mail." : "Solicitação enviada para aprovação.");
      setForm({ displayName: "", email: "", role: "ASSISTANT", linkedProfessionalIds: [] });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível enviar."); }
    finally { setBusy(false); }
  }

  async function setStatus(memberId: string, status: "ACTIVE" | "SUSPENDED") {
    setBusy(true);
    try { await phaseFiveService.team.setStatus(memberId, status); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível alterar o acesso."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Equipe" description="Convites, vínculos com profissionais e acesso da organização." />
      {notice ? <p role="status" className="border-border bg-surface rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}

      {(canInvite || canRequest) ? (
        <Card>
          <CardHeader><CardTitle>{canInvite ? "Convidar participante" : "Solicitar participante"}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" required>{(props) => <Input {...props} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />}</Field>
              <Field label="E-mail" required>{(props) => <Input {...props} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
              <Field label="Papel" required>{(props) => <Select {...props} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Exclude<Role, "OWNER"> })}>
                {canInvite && session?.isOrganizationHolder ? <option value="ADMIN">Administrador</option> : null}
                <option value="PROFESSIONAL">Profissional</option><option value="ASSISTANT">Assistente</option><option value="VIEWER">Visualizador</option>
              </Select>}</Field>
              {form.role !== "ADMIN" ? <Field label="Profissionais vinculados" hint="É permitido vincular a mais de um.">{(props) => <select {...props} multiple className="border-input bg-surface text-foreground min-h-24 w-full rounded-lg border p-2 text-sm" value={form.linkedProfessionalIds} onChange={(event) => setForm({ ...form, linkedProfessionalIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{data.professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>}</Field> : null}
            </div>
            <FormActions><Button disabled={busy || !form.displayName || !form.email} onClick={() => void submit()}>{busy ? "Enviando…" : canInvite ? "Enviar convite" : "Enviar solicitação"}</Button></FormActions>
          </CardBody>
        </Card>
      ) : null}

      {canInvite && data.requests.some((item) => item.status === "PENDING") ? <Card><CardHeader><CardTitle>Solicitações pendentes</CardTitle></CardHeader><CardBody className="space-y-3">{data.requests.filter((item) => item.status === "PENDING").map((item) => <div key={item.id} className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div><p className="text-sm font-medium">{item.displayName}</p><p className="text-muted-foreground text-xs">{item.email} · {ROLE_LABELS[item.role]}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void phaseFiveService.team.decide(item.id, "REJECTED", "").then(load)}>Rejeitar</Button><Button size="sm" onClick={() => void phaseFiveService.team.decide(item.id, "APPROVED", "").then(load)}>Aprovar e enviar</Button></div></div>)}</CardBody></Card> : null}

      <Card>
        <CardHeader><CardTitle>Participantes</CardTitle></CardHeader>
        <CardBody className="space-y-3">{data.members.map((member) => {
          const protectedMember = member.userId === session?.user.userId || member.role === "OWNER" || (member.role === "ADMIN" && !session?.isOrganizationHolder);
          return <div key={member.id} className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div><p className="text-sm font-medium">{member.account?.displayName ?? "Cadastro preservado"}</p><p className="text-muted-foreground text-xs">{member.account?.email ?? "Dados removidos"} · {ROLE_LABELS[member.role]}</p></div><div className="flex items-center gap-2"><Badge tone={member.status === "ACTIVE" ? "success" : "warning"}>{member.status === "ACTIVE" ? "Ativo" : member.status === "SUSPENDED" ? "Suspenso" : "Removido"}</Badge>{session?.permissions.includes("member:update") && !protectedMember && member.status !== "REMOVED" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(member.id, member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")}>{member.status === "ACTIVE" ? "Suspender" : "Reativar"}</Button> : null}{session?.permissions.includes("member:remove") && !protectedMember && member.status !== "REMOVED" ? <Button size="sm" variant="danger" onClick={() => setRemoveId(member.id)}>Remover</Button> : null}</div></div>;
        })}{data.members.length === 0 ? <p className="text-muted-foreground text-sm">Nenhum participante encontrado.</p> : null}</CardBody>
      </Card>

      <ConfirmDialog open={removeId !== null} onClose={() => setRemoveId(null)} onConfirm={() => { if (removeId) void phaseFiveService.team.remove(removeId).then(load); }} title="Remover participante" message="A remoção revoga o acesso e pseudonimiza o cadastro. O histórico administrativo é preservado e esta ação não pode ser desfeita." confirmLabel="Remover" />
    </div>
  );
}
