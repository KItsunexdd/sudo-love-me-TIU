import type { Metadata } from "next";
import { SmsRoiCalculator } from "@/components/roi/SmsRoiCalculator";

export const metadata: Metadata = {
  title: "ROI-калькулятор · BCC SafeSign",
  description: "Расчёт прямой экономии OpEx БЦК на отказе от SMS и предотвращённых потерь от фрода",
};

export default function RoiPage() {
  return (
    <main className="shell-container py-6">
      <SmsRoiCalculator />
    </main>
  );
}
