"use client";

import { Button } from "@/components/ui/Button";
import { ErrorCard } from "@/components/ui/ErrorCard";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="shell-container py-8">
      <ErrorCard
        error={{ failureCode: "ERR_CLIENT", message: "При открытии раздела произошла ошибка." }}
        action={<Button size="sm" variant="secondary" onClick={reset}>Попробовать снова</Button>}
      />
    </main>
  );
}
