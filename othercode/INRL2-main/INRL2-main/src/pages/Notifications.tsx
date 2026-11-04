import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '../account/account'
import { Avatar } from '../components/Avatar'
import { BottomNav } from '../components/BottomNav'
import { follow, loadNotes, markNotesSeen, timeAgo, type Author, type Note } from '../social/social'
import './Feed.css'
import './Notifications.css'

/*
 * Notifications (step 5, Figma G5): Today / Yesterday / Earlier; "a, b and
 * others liked your scene" (one line per post and day, with its picture),
 * "x started following you" with Follow Back / Followed, "x commented: …"
 * (opens the post with its comments). Opening the page
 * clears the bell's dot. In-app only (decision 2026-10-07).
 */

const DAY = 86_400_000

function section(t: number, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  return 'Earlier'
}

function names(people: Author[], count: number) {
  const b = (p: Author) => <b key={p.username}>{p.username}</b>
  if (count === 1) return [b(people[0])]
  if (count === 2 && people.length === 2) return [b(people[0]), ' and ', b(people[1])]
  if (count === 3 && people.length === 3) return [b(people[0]), ', ', b(people[1]), ' and ', b(people[2])]
  const shown = people.slice(0, 2)
  const more = count - shown.length
  return [...shown.flatMap((p, i) => (i ? [', ', b(p)] : [b(p)])), ` and ${more} other${more === 1 ? '' : 's'}`]
}

export default function Notifications() {
  const account = useAccount()
  const [items, setItems] = useState<Note[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!account) return
    loadNotes()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    void markNotesSeen()
  }, [account])

  async function followBack(n: Extract<Note, { kind: 'follow' }>) {
    const on = !n.followingBack
    setItems((list) => list?.map((x) => (x.kind === 'follow' && x.person.username === n.person.username ? { ...x, followingBack: on } : x)) ?? null)
    try {
      await follow(n.person.username, on)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const groups: [string, Note[]][] = []
  for (const n of items ?? []) {
    const s = section(n.time)
    const g = groups.find(([k]) => k === s)
    if (g) g[1].push(n)
    else groups.push([s, [n]])
  }

  return (
    <main className="feed nt with-bnav">
      <header className="feed-top page-title"><h1 className="t-heading-18">Notifications</h1></header>
      {!account ? (
        <div className="feed-empty">
          <p className="t-body-14">Sign in to see who liked your scenes and who follows you.</p>
          <Link className="btn btn-primary" to="/welcome?next=/notifications">Sign in</Link>
        </div>
      ) : items === null && !error ? (
        <div className="feed-empty"><span className="nt-spinner" aria-label="Loading" /></div>
      ) : items?.length === 0 ? (
        <div className="feed-empty"><p className="t-body-14">Nothing yet. When people like your scenes or follow you, it shows here.</p></div>
      ) : (
        groups.map(([title, list]) => (
          <section key={title} className="nt-section">
            <h2 className="nt-title">{title}</h2>
            {list.map((n) =>
              n.kind === 'like' ? (
                <article key={`l${n.post.id}${n.time}`} className="nt-row" data-kind="like">
                  <Link to={`/u/${n.people[0].username}`} className="nt-who"><Avatar name={n.people[0].name || n.people[0].username} src={n.people[0].avatar} size={50} /></Link>
                  <p className="t-body-14">{names(n.people, n.count)} liked your scene. <span className="nt-time">{timeAgo(n.time)}</span></p>
                  <Link to={`/p/${n.post.id}`} className="nt-post" aria-label="Open the post">{n.post.thumb ? <img src={n.post.thumb} alt="" /> : <span />}</Link>
                </article>
              ) : n.kind === 'comment' ? (
                <article key={`c${n.post.id}${n.time}`} className="nt-row" data-kind="comment">
                  <Link to={`/u/${n.person.username}`} className="nt-who"><Avatar name={n.person.name || n.person.username} src={n.person.avatar} size={50} /></Link>
                  <p className="t-body-14"><b>{n.person.username}</b> commented: “{n.text}” <span className="nt-time">{timeAgo(n.time)}</span></p>
                  <Link to={`/p/${n.post.id}`} state={{ comments: true }} className="nt-post" aria-label="Open the post">{n.post.thumb ? <img src={n.post.thumb} alt="" /> : <span />}</Link>
                </article>
              ) : (
                <article key={`f${n.person.username}${n.time}`} className="nt-row" data-kind="follow">
                  <Link to={`/u/${n.person.username}`} className="nt-who"><Avatar name={n.person.name || n.person.username} src={n.person.avatar} size={50} /></Link>
                  <p className="t-body-14"><b>{n.person.username}</b> started following you. <span className="nt-time">{timeAgo(n.time)}</span></p>
                  <button className={`nt-follow${n.followingBack ? '' : ' is-primary'}`} onClick={() => void followBack(n)}>{n.followingBack ? 'Followed' : 'Follow Back'}</button>
                </article>
              ),
            )}
          </section>
        ))
      )}
      {error && <p className="t-label-12 nt-error" role="alert">{error}</p>}
      <BottomNav active="notifications" />
    </main>
  )
}
