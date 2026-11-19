import type { Metadata } from "next";
import { SocDashboard } from "@/components/soc/SocDashboard";

export const metadata: Metadata = {
  title: "SOC-центр",
  description: "Мониторинг отражённых криптоатак, спасённых средств и проверок ML-DSA-65 в реальном времени.",
  openGraph: {
    title: "SOC-центр · BCC SafeSign",
    description: "Живой центр кибербезопасности БЦК: KPI отражённых атак, спасённые средства и трассы 7-шаговой верификации.",
  },
};

export default function SocPage() {
  return (
    <main className="shell-container py-5 2xl:py-6">
      <SocDashboard />
    </main>
  );
}
