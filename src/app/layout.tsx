import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/shell/AppProviders";
import { Topbar } from "@/components/shell/Topbar";
import "./globals.css";

const inter = Inter({ weight: "variable", subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-inter" });
const jetBrainsMono = JetBrains_Mono({ weight: "variable", subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-jetbrains-mono" });

// Render HTML per request so Next can attach the matching CSP nonce.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#07110E",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: {
    default: "BCC SafeSign — Криптоподпись без SMS",
    template: "%s · BCC SafeSign",
  },
  description:
    "Платформа криптографической подписи банковских операций без SMS для bcc.kz и BCC Business: WebAuthn Passkeys, WYSIWYS SHA-256, Post-Quantum ML-DSA-65 (FIPS 204) и Smart Co-Sign 2-of-2.",
  applicationName: "BCC SafeSign",
  keywords: [
    "BCC SafeSign",
    "Банк ЦентрКредит",
    "Passkey",
    "WebAuthn",
    "WYSIWYS",
    "ML-DSA-65",
    "FIPS 204",
    "Smart Co-Sign",
    "Антифрод",
  ],
  openGraph: {
    type: "website",
    locale: "ru_KZ",
    siteName: "BCC SafeSign",
    title: "BCC SafeSign — Криптоподпись банковских операций без SMS",
    description:
      "Unphishable Passkeys + WYSIWYS SHA-256 + Post-Quantum ML-DSA-65 + Smart Co-Sign 2-of-2 для экосистемы bcc.kz и BCC Business.",
  },
  twitter: {
    card: "summary_large_image",
    title: "BCC SafeSign — Криптоподпись без SMS",
    description:
      "Замена SMS-кодов в банке: аппаратные Passkeys, WYSIWYS, постквантовый ML-DSA-65 и защита «Вторая рука».",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${jetBrainsMono.variable}`}>
      <body>
        <AppProviders>
          <Topbar />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
