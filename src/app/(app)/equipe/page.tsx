"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormActions, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { ROLE_LABELS } from "@/config/permissions";
import { useWorkspace } from "@/providers/workspace-provider";
import { phaseFiveService, type TeamInviteInput, type TeamView } from "@/services/phase-five";

const EMPTY: TeamView = { members: [], professionals: [], requests: [], invitations: [] };

export default function TeamPage() {
  const { session } = useWorkspace();
  const [data, setData] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<TeamInviteInput>({ displayName: "", email: "", role: "ASSISTANT", linkedProfessionalIds: [] });
  const canRequest = session?.permissions.includes("member:request") ?? false;

  const load = useCallback(async () => {
    try { setData(await phaseFiveService.team.list()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar a equipe."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function submit() {
    setBusy(true); setNotice("");
    try {
      if (canRequest) await phaseFiveService.team.request(form);
      setNotice("Solicitação enviada para a administração da Atendara.");
      setForm({ displayName: "", email: "", role: "ASSISTANT", linkedProfessionalIds: [] });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível enviar."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Equipe" description="Convites, vínculos com profissionais e acesso da organização." />
      {notice ? <p role="status" className="border-border bg-surface rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}

      {canRequest ? (
        <Card>
          <CardHeader><CardTitle>Solicitar participante</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-muted-foreground text-sm">A Atendara confere a solicitação e envia o convite. A equipe da organização não cria nem altera contas diretamente.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" required>{(props) => <Input {...props} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />}</Field>
              <Field label="E-mail" required>{(props) => <Input {...props} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
              <Field label="Papel" required>{(props) => <Select {...props} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as TeamInviteInput["role"] })}>
                <option value="PROFESSIONAL">Profissional</option><option value="ASSISTANT">Assistente</option>
              </Select>}</Field>
              <Field label="Profissionais vinculados" hint="É permitido vincular a mais de um.">{(props) => <select {...props} multiple className="border-input bg-surface text-foreground min-h-24 w-full rounded-lg border p-2 text-sm" value={form.linkedProfessionalIds} onChange={(event) => setForm({ ...form, linkedProfessionalIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{data.professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>}</Field>
            </div>
            <FormActions><Button disabled={busy || !form.displayName || !form.email} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar solicitação"}</Button></FormActions>
          </CardBody>
        </Card>
      ) : null}

      {data.requests.some((item) => item.status === "PENDING") ? <Card><CardHeader><CardTitle>Solicitações em análise</CardTitle></CardHeader><CardBody className="space-y-3">{data.requests.filter((item) => item.status === "PENDING").map((item) => <div key={item.id} className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div><p className="text-sm font-medium">{item.displayName}</p><p className="text-muted-foreground text-xs">{item.email} · {ROLE_LABELS[item.role]}</p></div><Badge tone="warning">Aguardando Atendara</Badge></div>)}</CardBody></Card> : null}

      <Card>
        <CardHeader><CardTitle>Participantes</CardTitle></CardHeader>
        <CardBody className="space-y-3">{data.members.map((member) => {
          return <div key={member.id} className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div><p className="text-sm font-medium">{member.account?.displayName ?? "Cadastro preservado"}</p><p className="text-muted-foreground text-xs">{member.account?.email ?? "Dados removidos"} · {ROLE_LABELS[member.role]}</p></div><Badge tone={member.status === "ACTIVE" ? "success" : "warning"}>{member.status === "ACTIVE" ? "Ativo" : member.status === "SUSPENDED" ? "Suspenso" : "Removido"}</Badge></div>;
        })}{data.members.length === 0 ? <p className="text-muted-foreground text-sm">Nenhum participante encontrado.</p> : null}</CardBody>
      </Card>
    </div>
  );
}
