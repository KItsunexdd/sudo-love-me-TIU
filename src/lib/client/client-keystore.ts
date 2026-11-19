import { clearLocalDevices, listLocalDevices } from "@/lib/crypto/client-keystore";
import { api } from "./api";

export { clearLocalDevices, getLocalDevice, listLocalDevices, subscribeLocalDevices } from "@/lib/crypto/client-keystore";
export type { LocalDevice } from "@/lib/crypto/client-keystore";

// Replayed resets may arrive after a fresh registration on another tab.
export async function removeRevokedLocalDevices() {
  const local = await listLocalDevices();
  const removed: string[] = [];
  for (const userId of new Set(local.map(device => device.userId))) {
    const result = await api.listDevices(userId);
    if (!result.ok) throw new Error(result.error.message);
    const active = new Set(result.data.devices.map(device => device.id));
    for (const device of local) {
      if (device.userId === userId && !active.has(device.id)) removed.push(device.id);
    }
  }
  await clearLocalDevices(removed);
}
