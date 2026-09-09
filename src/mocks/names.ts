import type { ProfessionId } from "@/types";

/** Nomes ficticios. Nenhum dado real e usado no projeto. */

export const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Camila",
  "Daniel",
  "Eduarda",
  "Felipe",
  "Gabriela",
  "Henrique",
  "Isabela",
  "Joao",
  "Larissa",
  "Marcelo",
  "Natalia",
  "Otavio",
  "Patricia",
  "Rafael",
  "Sofia",
  "Thiago",
  "Vanessa",
  "William",
  "Beatriz",
  "Caio",
  "Debora",
  "Everton",
] as const;

export const LAST_NAMES = [
  "Almeida",
  "Barbosa",
  "Cardoso",
  "Dias",
  "Esteves",
  "Ferreira",
  "Gomes",
  "Henriques",
  "Ibrahim",
  "Justino",
  "Lima",
  "Moraes",
  "Nogueira",
  "Oliveira",
  "Pereira",
  "Queiroz",
  "Ramos",
  "Santos",
  "Teixeira",
  "Vieira",
] as const;

/** Nome ficticio da organizacao por profissao. */
export const ORGANIZATION_NAMES: Record<ProfessionId, string> = {
  PSYCHOLOGIST: "Consultorio Nucleo",
  PSYCHIATRIST: "Instituto Meridiano",
  DOCTOR: "Clinica Vitalis",
  DENTIST: "Odonto Aurora",
  NUTRITIONIST: "Espaco Raiz Nutricao",
  PHYSIOTHERAPIST: "Movimento Fisioterapia",
  THERAPIST: "Casa Serena",
  PERSONAL_TRAINER: "Studio Impulso",
};

/** Titular ficticio da organizacao por profissao. */
export const OWNER_NAMES: Record<ProfessionId, string> = {
  PSYCHOLOGIST: "Helena Prado",
  PSYCHIATRIST: "Ricardo Bastos",
  DOCTOR: "Mariana Coelho",
  DENTIST: "Leonardo Vasques",
  NUTRITIONIST: "Juliana Amaral",
  PHYSIOTHERAPIST: "Andre Salgado",
  THERAPIST: "Clarice Monteiro",
  PERSONAL_TRAINER: "Diego Fontes",
};

/** Registro profissional ficticio, no formato do conselho de cada profissao. */
export const LICENSE_PREFIX: Record<ProfessionId, string> = {
  PSYCHOLOGIST: "CRP",
  PSYCHIATRIST: "CRM",
  DOCTOR: "CRM",
  DENTIST: "CRO",
  NUTRITIONIST: "CRN",
  PHYSIOTHERAPIST: "CREFITO",
  THERAPIST: "REG",
  PERSONAL_TRAINER: "CREF",
};

export const SPECIALTIES: Record<ProfessionId, string[]> = {
  PSYCHOLOGIST: ["Terapia cognitivo-comportamental", "Ansiedade", "Casal"],
  PSYCHIATRIST: ["Transtornos de humor", "Ansiedade", "Sono"],
  DOCTOR: ["Clinica geral", "Check-up", "Medicina preventiva"],
  DENTIST: ["Clinica geral", "Estetica", "Ortodontia"],
  NUTRITIONIST: ["Emagrecimento", "Nutricao esportiva", "Comportamental"],
  PHYSIOTHERAPIST: ["Ortopedica", "Pos-operatorio", "RPG"],
  THERAPIST: ["Integrativa", "Mindfulness", "Florais"],
  PERSONAL_TRAINER: ["Hipertrofia", "Emagrecimento", "Condicionamento"],
};
