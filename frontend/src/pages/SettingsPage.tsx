import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Save } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { getConnection, setConnection } from "@/lib/connection"
import { useTheme } from "@/components/theme-provider"
import { useToast } from "@/hooks/use-toast"

export default function SettingsPage() {
  const { data: cfg, refetch } = useQuery({
    queryKey: ["panel-config"],
    queryFn: () => api.panelConfig(),
  })
  const { data: health } = useQuery({
    queryKey: ["upstream-health-settings"],
    queryFn: () => api.upstreamHealth(),
    refetchInterval: 10_000,
  })
  const conn = getConnection()
  const [upstream, setUpstream] = useState(conn.upstream)
  const [apiKey, setApiKey] = useState(conn.apiKey)
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()

  const saveMut = useMutation({
    mutationFn: async () => {
      setConnection({ upstream, apiKey })
      await new Promise((r) => setTimeout(r, 200))
      await refetch()
    },
    onSuccess: () => toast({ title: "Connection settings saved" }),
    onError: (e: unknown) => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Connection, appearance, and panel metadata.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
          <CardDescription>
            Override the OpenSandbox upstream URL and API key at runtime. Values are
            persisted in your browser and forwarded to the backend via cookies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Upstream URL</Label>
            <Input
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              placeholder={cfg?.upstreamConfig || "http://127.0.0.1:8080"}
            />
            <p className="text-xs text-muted-foreground">
              Current effective: <span className="font-mono">{cfg?.upstream || "—"}</span>
              {cfg?.upstreamConfig && cfg.upstreamConfig !== cfg.upstream && (
                <>
                  {" "}· server flag: <span className="font-mono">{cfg.upstreamConfig}</span>
                </>
              )}
            </p>
          </div>
          <div className="grid gap-2">
            <Label>API key</Label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder={cfg?.apiKeyDefault ? "(a default key is set on the server)" : ""}
            />
            <p className="text-xs text-muted-foreground">
              Current effective: <span className="font-mono">{cfg?.apiKeyMasked || "—"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
            <div className="text-xs text-muted-foreground">
              {health ? (
                health.ok ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Upstream healthy ({health.latencyMs}ms)</span>
                ) : (
                  <span className="text-destructive">Upstream unreachable{health.error ? `: ${health.error}` : ""}</span>
                )
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          {(["light", "dark", "system"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={theme === t ? "default" : "outline"}
              onClick={() => setTheme(t)}
              className="capitalize"
            >
              {t}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Panel version" value={cfg?.version} mono />
          <Separator />
          <Row
            label="Panel shared secret"
            value={cfg?.panelAuth ? "required" : "not configured"}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            The panel exposes the OpenSandbox API, a per-sandbox HTTP/WebSocket reverse
            proxy, execd helpers, and a terminal bridge. All of it runs as a single Go
            binary in front of the compiled React assets.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value ?? "—"}</span>
    </div>
  )
}
