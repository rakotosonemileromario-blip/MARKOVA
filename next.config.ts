import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les compétences sont lues depuis /skills à l'exécution : on les embarque
  // dans les fonctions serverless qui en ont besoin.
  outputFileTracingIncludes: {
    "/api/chat": ["./skills/**/*"],
    "/api/cron/*": ["./skills/**/*"],
    "/api/rapport": ["./skills/**/*"],
    "/competences": ["./skills/**/*"],
  },
  serverExternalPackages: ["exceljs", "mammoth", "unpdf", "msedge-tts"],
};

export default nextConfig;
