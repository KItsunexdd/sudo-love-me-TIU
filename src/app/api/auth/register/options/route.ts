import { json, post } from "@/lib/api/http";
import { beginRegistration } from "@/lib/devices/service";

export const POST = post(async body => json(await beginRegistration(body)));
