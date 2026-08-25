(function(){
  const form = document.getElementById('checkout-form');
  const list = document.getElementById('cart-list');
  const countEl = document.getElementById('cart-count');
  const totalEl = document.getElementById('cart-total');
  const statusEl = document.getElementById('order-status');
  const submitBtn = document.getElementById('place-order');

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

  const qs = new URLSearchParams(location.search);
  if (qs.get('cancelled') === '1') {
    status('Checkout cancelled — your cart is still saved.', false);
  }

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
      city: (document.getElementById('city') ? document.getElementById('city').value.trim() : ''),
      country: document.getElementById('country').value,
      state: document.getElementById('state').value.trim(),
      zip: document.getElementById('zip').value.trim(),
    };

    // Only {slug, size, qty} are sent — price, design, and Printful variant are always
    // re-resolved server-side from the product record, never trusted from the client.
    const cart = items.map((item) => ({
      slug: item.slug || null,
      size: item.size || null,
      qty: item.qty,
    }));
    const payload = { cart, customer, site_url: location.origin };
    const API_BASE = window.MINDAR_API_BASE || '';
    try {
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Redirecting to payment…'; }
      status('Preparing secure payment…', false);
      const res = await fetch(`${API_BASE}/api/checkout/session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkout_url) throw new Error(data.error || `Server error ${res.status}`);
      // Do NOT clear the cart here — payment isn't confirmed yet. The cart is only cleared
      // on order-confirmation.html once payment is actually verified as paid.
      location.href = data.checkout_url;
    } catch (err){
      status(`Could not start checkout: ${err.message}`, true);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Continue to Payment'; }
    }
  }

  function status(msg, isError=false){
    if (!statusEl) return;
    statusEl.innerHTML = `<div class="alert ${isError? 'alert-danger':'alert-success'}">${msg}</div>`;
  }

  if (form) form.addEventListener('submit', placeOrder);
})();
