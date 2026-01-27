/* Simple cart manager using localStorage */
(function(){
  const KEY = 'mindar_cart_v1';

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  };
  const save = (items) => localStorage.setItem(KEY, JSON.stringify(items));

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
      list.innerHTML = items.length ? items.map(i => `
        <li class="list-group-item d-flex align-items-center justify-content-between gap-2">
          <img src="${i.image}" alt="${i.name}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">
          <div class="flex-grow-1">
            <div class="fw-semibold">${i.name}</div>
            <div class="text-muted small">${Cart.currency(i.price)} x 
              <input type="number" min="1" class="form-control d-inline-block" style="width:70px" value="${i.qty}" data-qty-for="${i.id}">
            </div>
          </div>
          <div class="text-end">
            <div>${Cart.currency(i.qty * i.price)}</div>
            <button class="btn btn-link text-danger p-0 small" data-remove="${i.id}">Remove</button>
          </div>
        </li>`).join('') : '<li class="list-group-item">Your cart is empty.</li>';

      list.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-qty-for');
        if (!id) return;
        Cart.setQty(id, e.target.value);
        this.render();
      });
      list.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-remove');
        if (!id) return;
        Cart.remove(id);
        this.render();
      });
    }
  };
})();
