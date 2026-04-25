export interface SandboxTemplate {
  id: string
  name: string
  image: string
  entrypoint: string[]
  env?: Record<string, string>
  cpu: string
  memory: string
  timeout: number | null
  createdAt: number
}

const KEY = "osb_templates"

export function listTemplates(): SandboxTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_TEMPLATES
    const parsed = JSON.parse(raw) as SandboxTemplate[]
    return Array.isArray(parsed) ? parsed : DEFAULT_TEMPLATES
  } catch {
    return DEFAULT_TEMPLATES
  }
}

export function saveTemplates(templates: SandboxTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(templates))
  window.dispatchEvent(new CustomEvent("osb:templates-changed"))
}

export function addTemplate(t: Omit<SandboxTemplate, "id" | "createdAt">): SandboxTemplate {
  const full: SandboxTemplate = {
    ...t,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  const list = listTemplates()
  saveTemplates([full, ...list])
  return full
}

export function removeTemplate(id: string) {
  saveTemplates(listTemplates().filter((t) => t.id !== id))
}

export const DEFAULT_TEMPLATES: SandboxTemplate[] = [
  {
    id: "builtin-dev",
    name: "OpenSandbox Dev (all-in-one)",
    image: "osbui/dev:latest",
    entrypoint: ["sleep", "infinity"],
    cpu: "1500m",
    memory: "2Gi",
    timeout: 7200,
    createdAt: 0,
  },
  {
    id: "builtin-vscode",
    name: "VS Code Web",
    image: "opensandbox/vscode:latest",
    entrypoint: ["sleep", "infinity"],
    cpu: "1000m",
    memory: "1Gi",
    timeout: 3600,
    createdAt: 0,
  },
  {
    id: "builtin-python",
    name: "Python 3.11",
    image: "python:3.11",
    entrypoint: ["sleep", "infinity"],
    cpu: "500m",
    memory: "512Mi",
    timeout: 3600,
    createdAt: 0,
  },
  {
    id: "builtin-node",
    name: "Node 22",
    image: "node:22",
    entrypoint: ["sleep", "infinity"],
    cpu: "500m",
    memory: "512Mi",
    timeout: 3600,
    createdAt: 0,
  },
  {
    id: "builtin-ubuntu",
    name: "Ubuntu 22.04",
    image: "ubuntu:22.04",
    entrypoint: ["sleep", "infinity"],
    cpu: "500m",
    memory: "512Mi",
    timeout: 3600,
    createdAt: 0,
  },
]
