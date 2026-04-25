import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { BookMarked, Loader2, Plus, PlayCircle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  listTemplates,
  removeTemplate,
  type SandboxTemplate,
} from "@/lib/templates"
import { Badge } from "@/components/ui/badge"
import { formatRelative } from "@/lib/utils"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import CreateSandboxDialog from "@/components/CreateSandboxDialog"

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<SandboxTemplate[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [prefill, setPrefill] = useState<SandboxTemplate | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()

  const refresh = () => setTemplates(listTemplates())
  useEffect(() => {
    refresh()
    const h = () => refresh()
    window.addEventListener("osb:templates-changed", h)
    return () => window.removeEventListener("osb:templates-changed", h)
  }, [])

  const launchMut = useMutation({
    mutationFn: (t: SandboxTemplate) => {
      const safeName =
        t.name
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "")
          .slice(0, 63) || "sandbox"
      return api.createSandbox({
        image: { uri: t.image },
        entrypoint: t.entrypoint,
        resourceLimits: { cpu: t.cpu, memory: t.memory },
        timeout: t.timeout,
        metadata: { name: safeName, "osbui.template": t.id },
        env: t.env,
      })
    },
    onSuccess: (sb) => {
      qc.invalidateQueries({ queryKey: ["sandboxes"] })
      toast({ title: "Sandbox launched", description: sb.id })
      navigate(`/sandboxes/${sb.id}`)
    },
    onError: (e: unknown) =>
      toast({
        title: "Launch failed",
        description: (e as Error).message,
        variant: "destructive",
      }),
  })

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-muted-foreground">
            Starter configurations you can launch with one click. Saved templates live in
            your browser&rsquo;s local storage.
          </p>
        </div>
        <Button
          onClick={() => {
            setPrefill(null)
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> New from scratch
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.id} className="relative flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{t.name}</CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  {t.id.startsWith("builtin-") ? "built-in" : "saved"}
                </Badge>
              </div>
              <CardDescription className="truncate font-mono text-xs">{t.image}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
              <div className="grid grid-cols-2 gap-1">
                <span>CPU</span>
                <span className="text-right font-mono text-foreground">{t.cpu}</span>
                <span>Memory</span>
                <span className="text-right font-mono text-foreground">{t.memory}</span>
                <span>Timeout</span>
                <span className="text-right font-mono text-foreground">
                  {t.timeout === null ? "manual" : `${t.timeout}s`}
                </span>
                <span>Entrypoint</span>
                <span className="text-right font-mono text-foreground truncate">
                  {t.entrypoint.join(" ") || "—"}
                </span>
              </div>
              {t.createdAt > 0 && (
                <div className="text-[10px]">Saved {formatRelative(new Date(t.createdAt).toISOString())}</div>
              )}
              <div className="mt-auto flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => launchMut.mutate(t)}
                    disabled={launchMut.isPending}
                  >
                    {launchMut.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-1 h-3.5 w-3.5" />
                    )}
                    Launch
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPrefill(t)
                      setCreateOpen(true)
                    }}
                  >
                    Customize…
                  </Button>
                </div>
                {!t.id.startsWith("builtin-") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      removeTemplate(t.id)
                      refresh()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <BookMarked className="h-10 w-10 text-muted-foreground/60" />
              <div className="text-sm font-medium">No templates yet</div>
              <p className="max-w-md text-xs text-muted-foreground">
                Save common sandbox configurations from any detail page to reuse them with a single click.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <CreateSandboxDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefill={prefill ?? undefined}
        onCreated={(id) => {
          setCreateOpen(false)
          qc.invalidateQueries({ queryKey: ["sandboxes"] })
          navigate(`/sandboxes/${id}`)
        }}
      />
    </div>
  )
}
