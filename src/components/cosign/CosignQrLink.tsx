"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { ExternalLink, QrCode } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { Card } from "@/components/ui";
import type { Mode } from "@/lib/db/types";
import { cosignHref, cosignMode } from "./cosignDetails";
import { cosignQrModules } from "./cosignQr";

const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const noOrigin = () => "";
const quietZone = 4;
const modulePixels = 6;

function publicUrl(path: string, origin: string) {
  try {
    const base = new URL(origin);
    if (base.protocol === "https:" || base.protocol === "http:") return new URL(path, base.origin);
  } catch {
    // The inline link still works if a deployment address is unavailable.
  }
}

function QrCanvas({ modules }: { modules: NonNullable<ReturnType<typeof cosignQrModules>> }) {
  const { t } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = (modules.length + quietZone * 2) * modulePixels;

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    modules.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + quietZone) * modulePixels, (y + quietZone) * modulePixels, modulePixels, modulePixels);
    }));
  }, [modules, size]);

  return <canvas ref={canvas} width={size} height={size} role="img" aria-label={t("cosignQrLink.qr")}
    className="size-36 max-w-full rounded-md bg-white [image-rendering:pixelated]" />;
}

export function CosignQrLink({ cosignerUserId, mode, origin, className }: {
  cosignerUserId?: string; mode?: Mode; origin?: string; className?: string;
} = {}) {
  const { locale, t } = useT();
  const demo = useDemoMode();
  const browserOrigin = useSyncExternalStore(subscribe, getOrigin, noOrigin);
  const path = cosignHref(cosignMode(mode ?? demo.mode, cosignerUserId?.trim() || null), cosignerUserId, locale);
  const url = publicUrl(path, origin ?? browserOrigin);
  const absolute = url?.href;
  const modules = useMemo(() => absolute ? cosignQrModules(absolute) : null, [absolute]);
  const loopback = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  return (
    <Card className={`space-y-3 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <QrCode aria-hidden="true" className="size-5 shrink-0 text-bcc" />
        <h2 className="type-h3">{t("cosignQrLink.connect")}</h2>
      </div>
      {modules && <QrCanvas modules={modules} />}
      <a href={absolute ?? path} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-2 rounded text-sm font-semibold text-bcc hover:underline">
        {t("cosignQrLink.open")} <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      </a>
      {loopback && <p className="text-xs text-gold">{t("cosignQrLink.loopback")}</p>}
      {url && !loopback && url.protocol === "http:" && <p className="text-xs text-gold">{t("cosignQrLink.http")}</p>}
      <p className="text-xs text-ink-secondary">{t("cosignQrLink.https")}</p>
    </Card>
  );
}

export default CosignQrLink;
