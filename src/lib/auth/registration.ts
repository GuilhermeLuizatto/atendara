import { z } from "zod";
import { ACCESS_GRANT_REASON_LENGTH, PROFESSION_CHANGE_REASON_LENGTH, SELF_SERVICE_PASSWORD_LENGTH } from "@/config/platform";
import { COUNCIL_REGISTRATION_LENGTH } from "@/lib/auth/self-service";
import { MANUAL_ACCESS_GRANT_KINDS, PROFESSION_IDS } from "@/types";
import { APP_MODULES } from "@/types/access";

// Mesmo formato que as callables aceitam (`functions/index.js`, `platform.js`).
// Situacao da mensalidade e validade nao aparecem em cadastro nem em alteracao.
export const initialGrantSchema = z.object({
  kind: z.enum(MANUAL_ACCESS_GRANT_KINDS), until: z.iso.datetime(),
  reason: z.string().trim().min(ACCESS_GRANT_REASON_LENGTH.min).max(ACCESS_GRANT_REASON_LENGTH.max),
}).strict();
export const registrationSchema = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
  professionId: z.enum(PROFESSION_IDS), modules: z.array(z.enum(APP_MODULES)).min(1),
  initialGrant: initialGrantSchema.optional(),
}).strict();
// Mesmo formato de `registerSelfService` (`functions/self-service.js`). A tela
// recusa antes de chamar; o servidor recusa de novo, que e o que vale.
export const selfServiceRegistrationSchema = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
  password: z.string().min(SELF_SERVICE_PASSWORD_LENGTH.min).max(SELF_SERVICE_PASSWORD_LENGTH.max).optional(),
  professionId: z.enum(PROFESSION_IDS),
  councilRegistration: z.string().trim().max(COUNCIL_REGISTRATION_LENGTH.max).optional(),
  businessName: z.string().trim().min(2).max(120),
  acceptedLegalVersion: z.string().min(1).max(64),
}).strict();
export const accessUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]), modules: z.array(z.enum(APP_MODULES)).min(1),
}).strict();
export const accessGrantSchema = initialGrantSchema.extend({ organizationId: z.string().min(1).max(128) }).strict();
// Mesmo formato de `requestProfessionChange` e `decideProfessionChange`.
const professionChangeReason = z.string().trim().min(PROFESSION_CHANGE_REASON_LENGTH.min).max(PROFESSION_CHANGE_REASON_LENGTH.max);
export const professionChangeRequestSchema = z.object({
  professionId: z.enum(PROFESSION_IDS), reason: professionChangeReason,
}).strict();
export const professionChangeDecisionSchema = z.object({
  organizationId: z.string().min(1).max(128), decision: z.enum(["APPROVED", "REJECTED"]), reason: professionChangeReason,
}).strict();
// Mesmo formato de `createPlatformAdmin` (`functions/platform-admins.js`).
export const platformAdminRegistrationSchema = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
}).strict();
