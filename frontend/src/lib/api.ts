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
    fetchJSON<{ upstream: string; panelAuth: boolean; apiKeyInjected: boolean; version: string }>(
      "/panel/config"
    ),
}

export const stateTone: Record<string, "success" | "warning" | "destructive" | "secondary" | "info" | "default"> = {
  Pending: "info",
  Running: "success",
  Pausing: "warning",
  Paused: "warning",
  Stopping: "warning",
  Terminated: "secondary",
  Failed: "destructive",
}
