import { useEffect, useState } from 'react'
import { getPost, type MarkerInfo, type Owner, type PostFull } from '../account/publish'
import { sceneSchema } from '../scene/schema'
import { loadProfile } from './social'

/** One post as the viewers show it (IN3D in PostView, INRL in PostInrl). */
export interface LoadedPost {
  post: PostFull
  owner: Owner | null
  marker: MarkerInfo | null
}

/** Posts already fetched this visit, shared by the viewers (likes and follows update it in place). */
export const postCache = new Map<string, Promise<LoadedPost>>()

/** The step-1 test marker's scene, as a post (its QR holds …/m/test). */
async function testPost(): Promise<LoadedPost> {
  const scene = sceneSchema.parse(await (await fetch('/test/scene.json')).json())
  return {
    post: { id: 'test', caption: 'The InRL test scene', thumb: null, objects: scene.objects.length, created: 0, scene },
    owner: { username: 'inrl', name: 'InRL' },
    marker: null,
  }
}

export function loadPost(id: string): Promise<LoadedPost> {
  let p = postCache.get(id)
  if (!p) {
    p = id === 'test' ? testPost() : getPost(id).then((r) => ({ post: { ...r.post, scene: sceneSchema.parse(r.post.scene) }, owner: r.owner, marker: r.marker ?? null }))
    p.catch(() => postCache.delete(id))
    postCache.set(id, p)
  }
  return p
}

export interface StripItem {
  id: string
  thumb?: string | null
  caption?: string
}

const authorPosts = new Map<string, Promise<StripItem[]>>()

/**
 * The posts in a post's bottom strip (IN3D and INRL): the list it was opened
 * from (feed, profile, Discover). Opened without one (a shared link, Safari
 * handing over to the test app with a single post), the author's posts, as
 * on their profile (like a marker, a doorway into its owner's work).
 */
export function useStripList(id: string, given: StripItem[]): StripItem[] {
  const [found, setFound] = useState<{ for: string; list: StripItem[] } | null>(null)
  const has = given.length > 1 && given.some((p) => p.id === id)
  useEffect(() => {
    if (has) return
    let live = true
    loadPost(id)
      .then((d) => {
        const user = d.owner?.username
        if (!user) return
        let p = authorPosts.get(user)
        if (!p) {
          p = loadProfile(user).then((r) => r.posts.map((x) => ({ id: x.id, thumb: x.thumb, caption: x.caption })))
          p.catch(() => authorPosts.delete(user))
          authorPosts.set(user, p)
        }
        return p
      })
      .then((list) => live && list?.some((p) => p.id === id) && setFound({ for: id, list }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id, has])
  if (has) return given
  // Keep the author's list while swiping through it.
  if (found && found.list.some((p) => p.id === id)) return found.list
  return given
}
