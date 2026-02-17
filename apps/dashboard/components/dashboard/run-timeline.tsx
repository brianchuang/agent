import { RunEvent } from "@agent/observability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";

export function RunTimeline({ events }: { events: RunEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">{event.message}</p>
                <StatusBadge status={event.level} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">{event.ts}</p>
              <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
