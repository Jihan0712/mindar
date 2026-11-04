/*
 * Stand-ins for Cloudflare's D1 and R2, so cloud saving runs on the
 * development server and in unit tests exactly as live (same worker code,
 * same SQL): D1 is SQLite compiled to WebAssembly (sql.js), R2 is a folder
 * (or memory). Never part of the live worker.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database as SqlDb } from 'sql.js'
import type { Bucket, Database, Statement } from './cloud.ts'

export async function devDatabase(file?: string): Promise<Database> {
  const SQL = await initSqlJs()
  const db: SqlDb = file && existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database()
  const persist = () => {
    if (!file) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, db.export())
  }
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...v) => statement(sql, v),
    async run() {
      db.run(sql, values as never)
      persist()
      return { success: true }
    },
    async all<T>() {
      const st = db.prepare(sql)
      st.bind(values as never)
      const results: T[] = []
      while (st.step()) results.push(st.getAsObject() as T)
      st.free()
      return { results }
    },
    async first<T>() {
      const { results } = await this.all<T>()
      return results[0] ?? null
    },
  })
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      const out = []
      for (const s of statements) out.push(await s.run())
      return out
    },
  }
}

type Stored = { data: Uint8Array; contentType?: string }

/** An R2-like bucket in a folder (dev server) or in memory (tests, when `dir` is omitted). */
export function devBucket(dir?: string): Bucket {
  const mem = new Map<string, Stored>()
  const parts = new Map<string, Map<number, Uint8Array>>()
  const path = (key: string) => join(dir!, key.replace(/[^a-z0-9/._-]/gi, '_'))
  const read = (key: string): Stored | undefined => {
    if (!dir) return mem.get(key)
    const p = path(key)
    if (!existsSync(p)) return undefined
    const meta = existsSync(`${p}.type`) ? readFileSync(`${p}.type`, 'utf8') : undefined
    return { data: new Uint8Array(readFileSync(p)), contentType: meta }
  }
  const write = (key: string, s: Stored) => {
    if (!dir) return void mem.set(key, s)
    const p = path(key)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, s.data)
    if (s.contentType) writeFileSync(`${p}.type`, s.contentType)
  }
  const bytes = async (body: ArrayBuffer | ReadableStream | null) =>
    body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array(body ?? new ArrayBuffer(0))
  const types = new Map<string, string | undefined>()
  return {
    async put(key, body, opts) {
      write(key, { data: await bytes(body), contentType: opts?.httpMetadata?.contentType })
    },
    async head(key) {
      const s = read(key)
      return s ? { size: s.data.byteLength, httpMetadata: { contentType: s.contentType } } : null
    },
    async get(key, opts) {
      const s = read(key)
      if (!s) return null
      const r = opts?.range
      const data = r ? s.data.slice(r.offset, r.offset + r.length) : s.data
      return { body: new Response(data).body!, size: s.data.byteLength, httpMetadata: { contentType: s.contentType } }
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mem.delete(key)
        if (dir) for (const p of [path(key), `${path(key)}.type`]) rmSync(p, { force: true })
      }
    },
    async createMultipartUpload(key, opts) {
      const uploadId = `${key}:${Math.random().toString(36).slice(2)}`
      parts.set(uploadId, new Map())
      types.set(uploadId, opts?.httpMetadata?.contentType)
      return { uploadId }
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        async uploadPart(n, body) {
          const p = parts.get(uploadId)
          if (!p) throw new Error('No such upload')
          p.set(n, await bytes(body))
          return { partNumber: n, etag: `etag-${n}` }
        },
        async complete(list) {
          const p = parts.get(uploadId)
          if (!p) throw new Error('No such upload')
          const chunks = [...list].sort((a, b) => a.partNumber - b.partNumber).map((x) => p.get(x.partNumber)!)
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
          let at = 0
          for (const c of chunks) {
            all.set(c, at)
            at += c.byteLength
          }
          write(key, { data: all, contentType: types.get(uploadId) })
          parts.delete(uploadId)
        },
      }
    },
  }
}
