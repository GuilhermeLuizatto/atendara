import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { isImportDuplicate } from "./administrative-import-policy.js";
import { paths } from "./generated/paths.js";
import { IMPORT_ENTITY_TYPES } from "./generated/types-product.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit } from "./rate-limit.js";
import { tenantActor, tenantAudit } from "./tenant-auth.js";

const db = () => getFirestore();
const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas") };
const MAX_ROWS = 350;
const id = z.string().uuid();
const nullableText = (max) => z.string().trim().max(max).nullable();
const professional = z.object({
  displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(),
  phone: nullableText(30), profession: z.string().trim().min(1).max(80), licenseNumber: nullableText(60),
  specialties: z.array(z.string().trim().min(1).max(80)).max(20), active: z.boolean(),
}).strict();
const client = z.object({
  fullName: z.string().trim().min(2).max(120), preferredName: nullableText(80), email: z.email().trim().toLowerCase().nullable(),
  phone: nullableText(30), status: z.enum(["LEAD", "ACTIVE", "INACTIVE", "ON_HOLD", "DISCHARGED"]),
  preferredModality: z.enum(["IN_PERSON", "ONLINE", "HOME_VISIT"]), assignedProfessionalId: id.nullable(),
  acquisitionChannel: z.enum(["REFERRAL", "INSTAGRAM", "GOOGLE", "WHATSAPP", "WEBSITE", "OTHER"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30), administrativeNotes: nullableText(500),
}).strict();
const appointment = z.object({
  clientId: id, professionalId: id, startsAt: z.iso.datetime(), durationMinutes: z.number().int().min(5).max(1_440),
  modality: z.enum(["IN_PERSON", "ONLINE", "HOME_VISIT"]), status: z.enum(["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]),
  priceInCents: z.number().int().min(0).max(100_000_000), administrativeNotes: nullableText(500),
}).strict();
const transaction = z.object({
  type: z.enum(["INCOME", "EXPENSE"]), clientId: id.nullable(), professionalId: id.nullable(), appointmentId: id.nullable(),
  description: z.string().trim().min(2).max(160), amountInCents: z.number().int().positive().max(100_000_000),
  status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED", "REFUNDED"]),
  method: z.enum(["PIX", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "CASH", "INSURANCE", "OTHER"]).nullable(),
  dueDate: z.iso.datetime(),
}).strict();
const dataByEntity = { PROFESSIONALS: professional, CLIENTS: client, APPOINTMENTS: appointment, TRANSACTIONS: transaction };
const row = z.object({ entityType: z.enum(IMPORT_ENTITY_TYPES), action: z.enum(["CREATE", "UPDATE"]), targetId: id, data: z.record(z.string(), z.unknown()) }).strict();
const importSchema = z.object({ rows: z.array(row).min(1).max(MAX_ROWS) }).strict();
const mappingSchema = z.object({ id: id.optional(), name: z.string().trim().min(3).max(80), entityType: z.enum(IMPORT_ENTITY_TYPES), columns: z.record(z.string().min(1).max(120), z.string().min(1).max(120)) }).strict();
const emptySchema = z.object({}).strict();

function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function documentPath(organizationId, entityType, targetId) {
  const collection = { PROFESSIONALS: "professionals", CLIENTS: "clients", APPOINTMENTS: "appointments", TRANSACTIONS: "transactions" }[entityType];
  return paths.document(organizationId, collection, targetId);
}

async function existingDuplicates(organizationId, item) {
  const collection = { PROFESSIONALS: "professionals", CLIENTS: "clients", APPOINTMENTS: "appointments", TRANSACTIONS: "transactions" }[item.entityType];
  const reference = db().collection(paths.collection(organizationId, collection));
  let documents;
  if (item.entityType === "PROFESSIONALS") {
    documents = (await reference.where("email", "==", item.data.email).get()).docs;
  } else if (item.entityType === "CLIENTS") {
    const snapshots = await Promise.all([
      item.data.email ? reference.where("email", "==", item.data.email).get() : null,
      item.data.phone ? reference.where("phone", "==", item.data.phone).get() : null,
    ]);
    documents = [...new Map(snapshots.flatMap((snapshot) => snapshot?.docs ?? []).map((document) => [document.id, document])).values()];
  } else if (item.entityType === "APPOINTMENTS") {
    documents = (await reference.where("startsAt", "==", Timestamp.fromDate(new Date(item.data.startsAt))).get()).docs;
  } else {
    documents = (await reference.where("dueDate", "==", Timestamp.fromDate(new Date(item.data.dueDate))).get()).docs;
  }
  return documents
    .filter((document) => isImportDuplicate(item.entityType, item.data, fromStored(collection, document.id, document.data())))
    .map((document) => document.id);
}

async function mapWithConcurrency(items, concurrency, action) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await action(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export const listImportMappings = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "import:manage");
  parse(emptySchema, request.data);
  await consumeRateLimit(actor.userId, "administrativeImportRead");
  const snapshot = await db().collection(paths.collection(actor.organizationId, "importMappings")).orderBy("updatedAt", "desc").limit(100).get();
  return { mappings: snapshot.docs.map((document) => fromStored("importMappings", document.id, document.data())) };
});

export const saveImportMapping = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "import:manage");
  await consumeRateLimit(actor.userId, "administrativeImportWrite");
  const input = parse(mappingSchema, request.data);
  const mappingId = input.id ?? randomUUID();
  const ref = db().doc(paths.document(actor.organizationId, "importMappings", mappingId));
  const previous = await ref.get();
  const at = new Date().toISOString();
  const record = {
    id: mappingId, organizationId: actor.organizationId, name: input.name,
    entityType: input.entityType, columns: input.columns, createdBy: previous.data()?.createdBy ?? actor.userId,
    createdAt: previous.exists ? fromStored("importMappings", mappingId, previous.data()).createdAt : at,
    updatedAt: at, updatedBy: actor.userId,
  };
  await ref.set(toStored("importMappings", record));
  return { mapping: record };
});

export const commitAdministrativeImport = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "import:manage");
  await consumeRateLimit(actor.userId, "administrativeImportWrite");
  const input = parse(importSchema, request.data);
  const rows = input.rows.map((item, index) => {
    const parsed = dataByEntity[item.entityType].safeParse(item.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", `A linha ${index + 1} não corresponde ao formato do Atendara.`);
    return { ...item, data: parsed.data };
  });
  const duplicateTargets = rows.map((item) => `${item.entityType}:${item.targetId}`);
  if (new Set(duplicateTargets).size !== duplicateTargets.length) throw new HttpsError("invalid-argument", "Um registro aparece mais de uma vez na mesma confirmação.");
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (rows[left].entityType === rows[right].entityType && isImportDuplicate(rows[left].entityType, rows[left].data, rows[right].data)) {
        throw new HttpsError("invalid-argument", `As linhas ${left + 1} e ${right + 1} são duplicadas entre si. Decida e envie somente uma delas.`);
      }
    }
  }
  const refs = rows.map((item) => db().doc(documentPath(actor.organizationId, item.entityType, item.targetId)));
  const snapshots = await db().getAll(...refs);
  rows.forEach((item, index) => {
    if (item.action === "CREATE" && snapshots[index].exists) throw new HttpsError("already-exists", `A linha ${index + 1} passou a duplicar um registro. Revise a prévia.`);
    if (item.action === "UPDATE" && !snapshots[index].exists) throw new HttpsError("failed-precondition", `O registro da linha ${index + 1} não existe mais. Revise a prévia.`);
  });
  const matches = await mapWithConcurrency(rows, 20, (item) => existingDuplicates(actor.organizationId, item));
  rows.forEach((item, index) => {
    const otherIds = matches[index].filter((matchId) => matchId !== item.targetId);
    if (item.action === "CREATE" && matches[index].length) {
      throw new HttpsError("already-exists", `A linha ${index + 1} é duplicada. Volte à prévia e escolha ignorar ou atualizar.`);
    }
    if (item.action === "UPDATE" && otherIds.length) {
      throw new HttpsError("already-exists", `A linha ${index + 1} também coincide com outro registro. Revise a decisão.`);
    }
  });

  const plannedCreates = new Set(rows.filter((item) => item.action === "CREATE").map((item) => `${item.entityType}:${item.targetId}`));
  const existing = new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.ref.path, snapshot.data()]));
  const referenced = [];
  for (const item of rows) {
    if (item.entityType === "CLIENTS" && item.data.assignedProfessionalId) referenced.push(["PROFESSIONALS", item.data.assignedProfessionalId]);
    if (item.entityType === "APPOINTMENTS") referenced.push(["CLIENTS", item.data.clientId], ["PROFESSIONALS", item.data.professionalId]);
    if (item.entityType === "TRANSACTIONS") {
      if (item.data.clientId) referenced.push(["CLIENTS", item.data.clientId]);
      if (item.data.professionalId) referenced.push(["PROFESSIONALS", item.data.professionalId]);
      if (item.data.appointmentId) referenced.push(["APPOINTMENTS", item.data.appointmentId]);
    }
  }
  const missingRefs = [];
  for (const [entityType, targetId] of referenced) {
    if (plannedCreates.has(`${entityType}:${targetId}`)) continue;
    const path = documentPath(actor.organizationId, entityType, targetId);
    if (existing.has(path)) continue;
    const snapshot = await db().doc(path).get();
    if (!snapshot.exists) missingRefs.push(`${entityType}:${targetId}`);
    else existing.set(path, snapshot.data());
  }
  if (missingRefs.length) throw new HttpsError("failed-precondition", "Há linhas que apontam para cliente, profissional ou atendimento inexistente.");

  const at = new Date().toISOString();
  const createdNames = new Map();
  for (const item of rows) {
    if (item.entityType === "PROFESSIONALS") createdNames.set(`PROFESSIONALS:${item.targetId}`, item.data.displayName);
    if (item.entityType === "CLIENTS") createdNames.set(`CLIENTS:${item.targetId}`, item.data.fullName);
  }
  const nameOf = (entityType, targetId, field) => createdNames.get(`${entityType}:${targetId}`) ?? existing.get(documentPath(actor.organizationId, entityType, targetId))?.[field] ?? null;
  const batch = db().batch();
  for (const [index, item] of rows.entries()) {
    const previous = snapshots[index].data() ?? {};
    const common = { organizationId: actor.organizationId, updatedAt: at, updatedBy: actor.userId };
    let document = { ...item.data, ...common };
    if (item.action === "CREATE") document = { id: item.targetId, createdAt: at, createdBy: actor.userId, ...document };
    if (item.entityType === "PROFESSIONALS" && item.action === "CREATE") document = { userId: null, avatarUrl: null, ...document };
    if (item.entityType === "CLIENTS" && item.action === "CREATE") document = { appointmentNotificationsEnabled: false, notificationConsent: null, lastAppointmentAt: null, nextAppointmentAt: null, totalAppointments: 0, outstandingBalanceInCents: 0, ...document };
    if (item.entityType === "APPOINTMENTS") document = {
      ...(item.action === "CREATE" ? {
        serviceId: null, serviceName: null, depositInCents: null, depositOutcome: null, visitAddress: null,
        travelFeeInCents: null, origin: "IMPORTED", externalCalendar: null,
        cancellationReason: null, rescheduledFromId: null,
      } : {}),
      confirmedAt: item.data.status === "CONFIRMED" ? (previous.confirmedAt ?? at) : null,
      cancelledAt: item.data.status === "CANCELLED" ? (previous.cancelledAt ?? at) : null,
      clientName: nameOf("CLIENTS", item.data.clientId, "fullName"),
      professionalName: nameOf("PROFESSIONALS", item.data.professionalId, "displayName"),
      endsAt: addMinutes(item.data.startsAt, item.data.durationMinutes), ...document,
    };
    if (item.entityType === "TRANSACTIONS") document = {
      clientName: item.data.clientId ? nameOf("CLIENTS", item.data.clientId, "fullName") : null,
      ...(item.action === "CREATE" ? { appointmentPart: null, gateway: null } : {}),
      paidAt: item.data.status === "PAID" ? (previous.paidAt ?? at) : null, ...document,
    };
    const collection = { PROFESSIONALS: "professionals", CLIENTS: "clients", APPOINTMENTS: "appointments", TRANSACTIONS: "transactions" }[item.entityType];
    batch.set(refs[index], toStored(collection, document), { merge: item.action === "UPDATE" });
  }
  const audit = tenantAudit({ organizationId: actor.organizationId, actorId: actor.userId, action: "CREATE", resourceType: "administrativeImport", resourceId: randomUUID(), summary: "Importação administrativa confirmada.", metadata: { rows: rows.length } });
  batch.create(db().doc(paths.document(actor.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  await batch.commit();
  return { imported: rows.length };
});

export { MAX_ROWS as ADMINISTRATIVE_IMPORT_MAX_ROWS };
