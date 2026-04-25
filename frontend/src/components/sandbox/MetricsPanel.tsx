import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Cpu, MemoryStick } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"

interface Sample {
  t: number
  cpu: number
  memMiB: number
}

export default function MetricsPanel({ sandboxId }: { sandboxId: string }) {
  const [history, setHistory] = useState<Sample[]>([])
  const { data } = useQuery({
    queryKey: ["metrics", sandboxId],
    queryFn: () => api.getMetrics(sandboxId),
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (!data || !data.timestamp) return
    setHistory((h) => {
      const next = [...h, { t: data.timestamp!, cpu: data.cpu_used_pct || 0, memMiB: data.mem_used_mib || 0 }]
      return next.slice(-60)
    })
  }, [data])

  const cpuPct = Math.round((data?.cpu_used_pct || 0) * 10) / 10
  const memUsed = Math.round(data?.mem_used_mib || 0)
  const memTotal = Math.round(data?.mem_total_mib || 0)
  const memPct = memTotal ? Math.round(((data?.mem_used_mib || 0) / memTotal) * 1000) / 10 : 0

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <Cpu className="h-4 w-4" /> CPU
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums">{cpuPct}%</div>
          <div className="text-xs text-muted-foreground">
            {data?.cpu_count ?? "—"} cores · host metric
          </div>
          <Sparkline points={history.map((h) => h.cpu)} max={100} color="#10b981" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <MemoryStick className="h-4 w-4" /> Memory
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums">
            {memUsed} MiB<span className="ml-2 text-sm text-muted-foreground">/ {memTotal} MiB ({memPct}%)</span>
          </div>
          <Sparkline
            points={history.map((h) => h.memMiB)}
            max={Math.max(memTotal, 1)}
            color="#0ea5e9"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Sparkline({ points, max, color }: { points: number[]; max: number; color: string }) {
  const w = 320
  const h = 64
  if (!points.length) {
    return <div className="mt-3 h-16 w-full rounded-md bg-muted/40" />
  }
  const d = points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * w
      const y = h - (p / max) * h
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-16 w-full">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}
