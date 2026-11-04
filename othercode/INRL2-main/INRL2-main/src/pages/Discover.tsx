import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { BottomNav } from '../components/BottomNav'
import { HeartIcon, SearchIcon, ViewsIcon } from '../components/Icons'
import { count, discover, timeAgo, type FeedPost, type FoundPerson } from '../social/social'
import './Feed.css'
import './Discover.css'

/*
 * Discover (step 5, Figma G3): a search field, then scenes popular lately
 * (the first one big, the others two by two). Typing searches people (user
 * name or name) and scenes (caption). A scene opens the post viewer with
 * the list around it.
 */

export default function Discover() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [people, setPeople] = useState<FoundPerson[]>([])
  const [posts, setPosts] = useState<FeedPost[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const loading = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  const query = q.trim()

  // Searching waits for a pause in typing; the address keeps the search (back returns to it).
  useEffect(() => {
    let gone = false
    const t = setTimeout(() => {
      setParams(query ? { q: query } : {}, { replace: true })
      loading.current = true
      discover(query)
        .then((r) => {
          if (gone) return
          setPeople(r.people)
          setPosts(r.posts)
          setMore(r.more)
          setError('')
        })
        .catch((e) => !gone && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => (loading.current = false))
    }, query ? 250 : 0)
    return () => {
      gone = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // More popular scenes as the end comes into view.
  useEffect(() => {
    const el = end.current
    if (!el || !more || query) return
    const io = new IntersectionObserver((e) => {
      if (!e[0]?.isIntersecting || loading.current || !posts) return
      loading.current = true
      discover('', posts.length)
        .then((r) => ((setPosts((old) => [...(old ?? []), ...r.posts.filter((p) => !old?.some((o) => o.id === p.id))]), setMore(r.more))))
        .catch(() => {})
        .finally(() => (loading.current = false))
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, posts, query])

  const open = (p: FeedPost) => navigate(`/p/${p.id}`, { state: { list: posts, tab: 'search' } })
  const card = (p: FeedPost, big: boolean) => (
    <article key={p.id} className={`dc-card${big ? ' is-big' : ''}`} data-id={p.id} onClick={() => open(p)}>
      {p.thumb ? <img src={p.thumb} alt={p.caption || ''} loading="lazy" /> : <span className="feed-nopic" />}
      <div className="dc-info">
        <Avatar name={p.author.name || p.author.username} src={p.author.avatar} size={big ? 31 : 26} />
        <div>
          <p className={big ? 't-body-14-bold' : 't-label-12-medium'}>{p.author.name || `@${p.author.username}`}{big && ` · ${timeAgo(p.created)}`}</p>
          <p className="t-label-12 feed-counts">
            <span><HeartIcon active color="#fff" size={14} /> {count(p.likes)}</span>
            <span><ViewsIcon color="#fff" size={14} /> {count(p.views)}</span>
          </p>
        </div>
      </div>
    </article>
  )

  return (
    <main className="feed dc with-bnav">
      <header className="feed-top page-title"><h1 className="t-heading-18">Discover</h1></header>
      <label className="dc-search">
        <SearchIcon size={20} color="var(--ink-400)" />
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" />
      </label>

      {query && people.length > 0 && (
        <section className="dc-people" aria-label="People">
          {people.map((p) => (
            <Link key={p.username} to={`/u/${p.username}`} className="dc-person">
              <Avatar name={p.name || p.username} src={p.avatar} size={44} />
              <span>
                <strong className="t-body-14-bold">{p.name || p.username}</strong>
                <span className="t-label-12">@{p.username} · {count(p.followers)} follower{p.followers === 1 ? '' : 's'}</span>
              </span>
            </Link>
          ))}
        </section>
      )}

      <section className="dc-grid">
        {posts?.map((p, i) => card(p, i === 0 && !query))}
      </section>
      {posts && posts.length === 0 && !(query && people.length) && (
        <div className="feed-empty"><p className="t-body-14">{query ? `Nothing found for “${query}”.` : 'No scenes yet.'}</p></div>
      )}
      {error && <div className="feed-empty"><p className="t-body-14">{error}</p></div>}
      <div ref={end} />
      <BottomNav active="search" />
    </main>
  )
}
