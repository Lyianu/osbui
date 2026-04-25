import { AlertCircle, CheckCircle2, Link2 } from "lucide-react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

export default function ServerHealthBanner() {
  const { data, isLoading } = useQuery({
    queryKey: ["upstream-health"],
    queryFn: () => api.upstreamHealth(),
    refetchInterval: 10_000,
    retry: false,
  })
  const { data: cfg } = useQuery({
    queryKey: ["panel-config"],
    queryFn: () => api.panelConfig(),
  })

  if (isLoading || !data) return null
  if (data.ok) {
    return (
      <div className="flex items-center gap-2 border-b bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Connected to OpenSandbox server ({cfg?.upstream || "—"}) · {data.latencyMs}ms</span>
      </div>
    )
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive")}>
      <AlertCircle className="h-4 w-4" />
      <span>
        Cannot reach OpenSandbox server {cfg?.upstream ? `at ${cfg.upstream}` : ""}
        {data.error ? ` — ${data.error}` : ""}
      </span>
      <Link
        to="/setup"
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-destructive/60 bg-background px-2 py-1 font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
      >
        <Link2 className="h-3 w-3" /> Configure connection
      </Link>
    </div>
  )
}
