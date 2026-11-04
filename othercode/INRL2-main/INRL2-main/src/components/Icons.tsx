// Line icons matching the REVISED screens (24px, ink-700 by default).
type P = { size?: number; color?: string }
const svg = (size: number, color: string, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
export const BackIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M20 12H5M11 5l-7 7 7 7" />)
export const MenuIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M4 7h16M4 12h16M4 17h16" />)
export const SoundOnIcon = ({ size = 24, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>)
export const SoundOffIcon = ({ size = 24, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9l5 6M22 9l-5 6" /></>)
export const CloseIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M5 5l14 14M19 5L5 19" />)
export const ArrowRightIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M4 12h15M13 5l7 7-7 7" />)
export const PlusIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M12 4v16M4 12h16" />)
export const TrashIcon = ({ size = 24, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>)
export const UpDownIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" />)
export const EditIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />)
export const AlertIcon = ({ size = 24, color = 'currentColor' }: P) => svg(size, color, <><circle cx="12" cy="12" r="10" /><path d="M12 7v6M12 16.5v.5" /></>)

// InStudio toolbar icons (Figma E2r2): filled glyphs in ink-700.
const solid = (size: number, color: string, d: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">{d}</svg>
)
export const CubeIcon = ({ size = 26, color = 'currentColor' }: P) =>
  solid(size, color, <><path d="M12 2l9 5-9 5-9-5 9-5z" opacity="0.75" /><path d="M3 8.5l8.2 4.6V22L3 17.4V8.5z" /><path d="M21 8.5l-8.2 4.6V22l8.2-4.6V8.5z" opacity="0.55" /></>)
export const TextToolIcon = ({ size = 26, color = 'currentColor' }: P) =>
  solid(size, color, <path d="M10.6 3h2.8l6.4 17h-3l-1.6-4.5H8.8L7.2 20h-3L10.6 3zm-.9 10h4.6L12 6.6 9.7 13z" />)
export const AvatarIcon = ({ size = 26, color = 'currentColor' }: P) =>
  solid(size, color, <><circle cx="12" cy="7.5" r="4.5" /><path d="M3 21c0-4.4 4-7.5 9-7.5s9 3.1 9 7.5v1H3v-1z" /></>)
export const StickerIcon = ({ size = 26, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M20 12a8 8 0 1 1-8-8h3l5 5v3z" /><path d="M15 4v3a2 2 0 0 0 2 2h3" /><circle cx="9" cy="10.5" r="0.6" /><circle cx="14" cy="10.5" r="0.6" /><path d="M8.5 14.5c1.8 2 5.2 2 7 0" /></>)
export const MediaIcon = ({ size = 26, color = 'currentColor' }: P) =>
  solid(size, color, <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1.5 13.5h13l-4.2-5.6-3.3 4.2-2.2-2.6-3.3 4zM8.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fillRule="evenodd" />)
export const CameraIcon = ({ size = 40, color = 'currentColor' }: P) =>
  solid(size, color, <path d="M9 4h6l1.6 2.2H20a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V7.7A1.5 1.5 0 0 1 4 6.2h3.4L9 4zm3 4.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zm0 2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z" fillRule="evenodd" />)
export const GifIcon = ({ size = 26, color = 'currentColor' }: P) =>
  solid(size, color, <path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 4 4zm4.6 5.2c-1.6 0-2.8 1.2-2.8 2.8s1.2 2.8 2.8 2.8c.8 0 1.5-.3 2-.8v-2.3H8.4v1.1h1v.7c-.2.1-.5.2-.8.2-.9 0-1.5-.7-1.5-1.7s.6-1.7 1.6-1.7c.5 0 .9.2 1.2.5l.8-.9c-.5-.5-1.2-.7-2.1-.7zm3.6.1v5.4h1.3V9.3h-1.3zm2.4 0v5.4h1.3v-2.1h2v-1.1h-2V10.4h2.3V9.3h-3.6z" fillRule="evenodd" />)
export const MotionIcon = ({ size = 24, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M12 4a8 8 0 1 1-7.4 5" /><path d="M3 5.5l1.6 3.6 3.6-1.6" /><circle cx="12" cy="12" r="2.2" /></>)
export const UndoIcon = ({ size = 22, color = 'currentColor' }: P) => svg(size, color, <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />)
export const RedoIcon = ({ size = 22, color = 'currentColor' }: P) => svg(size, color, <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />)
export const HelpIcon = ({ size = 18, color = 'currentColor' }: P) => svg(size, color, <><path d="M9.2 9.2a2.9 2.9 0 1 1 4 2.7c-.8.4-1.2 1-1.2 1.9v.4" /><path d="M12 17.2v.3" /></>)
export const CloudIcon = ({ size = 16, color = 'currentColor' }: P) => svg(size, color, <path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18z" />)
export const CloudOffIcon = ({ size = 16, color = 'currentColor' }: P) => svg(size, color, <><path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18z" /><path d="M4 4l16 16" /></>)

// Bottom bar (Figma NAV MENU 2): outline when inactive, filled teal when active.
type N = P & { active?: boolean }
const nav = (size: number, color: string, active: boolean, outline: React.ReactNode, filled: React.ReactNode) =>
  active ? solid(size, color, filled) : svg(size, color, outline)
export const HomeIcon = ({ size = 28, color = 'currentColor', active = false }: N) =>
  nav(size, color, active, <path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" />, <path d="M3.2 10.4L12 3.2l8.8 7.2V21h-6.6v-5.6H9.8V21H3.2z" />)
export const SearchIcon = ({ size = 28, color = 'currentColor', active = false }: N) =>
  nav(size, color, active, <><circle cx="10.8" cy="10.8" r="6.8" /><path d="M16 16l4.5 4.5" /></>, <><circle cx="10.8" cy="10.8" r="7.6" /><path d="M15.6 17.1l1.5-1.5 4.6 4.6-1.5 1.5z" /></>)
export const BellIcon = ({ size = 28, color = 'currentColor', active = false }: N) =>
  nav(size, color, active, <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21.5h4" /></>, <><path d="M5.2 17.2V11a6.8 6.8 0 0 1 13.6 0v6.2l1.8 2.4H3.4z" /><path d="M9.4 20.8h5.2v1.4H9.4z" /></>)
export const PersonIcon = ({ size = 28, color = 'currentColor', active = false }: N) =>
  nav(size, color, active, <><circle cx="12" cy="8" r="4.2" /><path d="M4 20.5c0-3.6 3.6-6 8-6s8 2.4 8 6zM4 20.5h16" /></>, <><circle cx="12" cy="8" r="4.8" /><path d="M3.2 21.2c0-4.1 3.9-7 8.8-7s8.8 2.9 8.8 7z" /></>)
/** Corner brackets around a "+" in a circle: the centre Create button. */
export const CreateIcon = ({ size = 30, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M3 8.5V7a4 4 0 0 1 4-4h1.5M15.5 3H17a4 4 0 0 1 4 4v1.5M21 15.5V17a4 4 0 0 1-4 4h-1.5M8.5 21H7a4 4 0 0 1-4-4v-1.5" /><circle cx="12" cy="12" r="5" /><path d="M12 9.6v4.8M9.6 12h4.8" /></>)
/** Corner brackets around a lens (A1, top right): scan a marker. */
export const ScanIcon = ({ size = 34, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M3 8V7a4 4 0 0 1 4-4h1M16 3h1a4 4 0 0 1 4 4v1M21 16v1a4 4 0 0 1-4 4h-1M8 21H7a4 4 0 0 1-4-4v-1" /><circle cx="12" cy="12" r="5.2" /><circle cx="12" cy="12" r="3" fill={color} stroke="none" /></>)
export const HeartIcon = ({ size = 16, color = 'currentColor', active = false }: N) =>
  nav(size, color, active, <path d="M12 20s-7.5-4.6-7.5-10A4.4 4.4 0 0 1 12 7.4 4.4 4.4 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />, <path d="M12 20.6S3.7 15.6 3.7 9.8A5.1 5.1 0 0 1 12 6.4a5.1 5.1 0 0 1 8.3 3.4c0 5.8-8.3 10.8-8.3 10.8z" />)
/** An eye in scan brackets (views, A1). */
export const ViewsIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M3 7V5.5A2.5 2.5 0 0 1 5.5 3H7M17 3h1.5A2.5 2.5 0 0 1 21 5.5V7M21 17v1.5a2.5 2.5 0 0 1-2.5 2.5H17M7 21H5.5A2.5 2.5 0 0 1 3 18.5V17" /><path d="M5.5 12s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z" /><circle cx="12" cy="12" r="1.6" /></>)
export const ShareIcon = ({ size = 28, color = 'currentColor' }: P) => svg(size, color, <path d="M14 5l6.5 6-6.5 6v-3.6c-4.6 0-7.6 1.4-10 5 .8-5.3 3.6-9.4 10-10.2z" />)
export const CommentIcon = ({ size = 28, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M4 5h16v11H11l-5 4v-4H4z" /><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth={2.4} /></>)
export const MoreIcon = ({ size = 24, color = 'currentColor' }: P) =>
  solid(size, color, <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>)
/** Followers / following (B1r2 stats): a person with an arrow in / out. */
export const FollowersIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5z" /><path d="M22 11h-5M19 8.5 16.5 11l2.5 2.5" /></>)
export const FollowingIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5z" /><path d="M16.5 11h5M19 8.5l2.5 2.5-2.5 2.5" /></>)
export const AddPersonIcon = ({ size = 20, color = 'currentColor' }: P) =>
  svg(size, color, <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5 1.4 0 2.7.3 3.7.9" /><circle cx="17.5" cy="16.5" r="4" /><path d="M17.5 14.8v3.4M15.8 16.5h3.4" /></>)
export const PinIcon = ({ size = 22, color = 'currentColor' }: P) =>
  solid(size, color, <path d="M14.6 2.6l6.8 6.8-2 .6-3.4 3.4.4 4.6-1.6 1.6-4-4-5.6 5.6-1.2-.2-.2-1.2 5.6-5.6-4-4L7 7.6l4.6.4L15 4.6z" />)
