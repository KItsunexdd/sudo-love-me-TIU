"use client";

import { russian, type Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import { useState } from "react";
import { Fingerprint, Send, ShieldCheck } from "lucide-react";
import { RiskMeter } from "@/components/bank/RiskMeter";
import { LatencyBadge } from "@/components/crypto/LatencyBadge";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { AttackBlockedShield } from "@/components/hacker/AttackBlockedShield";
import {
  Badge, Button, Card, Drawer, EmptyState, ErrorCard, HashChip, JsonDiffViewer,
  Modal, PhoneFrame, SegmentedControl, Skeleton, Spinner, Toggle, useToast,
} from "@/components/ui";
import { api, type ApiError, type ExecuteResponse } from "@/lib/client/api";
import type { HybridSignature } from "@/lib/client/signer";
import { useDemoState } from "@/lib/client/useDemoState";
import type { TxStatus } from "@/lib/db/types";
import { formatTenge } from "@/lib/ui/format";

const userId = "usr_aigul";
const statuses: TxStatus[] = ["CHALLENGE_ISSUED", "PENDING_COSIGN", "EXECUTED", "REJECTED_CRYPTO", "BLOCKED_BY_COSIGNER", "EXPIRED"];
const getSamples = (t: Translate) => ([
  { value: "json", label: "JSON" },
  { value: "diff", label: t("kit.changes"), badgeCount: 1 },
] as const);
const sampleHash = "a3f9c812aa829e0c9eb72fde68f15ee9ed88bf6e43d828b64d2bc2fb7d4e91b0";
const receivedHash = "f10e44b9c155b1f3e5d989077db8a9517c87ab4d0ce2e9c46aca54efa2046e3e";
type Outcome = { type: "error"; error: ApiError; httpStatus?: number } |
  { type: "registered"; fingerprint: string } |
  { type: "transfer"; data: ExecuteResponse; timings: HybridSignature["timings"] };

function KitSmoke() {
  const { t } = useT();
  const { users, recipientPresets, connectionStatus, error: stateError } = useDemoState(userId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<"register" | "transfer" | null>(null);
  const { toast } = useToast();
  const aigul = users.find(user => user.id === userId);

  async function run(action: "register" | "transfer") {
    setBusy(action);
    setOutcome(null);
    try {
      const signer = await import("@/lib/client/signer");
      try {
        if (action === "register") {
          const device = await signer.registerDevice(userId, { preferSoftware: true, deviceName: "Браузер Айгуль" });
          setOutcome({ type: "registered", fingerprint: device.pqKeyFingerprint });
          toast({ titleKey: "kit.registered", tone: "success" });
          return;
        }
        const listed = await api.listDevices(userId);
        if (!listed.ok) return setOutcome({ type: "error", error: listed.error, httpStatus: listed.status });
        const active = new Set(listed.data.devices.map(device => device.id));
        const local = (await signer.listLocalDevices())
          .filter(device => device.userId === userId && device.deviceKind === "SOFTWARE_FALLBACK" && active.has(device.id))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (!local) {
          setOutcome({ type: "error", error: {
            status: "ERROR", failureCode: "ERR_DEVICE_NOT_REGISTERED", message: russian("kit.registerFirst"),
          } });
          return;
        }
        const recipient = recipientPresets?.son;
        if (!recipient) {
          setOutcome({ type: "error", error: {
            status: "ERROR", failureCode: "ERR_CLIENT", message: russian("kit.recipientUnavailable"),
          } });
          return;
        }
        const prepared = await api.prepare({
          ...recipient, amountTenge: 15_000, senderId: userId, mode: "B2C", operationType: "P2P_TRANSFER", purpose: "Демо-перевод Арману",
        });
        if (!prepared.ok) return setOutcome({ type: "error", error: prepared.error, httpStatus: prepared.status });
        const { txId, payload } = prepared.data;
        const { webAuthnAssertion, pqSignatureBase64, timings } = await signer.signPrimary(prepared.data, local.id);
        const result = await api.execute({ txId, deviceId: local.id, submittedPayload: payload, webAuthnAssertion, pqSignatureBase64 });
        if (!result.ok) return setOutcome({ type: "error", error: result.error, httpStatus: result.status });
        setOutcome({ type: "transfer", data: result.data, timings });
      } catch (cause) {
        setOutcome({ type: "error", error: signer.toClientError(cause) });
      }
    } catch {
      setOutcome({ type: "error", error: { status: "ERROR", failureCode: "ERR_CLIENT", message: russian("common.moduleUnavailable") } });
    } finally {
      setBusy(null);
    }
  }

  const connection = {
    connecting: { tone: "neutral", label: t("common.connecting") },
    live: { tone: "success", label: t("kit.events") },
    polling: { tone: "warning", label: t("common.polling") },
    offline: { tone: "danger", label: t("common.offline") },
  } as const;
  const verdict = outcome?.type === "transfer" ? outcome.data.transaction : undefined;

  return (
    <Card heading={<div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="type-h2">{t("kit.hybrid")}</h2>
      <Badge tone={connection[connectionStatus].tone}>{connection[connectionStatus].label}</Badge>
    </div>} divided>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-ink-secondary">{t("kit.fallbackIntro")} <span className="font-mono tabular-nums text-ink-primary">{formatTenge(15_000)}</span> {t("kit.fallbackDebit")}</p>
          <div>
            <p className="text-sm text-ink-secondary">{t("kit.balance")}</p>
            <p className="display-kpi mt-1">{aigul ? formatTenge(aigul.balanceTenge) : "—"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Fingerprint className="size-4" />} loading={busy === "register"} disabled={busy !== null}
              onClick={() => void run("register")}>{t("kit.enroll")}</Button>
            <Button icon={<Send className="size-4" />} loading={busy === "transfer"} disabled={busy !== null || !recipientPresets}
              onClick={() => void run("transfer")}>{t("kit.transfer")} {formatTenge(15_000)}</Button>
          </div>
          {stateError && <ErrorCard error={stateError} />}
          {outcome?.type === "registered" && <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{t("kit.deviceRegistered")}</Badge>
            <HashChip value={outcome.fingerprint} label={t("common.fingerprint")} />
          </div>}
          {outcome?.type === "error" && (outcome.error.status === "REJECTED_CRYPTO" && outcome.httpStatus === 403
            ? <AttackBlockedShield error={outcome.error} httpStatus={outcome.httpStatus} />
            : <ErrorCard error={outcome.error} />)}
          {verdict && outcome?.type === "transfer" && <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={verdict.status} />
              <LatencyBadge ms={outcome.timings.webauthnMs} label="WebAuthn" />
              <LatencyBadge ms={outcome.timings.pqSignMs} label="ML-DSA-65" />
            </div>
            <HashChip value={verdict.txHashHex} />
            <p className="break-all font-mono text-xs text-ink-muted">{verdict.id}</p>
          </div>}
        </div>
        <VerificationStepsList
          trace={verdict?.verificationTrace ?? (outcome?.type === "error" ? outcome.error.verificationTrace : undefined)}
          failureCode={outcome?.type === "error" ? outcome.error.failureCode : undefined}
        />
      </div>
    </Card>
  );
}

export function Kit() {
  const { t } = useT();
  const samples = getSamples(t);
  const [dialog, setDialog] = useState<"modal" | "drawer" | null>(null);
  const [toggle, setToggle] = useState(false);
  const [armed, setArmed] = useState(false);
  const [sample, setSample] = useState<(typeof samples)[number]["value"]>("json");
  const [riskScore, setRiskScore] = useState(40);
  const { toast } = useToast();

  return (
    <>
      <header>
        <h1 className="type-h1">{t("kit.heading")}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{t("kit.intro")}</p>
      </header>
      <KitSmoke />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card heading={<h2 className="type-h2">{t("kit.buttons")}</h2>} divided>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">{t("kit.primary")}</Button>
            <Button size="sm" variant="secondary">{t("kit.secondary")}</Button>
            <Button size="sm" variant="warning">{t("kit.attention")}</Button>
            <Button size="sm" variant="danger">{t("kit.stop")}</Button>
            <Button size="sm" variant="danger-outline">{t("kit.reject")}</Button>
            <Button size="sm" variant="ghost">{t("common.cancel")}</Button>
            <Button size="sm" variant="secondary" disabled>{t("kit.unavailable")}</Button>
          </div>
          <div className="my-4 flex flex-wrap items-center gap-2">
            {statuses.map(status => <Badge key={status} status={status} />)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Spinner />
            <Skeleton className="w-32" />
          </div>
          <div className="mt-4 space-y-3">
            <Toggle checked={toggle} onChange={setToggle} label={t("kit.notifications")} />
            <Toggle checked={armed} onChange={setArmed} label={t("kit.alertExample")} variant="attack" />
          </div>
        </Card>
        <Card variant="elevated" heading={<h2 className="type-h2">{t("kit.feedback")}</h2>} divided>
          <RiskMeter score={riskScore} reasons={riskScore === 40 ? [t("kit.unknownCall")] : []}
            codes={riskScore === 40 ? ["SUSPICIOUS_CALL_FLAG"] : []} />
          <input type="range" min={0} max={100} value={riskScore} aria-label={t("kit.riskExample")}
            className="mt-3 w-full accent-bcc" onChange={event => setRiskScore(event.currentTarget.valueAsNumber)} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDialog("modal")}>{t("kit.openModal")}</Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog("drawer")}>{t("kit.openDrawer")}</Button>
            <Button variant="ghost" size="sm" onClick={() => toast({ titleKey: "kit.notification", descriptionKey: "kit.exampleNotice" })}>{t("kit.showNotice")}</Button>
          </div>
        </Card>
        <Card variant="terminal" heading={<div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-h2">{t("kit.cryptoSamples")}</h2>
          <SegmentedControl label={t("kit.representation")} options={samples} value={sample} onChange={setSample} />
        </div>}>
          {sample === "json" ? <JsonDiffViewer signedHash={sampleHash} value={{
            origin: "http://localhost:3000", challenge: "o_nIEqqCngyesv3eaPFe6e2Iv25D2ChQ1C",
            amountTenge: 15_000, recipientAccount: "KZ148560000007721304", requiresCoSign: false,
          }} /> : <JsonDiffViewer signedHash={sampleHash} receivedHash={receivedHash}
            tamperDiff={[{ field: "amountTenge", original: "15000", tampered: "500000" }]} />}
        </Card>
        <Card heading={<h2 className="type-h2">{t("kit.emptyStates")}</h2>} divided>
          <div className="space-y-4">
            <PhoneFrame preset="compact" owner={t("kit.phone")}>
              <div className="p-3">
                <EmptyState icon={ShieldCheck} title={t("common.allClear")} description={t("kit.noPending")} />
              </div>
            </PhoneFrame>
            <ErrorCard error={{ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED", message: russian("kit.expired") }} />
          </div>
        </Card>
        <section aria-labelledby="kit-blocked-title" className="space-y-3">
          <h2 id="kit-blocked-title" className="type-h2">{t("kit.rejectionExample")}</h2>
          <AttackBlockedShield httpStatus={403} durationMs={3.8} error={{
            status: "REJECTED_CRYPTO", failureCode: "ERR_WYSIWYS_TAMPERED",
            message: russian("kit.responseExample"),
            tamperDiff: [{ field: "amountTenge", original: "15000", tampered: "500000" }],
          }} />
        </section>
      </div>
      <Modal title={t("kit.modal")} open={dialog === "modal"} onClose={() => setDialog(null)}
        footer={<Button size="sm" onClick={() => setDialog(null)}>{t("kit.done")}</Button>}>
        <p className="text-sm text-ink-secondary">{t("kit.focus")}</p>
      </Modal>
      <Drawer title={t("kit.drawer")} open={dialog === "drawer"} onClose={() => setDialog(null)}
        footer={<Button variant="secondary" size="sm" onClick={() => setDialog(null)}>{t("kit.closeDrawer")}</Button>}>
        <JsonDiffViewer value={{ txId: "tx_пример", amountTenge: 15000, currency: "KZT" }} />
      </Drawer>
    </>
  );
}
