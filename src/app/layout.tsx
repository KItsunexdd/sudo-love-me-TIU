import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/shell/AppProviders";
import { Topbar } from "@/components/shell/Topbar";
import "./globals.css";

// IBM Plex covers the Kazakh Cyrillic letters (ә ғ қ ң ө ұ ү һ і) in both families.
const plexSans = IBM_Plex_Sans({ weight: ["400", "500", "600"], subsets: ["latin", "cyrillic", "cyrillic-ext"], display: "swap", variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin", "cyrillic", "cyrillic-ext"], display: "swap", variable: "--font-plex-mono" });

// Render HTML per request so Next can attach the matching CSP nonce.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#131415",
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = (await headers()).get("x-safesign-lang") === "kk" ? "kk" : "ru";
  return (
    <html lang={locale} className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <AppProviders initialLocale={locale}>
          <Topbar />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
