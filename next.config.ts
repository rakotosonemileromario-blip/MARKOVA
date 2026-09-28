import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les compétences sont lues depuis /skills à l'exécution : on les embarque
  // dans les fonctions serverless qui en ont besoin.
  outputFileTracingIncludes: {
    "/api/chat": ["./skills/**/*"],
    "/competences": ["./skills/**/*"],
  },
  serverExternalPackages: ["exceljs", "mammoth", "unpdf"],
};

export default nextConfig;
