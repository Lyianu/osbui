import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Loader2, Network, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"

export default function PortsPanel({ sandboxId }: { sandboxId: string }) {
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["ports", sandboxId],
    queryFn: () => api.listPorts(sandboxId),
    refetchInterval: 5000,
  })

  // Filter out execd ingress ports — they are infrastructure, not user services.
  const userPorts = (data?.ports || []).filter((p) => p !== 44772 && p !== 8080)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4" /> Listening ports
            </CardTitle>
            <CardDescription>Services that are accepting TCP connections inside this sandbox.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Rescan
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-sm text-destructive">{(error as Error).message}</div>
        ) : userPorts.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            No user-facing ports are listening. Start a service from the terminal
            or through VS Code (for example <code>python -m http.server 8000</code>)
            and it will appear here within a few seconds.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {userPorts.map((port) => {
              const url = `/sandbox-proxy/${sandboxId}/port/${port}/`
              return (
                <div
                  key={port}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="font-mono text-sm font-medium">:{port}</div>
                    <div className="text-[11px] text-muted-foreground">TCP listening</div>
                  </div>
                  <a href={url} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                    </Button>
                  </a>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
