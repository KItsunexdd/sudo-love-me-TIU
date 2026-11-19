import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "BCC SafeSign", description: "Подпись банковских операций" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ru"><body className="bg-canvas font-sans text-white">{children}</body></html>;
}
