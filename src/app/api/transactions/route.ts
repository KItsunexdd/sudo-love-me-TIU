import { z } from "zod";
import { json, query } from "@/lib/api/http";
import { text } from "@/lib/tx/inputs";
import { TransactionService } from "@/lib/tx/service";

const filter = z.object({
  status: z.enum(["CHALLENGE_ISSUED", "PENDING_COSIGN", "EXECUTED", "REJECTED_CRYPTO", "BLOCKED_BY_COSIGNER", "EXPIRED"]).optional(),
  userId: text.optional(),
}).strict();
export const GET = query(filter, async params => json(await new TransactionService().listTransactions(params)));
