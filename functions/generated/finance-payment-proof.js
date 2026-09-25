// Gerado por scripts/build-functions.mjs.
/**
 * Comprovante pelo link (cobrador, C2), sem I/O. A mesma regra decide na
 * callable publica, no painel e na demonstracao.
 */
export const PAYMENT_PROOF_LIMITS = {
    maxBytes: 5 * 1024 * 1024,
    rejectionReasonMax: 200,
};
/**
 * Tipo pelo conteudo, nunca pelo nome nem pelo que o navegador declara: um
 * ".pdf" que e outra coisa nao entra.
 */
export function detectProofType(bytes) {
    const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        return "image/png";
    if (starts(0xff, 0xd8, 0xff))
        return "image/jpeg";
    if (starts(0x25, 0x50, 0x44, 0x46, 0x2d))
        return "application/pdf";
    const ascii = (from, text) => [...text].every((char, index) => bytes[from + index] === char.charCodeAt(0));
    if (ascii(0, "RIFF") && ascii(8, "WEBP"))
        return "image/webp";
    return null;
}
export function paymentProofStoragePath(organizationId, transactionId, proofId) {
    return `paymentProofs/${organizationId}/${transactionId}/${proofId}`;
}
/**
 * Tudo o que a organizacao guarda no Storage. A exclusao da organizacao apaga
 * cada prefixo — antes da C2 os arquivos da Fase 5 sobravam.
 */
export function organizationStoragePrefixes(organizationId) {
    return [`branding/${organizationId}/`, `support/${organizationId}/`, `paymentProofs/${organizationId}/`];
}
export function paymentLinkPath(token) {
    return `/pagamento/?token=${encodeURIComponent(token)}`;
}
const OPEN = ["PENDING", "OVERDUE"];
/** O link so existe para mes de mensalidade a receber. */
export function paymentLinkError(transaction) {
    if (!transaction || transaction.type !== "INCOME" || !transaction.recurringChargeId)
        return "O link de pagamento existe só para os meses das mensalidades.";
    if (!OPEN.includes(transaction.status))
        return "Este mês não está mais a receber.";
    return null;
}
export function latestProof(proofs, transactionId) {
    return (proofs
        .filter((proof) => proof.transactionId === transactionId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null);
}
/** Um comprovante por vez: o proximo so depois de o anterior ser conferido. */
export function submitProofError(transaction, proofs) {
    if (!OPEN.includes(transaction.status))
        return "Este pagamento já está registrado. Não é preciso enviar comprovante.";
    if (latestProof(proofs, transaction.id)?.status === "SUBMITTED")
        return "Já existe um comprovante aguardando conferência.";
    return null;
}
export function reviewProofError(proof, decision) {
    if (proof.status !== "SUBMITTED")
        return "Este comprovante já foi conferido.";
    if (decision.verdict === "REJECTED") {
        const reason = decision.reason.trim();
        if (!reason)
            return "Diga o motivo da recusa: é o que a pessoa vai ver no link.";
        if (reason.length > PAYMENT_PROOF_LIMITS.rejectionReasonMax)
            return `O motivo tem no máximo ${PAYMENT_PROOF_LIMITS.rejectionReasonMax} caracteres.`;
    }
    return null;
}
/**
 * O que a pagina publica mostra — e so isso. Nada do cadastro, nenhum outro
 * lancamento: quem tem o link ve o que o proprio profissional mandaria numa
 * mensagem de cobranca.
 */
export function publicPaymentView(organizationName, transaction, proofs) {
    const proof = latestProof(proofs, transaction.id);
    return {
        organizationName,
        description: transaction.description,
        amountInCents: transaction.amountInCents,
        dueDate: transaction.dueDate,
        situation: transaction.status === "PAID" ? "PAID" : OPEN.includes(transaction.status) ? "OPEN" : "CLOSED",
        proof: proof?.status ?? "NONE",
        rejectionReason: proof?.status === "REJECTED" ? proof.rejectionReason : null,
    };
}
