"use client";

import { MotionConfig } from "framer-motion";
import { Suspense, useEffect, type ReactNode } from "react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { usePathname, useSearchParams } from "next/navigation";
import { removeRevokedLocalDevices } from "@/lib/client/client-keystore";
import { useEventStream, useTabEventConnection } from "@/lib/client/useEventStream";
import { DemoModeProvider, useDemoMode } from "./DemoModeProvider";

function TabEventConnection() {
  const path = usePathname();
  const search = useSearchParams();
  const { senderId, cosignerId } = useDemoMode();
  const scope = path === "/soc" ? { channel: "soc" as const } : path === "/cosign"
    ? { userId: search.get("userId")?.trim() || cosignerId, channel: "cosign" as const }
    : { userId: senderId };
  useTabEventConnection(scope, path !== "/phishing-clone");
  const { events } = useEventStream({});
  const reset = events.findLast(event => event.type === "DEMO_RESET");
  const { toast } = useToast();
  useEffect(() => {
    if (reset?.type === "DEMO_RESET" && !reset.keepDevices) {
      void removeRevokedLocalDevices().catch(() => toast({
        title: "Не удалось обновить локальное хранилище ключей", tone: "danger",
      }));
    }
  }, [reset, toast]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <DemoModeProvider>
        <ToastProvider>
          <Suspense fallback={null}><TabEventConnection /></Suspense>
          {children}
        </ToastProvider>
      </DemoModeProvider>
    </MotionConfig>
  );
}
