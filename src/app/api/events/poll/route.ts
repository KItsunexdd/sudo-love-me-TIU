import { json, query } from "@/lib/api/http";
import { pollEvents } from "@/lib/events/bus";
import { pollFilter } from "@/lib/events/query";

export const GET = query(pollFilter, ({ since, ...filter }) => json(pollEvents(since ?? 0, filter)));
