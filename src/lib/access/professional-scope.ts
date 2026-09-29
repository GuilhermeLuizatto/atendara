import type { ID, Membership, Role } from "@/types";

export interface ProfessionalScope {
  organizationWide: boolean;
  professionalIds: ID[];
}

const ORGANIZATION_WIDE_ROLES = new Set<Role>(["OWNER", "ADMIN"]);

export function professionalScopeFor(
  membership: Pick<Membership, "role" | "linkedProfessionalIds">,
): ProfessionalScope {
  return {
    organizationWide: ORGANIZATION_WIDE_ROLES.has(membership.role),
    professionalIds: [
      ...new Set(
        (membership.linkedProfessionalIds ?? []).filter(
          (professionalId): professionalId is ID =>
            typeof professionalId === "string" && professionalId.length > 0,
        ),
      ),
    ],
  };
}

export function hasProfessionalScope(
  scope: ProfessionalScope,
  professionalId: ID | null | undefined,
): boolean {
  return (
    scope.organizationWide ||
    (professionalId != null && scope.professionalIds.includes(professionalId))
  );
}
