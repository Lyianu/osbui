import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2, Play, RefreshCw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

interface ServiceDef {
  id: string
  name: string
  description: string
  defaultPort: number
  // Command runs in background. Should listen on `defaultPort`.
  command: (port: number) => string
  // Optional: build a URL to open the service. Defaults to "/" on the proxy.
  openPath?: string
  // pgrep token to detect if it's running.
  detect: string
  // Whether the service is HTTP (UI can offer "Open" button).
  http?: boolean
}

const SERVICES: ServiceDef[] = [
  {
    id: "jupyter",
    name: "JupyterLab",
    description: "Notebook + kernel server for interactive Python.",
    defaultPort: 8888,
    detect: "jupyter",
    http: true,
    openPath: "/lab",
    command: (port) =>
      `(pip install --quiet jupyter jupyterlab >/dev/null 2>&1 || true) && ` +
      `jupyter lab --no-browser --ip=0.0.0.0 --port=${port} ` +
      `--ServerApp.token='' --ServerApp.password='' ` +
      `--ServerApp.disable_check_xsrf=True --ServerApp.allow_origin='*' ` +
      `--ServerApp.tornado_settings='{"headers":{"Content-Security-Policy":"frame-ancestors *"}}' ` +
      `--notebook-dir=/workspace`,
  },
  {
    id: "http",
    name: "Static HTTP",
    description: "python -m http.server pinned at /workspace.",
    defaultPort: 8000,
    detect: "http.server",
    http: true,
    command: (port) => `python3 -m http.server ${port} --directory /workspace`,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Apt-installed postgres bound to localhost.",
    defaultPort: 5432,
    detect: "postgres",
    command: () =>
      `(command -v pg_ctlcluster >/dev/null 2>&1 || (apt-get update >/dev/null 2>&1 && apt-get install -y postgresql >/dev/null 2>&1)) && ` +
      `service postgresql start && tail -F /var/log/postgresql/*.log`,
  },
  {
    id: "redis",
    name: "Redis",
    description: "Lightweight in-memory KV store.",
    defaultPort: 6379,
    detect: "redis-server",
    command: (port) =>
      `(command -v redis-server >/dev/null 2>&1 || (apt-get update >/dev/null 2>&1 && apt-get install -y redis-server >/dev/null 2>&1)) && ` +
      `redis-server --port ${port} --bind 0.0.0.0 --protected-mode no`,
  },
  {
    id: "vscode",
    name: "VS Code Web",
    description: "code-server for browser-based editing.",
    defaultPort: 8443,
    detect: "code-server",
    http: true,
    openPath: "/?folder=/workspace",
    command: (port) =>
      `(command -v code-server >/dev/null 2>&1 || (curl -fsSL https://code-server.dev/install.sh | sh >/dev/null 2>&1)) && ` +
      `code-server --bind-addr 0.0.0.0:${port} --auth none /workspace`,
  },
  {
    id: "streamlit",
    name: "Streamlit demo",
    description: "Pip install + run a hello-world Streamlit app.",
    defaultPort: 8501,
    detect: "streamlit",
    http: true,
    command: (port) =>
      `(pip install --quiet streamlit >/dev/null 2>&1 || true) && ` +
      `mkdir -p /workspace && ` +
      `(cat > /workspace/app.py <<'PY'\nimport streamlit as st\nst.title("Hello from OpenSandbox")\nst.write("Edit /workspace/app.py and refresh.")\nPY\n) && ` +
      `streamlit run /workspace/app.py --server.address=0.0.0.0 --server.port=${port} --server.headless=true`,
  },
]

interface ServiceState {
  running: boolean
  port: number
}

export default function ServicesPanel({ sandboxId }: { sandboxId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [states, setStates] = useState<Record<string, ServiceState>>({})

  const { data: ports } = useQuery({
    queryKey: ["ports", sandboxId],
    queryFn: () => api.listPorts(sandboxId),
    refetchInterval: 4000,
  })

  // Refresh process detection.
  const refresh = async () => {
    const cmd =
      "for token in " +
      SERVICES.map((s) => `'${s.detect.replace(/'/g, "'\\''")}'`).join(" ") +
      "; do pgrep -af -- \"$token\" >/dev/null 2>&1 && echo \"$token=running\" || echo \"$token=stopped\"; done"
    try {
      const res = await api.exec(sandboxId, cmd, false, 10000)
      const next: Record<string, ServiceState> = {}
      for (const s of SERVICES) {
        const isRunning = res.stdout?.some((line) => line.includes(`${s.detect}=running`))
        next[s.id] = {
          running: !!isRunning,
          port: states[s.id]?.port || s.defaultPort,
        }
      }
      setStates(next)
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxId])

  const startMut = useMutation({
    mutationFn: ({ s, port }: { s: ServiceDef; port: number }) =>
      api.exec(sandboxId, s.command(port), true, 10000),
    onSuccess: (_data, { s }) => {
      toast({ title: `Starting ${s.name}…`, description: `port ${states[s.id]?.port || s.defaultPort}` })
      qc.invalidateQueries({ queryKey: ["ports", sandboxId] })
      setTimeout(refresh, 1500)
    },
    onError: (e: unknown, { s }) =>
      toast({ title: `${s.name} failed`, description: (e as Error).message, variant: "destructive" }),
  })

  const stopMut = useMutation({
    mutationFn: ({ s }: { s: ServiceDef }) =>
      api.exec(sandboxId, `pkill -f -- '${s.detect.replace(/'/g, "'\\''")}' 2>/dev/null; true`, false, 5000),
    onSuccess: (_d, { s }) => {
      toast({ title: `Stopped ${s.name}` })
      qc.invalidateQueries({ queryKey: ["ports", sandboxId] })
      setTimeout(refresh, 1000)
    },
    onError: (e: unknown, { s }) =>
      toast({ title: `Stop ${s.name} failed`, description: (e as Error).message, variant: "destructive" }),
  })

  const portIsListening = (port: number) => (ports?.ports || []).includes(port)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Services</CardTitle>
            <CardDescription>One-click background services. Start the ones you need.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Detect
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((s) => {
          const st = states[s.id]
          const port = st?.port || s.defaultPort
          const listening = portIsListening(port)
          const running = st?.running || listening
          const proxyUrl = `/sandbox-proxy/${sandboxId}/port/${port}${s.openPath || "/"}`
          return (
            <div key={s.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground">{s.description}</div>
                </div>
                <Badge variant={running ? "success" : "secondary"} className="text-[10px]">
                  {running ? "running" : "stopped"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">port</span>
                <span className="font-mono">{port}</span>
              </div>
              <div className="flex items-center gap-1">
                {!running ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => startMut.mutate({ s, port })}
                    disabled={startMut.isPending}
                  >
                    {startMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                    Start
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive"
                    onClick={() => stopMut.mutate({ s })}
                    disabled={stopMut.isPending}
                  >
                    <Square className="mr-1 h-3.5 w-3.5" /> Stop
                  </Button>
                )}
                {s.http && running && (
                  <a href={proxyUrl} target="_blank" rel="noreferrer">
                    <Button size="sm">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
