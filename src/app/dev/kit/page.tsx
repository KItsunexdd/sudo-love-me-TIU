import type { Metadata } from "next";
import { Kit } from "./Kit";

export const metadata: Metadata = { title: "UI-кит · BCC SafeSign" };

export default function KitPage() {
  return (
    <main className="shell-container space-y-5 py-6">
      <header>
        <h1 className="type-h1">UI-кит SafeSign</h1>
        <p className="mt-1 text-sm text-ink-secondary">Компоненты интерфейса и проверка подписи в браузере.</p>
      </header>
      <Kit />
    </main>
  );
}
