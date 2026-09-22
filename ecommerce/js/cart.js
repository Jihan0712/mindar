/* Simple cart + wishlist manager using localStorage.
   Cart and wishlist are scoped per user — auth-worker.js writes
   'mindar_uid' to localStorage after login and clears it on logout. */
(function(){
  const UID_STORE = 'mindar_uid';

  function cartKey()  { const u = localStorage.getItem(UID_STORE); return u ? 'mindar_cart_v1_' + u : 'mindar_cart_v1'; }
  function wishKey()  { const u = localStorage.getItem(UID_STORE); return u ? 'mindar_wish_v1_' + u : 'mindar_wish_v1'; }

  const load = () => {
    try { return JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch { return []; }
  };
  const save = (items) => localStorage.setItem(cartKey(), JSON.stringify(items));

  const upsert = (items, item) => {
    const i = items.findIndex(x => x.id === item.id);
    if (i === -1) items.push(item);
    else items[i].qty += item.qty;
    return items;
  };

  const currency = (n) => `$${(Math.round(n*100)/100).toFixed(2)}`;

  window.Cart = {
    list() { return load(); },
    add(item) { const next = upsert(load(), item); save(next); },
    setQty(id, qty) {
      qty = Math.max(0, parseInt(qty||0,10));
      const next = load().map(x => x.id === id ? { ...x, qty } : x).filter(x => x.qty>0);
      save(next);
    },
    remove(id) { save(load().filter(x => x.id !== id)); },
    clear() { save([]); },
    count() { return load().reduce((a,c)=>a+c.qty,0); },
    total() { return load().reduce((a,c)=>a+c.qty*c.price,0); },
    currency,
  };

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Split "Boxy Tee (M)" into name + size for display; newer items carry size separately. */
  function lineParts(i) {
    let name = String(i.name || 'Piece');
    let size = i.size || '';
    const m = name.match(/^(.*)\s\(([^)]+)\)$/);
    if (m) { name = m[1]; if (!size) size = m[2]; }
    return { name, size };
  }

  function lineHtml(i) {
    const p = lineParts(i);
    const id = escHtml(i.id);
    const img = i.image ? '<img src="' + escHtml(i.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    const meta = [p.size ? 'Size ' + escHtml(p.size) : '', 'Qty ' + i.qty].filter(Boolean).join('<span class="dot">&middot;</span>');
    const tag = i.ar ? '<span class="pcard__tag">AR layer' + (i.arVersion ? ' &middot; V' + escHtml(i.arVersion) : '') + '</span>' : '';
    return '<div class="line" data-line="' + id + '">'
      + '<div class="ph line__img">' + img + '</div>'
      + '<div style="min-width:0">'
      +   '<p class="line__name">' + escHtml(p.name) + '</p>'
      +   '<div class="line__meta">' + meta + '</div>' + tag
      +   '<div class="stepper" role="group" aria-label="Quantity">'
      +     '<button type="button" data-qty-step="-1" data-qty-for="' + id + '" aria-label="One fewer">&minus;</button>'
      +     '<output class="tnum" aria-live="polite">' + i.qty + '</output>'
      +     '<button type="button" data-qty-step="1" data-qty-for="' + id + '" aria-label="One more">+</button>'
      +   '</div>'
      + '</div>'
      + '<div class="line__end"><span class="line__price price">' + currency(i.qty * i.price) + '</span>'
      +   '<button type="button" class="line__remove" data-remove="' + id + '">Remove</button></div>'
      + '</div>';
  }

  window.CartUI = {
    lineHtml,
    render() {
      const items = Cart.list();
      const count = Cart.count();
      const total = currency(Cart.total());
      document.querySelectorAll('.js-cart-count, #cart-count').forEach(el => el.textContent = count);
      document.querySelectorAll('.js-cart-total, #cart-total').forEach(el => el.textContent = total);

      document.querySelectorAll('[data-bag-lines], #bagDrawerBody').forEach(list => {
        if (!list.dataset.cartUiBound) {
          list.dataset.cartUiBound = '1';
          list.addEventListener('click', (e) => {
            const step = e.target.closest('[data-qty-step]');
            if (step) {
              const id = step.getAttribute('data-qty-for');
              const cur = Cart.list().find(x => x.id === id);
              if (cur) Cart.setQty(id, Math.max(1, cur.qty + Number(step.getAttribute('data-qty-step'))));
              CartUI.render();
              return;
            }
            const rm = e.target.closest('[data-remove]');
            if (rm) { Cart.remove(rm.getAttribute('data-remove')); CartUI.render(); }
          });
        }
        list.innerHTML = items.length
          ? items.map(lineHtml).join('')
          : (list.getAttribute('data-empty') || '<p class="t-meta" style="margin:0">Nothing in it yet.</p>');
      });

      const foot = document.getElementById('bagDrawerFoot');
      if (foot) foot.hidden = !items.length;
      document.dispatchEvent(new CustomEvent('cart:change', { detail: { items, count } }));
    }
  };

  /* Per-user Wishlist */
  const wload = () => { try { return JSON.parse(localStorage.getItem(wishKey()) || '[]'); } catch { return []; } };
  const wsave = (items) => localStorage.setItem(wishKey(), JSON.stringify(items));

  window.Wishlist = {
    list()       { return wload(); },
    count()      { return wload().length; },
    has(id)      { return wload().some(x => x.id === String(id)); },
    add(item)    { const items = wload(); const id = String(item.id); if (!items.some(x => x.id === id)) { items.push({ ...item, id }); wsave(items); } },
    remove(id)   { wsave(wload().filter(x => x.id !== String(id))); },
    toggle(item) { const id = String(item.id); if (this.has(id)) { this.remove(id); return false; } this.add(item); return true; },
    clear()      { wsave([]); },
  };
})();
