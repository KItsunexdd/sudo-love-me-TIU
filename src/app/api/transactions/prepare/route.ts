import { json, post } from "@/lib/api/http";
import { TransactionService } from "@/lib/tx/service";

export const POST = post(async body => {
  const result = await new TransactionService().prepare(body);
  if (!result.ok) return json(result);
  const { txId, payload, canonicalJson, txHashHex, risk, webAuthnOptions } = result;
  return json({ txId, payload, canonicalJson, txHashHex, risk, webAuthnOptions });
});
