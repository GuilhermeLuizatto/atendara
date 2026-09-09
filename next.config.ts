import path from "node:path";

import type { NextConfig } from "next";

/**
 * Export estatico.
 *
 * O prototipo e inteiramente client-side: Firebase Auth e Firestore falam
 * direto do navegador com o Firebase, e a barreira de seguranca sao as
 * Security Rules — nao um servidor intermediario. Com `output: "export"` o
 * `next build` produz HTML/CSS/JS em `out/`, que o Firebase Hosting serve no
 * plano gratuito, sem Cloud Functions.
 *
 * Consequencias aceitas nesta fase:
 *  - sem Route Handlers e sem proxy (`middleware`);
 *  - protecao de rota e feita no cliente (`RequireAuth`), o que e suficiente
 *    porque o dado so chega se as Security Rules autorizarem;
 *  - `next/image` sem otimizacao no servidor.
 *
 * Quando a Fase 3 exigir webhooks (n8n/WhatsApp), a saida volta a ser
 * server-side e o deploy passa a usar a integracao de frameworks do Firebase
 * ou Cloud Run. Nenhum codigo de dominio muda.
 */
const nextConfig: NextConfig = {
  /**
   * Fixa a raiz do projeto. Sem isso o Turbopack sobe a arvore procurando um
   * lockfile e pode eleger o diretorio do usuario como raiz do workspace.
   */
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typedRoutes: true,
};

export default nextConfig;
