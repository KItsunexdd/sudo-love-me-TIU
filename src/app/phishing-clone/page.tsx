import type { Metadata } from "next";
import { OriginCheck } from "./OriginCheck";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "B+ Bonus · Проверка домена (Демо фишинга)" },
  description: "Учебная страница-клон для живой демонстрации аппаратной привязки WebAuthn Passkey к домену банка (Origin Lock).",
  openGraph: {
    title: "B+ Bonus · Проверка домена WebAuthn",
    description: "Демонстрация защиты Passkey от фишинговых клонов на чужом домене.",
  },
};

export default function BonusPage() {
  return <OriginCheck rpId={process.env.SAFESIGN_RP_ID ?? "localhost"} bankOrigin={process.env.SAFESIGN_ORIGIN} />;
}
