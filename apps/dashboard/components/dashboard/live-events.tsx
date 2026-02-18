import { RunEvent } from "@agent/observability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatDateTime } from "@/lib/format-date-time";

export function LiveEvents({ events }: { events: RunEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Event Strip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
            <div>
              <p className="text-sm font-medium">{event.message}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.ts)} | {event.runId}
              </p>
            </div>
            <StatusBadge status={event.level} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
