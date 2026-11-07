import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const requireTools = createRequire(new URL("../.local/firebase-tools/package.json", import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = requireTools("@firebase/rules-unit-testing");
const { doc, setDoc } = requireTools("firebase/firestore");
const { ref, uploadBytes, getBytes, deleteObject } = requireTools("firebase/storage");

const projectId = "demo-atendara";
const environment = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8085, rules: readFileSync("firestore.rules", "utf8") },
  storage: { host: "127.0.0.1", port: 9198, rules: readFileSync("storage.rules", "utf8") },
});

const account = (organizationId, platformRole = "PROFESSIONAL", modules = [], patch = {}) => ({ organizationId, platformRole, professionId: "PSYCHOLOGIST", status: "ACTIVE", mustChangePassword: false, subscriptionStatus: "ACTIVE", accessUntilMs: Date.now() + 86_400_000, modules, ...patch });
const bytes = new Uint8Array([1, 2, 3]);
const metadata = contentType => ({ contentType });

try {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "accounts/owner"), account("org-a"));
    await setDoc(doc(db, "accounts/admin"), account("org-a"));
    await setDoc(doc(db, "accounts/member"), account("org-a"));
    await setDoc(doc(db, "accounts/viewer"), account("org-a"));
    await setDoc(doc(db, "accounts/other"), account("org-b"));
    await setDoc(doc(db, "accounts/support"), account(null, "PLATFORM_ADMIN"));
    await setDoc(doc(db, "organizations/org-a"), { ownerId: "owner", primaryProfession: "PSYCHOLOGIST" });
    await setDoc(doc(db, "organizations/org-b"), { ownerId: "other", primaryProfession: "PSYCHOLOGIST" });
    await setDoc(doc(db, "organizations/org-a/members/owner"), { role: "PROFESSIONAL", status: "ACTIVE" });
    await setDoc(doc(db, "organizations/org-a/members/admin"), { role: "ADMIN", status: "ACTIVE" });
    await setDoc(doc(db, "organizations/org-a/members/member"), { role: "ASSISTANT", status: "ACTIVE" });
    await setDoc(doc(db, "organizations/org-a/members/viewer"), { role: "VIEWER", status: "ACTIVE" });
    await setDoc(doc(db, "organizations/org-b/members/other"), { role: "PROFESSIONAL", status: "ACTIVE" });
    await setDoc(doc(db, "platformSupportTickets/ticket"), { organizationId: "org-a", openedBy: "member" });
    // Comprovante (cobrador, C2): quem le e quem tem o modulo financeiro.
    await setDoc(doc(db, "accounts/finance"), account("org-a", "PROFESSIONAL", ["financeiro"]));
    await setDoc(doc(db, "accounts/nofinance"), account("org-a", "PROFESSIONAL", ["agenda"]));
    await setDoc(doc(db, "accounts/finance-other"), account("org-a", "PROFESSIONAL", ["financeiro"]));
    await setDoc(doc(db, "accounts/finance-expired"), account("org-a", "PROFESSIONAL", ["financeiro"], { accessUntilMs: Date.now() - 86_400_000 }));
    await setDoc(doc(db, "organizations/org-a/members/finance"), { role: "ASSISTANT", status: "ACTIVE", linkedProfessionalIds: ["p1"] });
    await setDoc(doc(db, "organizations/org-a/members/finance-other"), { role: "ASSISTANT", status: "ACTIVE", linkedProfessionalIds: ["p2"] });
    await setDoc(doc(db, "organizations/org-a/members/finance-expired"), { role: "ASSISTANT", status: "ACTIVE", linkedProfessionalIds: ["p1"] });
    await setDoc(doc(db, "organizations/org-a/members/nofinance"), { role: "ASSISTANT", status: "ACTIVE" });
    await setDoc(doc(db, "organizations/org-a/paymentProofs/p1"), { organizationId: "org-a", transactionId: "m1-202609", professionalId: "p1" });
    await uploadBytes(ref(context.storage(), "branding/org-a/logo/logo.webp"), bytes, metadata("image/webp"));
    await uploadBytes(ref(context.storage(), "paymentProofs/org-a/m1-202609/p1"), bytes, metadata("image/png"));
  });

  const storage = (uid, claims = {}) => environment.authenticatedContext(uid, claims).storage();
  const logo = uid => ref(storage(uid), "branding/org-a/logo/logo.webp");
  await assertSucceeds(getBytes(logo("owner")));
  await assertFails(uploadBytes(logo("owner"), bytes, metadata("image/webp")));
  await assertFails(uploadBytes(ref(storage("admin"), "branding/org-a/logo/admin.png"), bytes, metadata("image/png")));
  await assertFails(uploadBytes(ref(storage("member"), "branding/org-a/logo/member.png"), bytes, metadata("image/png")));
  await assertFails(uploadBytes(ref(storage("owner"), "branding/org-a/logo/vector.svg"), bytes, metadata("image/svg+xml")));
  await assertFails(uploadBytes(ref(storage("other"), "branding/org-a/logo/cross.png"), bytes, metadata("image/png")));

  const supportPath = "support/org-a/ticket/message/evidence.pdf";
  const evidence = ref(storage("member"), supportPath);
  await environment.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(), supportPath), bytes, metadata("application/pdf"));
  });
  await assertFails(uploadBytes(ref(storage("member"), "support/org-a/ticket/message/another.pdf"), bytes, metadata("application/pdf")));
  await assertSucceeds(getBytes(ref(storage("owner"), supportPath)));
  await assertFails(getBytes(ref(storage("viewer"), supportPath)));
  await assertFails(deleteObject(evidence));
  await assertFails(uploadBytes(ref(storage("member"), "support/org-a/ticket/message/script.exe"), bytes, metadata("application/octet-stream")));
  await assertFails(uploadBytes(ref(storage("other"), "support/org-a/ticket/message/cross.pdf"), bytes, metadata("application/pdf")));
  await assertFails(getBytes(ref(environment.unauthenticatedContext().storage(), supportPath)));
  await assertFails(getBytes(ref(storage("support"), supportPath)));
  await assertSucceeds(getBytes(ref(storage("support", { firebase: { sign_in_second_factor: "totp" } }), supportPath)));

  const proofPath = "paymentProofs/org-a/m1-202609/p1";
  await assertSucceeds(getBytes(ref(storage("finance"), proofPath)));
  await assertFails(getBytes(ref(storage("finance-other"), proofPath)));
  await assertFails(getBytes(ref(storage("finance-expired"), proofPath)));
  await assertFails(getBytes(ref(storage("nofinance"), proofPath)));
  await assertFails(getBytes(ref(storage("other"), proofPath)));
  await assertFails(getBytes(ref(environment.unauthenticatedContext().storage(), proofPath)));
  await assertFails(uploadBytes(ref(storage("finance"), "paymentProofs/org-a/m1-202609/forjado"), bytes, metadata("image/png")));
  await assertFails(deleteObject(ref(storage("finance"), proofPath)));

  console.log("23 verificações das regras de arquivos passaram no emulador.");
} finally {
  await environment.cleanup();
}
