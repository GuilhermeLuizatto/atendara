import type { Metadata } from "next";
import type { ReactNode } from "react";

// Link de cobranca e pessoal: buscador nenhum deve guardar ou listar.
export const metadata: Metadata = {
  title: "Cobrança",
  robots: { index: false, follow: false },
};

export default function PaymentLayout({ children }: { children: ReactNode }) {
  return children;
}
