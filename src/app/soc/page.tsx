import type { Metadata } from "next";
import { SocDashboard } from "@/components/soc/SocDashboard";

export const metadata: Metadata = {
  title: "SOC-центр · BCC SafeSign",
  description: "Мониторинг отражённых криптоатак, спасённых средств и проверок ML-DSA-65 в реальном времени",
};

export default function SocPage() {
  return (
    <main className="shell-container py-6">
      <SocDashboard />
    </main>
  );
}
