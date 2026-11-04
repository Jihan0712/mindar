import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount } from '../account/account'
import { primeGravity } from '../ar/gravity'
import { Avatar } from '../components/Avatar'
import { BottomNav } from '../components/BottomNav'
import { HeartIcon, ScanIcon, ViewsIcon } from '../components/Icons'
import { nativeVersion } from '../floor/bridge'
import { Logo } from '../components/Logo'
import { count, loadFeed, timeAgo, type FeedPost, type FeedTab } from '../social/social'
import './Feed.css'

/*
 * Home: the feed (step 5, Figma A1). For You = every post, Featured first;
 * Following = the people you follow. Tapping a card opens the post viewer
 * (/p/:id), where swiping up and down goes through the same list.
 */

interface Kept {
  tab: FeedTab
  posts: FeedPost[]
  more: boolean
  scroll: number
  at: number
}
/** The list survives opening a post and coming back (same place, no reload for a minute). */
const kept = new Map<FeedTab, Kept>()

export default function Feed() {
  const account = useAccount()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: FeedTab = params.get('tab') === 'following' ? 'following' : 'foryou'
  const fresh = (k?: Kept) => (k && Date.now() - k.at < 60_000 ? k : undefined)
  const [posts, setPosts] = useState<FeedPost[] | null>(() => fresh(kept.get(tab))?.posts ?? null)
  const [more, setMore] = useState(() => fresh(kept.get(tab))?.more ?? false)
  const [error, setError] = useState('')
  const loading = useRef(false)
  const end = useRef<HTMLDivElement>(null)

  async function load(offset: number) {
    if (loading.current) return
    loading.current = true
    setError('')
    try {
      const page = await loadFeed(tab, offset)
      setPosts((old) => (offset ? [...(old ?? []), ...page.posts.filter((p) => !old?.some((o) => o.id === p.id))] : page.posts))
      setMore(page.more)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      loading.current = false
    }
  }

  // A tab opens from what was kept, else loads (and reloads when the account changes).
  useEffect(() => {
    const k = fresh(kept.get(tab))
    setPosts(k?.posts ?? null)
    setMore(k?.more ?? false)
    if (!k) void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, account?.id])

  useLayoutEffect(() => {
    const k = fresh(kept.get(tab))
    window.scrollTo(0, k?.scroll ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // More posts as the end comes into view.
  useEffect(() => {
    const el = end.current
    if (!el || !more) return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && posts && void load(posts.length), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, posts?.length])

  function open(p: FeedPost) {
    if (posts) kept.set(tab, { tab, posts, more, scroll: window.scrollY, at: Date.now() })
    navigate(`/p/${p.id}`, { state: { list: posts } })
  }

  function scan() {
    // In the iPhone test app: the one AR view (markers and surfaces), with the feed's posts in the strip.
    if (nativeVersion() >= 2 && posts?.length) return navigate(`/p/${posts[0].id}/inrl`, { state: { list: posts, scan: true } })
    primeGravity() // in this tap: iOS asks for motion access, so the camera opens straight away
    navigate('/scan', { state: { autostart: true } })
  }

  const switchTab = (t: FeedTab) => setParams(t === 'following' ? { tab: 'following' } : {}, { replace: true })

  return (
    <main className="feed with-bnav" data-tab={tab}>
      <header className="feed-top">
        <Logo height={30} />
        <button className="feed-scan" aria-label="Scan a marker" onClick={scan}><ScanIcon color="var(--ink-900)" /></button>
      </header>
      <nav className="feed-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'foryou'} onClick={() => switchTab('foryou')}>For You</button>
        <button role="tab" aria-selected={tab === 'following'} onClick={() => switchTab('following')}>Following</button>
      </nav>

      <section className="feed-list">
        {posts?.map((p) => (
          <article key={p.id} className="feed-card" data-id={p.id} onClick={() => open(p)}>
            {p.thumb ? <img src={p.thumb} alt={p.caption || `${p.author.name}’s scene`} loading="lazy" /> : <span className="feed-nopic" />}
            <div className="feed-info">
              <Link to={`/u/${p.author.username}`} className="feed-who" onClick={(e) => e.stopPropagation()} aria-label={`${p.author.name || p.author.username}’s profile`}>
                <Avatar name={p.author.name || p.author.username} src={p.author.avatar} size={31} />
              </Link>
              <div>
                <p className="t-body-14-bold">
                  <Link to={`/u/${p.author.username}`} className="feed-who" onClick={(e) => e.stopPropagation()}>{p.author.name || `@${p.author.username}`}</Link> · {timeAgo(p.created)}
                </p>
                <p className="t-label-12 feed-counts">
                  <span><HeartIcon active color="#fff" /> {count(p.likes)}</span>
                  <span><ViewsIcon color="#fff" /> {count(p.views)}</span>
                </p>
              </div>
            </div>
          </article>
        ))}
        {posts === null && !error && [0, 1].map((i) => <div key={i} className="feed-card feed-ghost" />)}
        {posts?.length === 0 && <Empty tab={tab} signedIn={!!account} />}
        {error && (
          <div className="feed-empty">
            <p className="t-body-14">{error}</p>
            <button className="btn btn-secondary" onClick={() => void load(0)}>Try again</button>
          </div>
        )}
        <div ref={end} />
      </section>
      <BottomNav active="home" />
    </main>
  )
}

function Empty({ tab, signedIn }: { tab: FeedTab; signedIn: boolean }) {
  if (tab === 'following' && !signedIn)
    return (
      <div className="feed-empty">
        <p className="t-body-14">Sign in to follow people and see their new posts here.</p>
        <Link className="btn btn-primary" to="/welcome?next=/?tab=following">Sign in</Link>
      </div>
    )
  if (tab === 'following')
    return (
      <div className="feed-empty">
        <p className="t-body-14">Posts from people you follow show up here. Find people in For You.</p>
      </div>
    )
  return (
    <div className="feed-empty">
      <p className="t-body-14">No posts yet. Make the first one!</p>
      <Link className="btn btn-primary" to="/studio">Open InStudio</Link>
    </div>
  )
}
