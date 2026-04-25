/**
 * Connection settings: upstream OpenSandbox URL + API key, persisted in cookies
 * (so the Go backend picks them up) and localStorage (for UI display).
 *
 * When the user leaves these blank the server's flag-provided defaults are
 * used instead.
 */

const KEY_UPSTREAM = "osb_upstream"
const KEY_APIKEY = "osb_apikey"

export interface Connection {
  upstream: string
  apiKey: string
}

function setCookie(name: string, value: string) {
  // SameSite=Lax so subrequests from /sandbox-proxy still forward it.
  const enc = encodeURIComponent(value)
  if (value) {
    document.cookie = `${name}=${enc}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`
  } else {
    document.cookie = `${name}=; Path=/; SameSite=Lax; Max-Age=0`
  }
}

export function getConnection(): Connection {
  return {
    upstream: localStorage.getItem(KEY_UPSTREAM) || "",
    apiKey: localStorage.getItem(KEY_APIKEY) || "",
  }
}

export function setConnection(cn: Partial<Connection>) {
  if (cn.upstream !== undefined) {
    localStorage.setItem(KEY_UPSTREAM, cn.upstream)
    setCookie(KEY_UPSTREAM, cn.upstream)
  }
  if (cn.apiKey !== undefined) {
    localStorage.setItem(KEY_APIKEY, cn.apiKey)
    setCookie(KEY_APIKEY, cn.apiKey)
  }
  window.dispatchEvent(new CustomEvent("osb:connection-changed"))
}

export function hasExplicitConnection(): boolean {
  return !!(localStorage.getItem(KEY_UPSTREAM) || localStorage.getItem(KEY_APIKEY))
}

// Initialize cookies from localStorage at startup (so reloads keep the config
// in sync with the server even if the cookie was cleared).
export function initConnection() {
  const c = getConnection()
  if (c.upstream) setCookie(KEY_UPSTREAM, c.upstream)
  if (c.apiKey) setCookie(KEY_APIKEY, c.apiKey)
}
