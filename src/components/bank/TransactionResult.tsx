import { CircleCheck, Clock, Hand, Microscope, Plus } from "lucide-react";
import type { ApiError } from "@/lib/client/api";
import type { TransactionRecord } from "@/lib/db/types";
import { formatTenge } from "@/lib/ui/format";
import { Badge, Button, Card, ErrorCard, HashChip, Spinner } from "@/components/ui";
import { AttackBlockedShield } from "@/components/hacker/AttackBlockedShield";

export function TransactionResult({ record, error, http, cosigner, onInspect, onNew, onCosign }: {
  record?: TransactionRecord; error?: ApiError; http?: number; cosigner?: string;
  onInspect: () => void; onNew: () => void; onCosign: () => void;
}) {
  const actions = <div className="flex flex-wrap gap-2">
    <Button variant="secondary" size="sm" icon={<Microscope size={15} />} onClick={onInspect}>Открыть Crypto Inspector</Button>
    <Button variant="ghost" size="sm" icon={<Plus size={15} />} onClick={onNew}>Новая операция</Button></div>;
  if (error?.status === "REJECTED_CRYPTO" && http === 403) {
    return <AttackBlockedShield error={error} httpStatus={http} onInspect={onInspect} onReset={onNew} />;
  }
  if (error && (!record || record.status === "CHALLENGE_ISSUED")) return <ErrorCard error={error} action={actions} />;
  if (!record) return <Spinner label="Уточняем статус операции…" />;
  const waiting = record.status === "PENDING_COSIGN";
  const stopped = record.status === "BLOCKED_BY_COSIGNER";
  const executed = record.status === "EXECUTED";
  const Icon = waiting ? Clock : executed ? CircleCheck : Hand;
  const titles = { EXECUTED: "Операция выполнена без SMS", PENDING_COSIGN: "Ожидает Вторую руку", BLOCKED_BY_COSIGNER: "Вторая рука остановила операцию",
    EXPIRED: "Время подтверждения истекло", CHALLENGE_ISSUED: "Ожидает подписи", REJECTED_CRYPTO: "Атака отражена" };
  return <Card variant={waiting ? "warning" : executed || stopped ? "success" : "default"} className="space-y-4" aria-live="polite">
    <div className="flex items-start justify-between gap-2"><Icon className={waiting ? "text-gold" : "text-bcc"} size={32} /><Badge status={record.status} /></div>
    <h2 className="type-h1">{titles[record.status]}</h2>
    <div><p className="display-kpi">{formatTenge(record.payload.amountTenge)}</p><p className="mt-1 text-sm text-ink-secondary">{record.payload.recipientName}</p></div>
    {(waiting || stopped) && <div className="space-y-1 text-sm"><p>{waiting ? "Запрос на подпись" : "Решение принял участник"} · {cosigner}</p>
      <p className="text-ink-secondary">{waiting ? `Риск ${record.riskScore}/100. Средства ожидают подтверждения.` : "Деньги остались на счёте."}</p></div>}
    {executed && <p className="text-sm text-bcc">{record.cosignSignature ? "Обе стороны подтвердили операцию." : "WebAuthn и ML-DSA-65 проверены."}</p>}
    {record.failureCode && <p className="mono-data text-danger-text">{record.failureCode}</p>}
    <HashChip value={record.txHashHex} />
    {waiting && <Button variant="warning" size="sm" onClick={onCosign}>Открыть экран Второй руки</Button>}
    {actions}
  </Card>;
}
