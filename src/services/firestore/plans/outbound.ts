import type { OrganizationNotificationSettings } from "@/types";

import { assertPermission } from "../../guards";
import { paths } from "@/lib/firebase/paths";
import { auditWrite, touch, type Plan, type PlanContext } from "../plan";

/**
 * Escritas dos avisos ao cliente que ainda saem do navegador: so a
 * configuracao.
 *
 * A fila de saida (`notificationDeliveries`) e a de automacao
 * (`automationTasks`) sao do backend desde a Fase 3 (13.2). O gatilho
 * `planAppointmentNotices` planeja a partir da escrita do atendimento, a Cloud
 * Tasks agenda o horario e o despachante envia depois de conferir as travas de
 * novo. As Security Rules recusam qualquer escrita do cliente nas duas colecoes:
 * um membro marcaria como enviado o que nunca saiu.
 */

/**
 * Alterar a configuracao de avisos exige `notificationSettings:update` — de
 * OWNER, ADMIN ou do titular da organizacao — e deixa rastro na trilha. O
 * resumo registra o que mudou sem copiar modelo nenhum: o texto vive na
 * configuracao, nao na auditoria.
 */
export function planUpdateNotificationSettings(
  ctx: PlanContext,
  settings: OrganizationNotificationSettings,
): Plan {
  assertPermission(ctx.actor, "notificationSettings:update");

  const enabledRules = settings.rules.filter((rule) => rule.enabled).length;

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "organizations",
        path: paths.organization(ctx.organizationId),
        data: {
          "settings.notifications": settings,
          ...touch(ctx),
        },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "organization", id: ctx.organizationId },
        summary: settings.enabled
          ? `Avisos de atendimento ativados com ${enabledRules} regra(s).`
          : "Avisos de atendimento desativados.",
        metadata: {
          enabled: settings.enabled,
          channels: settings.verifiedSenderChannels.join(",") || "nenhum",
          enabledRules,
        },
      }),
    ],
  };
}
