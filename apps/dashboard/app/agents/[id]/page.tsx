import { notFound } from "next/navigation";
import Link from "next/link";
import { TopNav } from "@/components/dashboard/top-nav";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAgent, listAgentRuns } from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string; workspaceId?: string }>;
};

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params, searchParams }: Params) {
  const { id } = await params;
  const scope = await searchParams;
  const tenantId = scope.tenantId;
  const workspaceId = scope.workspaceId;
  const agent = await getAgent(id, { tenantId, workspaceId });

  if (!agent) {
    notFound();
  }

  const runs = await listAgentRuns(id, { tenantId, workspaceId });
  const scopeQuery =
    tenantId && workspaceId
      ? `?tenantId=${encodeURIComponent(tenantId)}&workspaceId=${encodeURIComponent(workspaceId)}`
      : "";

  return (
    <main>
      <TopNav currentPath="" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <section className="flex flex-col gap-2">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{agent.name}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={agent.status} />
            <p className="text-sm text-muted-foreground">
              v{agent.version} | {agent.env} | owner: {agent.owner}
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Last Heartbeat</CardTitle>
            </CardHeader>
            <CardContent>{agent.lastHeartbeatAt}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Error Rate</CardTitle>
            </CardHeader>
            <CardContent>{agent.errorRate.toFixed(1)}%</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avg Latency</CardTitle>
            </CardHeader>
            <CardContent>{agent.avgLatencyMs} ms</CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Trace ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link href={`/runs/${run.id}${scopeQuery}`} className="font-medium hover:underline">
                        {run.id}
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
      </div>
    </main>
  );
}
