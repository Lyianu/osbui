import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { shortId } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const CODE_PORT = 8443

type Phase = "waiting-sandbox" | "starting" | "probing" | "ready" | "failed"

export default function SandboxVSCodePage() {
  const { id = "" } = useParams()
  const { toast } = useToast()
  const [phase, setPhase] = useState<Phase>("waiting-sandbox")
  const [message, setMessage] = useState("Checking sandbox status…")
  const [iframeKey, setIframeKey] = useState(0)
  const startedRef = useRef(false)
  const attemptsRef = useRef(0)

  const sandboxQuery = useQuery({
    queryKey: ["sandbox", id],
    queryFn: () => api.getSandbox(id),
    enabled: !!id,
    refetchInterval: phase === "ready" ? false : 3000,
  })

  const startMut = useMutation({
    mutationFn: () => api.startVSCode(id),
    onError: (e: unknown) => {
      setPhase("failed")
      setMessage((e as Error).message)
      toast({ title: "Failed to start code-server", description: (e as Error).message, variant: "destructive" })
    },
  })

  // Once the sandbox is Running, kick off code-server.
  useEffect(() => {
    if (!sandboxQuery.data) return
    const state = sandboxQuery.data.status.state
    if (phase === "waiting-sandbox" && state === "Running" && !startedRef.current) {
      startedRef.current = true
      setPhase("starting")
      setMessage("Starting code-server inside sandbox…")
      startMut.mutate(undefined, {
        onSuccess: () => {
          setPhase("probing")
          setMessage("Waiting for code-server to accept connections…")
        },
      })
    } else if (phase === "waiting-sandbox") {
      setMessage(`Sandbox is ${state}. Waiting for it to become Running…`)
    }
  }, [sandboxQuery.data, phase, startMut])

  // Probe the code-server endpoint until it responds.
  useEffect(() => {
    if (phase !== "probing") return
    let cancelled = false
    const probe = async () => {
      attemptsRef.current += 1
      try {
        const res = await fetch(`/sandbox-proxy/${id}/port/${CODE_PORT}/healthz`, {
          method: "GET",
          redirect: "follow",
        }).catch(() => null)
        // code-server responds to /healthz with JSON or to / with HTML. Anything
        // non-502 means the service is up.
        if (!cancelled) {
          if (res && res.status !== 502 && res.status !== 504) {
            setPhase("ready")
            setMessage("Connected.")
            return
          }
        }
      } catch {
        // ignore
      }
      if (!cancelled) {
        if (attemptsRef.current > 40) {
          setPhase("failed")
          setMessage("code-server did not come up within 60 seconds.")
        } else {
          setTimeout(probe, 1500)
        }
      }
    }
    probe()
    return () => {
      cancelled = true
    }
  }, [phase, id])

  const iframeUrl = `/sandbox-proxy/${id}/port/${CODE_PORT}/?folder=/workspace`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b bg-background p-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/sandboxes/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Sandbox
            </Link>
          </Button>
          <div className="flex flex-col leading-tight">
            <div className="text-sm font-medium">VS Code Web</div>
            <div className="font-mono text-xs text-muted-foreground">{shortId(id, 20)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIframeKey((k) => k + 1)}
            disabled={phase !== "ready"}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reload
          </Button>
          <Button variant="outline" size="sm" asChild disabled={phase !== "ready"}>
            <a href={iframeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <div className="relative flex-1 bg-muted/40">
        {phase !== "ready" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {phase === "failed" ? (
                    <>Connection failed</>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Preparing VS Code
                    </>
                  )}
                </CardTitle>
                <CardDescription>{message}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {phase === "failed" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      startedRef.current = false
                      attemptsRef.current = 0
                      setPhase("waiting-sandbox")
                      setMessage("Retrying…")
                    }}
                  >
                    Retry
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/sandboxes/${id}`}>Back to details</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {phase === "ready" && (
          <iframe
            key={iframeKey}
            src={iframeUrl}
            className="absolute inset-0 h-full w-full border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
            title="VS Code Web"
          />
        )}
      </div>
    </div>
  )
}
