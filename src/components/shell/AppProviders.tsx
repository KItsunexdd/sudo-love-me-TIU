"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { DemoModeProvider } from "./DemoModeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <DemoModeProvider>
        <ToastProvider>{children}</ToastProvider>
      </DemoModeProvider>
    </MotionConfig>
  );
}
