import Link from "next/link";
import { Run } from "@agent/observability";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function RecentRunsTable({ runs }: { runs: Run[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run ID</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Trace</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-medium">
                  <Link href={`/runs/${run.id}`} className="hover:underline">
                    {run.id}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/agents/${run.agentId}`} className="hover:underline">
                    {run.agentId}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell>{run.latencyMs ? `${run.latencyMs} ms` : "-"}</TableCell>
                <TableCell className="font-mono text-xs">{run.traceId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
