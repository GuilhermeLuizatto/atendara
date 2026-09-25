"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/skeleton";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { isPlatformAdmin, MODULE_LABELS } from "@/config/access";
import { ROLE_LABELS } from "@/config/permissions";
import { AgendaSettingsForm } from "@/features/settings/agenda-settings-form";
import { AuditTrail } from "@/features/settings/audit-trail";
import { AutomationQueue } from "@/features/automation/automation-queue";
import { NotificationSettings } from "@/features/settings/notification-settings";
import { ReceiptSettingsForm } from "@/features/settings/receipt-settings";
import { OrganizationBranding } from "@/features/settings/organization-branding";
import { ProfessionChange } from "@/features/settings/profession-change";
import { GoogleCalendar } from "@/features/settings/google-calendar";
import { ServiceCatalog } from "@/features/settings/service-catalog";
import { WhatsappEmbeddedSignup } from "@/features/settings/whatsapp-embedded-signup";
import {
  settingsSectionFromQuery,
  type SettingsSection,
} from "@/features/settings/sections";
import { formatDate } from "@/lib/utils/format";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";

const ID_BASE = "configuracoes";

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsFallback() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
      <PageHeader
        title="Configurações"
        description="Carregando suas configurações…"
      />
      <SkeletonCard lines={6} />
    </div>
  );
}

function SettingsContent() {
  const { user } = useAuth();
  const { data, session, profession, organization } = useWorkspace();
  const searchParams = useSearchParams();
  const requestedSection = settingsSectionFromQuery(searchParams.get("secao"));
  const [selectedSection, setSelectedSection] =
    useState<SettingsSection | null>(null);
  const section = selectedSection ?? requestedSection ?? "geral";
  const access = user?.access;
  const admin = isPlatformAdmin(access);

  const canReadAudit = session?.permissions.includes("auditLog:read") ?? false;
  const ownProfessional = data?.professionals.find(
    (professional) =>
      professional.userId === user?.userId && professional.active,
  );
  const canConnectCalendar =
    !admin &&
    !!ownProfessional &&
    session?.permissions.includes("appointment:read");
  // A aba existe pela flag da profissao, nunca pelo nome dela (regra 1).
  const hasCatalog =
    profession.features.serviceCatalog &&
    (session?.permissions.includes("service:read") ?? false);
  const options: { value: SettingsSection; label: string }[] = [
    { value: "geral", label: "Geral" },
    ...(hasCatalog ? [{ value: "servicos" as const, label: "Serviços" }] : []),
    { value: "avisos", label: "Avisos de atendimento" },
    ...(session?.permissions.includes("receipt:read")
      ? [{ value: "recibos" as const, label: "Recibos" }]
      : []),
    { value: "whatsapp", label: "WhatsApp" },
    ...(canConnectCalendar
      ? [{ value: "google" as const, label: "Google Calendar" }]
      : []),
    ...(session?.permissions.includes("automationQueue:read")
      ? [{ value: "fila" as const, label: "Fila de automações" }]
      : []),
    ...(canReadAudit
      ? [{ value: "auditoria" as const, label: "Trilha de auditoria" }]
      : []),
  ];
  // Perder a permissao com a aba aberta nao pode deixar um painel orfao.
  const active = options.some((option) => option.value === section)
    ? section
    : "geral";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Configurações"
        description="Seu acesso, o horário de atendimento, os avisos que a organização envia e a trilha de auditoria."
      />

      <Tabs
        idBase={ID_BASE}
        label="Seções das configurações"
        options={options}
        value={active}
        onChange={setSelectedSection}
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
                  {user?.displayName} ·{" "}
                  <span className="text-muted-foreground">{user?.email}</span>
                </p>
                <p className="text-foreground">
                  {admin
                    ? "Administrador da plataforma — todas as profissões"
                    : profession.label}
                </p>
                <p className="text-muted-foreground">
                  {admin
                    ? "Você gerencia os cadastros e acessos na Administração."
                    : `Acesso válido até ${access?.accessUntil ? formatDate(access.accessUntil) : "a liberação pela operadora"}.`}
                </p>
                <p className="text-muted-foreground">
                  Áreas liberadas:{" "}
                  {admin
                    ? "todas"
                    : access?.modules
                        .map((area) => MODULE_LABELS[area])
                        .join(", ")}
                </p>
                {session && !admin ? (
                  <p className="text-muted-foreground">
                    Papel na organização: {ROLE_LABELS[session.role]}
                    {session.isOrganizationHolder
                      ? ", titular da organização"
                      : ""}
                    .
                  </p>
                ) : null}
              </CardBody>
            </Card>

            {!admin && access?.organizationId && access.professionId ? (
              <Card>
                <CardHeader>
                  <CardTitle>Minha profissão</CardTitle>
                </CardHeader>
                <CardBody>
                  <ProfessionChange
                    organizationId={access.organizationId}
                    current={access.professionId}
                    isHolder={session?.isOrganizationHolder ?? false}
                  />
                </CardBody>
              </Card>
            ) : null}

            {data && organization ? (
              <Card>
                <CardHeader><CardTitle>Logo da organização</CardTitle></CardHeader>
                <CardBody><OrganizationBranding /></CardBody>
              </Card>
            ) : null}

            {data && organization ? (
              <Card>
                <CardHeader>
                  <CardTitle>Horário de atendimento</CardTitle>
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

        {active === "servicos" ? (
          data ? (
            <ServiceCatalog />
          ) : (
            <SkeletonCard lines={5} />
          )
        ) : null}

        {active === "avisos" ? (
          data ? (
            <NotificationSettings />
          ) : (
            <SkeletonCard lines={6} />
          )
        ) : null}

        {active === "recibos" ? (
          data ? (
            <ReceiptSettingsForm key={data.receiptSettings?.updatedAt ?? "novo"} />
          ) : (
            <SkeletonCard lines={4} />
          )
        ) : null}

        {active === "whatsapp" ? <WhatsappEmbeddedSignup /> : null}
        {active === "google" && ownProfessional ? (
          <GoogleCalendar
            key={ownProfessional.id}
            professionalId={ownProfessional.id}
          />
        ) : null}

        {active === "auditoria" ? <AuditTrail /> : null}
        {active === "fila" ? <AutomationQueue /> : null}
      </TabPanel>
    </div>
  );
}
