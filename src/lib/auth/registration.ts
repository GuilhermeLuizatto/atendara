import { z } from "zod";
import { ACCESS_GRANT_REASON_LENGTH } from "@/config/platform";
import { ACCESS_GRANT_KINDS, PROFESSION_IDS } from "@/types";
import { APP_MODULES } from "@/types/access";

// Mesmo formato que as callables aceitam (`functions/index.js`, `platform.js`).
// Situacao da mensalidade e validade nao aparecem em cadastro nem em alteracao.
export const initialGrantSchema = z.object({
  kind: z.enum(ACCESS_GRANT_KINDS), until: z.iso.datetime(),
  reason: z.string().trim().min(ACCESS_GRANT_REASON_LENGTH.min).max(ACCESS_GRANT_REASON_LENGTH.max),
}).strict();
export const registrationSchema = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
  professionId: z.enum(PROFESSION_IDS), modules: z.array(z.enum(APP_MODULES)).min(1),
  initialGrant: initialGrantSchema.optional(),
}).strict();
export const accessUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]), modules: z.array(z.enum(APP_MODULES)).min(1),
}).strict();
export const accessGrantSchema = initialGrantSchema.extend({ organizationId: z.string().min(1).max(128) }).strict();
