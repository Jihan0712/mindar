/* Injects the shared header/footer partials into every storefront page and
   wires the chrome that depends on them: active nav link, the absolutely
   centred wordmark's over-media state, account menu, bag drawer, mobile
   menu, announcement dismiss, newsletter, auth-aware links and admin theme.
   Loaded on every ecommerce/*.html page except dashboard.html. */
(function () {
  async function injectPartial(placeholderId, url) {
    const el = document.getElementById(placeholderId);
    if (!el) return null;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return null;
      const html = await res.text();
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      el.replaceWith(tpl.content);
    } catch (e) {
      console.error('[include] failed to load ' + url, e);
    }
    return true;
  }

  /* ---------- focus trap for drawer / menu / modal (Handoff · Overlays) ---------- */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  let openLayer = null;
  function openOverlay(layer, opener, scrim) {
    if (openLayer) closeOverlay();
    openLayer = { layer, opener, scrim };
    layer.classList.add('is-open');
    if (scrim) scrim.classList.add('is-open');
    document.body.classList.add('is-locked');
    const first = layer.querySelector(FOCUSABLE);
    setTimeout(() => first && first.focus(), 30);
  }
  function closeOverlay() {
    if (!openLayer) return;
    const { layer, opener, scrim } = openLayer;
    layer.classList.remove('is-open');
    if (scrim) scrim.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    openLayer = null;
    if (opener && opener.focus) opener.focus();
    document.querySelectorAll('[data-mmenu-open]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  window.INRLOverlay = { open: openOverlay, close: closeOverlay };
  document.addEventListener('keydown', function (e) {
    if (!openLayer) return;
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(openLayer.layer.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function setActiveNavLink(pageKey) {
    if (!pageKey) return;
    document.querySelectorAll('.snav [data-page]').forEach(function (link) {
      if (link.getAttribute('data-page') === pageKey) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function wireChrome(opts) {
    const nav = document.getElementById('snav');

    /* Announcement bar — dismiss persists for the session */
    const bar = document.getElementById('announce');
    try { if (sessionStorage.getItem('inrl_announce_closed') === '1' && bar) bar.classList.add('is-hidden'); } catch (e) {}
    document.querySelectorAll('[data-announce-close]').forEach(btn => btn.addEventListener('click', function () {
      if (bar) bar.classList.add('is-hidden');
      try { sessionStorage.setItem('inrl_announce_closed', '1'); } catch (e) {}
      document.documentElement.style.setProperty('--bar-offset', '0px');
      onScroll();
    }));

    /* Over-media nav (home hero): transparent with a scrim until the hero is passed */
    function onScroll() {
      if (!nav || !nav.classList.contains('snav--over')) return;
      const hero = document.querySelector('[data-hero]');
      const limit = hero ? hero.offsetHeight - 80 : 200;
      nav.classList.toggle('is-solid', window.scrollY > limit);
      const barH = bar && !bar.classList.contains('is-hidden') ? bar.offsetHeight : 0;
      nav.style.top = nav.classList.contains('is-solid') ? '0px' : Math.max(0, barH - window.scrollY) + 'px';
    }
    if (opts.over && nav) {
      nav.classList.add('snav--over');
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      onScroll();
    }

    /* Account menu */
    const acct = document.getElementById('navAccount');
    const menu = document.getElementById('navAccountMenu');
    if (acct && menu) {
      acct.addEventListener('click', function (e) {
        if (!document.body.dataset.signedIn) return; // guests go to sign in
        e.preventDefault();
        const open = !menu.classList.contains('is-open');
        menu.classList.toggle('is-open', open);
        acct.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!menu.classList.contains('is-open')) return;
        if (e.target.closest('.snav__acct')) return;
        menu.classList.remove('is-open');
        acct.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.classList.contains('is-open')) { menu.classList.remove('is-open'); acct.focus(); }
      });
    }

    /* Bag drawer on desktop; the phone bag is its own page */
    const drawer = document.getElementById('bagDrawer');
    const scrim = document.getElementById('bagScrim');
    window.openBag = function (opener) {
      if (!drawer) { location.href = 'cart.html'; return; }
      if (window.matchMedia('(max-width: 1023.98px)').matches) { location.href = 'cart.html'; return; }
      if (window.CartUI) CartUI.render();
      openOverlay(drawer, opener || document.activeElement, scrim);
    };
    document.querySelectorAll('[data-open-bag]').forEach(a => a.addEventListener('click', function (e) {
      if (window.matchMedia('(max-width: 1023.98px)').matches) return;
      if (/cart\.html$/.test(location.pathname)) return;
      e.preventDefault();
      window.openBag(a);
    }));
    document.querySelectorAll('[data-bag-close]').forEach(el => el.addEventListener('click', closeOverlay));
    const drawerBody = document.getElementById('bagDrawerBody');
    if (drawerBody) drawerBody.setAttribute('data-empty',
      '<div style="padding-top:8px"><p class="t-label" style="margin-bottom:12px">Your bag</p>'
      + '<p class="t-title" style="font-size:28px;text-transform:uppercase;font-family:var(--font-display);color:var(--ink-900);margin:0 0 14px">Nothing in it yet.</p>'
      + '<p class="t-meta">Nothing here is reserved until it is paid for.</p>'
      + '<a class="b" href="shop.html" style="margin-top:12px">See the drop</a></div>');

    /* Mobile menu */
    const mm = document.getElementById('mmenu');
    document.querySelectorAll('[data-mmenu-open]').forEach(btn => btn.addEventListener('click', function () {
      btn.setAttribute('aria-expanded', 'true');
      openOverlay(mm, btn, null);
    }));
    document.querySelectorAll('[data-mmenu-close]').forEach(btn => btn.addEventListener('click', closeOverlay));
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) {
      if (e.matches && openLayer && openLayer.layer === mm) closeOverlay();
    });

    /* Newsletter — one line of success or error text under the field, no modal */
    const form = document.getElementById('newsletterForm');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      const status = document.getElementById('newsletterStatus');
      const email = document.getElementById('newsletterEmail');
      const ok = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      if (!status) return;
      status.classList.toggle('is-error', !ok);
      status.textContent = ok ? "You're on the list. We'll only write when something changes." : 'That email address doesn’t look right.';
      if (ok) email.value = '';
    });

    /* Piece count in the mobile menu */
    const countEl = document.querySelector('[data-piece-count]');
    if (countEl && window.INRL) INRL.fetchProducts().then(items => {
      if (items.length) countEl.textContent = items.length + ' piece' + (items.length === 1 ? '' : 's');
    }).catch(() => {});
  }

  async function wireAuth() {
    let user = null;
    try {
      if (window.auth && typeof auth.me === 'function') {
        const me = await auth.me();
        user = me && me.email ? me : null;
      }
    } catch (e) { /* not signed in / worker unreachable — treat as guest */ }

    if (user) document.body.dataset.signedIn = '1';
    else delete document.body.dataset.signedIn;

    const acct = document.getElementById('navAccount');
    if (acct) {
      acct.setAttribute('href', user ? 'wardrobe.html' : 'login.html');
      if (user) { acct.setAttribute('aria-haspopup', 'menu'); acct.setAttribute('aria-expanded', 'false'); }
    }
    const acctM = document.getElementById('navAccountMobile');
    if (acctM) acctM.setAttribute('href', user ? 'wardrobe.html' : 'login.html');

    const canDashboard = !!(user && (user.role === 'admin' || user.role === 'brand'));
    ['navDashboard', 'navArDashboard', 'navDashboardMobile'].forEach(id => {
      const el = document.getElementById(id); if (el) el.hidden = !canDashboard;
    });
    const logoutM = document.getElementById('navLogoutMobile');
    if (logoutM) logoutM.hidden = !user;
    [document.getElementById('navLogout'), logoutM].forEach(el => {
      if (!el) return;
      el.addEventListener('click', async function (e) {
        e.preventDefault();
        try { await auth.logout(); } catch (err) {}
        location.href = 'index.html';
      });
    });

    document.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: user } }));
  }

  async function init() {
    const headerPlaceholder = document.getElementById('site-header');
    const pageKey = headerPlaceholder ? headerPlaceholder.getAttribute('data-page') : null;
    const over = headerPlaceholder ? headerPlaceholder.hasAttribute('data-over') : false;

    await injectPartial('site-header', 'partials/header.html');
    setActiveNavLink(pageKey);
    wireChrome({ over });
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
