(function(){
  const API_BASE = '/api';

  async function apiFetch(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
    });
    const isJSON = res.headers.get('content-type')?.includes('application/json');
    let data = null;
    try { data = isJSON ? await res.json() : null; } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || res.statusText || 'Request failed';
      throw new Error(msg);
    }
    return data;
  }

  const auth = {
    async login(email, password) {
      await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      return true;
    },
    async me() {
      try { return await apiFetch('/auth/me'); } catch { return null; }
    },
    async logout() {
      try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    },
    async requireRole(allowed = [], { redirectTo = '/login.html', next = location.pathname + location.search } = {}) {
      const user = await auth.me();
      if (!user) {
        const sep = redirectTo.includes('?') ? '&' : '?';
        location.href = `${redirectTo}${sep}next=${encodeURIComponent(next)}`;
        return null;
      }
      if (allowed.length && !allowed.includes(user.role)) {
        await auth.logout();
        const sep = redirectTo.includes('?') ? '&' : '?';
        location.href = `${redirectTo}${sep}next=${encodeURIComponent(next)}`;
        return null;
      }
      return user;
    },
    redirectByRole(user, overrides = {}) {
      if (!user) return;
      if (user.role === 'admin') location.href = overrides.admin || '/admin.html';
      else if (user.role === 'brand') location.href = overrides.brand || '/brand.html';
      else location.href = overrides.client || '/client.html';
    }
  };

  window.apiFetch = apiFetch;
  window.auth = auth;
})();
