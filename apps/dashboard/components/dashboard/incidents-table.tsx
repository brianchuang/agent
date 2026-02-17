import Link from "next/link";
import { Run } from "@agent/observability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export function IncidentsTable({ incidents }: { incidents: Run[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failed Runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((incident) => (
              <TableRow key={incident.id}>
                <TableCell>
                  <Link href={`/runs/${incident.id}`} className="font-medium hover:underline">
                    {incident.id}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/agents/${incident.agentId}`} className="hover:underline">
                    {incident.agentId}
                  </Link>
                </TableCell>
                <TableCell>{incident.errorSummary}</TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" variant="secondary">
                    Acknowledge
                  </Button>
                  <Button size="sm">Create Issue</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
