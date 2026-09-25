import type { Notification, NotificationTarget } from "@/types";

/** Destinos internos que um alerta do painel sabe abrir diretamente. */
export function notificationTargetHref(
  target: NotificationTarget | null,
): "/configuracoes?secao=google" | null {
  if (target?.type === "calendar_connection")
    return "/configuracoes?secao=google";
  return null;
}

/** Resolvido e reconhecido são terminais; lido ainda exige ação. */
export function isOpenNotification(
  notification: Pick<Notification, "status">,
): boolean {
  return notification.status === "UNREAD" || notification.status === "READ";
}
