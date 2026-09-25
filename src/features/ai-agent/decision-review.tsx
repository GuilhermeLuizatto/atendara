"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { classificationMeta } from "@/config/classifications";
import { DECISION_REVIEW_LABELS } from "@/config/labels";
import { classificationsFor } from "@/config/professions";
import { formatDateTime } from "@/lib/utils/format";
import { useWorkspace } from "@/providers/workspace-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { AIDecision, MessageClassificationId } from "@/types";

/**
 * Revisao humana da classificacao. E daqui que sai o acerto dos Indicadores:
 * sem revisao, a decisao nao entra na conta.
 */
export function DecisionReview({ decision }: { decision: AIDecision }) {
  const { data, session } = useWorkspace();
  const { run } = useWorkspaceActions();
  const [choosing, setChoosing] = useState(false);
  const [expected, setExpected] = useState<MessageClassificationId | "">("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const review = data.decisionReviews?.find((item) => item.decisionId === decision.id);
  const canReview = session?.permissions.includes("aiDecision:review") ?? false;
  const options = classificationsFor(data.organization.primaryProfession).filter(
    (id) => id !== decision.classification,
  );

  const save = async (verdict: "CORRECT" | "INCORRECT") => {
    setBusy(true);
    const done = await run(
      (repo) =>
        repo
          .reviewDecision(decision.id, {
            verdict,
            expectedClassification: verdict === "INCORRECT" && expected ? expected : null,
          })
          .then(() => true),
      "Revisão registrada na auditoria.",
    );
    setBusy(false);
    if (done) {
      setChoosing(false);
      setExpected("");
    }
  };

  return (
    <section className="border-border space-y-3 rounded-lg border p-3" aria-label="Revisão da classificação">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Revisão:</span>
        {review ? (
          <>
            <Badge tone={review.verdict === "CORRECT" ? "success" : "warning"}>
              {DECISION_REVIEW_LABELS[review.verdict]}
            </Badge>
            {review.expectedClassification && (
              <span>
                era {classificationMeta(review.expectedClassification).label}
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              em {formatDateTime(review.updatedAt)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Ainda não revisada.</span>
        )}
      </div>
      {canReview && !choosing && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || review?.verdict === "CORRECT"}
            onClick={() => void save("CORRECT")}
          >
            Está correta
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setChoosing(true)}>
            Está errada
          </Button>
        </div>
      )}
      {canReview && choosing && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save("INCORRECT");
          }}
        >
          <Field label="Qual classificação deveria ter saído?">
            {(props) => (
              <Select
                {...props}
                required
                value={expected}
                onChange={(event) => setExpected(event.target.value as MessageClassificationId)}
              >
                <option value="">Escolha</option>
                {options.map((id) => (
                  <option key={id} value={id}>
                    {classificationMeta(id).label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !expected}>
              Salvar revisão
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setChoosing(false)}>
              Voltar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
