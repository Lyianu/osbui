import { NavLink, Navigate, Route, Routes } from "react-router-dom"
import { Box, Camera, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import SandboxesPage from "@/pages/SandboxesPage"
import SandboxDetailPage from "@/pages/SandboxDetailPage"
import SandboxVSCodePage from "@/pages/SandboxVSCodePage"
import SnapshotsPage from "@/pages/SnapshotsPage"
import SettingsPage from "@/pages/SettingsPage"

export default function App() {
  return (
    <div className="flex h-full min-h-screen w-full">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/40 p-4 md:block">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Box className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">OpenSandbox</div>
            <div className="text-xs text-muted-foreground">Management Panel</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <SideLink to="/sandboxes" icon={<Box className="h-4 w-4" />}>
            Sandboxes
          </SideLink>
          <SideLink to="/snapshots" icon={<Camera className="h-4 w-4" />}>
            Snapshots
          </SideLink>
          <SideLink to="/settings" icon={<Server className="h-4 w-4" />}>
            Settings
          </SideLink>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/sandboxes" replace />} />
          <Route path="/sandboxes" element={<SandboxesPage />} />
          <Route path="/sandboxes/:id" element={<SandboxDetailPage />} />
          <Route path="/sandboxes/:id/vscode" element={<SandboxVSCodePage />} />
          <Route path="/snapshots" element={<SnapshotsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
                Not found
              </div>
            }
          />
        </Routes>
      </main>
    </div>
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
