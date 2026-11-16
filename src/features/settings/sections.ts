import { isSettingsSectionHidden } from "@/config/scope";

export const SETTINGS_SECTIONS = [
  "geral",
  "servicos",
  "avisos",
  "recibos",
  "whatsapp",
  "auditoria",
  "fila",
  "google",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Abas que o recorte de produto esconde chegam por URL como se nao existissem. */
export function settingsSectionFromQuery(
  value: string | null,
): SettingsSection | null {
  return (
    SETTINGS_SECTIONS.find(
      (section) => section === value && !isSettingsSectionHidden(section),
    ) ?? null
  );
}
