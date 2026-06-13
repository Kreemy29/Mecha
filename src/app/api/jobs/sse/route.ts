import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      const poll = () => {
        try {
          const jobs = db
            .select()
            .from(schema.jobs)
            .orderBy(desc(schema.jobs.createdAt))
            .limit(100)
            .all();
          send({ type: "jobs", data: jobs });
        } catch {
          // db may be busy, skip this tick
        }
      };

      poll();
      const interval = setInterval(poll, 2000);

      const cleanup = () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Close after 5 minutes to prevent stale connections
      setTimeout(cleanup, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
