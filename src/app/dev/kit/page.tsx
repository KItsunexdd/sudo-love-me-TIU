import type { Metadata } from "next";
import { Kit } from "./Kit";

export const metadata: Metadata = {
  title: "UI-кит",
  description: "Библиотека компонентов BCC SafeSign и интерактивная проверка гибридной подписи в браузере.",
};

export default function KitPage() {
  return (
    <main className="shell-container space-y-5 py-6">
      <Kit />
    </main>
  );
}
