import type { MetadataRoute } from "next";

// Manifeste d'application : utilisé par l'APK Android (Trusted Web Activity) et « Ajouter à l'écran d'accueil ».
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARKOVA — Marketing Intelligence",
    short_name: "MARKOVA",
    description: "Agent personnel de Digital Marketing",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d11",
    theme_color: "#0b0d11",
    lang: "fr",
    icons: [
      { src: "/icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
