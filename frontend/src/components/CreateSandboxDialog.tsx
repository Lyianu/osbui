import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
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
import { api, type CreateSandboxRequest } from "@/lib/api"

interface Preset {
  id: string
  label: string
  description: string
  image: string
  entrypoint: string[]
  cpu: string
  memory: string
  metaHint?: string
}

const PRESETS: Preset[] = [
  {
    id: "vscode",
    label: "VS Code Web (opensandbox/vscode)",
    description: "Debian + code-server prewired for the panel's VS Code integration.",
    image: "opensandbox/vscode:latest",
    entrypoint: ["sleep", "infinity"],
    cpu: "1000m",
    memory: "1Gi",
    metaHint: "Use the VS Code button after the sandbox becomes Running.",
  },
  {
    id: "python",
    label: "Python 3.11",
    description: "Generic Python image, useful for scripting and experimentation.",
    image: "python:3.11",
    entrypoint: ["sleep", "infinity"],
    cpu: "500m",
    memory: "512Mi",
  },
  {
    id: "ubuntu",
    label: "Ubuntu 22.04",
    description: "Minimal Ubuntu image with a long-running shell.",
    image: "ubuntu:22.04",
    entrypoint: ["sleep", "infinity"],
    cpu: "500m",
    memory: "512Mi",
  },
  {
    id: "custom",
    label: "Custom image…",
    description: "Provide your own container image and entrypoint.",
    image: "",
    entrypoint: [],
    cpu: "500m",
    memory: "512Mi",
  },
]

export default function CreateSandboxDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (id: string) => void
}) {
  const [presetId, setPresetId] = useState<string>("vscode")
  const preset = PRESETS.find((p) => p.id === presetId)!
  const [name, setName] = useState("")
  const [image, setImage] = useState(preset.image)
  const [entrypoint, setEntrypoint] = useState(preset.entrypoint.join(" "))
  const [cpu, setCpu] = useState(preset.cpu)
  const [memory, setMemory] = useState(preset.memory)
  const [timeoutSec, setTimeoutSec] = useState<string>("3600")
  const [envText, setEnvText] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Sync fields when preset changes.
  const applyPreset = (id: string) => {
    setPresetId(id)
    const p = PRESETS.find((x) => x.id === id)!
    setImage(p.image)
    setEntrypoint(p.entrypoint.join(" "))
    setCpu(p.cpu)
    setMemory(p.memory)
  }

  const createMut = useMutation({
    mutationFn: async (): Promise<string> => {
      const metadata: Record<string, string> = {}
      if (name.trim()) metadata.name = name.trim()
      metadata["osbui.preset"] = presetId

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

      const entry = entrypoint.trim().split(/\s+/).filter(Boolean)
      if (!image.trim()) throw new Error("Image is required")
      if (entry.length === 0) throw new Error("Entrypoint is required (whitespace separated)")

      const timeout = timeoutSec.trim() === "" ? null : Number(timeoutSec)
      if (timeout !== null && (!Number.isFinite(timeout) || timeout < 60)) {
        throw new Error("Timeout must be empty (manual) or at least 60 seconds")
      }

      const body: CreateSandboxRequest = {
        image: { uri: image.trim() },
        entrypoint: entry,
        resourceLimits: { cpu, memory },
        timeout,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        env: Object.keys(env).length ? env : undefined,
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create sandbox</DialogTitle>
          <DialogDescription>
            Provision a new isolated execution environment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Preset</Label>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{preset.description}</p>
            {preset.metaHint && (
              <p className="text-xs text-muted-foreground">{preset.metaHint}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">Display name (optional)</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My sandbox"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="image">Image URI</Label>
            <Input
              id="image"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="python:3.11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="entrypoint">Entrypoint</Label>
            <Input
              id="entrypoint"
              value={entrypoint}
              onChange={(e) => setEntrypoint(e.target.value)}
              placeholder="sleep infinity"
            />
            <p className="text-xs text-muted-foreground">
              Whitespace separated. Example: <code>python /app/main.py</code>
            </p>
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
              <Input
                id="timeout"
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(e.target.value)}
                placeholder="3600 or blank"
              />
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

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
