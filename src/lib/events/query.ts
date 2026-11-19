import { z } from "zod";
import { text } from "@/lib/tx/inputs";

export const eventFilter = z.object({ userId: text.optional(), channel: z.enum(["cosign", "soc"]).optional() }).strict();
const cursor = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.iso.datetime({ offset: true }).transform(s => Date.parse(s)),
]).pipe(z.number().int().nonnegative());
export const pollFilter = eventFilter.extend({ since: cursor.optional() });
