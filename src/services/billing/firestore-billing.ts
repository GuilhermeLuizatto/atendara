import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { getDb, getFirebaseApp } from "@/lib/firebase/client";
import { readPage } from "@/lib/firebase/paging";
import { paths } from "@/lib/firebase/paths";
import type {
  ID,
  Page,
  PageRequest,
  PlatformGatewayEvent,
  PlatformInvoice,
  PlatformSubscription,
} from "@/types";

import type { PlatformBillingClient } from "./types";

const REGION = "southamerica-east1";

/** Pagina das listagens da operadora. */
const ADMIN_PAGE_SIZE = 50;
/** O assinante ve os ultimos tres anos de faturas mensais. */
const INVOICE_PAGE_SIZE = 36;

function callable<Input, Output>(name: string) {
  return httpsCallable<Input, Output>(
    getFunctions(getFirebaseApp(), REGION),
    name,
  );
}

/**
 * Leitura direta do Firestore, com as Security Rules decidindo o alcance.
 *
 * O filtro por `organizationId` nas faturas nao e conveniencia de interface: e
 * o que torna a consulta aprovavel. Sem ele o Firestore nao consegue provar que
 * todo documento retornado passa na regra e recusa a consulta inteira — o mesmo
 * mecanismo do `collectionGroup` de mensagens.
 */
export class FirestorePlatformBillingClient implements PlatformBillingClient {
  readonly available = true;

  async subscription(organizationId: ID): Promise<PlatformSubscription | null> {
    const snapshot = await getDoc(
      doc(getDb(), paths.platformSubscription(organizationId)),
    );
    return snapshot.exists()
      ? (snapshot.data() as PlatformSubscription)
      : null;
  }

  async invoices(organizationId: ID): Promise<PlatformInvoice[]> {
    const result = await getDocs(
      query(
        collection(getDb(), paths.platformInvoices()),
        where("organizationId", "==", organizationId),
        orderBy("issuedAt", "desc"),
        limit(INVOICE_PAGE_SIZE),
      ),
    );
    return result.docs.map((document) => document.data() as PlatformInvoice);
  }

  async startCheckout(planId: ID): Promise<string> {
    const result = await callable<{ planId: ID }, { url: string }>(
      "createSubscriptionCheckout",
    )({ planId });
    return result.data.url;
  }

  async openPortal(): Promise<string> {
    const result = await callable<Record<string, never>, { url: string }>(
      "openBillingPortal",
    )({});
    return result.data.url;
  }

  async requestCancellation(): Promise<void> {
    await callable<Record<string, never>, { ok: boolean }>(
      "cancelPlatformSubscription",
    )({});
  }

  allSubscriptions(request: PageRequest = {}): Promise<Page<PlatformSubscription>> {
    // O id do documento e o `organizationId`: ordem estavel, e presente em todos.
    return readPage(
      query(collection(getDb(), paths.platformSubscriptions()), orderBy(documentId())),
      request,
      ADMIN_PAGE_SIZE,
      (document) => document.data() as PlatformSubscription,
    );
  }

  allInvoices(request: PageRequest = {}): Promise<Page<PlatformInvoice>> {
    return readPage(
      query(collection(getDb(), paths.platformInvoices()), orderBy("issuedAt", "desc")),
      request,
      ADMIN_PAGE_SIZE,
      (document) => document.data() as PlatformInvoice,
    );
  }

  recentGatewayEvents(request: PageRequest = {}): Promise<Page<PlatformGatewayEvent>> {
    return readPage(
      query(collection(getDb(), paths.platformGatewayEvents()), orderBy("receivedAt", "desc")),
      request,
      ADMIN_PAGE_SIZE,
      (document) => document.data() as PlatformGatewayEvent,
    );
  }
}
