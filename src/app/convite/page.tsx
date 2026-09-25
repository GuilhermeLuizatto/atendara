"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { phaseFiveService } from "@/services/phase-five";
import type { Role } from "@/types";

interface InvitationView { email: string; displayName: string; role: Role; organizationName: string; professions: string[]; }

export default function InvitationPage() {
  return <Suspense fallback={<div className="p-8 text-sm">Carregando convite…</div>}><InvitationContent /></Suspense>;
}

function InvitationContent() {
  const token = useSearchParams().get("token") ?? "";
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [password, setPassword] = useState("");
  const [profession, setProfession] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      void phaseFiveService.team.inspectInvitation(token).then((result) => { setInvitation(result); setProfession(result.professions[0] ?? ""); }).catch((error: Error) => setNotice(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  async function accept() {
    setBusy(true); setNotice("");
    try {
      await phaseFiveService.team.acceptInvitation({ token, password, ...(invitation?.role === "PROFESSIONAL" ? { profession, phone: phone || null, licenseNumber: licenseNumber || null, specialties: specialties.split(",").map((item) => item.trim()).filter(Boolean) } : {}) });
      setDone(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível aceitar o convite."); }
    finally { setBusy(false); }
  }

  return <main data-accent="violet" className="bg-background flex min-h-dvh items-center justify-center p-6"><Card className="w-full max-w-lg"><CardHeader><CardTitle>{done ? "Convite confirmado" : "Entrar na organização"}</CardTitle></CardHeader><CardBody className="space-y-4">{done ? <><p className="text-muted-foreground text-sm">Seu e-mail foi confirmado e sua senha foi criada. Você já pode entrar no Atendara.</p><Link href="/login" className="text-primary text-sm font-medium underline underline-offset-2">Ir para o login</Link></> : invitation ? <><p className="text-muted-foreground text-sm">{invitation.displayName}, você foi convidado para <strong className="text-foreground">{invitation.organizationName}</strong>. Este primeiro acesso confirma seu e-mail.</p><Field label="E-mail">{(props) => <Input {...props} value={invitation.email} disabled />}</Field><Field label="Crie sua senha" required>{(props) => <Input {...props} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}</Field>{invitation.role === "PROFESSIONAL" ? <><Field label="Profissão" required>{(props) => <Select {...props} value={profession} onChange={(event) => setProfession(event.target.value)}>{invitation.professions.map((item) => <option key={item} value={item}>{item}</option>)}</Select>}</Field><Field label="Telefone">{(props) => <Input {...props} value={phone} onChange={(event) => setPhone(event.target.value)} />}</Field><Field label="Registro profissional">{(props) => <Input {...props} value={licenseNumber} onChange={(event) => setLicenseNumber(event.target.value)} />}</Field><Field label="Especialidades" hint="Separe por vírgulas.">{(props) => <Input {...props} value={specialties} onChange={(event) => setSpecialties(event.target.value)} />}</Field></> : null}<Button disabled={busy || !password || (invitation.role === "PROFESSIONAL" && !profession)} onClick={() => void accept()}>{busy ? "Confirmando…" : "Confirmar e criar conta"}</Button></> : <p role="status" className="text-muted-foreground text-sm">{token ? notice || "Conferindo convite…" : "O link do convite está incompleto."}</p>}{notice && invitation ? <p role="alert" className="text-danger text-sm">{notice}</p> : null}</CardBody></Card></main>;
}
