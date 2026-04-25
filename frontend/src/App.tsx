import { useEffect, useState } from "react"
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { Activity, BookMarked, Box, Boxes, Camera, Command, Layers, Moon, Server, Settings, Sun, SunMoon } from "lucide-react"
import { cn } from "@/lib/utils"
import SandboxesPage from "@/pages/SandboxesPage"
import SandboxDetailPage from "@/pages/SandboxDetailPage"
import SandboxVSCodePage from "@/pages/SandboxVSCodePage"
import SnapshotsPage from "@/pages/SnapshotsPage"
import SettingsPage from "@/pages/SettingsPage"
import TemplatesPage from "@/pages/TemplatesPage"
import SetupWizardPage from "@/pages/SetupWizardPage"
import PoolsPage from "@/pages/PoolsPage"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import ServerHealthBanner from "@/components/ServerHealthBanner"
import { hasExplicitConnection } from "@/lib/connection"

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global Cmd/Ctrl+K to open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const { data: cfg } = useQuery({
    queryKey: ["panel-config"],
    queryFn: () => api.panelConfig(),
    refetchInterval: 30_000,
  })
  const needsSetup = cfg && !cfg.apiKeyDefault && !hasExplicitConnection()

  return (
    <div className="flex h-full min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <ServerHealthBanner />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route
              path="/"
              element={<Navigate to={needsSetup ? "/setup" : "/sandboxes"} replace />}
            />
            <Route path="/setup" element={<SetupWizardPage />} />
            <Route path="/sandboxes" element={<SandboxesPage />} />
            <Route path="/sandboxes/:id" element={<SandboxDetailPage />} />
            <Route path="/sandboxes/:id/vscode" element={<SandboxVSCodePage />} />
            <Route path="/snapshots" element={<SnapshotsPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/pools" element={<PoolsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
                  Page not found.
                </div>
              }
            />
          </Routes>
        </main>
      </div>

      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 p-4 md:flex">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Boxes className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">OpenSandbox</div>
          <div className="text-xs text-muted-foreground">Management Panel</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5">
        <SideLink to="/sandboxes" icon={<Box className="h-4 w-4" />}>
          Sandboxes
        </SideLink>
        <SideLink to="/templates" icon={<BookMarked className="h-4 w-4" />}>
          Templates
        </SideLink>
        <SideLink to="/snapshots" icon={<Camera className="h-4 w-4" />}>
          Snapshots
        </SideLink>
        <SideLink to="/pools" icon={<Layers className="h-4 w-4" />}>
          Pools
        </SideLink>
        <SideLink to="/settings" icon={<Settings className="h-4 w-4" />}>
          Settings
        </SideLink>
      </nav>
      <div className="mt-auto px-3 pt-4 text-[10px] text-muted-foreground">
        Press <kbd className="rounded bg-muted px-1 py-0.5">⌘K</kbd> for the command palette.
      </div>
    </aside>
  )
}

function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { theme, setTheme } = useTheme()
  const cycleTheme = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
    setTheme(next)
  }
  const themeIcon = theme === "system" ? <SunMoon className="h-4 w-4" /> : theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />
  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground md:hidden">
        <Boxes className="h-4 w-4" /> OpenSandbox Panel
      </div>
      <div className="hidden items-center gap-2 md:flex" />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={onOpenPalette}
        >
          <Command className="h-3.5 w-3.5" />
          <span className="text-xs">Search…</span>
          <kbd className="hidden rounded bg-muted px-1 py-0.5 text-[10px] md:inline">⌘K</kbd>
        </Button>
        <Button variant="ghost" size="icon" onClick={cycleTheme} title={`Theme: ${theme}`}>
          {themeIcon}
        </Button>
      </div>
    </header>
  )
}

function SideLink({
  to,
  icon,
  children,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  )
}

function Palette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ["sandboxes", "all"],
    queryFn: () => api.listSandboxes({ pageSize: 50 }),
    enabled: open,
  })
  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a sandbox, action, or page…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go("/sandboxes")}>
            <Box className="h-4 w-4" /> Sandboxes
            <CommandShortcut>g s</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/templates")}>
            <BookMarked className="h-4 w-4" /> Templates
            <CommandShortcut>g t</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/snapshots")}>
            <Camera className="h-4 w-4" /> Snapshots
          </CommandItem>
          <CommandItem onSelect={() => go("/pools")}>
            <Layers className="h-4 w-4" /> Pools
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings className="h-4 w-4" /> Settings
          </CommandItem>
        </CommandGroup>
        {data?.items?.length ? (
          <CommandGroup heading="Sandboxes">
            {data.items.map((s) => (
              <CommandItem
                key={s.id}
                onSelect={() => go(`/sandboxes/${s.id}`)}
              >
                <Activity className="h-4 w-4" />
                <span>{s.metadata?.name || s.id.slice(0, 8)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.status.state}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Help">
          <CommandItem
            onSelect={() =>
              window.open(
                "https://github.com/alibaba/OpenSandbox",
                "_blank",
                "noreferrer"
              )
            }
          >
            <Server className="h-4 w-4" /> Open documentation
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
