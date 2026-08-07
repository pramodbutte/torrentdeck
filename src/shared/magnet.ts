/**
 * Tiny magnet-URI helpers shared by the renderer (Add dialog) and its tests.
 * No dependencies — pure string parsing so it runs in any of the three worlds.
 *
 * A magnet looks like: magnet:?xt=urn:btih:<infohash>&dn=<name>&tr=<tracker>…
 * The infohash (`btih`) identifies the torrent; the same torrent can appear as
 * many different magnet strings (different trackers / display names), so dedup
 * is by infohash, not by the raw string.
 */

/** Lowercased btih infohash (hex or base32) for a magnet, or null if absent. */
export function magnetInfohash(uri: string): string | null {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(uri)
  return m ? m[1].toLowerCase() : null
}

/** The human display name from a magnet's `dn=` param, decoded, or null. */
export function magnetName(uri: string): string | null {
  const m = /[?&]dn=([^&]+)/.exec(uri)
  if (!m) return null
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null
  } catch {
    return m[1] || null
  }
}

/** True for a syntactically plausible magnet link. */
export function isMagnet(text: string): boolean {
  return text.trim().startsWith('magnet:')
}

/**
 * Extract every magnet link from free text (e.g. a multi-line paste), one per
 * whitespace-separated token, in order.
 */
export function extractMagnets(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(isMagnet)
}

/**
 * Dedupe a list of magnets by infohash, preserving first-seen order. Magnets
 * without a parseable infohash fall back to exact-string identity so they're
 * never silently dropped.
 */
export function dedupeMagnets(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const uri of list) {
    const key = magnetInfohash(uri) ?? uri.trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(uri.trim())
  }
  return out
}

/** A short label for a magnet: its display name, else a shortened infohash. */
export function magnetLabel(uri: string): string {
  const name = magnetName(uri)
  if (name) return name
  const hash = magnetInfohash(uri)
  return hash ? `${hash.slice(0, 16)}…` : uri.slice(0, 24)
}
