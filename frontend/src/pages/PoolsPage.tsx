import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Layers, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { api, type Pool } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"

export default function PoolsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Pool | null>(null)

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["pools"],
    queryFn: () => api.listPools(),
    refetchInterval: 10_000,
    retry: false,
  })
  const apiErr = error as any
  const unsupported =
    apiErr?.payload?.code === "KUBERNETES::POOL_NOT_SUPPORTED" ||
    /KUBERNETES::POOL_NOT_SUPPORTED/.test(apiErr?.message || "") ||
    apiErr?.status === 400

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.deletePool(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pools"] })
      toast({ title: "Pool deleted" })
    },
    onError: (e: unknown) =>
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" }),
  })

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pools</h1>
          <p className="text-muted-foreground">
            Pre-warmed sandbox pools for low-latency provisioning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={unsupported}>
            <Plus className="mr-2 h-4 w-4" /> New pool
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All pools</CardTitle>
          <CardDescription>
            {unsupported
              ? "The active runtime does not implement pools."
              : data
              ? `${data.items?.length ?? 0} pool${(data.items?.length ?? 0) === 1 ? "" : "s"}`
              : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unsupported ? (
            <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/40 p-8 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" />
              <div className="text-sm font-medium">Pools are a Kubernetes-only feature</div>
              <p className="max-w-md text-xs text-muted-foreground">
                The OpenSandbox server tells us pool management is not available in this
                runtime. Switch the upstream server to <code>runtime.type = "kubernetes"</code>
                to enable warm pools.
              </p>
            </div>
          ) : isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading…</div>
          ) : (data?.items?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Layers className="h-8 w-8" />
              <div className="text-sm font-medium">No pools yet</div>
              <p className="text-xs">Create one to keep a few sandboxes warm.</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Create pool
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.items!.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-mono text-xs">{p.name}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs">{p.image?.uri || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={p.status?.state === "Ready" ? "success" : "secondary"}>
                        {p.status?.state || "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.status?.ready ?? 0}/{p.size ?? p.status?.size ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => setToDelete(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreatePoolDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["pools"] })
          setCreateOpen(false)
        }}
      />
      <ConfirmDeleteDialog
        open={!!toDelete}
        title="Delete pool?"
        description={toDelete ? `Pool ${toDelete.name} will be removed.` : ""}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.name)
          setToDelete(null)
        }}
      />
    </div>
  )
}

function CreatePoolDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [image, setImage] = useState("opensandbox/vscode:latest")
  const [size, setSize] = useState("3")
  const [cpu, setCpu] = useState("500m")
  const [memory, setMemory] = useState("512Mi")
  const [err, setErr] = useState<string | null>(null)
  const { toast } = useToast()

  const createMut = useMutation({
    mutationFn: () =>
      api.createPool({
        name: name.trim(),
        image: { uri: image.trim() },
        size: Number(size) || 0,
        resourceLimits: { cpu, memory },
      }),
    onSuccess: () => {
      toast({ title: "Pool created" })
      onCreated()
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message
      setErr(msg)
      toast({ title: "Create failed", description: msg, variant: "destructive" })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create pool</DialogTitle>
          <DialogDescription>Pre-warm a fixed number of sandboxes for fast provisioning.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="pool-name">Name</Label>
            <Input id="pool-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="vscode-warm" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pool-image">Image</Label>
            <Input id="pool-image" value={image} onChange={(e) => setImage(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="pool-size">Size</Label>
              <Input id="pool-size" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pool-cpu">CPU</Label>
              <Input id="pool-cpu" value={cpu} onChange={(e) => setCpu(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pool-mem">Memory</Label>
              <Input id="pool-mem" value={memory} onChange={(e) => setMemory(e.target.value)} />
            </div>
          </div>
          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {err}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name.trim() || !image.trim() || createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
