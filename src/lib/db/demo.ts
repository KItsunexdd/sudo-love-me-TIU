import { recipientPresets } from "./seed";
import { getStorage } from "./store";

export async function demoUsers() {
  const { users } = await getStorage().snapshot();
  const now = Date.now();
  return { users: users.map(user => ({ ...user, coolingOffUntil: user.coolingOffUntil ?? null,
    coolingOffActive: Date.parse(user.coolingOffUntil ?? "") > now })), recipientPresets };
}

export async function resetDemo(keepDevices: boolean) {
  await getStorage().resetDemo({ keepDevices });
  return { status: "RESET", keepDevices };
}
