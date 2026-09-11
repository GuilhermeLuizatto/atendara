"use client";

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/skeleton";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { isPlatformAdmin, MODULE_LABELS } from "@/config/access";
import { ROLE_LABELS } from "@/config/permissions";
import { AgendaSettingsForm } from "@/features/settings/agenda-settings-form";
import { AuditTrail } from "@/features/settings/audit-trail";
import { NotificationSettings } from "@/features/settings/notification-settings";
import { formatDate } from "@/lib/utils/format";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";

type Section = "geral" | "avisos" | "auditoria";

const ID_BASE = "configuracoes";

export default function SettingsPage() {
  const { user } = useAuth();
  const { data, session, profession, organization } = useWorkspace();
  const [section, setSection] = useState<Section>("geral");
  const access = user?.access;
  const admin = isPlatformAdmin(access);

  const canReadAudit = session?.permissions.includes("auditLog:read") ?? false;
  const options: { value: Section; label: string }[] = [
    { value: "geral", label: "Geral" },
    { value: "avisos", label: "Avisos de atendimento" },
    ...(canReadAudit ? [{ value: "auditoria" as const, label: "Trilha de auditoria" }] : []),
  ];
  // Perder a permissao com a aba aberta nao pode deixar um painel orfao.
  const active = options.some((option) => option.value === section) ? section : "geral";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Configuracoes"
        description="Seu acesso, o horario de atendimento, os avisos que a organizacao envia e a trilha de auditoria."
      />

      <Tabs
        idBase={ID_BASE}
        label="Secoes das configuracoes"
        options={options}
        value={active}
        onChange={setSection}
      />

      <TabPanel idBase={ID_BASE} value={active} className="space-y-4">
        {active === "geral" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Meu acesso</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                <p className="text-foreground">
                  {user?.displayName} · <span className="text-muted-foreground">{user?.email}</span>
                </p>
                <p className="text-foreground">
                  {admin ? "Administrador da plataforma — todas as profissoes" : profession.label}
                </p>
                <p className="text-muted-foreground">
                  {admin
                    ? "Voce gerencia os cadastros e acessos na Administracao."
                    : `Acesso valido ate ${access?.accessUntil ? formatDate(access.accessUntil) : "a liberacao pela operadora"}.`}
                </p>
                <p className="text-muted-foreground">
                  Areas liberadas:{" "}
                  {admin ? "todas" : access?.modules.map((area) => MODULE_LABELS[area]).join(", ")}
                </p>
                {session && !admin ? (
                  <p className="text-muted-foreground">
                    Papel na organizacao: {ROLE_LABELS[session.role]}
                    {session.isOrganizationHolder ? ", titular da organizacao" : ""}.
                  </p>
                ) : null}
              </CardBody>
            </Card>

            {data && organization ? (
              <Card>
                <CardHeader>
                  <CardTitle>Horario de atendimento</CardTitle>
                </CardHeader>
                <CardBody>
                  <AgendaSettingsForm />
                </CardBody>
              </Card>
            ) : (
              <SkeletonCard lines={4} />
            )}
          </>
        ) : null}

        {active === "avisos" ? data ? <NotificationSettings /> : <SkeletonCard lines={6} /> : null}

        {active === "auditoria" ? <AuditTrail /> : null}
      </TabPanel>
    </div>
  );
}
