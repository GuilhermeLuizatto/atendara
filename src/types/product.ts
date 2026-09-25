import type { ID, ISODateString } from "./common";
import type { Role } from "./professional";

/** Controles separados que os planos futuros poderão conceder. */
export const PRODUCT_FEATURES = ["teams", "administrativeImport", "support"] as const;
export type ProductFeature = (typeof PRODUCT_FEATURES)[number];

export const MEMBER_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type MemberRequestStatus = (typeof MEMBER_REQUEST_STATUSES)[number];

export interface MemberRequest {
  id: ID;
  organizationId: ID;
  requestedBy: ID;
  displayName: string;
  email: string;
  role: Exclude<Role, "OWNER" | "ADMIN">;
  linkedProfessionalIds: ID[];
  status: MemberRequestStatus;
  decidedBy: ID | null;
  decisionReason: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const MEMBER_INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "REVOKED",
  "DELIVERY_FAILED",
] as const;
export type MemberInvitationStatus = (typeof MEMBER_INVITATION_STATUSES)[number];

export interface MemberInvitation {
  id: ID;
  organizationId: ID;
  email: string;
  displayName: string;
  role: Exclude<Role, "OWNER">;
  linkedProfessionalIds: ID[];
  status: MemberInvitationStatus;
  invitedBy: ID;
  expiresAt: ISODateString;
  acceptedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const IMPORT_ENTITY_TYPES = [
  "PROFESSIONALS",
  "CLIENTS",
  "APPOINTMENTS",
  "TRANSACTIONS",
] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export interface ImportMapping {
  id: ID;
  organizationId: ID;
  name: string;
  entityType: ImportEntityType;
  columns: Record<string, string>;
  createdBy: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const SUPPORT_CATEGORIES = [
  "TECHNICAL_PROBLEM",
  "HOW_TO",
  "BILLING",
  "ACCOUNT_ACCESS",
  "SUGGESTION",
  "PRIVACY",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_REPORTED_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type SupportReportedSeverity = (typeof SUPPORT_REPORTED_SEVERITIES)[number];

export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_TICKET_STATUSES = [
  "OPEN",
  "WAITING_SUPPORT",
  "WAITING_CUSTOMER",
  "RESOLVED",
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export interface SupportAttachment {
  id: ID;
  storagePath: string;
  name: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  size: number;
}

export interface SupportTicket {
  id: ID;
  organizationId: ID;
  organizationName: string;
  openedBy: ID;
  openedByName: string;
  openedByEmail: string;
  category: SupportCategory;
  reportedSeverity: SupportReportedSeverity;
  priority: SupportPriority | null;
  subject: string;
  status: SupportTicketStatus;
  lastMessageAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface SupportMessage {
  id: ID;
  ticketId: ID;
  organizationId: ID;
  authorId: ID;
  authorName: string;
  authorKind: "MEMBER" | "SUPPORT";
  body: string;
  attachments: SupportAttachment[];
  createdAt: ISODateString;
}
