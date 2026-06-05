(function(){
  const form = document.getElementById('checkout-form');
  const list = document.getElementById('cart-list');
  const countEl = document.getElementById('cart-count');
  const totalEl = document.getElementById('cart-total');
  const statusEl = document.getElementById('order-status');

  function renderSummary(){
    const items = Cart.list();
    if (countEl) countEl.textContent = Cart.count();
    if (totalEl) totalEl.textContent = Cart.currency(Cart.total());
    if (list){
      list.innerHTML = items.length ? items.map(i => `
        <li class="list-group-item d-flex justify-content-between lh-sm">
          <div>
            <h6 class="my-0">${i.name}</h6>
            <small class="text-body-secondary">Qty: ${i.qty}</small>
          </div>
          <span class="text-body-secondary">${Cart.currency(i.qty * i.price)}</span>
        </li>
      `).join('') : '<li class="list-group-item">Your cart is empty.</li>';
    }
  }

  renderSummary();

  function validate(){
    if (!form) return false;
    form.classList.add('was-validated');
    return form.checkValidity();
  }

  async function placeOrder(e){
    e.preventDefault();
    if (!validate()) return;
    const items = Cart.list();
    if (!items.length) { status('Your cart is empty.', true); return; }
    const customer = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      email: document.getElementById('email').value.trim(),
      address: document.getElementById('address').value.trim(),
<<<<<<< HEAD
      city: (document.getElementById('city') || {}).value?.trim() || '',
=======
      city: (document.getElementById('city') ? document.getElementById('city').value.trim() : ''),
>>>>>>> 6a231e8 (printful integration)
      country: document.getElementById('country').value,
      state: document.getElementById('state').value.trim(),
      zip: document.getElementById('zip').value.trim(),
    };

    const payload = { cart: items, total: Cart.total(), customer };
    const API_BASE = window.MINDAR_API_BASE || '';
    try {
      status('Placing order...', false);
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      status(`Order placed! ID: ${data.order_id}`, false, true);
      // Persist a lightweight order record for dashboard
      const ORDERS_KEY = 'mindar_orders_v1';
      const prev = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      prev.unshift({ order_id: data.order_id, total: Cart.total(), items: Cart.count(), ts: Date.now() });
      localStorage.setItem(ORDERS_KEY, JSON.stringify(prev.slice(0, 50)));
      Cart.clear();
      renderSummary();
    } catch (err){
      status(`Failed to place order: ${err.message}`, true);
    }
  }

  function status(msg, isError=false, success=false){
    if (!statusEl) return;
    statusEl.innerHTML = `<div class="alert ${isError? 'alert-danger':'alert-success'}">${msg}</div>`;
  }

  if (form) form.addEventListener('submit', placeOrder);
})();
