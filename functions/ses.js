import { createHash, createHmac } from "node:crypto";

const SERVICE = "ses";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, date, region) {
  const day = hmac(`AWS4${secret}`, date);
  const regional = hmac(day, region);
  const service = hmac(regional, SERVICE);
  return hmac(service, "aws4_request");
}

function awsDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Envio transacional pelo SES v2, sem SDK e sem colocar credencial no cliente. */
export async function sendEmail({ to, subject, html, text, now = new Date() }) {
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  const region = process.env.SES_REGION ?? "us-east-2";
  const from = process.env.SES_FROM_EMAIL ?? "guilhermeluizatto@gmail.com";
  if (!accessKeyId || !secretAccessKey) throw new Error("SES não configurado.");

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    },
  });
  const timestamp = awsDate(now);
  const date = timestamp.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const signature = hmac(signingKey(secretAccessKey, date, region), stringToSign, "hex");

  const response = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": timestamp,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`SES recusou o envio (${response.status}).`);
  }
  return await response.json();
}

export function emailShell({ title, body, organization }) {
  const logo = organization?.branding?.logoUrl
    ? `<img src="${escapeHtml(organization.branding.logoUrl)}" width="48" height="48" alt="" style="display:block;border-radius:10px;object-fit:cover;margin-bottom:16px">`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2f2a39;line-height:1.5">${logo}<h1 style="font-size:20px;color:#2d1a52">${escapeHtml(title)}</h1>${body}<p style="color:#625b6e;font-size:12px">Atendara</p></body></html>`;
}
