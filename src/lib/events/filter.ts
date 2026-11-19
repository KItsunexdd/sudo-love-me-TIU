import type { SecurityEvent, TxStatus } from "@/lib/db/types";

interface Participants { senderId?: string; cosignerUserId?: string }
export type DemoEvent =
  | { type: "COSIGN_REQUESTED"; txId: string; senderId: string; cosignerUserId: string }
  | ({ type: "TX_UPDATED"; txId: string; status: TxStatus } & Participants)
  | ({ type: "SECURITY_ALERT"; event: SecurityEvent } & Participants)
  | { type: "DEMO_RESET"; keepDevices: boolean };

export interface EventFilter { userId?: string; channel?: "cosign" | "soc" }

export function matches(event: DemoEvent, { userId, channel }: EventFilter) {
  if (event.type === "DEMO_RESET") return true;
  if (userId && userId !== event.cosignerUserId && event.senderId !== userId) return false;
  if (channel === "soc") return event.type !== "COSIGN_REQUESTED";
  if (!userId) return false;
  if (channel === "cosign") return event.cosignerUserId === userId && (event.type === "COSIGN_REQUESTED" ||
    (event.type === "TX_UPDATED" && event.status !== "CHALLENGE_ISSUED"));
  return true;
}
