import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/shell/AppProviders";
import { Topbar } from "@/components/shell/Topbar";
import "./globals.css";

const inter = Inter({ weight: "variable", subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-inter" });
const jetBrainsMono = JetBrains_Mono({ weight: "variable", subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-jetbrains-mono" });

export const metadata: Metadata = { title: "BCC SafeSign", description: "Криптоподпись банковских операций без SMS" };

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
