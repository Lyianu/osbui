import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, ExternalLink, Loader2, ServerCog } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { api } from "@/lib/api"
import { getConnection, setConnection } from "@/lib/connection"

export default function SetupWizardPage() {
  const navigate = useNavigate()
  const initial = getConnection()
  const [upstream, setUpstream] = useState(initial.upstream || "")
  const [apiKey, setApiKey] = useState(initial.apiKey || "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: cfg } = useQuery({
    queryKey: ["panel-config"],
    queryFn: () => api.panelConfig(),
  })
  const { data: health, refetch: recheckHealth, isFetching: checking } = useQuery({
    queryKey: ["upstream-health-setup"],
    queryFn: () => api.upstreamHealth(),
    refetchInterval: 5_000,
  })

  const save = async () => {
    setSaving(true)
    setErr(null)
    setConnection({ upstream, apiKey })
    // Give the cookie a tick to propagate, then verify.
    await new Promise((r) => setTimeout(r, 200))
    try {
      await api.upstreamHealth()
      navigate("/sandboxes")
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="text-muted-foreground">
          Connect this panel to an OpenSandbox lifecycle server to get started.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4" /> Connect to OpenSandbox
          </CardTitle>
          <CardDescription>
            These values are stored in your browser and sent to the panel backend as
            cookies, so sessions persist across reloads. Leave blank to use the
            backend&rsquo;s flag defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Upstream URL</Label>
            <Input
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              placeholder="http://127.0.0.1:8080"
            />
            <p className="text-xs text-muted-foreground">
              Effective:&nbsp;
              <span className="font-mono">{cfg?.upstream || "(from server flags)"}</span>
            </p>
          </div>
          <div className="grid gap-2">
            <Label>API key (optional)</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg?.apiKeyDefault ? "(a default key is set on the server)" : "leave blank if the server has no API key"}
            />
            <p className="text-xs text-muted-foreground">
              Effective:&nbsp;
              <span className="font-mono">{cfg?.apiKeyMasked || (cfg?.apiKeyDefault ? "(from server flags)" : "—")}</span>
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2">
              {health?.ok ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span>Upstream is healthy ({health.latencyMs}ms)</span>
                </>
              ) : (
                <>
                  <Loader2 className={checking ? "h-4 w-4 animate-spin text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
                  <span className="text-muted-foreground">
                    {health?.error ? `Cannot reach upstream: ${health.error}` : "Waiting for upstream…"}
                  </span>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => recheckHealth()}>
              Re-check
            </Button>
          </div>

          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/sandboxes")}>
              Skip
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save &amp; continue
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Don&rsquo;t have a server yet?</CardTitle>
          <CardDescription>Bootstrap OpenSandbox on your machine in a few commands.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`# install + configure
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker

# (optional) set server.api_key = "..." in the TOML file

# start it
opensandbox-server

# pre-pull the VS Code image used by this panel's preset
docker pull opensandbox/vscode:latest`}
          </pre>
          <a
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            href="https://github.com/alibaba/OpenSandbox/blob/main/server/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Full server reference <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
