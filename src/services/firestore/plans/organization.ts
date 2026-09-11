import { getProfession } from "@/config/professions";
import { paths } from "@/lib/firebase/paths";
import type { AgendaSettings } from "@/types";

import { assertPermission, validateAgendaSettings } from "../../guards";
import { auditWrite, touch, type Plan, type PlanContext } from "../plan";

/**
 * Horario de atendimento e padroes da agenda.
 *
 * Ato administrativo (`organization:update`). O titular sem papel
 * administrativo nao passa por aqui: o alcance dele sobre o documento da
 * organizacao e so a configuracao de avisos, e as rules recusam o resto.
 */
export function planUpdateAgendaSettings(
  ctx: PlanContext,
  settings: AgendaSettings,
): Plan {
  assertPermission(ctx.actor, "organization:update");
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
