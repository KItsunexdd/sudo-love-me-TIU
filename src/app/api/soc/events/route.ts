import { emptyQuery, json, query } from "@/lib/api/http";
import { socReport } from "@/lib/soc/service";

export const GET = query(emptyQuery, async () => json(await socReport()));
