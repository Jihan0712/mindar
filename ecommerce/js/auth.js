(function(){
  async function authMe(){
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  }

  window.Auth = {
    async currentUser(){
      const j = await authMe();
      return j?.user || null;
    },
    async signIn(){
      // Login lives on the main site page.
      window.location.href = '/login.html';
    },
    async signOut(){
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } finally {
        window.location.href = '/login.html?loggedout=1';
      }
    },
    async requireLogin(){
      const u = await this.currentUser();
      if (!u) window.location.href = '/login.html';
      return !!u;
    }
  };
})();