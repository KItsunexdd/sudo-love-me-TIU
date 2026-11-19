import { z } from "zod";
import { json, query } from "@/lib/api/http";
import { listDevices, revokeDevice } from "@/lib/devices/service";
import { text } from "@/lib/tx/inputs";

export const GET = query(z.object({ userId: text }).strict(), async ({ userId }) => json(await listDevices(userId)));
export const DELETE = query(z.object({ id: text }).strict(), async ({ id }) => json(await revokeDevice(id)));
