import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { refreshAccount, signOut, useAccount } from '../account/account'
import { attachToMarker, deletePost, ensureMarker, markerLink, myMarker, type MarkerInfo, type MarkerStep } from '../account/publish'
import { Avatar } from '../components/Avatar'
import { BottomNav } from '../components/BottomNav'
import { EditProfile } from '../components/EditProfile'
import { SafetyMenu } from '../components/SafetyMenu'
import { AddPersonIcon, BackIcon, CloseIcon, FollowersIcon, FollowingIcon, HeartIcon, MenuIcon, MoreIcon, PinIcon, PlusIcon, ViewsIcon } from '../components/Icons'
import { block, count, follow, loadProfile, myBlocks, type Author, type Profile as ProfileData, type ProfilePost } from '../social/social'
import { Published } from './Published'
import './Profile.css'

/*
 * A profile (step 5): /u/<username> for anyone (Figma G2 / G21: Follow ↔
 * Unfollow), /me for your own (B1r2: Edit Profile, Share Profile, ☰). Name,
 * @handle, followers / following / views, bio; "Objects": the post on the
 * marker as a big pinned card (decision 2026-10-07), the others two by two
 * (Posts 01); "Marker": the person's marker. Your own Marker tab makes the
 * marker the first time, "Choose the post it shows", "Share/Save"; ☰: a new
 * marker design, My scenes, blocked people, reports (InRL team), test
 * pages, sign out. Someone else's "•••": report or block them.
 */

type Tab = 'posts' | 'marker'

const STEP_TEXT: Record<MarkerStep, string> = {
  drawing: 'Drawing your artwork…',
  compiling: 'Teaching the camera to recognise it…',
  uploading: 'Saving it…',
}

export default function Profile() {
  const account = useAccount()
  const { username: param } = useParams()
  const username = (param ?? account?.username ?? '').toLowerCase()
  const own = !!account && account.username === username
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'marker' ? 'marker' : 'posts'
  const [data, setData] = useState<ProfileData | null>(null)
  const [marker, setMarker] = useState<MarkerInfo | null>(null)
  const [making, setMaking] = useState<{ step: MarkerStep; percent?: number } | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editProfile, setEditProfile] = useState(false)
  const [choice, setChoice] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const [confirmRedesign, setConfirmRedesign] = useState(false)
  const [postMenu, setPostMenu] = useState<ProfilePost | null>(null)
  const [armed, setArmed] = useState(false)
  const [note, setNote] = useState('')
  const [safety, setSafety] = useState(false)
  const [blockedList, setBlockedList] = useState<Author[] | null>(null)

  useEffect(() => {
    if (own) void refreshAccount().catch(() => {})
  }, [own])

  function reload() {
    if (!username) return
    loadProfile(username)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => {
    setData(null)
    reload()
    if (own) myMarker().then(setMarker).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, own, account?.avatar, account?.name, account?.bio])

  // Your marker is made the first time it is needed (a few seconds, on the phone).
  function make(redesign = false) {
    setError('')
    setMaking({ step: 'drawing' })
    ensureMarker((step, percent) => setMaking({ step, percent }), redesign)
      .then((m) => (setMarker(m), reload()))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setMaking(null))
  }
  useEffect(() => {
    if (own && tab === 'marker' && !making) {
      myMarker()
        .then((m) => (m?.ready ? setMarker(m) : make()))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, tab])

  if (!param && !account) return <Navigate to="/welcome?next=/me" replace />

  const p = data?.profile
  const name = p ? p.name || p.username : ''
  const posts = data?.posts ?? []
  const pinned = posts.find((x) => x.id === data?.pinned) ?? null
  const rest = posts.filter((x) => x !== pinned)
  const shownMarker = own ? marker : data?.marker
  const markerPost = own && marker ? (posts.find((x) => x.id === marker.post) ?? posts[0] ?? null) : null

  function flash(text: string) {
    setNote(text)
    setTimeout(() => setNote(''), 2200)
  }

  async function toggleFollow() {
    if (!p) return
    if (!account) return navigate(`/welcome?next=${encodeURIComponent(`/u/${username}`)}`)
    const on = !p.followed
    setData((d) => d && { ...d, profile: { ...d.profile, followed: on, followers: d.profile.followers + (on ? 1 : -1) } })
    try {
      const r = await follow(username, on)
      setData((d) => d && { ...d, profile: { ...d.profile, followed: r.followed, followers: r.followers } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      reload()
    }
  }

  async function shareProfile() {
    const url = `${location.origin}/u/${username}`
    try {
      if (navigator.share) return await navigator.share({ url, title: `${name} on InRL` })
      await navigator.clipboard.writeText(url)
      flash('Link copied')
    } catch {
      // cancelled
    }
  }

  async function shareMarker() {
    if (!marker || !account) return
    try {
      const blob = await (await fetch(marker.image)).blob()
      const file = new File([blob], `inrl-marker-${account.username}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My InRL marker', text: markerLink(marker.code) })
        return
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
    }
    navigate(`/marker?code=${marker.code}`)
  }

  async function publishMarker(post = choice) {
    try {
      setMarker(await attachToMarker(post))
      setEditing(false)
      setPostMenu(null)
      setPublished(true)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(post: ProfilePost) {
    setPostMenu(null)
    setArmed(false)
    setData((d) => d && { ...d, posts: d.posts.filter((x) => x.id !== post.id) })
    try {
      await deletePost(post.id)
      setMarker(await myMarker())
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      reload()
    }
  }

  async function openBlocked() {
    try {
      setBlockedList(await myBlocks())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function unblock(who: string) {
    try {
      await block(who, false)
      setBlockedList((l) => l?.filter((b) => b.username !== who) ?? null)
      if (who === username) reload()
      flash(`Unblocked @${who}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doSignOut() {
    setMenu(false)
    try {
      await signOut()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const open = (post: ProfilePost) => ({ to: `/p/${post.id}`, state: { list: posts, tab: own ? 'profile' : 'home' } })
  const card = (post: ProfilePost, big = false) => (
    <article key={post.id} className={`pf-post${big ? ' is-big' : ''}`} data-id={post.id}>
      <Link {...open(post)} className="pf-open" aria-label={post.caption || 'Open post'}>
        {post.thumb ? <img src={post.thumb} alt="" loading="lazy" /> : <span />}
      </Link>
      {big && <span className="pf-pin" title="On the marker"><PinIcon color="#fff" /></span>}
      <p className="pf-counts t-label-12">
        <span><HeartIcon active color="#fff" size={14} /> {count(post.likes)}</span>
        <span><ViewsIcon color="#fff" size={14} /> {count(post.views)}</span>
      </p>
      {own && (
        <button className="pf-more" aria-label="Post options" onClick={() => ((setArmed(false)), setPostMenu(post))}><MoreIcon color="#fff" /></button>
      )}
    </article>
  )

  return (
    <main className="pf with-bnav" data-tab={tab} data-own={own}>
      <header className="pf-top">
        <button className="pf-icon" aria-label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}><BackIcon /></button>
        {own ? (
          <button className="pf-icon" aria-label="Menu" onClick={() => setMenu(true)}><MenuIcon /></button>
        ) : p && !p.blocked ? (
          <button className="pf-icon" aria-label="More options" onClick={() => setSafety(true)}><MoreIcon /></button>
        ) : (
          <span className="pf-icon" />
        )}
      </header>

      {p?.blocked ? (
        <section className="pf-head">
          <Avatar name={name} src={p.avatar} size={66} />
          <h1 className="pf-name">{name}</h1>
          <p className="t-body-14 pf-handle">@{p.username}</p>
          <p className="t-body-14 pf-blocked">You blocked @{p.username}. You don’t see each other’s posts, comments or likes.</p>
          <div className="pf-buttons"><button className="pf-btn is-primary" onClick={() => void unblock(p.username)}>Unblock</button></div>
        </section>
      ) : p ? (
        <section className="pf-head">
          <Avatar name={name} src={p.avatar} size={66} />
          <h1 className="pf-name">{name}</h1>
          <p className="t-body-14 pf-handle">@{p.username}</p>
          <p className="pf-stats t-body-14">
            <span title="Followers"><FollowersIcon color="var(--ink-400)" /> <b data-count="followers">{count(p.followers)}</b></span>
            <span title="Following"><FollowingIcon color="var(--ink-400)" /> <b>{count(p.following)}</b></span>
            <span title="Views"><ViewsIcon color="var(--ink-400)" /> <b>{count(p.views)}</b></span>
          </p>
          {p.bio && <p className="t-label-12 pf-bio">{p.bio}</p>}
          <div className="pf-buttons">
            {own ? (
              <>
                <button className="pf-btn" onClick={() => setEditProfile(true)}>Edit Profile</button>
                <button className="pf-btn" onClick={() => void shareProfile()}>Share Profile</button>
              </>
            ) : (
              <>
                <button className={`pf-btn${p.followed ? '' : ' is-primary'}`} data-follow={p.followed ? 'on' : 'off'} onClick={() => void toggleFollow()}>
                  {p.followed ? 'Unfollow' : 'Follow'}
                </button>
                <button className="pf-btn-icon" aria-label="Share profile" onClick={() => void shareProfile()}><AddPersonIcon color="var(--ink-400)" /></button>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="pf-head">{error ? <p className="t-body-14 pf-error">{error}</p> : <span className="pf-spinner" aria-label="Loading" />}</section>
      )}

      {!p?.blocked && <nav className="pf-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'posts'} onClick={() => setParams({}, { replace: true })}>Objects</button>
        <button role="tab" aria-selected={tab === 'marker'} onClick={() => setParams({ tab: 'marker' }, { replace: true })}>Marker</button>
      </nav>}

      {tab === 'posts' && !p?.blocked && (
        <section className="pf-grid">
          {own && (
            <Link to="/studio" className="pf-new pf-drafts">
              <span className="t-body-14-medium">My scenes</span>
              <span className="t-label-12">Your drafts in InStudio: open one to edit it and post it</span>
            </Link>
          )}
          {pinned && card(pinned, true)}
          {rest.map((x) => card(x))}
          {data && posts.length === 0 && (
            <p className="t-body-14 pf-empty">{own ? 'Your posts appear here. Tap the middle button below to make a scene, then → to post it.' : `${name} hasn’t posted yet.`}</p>
          )}
        </section>
      )}

      {tab === 'marker' && !p?.blocked && (
        <section className="pf-marker">
          <div className="pf-art">
            {shownMarker?.ready ? (
              <img src={shownMarker.image} alt={`@${username}'s InRL marker`} />
            ) : own ? (
              <div className="pf-making" role="status">
                <span className="pf-spinner" aria-hidden="true" />
                <p className="t-body-14">{making ? STEP_TEXT[making.step] : 'Making your marker…'}</p>
                {making?.percent !== undefined && <progress max={100} value={making.percent} />}
              </div>
            ) : (
              <div className="pf-making"><p className="t-body-14">{name} has no marker yet.</p></div>
            )}
            <Avatar name={name} src={p?.avatar} size={68} className="pf-avatar-over" />
          </div>
          <h2 className="pf-name">{name}</h2>
          <p className="t-body-14 pf-handle">@{username}</p>
          <p className="t-label-12 pf-shows">
            {own ? 'Print it, stick it, wear it: scanning it shows your scene in real life.' : `Scan ${name}’s marker with your camera to see their scene in real life.`}
            {own && <><br />{markerPost ? `It shows: ${markerPost.caption || 'your post'}` : 'It shows your newest post once you post one.'}</>}
          </p>
          <div className="pf-actions">
            {own ? (
              <>
                <button className="btn btn-secondary" disabled={!marker?.ready} onClick={() => ((setChoice(marker?.post ?? posts[0]?.id ?? null)), setEditing(true))}>Choose the post it shows</button>
                <button className="btn btn-primary" disabled={!marker?.ready} onClick={() => void shareMarker()}>Share/Save</button>
              </>
            ) : (
              shownMarker && <Link className="btn btn-primary" to={`/m/${shownMarker.code}`}>See it in real life</Link>
            )}
          </div>
        </section>
      )}

      {error && p && <p className="t-label-12 pf-error" role="alert">{error}</p>}
      {note && <p className="pf-note t-body-14-medium" role="status">{note}</p>}

      {postMenu && (
        <div className="pf-veil" onClick={() => setPostMenu(null)}>
          <div className="pf-sheet" role="dialog" aria-label="Post options" onClick={(e) => e.stopPropagation()}>
            <button className="pf-close" aria-label="Close" onClick={() => setPostMenu(null)}><CloseIcon size={14} /></button>
            <h2 className="t-heading-18">{postMenu.caption || 'Your post'}</h2>
            {marker?.ready && markerPost?.id !== postMenu.id && (
              <button className="btn btn-secondary" onClick={() => void publishMarker(postMenu.id)}>Show it on my marker</button>
            )}
            {armed ? (
              <button className="btn pf-danger" onClick={() => void remove(postMenu)}>Delete it for good</button>
            ) : (
              <button className="btn btn-secondary" onClick={() => setArmed(true)}>Delete post</button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="pf-veil" onClick={() => setEditing(false)}>
          <div className="pf-sheet" role="dialog" aria-label="Choose the post it shows" onClick={(e) => e.stopPropagation()}>
            <button className="pf-close" aria-label="Close" onClick={() => setEditing(false)}><CloseIcon size={14} /></button>
            <h2 className="t-heading-22">Choose the post it shows</h2>
            <p className="t-body-14">Your marker, and everything you printed it on, will show this post.</p>
            <div className="pf-pick">
              {posts.map((x) => (
                <button key={x.id} className={choice === x.id ? 'is-active' : ''} aria-pressed={choice === x.id} onClick={() => setChoice(x.id)}>
                  {x.thumb ? <img src={x.thumb} alt={x.caption || 'Post'} /> : <span>{x.caption || 'Post'}</span>}
                </button>
              ))}
              <Link to="/studio" className="pf-pick-new" aria-label="New post"><PlusIcon size={40} color="var(--ink-500)" /></Link>
            </div>
            <button className="btn btn-primary" disabled={!choice} onClick={() => void publishMarker()}>Show this post</button>
          </div>
        </div>
      )}

      {menu && account && (
        <div className="pf-veil" onClick={() => setMenu(false)}>
          <div className="pf-sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <button className="pf-close" aria-label="Close" onClick={() => setMenu(false)}><CloseIcon size={14} /></button>
            <h2 className="t-heading-18">@{account.username}</h2>
            {confirmRedesign ? (
              <>
                <p className="t-body-14">A new design gets new artwork with the same link. <strong>Markers you already printed or shared stop showing your scene</strong> (their QR code still opens your page).</p>
                <button className="btn btn-primary" onClick={() => ((setConfirmRedesign(false)), setMenu(false), setParams({ tab: 'marker' }, { replace: true }), make(true))}>Make a new design</button>
                <button className="btn btn-secondary" onClick={() => setConfirmRedesign(false)}>Keep my marker</button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={() => setConfirmRedesign(true)}>New marker design</button>
                <Link className="btn btn-secondary" to="/studio">My scenes (InStudio)</Link>
                <button className="btn btn-secondary" onClick={() => ((setMenu(false)), void openBlocked())}>Blocked people</button>
                {account.admin && <Link className="btn btn-secondary" to="/admin">Reports (InRL team)</Link>}
                <Link className="btn btn-secondary" to="/tests">Test pages</Link>
                <button className="btn btn-secondary" onClick={() => void doSignOut()}>Sign out on this phone</button>
              </>
            )}
          </div>
        </div>
      )}

      {safety && p && (
        <SafetyMenu kind="account" target={p.username} username={p.username} onClose={() => setSafety(false)} onBlocked={() => ((setSafety(false)), reload())} />
      )}

      {blockedList && (
        <div className="pf-veil" onClick={() => setBlockedList(null)}>
          <div className="pf-sheet" role="dialog" aria-label="Blocked people" onClick={(e) => e.stopPropagation()}>
            <button className="pf-close" aria-label="Close" onClick={() => setBlockedList(null)}><CloseIcon size={14} /></button>
            <h2 className="t-heading-18">Blocked people</h2>
            {blockedList.length === 0 && <p className="t-body-14 pf-muted">You haven’t blocked anyone.</p>}
            {blockedList.map((b) => (
              <div key={b.username} className="pf-blockrow">
                <Avatar name={b.name || b.username} src={b.avatar} size={40} />
                <span className="t-body-14-medium">@{b.username}</span>
                <button className="pf-btn" onClick={() => void unblock(b.username)}>Unblock</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editProfile && account && <EditProfile account={account} onClose={() => setEditProfile(false)} />}
      {published && <Published onDone={() => setPublished(false)} />}
      <BottomNav active={own ? 'profile' : undefined} />
    </main>
  )
}
