"use client";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { isPlatformAdmin, MODULE_LABELS } from "@/config/access";
import { NotificationSettings } from "@/features/settings/notification-settings";

export default function SettingsPage() {
  const { user } = useAuth();
  const { profession } = useWorkspace();
  const access = user?.access;
  return <div className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-foreground text-2xl font-semibold">Configuracoes</h1>
    <section className="bg-surface border-border space-y-3 rounded-xl border p-5">
      <h2 className="text-foreground font-semibold">Meu acesso</h2>
      <p className="text-muted-foreground text-sm">{user?.displayName} · {user?.email}</p>
      <p className="text-foreground text-sm">{isPlatformAdmin(access) ? "Administrador da plataforma — todas as profissoes" : profession.label}</p>
      <p className="text-muted-foreground text-sm">{isPlatformAdmin(access) ? "Voce gerencia os cadastros e acessos na Administracao." : `Acesso mensal valido ate ${access?.accessUntil ? new Date(access.accessUntil).toLocaleDateString("pt-BR") : "liberacao pelo administrador"}.`}</p>
      <p className="text-muted-foreground text-sm">Areas liberadas: {isPlatformAdmin(access) ? "Todas" : access?.modules.map(area => MODULE_LABELS[area]).join(", ")}</p>
    </section>
    <NotificationSettings />
  </div>;
}
