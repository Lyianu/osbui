import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Camera, ExternalLink, Loader2, Pause, Play, PlayCircle, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { api, stateTone } from "@/lib/api"
import { formatDate, formatRelative, shortId } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"

export default function SandboxDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [port, setPort] = useState("8443")
  const [snapshotName, setSnapshotName] = useState("")

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["sandbox", id],
    queryFn: () => api.getSandbox(id),
    refetchInterval: 5000,
    enabled: !!id,
  })

  const snapshotsQuery = useQuery({
    queryKey: ["snapshots", id],
    queryFn: () => api.listSnapshots({ sandboxId: id, pageSize: 50 }),
    enabled: !!id,
    refetchInterval: 10_000,
    retry: false,
  })
  const snapshotsUnsupported =
    snapshotsQuery.error instanceof Error &&
    (snapshotsQuery.error as any).status === 404

  const pauseMut = useMutation({
    mutationFn: () => api.pauseSandbox(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sandbox", id] }),
    onError: (e: unknown) => toast({ title: "Pause failed", description: (e as Error).message, variant: "destructive" }),
  })
  const resumeMut = useMutation({
    mutationFn: () => api.resumeSandbox(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sandbox", id] }),
    onError: (e: unknown) => toast({ title: "Resume failed", description: (e as Error).message, variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: () => api.deleteSandbox(id),
    onSuccess: () => {
      toast({ title: "Sandbox terminated" })
      navigate("/sandboxes")
    },
    onError: (e: unknown) => toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" }),
  })
  const renewMut = useMutation({
    mutationFn: async () => {
      // Extend 1 hour from now.
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      return api.renewSandbox(id, expiresAt)
    },
    onSuccess: () => {
      toast({ title: "Expiration extended by 1 hour" })
      qc.invalidateQueries({ queryKey: ["sandbox", id] })
    },
    onError: (e: unknown) => toast({ title: "Renew failed", description: (e as Error).message, variant: "destructive" }),
  })
  const endpointMut = useMutation({
    mutationFn: () => api.resolveEndpoint(id, Number(port)),
    onError: (e: unknown) => toast({ title: "Endpoint lookup failed", description: (e as Error).message, variant: "destructive" }),
  })
  const snapshotCreateMut = useMutation({
    mutationFn: () => api.createSnapshot(id, snapshotName.trim() || undefined),
    onSuccess: (snap) => {
      setSnapshotName("")
      toast({ title: "Snapshot started", description: shortId(snap.id) })
      qc.invalidateQueries({ queryKey: ["snapshots", id] })
      qc.invalidateQueries({ queryKey: ["snapshots"] })
    },
    onError: (e: unknown) => toast({ title: "Snapshot failed", description: (e as Error).message, variant: "destructive" }),
  })

  if (!id) return null

  const sandbox = data
  const tone = sandbox ? stateTone[sandbox.status.state] || "secondary" : "secondary"

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link to="/sandboxes">
              <ArrowLeft className="mr-1 h-4 w-4" /> All sandboxes
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {sandbox?.metadata?.name || shortId(id, 12)}
          </h1>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{id}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            Refresh
          </Button>
          <Button
            onClick={() => navigate(`/sandboxes/${id}/vscode`)}
            disabled={sandbox?.status.state !== "Running"}
          >
            <PlayCircle className="mr-2 h-4 w-4" /> Open VS Code
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {sandbox && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">State</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={tone as any} className="text-sm">
                  {sandbox.status.state}
                </Badge>
                {sandbox.status.message && (
                  <p className="mt-2 text-xs text-muted-foreground">{sandbox.status.message}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Created</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm">{formatDate(sandbox.createdAt)}</div>
                <div className="text-xs text-muted-foreground">{formatRelative(sandbox.createdAt)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Expires</CardTitle>
              </CardHeader>
              <CardContent>
                {sandbox.expiresAt ? (
                  <>
                    <div className="text-sm">{formatDate(sandbox.expiresAt)}</div>
                    <div className="text-xs text-muted-foreground">{formatRelative(sandbox.expiresAt)}</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Manual cleanup</div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-0"
                  onClick={() => renewMut.mutate()}
                  disabled={renewMut.isPending || !sandbox.expiresAt}
                >
                  {renewMut.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                  Extend +1h
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Specification</CardTitle>
                <CardDescription>Image, entrypoint, and metadata provided at creation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <KV label="Image" value={sandbox.image?.uri} mono />
                <KV label="Snapshot" value={sandbox.snapshotId} mono />
                <KV label="Entrypoint" value={sandbox.entrypoint?.join(" ")} mono />
                <Separator />
                <KV
                  label="Metadata"
                  value={
                    sandbox.metadata && Object.keys(sandbox.metadata).length
                      ? Object.entries(sandbox.metadata)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")
                      : "—"
                  }
                  mono
                />
                {sandbox.platform && (
                  <KV label="Platform" value={`${sandbox.platform.os}/${sandbox.platform.arch}`} mono />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sandbox.status.state !== "Running" || pauseMut.isPending}
                    onClick={() => pauseMut.mutate()}
                  >
                    {pauseMut.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pause className="mr-1 h-3.5 w-3.5" />
                    )}
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sandbox.status.state !== "Paused" || resumeMut.isPending}
                    onClick={() => resumeMut.mutate()}
                  >
                    {resumeMut.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1 h-3.5 w-3.5" />
                    )}
                    Resume
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>

                <Separator />
                <div className="space-y-2">
                  <Label>Resolve endpoint for port</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-28"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="8443"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => endpointMut.mutate()}
                      disabled={endpointMut.isPending || sandbox.status.state !== "Running"}
                    >
                      {endpointMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      Resolve
                    </Button>
                  </div>
                  {endpointMut.data && (
                    <div className="space-y-1 rounded-md border bg-muted/40 p-2 font-mono text-xs">
                      <div>direct: {endpointMut.data.direct}</div>
                      <div>
                        proxy:{" "}
                        <a
                          href={endpointMut.data.proxy}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {endpointMut.data.proxy}
                          <ExternalLink className="ml-1 inline h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                {!snapshotsUnsupported && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        <Camera className="h-3.5 w-3.5" /> Create snapshot
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          value={snapshotName}
                          onChange={(e) => setSnapshotName(e.target.value)}
                          placeholder="Optional name"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => snapshotCreateMut.mutate()}
                          disabled={
                            snapshotCreateMut.isPending ||
                            !(sandbox.status.state === "Running" || sandbox.status.state === "Paused")
                          }
                        >
                          {snapshotCreateMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          Create
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {!snapshotsUnsupported && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshots</CardTitle>
              <CardDescription>Persistent captures created from this sandbox.</CardDescription>
            </CardHeader>
            <CardContent>
              {snapshotsQuery.isLoading ? (
                <div className="py-6 text-center text-muted-foreground">Loading…</div>
              ) : snapshotsQuery.data?.items?.length ? (
                <div className="space-y-2">
                  {snapshotsQuery.data.items.map((snap) => (
                    <div
                      key={snap.id}
                      className="flex items-center justify-between rounded-md border p-2 text-sm"
                    >
                      <div>
                        <div className="font-mono text-xs">{snap.id}</div>
                        <div className="text-xs text-muted-foreground">
                          {snap.name ? `${snap.name} · ` : ""}{formatRelative(snap.createdAt)}
                        </div>
                      </div>
                      <Badge variant={snap.status.state === "Ready" ? "success" : "secondary"}>
                        {snap.status.state}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">No snapshots yet.</div>
              )}
            </CardContent>
          </Card>
          )}
        </>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        title="Delete sandbox?"
        description={`This terminates sandbox ${shortId(id)} and cannot be undone.`}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false)
          deleteMut.mutate()
        }}
      />
    </div>
  )
}

function KV({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "max-w-[60%] truncate text-right font-mono text-xs" : "text-right"}>
        {value || "—"}
      </div>
    </div>
  )
}
