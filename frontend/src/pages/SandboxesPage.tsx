import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { Box, MoreHorizontal, PlayCircle, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, stateTone, type Sandbox } from "@/lib/api"
import { formatRelative, shortId } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import CreateSandboxDialog from "@/components/CreateSandboxDialog"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"
import { CopyButton } from "@/components/CopyButton"

export default function SandboxesPage() {
  const [stateFilter, setStateFilter] = useState<string>("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Sandbox | null>(null)
  const [search, setSearch] = useState("")
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["sandboxes", stateFilter],
    queryFn: () =>
      api.listSandboxes({
        pageSize: 100,
        state: stateFilter === "all" ? undefined : [stateFilter],
      }),
    refetchInterval: 5000,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteSandbox(id),
    onSuccess: (_data, id) => {
      toast({ title: "Sandbox terminated", description: shortId(id) })
      qc.invalidateQueries({ queryKey: ["sandboxes"] })
    },
    onError: (err: unknown) => {
      toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" })
    },
  })
  const pauseMut = useMutation({
    mutationFn: (id: string) => api.pauseSandbox(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sandboxes"] }),
    onError: (err: unknown) =>
      toast({ title: "Pause failed", description: (err as Error).message, variant: "destructive" }),
  })
  const resumeMut = useMutation({
    mutationFn: (id: string) => api.resumeSandbox(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sandboxes"] }),
    onError: (err: unknown) =>
      toast({ title: "Resume failed", description: (err as Error).message, variant: "destructive" }),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data?.items || []
    return (data?.items || []).filter((s) => {
      const name = (s.metadata?.name || "").toLowerCase()
      return (
        s.id.toLowerCase().includes(q) ||
        name.includes(q) ||
        (s.image?.uri || "").toLowerCase().includes(q)
      )
    })
  }, [data, search])

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sandboxes</h1>
          <p className="text-muted-foreground">
            Create, inspect, and manage OpenSandbox instances.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, image or id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 w-64"
            />
          </div>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Running">Running</SelectItem>
              <SelectItem value="Paused">Paused</SelectItem>
              <SelectItem value="Stopping">Stopping</SelectItem>
              <SelectItem value="Terminated">Terminated</SelectItem>
              <SelectItem value="Failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New sandbox
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Instances</CardTitle>
          <CardDescription>
            {data
              ? `${filtered.length}${
                  data.pagination.totalItems !== filtered.length ? ` of ${data.pagination.totalItems}` : ""
                } ${filtered.length === 1 ? "sandbox" : "sandboxes"}`
              : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / ID</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length > 0 ? (
                filtered.map((s) => (
                  <SandboxRow
                    key={s.id}
                    sandbox={s}
                    onDelete={() => setToDelete(s)}
                    onPause={() => pauseMut.mutate(s.id)}
                    onResume={() => resumeMut.mutate(s.id)}
                    onVscode={() => navigate(`/sandboxes/${s.id}/vscode`)}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-16">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Box className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium">
                        {search || stateFilter !== "all"
                          ? "No sandboxes match this filter"
                          : "No sandboxes yet"}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {search || stateFilter !== "all"
                          ? "Clear the filter or try a different search."
                          : "Launch a template, or create a new sandbox from scratch."}
                      </p>
                      {!(search || stateFilter !== "all") && (
                        <div className="flex gap-2 pt-2">
                          <Button size="sm" variant="outline" onClick={() => navigate("/templates")}>
                            Browse templates
                          </Button>
                          <Button size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> New sandbox
                          </Button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateSandboxDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false)
          qc.invalidateQueries({ queryKey: ["sandboxes"] })
          toast({ title: "Sandbox created", description: shortId(id) })
          navigate(`/sandboxes/${id}`)
        }}
      />

      <ConfirmDeleteDialog
        open={!!toDelete}
        title="Delete sandbox?"
        description={
          toDelete
            ? `Sandbox ${shortId(toDelete.id)} will be terminated. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.id)
          setToDelete(null)
        }}
      />
    </div>
  )
}

function SandboxRow({
  sandbox,
  onDelete,
  onPause,
  onResume,
  onVscode,
}: {
  sandbox: Sandbox
  onDelete: () => void
  onPause: () => void
  onResume: () => void
  onVscode: () => void
}) {
  const name = sandbox.metadata?.name || shortId(sandbox.id)
  const tone = stateTone[sandbox.status.state] || "secondary"
  return (
    <TableRow>
      <TableCell>
        <Link to={`/sandboxes/${sandbox.id}`} className="block font-medium hover:underline">
          {name}
        </Link>
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <span>{sandbox.id}</span>
          <CopyButton value={sandbox.id} />
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={tone as any}>{sandbox.status.state}</Badge>
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-xs">
        {sandbox.image?.uri || (sandbox.snapshotId ? `snapshot:${sandbox.snapshotId}` : "—")}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatRelative(sandbox.createdAt)}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {sandbox.expiresAt ? formatRelative(sandbox.expiresAt) : "manual cleanup"}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onVscode}
            disabled={sandbox.status.state !== "Running"}
          >
            <PlayCircle className="mr-1 h-3.5 w-3.5" /> VS Code
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/sandboxes/${sandbox.id}`}>Details</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={sandbox.status.state !== "Running"}
                onSelect={(e) => {
                  e.preventDefault()
                  onPause()
                }}
              >
                Pause
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={sandbox.status.state !== "Paused"}
                onSelect={(e) => {
                  e.preventDefault()
                  onResume()
                }}
              >
                Resume
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  onDelete()
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
