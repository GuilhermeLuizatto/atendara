"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { AttachmentLink } from "@/features/support/attachment-link";
import { useWorkspace } from "@/providers/workspace-provider";
import { phaseFiveService, uploadPhaseFiveFile, type SupportThread } from "@/services/phase-five";
import type { SupportAttachment, SupportCategory, SupportReportedSeverity, SupportTicket } from "@/types";

const CATEGORY: Record<SupportCategory, string> = { TECHNICAL_PROBLEM: "Problema técnico", HOW_TO: "Dúvida de uso", BILLING: "Cobrança", ACCOUNT_ACCESS: "Conta e acesso", SUGGESTION: "Sugestão", PRIVACY: "Privacidade" };
const STATUS = { OPEN: "Aberto", WAITING_SUPPORT: "Aguardando suporte", WAITING_CUSTOMER: "Aguardando você", RESOLVED: "Resolvido" } as const;

async function uploadAttachments(organizationId: string, ticketId: string, messageId: string, files: FileList | null): Promise<SupportAttachment[]> {
  if (!files?.length) return [];
  if (files.length > 5) throw new Error("Envie no máximo 5 arquivos por mensagem.");
  const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
  return Promise.all(Array.from(files).map(async (file) => {
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Use imagens ou PDF de até 5 MB.");
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `support/${organizationId}/${ticketId}/${messageId}/${id}-${safeName}`;
    await uploadPhaseFiveFile(storagePath, file, file.type);
    return { id, storagePath, name: file.name, contentType: file.type as SupportAttachment["contentType"], size: file.size };
  }));
}

export default function SupportPage() {
  const { session } = useWorkspace();
  const organizationId = session?.organizationId ?? "";
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [replyFiles, setReplyFiles] = useState<FileList | null>(null);
  const [reply, setReply] = useState("");
  const [form, setForm] = useState({ category: "TECHNICAL_PROBLEM" as SupportCategory, reportedSeverity: "MEDIUM" as SupportReportedSeverity, subject: "", body: "" });

  const load = useCallback(async () => {
    try { setTickets((await phaseFiveService.support.list()).tickets); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar os chamados."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function open(ticketId: string) {
    setBusy(true);
    try { setThread(await phaseFiveService.support.thread(ticketId)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível abrir o chamado."); }
    finally { setBusy(false); }
  }

  async function create() {
    setBusy(true); setNotice("");
    try {
      const ticketId = crypto.randomUUID(); const messageId = crypto.randomUUID();
      const attachments = await uploadAttachments(organizationId, ticketId, messageId, files);
      await phaseFiveService.support.create({ ticketId, messageId, ...form, attachments });
      setForm({ category: "TECHNICAL_PROBLEM", reportedSeverity: "MEDIUM", subject: "", body: "" }); setFiles(null);
      setNotice("Chamado criado. A conversa oficial permanece aqui no painel."); await load(); await open(ticketId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível criar o chamado."); }
    finally { setBusy(false); }
  }

  async function sendReply() {
    if (!thread) return;
    setBusy(true);
    try {
      const messageId = crypto.randomUUID();
      const attachments = await uploadAttachments(organizationId, thread.ticket.id, messageId, replyFiles);
      await phaseFiveService.support.reply({ ticketId: thread.ticket.id, messageId, body: reply, attachments });
      setReply(""); setReplyFiles(null); await open(thread.ticket.id); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível responder."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Suporte" description="Chamados da sua conta, com primeira resposta prevista em até 2 dias úteis. E-mails são apenas notificações; a conversa oficial fica aqui." />
      {notice ? <p role="status" className="border-border bg-surface rounded-lg border px-4 py-3 text-sm">{notice}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Novo chamado</CardTitle></CardHeader><CardBody className="space-y-4">
            <Field label="Categoria" required>{(props) => <Select {...props} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as SupportCategory })}>{Object.entries(CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}</Field>
            <Field label="Nível percebido" hint="O suporte define a prioridade real.">{(props) => <Select {...props} value={form.reportedSeverity} onChange={(event) => setForm({ ...form, reportedSeverity: event.target.value as SupportReportedSeverity })}><option value="LOW">Baixo</option><option value="MEDIUM">Médio</option><option value="HIGH">Alto</option><option value="URGENT">Urgente</option></Select>}</Field>
            <Field label="Assunto" required>{(props) => <Input {...props} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />}</Field>
            <Field label="Descrição" required hint="Não inclua dados de saúde ou senhas.">{(props) => <Textarea {...props} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />}</Field>
            <Field label="Imagens ou PDFs" hint="Até 5 arquivos de 5 MB.">{(props) => <Input {...props} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onChange={(event) => setFiles(event.target.files)} />}</Field>
            <FormActions><Button disabled={busy || form.subject.length < 5 || form.body.length < 10} onClick={() => void create()}>{busy ? "Enviando…" : "Abrir chamado"}</Button></FormActions>
          </CardBody></Card>
          <Card><CardHeader><CardTitle>Chamados</CardTitle></CardHeader><CardBody className="space-y-2">{tickets.map((ticket) => <button key={ticket.id} onClick={() => void open(ticket.id)} className="border-border hover:bg-surface-muted w-full rounded-lg border p-3 text-left"><span className="text-foreground block truncate text-sm font-medium">{ticket.subject}</span><span className="mt-1 flex items-center justify-between gap-2"><span className="text-muted-foreground text-xs">{CATEGORY[ticket.category]}</span><Badge tone={ticket.status === "RESOLVED" ? "success" : "info"}>{STATUS[ticket.status]}</Badge></span></button>)}{tickets.length === 0 ? <p className="text-muted-foreground text-sm">Nenhum chamado.</p> : null}</CardBody></Card>
        </div>
        <Card><CardHeader><CardTitle>{thread?.ticket.subject ?? "Conversa"}</CardTitle></CardHeader><CardBody className="space-y-5">{thread ? <>{thread.messages.map((message) => <article key={message.id} className="border-border rounded-lg border p-4"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{message.authorName}</p><Badge tone={message.authorKind === "SUPPORT" ? "accent" : "neutral"}>{message.authorKind === "SUPPORT" ? "Suporte" : "Organização"}</Badge></div><p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm">{message.body}</p>{message.attachments.length ? <ul className="mt-3 text-xs">{message.attachments.map((item) => <li key={item.id}><AttachmentLink attachment={item} /></li>)}</ul> : null}</article>)}{thread.ticket.status !== "RESOLVED" ? <div className="space-y-3"><Field label="Responder">{(props) => <Textarea {...props} value={reply} onChange={(event) => setReply(event.target.value)} />}</Field><Field label="Anexos">{(props) => <Input {...props} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onChange={(event) => setReplyFiles(event.target.files)} />}</Field><Button disabled={busy || !reply.trim()} onClick={() => void sendReply()}>Enviar resposta</Button></div> : null}</> : <p className="text-muted-foreground text-sm">Selecione um chamado para acompanhar a conversa.</p>}</CardBody></Card>
      </div>
    </div>
  );
}
