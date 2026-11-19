import { json, post, requestOrigin } from "@/lib/api/http";
import { TransactionService } from "@/lib/tx/service";

export const POST = post(async (body, req) => {
  const result = await new TransactionService().execute(body, requestOrigin(req));
  if (!result.ok) return json(result);
  const { status, transaction, cosigner, verificationTrace } = result;
  return status === "PENDING_COSIGN" ? json({ status, transaction, cosigner }, 202) : json({ status, transaction, verificationTrace });
});
