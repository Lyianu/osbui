import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { GitBranch, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

export default function GitImportDialog({
  sandboxId,
  open,
  onOpenChange,
  onImported,
}: {
  sandboxId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported?: (target: string) => void
}) {
  const [url, setUrl] = useState("")
  const [ref, setRef] = useState("")
  const [target, setTarget] = useState("/workspace")
  const { toast } = useToast()

  const cloneMut = useMutation({
    mutationFn: () => api.gitClone(sandboxId, url.trim(), ref.trim() || undefined, target.trim() || "/workspace"),
    onSuccess: (res) => {
      if (res.exitCode !== 0 || res.error) {
        toast({
          title: "Clone finished with errors",
          description: res.stderr.join("\n") || res.error || "non-zero exit",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Repository imported", description: target })
      onImported?.(target)
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast({ title: "Clone failed", description: (e as Error).message, variant: "destructive" }),
  })

  const suggestTarget = (u: string) => {
    try {
      const p = new URL(u.endsWith(".git") ? u.slice(0, -4) : u).pathname
      const name = p.split("/").filter(Boolean).pop()
      if (name) setTarget(`/workspace/${name}`)
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" /> Import repository
          </DialogTitle>
          <DialogDescription>
            Clone a Git repo into the sandbox. If <code>git</code> isn&rsquo;t installed
            and the URL is on github.com, the panel downloads a codeload tarball
            instead, so this works on minimal images too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="git-url">Repository URL</Label>
            <Input
              id="git-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (!target || target === "/workspace") suggestTarget(e.target.value)
              }}
              placeholder="https://github.com/owner/repo.git"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="git-ref">Ref / branch (optional)</Label>
            <Input id="git-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="git-target">Target path</Label>
            <Input id="git-target" value={target} onChange={(e) => setTarget(e.target.value)} />
            <p className="text-xs text-muted-foreground">Must be an absolute path. Defaults to <code>/workspace</code>.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cloneMut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => cloneMut.mutate()} disabled={!url.trim() || cloneMut.isPending}>
            {cloneMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
