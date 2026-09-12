"use client";

import { useState } from "react";

import { Tabs } from "@/components/ui/tabs";
import { isPlatformAdmin } from "@/config/access";
import { hasPlatformPermission } from "@/config/permissions";
import { useAuth } from "@/providers/auth-provider";

import { AccessGrantsPanel } from "./access-grants-panel";
import { AccountsPanel } from "./accounts-panel";
import { PlatformAdminsPanel } from "./platform-admins-panel";
import { PlatformAuditPanel } from "./platform-audit-panel";
import { PlatformBillingPanel } from "./platform-billing";
import { SecondFactorGate } from "./second-factor-gate";

type AdminTab = "cadastros" | "concessoes" | "cobranca" | "trilha" | "administradores";

const TABS: { value: AdminTab; label: string }[] = [
  { value: "cadastros", label: "Cadastros" },
  { value: "concessoes", label: "Concessões de acesso" },
  { value: "cobranca", label: "Cobrança da plataforma" },
  { value: "trilha", label: "Trilha da operadora" },
];

/**
 * Area da operadora. Nenhuma aba le dado de tenant: cadastros e concessoes
 * leem `accounts` e `platformAccessGrants`; cobranca, as colecoes `platform*`.
 * Tudo atras do segundo fator, que regras e callables exigem de qualquer jeito.
 */
export function AdminView() {
  const { user } = useAuth();
  const [tab, setTab] = useState<AdminTab>("cadastros");
  if (!isPlatformAdmin(user?.access)) return null;
  // A aba so existe para a chave mestra; as callables recusam os demais.
  const tabs: { value: AdminTab; label: string }[] = hasPlatformPermission(user?.access, "platformAdmin:manage")
    ? [...TABS, { value: "administradores", label: "Administradores" }]
    : TABS;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Administração</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Profissionais, concessões de acesso, cobrança da plataforma e a trilha dos atos da operadora.
        </p>
      </div>
      <SecondFactorGate>
        <Tabs options={tabs} value={tab} onChange={setTab} />
        {tab === "cadastros" ? <AccountsPanel /> : null}
        {tab === "concessoes" ? <AccessGrantsPanel /> : null}
        {tab === "cobranca" ? <PlatformBillingPanel /> : null}
        {tab === "trilha" ? <PlatformAuditPanel /> : null}
        {tab === "administradores" ? <PlatformAdminsPanel /> : null}
      </SecondFactorGate>
    </div>
  );
}
