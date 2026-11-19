import type { Metadata } from "next";
import { SmsRoiCalculator } from "@/components/roi/SmsRoiCalculator";

export const metadata: Metadata = {
  title: "ROI-калькулятор",
  description: "Расчёт прямой экономии OpEx АО «Банк ЦентрКредит» на отказе от SMS и предотвращённых потерь от фрода.",
  openGraph: {
    title: "ROI-калькулятор · BCC SafeSign",
    description: "Интерактивный расчёт финансового эффекта внедрения BCC SafeSign для банка и клиентов.",
  },
};

export default function RoiPage() {
  return (
    <main className="shell-container py-5 2xl:py-6">
      <SmsRoiCalculator />
    </main>
  );
}
