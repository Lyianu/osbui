export type SandboxState =
  | "Pending"
  | "Running"
  | "Pausing"
  | "Paused"
  | "Stopping"
  | "Terminated"
  | "Failed"
  | string

export interface SandboxStatus {
  state: SandboxState
  reason?: string
  message?: string
  lastTransitionAt?: string
}

export interface Sandbox {
  id: string
  image?: { uri: string; auth?: { username?: string; password?: string } }
  snapshotId?: string
  status: SandboxStatus
  metadata?: Record<string, string>
  entrypoint: string[]
  expiresAt?: string
  createdAt: string
  platform?: { os: string; arch: string }
}

export interface PaginationInfo {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
}

export interface ListSandboxesResponse {
  items: Sandbox[]
  pagination: PaginationInfo
}

export interface Snapshot {
  id: string
  sandboxId: string
  name?: string
  status: { state: string; reason?: string; message?: string; lastTransitionAt?: string }
  createdAt: string
}

export interface ListSnapshotsResponse {
  items: Snapshot[]
  pagination: PaginationInfo
}

export interface CreateSandboxRequest {
  image?: {
    uri: string
    auth?: { username?: string; password?: string }
  }
  snapshotId?: string
  timeout?: number | null
  resourceLimits: Record<string, string>
  env?: Record<string, string>
  metadata?: Record<string, string>
  entrypoint?: string[]
}

export interface FileEntry {
  name: string
  type: string
  size: number
  mtime: number
  mode: string
  isDir: boolean
  isLink: boolean
}

export interface FileList {
  path: string
  entries: FileEntry[]
}

export interface Metrics {
  cpu_count?: number
  cpu_used_pct?: number
  mem_total_mib?: number
  mem_used_mib?: number
  timestamp?: number
}

export interface DiagnosticContent {
  sandboxId?: string
  kind?: string
  scope?: string
  delivery?: string
  content?: string
  contentType?: string
  contentUrl?: string
  truncated?: boolean
}

export class ApiError extends Error {
  status: number
  payload: any
  constructor(status: number, payload: any) {
    super(
      (payload && (payload.message || payload.error)) ||
        `Request failed with status ${status}`
    )
    this.status = status
    this.payload = payload
  }
}

async function fetchJSON<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  const body = text ? safeJSON(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, body ?? text)
  }
  return body as T
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  listSandboxes: (params: { page?: number; pageSize?: number; state?: string[] } = {}) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set("page", String(params.page))
    if (params.pageSize) qs.set("pageSize", String(params.pageSize))
    if (params.state) params.state.forEach((s) => qs.append("state", s))
    return fetchJSON<ListSandboxesResponse>(`/api/v1/sandboxes?${qs.toString()}`)
  },
  getSandbox: (id: string) => fetchJSON<Sandbox>(`/api/v1/sandboxes/${id}`),
  createSandbox: (body: CreateSandboxRequest) =>
    fetchJSON<Sandbox>("/api/v1/sandboxes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSandbox: async (id: string) => {
    const res = await fetch(`/api/v1/sandboxes/${id}`, { method: "DELETE" })
    if (!res.ok) throw new ApiError(res.status, await res.text())
  },
  pauseSandbox: async (id: string) => {
    const res = await fetch(`/api/v1/sandboxes/${id}/pause`, { method: "POST" })
    if (!res.ok) throw new ApiError(res.status, await res.text())
  },
  resumeSandbox: async (id: string) => {
    const res = await fetch(`/api/v1/sandboxes/${id}/resume`, { method: "POST" })
    if (!res.ok) throw new ApiError(res.status, await res.text())
  },
  renewSandbox: (id: string, expiresAt: string) =>
    fetchJSON<{ expiresAt: string }>(`/api/v1/sandboxes/${id}/renew-expiration`, {
      method: "POST",
      body: JSON.stringify({ expiresAt }),
    }),
  resolveEndpoint: (id: string, port: number) =>
    fetchJSON<{ direct: string; proxy: string }>(
      `/panel/sandboxes/${id}/endpoint?port=${port}`
    ),
  exec: (id: string, command: string, background = false, timeoutMs = 10000) =>
    fetchJSON<{ exitCode: number; stdout: string[]; stderr: string[]; error?: string }>(
      `/panel/sandboxes/${id}/exec`,
      {
        method: "POST",
        body: JSON.stringify({ command, background, timeoutMs }),
      }
    ),
  startVSCode: (id: string) =>
    fetchJSON<{ port: number; url: string; message: string }>(
      `/panel/sandboxes/${id}/vscode/start`,
      { method: "POST" }
    ),
  listSnapshots: (params: { page?: number; pageSize?: number; sandboxId?: string } = {}) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set("page", String(params.page))
    if (params.pageSize) qs.set("pageSize", String(params.pageSize))
    if (params.sandboxId) qs.set("sandboxId", params.sandboxId)
    return fetchJSON<ListSnapshotsResponse>(`/api/v1/snapshots?${qs.toString()}`)
  },
  createSnapshot: (sandboxId: string, name?: string) =>
    fetchJSON<Snapshot>(`/api/v1/sandboxes/${sandboxId}/snapshots`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    }),
  deleteSnapshot: async (id: string) => {
    const res = await fetch(`/api/v1/snapshots/${id}`, { method: "DELETE" })
    if (!res.ok) throw new ApiError(res.status, await res.text())
  },
  panelConfig: () =>
    fetchJSON<{
      upstream: string
      upstreamConfig: string
      apiKeyMasked: string
      apiKeyDefault: boolean
      panelAuth: boolean
      version: string
    }>("/panel/config"),
  upstreamHealth: () =>
    fetchJSON<{ ok: boolean; status?: number; latencyMs: number; error?: string }>(
      "/panel/upstream/health"
    ),

  // Sandbox file/DX ops
  listFiles: (id: string, path: string) =>
    fetchJSON<FileList>(
      `/panel/sandboxes/${id}/files?path=${encodeURIComponent(path)}`
    ),
  readFile: async (id: string, path: string): Promise<string> => {
    const res = await fetch(
      `/panel/sandboxes/${id}/files/read?path=${encodeURIComponent(path)}`
    )
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.text()
  },
  writeFile: (id: string, path: string, content: string) =>
    fetchJSON<{ status: string }>(`/panel/sandboxes/${id}/files/write`, {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),
  deleteFile: async (id: string, path: string, isDir = false) => {
    const res = await fetch(
      `/panel/sandboxes/${id}/files?path=${encodeURIComponent(path)}&isDir=${isDir ? 1 : 0}`,
      { method: "DELETE" }
    )
    if (!res.ok) throw new ApiError(res.status, await res.text())
  },
  mkdir: (id: string, path: string) =>
    fetchJSON<{ status: string }>(`/panel/sandboxes/${id}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  uploadFiles: async (id: string, targetDir: string, files: File[]) => {
    const fd = new FormData()
    fd.append("path", targetDir)
    files.forEach((f) => fd.append("files", f, f.name))
    const res = await fetch(`/panel/sandboxes/${id}/files/upload`, {
      method: "POST",
      body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json() as Promise<{ uploaded: any[]; targetDir: string }>
  },
  downloadFileUrl: (id: string, path: string) =>
    `/panel/sandboxes/${id}/files/download?path=${encodeURIComponent(path)}`,

  gitClone: (id: string, url: string, ref?: string, target?: string) =>
    fetchJSON<{ exitCode: number; stdout: string[]; stderr: string[]; error?: string }>(
      `/panel/sandboxes/${id}/git-clone`,
      {
        method: "POST",
        body: JSON.stringify({ url, ref, target }),
      }
    ),

  listPorts: (id: string) =>
    fetchJSON<{ ports: number[] }>(`/panel/sandboxes/${id}/ports`),
  getLogs: (id: string, scope = "container") =>
    fetchJSON<DiagnosticContent>(
      `/panel/sandboxes/${id}/logs?scope=${encodeURIComponent(scope)}`
    ),
  getEvents: (id: string, scope = "runtime") =>
    fetchJSON<DiagnosticContent>(
      `/panel/sandboxes/${id}/events?scope=${encodeURIComponent(scope)}`
    ),
  getMetrics: (id: string) =>
    fetchJSON<Metrics>(`/panel/sandboxes/${id}/metrics`),
}

export const stateTone: Record<
  string,
  "success" | "warning" | "destructive" | "secondary" | "info" | "default"
> = {
  Pending: "info",
  Running: "success",
  Pausing: "warning",
  Paused: "warning",
  Stopping: "warning",
  Terminated: "secondary",
  Failed: "destructive",
}
