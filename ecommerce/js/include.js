/* Injects the shared header/footer partials into every storefront page and
   wires up the bits that depend on them (active nav link, auth-aware
   login/logout/dashboard links, cart count, admin theme). Loaded on every
   ecommerce/*.html page except dashboard.html, which keeps its own admin nav. */
(function () {
  async function injectPartial(placeholderId, url) {
    const el = document.getElementById(placeholderId);
    if (!el) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      el.outerHTML = await res.text();
    } catch (e) {
      console.error('[include] failed to load ' + url, e);
    }
    return el;
  }

  function setActiveNavLink(pageKey) {
    if (!pageKey) return;
    document.querySelectorAll('.navbar-nav .nav-link[data-page]').forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('data-page') === pageKey);
    });
  }

  async function wireAuth() {
    const loginEl = document.getElementById('navLogin');
    const logoutEl = document.getElementById('navLogout');
    const dashEl = document.getElementById('navDashboard');
    const arDashEl = document.getElementById('navArDashboard');
    let user = null;
    try {
      if (window.auth && typeof auth.me === 'function') {
        const me = await auth.me();
        user = me && me.email ? me : null;
      }
    } catch (e) { /* not signed in / worker unreachable — treat as guest */ }

    if (loginEl) loginEl.style.display = user ? 'none' : '';
    if (logoutEl) {
      logoutEl.style.display = user ? '' : 'none';
      logoutEl.addEventListener('click', async function (e) {
        e.preventDefault();
        await auth.logout();
        location.reload();
      });
    }
    const canDashboard = user && (user.role === 'admin' || user.role === 'brand');
    if (dashEl) dashEl.style.display = canDashboard ? '' : 'none';
    if (arDashEl) arDashEl.style.display = canDashboard ? '' : 'none';

    document.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: user } }));
  }

  async function init() {
    const headerPlaceholder = document.getElementById('site-header');
    const pageKey = headerPlaceholder ? headerPlaceholder.getAttribute('data-page') : null;

    await injectPartial('site-header', 'partials/header.html');
    setActiveNavLink(pageKey);
    wireAuth();
    if (window.CartUI && typeof CartUI.render === 'function') CartUI.render();

    await injectPartial('site-footer', 'partials/footer.html');

    if (typeof window.applyTheme === 'function') window.applyTheme();

    document.dispatchEvent(new CustomEvent('header:loaded'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
