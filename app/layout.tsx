import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "MARKOVA",
  description: "Agent personnel de Digital Marketing",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
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
