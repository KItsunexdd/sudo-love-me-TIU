"use client";

import { useT } from "@/components/shell/LocaleProvider";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, QrCode, Smartphone } from "lucide-react";
import { Button, ErrorCard, Modal, PhoneFrame, Skeleton } from "@/components/ui";
import { useDemoMode } from "@/components/shell/DemoModeProvider";

function SecondPhoneTrigger({ cosignerUserId }: { cosignerUserId: string }) {
  const { locale, t } = useT();
  const { mode } = useDemoMode();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState(false);
  const href = `/cosign?userId=${encodeURIComponent(cosignerUserId)}&mode=${mode}&lang=${locale}`;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(false);
    setImage("");
    const url = new URL(href, window.location.origin).href;
    void import("qrcode").then(async qr => {
      const svg = await qr.toString(url, { type: "svg", width: 200, margin: 3 });
      if (active) setImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [href, open]);

  return (
    <>
      <div className="mx-auto flex w-full max-w-[400px] flex-wrap items-center justify-between gap-2 rounded-2xl border border-border-default bg-surface px-3.5 py-2.5">
        <Button
          size="sm"
          variant="secondary"
          icon={<QrCode className="size-4 text-bcc" />}
          onClick={() => setOpen(true)}
        >
          {t("cosignEmbedSlot.openPhone")}
        </Button>
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-semibold text-bcc transition-colors hover:bg-surface-hover hover:underline"
        >
          <span>/cosign</span>
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("cosignEmbedSlot.openPhone")}
        description={t("cosignEmbedSlot.scan")}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] text-sm font-semibold text-bcc hover:underline"
            >
              {t("cosignEmbedSlot.newTab")} <ExternalLink aria-hidden="true" className="size-4" />
            </Link>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t("common.close")}</Button>
          </div>
        }
      >
        <div className="grid justify-items-center gap-4 text-center">
          <span className="grid size-11 place-items-center rounded-xl border border-gold/40 bg-gold/10 text-gold">
            <Smartphone aria-hidden="true" className="size-5" />
          </span>
          {image ? (
            <Image
              unoptimized
              width={200}
              height={200}
              alt={t("cosignEmbedSlot.qr")}
              src={image}
              className="rounded-xl border border-border-strong bg-white p-1"
            />
          ) : error ? (
            <ErrorCard error={{ failureCode: "ERR_QR", message: t("cosignEmbedSlot.qrError") }} />
          ) : (
            <Skeleton className="size-[200px] rounded-xl" />
          )}
          <p className="max-w-sm text-xs leading-relaxed text-ink-secondary">
            {t("cosignEmbedSlot.publicLink")}
          </p>
        </div>
      </Modal>
    </>
  );
}

function EmbedSkeleton() {
  const { t } = useT();
  return (
    <PhoneFrame preset="compact">
      <div aria-busy="true" aria-label={t("cosignEmbedSlot.opening")} className="space-y-3 p-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </PhoneFrame>
  );
}

// The sibling module is supplied by the independent Co-Sign feature.
const moduleName = "CosignLiveEmbed";
const noEmbed = () => null;
const Live = dynamic<{ cosignerUserId: string }>(async () => {
  try {
    const embed = await import(/* webpackInclude: /CosignLiveEmbed\.tsx$/ */ `./${moduleName}`);
    return embed.CosignLiveEmbed ?? embed.default ?? noEmbed;
  } catch {
    return noEmbed;
  }
}, { ssr: false, loading: () => <EmbedSkeleton /> });

export function CosignEmbedSlot({ userId }: { userId: string }) {
  return (
    <div className="space-y-2.5">
      <Live cosignerUserId={userId} />
      <SecondPhoneTrigger cosignerUserId={userId} />
    </div>
  );
}
