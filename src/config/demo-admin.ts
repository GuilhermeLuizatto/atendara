// O verificador do demo fica na configuracao local, fora do repositorio.
export const DEMO_ADMIN_VERIFIER = {
  salt: process.env.NEXT_PUBLIC_DEMO_ADMIN_SALT ?? "",
  hash: process.env.NEXT_PUBLIC_DEMO_ADMIN_HASH ?? "",
};
