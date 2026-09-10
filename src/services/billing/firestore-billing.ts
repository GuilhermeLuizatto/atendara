import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { getDb, getFirebaseApp } from "@/lib/firebase/client";
import { paths } from "@/lib/firebase/paths";
import type {
  ID,
  PlatformGatewayEvent,
  PlatformInvoice,
  PlatformSubscription,
} from "@/types";

import type { PlatformBillingClient } from "./types";

const REGION = "southamerica-east1";

/** Teto das listagens administrativas. Paginacao entra quando a base pedir. */
const ADMIN_PAGE_SIZE = 200;
const INVOICE_PAGE_SIZE = 36;
const EVENT_PAGE_SIZE = 50;

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

  async allSubscriptions(): Promise<PlatformSubscription[]> {
    const result = await getDocs(
      query(
        collection(getDb(), paths.platformSubscriptions()),
        limit(ADMIN_PAGE_SIZE),
      ),
    );
    return result.docs.map(
      (document) => document.data() as PlatformSubscription,
    );
  }

  async allInvoices(): Promise<PlatformInvoice[]> {
    const result = await getDocs(
      query(
        collection(getDb(), paths.platformInvoices()),
        orderBy("issuedAt", "desc"),
        limit(ADMIN_PAGE_SIZE),
      ),
    );
    return result.docs.map((document) => document.data() as PlatformInvoice);
  }

  async recentGatewayEvents(): Promise<PlatformGatewayEvent[]> {
    const result = await getDocs(
      query(
        collection(getDb(), paths.platformGatewayEvents()),
        orderBy("receivedAt", "desc"),
        limit(EVENT_PAGE_SIZE),
      ),
    );
    return result.docs.map(
      (document) => document.data() as PlatformGatewayEvent,
    );
  }
}
