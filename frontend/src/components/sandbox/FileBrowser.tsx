import { useEffect, useRef, useState } from "react"
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  HomeIcon,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type FileEntry } from "@/lib/api"
import { formatRelative } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog"

export default function FileBrowser({ sandboxId }: { sandboxId: string }) {
  const [path, setPath] = useState("/workspace")
  const [pathInput, setPathInput] = useState("/workspace")
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [editingContent, setEditingContent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [toDelete, setToDelete] = useState<FileEntry | null>(null)
  const [mkdirName, setMkdirName] = useState("")
  const [newFileName, setNewFileName] = useState("")
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["files", sandboxId, path],
    queryFn: () => api.listFiles(sandboxId, path),
    refetchInterval: 5000,
  })

  useEffect(() => {
    setPathInput(path)
  }, [path])

  const openFile = async (entry: FileEntry) => {
    if (entry.isDir) {
      setPath(path === "/" ? "/" + entry.name : path.replace(/\/$/, "") + "/" + entry.name)
      setSelected(null)
      setEditingContent(null)
      return
    }
    setSelected(entry)
    setEditingContent(null)
    setDirty(false)
    // Skip reading binary types — render in a preview pane.
    const kind = fileKind(entry.name)
    if (kind === "image" || kind === "binary") {
      return
    }
    if (entry.size > 2 * 1024 * 1024) {
      toast({
        title: "Too large to edit inline",
        description: "Files above 2 MB can be downloaded but not edited in the panel.",
      })
      return
    }
    try {
      const content = await api.readFile(sandboxId, joinPath(path, entry.name))
      setEditingContent(content)
    } catch (e) {
      toast({
        title: "Read failed",
        description: (e as Error).message,
        variant: "destructive",
      })
    }
  }

  const saveMut = useMutation({
    mutationFn: () =>
      api.writeFile(sandboxId, joinPath(path, selected!.name), editingContent!),
    onSuccess: () => {
      setDirty(false)
      toast({ title: "Saved", description: joinPath(path, selected!.name) })
      qc.invalidateQueries({ queryKey: ["files", sandboxId, path] })
    },
    onError: (e: unknown) =>
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (entry: FileEntry) =>
      api.deleteFile(sandboxId, joinPath(path, entry.name), entry.isDir),
    onSuccess: () => {
      toast({ title: "Deleted" })
      setSelected(null)
      setEditingContent(null)
      qc.invalidateQueries({ queryKey: ["files", sandboxId, path] })
    },
    onError: (e: unknown) =>
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" }),
  })

  const mkdirMut = useMutation({
    mutationFn: () => api.mkdir(sandboxId, joinPath(path, mkdirName.trim())),
    onSuccess: () => {
      setMkdirName("")
      qc.invalidateQueries({ queryKey: ["files", sandboxId, path] })
      toast({ title: "Directory created" })
    },
    onError: (e: unknown) =>
      toast({ title: "Mkdir failed", description: (e as Error).message, variant: "destructive" }),
  })

  const newFileMut = useMutation({
    mutationFn: () =>
      api.writeFile(sandboxId, joinPath(path, newFileName.trim()), ""),
    onSuccess: () => {
      setNewFileName("")
      qc.invalidateQueries({ queryKey: ["files", sandboxId, path] })
      toast({ title: "File created" })
    },
    onError: (e: unknown) =>
      toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" }),
  })

  const uploadMut = useMutation({
    mutationFn: (files: FileList) => api.uploadFiles(sandboxId, path, Array.from(files)),
    onSuccess: (res) => {
      toast({ title: `Uploaded ${res.uploaded.length} file(s)` })
      qc.invalidateQueries({ queryKey: ["files", sandboxId, path] })
    },
    onError: (e: unknown) =>
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" }),
  })

  const crumbs = pathCrumbs(path)

  return (
    <div className="flex h-full min-h-[500px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPath("/workspace")}>
          <HomeIcon className="mr-1 h-3.5 w-3.5" /> /workspace
        </Button>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPath(pathInput.trim() || "/")
          }}
        >
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="font-mono text-xs"
            placeholder="/workspace"
          />
          <Button type="submit" size="sm" variant="outline">
            Go
          </Button>
        </form>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-3.5 w-3.5"} />
          Refresh
        </Button>
        <input
          type="file"
          multiple
          ref={uploadRef}
          className="hidden"
          onChange={(e) => e.target.files && uploadMut.mutate(e.target.files)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={uploadMut.isPending}
        >
          {uploadMut.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3.5 w-3.5" />
          )}
          Upload
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={c.full} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button
              className="hover:text-foreground hover:underline"
              onClick={() => setPath(c.full)}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="grid h-full flex-1 grid-cols-1 gap-3 md:grid-cols-[320px_1fr]">
        <div className="rounded-md border">
          <ScrollArea className="h-[500px]">
            <div className="divide-y">
              {isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-4/5" />
                  <Skeleton className="h-6 w-3/5" />
                </div>
              ) : (data?.entries?.length ?? 0) === 0 ? (
                <EmptyState
                  onCreateFile={() => setNewFileName("new.txt")}
                  onMkdir={() => setMkdirName("new-folder")}
                />
              ) : (
                data!.entries!.map((entry) => (
                  <button
                    key={entry.name}
                    onClick={() => openFile(entry)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent ${
                      selected?.name === entry.name ? "bg-accent/60" : ""
                    }`}
                  >
                    {entry.isDir ? (
                      <Folder className="h-4 w-4 text-sky-500" />
                    ) : entry.isLink ? (
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate text-xs">{entry.name}</span>
                    {!entry.isDir && (
                      <span className="text-[10px] text-muted-foreground">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelative(new Date(entry.mtime * 1000).toISOString())}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-2">
            <div className="flex gap-1">
              <Input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="new file.txt"
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => newFileMut.mutate()}
                disabled={!newFileName.trim() || newFileMut.isPending}
              >
                <FileText className="h-3 w-3" />
              </Button>
            </div>
            <div className="mt-1 flex gap-1">
              <Input
                value={mkdirName}
                onChange={(e) => setMkdirName(e.target.value)}
                placeholder="new folder"
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => mkdirMut.mutate()}
                disabled={!mkdirName.trim() || mkdirMut.isPending}
              >
                <FolderPlus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-h-[500px] flex-col gap-2 rounded-md border p-3">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {joinPath(path, selected.name)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selected.mode} · {formatBytes(selected.size)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={api.downloadFileUrl(sandboxId, joinPath(path, selected.name))}
                    download
                  >
                    <Button size="sm" variant="outline">
                      <Download className="mr-1 h-3.5 w-3.5" /> Download
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!dirty || saveMut.isPending}
                    onClick={() => saveMut.mutate()}
                  >
                    {saveMut.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setToDelete(selected)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {(() => {
                const kind = fileKind(selected.name)
                if (kind === "image") {
                  return (
                    <div className="flex flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/40 p-2">
                      <img
                        src={api.downloadFileUrl(sandboxId, joinPath(path, selected.name))}
                        alt={selected.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  )
                }
                if (kind === "binary") {
                  return (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border bg-muted/30 text-xs text-muted-foreground">
                      <FileIcon className="h-8 w-8" />
                      <span>Binary file ({formatBytes(selected.size)}) — use Download to inspect.</span>
                    </div>
                  )
                }
                if (editingContent === null) {
                  return (
                    <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                  )
                }
                return (
                  <textarea
                    className="flex-1 resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={editingContent}
                    onChange={(e) => {
                      setEditingContent(e.target.value)
                      setDirty(true)
                    }}
                    spellCheck={false}
                  />
                )
              })()}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file on the left to view or edit it.
            </div>
          )}
        </div>
      </div>

      <ConfirmDeleteDialog
        open={!!toDelete}
        title={toDelete?.isDir ? "Delete folder?" : "Delete file?"}
        description={
          toDelete
            ? `${joinPath(path, toDelete.name)} will be removed from the sandbox.`
            : ""
        }
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete)
          setToDelete(null)
        }}
      />
    </div>
  )
}

function EmptyState({
  onCreateFile,
  onMkdir,
}: {
  onCreateFile: () => void
  onMkdir: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center text-xs text-muted-foreground">
      <Folder className="h-8 w-8 text-muted-foreground/60" />
      <div>This directory is empty.</div>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="h-7" onClick={onCreateFile}>
          <FileText className="mr-1 h-3 w-3" /> New file
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={onMkdir}>
          <FolderPlus className="mr-1 h-3 w-3" /> New folder
        </Button>
      </div>
    </div>
  )
}

function joinPath(base: string, name: string) {
  if (base === "/") return "/" + name
  return base.replace(/\/$/, "") + "/" + name
}

function pathCrumbs(p: string) {
  const parts = p.split("/").filter(Boolean)
  const crumbs: { name: string; full: string }[] = [{ name: "/", full: "/" }]
  let full = ""
  for (const part of parts) {
    full += "/" + part
    crumbs.push({ name: part, full })
  }
  return crumbs
}

type FileKind = "text" | "image" | "binary"
function fileKind(name: string): FileKind {
  const lower = name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/.test(lower)) return "image"
  // Binary-looking extensions get a download-only state. Everything else is
  // treated as text — execd's download is permissive about content.
  if (/\.(zip|tar|gz|tgz|xz|bz2|7z|rar|jar|war|class|so|dll|exe|bin|wasm|woff2?|ttf|otf|mp[34]|mkv|mov|avi|webm|pdf|psd|sqlite3?|db|deb|rpm|iso)$/.test(lower)) return "binary"
  return "text"
}

function formatBytes(n: number) {
  if (!Number.isFinite(n)) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
