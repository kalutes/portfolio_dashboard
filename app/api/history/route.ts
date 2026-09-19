import { NextRequest } from "next/server";
import { sessionCookie, validSession } from "@/lib/auth/session";
import {
  HistoryRevisionChanged,
  loadHistoricalDetail,
} from "@/lib/historical-store";
import { validHistoryDay } from "@/lib/historical-types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  if (!validSession(new NextRequest(request).cookies.get(sessionCookie)?.value))
    return Response.json(
      { error: "Sign in to continue." },
      { status: 401, headers },
    );
  const params = new URL(request.url).searchParams;
  const day = params.get("date") ?? "";
  const revision = params.get("revision") ?? "";
  if (!validHistoryDay(day) || !/^[a-f0-9]{64}$/.test(revision))
    return Response.json(
      { error: "Choose a valid historical date." },
      { status: 400, headers },
    );
  try {
    const detail = loadHistoricalDetail(day, revision);
    return detail
      ? Response.json(detail, { headers })
      : Response.json(
          { error: "No history for this date." },
          { status: 404, headers },
        );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof HistoryRevisionChanged
            ? "History was updated. Refresh the page to load the new database."
            : "Historical holdings are unavailable. Check the history database mount and retry.",
      },
      { status: error instanceof HistoryRevisionChanged ? 409 : 503, headers },
    );
  }
}
