/* Wardrobe rail (desktop ≥1024): renders into #app-rail with the item named by
   data-active marked current, fills the signed-in user, and gates the page —
   anyone not signed in is sent to sign in and brought back afterwards. */
(function () {
  const I = {
    wardrobe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 7a2 2 0 1 1 2-2M12 7v2L3 16.5a1 1 0 0 0 .6 1.8h16.8a1 1 0 0 0 .6-1.8L12 9"/></svg>',
    register: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 7h16v13H4zM9 7V4h6v3"/></svg>',
    store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 21V9l5 3V9l5 3V5h8v16z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M11 12h8M16 9l3 3-3 3"/></svg>',
  };

  function item(key, href, label, active) {
    return '<a class="rail__item" href="' + href + '"' + (key === active ? ' aria-current="page"' : '') + '>' + I[key] + label + '</a>';
  }

  function render(el, user) {
    const active = el.getAttribute('data-active');
    const email = (user && user.email) || '';
    const initial = (email[0] || 'N').toUpperCase();
    const esc = window.INRL ? INRL.esc : (s => s);
    el.innerHTML =
      '<div class="rail__brand"><a href="index.html"><img src="images/logo-light.svg" alt="INRL"></a><span>Your wardrobe</span></div>'
      + '<nav aria-label="Wardrobe">'
      + item('wardrobe', 'wardrobe.html', 'My wardrobe', active)
      + '<div class="rail__label">Closet</div>'
      + item('register', 'register-piece.html', 'Register a piece', active)
      + '<div class="rail__label">Account</div>'
      + item('settings', 'account.html', 'Settings', active)
      + item('orders', 'order-tracking.html', 'Your orders', active)
      + '</nav>'
      + '<div class="rail__foot">'
      +   '<div class="rail__user"><span class="av" aria-hidden="true">' + esc(initial) + '</span><div>' + esc(email) + '<small>Owner</small></div></div>'
      +   '<a href="shop.html">' + I.store + 'Store</a>'
      +   '<a href="/">' + I.camera + 'Open the camera</a>'
      +   '<button type="button" data-rail-signout>' + I.out + 'Sign out</button>'
      + '</div>';
    const so = el.querySelector('[data-rail-signout]');
    if (so) so.addEventListener('click', async function () { try { await auth.logout(); } catch (e) {} location.href = 'index.html'; });
  }

  window.AppRail = {
    /* Resolves with the signed-in user, or redirects to sign in. */
    ready: (async function () {
      let user = null;
      try { user = window.auth ? await auth.me() : null; } catch (e) {}
      const el = document.getElementById('app-rail');
      if (el) render(el, user);
      if (!user && !document.body.hasAttribute('data-public')) {
        location.href = 'login.html?next=' + encodeURIComponent(location.pathname.replace(/^.*\//, '') + location.search);
        return new Promise(() => {});
      }
      return user;
    })(),
  };
})();
