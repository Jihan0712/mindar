import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;

const ALLOW_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

app.use(cors({ origin: (origin, cb) => {
  if (!origin || ALLOW_ORIGINS.includes('*') || ALLOW_ORIGINS.includes(origin)) return cb(null, true);
  return cb(new Error('Not allowed by CORS'));
}, credentials: false }));
app.use(express.json());

// Simple helper to generate order IDs
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`);

// Demo Orders endpoint for checkout flow (no persistence)
app.post('/orders', async (req, res) => {
  try {
    const { cart = [], customer = {}, total } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Cart required' });
    const serverTotal = cart.reduce((a, c) => a + (Number(c.price) * Number(c.qty || 0)), 0);
    const rounded = Math.round(serverTotal * 100) / 100;
    if (typeof total === 'number' && Math.round(total*100)/100 !== rounded) {
      return res.status(400).json({ error: 'Total mismatch' });
    }

    const order_id = newId();
    // In a real app: persist to DB, send emails, create payment intent, etc.
    console.log(`[orders] new order ${order_id}`, {
      items: cart.map(i => ({ id: i.id, qty: i.qty, price: i.price })),
      customer: { firstName: customer.firstName, lastName: customer.lastName, email: customer.email },
      total: rounded
    });

    return res.json({ order_id, status: 'received', total: rounded });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Admin backend listening on :${PORT}`));
