import { TopNav } from "@/components/dashboard/top-nav";
import { IncidentsTable } from "@/components/dashboard/incidents-table";
import { listIncidents } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const incidents = await listIncidents();

  return (
    <main>
      <TopNav currentPath="/incidents" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Incidents</h1>
          <p className="text-muted-foreground">Failed runs grouped for quick acknowledgement and issue creation.</p>
        </section>
        <IncidentsTable incidents={incidents} />
      </div>
    </main>
  );
}
