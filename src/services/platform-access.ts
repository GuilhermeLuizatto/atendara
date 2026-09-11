import { collection, doc, getDoc, orderBy, query } from "firebase/firestore";

import { getDb } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import { readPage } from "@/lib/firebase/paging";
import { paths } from "@/lib/firebase/paths";
import type { ID, Page, PageRequest, PlatformAccessGrant, PlatformAuditLog } from "@/types";

/**
 * Leitura das concessoes e da trilha da operadora.
 *
 * So leitura: conceder e revogar passam pelas callables (`AuthAdapter`), com
 * segundo fator e registro no servidor. As Security Rules decidem o alcance —
 * o titular le a propria concessao, a operadora le todas e a trilha.
 */
export interface PlatformAccessReader {
  /** `false` em modo demonstracao: concessao simulada nao tem trilha. */
  readonly available: boolean;
  accessGrant(organizationId: ID): Promise<PlatformAccessGrant | null>;
  /** Da concessao mais recente para a mais antiga. */
  allAccessGrants(request?: PageRequest): Promise<Page<PlatformAccessGrant>>;
  recentAuditLogs(request?: PageRequest): Promise<Page<PlatformAuditLog>>;
}

const GRANTS_PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 50;

const EMPTY_PAGE = { items: [], next: null };

class FirestorePlatformAccessReader implements PlatformAccessReader {
  readonly available = true;

  async accessGrant(organizationId: ID): Promise<PlatformAccessGrant | null> {
    const snapshot = await getDoc(doc(getDb(), paths.platformAccessGrant(organizationId)));
    return snapshot.exists() ? (snapshot.data() as PlatformAccessGrant) : null;
  }

  allAccessGrants(request: PageRequest = {}): Promise<Page<PlatformAccessGrant>> {
    return readPage(
      query(collection(getDb(), paths.platformAccessGrants()), orderBy("grantedAt", "desc")),
      request,
      GRANTS_PAGE_SIZE,
      (document) => document.data() as PlatformAccessGrant,
    );
  }

  recentAuditLogs(request: PageRequest = {}): Promise<Page<PlatformAuditLog>> {
    return readPage(
      query(collection(getDb(), paths.platformAuditLogs()), orderBy("createdAt", "desc")),
      request,
      AUDIT_PAGE_SIZE,
      (document) => document.data() as PlatformAuditLog,
    );
  }
}

class UnavailablePlatformAccessReader implements PlatformAccessReader {
  readonly available = false;
  async accessGrant(): Promise<PlatformAccessGrant | null> {
    return null;
  }
  async allAccessGrants(): Promise<Page<PlatformAccessGrant>> {
    return EMPTY_PAGE;
  }
  async recentAuditLogs(): Promise<Page<PlatformAuditLog>> {
    return EMPTY_PAGE;
  }
}

const reader: PlatformAccessReader = isDemoMode
  ? new UnavailablePlatformAccessReader()
  : new FirestorePlatformAccessReader();

export function platformAccessReader(): PlatformAccessReader {
  return reader;
}
