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

export function settingsSectionFromQuery(
  value: string | null,
): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => section === value) ?? null;
}
