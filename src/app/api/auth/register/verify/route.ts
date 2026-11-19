import { json, post, requestOrigin, targetOrigin } from "@/lib/api/http";
import { finishRegistration } from "@/lib/devices/service";

export const POST = post(async (body, req) => json(await finishRegistration(body, requestOrigin(req), targetOrigin(req))));
