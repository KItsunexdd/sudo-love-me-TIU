import { z } from "zod";
import { handle, json } from "@/lib/api/http";
import { text } from "@/lib/tx/inputs";
import { TransactionService } from "@/lib/tx/service";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = z.object({ id: text }).parse(await context.params);
    return json(await new TransactionService().getTransaction(id));
  });
}
