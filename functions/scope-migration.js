/**
 * Migracao 5.5 do escopo por vinculo — planejamento puro.
 *
 * Este arquivo NAO toca o Firestore: recebe o que foi lido de UMA organizacao e
 * devolve o que precisa ser escrito, o que precisa de decisao humana e as
 * contagens antes/depois. Ficar puro e o que torna a migracao repetivel,
 * testavel e auditavel: rodar de novo sobre dados ja migrados devolve zero
 * escritas.
 *
 * Principios (AGENTS.md, regras 5 e 6, e sprint 5.3/5.4):
 *
 * - Nunca concede acesso por palpite. So se escreve escopo quando ha evidencia
 *   no proprio dado (perfil do proprio membro, agendamento, cliente ja
 *   associado, conversa, lancamento), ha UM unico profissional ativo na
 *   organizacao, ou uma decisao explicita foi registrada no arquivo de decisoes.
 * - Organizacao com dois ou mais profissionais ativos e ambigua: o que nao tem
 *   evidencia vai para revisao manual e continua fechado.
 * - `aiDecisions` e `auditLogs` sao append-only: nunca sao escritos aqui.
 * - Papeis nao mudam. OWNER e ADMIN ja tem escopo da organizacao; os demais
 *   mantem o papel e so ganham a lista explicita de vinculos.
 * - Nenhum campo extra e gravado nos documentos: as Security Rules de varias
 *   colecoes conferem `hasOnly` na atualizacao, e um campo de marcacao
 *   quebraria edicoes futuras. O registro da migracao vive na trilha da
 *   plataforma.
 */

export const SCOPE_MIGRATION_VERSION = "5.5";

const ORGANIZATION_WIDE_ROLES = new Set(["OWNER", "ADMIN"]);
const CLIENT_ASSIGNMENT_LIMIT = 50;

/** Colecoes que carregam `professionalId` e podem ser derivadas. */
export const DERIVED_COLLECTIONS = [
  "appointments",
  "conversations",
  "messages",
  "transactions",
  "recurringCharges",
  "paymentLinks",
  "paymentProofs",
  "receipts",
  "aiDecisionReviews",
  "notifications",
  "notificationDeliveries",
  "automationTasks",
  "calendarBusyBlocks",
];

/** Sem evidencia e sem profissional padrao, estes ficam da organizacao (nao bloqueiam). */
const MAY_STAY_ORGANIZATION_LEVEL = new Set(["notifications", "automationTasks"]);

const isId = (value) => typeof value === "string" && value.length > 0;

export function isOrganizationWideRole(role) {
  return ORGANIZATION_WIDE_ROLES.has(role);
}

/**
 * Membros ativos que ainda nao tem escopo resolvido. Base da trava do piloto:
 * `professionalIds` e opcional; quando informado, tambem conta como nao
 * resolvido o vinculo que aponta para perfil inexistente.
 */
export function unresolvedScopeMembers(members, professionalIds = null) {
  const known = professionalIds ? new Set(professionalIds) : null;
  return members.filter((member) => {
    if (member?.status !== "ACTIVE" || isOrganizationWideRole(member.role)) return false;
    const list = member.linkedProfessionalIds;
    if (!Array.isArray(list) || list.length === 0 || !list.every(isId)) return true;
    return known ? !list.every((professionalId) => known.has(professionalId)) : false;
  });
}

const emptyStat = () => ({ total: 0, scopedBefore: 0, toWrite: 0, manual: 0, organizationLevel: 0 });

/**
 * @param {object} input
 * @param {string} input.organizationId
 * @param {{id:string,path:string,data:object}[]} input.members
 * @param {{id:string,path:string,data:object}[]} input.professionals
 * @param {Record<string, {id:string,path:string,data:object,parentId?:string}[]>} input.docs
 * @param {object|null} [input.decisions] decisoes desta organizacao:
 *   `{ defaultProfessionalId?, members?: {uid: ids[]}, clients?: {clientId: ids[]} }`
 */
export function planScopeMigration({ organizationId, members, professionals, docs, decisions = null }) {
  const professionalIds = new Set(professionals.map((professional) => professional.id));
  const active = professionals.filter((professional) => professional.data.active !== false);
  const activeProfessionalIds = new Set(active.map((professional) => professional.id));
  const single = active.length === 1 ? active[0].id : null;
  const problems = [];
  const writes = [];
  const manual = [];
  const organizationLevel = [];
  const stats = {};
  const statOf = (name) => (stats[name] ??= emptyStat());
  const get = (name) => docs[name] ?? [];

  let fallback = single;
  let fallbackSource = "SINGLE_PROFESSIONAL";
  if (decisions?.defaultProfessionalId !== undefined) {
    if (activeProfessionalIds.has(decisions.defaultProfessionalId)) {
      fallback = decisions.defaultProfessionalId;
      fallbackSource = "DECISION_DEFAULT";
    } else if (professionalIds.has(decisions.defaultProfessionalId)) {
      problems.push({ code: "DECISION_INACTIVE_PROFESSIONAL", detail: "defaultProfessionalId" });
    } else {
      problems.push({ code: "DECISION_UNKNOWN_PROFESSIONAL", detail: "defaultProfessionalId" });
    }
  }

  const activeList = (list) =>
    Array.isArray(list) &&
    list.length > 0 &&
    list.length <= CLIENT_ASSIGNMENT_LIMIT &&
    list.every((value) => isId(value) && activeProfessionalIds.has(value)) &&
    new Set(list).size === list.length;
  const knownList = (list) =>
    Array.isArray(list) &&
    list.length > 0 &&
    list.length <= CLIENT_ASSIGNMENT_LIMIT &&
    list.every((value) => isId(value) && professionalIds.has(value)) &&
    new Set(list).size === list.length;
  const sameIds = (current, expected) =>
    Array.isArray(current) &&
    current.length === expected.length &&
    current.every((value) => expected.includes(value));
  const invalidListReason = (list, decision = false) => {
    if (decision) {
      return knownList(list)
        ? "DECISION_INACTIVE_PROFESSIONAL"
        : "DECISION_UNKNOWN_PROFESSIONAL";
    }
    return knownList(list) ? "INACTIVE_PROFESSIONAL_ID" : "UNKNOWN_PROFESSIONAL_ID";
  };

  const queueWrite = (collection, doc, patch, source) => {
    writes.push({ collection, id: doc.id, path: doc.path, patch, source });
    statOf(collection).toWrite += 1;
  };
  const queueManual = (collection, doc, reason, suggestion = null) => {
    manual.push({ collection, id: doc.id, reason, suggestion });
    statOf(collection).manual += 1;
  };

  // ------------------------------------------------------------- membros
  const membersBefore = unresolvedScopeMembers(
    members.map((member) => ({ ...member.data, id: member.id })),
    [...activeProfessionalIds],
  ).length;
  let membersResolved = 0;
  for (const member of members) {
    const stat = statOf("members");
    stat.total += 1;
    const data = member.data;
    if (data.status !== "ACTIVE" || isOrganizationWideRole(data.role)) {
      stat.scopedBefore += 1;
      continue;
    }
    const current = data.linkedProfessionalIds;
    const currentResolved = activeList(current);
    const decided = decisions?.members?.[member.id];
    if (decided !== undefined) {
      if (activeList(decided)) {
        if (sameIds(current, decided)) {
          stat.scopedBefore += 1;
        } else {
          queueWrite("members", member, { linkedProfessionalIds: decided }, "DECISION");
          if (!currentResolved) membersResolved += 1;
        }
      } else {
        queueManual("members", member, invalidListReason(decided, true));
      }
      continue;
    }
    if (Array.isArray(current) && current.length > 0) {
      if (currentResolved) {
        stat.scopedBefore += 1;
      } else {
        queueManual("members", member, invalidListReason(current));
      }
      continue;
    }
    const ownProfile = data.role === "PROFESSIONAL"
      ? professionals.find((professional) => professional.data.userId === member.id)
      : null;
    if (ownProfile && activeProfessionalIds.has(ownProfile.id)) {
      queueWrite("members", member, { linkedProfessionalIds: [ownProfile.id] }, "OWN_PROFILE");
      membersResolved += 1;
    } else if (ownProfile) {
      queueManual("members", member, "INACTIVE_OWN_PROFILE");
    } else if (fallback) {
      queueWrite("members", member, { linkedProfessionalIds: [fallback] }, fallbackSource);
      membersResolved += 1;
    } else {
      queueManual("members", member, "AMBIGUOUS_MEMBER_SCOPE");
    }
  }

  // ------------------------------------------------------------- clientes
  const clientScope = new Map();
  const evidenceByClient = new Map();
  for (const appointment of get("appointments")) {
    const { clientId, professionalId } = appointment.data;
    if (!isId(clientId) || !professionalIds.has(professionalId)) continue;
    const set = evidenceByClient.get(clientId) ?? new Set();
    set.add(professionalId);
    evidenceByClient.set(clientId, set);
  }
  for (const client of get("clients")) {
    const stat = statOf("clients");
    stat.total += 1;
    const decided = decisions?.clients?.[client.id];
    const current = client.data.assignedProfessionalIds;
    if (decided !== undefined) {
      if (activeList(decided)) {
        if (sameIds(current, decided)) {
          stat.scopedBefore += 1;
        } else {
          queueWrite("clients", client, { assignedProfessionalIds: decided }, "DECISION");
        }
        clientScope.set(client.id, decided);
      } else {
        queueManual("clients", client, invalidListReason(decided, true));
      }
      continue;
    }
    if (activeList(current)) {
      stat.scopedBefore += 1;
      clientScope.set(client.id, current);
    } else if (Array.isArray(current) && current.length > 0) {
      queueManual("clients", client, invalidListReason(current));
    } else if (fallback) {
      queueWrite("clients", client, { assignedProfessionalIds: [fallback] }, fallbackSource);
      clientScope.set(client.id, [fallback]);
    } else {
      queueManual("clients", client, "AMBIGUOUS_CLIENT_SCOPE", {
        professionalIdsFromAppointments: [...(evidenceByClient.get(client.id) ?? [])],
      });
    }
  }

  // ------------------------------------------ documentos com professionalId
  const resolved = Object.fromEntries(DERIVED_COLLECTIONS.map((name) => [name, new Map()]));
  const decisionScope = new Map();
  for (const decision of get("aiDecisions")) {
    const stat = statOf("aiDecisions");
    stat.total += 1;
    if (professionalIds.has(decision.data.professionalId)) {
      stat.scopedBefore += 1;
      decisionScope.set(decision.id, { professionalId: decision.data.professionalId, conversationId: decision.data.conversationId });
    } else {
      decisionScope.set(decision.id, { professionalId: null, conversationId: decision.data.conversationId });
    }
  }

  const clientSingle = (clientId) => {
    const list = clientScope.get(clientId);
    return list?.length === 1 ? list[0] : null;
  };
  const fromFallback = (clientId) => {
    if (!fallback) return null;
    const list = clientScope.get(clientId);
    return !list || list.includes(fallback) ? fallback : null;
  };
  const via = (...candidates) => {
    for (const [source, value] of candidates) if (isId(value)) return { professionalId: value, source };
    return null;
  };

  const derivations = {
    appointments: (d) => via(["FALLBACK", fromFallback(d.data.clientId)]),
    conversations: (d) => via(["CLIENT", clientSingle(d.data.clientId)], ["FALLBACK", fromFallback(d.data.clientId)]),
    messages: (d) => via(
      ["CONVERSATION", resolved.conversations.get(d.parentId ?? d.data.conversationId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fromFallback(d.data.clientId)],
    ),
    transactions: (d) => via(
      ["APPOINTMENT", resolved.appointments.get(d.data.appointmentId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fromFallback(d.data.clientId)],
    ),
    recurringCharges: (d) => via(["CLIENT", clientSingle(d.data.clientId)], ["FALLBACK", fromFallback(d.data.clientId)]),
    paymentLinks: (d) => via(
      ["TRANSACTION", resolved.transactions.get(d.data.transactionId ?? d.id)],
      ["FALLBACK", fallback],
    ),
    paymentProofs: (d) => via(
      ["TRANSACTION", resolved.transactions.get(d.data.transactionId)],
      ["RECURRING_CHARGE", resolved.recurringCharges.get(d.data.recurringChargeId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fromFallback(d.data.clientId)],
    ),
    receipts: (d) => via(
      ["TRANSACTION", resolved.transactions.get(d.data.transactionId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fromFallback(d.data.clientId)],
    ),
    aiDecisionReviews: (d) => {
      const decision = decisionScope.get(d.data.decisionId ?? d.id);
      return via(
        ["DECISION", decision?.professionalId],
        ["CONVERSATION", resolved.conversations.get(decision?.conversationId)],
        ["FALLBACK", fallback],
      );
    },
    notifications: (d) => {
      const decision = decisionScope.get(d.data.aiDecisionId);
      return via(
        ["DECISION", decision?.professionalId],
        ["CLIENT", clientSingle(d.data.clientId)],
        ["FALLBACK", fallback],
      );
    },
    notificationDeliveries: (d) => via(
      ["APPOINTMENT", resolved.appointments.get(d.data.appointmentId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fromFallback(d.data.clientId)],
    ),
    automationTasks: (d) => via(
      ["APPOINTMENT", resolved.appointments.get(d.data.appointmentId)],
      ["DELIVERY", resolved.notificationDeliveries.get(d.data.deliveryId)],
      ["CLIENT", clientSingle(d.data.clientId)],
      ["FALLBACK", fallback],
    ),
    // O id do documento E o profissional conectado.
    calendarBusyBlocks: (d) => via(["DOCUMENT_ID", professionalIds.has(d.id) ? d.id : null]),
  };

  for (const collection of DERIVED_COLLECTIONS) {
    const stat = statOf(collection);
    for (const doc of get(collection)) {
      stat.total += 1;
      const current = doc.data.professionalId;
      if (isId(current)) {
        if (professionalIds.has(current)) {
          stat.scopedBefore += 1;
          resolved[collection].set(doc.id, current);
        } else {
          queueManual(collection, doc, "UNKNOWN_PROFESSIONAL_ID");
        }
        continue;
      }
      const found = derivations[collection](doc);
      if (found) {
        queueWrite(collection, doc, { professionalId: found.professionalId }, found.source);
        resolved[collection].set(doc.id, found.professionalId);
      } else if (MAY_STAY_ORGANIZATION_LEVEL.has(collection)) {
        organizationLevel.push({ collection, id: doc.id });
        stat.organizationLevel += 1;
      } else {
        queueManual(collection, doc, "NO_EVIDENCE_FOR_SCOPE");
      }
    }
  }

  // Regras globais da IA (`professionalId == null`) sao intencionais.
  statOf("aiRules").total = get("aiRules").length;

  const membersAfter = Math.max(0, membersBefore - membersResolved);
  const blocking = manual.length > 0 || membersAfter > 0 || problems.length > 0;
  const status = blocking
    ? "NEEDS_REVIEW"
    : writes.length > 0
      ? "READY"
      : "CLEAN";

  return {
    organizationId,
    version: SCOPE_MIGRATION_VERSION,
    status,
    professionals: { total: professionals.length, active: active.length, single },
    counts: {
      unresolvedMembersBefore: membersBefore,
      unresolvedMembersAfter: membersAfter,
      collections: stats,
    },
    writes,
    manual,
    organizationLevel,
    problems,
  };
}

/** Aplica as escritas planejadas a uma copia dos documentos (usado nos testes e na conferencia). */
export function applyPlanInMemory(docs, members, plan) {
  const patches = new Map(plan.writes.map((write) => [write.path, write.patch]));
  const patch = (list) => list.map((doc) => (patches.has(doc.path) ? { ...doc, data: { ...doc.data, ...patches.get(doc.path) } } : doc));
  return {
    members: patch(members),
    docs: Object.fromEntries(Object.entries(docs).map(([name, list]) => [name, patch(list)])),
  };
}
