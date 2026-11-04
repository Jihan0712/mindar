/** Waits until every video has a picture to show (at most 2.5 s), so screens never flash black. */
export function firstFrames(videos: HTMLVideoElement[]): Promise<void> {
  const one = (v: HTMLVideoElement) =>
    v.readyState >= 2 ? Promise.resolve() : new Promise<void>((r) => v.addEventListener('loadeddata', () => r(), { once: true }))
  return Promise.race([Promise.all(videos.map(one)).then(() => {}), new Promise<void>((r) => setTimeout(r, 2500))])
}
