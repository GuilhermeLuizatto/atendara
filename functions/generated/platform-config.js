// Gerado por scripts/build-functions.mjs.
/**
 * Politica da operadora da plataforma, como DADO.
 *
 * Compartilhado com o backend por `scripts/build-functions.mjs`, como
 * `billing.ts`. As Security Rules nao importam TypeScript: o fator exigido
 * aparece literal em `platformAdmin()` e precisa mudar junto daqui.
 */
/**
 * Fatores aceitos para a operadora. O valor e o id do fator gravado em
 * `firebase.sign_in_second_factor` no token.
 *
 * So TOTP, por decisao do titular. SMS fica de fora mesmo que o
 * projeto venha a habilita-lo para outro publico. Se o token real trouxer outro
 * valor, a trava fecha: a operadora perde a administracao, e nenhum dado abre.
 */
export const PLATFORM_ADMIN_SECOND_FACTORS = ["totp"];
/**
 * Prazo maximo de uma concessao manual, contado a partir do ato. Renovar exige
 * nova concessao, com novo motivo. Quinze dias por decisao do titular em
 * 11/09/2026, revisavel: curto o bastante para que uma cortesia esquecida nao
 * vire acesso gratuito permanente.
 */
export const MAX_ACCESS_GRANT_DAYS = 15;
export const ACCESS_GRANT_REASON_LENGTH = { min: 10, max: 500 };
/**
 * Justificativa do pedido de troca de profissao, e da resposta da operadora.
 *
 * Exigir texto nos dois lados nao e burocracia: a profissao muda vocabulario,
 * taxonomia e travas de aviso, e quem ler a trilha meses depois precisa saber
 * por que aquele cadastro deixou de ser o que era.
 */
export const PROFESSION_CHANGE_REASON_LENGTH = { min: 10, max: 500 };
export const ACCESS_GRANT_KIND_LABELS = {
    COURTESY: "Cortesia",
    PILOT: "Piloto",
    CORRECTION: "Correção",
    TRIAL: "Teste",
};
/**
 * Teste do autocadastro, em dias, contados da CONFIRMACAO do e-mail — nao do
 * cadastro. Decisao do titular em 16/09/2026.
 *
 * Precisa caber em `MAX_ACCESS_GRANT_DAYS`: o teste nao e uma terceira porta
 * de acesso, e a mesma concessao registrada das outras, com tipo proprio. Um
 * teste mais longo que a janela maxima exigiria relaxar a janela, e e ela que
 * impede uma cortesia esquecida de virar acesso permanente.
 */
export const TRIAL_DAYS = 14;
/**
 * Motivo gravado na concessao de teste. Fixo porque nao ha humano no ato: quem
 * le a trilha precisa distinguir de imediato o teste automatico do ato da
 * operadora.
 */
export const TRIAL_GRANT_REASON = "Teste de 14 dias aberto pelo autocadastro, apos confirmacao do e-mail.";
/**
 * Autor registrado quando o ato nao tem humano. Nao e um id de usuario e nunca
 * sera: o formato com dois pontos nao colide com `uid` do Authentication, e a
 * trilha fica legivel sem consultar `accounts`.
 */
export const SELF_SERVICE_ACTOR = "sistema:autocadastro";
/**
 * Politica de senha, decidida pelo titular em 19/09/2026: de 12 a 128
 * caracteres, com maiuscula, minuscula, numero e simbolo. Conferida na tela e
 * no servidor (`src/lib/auth/password-policy.ts`) e, em paralelo, pela politica
 * do Identity Platform no console — esta trava existe para o cadastro nao
 * depender de uma configuracao que alguem pode afrouxar sem revisao de codigo.
 */
export const PASSWORD_LENGTH = { min: 12, max: 128 };
/**
 * Os simbolos que o Identity Platform aceita como "caractere especial"
 * (docs.cloud.google.com/identity-platform/docs/password-policy). Hifen, "+"
 * e "=" NAO estao na lista: uma senha que so os tivesse passaria aqui e seria
 * recusada la.
 */
export const PASSWORD_SPECIAL_CHARACTERS = "^$*.[]{}()?\"!@#%&/\\,><':;|_~`";
/**
 * Quantos dias antes do fim o painel avisa que o teste esta acabando.
 *
 * Aviso de plataforma, dentro do painel — nunca pelo canal da clinica (regra
 * 12). Enquanto nao houver remetente proprio, este e o unico aviso honesto: a
 * pessoa le quando abre o painel.
 */
export const TRIAL_ENDING_NOTICE_DAYS = 3;
/**
 * Quanto tempo a conta bloqueada continua inteira antes da pseudonimizacao.
 *
 * Trinta dias por decisao do titular em 16/09/2026. Bloquear nao e apagar: no
 * periodo a pessoa assina, exporta o que e dela (art. 18, V) e pode pedir a
 * exclusao. Quem aplica o fim do prazo e a A.5.
 */
export const BLOCKED_RETENTION_DAYS = 30;
/**
 * Quanto tempo um login que nunca virou cadastro confirmado sobrevive (A.8).
 *
 * Sete dias pela decisao operacional 6 da ADR 0005. Vale para os dois jeitos de
 * desistir no meio: o cadastro por senha que nunca confirmou o e-mail, e a
 * entrada pelo Google abandonada antes da segunda tela. Nos dois a pessoa nao
 * chegou a usar nada, e guardar o e-mail dela sem finalidade e o que a LGPD
 * pede para nao fazer.
 */
export const UNCONFIRMED_SIGNUP_RETENTION_DAYS = 7;
export const PLATFORM_AUDIT_ACTION_LABELS = {
    ACCOUNT_REGISTERED: "Cadastro de profissional",
    ACCOUNT_UPDATED: "Alteração de conta",
    ACCESS_GRANTED: "Concessão de acesso",
    MESSAGING_SENDER_REGISTERED: "Remetente de canal cadastrado",
    ACCESS_REVOKED: "Revogação de acesso",
    SELF_SERVICE_REGISTERED: "Cadastro aberto pelo profissional",
    TRIAL_STARTED: "Início do teste de 14 dias",
    TRIAL_ENDED: "Fim do teste de 14 dias",
    ABANDONED_ORGANIZATION_ERASED: "Exclusão automática do cadastro abandonado",
    UNCONFIRMED_SIGNUP_ERASED: "Exclusão automática do cadastro sem e-mail confirmado",
    ORPHAN_LOGIN_REMOVED: "Exclusão automática do login sem cadastro",
    PROFESSION_CHANGE_REQUESTED: "Pedido de troca de profissão",
    PROFESSION_CHANGE_APPROVED: "Troca de profissão aprovada",
    PROFESSION_CHANGE_REJECTED: "Troca de profissão recusada",
    PLATFORM_ADMIN_CREATED: "Cadastro de administrador",
    PLATFORM_ADMIN_SUSPENDED: "Suspensão de administrador",
    PLATFORM_ADMIN_REACTIVATED: "Reativação de administrador",
    ORGANIZATION_DELETED: "Exclusão de organização pelo titular",
};
/**
 * Teto por SUJEITO nas callables que falam com o gateway, que destroem dado ou
 * que estao abertas a quem ainda nao tem conta. Uma conta autenticada nao pode
 * gastar a cota da conta do gateway que atende todos os tenants, e uma sessao
 * comprometida nao elimina o cadastro inteiro de uma clinica num laco. Janela
 * fixa: simples de provar e suficiente contra volume.
 *
 * O sujeito costuma ser o usuario, mas o autocadastro nao tem usuario ainda:
 * ali o sujeito e a origem da requisicao. Por isso a mesma callable pode ter
 * mais de um contador, e cada um aparece nesta tabela com nome proprio.
 */
export const CALLABLE_RATE_LIMITS = {
    aiPreview: { max: 20, windowSeconds: 60 },
    geminiOrganization: { max: 200, windowSeconds: 86400 },
    geminiGlobal: { max: 2000, windowSeconds: 86400 },
    createSubscriptionCheckout: { max: 5, windowSeconds: 600 },
    openBillingPortal: { max: 10, windowSeconds: 600 },
    cancelPlatformSubscription: { max: 3, windowSeconds: 600 },
    eraseClientData: { max: 10, windowSeconds: 600 },
    // Exportar tambem grava registro em `privacyRequests` e na trilha a cada
    // chamada: sem teto, uma sessao comprometida enche a trilha num laco. A
    // exportacao da organizacao inteira e rara e pesada; a de um cliente, pontual.
    exportClientData: { max: 10, windowSeconds: 600 },
    startOrganizationExport: { max: 3, windowSeconds: 600 },
    deleteOrganization: { max: 3, windowSeconds: 600 },
    // Autocadastro. A janela de uma hora e o numero baixo por origem seguram
    // criacao em massa; o contador por conta segura quem ja entrou e insiste.
    selfServiceSignupByNetwork: { max: 5, windowSeconds: 3600 },
    selfServiceSignupByAccount: { max: 3, windowSeconds: 3600 },
    selfServiceTrialActivation: { max: 3, windowSeconds: 3600 },
    professionChangeRequest: { max: 3, windowSeconds: 3600 },
    // Cadastro de remetente e raro e sempre da operadora. O teto existe porque
    // cada chamada grava na trilha: sessao comprometida nao enche a trilha.
    messagingSenderRegistration: { max: 10, windowSeconds: 3600 },
    // Conectar e desconectar agenda sao atos raros da propria pessoa. O teto
    // existe porque cada tentativa fala com o Google e com o KMS.
    calendarConnection: { max: 10, windowSeconds: 3600 },
    calendarStatus: { max: 120, windowSeconds: 3600 },
    // Um teto separado permite desconectar após esgotar tentativas de conexão.
    calendarDisconnect: { max: 20, windowSeconds: 3600 },
    // A chave e para emergencia: um punhado de vezes por hora e muito mais do
    // que qualquer emergencia real precisa, e ja segura um laco.
    automationSwitch: { max: 20, windowSeconds: 3600 },
    automationRetry: { max: 30, windowSeconds: 3600 },
};
/**
 * Retencao PROVISORIA, em dias, gravada como `expiresAt` para uma futura
 * politica de TTL. Nenhum destes prazos foi aprovado por revisao juridica, e a
 * politica de TTL nao esta ligada para colecao nenhuma com dado de pessoa.
 *
 * `platformGatewayEvents` precisa sobreviver bem alem da janela de reenvio do
 * gateway: e a trava de idempotencia.
 */
export const PROVISIONAL_RETENTION_DAYS = {
    platformGatewayEvents: 400,
};
