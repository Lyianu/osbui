import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type Snapshot } from "@/lib/api"
import { formatRelative, shortId } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"

export default function SnapshotsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [toDelete, setToDelete] = useState<Snapshot | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["snapshots", "all"],
    queryFn: () => api.listSnapshots({ pageSize: 100 }),
    refetchInterval: 10_000,
    retry: false,
  })
  const unsupported =
    error instanceof Error && (error as any).status === 404

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteSnapshot(id),
    onSuccess: () => {
      toast({ title: "Snapshot deleted" })
      qc.invalidateQueries({ queryKey: ["snapshots"] })
    },
    onError: (e: unknown) => toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" }),
  })

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
          <p className="text-muted-foreground">Persistent captures of sandbox state.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All snapshots</CardTitle>
          <CardDescription>
            {data ? `${data.pagination.totalItems} total` : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unsupported && (
            <div className="rounded-md border bg-muted/50 p-4 text-sm text-muted-foreground">
              The upstream OpenSandbox server does not expose the snapshots API.
              This is normal for the Docker runtime or older server builds.
            </div>
          )}
          {error && !unsupported && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Snapshot</TableHead>
                <TableHead>Source sandbox</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data?.items && data.items.length > 0 ? (
                data.items.map((snap) => (
                  <TableRow key={snap.id}>
                    <TableCell>
                      <div className="font-medium">{snap.name || shortId(snap.id)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{snap.id}</div>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/sandboxes/${snap.sandboxId}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {shortId(snap.sandboxId, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={snap.status.state === "Ready" ? "success" : "secondary"}>
                        {snap.status.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelative(snap.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(snap)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No snapshots. Create one from a sandbox's detail page.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDeleteDialog
        open={!!toDelete}
        title="Delete snapshot?"
        description={toDelete ? `Snapshot ${shortId(toDelete.id)} will be deleted permanently.` : ""}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.id)
          setToDelete(null)
        }}
      />
    </div>
  )
}
