import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortId(id: string, len = 8): string {
  if (!id) return ""
  return id.length <= len ? id : id.slice(0, len)
}

export function formatDate(iso?: string): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export function formatRelative(iso?: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = d.getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const minutes = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  const pick = () => {
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m`
    if (hours < 48) return `${hours}h`
    return `${days}d`
  }
  const label = pick()
  if (label === "just now") return label
  return diffMs < 0 ? `${label} ago` : `in ${label}`
}
