import type { Mode } from "@/lib/db/types";

export const demoParticipants = {
  B2C: { senderId: "usr_aigul", cosignerId: "usr_arman" },
  B2B: { senderId: "usr_dinara", cosignerId: "usr_timur" },
} as const satisfies Record<Mode, { senderId: string; cosignerId: string }>;
