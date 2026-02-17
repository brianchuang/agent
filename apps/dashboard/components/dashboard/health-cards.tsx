import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardMetrics } from "@agent/observability";

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function HealthCards({ metrics }: { metrics: DashboardMetrics }) {
  const cards = [
    {
      label: "Healthy Agents",
      value: `${metrics.healthyAgents}/${metrics.totalAgents}`,
      tone: "text-emerald-600"
    },
    { label: "Avg Error Rate", value: pct(metrics.avgErrorRate), tone: "text-amber-600" },
    { label: "Avg Latency", value: `${metrics.avgLatencyMs} ms`, tone: "text-primary" },
    {
      label: "Failed Runs (24h)",
      value: String(metrics.failedRuns24h),
      tone: "text-destructive"
    }
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-semibold tracking-tight ${card.tone}`}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
