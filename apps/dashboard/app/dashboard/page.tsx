import { HealthCards } from "@/components/dashboard/health-cards";
import { LiveEvents } from "@/components/dashboard/live-events";
import { RecentRunsTable } from "@/components/dashboard/recent-runs-table";
import { TopNav } from "@/components/dashboard/top-nav";
import { ControlPlanePanel } from "@/components/dashboard/control-plane-panel";
import { getMetrics, listRecentEvents, listRuns } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [metrics, runs, events] = await Promise.all([
    getMetrics(),
    listRuns(),
    listRecentEvents(5)
  ]);

  return (
    <main>
      <TopNav currentPath="/dashboard" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Operations Dashboard</h1>
          <p className="text-muted-foreground">Monitor agent health, trace failing runs, and triage incidents.</p>
        </section>
        <ControlPlanePanel />
        <HealthCards metrics={metrics} />
        <RecentRunsTable runs={runs} />
        <LiveEvents events={events} />
      </div>
    </main>
  );
}
