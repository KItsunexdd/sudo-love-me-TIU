import { query } from "@/lib/api/http";
import { eventFilter } from "@/lib/events/query";
import { streamEvents } from "@/lib/events/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = query(eventFilter, (filter, req) => streamEvents(req.signal, filter));
