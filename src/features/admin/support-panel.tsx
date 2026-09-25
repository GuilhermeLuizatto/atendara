"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { AttachmentLink } from "@/features/support/attachment-link";
import { phaseFiveService, uploadPhaseFiveFile, type SupportThread } from "@/services/phase-five";
import type { SupportAttachment, SupportPriority, SupportTicket, SupportTicketStatus } from "@/types";

async function upload(ticket: SupportTicket, messageId: string, files: FileList | null): Promise<SupportAttachment[]> {
  if (!files?.length) return [];
  if (files.length > 5) throw new Error("Envie no máximo 5 arquivos.");
  return Promise.all(Array.from(files).map(async (file) => {
    if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Use imagens ou PDF de até 5 MB.");
    const id = crypto.randomUUID(); const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `support/${ticket.organizationId}/${ticket.id}/${messageId}/${id}-${safeName}`;
    await uploadPhaseFiveFile(storagePath, file, file.type);
    return { id, storagePath, name: file.name, contentType: file.type as SupportAttachment["contentType"], size: file.size };
  }));
}

export function SupportPanel() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setTickets((await phaseFiveService.support.list()).tickets); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar a fila."); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function open(ticketId: string) { setThread(await phaseFiveService.support.thread(ticketId)); }
  async function update(patch: { priority?: SupportPriority | null; status?: SupportTicketStatus }) { if (!thread) return; await phaseFiveService.support.update(thread.ticket.id, patch); await open(thread.ticket.id); await load(); }
  async function reply() { if (!thread) return; setBusy(true); try { const messageId = crypto.randomUUID(); const attachments = await upload(thread.ticket, messageId, files); await phaseFiveService.support.reply({ ticketId: thread.ticket.id, messageId, body, attachments }); setBody(""); setFiles(null); await open(thread.ticket.id); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível responder."); } finally { setBusy(false); } }
  return <div className="grid gap-5 lg:grid-cols-[340px_1fr]">{notice ? <p role="status" className="lg:col-span-2 text-sm">{notice}</p> : null}<Card><CardHeader><CardTitle>Fila cronológica</CardTitle></CardHeader><CardBody className="space-y-2">{tickets.map((ticket) => <button key={ticket.id} className="border-border hover:bg-surface-muted w-full rounded-lg border p-3 text-left" onClick={() => void open(ticket.id)}><span className="block truncate text-sm font-medium">{ticket.subject}</span><span className="text-muted-foreground mt-1 block text-xs">{ticket.organizationName} · {ticket.openedByName}</span><span className="mt-2 flex gap-2"><Badge tone="info">{ticket.reportedSeverity}</Badge>{ticket.priority ? <Badge tone="warning">{ticket.priority}</Badge> : <Badge>Sem prioridade</Badge>}</span></button>)}</CardBody></Card><Card><CardHeader><CardTitle>{thread?.ticket.subject ?? "Selecione um chamado"}</CardTitle></CardHeader><CardBody className="space-y-4">{thread ? <><div className="grid gap-3 sm:grid-cols-2"><Field label="Prioridade definida pelo suporte">{(props) => <Select {...props} value={thread.ticket.priority ?? ""} onChange={(event) => void update({ priority: (event.target.value || null) as SupportPriority | null })}><option value="">Não definida</option><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></Select>}</Field><Field label="Situação">{(props) => <Select {...props} value={thread.ticket.status} onChange={(event) => void update({ status: event.target.value as SupportTicketStatus })}><option value="OPEN">Aberto</option><option value="WAITING_SUPPORT">Aguardando suporte</option><option value="WAITING_CUSTOMER">Aguardando cliente</option><option value="RESOLVED">Resolvido</option></Select>}</Field></div>{thread.messages.map((message) => <article key={message.id} className="border-border rounded-lg border p-4"><div className="flex justify-between"><strong className="text-sm">{message.authorName}</strong><Badge tone={message.authorKind === "SUPPORT" ? "accent" : "neutral"}>{message.authorKind}</Badge></div><p className="text-muted-foreground mt-2 whitespace-pre-wrap text-sm">{message.body}</p>{message.attachments.length ? <ul className="mt-2 text-xs">{message.attachments.map((item) => <li key={item.id}><AttachmentLink attachment={item} /></li>)}</ul> : null}</article>)}{thread.ticket.status !== "RESOLVED" ? <><Field label="Resposta oficial">{(props) => <Textarea {...props} value={body} onChange={(event) => setBody(event.target.value)} />}</Field><Field label="Anexos">{(props) => <Input {...props} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setFiles(event.target.files)} />}</Field><Button disabled={busy || !body.trim()} onClick={() => void reply()}>Responder no painel</Button></> : null}</> : <p className="text-muted-foreground text-sm">A prioridade é definida pelo suporte; a fila permanece ordenada pela data de abertura.</p>}</CardBody></Card></div>;
}
