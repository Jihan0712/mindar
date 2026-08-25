/* Applies admin-configured branding (colors/logo/site name) fetched from
   /api/theme. Values are optional — anything not set by the admin keeps the
   CSS defaults already baked into css/global.css. Call window.applyTheme()
   after the header/footer partials are in the DOM (include.js does this). */
(function () {
  let themePromise = null;

  function fetchTheme() {
    if (themePromise) return themePromise;
    themePromise = (async () => {
      try {
        const res = await (window.apiFetch ? window.apiFetch('/theme') : fetch('/api/theme').then(r => r.json()));
        return (res && res.theme) || null;
      } catch (e) {
        return null;
      }
    })();
    return themePromise;
  }

  function applyColors(colors) {
    if (!colors) return;
    const map = {
      primary: '--nb-green',
      accent: '--nb-yellow',
      dark: '--nb-dark',
      light: '--nb-white',
    };
    const decls = Object.keys(map)
      .filter(k => colors[k])
      .map(k => `${map[k]}: ${colors[k]};`)
      .join(' ');
    if (!decls) return;
    let styleEl = document.getElementById('admin-theme-overrides');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'admin-theme-overrides';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `body { ${decls} }`;
  }

  function applyBranding(theme) {
    if (!theme) return;
    if (theme.logoUrl) {
      document.querySelectorAll('[data-site-logo]').forEach(el => { el.src = theme.logoUrl; });
    }
    if (theme.siteName) {
      document.querySelectorAll('[data-site-name]').forEach(el => { el.textContent = theme.siteName; });
      document.title = document.title.replace(/INRL/g, theme.siteName);
    }
    if (theme.tagline) {
      document.querySelectorAll('[data-site-tagline]').forEach(el => { el.textContent = theme.tagline; });
    }
  }

  window.applyTheme = async function applyTheme() {
    const theme = await fetchTheme();
    if (!theme) return;
    applyColors(theme.colors);
    applyBranding(theme);
  };
})();
