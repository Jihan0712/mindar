/* Checkout (F1 · Checkout). Collects the shipping/billing details, then hands
   off to Stripe's hosted payment page via /api/checkout/session. Card details
   are only ever entered on Stripe. Stripe returns here with ?cancelled=1 when
   the customer backs out; ?declined=1 is shown as the "card declined" state. */
(function () {
  const form = document.getElementById('checkout-form');
  const statusEl = document.getElementById('order-status');
  const submitBtn = document.getElementById('place-order');
  const banner = document.getElementById('coBanner');
  const DEFAULT_NOTE = 'Your bag is saved. Nothing is charged until you place the order.';

  function esc(s) { return window.INRL ? INRL.esc(s) : String(s || ''); }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--danger-500)' : '';
  }

  function showBanner(kind) {
    if (!banner) return;
    if (kind === 'declined') {
      banner.innerHTML = '<div class="decl" role="alert"><p class="t-label">The card was declined</p>'
        + '<p>Nothing was charged and your bag is untouched. The bank did not say why &mdash; it is usually the security code, an expiry date, or a block on foreign payments. Try the card again, or use another one.</p></div>';
      if (submitBtn) submitBtn.textContent = 'Try again';
      setStatus('Still failing? Write to contact@inrl.co and we will send a payment link.');
    } else if (kind === 'cancelled') {
      banner.innerHTML = '<div class="decl decl--soft" role="status"><p class="t-label">Payment not finished</p>'
        + '<p>You left the payment page before paying. Nothing was charged and your bag is exactly as you left it.</p></div>';
    }
  }

  function syncEmpty() {
    const empty = !Cart.count();
    const emptyEl = document.getElementById('coEmpty');
    if (emptyEl) emptyEl.hidden = !empty;
    if (form) form.hidden = empty;
  }

  /* Remember what was typed, for this tab only, so a cancelled or declined
     payment doesn't make the customer type their address again. */
  const FIELDS = ['firstName', 'lastName', 'email', 'address', 'city', 'country', 'state', 'zip'];
  const KEY = 'inrl_checkout_details';
  function saveDetails() {
    const d = {};
    FIELDS.forEach(id => { const el = document.getElementById(id); if (el) d[id] = el.value; });
    try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  }
  function restoreDetails() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!d) return;
    FIELDS.forEach(id => { const el = document.getElementById(id); if (el && d[id]) el.value = d[id]; });
  }

  function fieldError(el, on) {
    const field = el.closest('.field');
    if (!field) return;
    field.classList.toggle('is-error', on);
    const help = field.querySelector('.field-help');
    if (help) help.hidden = !on;
    el.setAttribute('aria-invalid', on ? 'true' : 'false');
  }

  function validate() {
    let firstBad = null;
    FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const bad = !el.checkValidity() || (el.required && !el.value.trim());
      fieldError(el, bad);
      if (bad && !firstBad) firstBad = el;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { if (el.closest('.field.is-error') && el.checkValidity() && el.value.trim()) fieldError(el, false); });
    el.addEventListener('change', saveDetails);
  });

  async function placeOrder(e) {
    e.preventDefault();
    if (!validate()) { setStatus('Some details are missing — they are marked in red.', true); return; }
    const items = Cart.list();
    if (!items.length) { syncEmpty(); return; }

    // Items added before slug tracking can't be re-priced server-side; say which ones.
    const badItems = items.filter(item => !item.slug);
    if (badItems.length) {
      setStatus('Remove and re-add "' + badItems.map(i => i.name).join(', ') + '" — it was added before we could track its product link. Everything else in your bag is fine.', true);
      return;
    }

    const val = id => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');
    const customer = {
      firstName: val('firstName'), lastName: val('lastName'), email: val('email'),
      address: val('address'), city: val('city'), country: val('country'),
      state: val('state'), zip: val('zip'),
    };
    // Only {slug, size, qty} are sent — price, design and Printful variant are
    // always re-resolved server-side from the product record.
    const cart = items.map(item => ({ slug: item.slug || null, size: item.size || null, qty: item.qty }));
    const API_BASE = window.MINDAR_API_BASE || '';
    saveDetails();
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Opening secure payment…';
      setStatus('Taking you to Stripe to pay.');
      const res = await fetch(`${API_BASE}/api/checkout/session`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart, customer, site_url: location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkout_url) throw new Error(data.error || `Server error ${res.status}`);
      // The bag is only cleared on order-confirmation.html once payment is verified.
      location.href = data.checkout_url;
    } catch (err) {
      setStatus('Could not start the payment: ' + err.message + '. Nothing was charged.', true);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place order';
    }
  }

  const qs = new URLSearchParams(location.search);
  if (qs.get('declined') === '1') showBanner('declined');
  else if (qs.get('cancelled') === '1') showBanner('cancelled');
  else setStatus(DEFAULT_NOTE);

  restoreDetails();
  document.addEventListener('cart:change', syncEmpty);
  if (window.CartUI) CartUI.render();
  syncEmpty();
  if (form) form.addEventListener('submit', placeOrder);
})();
