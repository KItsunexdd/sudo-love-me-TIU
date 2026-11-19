import { json, post } from "@/lib/api/http";
import { TransactionService } from "@/lib/tx/service";

export const POST = post(async body => {
  const result = await new TransactionService().cosignReject(body);
  if (!result.ok) return json(result);
  const { status, savedAmountTenge, coolingOffActive } = result;
  return json({ status, savedAmountTenge, coolingOffActive });
});
