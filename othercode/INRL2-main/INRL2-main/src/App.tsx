import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Feed from './pages/Feed'
import MarkerPage from './pages/MarkerPage'

// The 3D and AR screens pull in three.js and the tracker; load them on demand.
const ArTest = lazy(() => import('./pages/ArTest'))
const Preview3D = lazy(() => import('./pages/Preview3D'))
const LookTest = lazy(() => import('./pages/LookTest'))
const MyScenes = lazy(() => import('./pages/MyScenes'))
const Studio = lazy(() => import('./pages/Studio'))
const StudioPreview = lazy(() => import('./pages/StudioPreview'))
const StudioThumbs = lazy(() => import('./pages/StudioThumbs'))
const FloorTest = lazy(() => import('./pages/FloorTest'))
const MarkerView = lazy(() => import('./pages/MarkerView'))
const Welcome = lazy(() => import('./pages/Welcome'))
const Profile = lazy(() => import('./pages/Profile'))
const NewPost = lazy(() => import('./pages/NewPost'))
const PostView = lazy(() => import('./pages/PostView'))
const PostInrl = lazy(() => import('./pages/PostInrl'))
const Tests = lazy(() => import('./pages/Tests'))
const Discover = lazy(() => import('./pages/Discover'))
const Admin = lazy(() => import('./pages/Admin'))
const Notifications = lazy(() => import('./pages/Notifications'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/p/:id" element={<PostView />} />
          <Route path="/p/:id/inrl" element={<PostInrl />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/tests" element={<Tests />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/marker" element={<MarkerPage />} />
          <Route path="/ar" element={<ArTest />} />
          <Route path="/3d" element={<Preview3D />} />
          <Route path="/look" element={<LookTest />} />
          <Route path="/studio" element={<MyScenes />} />
          <Route path="/studio/edit/:id" element={<Studio />} />
          <Route path="/studio/preview/:id" element={<StudioPreview />} />
          <Route path="/studio/thumbs" element={<StudioThumbs />} />
          <Route path="/floor" element={<FloorTest />} />
          <Route path="/m/:code" element={<MarkerView />} />
          <Route path="/scan" element={<MarkerView />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/me" element={<Profile />} />
          <Route path="/u/:username" element={<Profile />} />
          <Route path="/studio/post/:id" element={<NewPost />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
