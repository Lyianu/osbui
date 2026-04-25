import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api } from "@/lib/api"

export default function SettingsPage() {
  const { data } = useQuery({
    queryKey: ["panel-config"],
    queryFn: () => api.panelConfig(),
  })

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Runtime configuration of this panel instance.</p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Panel</CardTitle>
          <CardDescription>Values are sourced from server flags / environment variables.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Version" value={data?.version} />
          <Row label="Upstream OpenSandbox server" value={data?.upstream} mono />
          <Row
            label="API key injection"
            value={data ? (data.apiKeyInjected ? "enabled" : "not configured") : "…"}
          />
          <Row
            label="Panel secret required"
            value={data ? (data.panelAuth ? "yes" : "no (public)") : "…"}
          />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
          <CardDescription>
            OpenSandbox Panel is a management UI for the{" "}
            <a
              href="https://github.com/alibaba/OpenSandbox"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              OpenSandbox
            </a>{" "}
            lifecycle server. All sandbox actions are forwarded to the upstream
            server configured above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The panel proxies traffic to sandbox endpoints through{" "}
            <code>/sandbox-proxy/&lt;id&gt;/port/&lt;port&gt;/</code>, which is
            how the embedded VS Code Web session reaches the sandbox.
          </p>
          <p>
            Access is gated by the optional <code>OSBUI_PANEL_SECRET</code>{" "}
            environment variable. When set, supply it via the{" "}
            <code>X-Panel-Secret</code> header or <code>panel_secret</code>{" "}
            cookie.
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
