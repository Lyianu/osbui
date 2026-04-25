import { useEffect, useRef } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"

export default function Terminal({ sandboxId }: { sandboxId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const inputBufRef = useRef<string>("")

  useEffect(() => {
    if (!hostRef.current) return
    const term = new XTerm({
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: "#0b0b0e",
        foreground: "#e6e6e6",
        cursor: "#e6e6e6",
      },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const proto = window.location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${proto}://${window.location.host}/panel/terminal/${sandboxId}`)
    wsRef.current = ws

    const onResize = () => {
      fit.fit()
      ws.readyState === WebSocket.OPEN &&
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          })
        )
    }
    window.addEventListener("resize", onResize)

    ws.onopen = () => {
      term.writeln("\x1b[90m— connecting…\x1b[0m")
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === "output" && typeof msg.data === "string") {
          term.write(msg.data)
        }
      } catch {
        term.write(String(ev.data))
      }
    }
    ws.onclose = () => {
      term.writeln("\r\n\x1b[33m— connection closed\x1b[0m")
    }
    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m— connection error\x1b[0m")
    }

    // Line buffering: this terminal uses execd's session-run, which is
    // command-oriented rather than PTY-byte-oriented. We collect input
    // locally until the user hits Enter, then send the whole line.
    term.onData((data) => {
      for (const ch of data) {
        const code = ch.charCodeAt(0)
        if (ch === "\r" || ch === "\n") {
          const line = inputBufRef.current
          inputBufRef.current = ""
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data: line + "\n" }))
          }
        } else if (code === 0x7f || code === 0x08) {
          if (inputBufRef.current.length > 0) {
            inputBufRef.current = inputBufRef.current.slice(0, -1)
            term.write("\b \b")
          }
        } else if (code === 0x03) {
          // Ctrl+C — flush the in-progress line visually and tell the server.
          inputBufRef.current = ""
          term.write("^C\r\n")
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data: "\x03" }))
          }
        } else if (code === 0x0c) {
          // Ctrl+L — clear
          term.clear()
        } else {
          inputBufRef.current += ch
          term.write(ch)
        }
      }
    })

    return () => {
      window.removeEventListener("resize", onResize)
      ws.close()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [sandboxId])

  return (
    <div className="flex h-[500px] flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>bash session · commands are sent on Enter, line-editing via Backspace</span>
        <button
          className="rounded border px-2 py-0.5 hover:bg-accent"
          onClick={() => termRef.current?.clear()}
        >
          Clear
        </button>
      </div>
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden rounded-md border bg-black p-2"
      />
    </div>
  )
}
