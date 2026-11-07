import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import type {
  ImportEntityType,
  ImportMapping,
  MemberInvitation,
  MemberRequest,
  Membership,
  Professional,
  Role,
  SupportAttachment,
  SupportCategory,
  SupportMessage,
  SupportPriority,
  SupportReportedSeverity,
  SupportTicket,
  SupportTicketStatus,
} from "@/types";

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  if (isDemoMode) throw new Error("Esta operação exige uma conta conectada ao Atendara.");
  try {
    return (await httpsCallable<Input, Output>(getFirebaseFunctions(), name, { timeout: 60_000 })(input)).data;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/ \[\d{3}\]$/, "") : "";
    throw new Error(message || "Não foi possível concluir a operação.");
  }
}

export interface TeamMemberView extends Membership {
  account: { displayName: string; email: string } | null;
}

export interface TeamView {
  members: TeamMemberView[];
  professionals: Professional[];
  requests: MemberRequest[];
  invitations: MemberInvitation[];
}

export interface TeamInviteInput {
  displayName: string;
  email: string;
  role: Extract<Role, "PROFESSIONAL" | "ASSISTANT">;
  linkedProfessionalIds: string[];
}

export interface PlatformTeamRequestView extends MemberRequest {
  organizationName: string;
}

export interface PlatformTeamMemberView extends TeamMemberView {
  organizationName: string;
  ownerId: string | null;
  isOrganizationHolder: boolean;
}

export interface PlatformTeamAdministrationView {
  requests: PlatformTeamRequestView[];
  members: PlatformTeamMemberView[];
}

export interface ImportCommitRow {
  entityType: ImportEntityType;
  action: "CREATE" | "UPDATE";
  targetId: string;
  data: Record<string, unknown>;
}

export interface SupportThread {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

function blobToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export const phaseFiveService = {
  team: {
    list: () => call<Record<string, never>, TeamView>("listTeam", {}),
    request: (input: TeamInviteInput) => call("requestTeamMember", input),
    inspectInvitation: (token: string) => call<{ token: string }, { email: string; displayName: string; role: Role; organizationName: string; professions: string[] }>("inspectTeamInvitation", { token }),
    acceptInvitation: (input: { token: string; password: string; profession?: string; phone?: string | null; licenseNumber?: string | null; specialties?: string[] }) => call("acceptTeamInvitation", input),
  },
  platformTeam: {
    list: () => call<Record<string, never>, PlatformTeamAdministrationView>("listPlatformTeamAdministration", {}),
    decide: (organizationId: string, requestId: string, decision: "APPROVED" | "REJECTED", reason: string) =>
      call("decidePlatformTeamRequest", { organizationId, requestId, decision, reason }),
    setStatus: (organizationId: string, memberId: string, status: "ACTIVE" | "SUSPENDED", reason: string) =>
      call("setPlatformTeamMemberStatus", { organizationId, memberId, status, reason }),
    remove: (organizationId: string, memberId: string, reason: string) =>
      call("removePlatformTeamMember", { organizationId, memberId, reason }),
  },
  imports: {
    mappings: () => call<Record<string, never>, { mappings: ImportMapping[] }>("listImportMappings", {}),
    saveMapping: (input: { id?: string; name: string; entityType: ImportEntityType; columns: Record<string, string> }) => call<typeof input, { mapping: ImportMapping }>("saveImportMapping", input),
    commit: (rows: ImportCommitRow[]) => call<{ rows: ImportCommitRow[] }, { imported: number }>("commitAdministrativeImport", { rows }),
  },
  support: {
    list: () => call<Record<string, never>, { tickets: SupportTicket[] }>("listSupportTickets", {}),
    thread: (ticketId: string) => call<{ ticketId: string }, SupportThread>("getSupportThread", { ticketId }),
    create: (input: { ticketId: string; messageId: string; category: SupportCategory; reportedSeverity: SupportReportedSeverity; subject: string; body: string; attachments: SupportAttachment[] }) => call<typeof input, { ticketId: string }>("createSupportTicket", input),
    reply: (input: { ticketId: string; messageId: string; body: string; attachments: SupportAttachment[] }) => call<typeof input, { ok: true }>("replySupportTicket", input),
    upload: async (ticketId: string, messageId: string, file: File): Promise<SupportAttachment> => {
      if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Use arquivos de até 5 MB.");
      return call("uploadSupportAttachment", { ticketId, messageId, attachmentId: crypto.randomUUID(), name: file.name, file: await blobToBase64(file) });
    },
    update: (ticketId: string, patch: { priority?: SupportPriority | null; status?: SupportTicketStatus }) => call("updateSupportTicket", { ticketId, ...patch }),
  },
  branding: {
    update: (branding: { logoUrl: string | null; logoStoragePath: string | null; logoContentType: "image/png" | "image/jpeg" | "image/webp" | null }) => call("updateOrganizationBranding", branding),
    upload: async (file: Blob) => call<{ file: string }, { branding: { logoUrl: string; logoStoragePath: string; logoContentType: "image/png" | "image/jpeg" | "image/webp" } }>("uploadBrandingLogo", { file: await blobToBase64(file) }),
  },
};
