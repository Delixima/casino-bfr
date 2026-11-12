// Faux supabase-js pour le banc d'essai : mêmes méthodes que celles utilisées par le site.
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('as')) {
    fetch('/__users').then((r) => r.json()).then(() => {});
  }
  const post = async (url, payload) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json();

  // Choix du compte : ?as=joueur|pauvre|admin (mémorisé)
  const ready = (async () => {
    const as = q.get('as');
    if (as) {
      const users = await (await fetch('/__users')).json();
      if (users[as]) localStorage.setItem('harness_uid', users[as].id);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  })();
  const uid = () => localStorage.getItem('harness_uid');

  function createClient() {
    return {
      auth: {
        async getSession() {
          await ready;
          return { data: { session: uid() ? { user: { id: uid() } } : null } };
        },
        async signOut() { localStorage.removeItem('harness_uid'); return {}; },
        async verifyOtp() { return {}; },
      },
      async rpc(name, args) {
        await ready;
        const r = await post('/__rpc', { uid: uid(), name, args: args || {} });
        return { data: r.data === undefined ? null : r.data, error: r.error || null };
      },
      from(table) {
        const st = { filters: [], order: [], limit: null, single: false };
        const b = {
          select() { return b; },
          eq(c, v) { st.filters.push([c, v]); return b; },
          order(c, o) { st.order.push([c, !o || o.ascending !== false]); return b; },
          limit(n) { st.limit = n; return b; },
          maybeSingle() { st.single = true; return b; },
          single() { st.single = true; return b; },
          then(ok, ko) {
            return ready.then(() => post('/__select', { uid: uid(), table, ...st })).then((r) => {
              if (r.error) return { data: null, error: r.error };
              return { data: st.single ? (r.data[0] || null) : r.data, error: null };
            }).then(ok, ko);
          },
        };
        return b;
      },
    };
  }
  window.supabase = { createClient };
})();
