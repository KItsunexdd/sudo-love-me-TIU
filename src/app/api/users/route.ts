import { emptyQuery, json, query } from "@/lib/api/http";
import { demoUsers } from "@/lib/db/demo";

export const GET = query(emptyQuery, async () => json(await demoUsers()));
