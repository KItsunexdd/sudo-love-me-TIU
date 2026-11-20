"use client";

import type { Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/components/shell/LocaleProvider";
import { MotionConfig } from "framer-motion";
import { Suspense, useCallback, type ReactNode } from "react";
import { resetAttackState } from "@/components/hacker/attacks";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { usePathname, useSearchParams } from "next/navigation";
import { removeRevokedLocalDevices } from "@/lib/client/client-keystore";
import { useTabEventConnection } from "@/lib/client/useEventStream";
import { DemoModeProvider, useDemoMode } from "./DemoModeProvider";

function TabEventConnection() {
  const path = usePathname();
  const search = useSearchParams();
  const { senderId, cosignerId } = useDemoMode();
  const scope = path === "/soc" ? { channel: "soc" as const } : path === "/cosign"
    ? { userId: search.get("userId")?.trim() || cosignerId, channel: "cosign" as const }
    : { userId: senderId };
  const { toast } = useToast();
  const onReset = useCallback(() => {
    resetAttackState();
    void removeRevokedLocalDevices().catch(() => toast({
      titleKey: "appProviders.keystore", tone: "danger",
    }));
  }, [toast]);
  useTabEventConnection(scope, path !== "/phishing-clone", onReset);
  return null;
}

export function AppProviders({ children, initialLocale = "ru" }: { children: ReactNode; initialLocale?: Locale }) {
  return (
    <LocaleProvider initialLocale={initialLocale}>
      <MotionConfig reducedMotion="user">
        <DemoModeProvider>
          <ToastProvider>
            <Suspense fallback={null}><TabEventConnection /></Suspense>
            {children}
          </ToastProvider>
        </DemoModeProvider>
      </MotionConfig>
    </LocaleProvider>
  );
}
