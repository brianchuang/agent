import { notFound } from "next/navigation";
import Link from "next/link";
import { TopNav } from "@/components/dashboard/top-nav";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { RunTimeline } from "@/components/dashboard/run-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRun, listRunEvents } from "@/lib/dashboard-service";

type Params = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ tenantId?: string; workspaceId?: string }>;
};

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params, searchParams }: Params) {
  const { runId } = await params;
  const scope = await searchParams;
  const tenantId = scope.tenantId;
  const workspaceId = scope.workspaceId;
  const run = await getRun(runId, { tenantId, workspaceId });

  if (!run) {
    notFound();
  }

  const events = await listRunEvents(run.id, { tenantId, workspaceId });

  return (
    <main>
      <TopNav currentPath="" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <section className="flex flex-col gap-2">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Run {run.id}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <p className="font-mono text-sm text-muted-foreground">trace: {run.traceId}</p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Started</CardTitle>
            </CardHeader>
            <CardContent>{run.startedAt}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ended</CardTitle>
            </CardHeader>
            <CardContent>{run.endedAt ?? "Running"}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Retries</CardTitle>
            </CardHeader>
            <CardContent>{run.retries}</CardContent>
          </Card>
        </section>

        <RunTimeline events={events} />
      </div>
    </main>
  );
}
