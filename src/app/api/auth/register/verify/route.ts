import { json, post, requestOrigin } from "@/lib/api/http";
import { finishRegistration } from "@/lib/devices/service";

export const POST = post(async (body, req) => json(await finishRegistration(body, requestOrigin(req))));
