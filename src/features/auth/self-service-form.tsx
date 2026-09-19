"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { PASSWORD_LENGTH } from "@/config/platform";
import { PASSWORD_HINT, passwordPolicyError } from "@/lib/auth/password-policy";
import { getProfession, listProfessions } from "@/config/professions";
import { AUTH_FIELD_CLASSES } from "@/features/auth/auth-card";
import { councilRegistrationError } from "@/lib/auth/self-service";
import type { ProfessionId } from "@/types";

/**
 * Os campos do cadastro aberto.
 *
 * Quem entra pelo Google ja trouxe nome, e-mail e senha — por isso o formulario
 * e o mesmo, com as tres primeiras perguntas de fora. Duas telas diferentes
 * divergiriam na primeira mudanca.
 *
 * O rotulo do conselho e a obrigatoriedade saem da tabela de profissoes: nao ha
 * nenhuma lista de profissoes aqui dentro (regra 1).
 */

export interface SelfServiceFormValues {
  displayName: string;
  email: string;
  password?: string;
  professionId: ProfessionId;
  councilRegistration?: string;
  businessName: string;
}

const PROFESSIONS = listProfessions();
const SOME_COUNCIL = PROFESSIONS.some((profession) => profession.council);

export function SelfServiceForm({
  identity,
  submitting,
  onSubmit,
}: {
  /** Nome e e-mail ja confirmados pelo Google, ou `null` no cadastro por senha. */
  identity: { displayName: string; email: string } | null;
  submitting: boolean;
  onSubmit: (values: SelfServiceFormValues) => void;
}) {
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  const [password, setPassword] = useState("");
  const [professionId, setProfessionId] = useState<ProfessionId>(PROFESSIONS[0].id);
  const [councilRegistration, setCouncilRegistration] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const council = getProfession(professionId).council;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const registration = council ? councilRegistration.trim() : "";
    const error =
      (identity ? null : passwordPolicyError(password)) ?? councilRegistrationError(professionId, registration || null);
    if (error) {
      setInvalid(error);
      return;
    }
    setInvalid(null);
    onSubmit({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      ...(identity ? {} : { password }),
      professionId,
      ...(registration ? { councilRegistration: registration } : {}),
      businessName: businessName.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      {identity ? (
        <p className="border-border bg-surface-muted text-muted-foreground rounded-lg border px-3 py-2.5 text-xs leading-relaxed">
          Entrando como <strong className="text-foreground">{identity.email}</strong>. Falta
          dizer o que você faz.
        </p>
      ) : (
        <>
          <Fieldset id="nome" label="Seu nome completo">
            <input
              id="nome"
              name="name"
              autoComplete="name"
              required
              minLength={3}
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={AUTH_FIELD_CLASSES}
            />
          </Fieldset>

          <Fieldset id="email" label="E-mail">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              className={AUTH_FIELD_CLASSES}
            />
          </Fieldset>

          <Fieldset
            id="senha"
            label="Senha"
            hint={PASSWORD_HINT}
          >
            <input
              id="senha"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_LENGTH.min}
              maxLength={PASSWORD_LENGTH.max}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={AUTH_FIELD_CLASSES}
            />
          </Fieldset>
        </>
      )}

      <Fieldset
        id="profissao"
        label="O que você faz"
        hint={SOME_COUNCIL ? "* pede o número de registro no conselho." : undefined}
      >
        <select
          id="profissao"
          name="profession"
          required
          value={professionId}
          onChange={(event) => setProfessionId(event.target.value as ProfessionId)}
          className={AUTH_FIELD_CLASSES}
        >
          {PROFESSIONS.map((profession) => (
            <option key={profession.id} value={profession.id}>
              {profession.council ? `${profession.label} *` : profession.label}
            </option>
          ))}
        </select>
      </Fieldset>

      {council ? (
        <Fieldset
          id="conselho"
          label={`Registro no ${council.acronym}`}
          hint={council.name}
        >
          <input
            id="conselho"
            name="council"
            required
            value={councilRegistration}
            onChange={(event) => setCouncilRegistration(event.target.value)}
            placeholder={`${council.acronym} 00/00000`}
            className={AUTH_FIELD_CLASSES}
          />
        </Fieldset>
      ) : null}

      <Fieldset
        id="negocio"
        label="Nome do seu trabalho"
        hint="Aparece no painel e nos avisos. Pode ser o seu próprio nome."
      >
        <input
          id="negocio"
          name="business"
          required
          minLength={2}
          maxLength={120}
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
          className={AUTH_FIELD_CLASSES}
        />
      </Fieldset>

      <label className="text-muted-foreground flex items-start gap-2.5 text-xs leading-relaxed">
        <input
          type="checkbox"
          name="accept"
          required
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="accent-primary mt-0.5 size-4 shrink-0"
        />
        <span>
          Li e aceito os{" "}
          <a href="/termos" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            Termos de Uso
          </a>{" "}
          e a{" "}
          <a href="/privacidade" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            Política de Privacidade
          </a>
          .
        </span>
      </label>

      {invalid ? (
        <p role="alert" className="border-danger-soft bg-danger-soft text-danger-soft-foreground rounded-lg border px-3 py-2 text-xs">
          {invalid}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full justify-center" disabled={submitting || !accepted}>
        {submitting ? "Criando..." : "Criar conta e começar o teste"}
      </Button>
    </form>
  );
}

function Fieldset({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-foreground block text-xs font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-subtle-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
