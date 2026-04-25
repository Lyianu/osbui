import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, type CreateSandboxRequest, type NetworkRule, type Volume } from "@/lib/api"
import { listTemplates, type SandboxTemplate } from "@/lib/templates"

type Source = "image" | "snapshot"

export default function CreateSandboxDialog({
  open,
  onOpenChange,
  onCreated,
  prefill,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (id: string) => void
  prefill?: SandboxTemplate
}) {
  const [templates, setTemplates] = useState<SandboxTemplate[]>([])
  const [templateId, setTemplateId] = useState<string>(prefill?.id || "builtin-vscode")
  const selected = templates.find((t) => t.id === templateId) || templates[0]

  const [source, setSource] = useState<Source>("image")
  const [snapshotId, setSnapshotId] = useState("")

  const [name, setName] = useState("")
  const [image, setImage] = useState("")
  const [entrypoint, setEntrypoint] = useState("")
  const [cpu, setCpu] = useState("500m")
  const [memory, setMemory] = useState("512Mi")
  const [timeoutSec, setTimeoutSec] = useState<string>("3600")
  const [envText, setEnvText] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Advanced — network policy
  const [defaultAction, setDefaultAction] = useState<"" | "allow" | "deny">("")
  const [egressRules, setEgressRules] = useState<NetworkRule[]>([])
  // Advanced — volumes
  const [volumes, setVolumes] = useState<Volume[]>([])

  const snapshotsQuery = useQuery({
    queryKey: ["snapshots", "list-for-create"],
    queryFn: () => api.listSnapshots({ pageSize: 100 }),
    retry: false,
    enabled: open && source === "snapshot",
  })
  const snapshotsUnsupported =
    snapshotsQuery.error instanceof Error && (snapshotsQuery.error as any).status === 404

  useEffect(() => {
    if (open) setTemplates(listTemplates())
  }, [open])

  useEffect(() => {
    const t = prefill || templates.find((t) => t.id === templateId) || templates[0]
    if (!t) return
    setImage(t.image)
    setEntrypoint(t.entrypoint.join(" "))
    setCpu(t.cpu)
    setMemory(t.memory)
    setTimeoutSec(t.timeout === null ? "" : String(t.timeout))
    if (t.env) {
      setEnvText(Object.entries(t.env).map(([k, v]) => `${k}=${v}`).join("\n"))
    } else {
      setEnvText("")
    }
    if (prefill) setTemplateId(prefill.id)
  }, [templateId, templates, prefill])

  const createMut = useMutation({
    mutationFn: async (): Promise<string> => {
      const metadata: Record<string, string> = {}
      if (name.trim()) {
        const safe = name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "")
          .slice(0, 63)
        if (safe) metadata.name = safe
      }
      if (selected) metadata["osbui.template"] = selected.id

      const env: Record<string, string> = {}
      for (const line of envText.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const idx = trimmed.indexOf("=")
        if (idx < 0) throw new Error(`Invalid env line (expected KEY=VALUE): ${trimmed}`)
        const k = trimmed.slice(0, idx).trim()
        const v = trimmed.slice(idx + 1).trim()
        if (!k) throw new Error(`Invalid env line: ${trimmed}`)
        env[k] = v
      }

      const body: CreateSandboxRequest = {
        resourceLimits: { cpu, memory },
        timeout: timeoutSec.trim() === "" ? null : Number(timeoutSec),
        metadata: Object.keys(metadata).length ? metadata : undefined,
        env: Object.keys(env).length ? env : undefined,
      }
      if (body.timeout !== null && (!Number.isFinite(body.timeout!) || body.timeout! < 60)) {
        throw new Error("Timeout must be empty (manual) or at least 60 seconds")
      }

      if (source === "image") {
        if (!image.trim()) throw new Error("Image is required")
        const entry = entrypoint.trim().split(/\s+/).filter(Boolean)
        if (entry.length === 0) throw new Error("Entrypoint is required (whitespace separated)")
        body.image = { uri: image.trim() }
        body.entrypoint = entry
      } else {
        if (!snapshotId.trim()) throw new Error("Snapshot id is required")
        body.snapshotId = snapshotId.trim()
        // entrypoint is forbidden when restoring from a snapshot
      }

      if (defaultAction || egressRules.length > 0) {
        body.networkPolicy = {
          defaultAction: defaultAction || undefined,
          egress: egressRules.length ? egressRules : undefined,
        }
      }
      if (volumes.length > 0) {
        body.volumes = volumes.filter((v) => v.name.trim() && v.mountPath.trim())
      }

      const res = await api.createSandbox(body)
      return res.id
    },
    onError: (err: unknown) => setError((err as Error).message),
    onSuccess: (id) => {
      setError(null)
      onCreated(id)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create sandbox</DialogTitle>
          <DialogDescription>Provision a new isolated execution environment.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="space-y-3 pt-3">
            <div className="grid gap-2">
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Container image</SelectItem>
                  <SelectItem value="snapshot">Restore from snapshot</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {source === "image" ? (
              <>
                <div className="grid gap-2">
                  <Label>Template</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="image">Image URI</Label>
                  <Input id="image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="python:3.11" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="entrypoint">Entrypoint</Label>
                  <Input
                    id="entrypoint"
                    value={entrypoint}
                    onChange={(e) => setEntrypoint(e.target.value)}
                    placeholder="sleep infinity"
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="snapshot">Snapshot id</Label>
                {snapshotsUnsupported ? (
                  <Input
                    id="snapshot"
                    value={snapshotId}
                    onChange={(e) => setSnapshotId(e.target.value)}
                    placeholder="snap-…"
                  />
                ) : (
                  <Select value={snapshotId} onValueChange={setSnapshotId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a snapshot" />
                    </SelectTrigger>
                    <SelectContent>
                      {(snapshotsQuery.data?.items || []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name || s.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  When restoring from a snapshot, the entrypoint is replayed from the captured state.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="name">Display name (optional)</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-sandbox" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="cpu">CPU</Label>
                <Input id="cpu" value={cpu} onChange={(e) => setCpu(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="memory">Memory</Label>
                <Input id="memory" value={memory} onChange={(e) => setMemory(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="timeout">Timeout (s)</Label>
                <Input id="timeout" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} placeholder="3600 or blank" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="env">Environment variables</Label>
              <Textarea
                id="env"
                rows={3}
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={"KEY=value\nDEBUG=1"}
                className="font-mono text-xs"
              />
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 pt-3">
            <Section title="Network policy" hint="Egress rules evaluated in order. Default action applies when no rule matches.">
              <div className="grid gap-2">
                <Label>Default action</Label>
                <Select value={defaultAction || "default"} onValueChange={(v) => setDefaultAction(v === "default" ? "" : (v as "allow" | "deny"))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">(server default)</SelectItem>
                    <SelectItem value="allow">allow</SelectItem>
                    <SelectItem value="deny">deny</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Egress rules</Label>
                {egressRules.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={r.action}
                      onValueChange={(v) => updateAt(setEgressRules, i, { ...r, action: v as "allow" | "deny" })}
                    >
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow">allow</SelectItem>
                        <SelectItem value="deny">deny</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={r.target}
                      onChange={(e) => updateAt(setEgressRules, i, { ...r, target: e.target.value })}
                      placeholder="example.com or *.pypi.org"
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setEgressRules(egressRules.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEgressRules([...egressRules, { action: "allow", target: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
                </Button>
              </div>
            </Section>

            <Section title="Volumes" hint="Mount host paths or named volumes inside the sandbox.">
              {volumes.map((v, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      value={v.name}
                      onChange={(e) => updateAt(setVolumes, i, { ...v, name: e.target.value })}
                      placeholder="name (lowercase)"
                      className="flex-1"
                    />
                    <Input
                      value={v.mountPath}
                      onChange={(e) => updateAt(setVolumes, i, { ...v, mountPath: e.target.value })}
                      placeholder="/mnt/data"
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setVolumes(volumes.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={v.host ? "host" : v.pvc ? "pvc" : "host"}
                      onValueChange={(t) => {
                        if (t === "host")
                          updateAt(setVolumes, i, { name: v.name, mountPath: v.mountPath, host: { path: v.host?.path || "/tmp" } })
                        else if (t === "pvc")
                          updateAt(setVolumes, i, { name: v.name, mountPath: v.mountPath, pvc: { claimName: v.pvc?.claimName || v.name, createIfNotExists: true } })
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="host">Host bind</SelectItem>
                        <SelectItem value="pvc">Named volume</SelectItem>
                      </SelectContent>
                    </Select>
                    {v.host && (
                      <Input
                        className="col-span-2"
                        value={v.host.path}
                        onChange={(e) => updateAt(setVolumes, i, { ...v, host: { path: e.target.value } })}
                        placeholder="/host/path"
                      />
                    )}
                    {v.pvc && (
                      <Input
                        className="col-span-2"
                        value={v.pvc.claimName}
                        onChange={(e) => updateAt(setVolumes, i, { ...v, pvc: { ...v.pvc!, claimName: e.target.value } })}
                        placeholder="claim name"
                      />
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setVolumes([
                    ...volumes,
                    { name: `vol-${volumes.length + 1}`, mountPath: "/mnt/data", host: { path: "/tmp" } },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add volume
              </Button>
            </Section>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/40"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

function updateAt<T>(setter: (fn: (prev: T[]) => T[]) => void, idx: number, next: T): void
function updateAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, idx: number, next: T): void
function updateAt<T>(setter: any, idx: number, next: T) {
  setter((prev: T[]) => prev.map((v, i) => (i === idx ? next : v)))
}
