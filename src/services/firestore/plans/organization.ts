import { getProfession } from "@/config/professions";
import { paths } from "@/lib/firebase/paths";
import type { AgendaSettings } from "@/types";

import { assertPermission, validateAgendaSettings } from "../../guards";
import { auditWrite, touch, type Plan, type PlanContext } from "../plan";

/**
 * Horario de atendimento e padroes da agenda.
 *
 * Exige `agendaSettings:update`: OWNER, ADMIN e o titular da organizacao, que
 * nasce PROFESSIONAL e precisa mexer no proprio horario diante de imprevisto.
 * Do titular as rules aceitam so `settings.agenda` e `settings.notifications`.
 */
export function planUpdateAgendaSettings(
  ctx: PlanContext,
  settings: AgendaSettings,
): Plan {
  assertPermission(ctx.actor, "agendaSettings:update");
  const agenda = validateAgendaSettings(
    settings,
    getProfession(ctx.snapshot.organization.primaryProfession).modalities,
  );

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "organizations",
        path: paths.organization(ctx.organizationId),
        data: { "settings.agenda": agenda, ...touch(ctx) },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "organization", id: ctx.organizationId },
        summary: `Horario de atendimento alterado para ${agenda.workdayStart} as ${agenda.workdayEnd}.`,
        metadata: {
          workingDays: agenda.workingDays.join(","),
          workdayStart: agenda.workdayStart,
          workdayEnd: agenda.workdayEnd,
          slotIntervalMinutes: agenda.slotIntervalMinutes,
        },
      }),
    ],
  };
}
