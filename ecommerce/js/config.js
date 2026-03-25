// Ecommerce config
// Checkout posts orders to `${MINDAR_API_BASE}/api/orders`.
// Empty string = same-origin Cloudflare Worker at /api/orders.
window.MINDAR_API_BASE = window.MINDAR_API_BASE || '';