import { json, post } from "@/lib/api/http";
import { TransactionService } from "@/lib/tx/service";

export const POST = post(async body => json(await new TransactionService().preview(body)));
