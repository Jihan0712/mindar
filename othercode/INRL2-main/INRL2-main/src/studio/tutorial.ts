/** Whether the InStudio tutorial has been seen on this phone (shown automatically only once). */
const KEY = 'inrl.studio.tutorial'

export function tutorialSeen() {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    return true // storage blocked: don't show it on every visit
  }
}

export function markTutorialSeen() {
  try {
    localStorage.setItem(KEY, 'done')
  } catch {
    // ignore
  }
}
