import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Police unique, très lisible (chiffres et accents nets), du texte courant aux titres.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-ui", display: "swap", weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "MARKOVA",
  description: "Kimia, ton assistante de marketing digital",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={jakarta.variable} suppressHydrationWarning>
      <head>
        {/* Mode léger sur les appareils modestes (≤ 4 Go de RAM ou ≤ 4 cœurs), avant le premier affichage. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var n=navigator;if((n.deviceMemory||8)<=4||(n.hardwareConcurrency||8)<=4)document.documentElement.classList.add('lite')}catch(e){}",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&display=block"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
