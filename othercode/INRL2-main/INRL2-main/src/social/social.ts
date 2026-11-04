import { useEffect, useState } from 'react'
import type { MarkerInfo } from '../account/publish'
import { api } from '../studio/cloud'

/*
 * The social layer, phone side (step 5; worker/social.ts): the home feed,
 * views, profiles and follows. Likes, comments, notifications and Discover
 * join piece by piece (docs/product/step5-plan.md).
 */

export interface Author {
  username: string
  name: string
  avatar?: string | null
}

export interface FeedPost {
  id: string
  caption: string
  thumb: string | null
  objects: number
  created: number
  likes: number
  views: number
  comments: number
  author: Author
}

export type FeedTab = 'foryou' | 'following'

export async function loadFeed(tab: FeedTab, offset = 0): Promise<{ posts: FeedPost[]; more: boolean }> {
  return api(`/api/feed?tab=${tab}&offset=${offset}`)
}

export interface ProfilePost {
  id: string
  caption: string
  thumb: string | null
  objects: number
  created: number
  likes: number
  views: number
  comments: number
}

export interface Profile {
  profile: Author & { bio: string; followers: number; following: number; views: number; me: boolean; followed: boolean; /** You blocked them (only their name shows, to unblock). */ blocked?: boolean }
  posts: ProfilePost[]
  /** The big first card: the post on the marker, else the newest. */
  pinned: string | null
  marker: MarkerInfo | null
}

export async function loadProfile(username: string): Promise<Profile> {
  return api(`/api/u/${encodeURIComponent(username)}`)
}

export async function follow(username: string, on: boolean): Promise<{ followed: boolean; followers: number }> {
  return api(`/api/follows/${encodeURIComponent(username)}`, { method: on ? 'POST' : 'DELETE' })
}

/** Opening a post (or scanning its marker) counts a view, once per person per day. */
export function countView(id: string) {
  if (id === 'test') return
  void api(`/api/posts/${id}/view`, { method: 'POST' }).catch(() => {})
}

/** "now", "5m", "4h", "3d", "2w", then the date (as in Figma A1: "Naomi Pham · 4h"). */
export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  if (s < 5 * 7 * 86400) return `${Math.floor(s / (7 * 86400))}w`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** 950, 1.2K, 3.5M. */
export function count(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// ------------------------------------------------------------------ likes

export async function like(id: string, on: boolean): Promise<{ liked: boolean; likes: number }> {
  return api(`/api/posts/${id}/like`, { method: on ? 'POST' : 'DELETE' })
}

// ---------------------------------------------------------- notifications

export type Note =
  | { kind: 'like'; time: number; post: { id: string; thumb: string | null }; people: Author[]; count: number }
  | { kind: 'follow'; time: number; person: Author; followingBack: boolean }
  | { kind: 'comment'; time: number; person: Author; post: { id: string; thumb: string | null }; text: string }

export async function loadNotes(): Promise<Note[]> {
  return (await api<{ items: Note[] }>('/api/notifications')).items
}

/** The bell's dot: something new since the person last opened Notifications. Checked every minute and when the app comes back. */
const dot = { on: false, at: 0, listeners: new Set<() => void>() }
function setDot(on: boolean) {
  if (dot.on === on) return
  dot.on = on
  dot.listeners.forEach((f) => f())
}
export async function checkNotes() {
  if (Date.now() - dot.at < 15_000) return
  dot.at = Date.now()
  try {
    setDot((await api<{ new: boolean }>('/api/notifications/new')).new)
  } catch {
    setDot(false) // signed out
  }
}
export async function markNotesSeen() {
  setDot(false)
  await api('/api/notifications/seen', { method: 'POST' }).catch(() => {})
}
export function useNotesDot(signedIn: boolean): boolean {
  const [on, setOn] = useState(dot.on)
  useEffect(() => {
    if (!signedIn) return
    const f = () => setOn(dot.on)
    dot.listeners.add(f)
    f()
    void checkNotes()
    const t = setInterval(() => void checkNotes(), 60_000)
    const back = () => document.visibilityState === 'visible' && void checkNotes()
    document.addEventListener('visibilitychange', back)
    return () => {
      dot.listeners.delete(f)
      clearInterval(t)
      document.removeEventListener('visibilitychange', back)
    }
  }, [signedIn])
  return signedIn && on
}

// --------------------------------------------------------------- comments

export interface Comment {
  id: string
  text: string
  created: number
  likes: number
  liked: boolean
  hidden: boolean
  mine: boolean
  author: Author
}

export async function loadComments(post: string): Promise<{ comments: Comment[]; moderator: boolean }> {
  return api(`/api/posts/${post}/comments`)
}
export async function addComment(post: string, text: string): Promise<{ comment: Comment; count: number }> {
  return api(`/api/posts/${post}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
}
export async function deleteComment(id: string): Promise<{ count: number }> {
  return api(`/api/comments/${id}`, { method: 'DELETE' })
}
export async function hideComment(id: string, hide: boolean): Promise<{ hidden: boolean; count: number }> {
  return api(`/api/comments/${id}/${hide ? 'hide' : 'unhide'}`, { method: 'POST' })
}
export async function likeComment(id: string, on: boolean): Promise<{ liked: boolean; likes: number }> {
  return api(`/api/comments/${id}/like`, { method: on ? 'POST' : 'DELETE' })
}

// --------------------------------------------------------------- discover

export interface FoundPerson extends Author {
  followers: number
}

export async function discover(q: string, offset = 0): Promise<{ people: FoundPerson[]; posts: FeedPost[]; more: boolean }> {
  return api(`/api/discover?q=${encodeURIComponent(q)}&offset=${offset}`)
}

// ----------------------------------------------------------------- safety

export type ReportKind = 'post' | 'comment' | 'account'
export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'spam', label: 'It’s spam' },
  { id: 'nudity', label: 'Nudity or sexual content' },
  { id: 'hate', label: 'Hate, bullying or harassment' },
  { id: 'violence', label: 'Violence or something dangerous' },
  { id: 'copyright', label: 'It uses my work, brand or likeness' },
  { id: 'other', label: 'Something else' },
]

export async function report(kind: ReportKind, target: string, reason: string, note = ''): Promise<void> {
  await api('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, target, reason, note }) })
}
export async function block(username: string, on: boolean): Promise<void> {
  await api(`/api/blocks/${encodeURIComponent(username)}`, { method: on ? 'POST' : 'DELETE' })
}
export async function myBlocks(): Promise<Author[]> {
  return (await api<{ blocked: Author[] }>('/api/me/blocks')).blocked
}

export interface AdminReport {
  id: string
  kind: ReportKind
  target: string
  reason: string
  note: string
  created: number
  done: boolean
  reporter: string
  what: { caption?: string; text?: string; name?: string; thumb?: string | null; link: string; by: string; hidden?: boolean } | null
}
export async function adminReports(all = false): Promise<AdminReport[]> {
  return (await api<{ reports: AdminReport[] }>(`/api/admin/reports${all ? '?all=1' : ''}`)).reports
}
export async function adminDone(id: string) {
  await api(`/api/admin/reports/${id}/done`, { method: 'POST' })
}
export async function adminRemove(kind: ReportKind, target: string) {
  await api('/api/admin/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, target }) })
}
