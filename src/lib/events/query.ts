import { z } from "zod";
import { text } from "@/lib/tx/inputs";

const filter = z.object({ userId: text.optional(), channel: z.enum(["cosign", "soc"]).optional() }).strict();
const cursor = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.iso.datetime({ offset: true }).transform(s => Date.parse(s)),
]).pipe(z.number().int().nonnegative());
const hasCosigner = (params: z.infer<typeof filter>) => params.channel !== "cosign" || Boolean(params.userId);
const missingCosigner = { message: "Для канала второй подписи укажите userId" };
export const eventFilter = filter.refine(hasCosigner, missingCosigner);
export const pollFilter = filter.extend({ since: cursor.optional() }).refine(hasCosigner, missingCosigner);
