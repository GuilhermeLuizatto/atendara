import { z } from "zod";
import { PROFESSION_IDS } from "@/types";
import { APP_MODULES } from "@/types/access";

export const registrationSchema = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
  professionId: z.enum(PROFESSION_IDS), modules: z.array(z.enum(APP_MODULES)).min(1),
  accessUntil: z.iso.datetime(),
});
export const accessUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]), subscriptionStatus: z.enum(["ACTIVE", "PENDING", "CANCELLED"]),
  accessUntil: z.iso.datetime().nullable(), modules: z.array(z.enum(APP_MODULES)).min(1),
});
