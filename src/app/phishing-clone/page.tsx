import { OriginCheck } from "./OriginCheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "B+ Bonus · Проверка домена" };

export default function BonusPage() {
  return <OriginCheck rpId={process.env.SAFESIGN_RP_ID ?? "localhost"} bankOrigin={process.env.SAFESIGN_ORIGIN ?? "http://localhost:3000"} />;
}
