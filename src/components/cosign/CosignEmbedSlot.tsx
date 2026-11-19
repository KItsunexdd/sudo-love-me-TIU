"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { Card, ErrorCard, Spinner } from "@/components/ui";
import { useDemoMode } from "@/components/shell/DemoModeProvider";

function OpenCosign({ cosignerUserId }: { cosignerUserId: string }) {
  const { mode } = useDemoMode();
  const [image, setImage] = useState("");
  const [error, setError] = useState(false);
  const href = `/cosign?userId=${encodeURIComponent(cosignerUserId)}&mode=${mode}`;
  useEffect(() => {
    let active = true;
    setError(false);
    setImage("");
    const url = new URL(href, window.location.origin).href;
    void import("qrcode").then(async qr => {
      const svg = await qr.toString(url, { type: "svg", width: 176, margin: 4 });
      if (active) setImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [href]);
  return <Card className="grid justify-items-center gap-4 py-8 text-center">
    <Smartphone className="text-gold" /><h2 className="type-h2">Вторая рука на отдельном экране</h2>
    {image && <Image unoptimized width={176} height={176} alt="QR-код экрана Второй руки" src={image} className="rounded-xl" />}
    {error && <ErrorCard error={{ failureCode: "ERR_QR", message: "Не удалось построить QR-код. Откройте ссылку ниже." }} />}
    <Link href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-bcc underline">Откройте /cosign <ExternalLink size={16} /></Link>
    <p className="max-w-sm text-sm text-ink-secondary">Для второго телефона нужен адрес стенда, доступный с обоих устройств.</p>
  </Card>;
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
}, { ssr: false, loading: () => <Spinner label="Открываем экран Второй руки…" /> });

export function CosignEmbedSlot({ userId }: { userId: string }) {
  return <div className="space-y-3"><Live cosignerUserId={userId} /><OpenCosign cosignerUserId={userId} /></div>;
}
