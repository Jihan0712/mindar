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

  window.CartUI = {
    render() {
      const items = Cart.list();
      const list = document.getElementById('cart-list');
      const totalEl = document.getElementById('cart-total');
      const countEl = document.getElementById('cart-count');
      if (countEl) countEl.textContent = Cart.count();
      document.querySelectorAll('.js-cart-count').forEach(el => el.textContent = Cart.count());
      if (totalEl) totalEl.textContent = Cart.currency(Cart.total());
      if (!list) return;

      if (!list.dataset.cartUiBound) {
        list.dataset.cartUiBound = '1';
        list.addEventListener('input', (e) => {
          const target = e.target;
          if (!target || typeof target.getAttribute !== 'function') return;
          const id = target.getAttribute('data-qty-for');
          if (!id) return;
          Cart.setQty(id, target.value);
          CartUI.render();
        });

        list.addEventListener('click', (e) => {
          const target = e.target;
          if (!target || typeof target.getAttribute !== 'function') return;
          const id = target.getAttribute('data-remove');
          if (!id) return;
          Cart.remove(id);
          CartUI.render();
        });
      }

      list.innerHTML = items.length ? items.map(i => `
        <li class="list-group-item d-flex align-items-center gap-3 py-3">
          <img src="${i.image || ''}" alt="${i.name}" style="width:60px;height:60px;object-fit:cover;border:2px solid #1C1C1C;flex-shrink:0">
          <div class="flex-grow-1" style="min-width:0">
            <div style="font-weight:700;text-transform:uppercase;letter-spacing:.05em;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.name}</div>
            <div class="d-flex align-items-center gap-2 mt-1">
              <span style="font-size:.78rem;color:#888">${Cart.currency(i.price)} ea.</span>
              <input type="number" min="1" class="form-control form-control-sm d-inline-block" style="width:68px" value="${i.qty}" data-qty-for="${i.id}">
            </div>
          </div>
          <div class="d-flex flex-column align-items-end gap-2 flex-shrink-0">
            <div style="font-weight:700;font-size:1rem">${Cart.currency(i.qty * i.price)}</div>
            <button class="btn btn-sm btn-outline-dark" style="font-size:.65rem;padding:.2rem .6rem;border-width:2px" data-remove="${i.id}">Remove</button>
          </div>
        </li>`).join('') : '<li class="list-group-item py-3" style="color:#888;font-size:.85rem">Your cart is empty.</li>';
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
