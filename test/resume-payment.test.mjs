// Resume payment must never leave two payable Stripe pages for one order: the old Checkout
// Session is expired (or found already paid) before a new one is made. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, seedUser } from './helpers/worker-harness.mjs';

async function setup({ oldStatus = 'open', expireFails = false, withSession = true } = {}) {
  const h = await makeHarness();
  const buyer = seedUser(h, 'buyer1', 'client');
  h.exec(`insert into orders (id, user_id, email, first_name, last_name, address, country, state, zip, total_cents,
                              items_json, status, payment_status, stripe_session_id)
          values ('ord_1', 'buyer1', 'buyer1@test', 'B', 'One', '1 St', 'US', 'CA', '90001', 2400, ?, 'pending_payment', 'unpaid', ?)`,
    JSON.stringify([{ slug: 'inrl-beta', size: 'M', qty: 1, name: 'INRL BETA (M)', price_cents: 1900 }]),
    withSession ? 'cs_old' : null);
  h.onFetch((url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (url.endsWith('/checkout/sessions/cs_old') && method === 'GET') return Response.json({ id: 'cs_old', status: oldStatus });
    if (url.endsWith('/checkout/sessions/cs_old/expire')) {
      return expireFails
        ? Response.json({ error: { message: 'boom' } }, { status: 500 })
        : Response.json({ id: 'cs_old', status: 'expired' });
    }
    if (url.endsWith('/checkout/sessions') && method === 'POST') return Response.json({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' });
    return new Response('{}', { status: 404 });
  });
  return { h, buyer };
}

const sessionId = h => h.q("select stripe_session_id from orders where id = 'ord_1'")[0].stripe_session_id;
const created = h => h.outside.filter(c => c.url.endsWith('/checkout/sessions') && c.method === 'POST');
const expired = h => h.outside.filter(c => c.url.endsWith('/checkout/sessions/cs_old/expire') && c.method === 'POST');

test('an open old session is expired before the new one is created', async () => {
  const { h, buyer } = await setup();
  try {
    const r = await h.call('POST', '/api/orders/ord_1/resume-payment', { token: buyer, body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.checkout_url, 'https://checkout.stripe.test/cs_new');
    assert.equal(expired(h).length, 1, 'old session expired');
    const expireAt = h.outside.indexOf(expired(h)[0]);
    const createAt = h.outside.indexOf(created(h)[0]);
    assert.ok(expireAt < createAt, 'expired before the new session is created');
    assert.equal(sessionId(h), 'cs_new');
  } finally { h.restore(); }
});

test('an already expired old session is not expired again', async () => {
  const { h, buyer } = await setup({ oldStatus: 'expired' });
  try {
    const r = await h.call('POST', '/api/orders/ord_1/resume-payment', { token: buyer, body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(expired(h).length, 0);
    assert.equal(sessionId(h), 'cs_new');
  } finally { h.restore(); }
});

test('refused when the old session was already paid (webhook not yet arrived)', async () => {
  const { h, buyer } = await setup({ oldStatus: 'complete' });
  try {
    const r = await h.call('POST', '/api/orders/ord_1/resume-payment', { token: buyer, body: {} });
    assert.equal(r.status, 409, r.text);
    assert.equal(created(h).length, 0, 'no second payment page');
    assert.equal(sessionId(h), 'cs_old');
  } finally { h.restore(); }
});

test('if the old session cannot be closed, no new one is made', async () => {
  const { h, buyer } = await setup({ expireFails: true });
  try {
    const r = await h.call('POST', '/api/orders/ord_1/resume-payment', { token: buyer, body: {} });
    assert.equal(r.status, 502, r.text);
    assert.equal(created(h).length, 0, 'no second payment page');
    assert.equal(sessionId(h), 'cs_old');
  } finally { h.restore(); }
});

test('an order with no previous session still gets one', async () => {
  const { h, buyer } = await setup({ withSession: false });
  try {
    const r = await h.call('POST', '/api/orders/ord_1/resume-payment', { token: buyer, body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(sessionId(h), 'cs_new');
  } finally { h.restore(); }
});
