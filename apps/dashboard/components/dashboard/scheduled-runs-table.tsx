import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScheduledRun } from "@/lib/dashboard-service";
import { formatDateTime } from "@/lib/format-date-time";

export function ScheduledRunsTable({ runs }: { runs: ScheduledRun[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Scheduled Runs</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No future scheduled runs.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Next Run At</TableHead>
                <TableHead>Objective</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>Agent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.jobId}>
                  <TableCell className="font-medium">
                    {run.scheduleType === "cron" ? `cron (${run.cronExpression})` : "one-off"}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(run.availableAt)}</TableCell>
                  <TableCell className="max-w-[420px] truncate">{run.objectivePrompt}</TableCell>
                  <TableCell>
                    <Link href={`/runs/${run.runId}`} className="hover:underline">
                      {run.runId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/agents/${run.agentId}`} className="hover:underline">
                      {run.agentId}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
