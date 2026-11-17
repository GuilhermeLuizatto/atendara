import { CONTRACT_VERSION, LEGAL_VERSION } from "@/config/legal";
import type {
  ContractAcceptanceSource,
  PlatformContractAcceptance,
} from "@/types/platform";

/**
 * Documento do aceite do Contrato de Licenca e do Anexo de Tratamento (E3).
 *
 * Funcao pura, compartilhada com o backend por `build-functions.mjs`. Existe
 * para que o conteudo do aceite seja escrito num lugar so: inventar o
 * documento em cada chamada acabaria com versoes diferentes do que "aceitar"
 * registra.
 *
 * A versao NAO entra por parametro. Um aceite registra o texto que estava no ar
 * no momento em que a pessoa concordou, e so o servidor sabe qual era — aceitar
 * uma versao enviada pelo cliente deixaria a organizacao escolher sobre o que
 * concordou.
 *
 * Arquivo de dominio: nao importa `firebase/*`.
 */
export function contractAcceptanceDocument({
  organizationId,
  acceptedByUserId,
  acceptedAt,
  source,
}: {
  organizationId: string;
  acceptedByUserId: string;
  acceptedAt: string;
  source: ContractAcceptanceSource;
}): PlatformContractAcceptance {
  return {
    organizationId,
    contractVersion: CONTRACT_VERSION,
    acceptedByUserId,
    acceptedAt,
    source,
    acceptedLegalVersion: LEGAL_VERSION,
  };
}

/**
 * O aceite em vigor cobre o texto de hoje?
 *
 * Ausencia de aceite e "nao", nunca "sim por omissao": conta criada pela
 * operadora nao passou por tela de aceite nenhuma, e tratar o silencio como
 * concordancia afirmaria um consentimento que ninguem deu.
 */
export function acceptanceIsCurrent(
  acceptance:
    Pick<PlatformContractAcceptance, "contractVersion"> | null | undefined,
): boolean {
  return acceptance?.contractVersion === CONTRACT_VERSION;
}
