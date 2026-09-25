function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

function endsAt(startsAt, durationMinutes) {
  return new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
}

/** Chave funcional definida pelo titular para decidir duplicidades na importação. */
export function importDuplicateKey(entityType, data) {
  if (entityType === "PROFESSIONALS") return `email:${text(data.email)}`;
  if (entityType === "CLIENTS") {
    const email = data.email ? `email:${text(data.email)}` : "";
    const phone = data.phone ? `phone:${text(data.phone)}` : "";
    return `${email}|${phone}`;
  }
  if (entityType === "APPOINTMENTS") {
    return [data.clientId, data.professionalId, data.startsAt, endsAt(data.startsAt, data.durationMinutes)].join("|");
  }
  return [data.type, data.dueDate, data.amountInCents, data.clientId ?? "", text(data.description)].join("|");
}

/** Clientes duplicam por e-mail OU telefone; as demais entidades usam a chave completa. */
export function isImportDuplicate(entityType, left, right) {
  if (entityType === "CLIENTS") {
    const sameEmail = left.email && right.email && text(left.email) === text(right.email);
    const samePhone = left.phone && right.phone && text(left.phone) === text(right.phone);
    return Boolean(sameEmail || samePhone);
  }
  return importDuplicateKey(entityType, left) === importDuplicateKey(entityType, right);
}
