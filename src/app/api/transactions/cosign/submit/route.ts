import { json, post, requestOrigin } from "@/lib/api/http";
import { TransactionService } from "@/lib/tx/service";

export const POST = post(async (body, req) => {
  const result = await new TransactionService().cosignSubmit(body, requestOrigin(req));
  return result.ok ? json({ status: result.status, transaction: result.transaction }) : json(result);
});
