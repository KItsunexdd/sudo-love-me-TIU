import { z } from "zod";
import { json, post } from "@/lib/api/http";
import { resetDemo } from "@/lib/db/demo";

export const POST = post(async body => {
  const { keepDevices } = z.object({ keepDevices: z.boolean() }).parse(body);
  return json(await resetDemo(keepDevices));
});
