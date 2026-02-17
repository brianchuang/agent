import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  if (status === "healthy" || status === "success") {
    return <Badge className="bg-emerald-600">{status}</Badge>;
  }

  if (status === "degraded" || status === "running") {
    return <Badge className="bg-amber-500">{status}</Badge>;
  }

  if (status === "failed" || status === "offline") {
    return <Badge variant="destructive">{status}</Badge>;
  }

  return <Badge variant="secondary">{status}</Badge>;
}
