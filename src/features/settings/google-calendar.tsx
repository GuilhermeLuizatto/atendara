"use client";

import { useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { isBusySnapshotFresh } from "@/lib/agenda/calendar";
import { formatDateTime } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { calendarService } from "@/services/calendar";
import type { CalendarConnectionView } from "@/types/calendar";

export function GoogleCalendar({ professionalId }: { professionalId: string }) {
  const [connection, setConnection] = useState<CalendarConnectionView | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authorization, setAuthorization] = useState<{
    url: string;
    expiresAt: number;
  } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const now = useNow();
  const authorizationUrl =
    authorization && authorization.expiresAt > now.getTime()
      ? authorization.url
      : null;

  useEffect(() => {
    let current = true;
    calendarService
      .get(professionalId)
      .then((value) => {
        if (current) setConnection(value);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
  }, [professionalId]);

  async function act(action: "connect" | "status" | "refresh" | "disconnect") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "connect") {
        const { url } = await calendarService.connect(professionalId);
        const target = new URL(url);
        if (
          target.origin !== "https://accounts.google.com" ||
          target.pathname !== "/o/oauth2/v2/auth"
        )
          throw new Error("Endereço de autorização inválido.");
        setAuthorization({ url, expiresAt: Date.now() + 9 * 60_000 });
      } else {
        if (action === "refresh") await calendarService.refresh(professionalId);
        if (action === "disconnect") {
          const result = await calendarService.disconnect(professionalId);
          setAuthorization(null);
          setConfirmDisconnect(false);
          setNotice(
            [
              result.revokedAtGoogle
                ? "Agenda desconectada e horários removidos do Atendara."
                : "Acesso removido do Atendara. O Google não confirmou a revogação; remova também o acesso em sua Conta Google.",
              result.calendarDeleted
                ? ""
                : "A agenda Atendara pode ter ficado no seu Google; apague-a nas configurações do Google Agenda.",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
        const value = await calendarService.get(professionalId);
        setConnection(value);
        if (value.status === "CONNECTED") setAuthorization(null);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a operação.",
      );
      // Reconfere inclusive após erro: uma autorização revogada muda o estado no servidor.
      if (action === "refresh") {
        try {
          setConnection(await calendarService.get(professionalId));
        } catch {
          /* O erro original permanece visível. */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Minha agenda Google</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Consulte os horários ocupados dos próximos 30 dias na sua agenda
          principal. O Atendara recebe apenas início e fim, sem títulos,
          convidados ou descrições.
        </p>
        <p className="text-muted-foreground text-sm">
          Seus atendimentos aparecem numa agenda separada, chamada Atendara, no
          seu Google. O evento mostra o horário e, conforme a sua profissão, o
          nome de quem é atendido — nunca observações ou valores. O Atendara não
          altera nenhum outro evento seu.
        </p>
        <p className="text-muted-foreground text-sm">
          O ocupado da sua agenda principal é relido a cada 30 minutos e
          aparece na agenda do Atendara; marcar por cima mostra um aviso, sem
          bloquear. Aqui você também pode atualizar na hora.
        </p>
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-foreground text-sm">
            {notice}{" "}
            <a
              className="text-primary underline"
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gerenciar acesso no Google
            </a>
          </p>
        ) : null}
        {connection ? (
          <CalendarConnectionDetails
            connection={connection}
            now={now.toISOString()}
          />
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            {error
              ? "Situação da conexão indisponível."
              : "Consultando conexão…"}
          </p>
        )}
        <div className="flex flex-wrap gap-2" aria-busy={busy}>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act("status")}
          >
            Verificar conexão
          </Button>
          {connection?.configured && !authorizationUrl ? (
            <Button disabled={busy} onClick={() => void act("connect")}>
              {connection.status !== "CONNECTED"
                ? "Conectar Google Calendar"
                : connection.writeEnabled
                  ? "Trocar conta Google"
                  : "Reconectar Google Calendar"}
            </Button>
          ) : null}
          {connection?.status === "CONNECTED" ? (
            <Button
              disabled={busy || !connection.configured}
              onClick={() => void act("refresh")}
            >
              Atualizar horários ocupados
            </Button>
          ) : null}
          {connection &&
          (connection.status !== "REVOKED" || authorizationUrl) ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              Desconectar
            </Button>
          ) : null}
        </div>
        {authorizationUrl ? (
          <div className="bg-surface-muted space-y-3 rounded-lg p-4 text-sm">
            <p>
              Abra o Google, escolha sua conta e autorize a consulta de
              horários e a agenda Atendara. Depois volte aqui e clique em
              Verificar conexão. Este link vale por alguns minutos.
            </p>
            <a
              className={buttonStyles()}
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Continuar no Google (nova aba)
            </a>
          </div>
        ) : null}
        <Modal
          open={confirmDisconnect}
          onClose={() => {
            if (!busy) setConfirmDisconnect(false);
          }}
          title="Desconectar agenda Google?"
          description="O acesso e os horários consultados serão removidos do Atendara, e a agenda Atendara será apagada do seu Google. Seus outros eventos no Google serão preservados."
        >
          <div className="flex justify-end gap-2 p-5">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDisconnect(false)}
            >
              Manter conexão
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void act("disconnect")}
            >
              Desconectar agenda
            </Button>
          </div>
        </Modal>
      </CardBody>
    </Card>
  );
}

export function CalendarConnectionDetails({
  connection,
  now,
}: {
  connection: CalendarConnectionView;
  now: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const snapshot = connection.snapshot;
  const fresh =
    snapshot &&
    !connection.lastError &&
    isBusySnapshotFresh(snapshot.readAt, now);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-foreground font-medium">
        {connection.status === "CONNECTED"
          ? "Agenda conectada"
          : connection.status === "ERROR"
            ? "Reconexão necessária"
            : "Agenda desconectada"}
      </p>
      {!connection.configured ? (
        <p className="text-muted-foreground">
          A equipe do Atendara precisa concluir a configuração da integração
          para liberar a conexão.
        </p>
      ) : null}
      {connection.lastError ? (
        <p role="status" className="text-danger">
          {connection.lastError === "RECONNECT_REQUIRED"
            ? "Conecte sua conta Google novamente para continuar."
            : "A última consulta falhou. Os horários anteriores não comprovam disponibilidade atual."}
        </p>
      ) : null}
      {connection.status === "CONNECTED" ? (
        <p className={connection.writeEnabled ? "text-muted-foreground" : "text-danger"}>
          {connection.writeEnabled
            ? "Seus atendimentos estão sendo enviados à agenda Atendara no Google."
            : "Reconecte para enviar seus atendimentos à agenda Atendara no Google. A consulta de ocupado continua funcionando."}
        </p>
      ) : null}
      {connection.status === "CONNECTED" && !snapshot ? (
        <p className="text-muted-foreground">
          Nenhuma consulta realizada. Clique em Atualizar horários ocupados.
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p className="text-muted-foreground">
            Consulta de {formatDateTime(snapshot.readAt)}. Período:{" "}
            {formatDateTime(snapshot.timeMin)} até{" "}
            {formatDateTime(snapshot.timeMax)}.
          </p>
          {!fresh ? (
            <p role="status" className="text-danger">
              Leitura desatualizada ou indisponível. Atualize antes de conferir
              um horário.
            </p>
          ) : null}
          {snapshot.blocks.length === 0 ? (
            <p>
              {fresh
                ? "Nenhum horário ocupado encontrado na agenda principal no período consultado."
                : "A última leitura não continha horários ocupados. Isso não confirma que a agenda continua livre."}
            </p>
          ) : (
            <>
              <p className="font-medium">
                {snapshot.blocks.length} intervalo(s) ocupado(s)
              </p>
              <ul className="divide-border divide-y">
                {snapshot.blocks
                  .slice(0, showAll ? undefined : 20)
                  .map((block, index) => (
                    <li className="py-2" key={`${block.startsAt}-${index}`}>
                      <span className="text-muted-foreground">Ocupado · </span>
                      {formatDateTime(block.startsAt)} até{" "}
                      {formatDateTime(block.endsAt)}
                    </li>
                  ))}
              </ul>
              {snapshot.blocks.length > 20 ? (
                <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Mostrar menos" : "Mostrar todos os intervalos"}
                </Button>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
