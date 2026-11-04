import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAccount } from '../account/account'
import { useNotesDot } from '../social/social'
import { createScene } from '../studio/scenes'
import { BellIcon, CreateIcon, HomeIcon, PersonIcon, SearchIcon } from './Icons'
import './BottomNav.css'

export type NavTab = 'home' | 'search' | 'notifications' | 'profile'

/**
 * The floating bottom bar (Figma NAV MENU 2): Home, Search, Create (a new
 * scene in InStudio, decisions 2026-10-07), Notifications, Profile. The active tab's icon is
 * filled teal.
 */
export function BottomNav({ active }: { active?: NavTab }) {
  const account = useAccount()
  const { pathname, search } = useLocation()
  const dot = useNotesDot(!!account)
  const navigate = useNavigate()
  // Create opens a fresh scene in the editor; its × comes back here.
  const create = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(`/studio/edit/${createScene().id}`, { state: { from: pathname + search, fresh: true } })
  }
  const icon = (tab: NavTab) => ({ active: tab === active, color: tab === active ? 'var(--teal-500)' : 'var(--ink-700)' })
  // Tapping the tab you are on goes back to its top.
  const top = (tab: NavTab) => (e: React.MouseEvent) => {
    if (tab === active && pathname === e.currentTarget.getAttribute('href')) {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  return (
    <nav className="bnav" aria-label="Main">
      <Link to="/" aria-label="Home" aria-current={active === 'home' ? 'page' : undefined} onClick={top('home')}><HomeIcon {...icon('home')} /></Link>
      <Link to="/discover" aria-label="Search" aria-current={active === 'search' ? 'page' : undefined} onClick={top('search')}><SearchIcon {...icon('search')} /></Link>
      <Link to="/studio" aria-label="Create" className="bnav-create" onClick={create}><CreateIcon color="var(--teal-700)" /></Link>
      <Link to="/notifications" aria-label={dot ? 'Notifications (new)' : 'Notifications'} aria-current={active === 'notifications' ? 'page' : undefined} onClick={top('notifications')} className="bnav-bell">
        <BellIcon {...icon('notifications')} />
        {dot && active !== 'notifications' && <span className="bnav-dot" data-testid="bell-dot" />}
      </Link>
      <Link to={account ? '/me' : '/welcome?next=/me'} aria-label="Profile" aria-current={active === 'profile' ? 'page' : undefined} onClick={top('profile')}><PersonIcon {...icon('profile')} /></Link>
    </nav>
  )
}
