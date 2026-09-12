import {
  FIRST_NAMES,
  LAST_NAMES,
  LICENSE_PREFIX,
  OWNER_NAMES,
  SPECIALTIES,
} from "@/mocks/names";
import type {
  AcquisitionChannel,
  Client,
  ClientStatus,
  Professional,
} from "@/types";

import { stamp, type GeneratorContext } from "./context";

const CLIENT_COUNT = 18;

/** Distribuicao propositalmente desigual: uma base real nao e uniforme. */
const STATUS_WEIGHTS: [ClientStatus, number][] = [
  ["ACTIVE", 11],
  ["LEAD", 3],
  ["ON_HOLD", 2],
  ["INACTIVE", 1],
  ["DISCHARGED", 1],
];

const CHANNELS: AcquisitionChannel[] = [
  "REFERRAL",
  "INSTAGRAM",
  "GOOGLE",
  "WHATSAPP",
  "WEBSITE",
];

const TAG_POOL = ["semanal", "quinzenal", "manhã", "noite", "retorno"];

/** Os nomes ficticios sao escritos sem acento, entao basta normalizar caixa. */
function slugifyEmail(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, ".");
}

function weightedStatuses(): ClientStatus[] {
  return STATUS_WEIGHTS.flatMap(([status, weight]) =>
    Array.from({ length: weight }, () => status),
  );
}

export function buildProfessionals(ctx: GeneratorContext): Professional[] {
  const { rng, profession, organizationId, now } = ctx;
  const ownerName = OWNER_NAMES[profession.id];
  const license = LICENSE_PREFIX[profession.id];

  const owner: Professional = {
    id: "prof-owner",
    organizationId,
    ...stamp(now),
    userId: "demo-user",
    displayName: ownerName,
    email: `${slugifyEmail(ownerName)}@exemplo.com.br`,
    phone: "11987650001",
    profession: profession.id,
    licenseNumber: `${license} ${rng.int(10, 99)}/${rng.int(10000, 99999)}`,
    specialties: SPECIALTIES[profession.id].slice(0, 2),
    avatarUrl: null,
    active: true,
  };

  // Organizacoes de um profissional so existem; o segundo membro demonstra que
  // o mesmo modelo suporta equipe sem estrutura de dados diferente.
  const colleagueName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  const colleague: Professional = {
    id: "prof-colleague",
    organizationId,
    ...stamp(now),
    userId: null,
    displayName: colleagueName,
    email: `${slugifyEmail(colleagueName)}@exemplo.com.br`,
    phone: "11987650002",
    profession: profession.id,
    licenseNumber: `${license} ${rng.int(10, 99)}/${rng.int(10000, 99999)}`,
    specialties: SPECIALTIES[profession.id].slice(1, 3),
    avatarUrl: null,
    active: true,
  };

  return [owner, colleague];
}

export function buildClients(
  ctx: GeneratorContext,
  professionals: Professional[],
): Client[] {
  const { rng, profession, organizationId, now } = ctx;
  const statuses = weightedStatuses();
  const usedNames = new Set<string>();
  const clients: Client[] = [];

  for (let index = 0; index < CLIENT_COUNT; index += 1) {
    let fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    let attempts = 0;
    while (usedNames.has(fullName) && attempts < 20) {
      fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      attempts += 1;
    }
    usedNames.add(fullName);

    clients.push({
      id: `client-${index + 1}`,
      organizationId,
      ...stamp(now),
      fullName,
      preferredName: fullName.split(" ")[0],
      email: `${slugifyEmail(fullName)}@exemplo.com`,
      phone: `1198${rng.int(1000000, 9999999)}`,
      status: statuses[index % statuses.length],
      preferredModality: rng.pick(profession.modalities),
      assignedProfessionalId: rng.bool(0.75)
        ? professionals[0].id
        : professionals[1].id,
      acquisitionChannel: rng.pick(CHANNELS),
      tags: rng.bool(0.35) ? rng.sample(TAG_POOL, 1) : [],
      // Preenchidos depois que a agenda e gerada.
      lastAppointmentAt: null,
      nextAppointmentAt: null,
      administrativeNotes: rng.bool(0.25)
        ? "Prefere horários no fim da tarde."
        : null,
      totalAppointments: 0,
      outstandingBalanceInCents: 0,
    });
  }

  return clients;
}
