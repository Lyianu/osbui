import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"

export default function LogsPanel({
  sandboxId,
  kind,
}: {
  sandboxId: string
  kind: "logs" | "events"
}) {
  const defaultScope = kind === "logs" ? "container" : "runtime"
  const [scope, setScope] = useState(defaultScope)
  const [follow, setFollow] = useState(true)
  const [search, setSearch] = useState("")

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["diagnostic", kind, sandboxId, scope],
    queryFn: () =>
      kind === "logs"
        ? api.getLogs(sandboxId, scope)
        : api.getEvents(sandboxId, scope),
    refetchInterval: follow ? 2000 : false,
  })

  const filtered = useMemo(() => {
    const text = data?.content || ""
    if (!search.trim()) return text
    const re = new RegExp(escapeRE(search), "i")
    return text
      .split("\n")
      .filter((l) => re.test(l))
      .join("\n")
  }, [data, search])

  return (
    <div className="flex h-[500px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(kind === "logs"
              ? ["container", "sandbox", "network"]
              : ["runtime", "sandbox", "network"]
            ).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant={follow ? "default" : "outline"}
          size="sm"
          onClick={() => setFollow((v) => !v)}
        >
          {follow ? "Tail: on" : "Tail: off"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
        {data?.truncated && (
          <span className="text-xs text-amber-500">truncated</span>
        )}
      </div>
      <div className="flex-1 rounded-md border bg-black">
        <ScrollArea className="h-full">
          {error ? (
            <div className="p-4 text-xs text-destructive">{(error as Error).message}</div>
          ) : filtered ? (
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-emerald-100">
              {filtered}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
              {isFetching ? "Loading…" : "(no content)"}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

function escapeRE(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
