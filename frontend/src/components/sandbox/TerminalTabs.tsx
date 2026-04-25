import { useState } from "react"
import { Plus, X } from "lucide-react"
import Terminal from "@/components/sandbox/Terminal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Tab {
  id: number
  label: string
}

let tabSerial = 1

export default function TerminalTabs({ sandboxId }: { sandboxId: string }) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: tabSerial++, label: "bash" }])
  const [active, setActive] = useState<number>(tabs[0].id)

  const add = () => {
    const t = { id: tabSerial++, label: `bash ${tabs.length + 1}` }
    setTabs([...tabs, t])
    setActive(t.id)
  }
  const close = (id: number) => {
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const next = tabs.filter((t) => t.id !== id)
    if (next.length === 0) {
      const fresh = { id: tabSerial++, label: "bash" }
      setTabs([fresh])
      setActive(fresh.id)
    } else {
      setTabs(next)
      if (active === id) setActive(next[Math.max(0, idx - 1)].id)
    }
  }

  return (
    <div className="flex h-[540px] flex-col gap-2">
      <div className="flex items-center gap-1 overflow-x-auto rounded-md border bg-muted/40 p-1">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
              active === t.id ? "bg-background shadow-sm" : "hover:bg-background/50"
            )}
            onClick={() => setActive(t.id)}
          >
            <button className="font-mono text-xs" onClick={() => setActive(t.id)}>{t.label}</button>
            {tabs.length > 1 && (
              <button
                className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  close(t.id)
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative flex-1">
        {tabs.map((t) => (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{ display: active === t.id ? "block" : "none" }}
          >
            <Terminal sandboxId={sandboxId} />
          </div>
        ))}
      </div>
    </div>
  )
}
