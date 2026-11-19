import type { Metadata } from "next";
import { DemoStand } from "@/components/bank/DemoStand";

export const metadata: Metadata = {
  title: { absolute: "Демо-стенд · BCC SafeSign" },
  description:
    "Интерактивный стенд гибридной подписи Passkey + ML-DSA-65, симулятор 6 криптоатак (MITM, Replay, Фишинг, Социнженерия, Квант) и режим «Вторая рука».",
  openGraph: {
    title: "Демо-стенд · BCC SafeSign",
    description:
      "Демонстрация подписи банковских переводов без SMS: Passkeys + WYSIWYS SHA-256 + ML-DSA-65 + Smart Co-Sign 2-of-2.",
  },
};

export default function Home() {
  return <DemoStand />;
}
