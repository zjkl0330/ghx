import type { KV } from './storage'
import type { AuditEntry } from './types'

const AUDIT_KEY = 'ghx.audit.v1'
const MAX_ENTRIES = 200

/** 追加一条审计记录，最新的在最前，超出上限截断最旧的。 */
export async function appendAudit(
  kv: KV,
  input: Omit<AuditEntry, 'id' | 'at'>,
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    ...input,
    id: globalThis.crypto.randomUUID(),
    at: new Date().toISOString(),
  }
  const list = await readAudit(kv)
  const next = [entry, ...list].slice(0, MAX_ENTRIES)
  await kv.set(AUDIT_KEY, JSON.stringify(next))
  return entry
}

export async function readAudit(kv: KV): Promise<AuditEntry[]> {
  const raw = await kv.get(AUDIT_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as AuditEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function clearAudit(kv: KV): Promise<void> {
  await kv.remove(AUDIT_KEY)
}
