(function(){
  // Supabase client init
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[auth] Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js');
  }
  const supabase = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  window.Auth = {
    client: supabase,
    async currentUser(){
      if (!supabase) return null;
      const { data } = await supabase.auth.getUser();
      return data?.user || null;
    },
    async signIn(email, password){
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data?.user || null;
    },
    async signOut(){
      if (!supabase) return;
      await supabase.auth.signOut();
    },
    async requireLogin(){
      const u = await this.currentUser();
      if (!u) window.location.href = 'login.html';
      return !!u;
    }
  };
})();