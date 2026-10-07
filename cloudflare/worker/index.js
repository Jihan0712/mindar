// Cloudflare Worker: R2 assets + auth/targets/viewer APIs (Cloudflare-only backend)

  // Inline Printful helper module so this worker can run in single-file deployments
  // where sibling ES modules are not uploaded alongside worker.js.
  const Printful = (() => {
    const PRINTFUL_BASE = 'https://api.printful.com/v2';

    function normalizePrintfulPath(path) {
      let p = String(path || '').trim();
      if (!p.startsWith('/')) p = '/' + p;

      // Avoid /v2/v2/... when callers pass explicit v2 paths.
      if (p === '/v2') p = '/';
      else if (p.startsWith('/v2/')) p = p.slice(3);

      return p;
    }

    function getPrintfulConfig(env) {
      const apiKey = String(env?.PRINTFUL_API_KEY || '').trim();
      const storeId = String(env?.PRINTFUL_STORE_ID || '').trim();
      const webhookSecret = String(env?.PRINTFUL_WEBHOOK_SECRET || '').trim();
      const catalogProductId = parseInt(env?.PRINTFUL_CATALOG_PRODUCT_ID, 10) || null;
      return { apiKey, storeId, webhookSecret, catalogProductId };
    }

    function printfulStoreQuery(env) {
      const { storeId } = getPrintfulConfig(env);
      return storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
    }

    function buildPrintfulUrl(env, path) {
      const normalizedPath = normalizePrintfulPath(path);
      const qs = printfulStoreQuery(env);
      if (!qs) return `${PRINTFUL_BASE}${normalizedPath}`;
      const separator = normalizedPath.includes('?') ? '&' : '?';
      return `${PRINTFUL_BASE}${normalizedPath}${separator}${qs.slice(1)}`;
    }

    async function callPrintful(env, method, path, body) {
      const { apiKey } = getPrintfulConfig(env);
      if (!apiKey) throw new Error('PRINTFUL_API_KEY is not configured');

      const opts = {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-PF-Language': 'en_US',
        },
      };
      if (body != null) opts.body = JSON.stringify(body);

      const res = await fetch(buildPrintfulUrl(env, path), opts);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) || JSON.stringify(json);
        throw new Error(`Printful ${res.status}: ${msg}`);
      }
      return json;
    }

    // ---- v1 API (Sync Products) ----
    // v2 has no equivalent to v1's "Sync Products" (products designed directly in
    // Printful's own dashboard at printful.com, then pulled in here via the API) — v2's
    // own docs list this under "Retired Resources": "Product management, with sync
    // products or product templates, is not available in version 2 of the API yet." So
    // importing a sync product means calling v1 directlay, alongside (not instead of) the
    // v2 calls above — both API versions accept the same private-token auth.
    const PRINTFUL_V1_BASE = 'https://api.printful.com';

    async function callPrintfulV1(env, method, path, body) {
      const { apiKey, storeId } = getPrintfulConfig(env);
      if (!apiKey) throw new Error('PRINTFUL_API_KEY is not configured');

      let p = String(path || '').trim();
      if (!p.startsWith('/')) p = '/' + p;

      const opts = {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      };
      // v1 scopes an account-level token to one store via this header (a store-level
      // token — the common case — already implies its own store and ignores it); v2 uses
      // a ?store_id= query param instead (see printfulStoreQuery above).
      if (storeId) opts.headers['X-PF-Store-Id'] = storeId;
      if (body != null) opts.body = JSON.stringify(body);

      const res = await fetch(`${PRINTFUL_V1_BASE}${p}`, opts);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) || JSON.stringify(json);
        throw new Error(`Printful v1 ${res.status}: ${msg}`);
      }
      return json;
    }

    // GET /store/products — v1's paginated list of sync products (each with variant/
    // synced counts and a thumbnail) created directly in Printful's own dashboard.
    async function listSyncProducts(env) {
      const limit = 100;
      let offset = 0;
      let all = [];
      while (true) {
        const data = await callPrintfulV1(env, 'GET', `/store/products?limit=${limit}&offset=${offset}`);
        const list = Array.isArray(data && data.result) ? data.result : [];
        all = all.concat(list);
        const total = data && data.paging && Number.isFinite(Number(data.paging.total))
          ? Number(data.paging.total)
          : null;
        offset += limit;
        if (!list.length) break;
        if (total != null && all.length >= total) break;
        if (total == null && list.length < limit) break;
        if (offset > 5000) break; // safety cap against runaway pagination
      }
      return all;
    }

    // GET /store/products/{id} — full sync_product + sync_variants[] detail, including
    // each variant's already-attached print file and Printful-rendered preview/thumbnail
    // images (files[].preview_url / files[].thumbnail_url) — no separate mockup-generation
    // call is needed for these, Printful already rendered them when the product was made.
    async function getSyncProduct(env, id) {
      const data = await callPrintfulV1(env, 'GET', `/store/products/${Number(id)}`);
      return (data && data.result) || null;
    }

    // v2's catalog endpoints are paginated (max 100/page) with no server-side name search,
    // so browsing/searching means walking every page once per request.
    async function fetchAllPaginated(env, path) {
      const limit = 100;
      let offset = 0;
      let all = [];
      while (true) {
        const sep = path.includes('?') ? '&' : '?';
        const data = await callPrintful(env, 'GET', `${path}${sep}limit=${limit}&offset=${offset}`);
        const items = (data && (data.data ?? data.result)) || [];
        const list = Array.isArray(items) ? items : [];
        all = all.concat(list);
        const total = data && data.paging && Number.isFinite(Number(data.paging.total))
          ? Number(data.paging.total)
          : null;
        offset += limit;
        if (!list.length) break;
        if (total != null && all.length >= total) break;
        if (total == null && list.length < limit) break;
        if (offset > 5000) break; // safety cap against runaway pagination
      }
      return all;
    }

    // GET /v2/catalog-products/{id} does not include an embedded variants array —
    // variants are a separate paginated resource.
    async function fetchCatalogProduct(env, catalogProductId) {
      const id = Number(catalogProductId);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Invalid catalog product id');
      }
      const data = await callPrintful(env, 'GET', `/catalog-products/${id}`);
      const product = (data && (data.data ?? data.result)) || null;
      if (!product) return null;
      const variants = await fetchAllPaginated(env, `/catalog-products/${id}/catalog-variants`);
      return { ...product, variants };
    }

    async function listCatalogProducts(env) {
      return fetchAllPaginated(env, '/catalog-products');
    }

    function normalizeSizeLabel(s) {
      return String(s || '').trim().toUpperCase();
    }

    function normalizeColorLabel(s) {
      return String(s || '').trim().toLowerCase();
    }

    function resolveCatalogVariants(catalogProduct, sizes, color, overrideMap) {
      const variants = Array.isArray(catalogProduct?.variants) ? catalogProduct.variants : [];
      const colorNorm = normalizeColorLabel(color);
      const resolved = [];
      const missing = [];

      // Overrides are hand-typed Printful variant IDs, not matched via find() above —
      // look the id up in the catalog product's own variant list to recover its cost.
      const priceById = (id) => {
        const v = variants.find(v => Number(v.id) === Number(id));
        return v && v.price != null ? v.price : null;
      };

      for (const size of sizes) {
        const sizeNorm = normalizeSizeLabel(size);
        if (!sizeNorm) continue;

        if (overrideMap && overrideMap[sizeNorm] != null) {
          const variantId = Number(overrideMap[sizeNorm]);
          resolved.push({ size, variant_id: variantId, price: priceById(variantId) });
          continue;
        }
        if (overrideMap && overrideMap[size] != null) {
          const variantId = Number(overrideMap[size]);
          resolved.push({ size, variant_id: variantId, price: priceById(variantId) });
          continue;
        }

        const match = variants.find(v => {
          const vSize = normalizeSizeLabel(v.size);
          const vColor = normalizeColorLabel(v.color);
          if (vSize !== sizeNorm) return false;
          if (!colorNorm) return true;
          return vColor === colorNorm || vColor.includes(colorNorm) || colorNorm.includes(vColor);
        });

        if (match && match.id) {
          resolved.push({ size, variant_id: Number(match.id), price: match.price != null ? match.price : null });
        } else {
          missing.push(size);
        }
      }

      return { resolved, missing };
    }

    // Same matching approach as resolveCatalogVariants above, adapted to a v1 sync
    // product's own sync_variants[] (each already has size/color directly on it, no
    // nested catalog lookup needed) — maps this local product's sizes to the sync variant
    // ids Printful will actually fulfill against.
    function resolveSyncVariants(syncProduct, sizes, color, overrideMap) {
      const variants = Array.isArray(syncProduct?.sync_variants) ? syncProduct.sync_variants : [];
      const colorNorm = normalizeColorLabel(color);
      const resolved = [];
      const missing = [];

      const priceById = (id) => {
        const v = variants.find(v => Number(v.id) === Number(id));
        return v && v.retail_price != null ? v.retail_price : null;
      };

      for (const size of sizes) {
        const sizeNorm = normalizeSizeLabel(size);
        if (!sizeNorm) continue;

        if (overrideMap && overrideMap[sizeNorm] != null) {
          const syncVariantId = Number(overrideMap[sizeNorm]);
          resolved.push({ size, sync_variant_id: syncVariantId, price: priceById(syncVariantId) });
          continue;
        }
        if (overrideMap && overrideMap[size] != null) {
          const syncVariantId = Number(overrideMap[size]);
          resolved.push({ size, sync_variant_id: syncVariantId, price: priceById(syncVariantId) });
          continue;
        }

        const match = variants.find(v => {
          const vSize = normalizeSizeLabel(v.size);
          const vColor = normalizeColorLabel(v.color);
          if (vSize !== sizeNorm) return false;
          if (!colorNorm) return true;
          return vColor === colorNorm || vColor.includes(colorNorm) || colorNorm.includes(vColor);
        });

        if (match && match.id) {
          resolved.push({ size, sync_variant_id: Number(match.id), price: match.retail_price != null ? match.retail_price : null });
        } else {
          missing.push(size);
        }
      }

      return { resolved, missing };
    }

    // GET /v2/catalog-products/{id}/mockup-styles — mockup_style_ids is a required field
    // on mockup-task creation, so this is how the worker discovers a valid one instead of
    // hardcoding a style id that may not exist for every garment. Returns an array grouped
    // BY PLACEMENT — each item is {placement, technique, mockup_styles: [{id, ...}], ...},
    // not a flat list of style objects; the group itself has no "id".
    async function listMockupStyles(env, catalogProductId) {
      const data = await callPrintful(env, 'GET', `/catalog-products/${Number(catalogProductId)}/mockup-styles`);
      const list = (data && (data.data ?? data.result)) || [];
      return Array.isArray(list) ? list : [];
    }

    // POST /v2/mockup-tasks — kicks off async mockup rendering (a design printed onto a
    // real photo of the garment). Returns a task id; the mockup itself isn't ready yet,
    // it has to be polled via getMockupTask. Returns the FULL raw response unwrapped —
    // callers should try several envelope shapes rather than assume one, since Printful's
    // v2-beta docs haven't matched the actual response shape here on the first two guesses.
    async function createMockupTaskRaw(env, { catalogProductId, catalogVariantIds, mockupStyleIds, placement, technique, imageUrl, layers, format }) {
      const payload = {
        format: format || 'jpg',
        products: [{
          source: 'catalog',
          mockup_style_ids: mockupStyleIds,
          catalog_product_id: Number(catalogProductId),
          catalog_variant_ids: catalogVariantIds.map(Number),
          placements: [{
            placement: placement || 'front',
            technique: technique || 'dtg',
            layers: layers && layers.length ? layers : [{ type: 'file', url: imageUrl }],
          }],
        }],
      };
      return callPrintful(env, 'POST', '/mockup-tasks', payload);
    }

    // GET /v2/mockup-tasks?id=... — poll until status leaves "pending"/"processing".
    // Returns the raw response unwrapped — same reasoning as createMockupTaskRaw.
    async function getMockupTaskRaw(env, taskId) {
      return callPrintful(env, 'GET', `/mockup-tasks?id=${encodeURIComponent(taskId)}`);
    }

    return {
      getPrintfulConfig,
      printfulStoreQuery,
      callPrintful,
      callPrintfulV1,
      fetchCatalogProduct,
      listCatalogProducts,
      resolveCatalogVariants,
      resolveSyncVariants,
      listMockupStyles,
      createMockupTaskRaw,
      getMockupTaskRaw,
      listSyncProducts,
      getSyncProduct,
    };
  })();

  // Inline Stripe helper module — hosted Stripe Checkout only (no card data ever touches
  // this Worker). Talks to Stripe's REST API directly via fetch + Web Crypto, matching the
  // Printful module's style, since a Node-oriented SDK doesn't fit this single-file deploy.
  const Stripe = (() => {
    const STRIPE_BASE = 'https://api.stripe.com/v1';

    function getStripeConfig(env) {
      const secretKey = String(env?.STRIPE_SECRET_KEY || '').trim();
      const webhookSecret = String(env?.STRIPE_WEBHOOK_SECRET || '').trim();
      return { secretKey, webhookSecret };
    }

    // Stripe's REST API takes application/x-www-form-urlencoded with bracket notation
    // for nested objects/arrays (e.g. line_items[0][price_data][unit_amount]=500).
    function appendFormParam(params, key, value) {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => appendFormParam(params, `${key}[${i}]`, v));
      } else if (typeof value === 'object') {
        for (const k of Object.keys(value)) appendFormParam(params, `${key}[${k}]`, value[k]);
      } else {
        params.append(key, String(value));
      }
    }

    function toFormBody(obj) {
      const params = new URLSearchParams();
      for (const k of Object.keys(obj || {})) appendFormParam(params, k, obj[k]);
      return params.toString();
    }

    async function callStripe(env, method, path, body) {
      const { secretKey } = getStripeConfig(env);
      if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');

      let url = `${STRIPE_BASE}${path}`;
      const opts = {
        method,
        headers: { Authorization: `Bearer ${secretKey}` },
      };
      if (body != null && method === 'GET') {
        const qs = toFormBody(body);
        if (qs) url += (url.includes('?') ? '&' : '?') + qs;
      } else if (body != null) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = toFormBody(body);
      }

      const res = await fetch(url, opts);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) || JSON.stringify(json);
        throw new Error(`Stripe ${res.status}: ${msg}`);
      }
      return json;
    }

    async function createCheckoutSession(env, params) {
      return callStripe(env, 'POST', '/checkout/sessions', params);
    }

    // Verifies the `Stripe-Signature` header per Stripe's documented scheme:
    // header is `t=<timestamp>,v1=<hmac-sha256 hex of "timestamp.rawBody">[,v1=...]`.
    async function verifyWebhookSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
      if (!sigHeader || !secret) return false;
      const parsed = String(sigHeader).split(',').reduce((acc, part) => {
        const eq = part.indexOf('=');
        if (eq === -1) return acc;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k === 't') acc.t = v;
        else if (k === 'v1') acc.v1.push(v);
        return acc;
      }, { t: null, v1: [] });
      if (!parsed.t || !parsed.v1.length) return false;

      const timestamp = parseInt(parsed.t, 10);
      if (!Number.isFinite(timestamp)) return false;
      if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parsed.t}.${rawBody}`));
      const expectedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      return parsed.v1.some((v1) => timingSafeEqual(v1, expectedHex));
    }

    return { getStripeConfig, createCheckoutSession, verifyWebhookSignature };
  })();

  // ---------- QR code (per-shirt QR printed with each order) ----------
  //
  // The Worker ships as one file with no bundler, so the encoder lives inline. Byte mode,
  // error correction level H (survives ~30% damage — it is printed on fabric and drawn as a
  // flowing emblem), versions 1-10 (a /p/<code> link is ~35 bytes, version 4). Layout,
  // masking and penalty scoring follow ISO/IEC 18004 and match the `qrcode` npm library
  // module-for-module.
  const QR = (() => {
    // Level H block structure per version: [ec codewords per block, [blocks, data codewords]...]
    const EC_BLOCKS = [null,
      [17, [1, 9]], [28, [1, 16]], [22, [2, 13]], [16, [4, 9]], [22, [2, 11], [2, 12]],
      [28, [4, 15]], [26, [4, 13], [1, 14]], [26, [4, 14], [2, 15]], [24, [4, 12], [4, 13]], [28, [6, 15], [2, 16]],
    ];
    const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
    const EC_LEVEL_BITS = 2; // format-info bits for level H (L=1, M=0, Q=3, H=2)

    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
    const gfMul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

    function rsGenerator(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        const next = new Uint8Array(poly.length + 1);
        for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gfMul(poly[j], EXP[i]); }
        poly = next;
      }
      return poly;
    }
    function rsRemainder(data, degree) {
      const gen = rsGenerator(degree);
      const buf = new Uint8Array(data.length + degree); buf.set(data);
      for (let i = 0; i < data.length; i++) {
        const coef = buf[i];
        if (coef) for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], coef);
      }
      return buf.slice(data.length);
    }

    function dataCapacity(version) {
      const [, ...groups] = EC_BLOCKS[version];
      return groups.reduce((n, [blocks, dc]) => n + blocks * dc, 0);
    }

    function encodeCodewords(bytes, version) {
      const capacity = dataCapacity(version);
      const bits = [];
      const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
      push(0b0100, 4);
      push(bytes.length, version < 10 ? 8 : 16);
      for (const b of bytes) push(b, 8);
      const maxBits = capacity * 8;
      for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
      while (bits.length % 8) bits.push(0);
      const data = new Uint8Array(capacity);
      let n = 0;
      for (; n < bits.length / 8; n++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[n * 8 + k]; data[n] = v; }
      for (let pad = 0; n < capacity; n++, pad++) data[n] = pad % 2 ? 0x11 : 0xec;

      const [ecLen, ...groups] = EC_BLOCKS[version];
      const dataBlocks = [], ecBlocks = [];
      let offset = 0;
      for (const [blocks, dc] of groups) for (let b = 0; b < blocks; b++) {
        const block = data.slice(offset, offset + dc); offset += dc;
        dataBlocks.push(block); ecBlocks.push(rsRemainder(block, ecLen));
      }
      const out = [];
      const maxData = Math.max(...dataBlocks.map(b => b.length));
      for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
      for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
      return new Uint8Array(out);
    }

    function bchFormat(mask) {
      const data = (EC_LEVEL_BITS << 3) | mask;
      let d = data << 10;
      while (Math.clz32(d) - Math.clz32(0x537) <= 0) d ^= 0x537 << (Math.clz32(0x537) - Math.clz32(d));
      return ((data << 10) | d) ^ 0x5412;
    }
    function bchVersion(version) {
      let d = version << 12;
      while (Math.clz32(d) - Math.clz32(0x1f25) <= 0) d ^= 0x1f25 << (Math.clz32(0x1f25) - Math.clz32(d));
      return (version << 12) | d;
    }

    const MASKS = [
      (i, j) => (i + j) % 2 === 0,
      (i) => i % 2 === 0,
      (i, j) => j % 3 === 0,
      (i, j) => (i + j) % 3 === 0,
      (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
      (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
      (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
      (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0,
    ];

    function buildBase(version) {
      const size = version * 4 + 17;
      const m = new Uint8Array(size * size), reserved = new Uint8Array(size * size);
      const set = (r, c, v) => { m[r * size + c] = v ? 1 : 0; reserved[r * size + c] = 1; };

      for (const [fr, fc] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
        for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
          const rr = fr + r, cc = fc + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                       (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          set(rr, cc, dark);
        }
      }
      for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
      const pos = ALIGN[version];
      for (let a = 0; a < pos.length; a++) for (let b = 0; b < pos.length; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) continue;
        const row = pos[a], col = pos[b];
        for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
          set(row + r, col + c, r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
        }
      }
      // Reserve format areas (filled per mask) and write version info.
      for (let i = 0; i < 9; i++) { reserved[8 * size + i] = 1; reserved[i * size + 8] = 1; }
      for (let i = 0; i < 8; i++) { reserved[8 * size + (size - 1 - i)] = 1; reserved[(size - 1 - i) * size + 8] = 1; }
      if (version >= 7) {
        const bits = bchVersion(version);
        for (let i = 0; i < 18; i++) {
          const row = Math.floor(i / 3), col = i % 3 + size - 11, dark = ((bits >> i) & 1) === 1;
          set(row, col, dark); set(col, row, dark);
        }
      }
      return { size, m, reserved };
    }

    function placeData(base, codewords, version) {
      const { size, m, reserved } = base;
      const totalBits = codewords.length * 8 + REMAINDER_BITS[version];
      let bitIndex = 0, inc = -1, row = size - 1;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
          for (let c = 0; c < 2; c++) {
            const idx = row * size + col - c;
            if (reserved[idx]) continue;
            let dark = 0;
            if (bitIndex < codewords.length * 8) dark = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
            m[idx] = dark; bitIndex++;
          }
          row += inc;
          if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
      }
      return totalBits;
    }

    function writeFormat(size, m, mask) {
      const bits = bchFormat(mask);
      for (let i = 0; i < 15; i++) {
        const dark = ((bits >> i) & 1) === 1 ? 1 : 0;
        if (i < 6) m[i * size + 8] = dark;
        else if (i < 8) m[(i + 1) * size + 8] = dark;
        else m[(size - 15 + i) * size + 8] = dark;
        if (i < 8) m[8 * size + (size - i - 1)] = dark;
        else if (i < 9) m[8 * size + (15 - i)] = dark;
        else m[8 * size + (14 - i)] = dark;
      }
      m[(size - 8) * size + 8] = 1;
    }

    function applyMask(size, m, reserved, mask) {
      const fn = MASKS[mask];
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        if (!reserved[idx] && fn(r, c)) m[idx] ^= 1;
      }
    }

    function penalty(size, m) {
      let score = 0;
      for (let r = 0; r < size; r++) {
        let runRow = 0, runCol = 0, lastRow = -1, lastCol = -1;
        for (let c = 0; c < size; c++) {
          const a = m[r * size + c], b = m[c * size + r];
          if (a === lastRow) runRow++; else { if (runRow >= 5) score += 3 + (runRow - 5); lastRow = a; runRow = 1; }
          if (b === lastCol) runCol++; else { if (runCol >= 5) score += 3 + (runCol - 5); lastCol = b; runCol = 1; }
        }
        if (runRow >= 5) score += 3 + (runRow - 5);
        if (runCol >= 5) score += 3 + (runCol - 5);
      }
      for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
        const s = m[r * size + c] + m[r * size + c + 1] + m[(r + 1) * size + c] + m[(r + 1) * size + c + 1];
        if (s === 4 || s === 0) score += 3;
      }
      for (let r = 0; r < size; r++) {
        let bitsRow = 0, bitsCol = 0;
        for (let c = 0; c < size; c++) {
          bitsRow = ((bitsRow << 1) & 0x7ff) | m[r * size + c];
          if (c >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) score += 40;
          bitsCol = ((bitsCol << 1) & 0x7ff) | m[c * size + r];
          if (c >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) score += 40;
        }
      }
      let dark = 0; for (let i = 0; i < m.length; i++) dark += m[i];
      score += Math.abs(Math.ceil((dark * 100 / m.length) / 5) - 10) * 10;
      return score;
    }

    // qrMatrix(text[, { version, mask }]) -> { size, version, mask, modules } (1 = dark).
    function qrMatrix(text, opts = {}) {
      const bytes = new TextEncoder().encode(String(text));
      let version = opts.version || 0;
      if (!version) {
        for (let v = 1; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
        if (!version) throw new Error('QR: text too long for version 10');
      }
      const codewords = encodeCodewords(bytes, version);
      const base = buildBase(version);
      placeData(base, codewords, version);
      const { size, m, reserved } = base;

      let mask = opts.mask;
      if (mask == null) {
        let best = Infinity;
        for (let p = 0; p < 8; p++) {
          applyMask(size, m, reserved, p); writeFormat(size, m, p);
          const s = penalty(size, m);
          if (s < best) { best = s; mask = p; }
          applyMask(size, m, reserved, p);
        }
      }
      applyMask(size, m, reserved, mask); writeFormat(size, m, mask);
      return { size, version, mask, modules: m };
    }

    const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

    async function deflate(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    function pngChunk(type, data) {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      return out;
    }

    // ---- Fingerprint emblem ----
    //
    // A scanner samples only the centre of each module on the grid, the finder eyes and the
    // light margin, so everything between module centres is free to style. Dark modules
    // become dots joined by a seeded maze of strokes, smoothly blended so the joints flow;
    // finder and alignment eyes are rounded squares; broken concentric rings sit outside a
    // KEEP-module margin. Ink never reaches within ~0.3 module of a light module's centre.
    const KEEP = 2;                  // light margin between code and rings, in modules
    const DOT = 0.4;                 // radius of a dark module with no stroke
    const STROKE_MIN = 0.3, STROKE_MAX = 0.38; // stroke radius range (seeded per stroke)
    const DIAG_MAX = 0.33;           // diagonals pass 0.71 from two light centres; keep them thin
    const BLEND = 0.2;               // smooth-union radius at corners and junctions
    const PITCH = 1.7, RING = 0.4;   // ring spacing and ring half-width

    // Deterministic 0..1 generator seeded from the text (FNV-1a into mulberry32), so a shirt's
    // emblem is the same every time it is rendered and differs from every other shirt's.
    function seededRandom(text) {
      let h = 0x811c9dc5;
      for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
      return () => {
        h = (h + 0x6d2b79f5) | 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function sdRoundBox(px, py, hw, rad) {
      const qx = Math.abs(px) - hw + rad, qy = Math.abs(py) - hw + rad;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
    }
    function sdSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    }
    function smin(a, b, k) {
      const h = Math.max(k - Math.abs(a - b), 0) / k;
      return Math.min(a, b) - h * h * k * 0.25;
    }

    // Eyes (finders, alignment patterns) as [centre col, centre row, half-size] in modules.
    function eyesFor(size, version) {
      const eyes = [[3.5, 3.5, 3.5], [size - 3.5, 3.5, 3.5], [3.5, size - 3.5, 3.5]];
      const pos = ALIGN[version];
      for (const r of pos) for (const c of pos) {
        if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue;
        eyes.push([c + 0.5, r + 0.5, 2.5]);
      }
      return eyes;
    }

    // The maze: dark modules outside the eyes are joined by strokes. Edges are shuffled and
    // kept when they join two separate groups (a spanning forest, which reads as wandering
    // lines), plus a few extra so some loops close like the whorls of a print. Diagonals only
    // cross corners whose other two modules are light. Straight runs of kept edges become
    // one segment, so the smooth blend rounds only corners and junctions; a module with no
    // stroke is drawn as a dot. Each segment is listed under every cell of its bounding box.
    const DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    function buildMaze(size, modules, eyes, rand) {
      const inEye = (c, r) => eyes.some(([ec, er, h]) => Math.abs(c + 0.5 - ec) < h && Math.abs(r + 0.5 - er) < h);
      const dark = (c, r) => c >= 0 && r >= 0 && c < size && r < size && modules[r * size + c] === 1 && !inEye(c, r);
      const cand = []; // [col, row, dir, sort key]
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (!dark(c, r)) continue;
        if (dark(c + 1, r)) cand.push([c, r, 0, rand()]);
        if (dark(c, r + 1)) cand.push([c, r, 1, rand()]);
        if (dark(c + 1, r + 1) && !dark(c + 1, r) && !dark(c, r + 1)) cand.push([c, r, 2, rand() + 0.35]);
        if (dark(c - 1, r + 1) && !dark(c - 1, r) && !dark(c, r + 1)) cand.push([c, r, 3, rand() + 0.35]);
      }
      cand.sort((p, q) => p[3] - q[3]);
      const parent = Int32Array.from({ length: size * size }, (_, i) => i);
      const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const kept = new Uint8Array(size * size * 4); // kept[node * 4 + dir]
      const joined = new Uint8Array(size * size);
      for (const [c, r, dir] of cand) {
        const c1 = c + DIRS[dir][0], r1 = r + 1 - (dir === 0 ? 1 : 0);
        const a = find(r * size + c), b = find(r1 * size + c1);
        if (a !== b) parent[a] = b; else if (rand() > 0.22) continue;
        kept[(r * size + c) * 4 + dir] = 1;
        joined[r * size + c] = joined[r1 * size + c1] = 1;
      }
      const cells = Array.from({ length: size * size }, () => []);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) for (let dir = 0; dir < 4; dir++) {
        const [dc, dr] = DIRS[dir];
        if (!kept[(r * size + c) * 4 + dir]) continue;
        const pc = c - dc, pr = r - dr; // only start at the first edge of a straight run
        if (pc >= 0 && pr >= 0 && pc < size && kept[(pr * size + pc) * 4 + dir]) continue;
        let ec = c, er = r;
        while (ec + dc >= 0 && ec + dc < size && er + dr < size && kept[(er * size + ec) * 4 + dir]) { ec += dc; er += dr; }
        const w = Math.min(STROKE_MIN + rand() * (STROKE_MAX - STROKE_MIN), dir >= 2 ? DIAG_MAX : Infinity);
        const seg = { ax: c + 0.5, ay: r + 0.5, bx: ec + 0.5, by: er + 0.5, w, seen: -1 };
        for (let y = Math.min(r, er); y <= Math.max(r, er); y++)
          for (let x = Math.min(c, ec); x <= Math.max(c, ec); x++) cells[y * size + x].push(seg);
      }
      const dots = new Uint8Array(size * size);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dots[r * size + c] = dark(c, r) && !joined[r * size + c] ? 1 : 0;
      return { dots, cells };
    }

    function emblemLayout(text) {
      const { size, version, modules } = qrMatrix(text);
      const rand = seededRandom(text);
      const half = size / 2, keep = half + KEEP;
      const eyes = eyesFor(size, version);
      const maze = buildMaze(size, modules, eyes, rand);
      // Outline wobble shared by every ring so they stay nested.
      const ph = [0, 1, 2].map(() => rand() * Math.PI * 2);
      const shape = th => 1 + 0.045 * Math.sin(2 * th + ph[0]) + 0.03 * Math.sin(3 * th + ph[1]) + 0.015 * Math.sin(5 * th + ph[2]);
      let minShape = Infinity, maxShape = 0;
      for (let i = 0; i < 360; i++) { const v = shape(i * Math.PI / 180); minShape = Math.min(minShape, v); maxShape = Math.max(maxShape, v); }
      // Inner rings start against the margin; trimming leaves partial arcs where the outline
      // bulges away from the code. The outer two rings run unbroken past the corners.
      const r0 = (keep + RING + 0.3) / maxShape;
      const count = Math.ceil(((keep + RING) * Math.SQRT2 / minShape - r0) / PITCH) + 2;
      const rings = [];
      for (let k = 0; k < count; k++) {
        const base = r0 + k * PITCH, wob = rand() * Math.PI * 2;
        const radius = th => base * shape(th) + 0.14 * Math.sin(4 * th + wob + k);
        const runs = []; // [start angle, end angle, half-width], rotated by off
        const off = rand() * Math.PI * 2;
        let a = 0;
        while (a < Math.PI * 2 - 1.2 / base) {
          const roll = rand();
          const len = roll < 0.15 ? 0 : roll < 0.55 ? 0.6 + rand() * 2 : 2.5 + rand() * rand() * 9;
          const a1 = Math.min(a + len / base, Math.PI * 2 - 0.9 / base);
          const w = RING * (0.8 + rand() * 0.35);
          // Trim the dash where it would enter the code's light margin.
          let run = null;
          const step = 0.2 / base;
          for (let t = a + off; t <= a1 + off + 1e-9; t += step) {
            const r = radius(t), x = r * Math.cos(t), y = r * Math.sin(t);
            if (Math.abs(x) >= keep + w || Math.abs(y) >= keep + w) { if (run) run[1] = t; else run = [t, t, w]; }
            else if (run) { runs.push(run); run = null; }
          }
          if (run) runs.push(run);
          a = a1 + (0.75 + rand() * 0.9) / base;
        }
        // Back into [0, 2pi), splitting the dash that crosses the seam, sorted by start.
        const TAU = Math.PI * 2, dashes = [];
        for (const [s0, s1, w] of runs) {
          const s = s0 % TAU, e = s + (s1 - s0);
          if (e <= TAU) dashes.push([s, e, w]); else dashes.push([s, TAU, w], [0, e - TAU, w]);
        }
        dashes.sort((p, q) => p[0] - q[0]);
        rings.push({ radius, dashes });
      }
      const last = rings[rings.length - 1], lastBase = r0 + (count - 1) * PITCH;
      const edge = th => last.radius(th) + RING * 1.2 + 1.2; // white backing ends here
      const extent = Math.ceil(lastBase * maxShape + 0.14 + RING * 1.2 + 1.4);
      return { size, half, eyes, maze, rings, shape, r0, edge, extent, stamp: 0 };
    }

    // Signed distance (module units, < 0 = ink) to the code.
    function codeDistance(L, x, y) {
      const { size, maze } = L;
      const u = x + L.half, v = y + L.half;
      let d = Infinity;
      // Eyes are unioned with the maze, not returned early: alignment eyes have no light
      // separator, so data strokes run right up to them.
      for (const [ec, er, h] of L.eyes) {
        const px = u - ec, py = v - er;
        if (Math.abs(px) < h + 0.5 && Math.abs(py) < h + 0.5) {
          const big = h === 3.5, outer = big ? 1.4 : 1.1, core = big ? 1.5 : 0.5;
          const ring = Math.max(sdRoundBox(px, py, h, outer), -sdRoundBox(px, py, h - 1, outer * 0.55));
          d = Math.min(ring, sdRoundBox(px, py, core, big ? 0.6 : 0.45));
        }
      }
      const ci = Math.floor(u), ri = Math.floor(v), stamp = ++L.stamp;
      for (let r = Math.max(0, ri - 1); r <= Math.min(size - 1, ri + 1); r++)
        for (let c = Math.max(0, ci - 1); c <= Math.min(size - 1, ci + 1); c++) {
          if (maze.dots[r * size + c]) d = Math.min(d, Math.hypot(u - c - 0.5, v - r - 0.5) - DOT);
          for (const e of maze.cells[r * size + c]) {
            if (e.seen === stamp) continue; // an edge spans up to four cells; count it once
            e.seen = stamp;
            d = smin(d, sdSegment(u, v, e.ax, e.ay, e.bx, e.by) - e.w, BLEND);
          }
        }
      return d;
    }

    // Signed distance to the nearest ring dash (rounded ends), or Infinity.
    function ringDistance(L, x, y) {
      const rho = Math.hypot(x, y);
      let th = Math.atan2(y, x); if (th < 0) th += Math.PI * 2;
      const kGuess = Math.round((rho / L.shape(th) - L.r0) / PITCH);
      let d = Infinity;
      for (let k = Math.max(0, kGuess - 1); k <= Math.min(L.rings.length - 1, kGuess + 1); k++) {
        const ring = L.rings[k], dashes = ring.dashes;
        const radial = rho - ring.radius(th);
        if (Math.abs(radial) - RING * 1.2 >= d) continue;
        let lo = 0, hi = dashes.length - 1; // last dash starting at or before th
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dashes[mid][0] <= th) lo = mid; else hi = mid - 1; }
        for (const i of [lo - 1, lo, lo + 1, 0, dashes.length - 1]) {
          const ds = dashes[i]; if (!ds) continue;
          let ang = 0;
          if (th < ds[0]) ang = Math.min(ds[0] - th, th + Math.PI * 2 - ds[1]);
          else if (th > ds[1]) ang = Math.min(th - ds[1], ds[0] + Math.PI * 2 - th);
          d = Math.min(d, Math.hypot(radial, ang * rho) - ds[2]);
        }
      }
      return d;
    }

    // qrPng(text, sizeIn) -> { png, pixels, sizeIn }: the fingerprint emblem as an 8-bit
    // grey+alpha PNG at 300 DPI, sizeIn wide overall (the code itself is about half of that).
    // Black ink on a white backing shaped like the outer ring, transparent outside it, edges
    // anti-aliased. sizeIn is recomputed from the pixel width so Printful prints the image at
    // exactly its size.
    async function qrPng(text, sizeIn) {
      const L = emblemLayout(text);
      const px = Math.max(64, Math.round(Number(sizeIn) * 300));
      const scale = px / (L.extent * 2); // pixels per module
      const codeReach = L.half + 0.5;
      const raw = new Uint8Array(px * (px * 2 + 1));
      for (let yPx = 0; yPx < px; yPx++) {
        const rowStart = yPx * (px * 2 + 1);
        const y = (yPx + 0.5) / scale - L.extent;
        for (let xPx = 0; xPx < px; xPx++) {
          const x = (xPx + 0.5) / scale - L.extent;
          let th = Math.atan2(y, x); if (th < 0) th += Math.PI * 2;
          const back = Math.min(1, Math.max(0, 0.5 - (Math.hypot(x, y) - L.edge(th)) * scale));
          let ink = 0;
          if (back > 0) {
            const d = Math.abs(x) < codeReach && Math.abs(y) < codeReach ? codeDistance(L, x, y) : ringDistance(L, x, y);
            ink = Math.min(1, Math.max(0, 0.5 - d * scale));
          }
          raw[rowStart + 1 + xPx * 2] = Math.round(255 * (1 - ink));
          raw[rowStart + 2 + xPx * 2] = Math.round(255 * Math.max(back, ink));
        }
      }
      const ihdr = new Uint8Array(13);
      const dv = new DataView(ihdr.buffer);
      dv.setUint32(0, px); dv.setUint32(4, px); ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
      const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', await deflate(raw)), pngChunk('IEND', new Uint8Array(0))];
      const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
      return { png, pixels: px, sizeIn: px / 300 };
    }

    return { qrMatrix, qrPng };
  })();

  // ES Module format: expose fetch and inject env bindings into globals per request
  export default {
    async fetch(request, env, ctx) {
      setEnvGlobals(env);
      try {
        return await handleRequest(request, ctx);
      } catch (e) {
        // Without this, any uncaught exception anywhere in the request chain becomes an
        // opaque Cloudflare "Worker threw exception" page. The stack goes to the Worker log
        // (not the client — it exposes code paths and SQL); the client gets a short ref that
        // matches the log line.
        const ref = randomId('err_').slice(0, 16);
        console.error('[fetch] Uncaught error', ref, e && e.stack ? e.stack : String(e));
        const headers = new Headers({ 'Content-Type': 'application/json' });
        try { headers.set('Access-Control-Allow-Origin', buildCorsHeaders(request).get('Access-Control-Allow-Origin') || ''); } catch {}
        return new Response(JSON.stringify({ error: 'Internal server error', ref }), { status: 500, headers });
      }
    }
  };

  function setEnvGlobals(env) {
    // Bindings
    globalThis.ASSETS_BUCKET = env.ASSETS_BUCKET;
    globalThis.DB = env.DB;
    // Vars / Secrets
    globalThis.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;
    globalThis.ASSETS_DOMAIN = env.ASSETS_DOMAIN;
    globalThis.WORKER_DELETE_KEY = env.WORKER_DELETE_KEY;
    globalThis.BOOTSTRAP_ADMIN_KEY = env.BOOTSTRAP_ADMIN_KEY;
    globalThis.CF_API_TOKEN = env.CF_API_TOKEN;
    globalThis.CF_ZONE_ID = env.CF_ZONE_ID;
    // Printful
    globalThis.PRINTFUL_API_KEY              = env.PRINTFUL_API_KEY;
    globalThis.PRINTFUL_STORE_ID             = env.PRINTFUL_STORE_ID;
    globalThis.PRINTFUL_WEBHOOK_SECRET       = env.PRINTFUL_WEBHOOK_SECRET;
    globalThis.PRINTFUL_CATALOG_PRODUCT_ID   = env.PRINTFUL_CATALOG_PRODUCT_ID;
    // Stripe
    globalThis.STRIPE_SECRET_KEY             = env.STRIPE_SECRET_KEY;
    globalThis.STRIPE_WEBHOOK_SECRET         = env.STRIPE_WEBHOOK_SECRET;
    // Email (Resend) — optional; without it forgot-password answers 501 and the page
    // tells the customer to write in instead.
    globalThis.RESEND_API_KEY                = env.RESEND_API_KEY;
    globalThis.MAIL_FROM                     = env.MAIL_FROM;
    // Public storefront origin printed into each shirt's QR (e.g. https://shop.inrl.co).
    globalThis.PUBLIC_SITE_URL               = env.PUBLIC_SITE_URL;
  }

  /** Build env object for Stripe module (reads per-request globals). */
  function stripeEnv() {
    return {
      STRIPE_SECRET_KEY: globalThis.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: globalThis.STRIPE_WEBHOOK_SECRET,
    };
  }

  /** Build env object for Printful module (reads per-request globals). */
  function printfulEnv() {
    return {
      PRINTFUL_API_KEY: globalThis.PRINTFUL_API_KEY,
      PRINTFUL_STORE_ID: globalThis.PRINTFUL_STORE_ID,
      PRINTFUL_WEBHOOK_SECRET: globalThis.PRINTFUL_WEBHOOK_SECRET,
      PRINTFUL_CATALOG_PRODUCT_ID: globalThis.PRINTFUL_CATALOG_PRODUCT_ID,
    };
  }

  // ---------- CORS / JSON helpers ----------

  // Simple in-memory rate limiter (per Worker isolate; resets on cold start)
  const _rateLimitMap = new Map();
  const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
  const RATE_LIMIT_MAX_AUTH = 10;   // max login/register attempts per IP per minute
  const RATE_LIMIT_MAX_UPLOAD = 20;  // max uploads per IP per minute
  const RATE_LIMIT_MAX_ORDER = 10;   // max order submissions per IP per minute
  const RATE_LIMIT_MAX_REVIEW = 10;  // max review submissions per IP per minute
  const RATE_LIMIT_MAX_ORDER_AR_UPLOAD = 10; // max personal AR video uploads per IP per minute

  function rateLimitCheck(key, maxAttempts) {
    const now = Date.now();
    let entry = _rateLimitMap.get(key);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
      entry = { start: now, count: 1 };
      _rateLimitMap.set(key, entry);
      // Garbage-collect old entries periodically
      if (_rateLimitMap.size > 5000) {
        for (const [k, v] of _rateLimitMap) { if (now - v.start > RATE_LIMIT_WINDOW_MS) _rateLimitMap.delete(k); }
      }
      return true;
    }
    entry.count++;
    if (entry.count > maxAttempts) return false;
    return true;
  }

  function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  }

  function getAllowedOrigins() {
    if (typeof ALLOWED_ORIGINS === 'string' && ALLOWED_ORIGINS.trim()) {
      return ALLOWED_ORIGINS.split(',').map(s => s.trim());
    }
    return null;
  }

  function buildCorsHeaders(req) {
    const h = new Headers();
    const allowed = getAllowedOrigins();
    const origin = req.headers.get('Origin');
    if (allowed && origin && allowed.includes(origin)) {
      h.set('Access-Control-Allow-Origin', origin);
      h.set('Access-Control-Allow-Credentials', 'true');
    }
    // If ALLOWED_ORIGINS is not configured or origin doesn't match, no ACAO header is set
    // which will cause the browser to block cross-origin requests (secure default)
    h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS, DELETE');
    h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key, x-bootstrap-key');
    h.set('Vary', 'Origin');
    return h;
  }

  function jsonResponse(body, status = 200, request = null) {
    const headers = request ? buildCorsHeaders(request) : new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Content-Security-Policy', "default-src 'none'");
    return new Response(JSON.stringify(body), { status, headers });
  }

  // Attach a Cache-Control directive to an existing Response.
  function withCache(response, directive) {
    response.headers.set('Cache-Control', directive);
    return response;
  }

  async function readJson(request) {
    try {
      const txt = await request.text();
      return txt ? JSON.parse(txt) : {};
    } catch {
      return {};
    }
  }

  // ---------- Crypto / D1 helpers ----------

  function randomId(prefix = '') {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    return prefix + hex;
  }

  // Short, human-typeable claim code (e.g. "K7QX-9MPZ") for a garment_units row — meant to
  // be printed on a tag sewn inside the collar, so it needs to survive being read off fabric
  // and typed on a phone: no 0/O or 1/I/L confusion.
  function randomClaimCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    let out = '';
    for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
    return out.slice(0, 4) + '-' + out.slice(4);
  }

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
      key,
      256
    );
    const hashArr = new Uint8Array(bits);
    const hashHex = Array.from(hashArr).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${salt}$${hashHex}`;
  }

  async function verifyPassword(password, stored) {
    if (!stored || !stored.includes('$')) return false;
    const [salt] = stored.split('$');
    const check = await hashPassword(password, salt);
    return timingSafeEqual(check, stored);
  }

  // Constant-time string comparison to prevent timing attacks
  function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    const enc = new TextEncoder();
    const bufA = enc.encode(a);
    const bufB = enc.encode(b);
    // Use subtle.timingSafeEqual if available (Node-like), otherwise manual XOR
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') {
      return crypto.subtle.timingSafeEqual(bufA, bufB);
    }
    let diff = 0;
    for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
    return diff === 0;
  }

  async function dbGet(sql, ...params) {
    const row = await DB.prepare(sql).bind(...params).first();
    return row || null;
  }
  async function dbAll(sql, ...params) {
    const res = await DB.prepare(sql).bind(...params).all();
    return res?.results || [];
  }
  // Returns { changes, lastRowId } from D1's run() meta: `changes` lets a conditional update
  // double as a claim/lock ("mark paid only if not already paid"), and `lastRowId` is this
  // statement's own insert id — unlike a follow-up `select ... last_insert_rowid()`, which is
  // a separate query and can see another request's insert in between.
  async function dbRun(sql, ...params) {
    const res = await DB.prepare(sql).bind(...params).run();
    const meta = (res && res.meta) || {};
    return { changes: Number(meta.changes) || 0, lastRowId: meta.last_row_id != null ? Number(meta.last_row_id) : null };
  }

  function safeJsonParse(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  // Brand ids the session's user belongs to. Only populated for role 'brand' (see
  // getSessionUser) — every caller checks role first, admins see everything.
  function sessionBrandIds(sess) {
    return ((sess && sess.user && sess.user.brands) || []).map(b => b.id);
  }
  function sessionOwnsBrand(sess, brandId) {
    return sessionBrandIds(sess).includes(brandId);
  }

  // Only plain web links are ever stored/shown as a tracking link — anything else (notably
  // javascript: URLs) is dropped, since tracking_url ends up in an <a href> on the shop.
  function safeHttpUrl(value) {
    const s = String(value || '').trim();
    return /^https?:\/\//i.test(s) ? s : null;
  }

  // ---------- Sessions ----------

  const SESSION_COOKIE_NAME = 'session';
  const SESSION_TTL_DAYS = 30;

  async function createSession(userId) {
    const token = randomId('sess_');
    await dbRun('insert into sessions (token, user_id) values (?, ?)', token, userId);
    return token;
  }

  function parseCookies(header) {
    const out = {};
    (header || '').split(';').map(c => c.trim()).filter(Boolean).forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx === -1) return;
      // A malformed %-escape in some unrelated cookie must not break every request.
      try {
        out[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
      } catch {}
    });
    return out;
  }

  // Sessions older than the cookie's lifetime are rejected server-side too — otherwise a
  // copied token would stay valid forever even though the browser drops it after 30 days.
  // created_at is stored in this same ISO format, so the string comparison is chronological.
  const SESSION_FRESH_SQL = `s.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${SESSION_TTL_DAYS} days')`;

  async function getSessionUser(request) {
    try {
      const cookies = parseCookies(request.headers.get('Cookie') || '');
      const token = cookies[SESSION_COOKIE_NAME];
      if (!token) return null;
      const row = await dbGet(
        `select s.token, u.id as user_id, u.email, u.role, u.suspended_until from sessions s join users u on u.id = s.user_id where s.token = ? and ${SESSION_FRESH_SQL}`,
        token
      );
      if (!row) return null;
      // A timed-out account's sessions are deleted the moment the timeout is applied
      // (apiAdminTimeoutUser) — this is a defensive second check for any session that
      // slipped through (clock skew, a request already in flight, etc).
      if (row.suspended_until && new Date(row.suspended_until).getTime() > Date.now()) {
        await dbRun('delete from sessions where token = ?', token).catch(() => {});
        return null;
      }
      // Only brand accounts are ever scoped by brand — skip the second round trip for
      // everyone else (every shopper/admin request goes through here).
      const brands = row.role === 'brand'
        ? await dbAll(
            'select b.id, b.name from brand_users bu join brands b on b.id = bu.brand_id where bu.user_id = ?',
            row.user_id
          )
        : [];
      return {
        token,
        user: { id: row.user_id, email: row.email, role: row.role, brands }
      };
    } catch (e) {
      const msg = String(e && e.message ? e.message : e || 'Session lookup failed');
      console.error('[auth] getSessionUser failed', msg);
      return { error: msg };
    }
  }

  function buildSessionCookie(token, request) {
    const url = new URL(request.url);
    const exp = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toUTCString();
    const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      `Expires=${exp}`,
      'HttpOnly',
      'SameSite=Lax'
    ];
    if (url.protocol === 'https:') parts.push('Secure');
    return parts.join('; ');
  }

  function clearSessionCookie() {
    return `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }

  // Robustly extract an R2 object key from a public URL or path.
  function keyFromPublicUrl(u) {
    try {
      const url = new URL(u);
      let p = url.pathname.replace(/^\/+/, '').split('?')[0].split('#')[0];
      // Strip /api/r2/ prefix — new upload URL format routes through Worker API path
      if (p.startsWith('api/r2/')) p = p.slice('api/r2/'.length);
      return p;
    } catch {
      let s = String(u || '');
      // Remove configured ASSETS_DOMAIN prefix if present in any form
      try {
        let base = (typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '').trim();
        if (base) {
          base = base.replace(/\/$/, '');
          const noProto = base.replace(/^https?:\/\//i, '');
          s = s.replace(new RegExp('^https?:\\/\\/' + noProto, 'i'), '');
          s = s.replace(new RegExp('^' + noProto, 'i'), '');
          s = s.replace(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/'), '');
        }
      } catch {}
      return s.replace(/^\/+/, '').split('?')[0].split('#')[0];
    }
  }

  function buildPublicAssetUrl(request, key) {
    const normalizedKey = String(key || '').trim().replace(/^\/+/, '');
    if (!normalizedKey) return '';

    const assetsDomain = String(typeof ASSETS_DOMAIN === 'string' ? ASSETS_DOMAIN : '').trim();
    let publicBase = '';
    if (assetsDomain) {
      publicBase = assetsDomain.replace(/\/$/, '');
      if (!/^https?:\/\//i.test(publicBase)) publicBase = 'https://' + publicBase;
      const assetKey = normalizedKey.startsWith('api/r2/') ? normalizedKey.slice('api/r2/'.length) : normalizedKey;
      return `${publicBase}/${assetKey}`;
    }

    const requestUrl = new URL(request.url);
    const proto = (request.headers.get('x-forwarded-proto') || requestUrl.protocol || 'https:').split(',')[0].trim();
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || requestUrl.host;
    publicBase = `${proto}//${host}`;
    const workerKey = normalizedKey.startsWith('api/r2/') ? normalizedKey : `api/r2/${normalizedKey}`;
    return `${publicBase}/${workerKey}`;
  }

  function normalizePublicUrl(value, request, fallbackOrigin = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/^http:\/\//i, 'https://');
    }

    const origin = (fallbackOrigin || new URL(request.url).origin).replace(/\/$/, '');
    if (trimmed.startsWith('/')) return `${origin}${trimmed}`;
    if (trimmed.startsWith('api/r2/')) return `${origin}/${trimmed}`;
    return `${origin}/${trimmed}`;
  }

  // ---------- Main router ----------

  async function handleRequest(request, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
    }

    // Existing R2 operations
    if (request.method === 'POST' && pathname === '/upload') return handleUpload(request);
    if (request.method === 'POST' && pathname === '/delete') return handleDelete(request);
    if (request.method === 'POST' && pathname === '/purge')  return handlePurge(request);

    // JSON API
    if (pathname.startsWith('/api/')) return handleApi(request, pathname, ctx);

    // Health
    if (request.method === 'GET' && (pathname === '' || pathname === '/')) {
      const headers = buildCorsHeaders(request);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, worker: true }), { status: 200, headers });
    }

    // Asset GET from R2
    if (request.method === 'GET') return handleGet(request);
    return new Response('Not Found', { status: 404 });
  }

  // ---------- /api/* router ----------

  // ctx (the Worker ExecutionContext) is threaded through explicitly rather than stored as a
  // global: globals are shared by every concurrent request in the isolate.
  async function handleApi(request, pathname, ctx) {
    // Webhooks — token/signature-validated internally, no session cookie required
    if (request.method === 'POST' && pathname === '/api/webhooks/printful') return apiPrintfulWebhook(request);
    if (request.method === 'POST' && pathname === '/api/admin/printful/webhook') return apiPrintfulWebhook(request);
    if (request.method === 'POST' && pathname === '/api/webhooks/stripe') return apiStripeWebhook(request);

    // Auth
    if (request.method === 'POST' && pathname === '/api/auth/bootstrap-admin') return apiBootstrapAdmin(request);
    if (request.method === 'POST' && pathname === '/api/auth/register')        return apiRegister(request);
    if (request.method === 'POST' && pathname === '/api/auth/login')           return apiLogin(request);
    if (request.method === 'POST' && pathname === '/api/auth/logout')          return apiLogout(request);
    if (request.method === 'GET'  && pathname === '/api/auth/me')              return apiMe(request);
    if (request.method === 'POST' && pathname === '/api/auth/change-password') return apiChangePassword(request);
    if (request.method === 'POST' && pathname === '/api/auth/forgot-password') return apiForgotPassword(request);
    if (request.method === 'POST' && pathname === '/api/auth/reset-password')  return apiResetPassword(request);

    // Orders (shop)
    if (request.method === 'POST' && pathname === '/api/checkout/session')     return apiCreateCheckoutSession(request);
    if (request.method === 'POST' && pathname === '/api/orders')               return apiCreateOrder(request);
    if (request.method === 'GET'  && /^\/api\/orders\/([^/]+)\/status$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const sessionId = new URL(request.url).searchParams.get('session_id');
      return apiGetOrderStatusPublic(request, id, sessionId);
    }
    if (request.method === 'GET'  && /^\/api\/orders\/([^/]+)\/track$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const email = new URL(request.url).searchParams.get('email');
      return apiGetOrderTrackPublic(request, id, email);
    }
    if (request.method === 'GET'  && pathname === '/api/orders/mine')          return apiListMyOrders(request);
    if (request.method === 'POST' && /^\/api\/orders\/([^/]+)\/resume-payment$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiResumeOrderPayment(request, id);
    }
    if (request.method === 'POST' && /^\/api\/orders\/([^/]+)\/cancel$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiCancelOrder(request, id);
    }
    if (request.method === 'GET'  && /^\/api\/orders\/[^/]+$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiGetOrder(request, id);
    }

    // Wardrobe (garment units — customer-claimed physical pieces, see sql/wardrobe_migration.sql)
    if (request.method === 'GET'   && pathname === '/api/pieces')                  return apiListMyPieces(request);
    if (request.method === 'POST'  && /^\/api\/pieces\/([^/]+)\/layer$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiUploadPieceLayer(request, id);
    }
    if (request.method === 'PATCH' && /^\/api\/pieces\/([^/]+)$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiUpdatePiece(request, id);
    }
    if (request.method === 'GET'   && /^\/api\/pieces\/([^/]+)$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      return apiGetPiece(request, id);
    }
    // Admin
    if (request.method === 'POST' && pathname === '/api/admin/brand-users')    return apiAdminCreateBrandUser(request);
    if (request.method === 'GET'  && pathname === '/api/admin/users')          return apiAdminListUsers(request);
    if (request.method === 'POST' && /^\/api\/admin\/users\/([^/]+)\/role$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[4]);
      return apiAdminChangeUserRole(request, id);
    }
    if (request.method === 'POST' && /^\/api\/admin\/users\/([^/]+)\/timeout$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[4]);
      return apiAdminTimeoutUser(request, id);
    }
    if (request.method === 'DELETE' && /^\/api\/admin\/users\/([^/]+)$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/')[4]);
      return apiAdminDeleteUser(request, id);
    }
    if (request.method === 'GET'  && pathname === '/api/admin/orders')         return apiAdminListOrders(request);
    if (request.method === 'GET'  && /^\/api\/admin\/orders\/[^/]+\/pieces$/.test(pathname)) {
      return apiAdminOrderPieces(request, decodeURIComponent(pathname.split('/')[4]));
    }
    if (request.method === 'POST' && /^\/api\/admin\/orders\/[^/]+\/resubmit$/.test(pathname)) {
      return apiAdminResubmitOrder(request, decodeURIComponent(pathname.split('/')[4]));
    }
    // Printful admin
    if (request.method === 'GET'  && pathname === '/api/admin/printful/webhooks')          return apiPrintfulWebhookHealth(request);
    if (request.method === 'GET'  && pathname === '/api/admin/printful/products')          return apiPrintfulListLinkedProducts(request);
    if (request.method === 'POST' && pathname === '/api/admin/printful/webhook/register')  return apiPrintfulWebhookRegister(request);
    if (request.method === 'POST' && /^\/api\/admin\/printful\/orders\/[^/]+\/sync$/.test(pathname)) {
      const printfulOrderId = decodeURIComponent(pathname.split('/')[5]);
      return apiPrintfulOrderSync(request, printfulOrderId);
    }
    // Printful catalog linking (v2 catalog-direct model — no "push"/"sync product" step)
    if (request.method === 'GET'  && pathname === '/api/admin/printful/catalog')           return apiPrintfulBrowseCatalog(request);
    if (request.method === 'GET'  && /^\/api\/admin\/printful\/catalog\/\d+$/.test(pathname)) {
      const catalogProductId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulGetCatalogProduct(request, catalogProductId);
    }
    if (request.method === 'GET'  && /^\/api\/admin\/printful\/catalog\/\d+\/placements$/.test(pathname)) {
      const catalogProductId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulGetCatalogPlacements(request, catalogProductId);
    }
    if (request.method === 'POST' && /^\/api\/admin\/printful\/products\/\d+\/link$/.test(pathname)) {
      const productId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulLinkProduct(request, productId);
    }
    if (request.method === 'POST' && /^\/api\/admin\/printful\/products\/\d+\/mockup$/.test(pathname)) {
      const productId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulCreateMockup(request, productId);
    }
    if (request.method === 'GET' && /^\/api\/admin\/printful\/mockup-tasks\/[^/]+$/.test(pathname)) {
      const taskId = decodeURIComponent(pathname.split('/')[5]);
      return apiPrintfulGetMockupTask(request, taskId);
    }
    // Printful Sync Products (v1 — products designed on printful.com itself, imported here)
    if (request.method === 'GET'  && pathname === '/api/admin/printful/sync-products')  return apiPrintfulListSyncProducts(request);
    if (request.method === 'GET'  && /^\/api\/admin\/printful\/sync-products\/\d+$/.test(pathname)) {
      const syncProductId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulGetSyncProduct(request, syncProductId);
    }
    if (request.method === 'POST' && /^\/api\/admin\/printful\/products\/\d+\/link-sync$/.test(pathname)) {
      const productId = parseInt(pathname.split('/')[5], 10);
      return apiPrintfulLinkSyncProduct(request, productId);
    }

    // Targets
    if (request.method === 'GET'  && pathname === '/api/targets')              return apiListTargets(request);
    if (request.method === 'POST' && pathname === '/api/targets')              return apiCreateTarget(request);
    if (request.method === 'POST' && pathname.endsWith('/activate')) {
      const id = parseInt(pathname.split('/')[3], 10); return apiActivateTarget(request, id);
    }
    if (request.method === 'POST' && pathname.endsWith('/deactivate')) {
      const id = parseInt(pathname.split('/')[3], 10); return apiDeactivateTarget(request, id);
    }
    if (request.method === 'DELETE' && /^\/api\/targets\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiDeleteTarget(request, id);
    }
    if (request.method === 'POST' && /^\/api\/targets\/\d+\/video$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiUploadTargetVideo(request, id);
    }

    // Brand design submissions
    if (request.method === 'GET'  && pathname === '/api/brand/designs')         return apiListBrandDesigns(request);
    if (request.method === 'POST' && pathname === '/api/brand/designs')         return apiCreateBrandDesign(request);
    if (request.method === 'DELETE' && /^\/api\/brand\/designs\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiDeleteBrandDesign(request, id);
    }

    // Viewer
    if (request.method === 'GET' && pathname === '/api/viewer/active')         return apiViewerActive(request);
    if (request.method === 'GET' && pathname === '/api/viewer/order')          return apiViewerOrder(request);
    if (request.method === 'GET' && pathname === '/api/viewer/piece')          return apiViewerPiece(request, ctx);

    // Products (shop catalog)
    if (request.method === 'GET'  && pathname === '/api/product-image')        return apiGetProductImage(request);
    if (request.method === 'GET'  && pathname === '/api/products')             return apiListProducts(request);
    if (request.method === 'GET' && /^\/api\/products\/[^/]+$/.test(pathname)) {
      const ref = decodeURIComponent(pathname.split('/')[3]);
      return apiGetProduct(request, ref);
    }
    if (request.method === 'POST' && pathname === '/api/products')             return apiCreateProduct(request);
    if (request.method === 'POST' && /^\/api\/products\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiUpdateProduct(request, id);
    }
    if (request.method === 'DELETE' && /^\/api\/products\/\d+$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiDeleteProduct(request, id);
    }
    if (request.method === 'POST' && /^\/api\/products\/(\d+)\/video$/.test(pathname)) {
      const id = parseInt(pathname.split('/')[3], 10); return apiUploadProductVideo(request, id);
    }

    // Reviews (shop)
    {
      const m = pathname.match(/^\/api\/products\/([^\/]+)\/reviews$/);
      if (m) {
        const ref = decodeURIComponent(m[1]);
        if (request.method === 'GET') return apiListReviews(request, ref);
        if (request.method === 'POST') return apiCreateReview(request, ref);
      }
    }
    if (request.method === 'GET'  && pathname === '/api/reviews')              return apiListReviews(request);
    if (request.method === 'POST' && pathname === '/api/reviews')              return apiCreateReview(request);

    // Product variants (Printful size/color)
    {
      const m = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
      if (m && request.method === 'GET') {
        const ref = decodeURIComponent(m[1]);
        return apiProductVariants(request, ref);
      }
    }

    // Shipping rates (Printful proxy)
    if (request.method === 'POST' && pathname === '/api/shipping/rates')       return apiShippingRates(request);

    // Footer email signup (shop)
    if (request.method === 'POST' && pathname === '/api/newsletter')           return apiNewsletterSignup(request);

    // Homepage content (shop)
    if (request.method === 'GET'  && pathname === '/api/homepage')             return apiGetHomepage(request);
    if (request.method === 'POST' && pathname === '/api/homepage')             return apiUpdateHomepage(request);

    // Site branding/theme (colors, logo, name) — admin-editable
    if (request.method === 'GET'  && pathname === '/api/theme')                return apiGetTheme(request);
    if (request.method === 'POST' && pathname === '/api/theme')                return apiUpdateTheme(request);

    // R2 asset proxy — /api/r2/<key> routes through Worker regardless of Cloudflare route config
    if (request.method === 'GET' && pathname.startsWith('/api/r2/')) {
      const key = pathname.slice('/api/r2/'.length).replace(/^\/+/, '');
      return handleR2Asset(request, key);
    }

    return jsonResponse({ error: 'Not Found' }, 404, request);
  }

  // ---------- Homepage content APIs (shop) ----------

  function clampStr(s, maxLen) {
    const v = String(s || '').trim();
    if (!v) return '';
    return v.length > maxLen ? v.slice(0, maxLen) : v;
  }

  // The storefront home's copy is locked brand copy in ecommerce/index.html — this content
  // only carries its media: the hero film, the full film and the three step images. Each
  // film has a landscape (desktop) and an optional portrait (phone) cut plus matching stills.
  const isVideoUrl = (u) => /\.(mp4|webm|mov)(\?|#|$)/i.test(String(u || ''));

  function normalizeHomeMedia(m) {
    const o = m && typeof m === 'object' ? m : {};
    return {
      video: clampStr(o.video, 800),
      videoPortrait: clampStr(o.videoPortrait, 800),
      poster: clampStr(o.poster, 800),
      posterPortrait: clampStr(o.posterPortrait, 800),
    };
  }

  function normalizeHomepagePayload(body) {
    const b = body && typeof body === 'object' ? body : {};

    // Rows saved by the old editor (billboard / slides / features) migrate on read: the first
    // slide's (or the billboard's) media becomes the hero, feature images become step images.
    let heroIn = b.hero;
    if (!heroIn || typeof heroIn !== 'object') {
      const s0 = Array.isArray(b.slides) && b.slides[0] ? b.slides[0] : null;
      const legacy = (s0 && s0.image) || (b.billboard && b.billboard.image) || '';
      heroIn = isVideoUrl(legacy) ? { video: legacy } : { poster: legacy };
    }
    const legacyFeatures = b.features && typeof b.features === 'object' ? (b.features.items || b.features.cards) : null;
    const stepsIn = Array.isArray(b.steps) ? b.steps : (Array.isArray(legacyFeatures) ? legacyFeatures : []);
    const steps = [0, 1, 2].map(i => ({ image: clampStr(stepsIn[i] && stepsIn[i].image, 800) }));

    return { hero: normalizeHomeMedia(heroIn), film: normalizeHomeMedia(b.film), steps };
  }

  function defaultHomepageContent() {
    return normalizeHomepagePayload({ hero: {}, film: {}, steps: [] });
  }

  // POST /api/newsletter — body {email}. The footer's "Stay in the loop." signup: stores the
  // address once (signing up again is a no-op success). Nothing is sent from here yet.
  async function apiNewsletterSignup(request) {
    if (!rateLimitCheck('newsletter:' + getClientIP(request), RATE_LIMIT_MAX_ORDER)) {
      return jsonResponse({ error: 'Too many attempts. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return jsonResponse({ error: 'Enter a valid email address.' }, 400, request);
    try {
      await dbRun('insert into newsletter_signups (email, source) values (?, ?) on conflict(email) do nothing', email, 'footer');
    } catch (e) {
      console.error('[newsletter] signup failed:', String(e && e.message ? e.message : e));
      return jsonResponse({ error: 'Signup failed' }, 500, request);
    }
    return jsonResponse({ ok: true }, 200, request);
  }

  async function apiGetHomepage(request) {
    const row = await dbGet('select json, updated_at, updated_by from site_content where key = ?', 'homepage');
    // Always normalize on read so old data (cards/string-stats) is transparently migrated for the frontend
    const parsed = row ? safeJsonParse(String(row.json || '')) : null;
    const content = parsed && typeof parsed === 'object' ? normalizeHomepagePayload(parsed) : defaultHomepageContent();
    return withCache(
      jsonResponse({ ok: true, content, updated_at: (row && row.updated_at) || null, updated_by: (row && row.updated_by) || null }, 200, request),
      'public, max-age=60, s-maxage=300'
    );
  }

  // Upserts one site_content key (homepage, theme).
  function saveSiteContent(key, json, updatedAt, updatedBy) {
    return dbRun(
      `insert into site_content (key, json, updated_at, updated_by)
       values (?, ?, ?, ?)
       on conflict(key) do update set json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      key, json, updatedAt, updatedBy
    );
  }

  // Every uploaded media URL a (normalized) homepage content object references
  function homepageImageUrls(content) {
    const urls = new Set();
    const add = (u) => { if (u) urls.add(u); };
    for (const m of [content && content.hero, content && content.film]) {
      if (m) { add(m.video); add(m.videoPortrait); add(m.poster); add(m.posterPortrait); }
    }
    for (const st of (content && Array.isArray(content.steps) ? content.steps : [])) add(st && st.image);
    return urls;
  }

  // Return true only for absolute URLs that were uploaded to R2 via /upload
  // (i.e. /api/r2/banners/... or ASSETS_DOMAIN/banners/...) — never delete static relative paths
  function isR2BannerUrl(url) {
    if (!url || !url.startsWith('http')) return false;
    const key = keyFromPublicUrl(url);
    return key.startsWith('banners/');
  }

  async function apiUpdateHomepage(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (sess.user.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403, request);

    const body = await readJson(request);
    const normalized = normalizeHomepagePayload(body);

    // Collect old R2 banner image URLs before overwriting
    let oldImageUrls = new Set();
    try {
      const oldRow = await dbGet('select json from site_content where key = ?', 'homepage');
      if (oldRow && oldRow.json) oldImageUrls = homepageImageUrls(normalizeHomepagePayload(JSON.parse(oldRow.json)));
    } catch { /* ignore — if unreadable just save */ }

    const newImageUrls = homepageImageUrls(normalized);

    const now = new Date().toISOString();
    const payload = JSON.stringify(normalized);

    await saveSiteContent('homepage', payload, now, sess.user.email || sess.user.id);

    // Delete R2 objects for banner images no longer referenced — fire-and-forget, never fail the save
    if (ASSETS_BUCKET && typeof ASSETS_BUCKET.delete === 'function') {
      for (const url of oldImageUrls) {
        if (newImageUrls.has(url)) continue; // still in use
        if (!isR2BannerUrl(url)) continue;   // not an R2 upload (e.g. static relative path)
        try {
          await ASSETS_BUCKET.delete(keyFromPublicUrl(url));
        } catch { /* silent */ }
      }
    }

    return jsonResponse({ ok: true, content: normalized, updated_at: now, updated_by: sess.user.email || sess.user.id }, 200, request);
  }

  // Site-wide branding (colors/logo/name), admin-editable from the dashboard's Branding
  // tab. Same site_content key/JSON storage as the homepage content above — no schema
  // migration needed, just a new key.
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

  function clampHexColor(s) {
    const v = String(s || '').trim();
    return HEX_COLOR_RE.test(v) ? v : '';
  }

  function normalizeThemePayload(body) {
    const colorsIn = body && typeof body.colors === 'object' && body.colors ? body.colors : {};
    const colors = {
      primary: clampHexColor(colorsIn.primary),
      accent: clampHexColor(colorsIn.accent),
      dark: clampHexColor(colorsIn.dark),
      light: clampHexColor(colorsIn.light),
    };
    return {
      colors,
      logoUrl: clampStr(body && body.logoUrl, 800),
      siteName: clampStr(body && body.siteName, 60),
      tagline: clampStr(body && body.tagline, 200),
    };
  }

  function defaultThemeContent() {
    return normalizeThemePayload({
      colors: { primary: '#12a2b8', accent: '#4fc3d5', dark: '#0b0f10', light: '#ffffff' },
      logoUrl: 'images/logo.svg',
      siteName: 'InRL',
      tagline: 'Culture moves. What we wear should too.',
    });
  }

  async function apiGetTheme(request) {
    const row = await dbGet('select json, updated_at from site_content where key = ?', 'theme');
    const parsed = row ? safeJsonParse(String(row.json || '')) : null;
    const theme = parsed && typeof parsed === 'object' ? normalizeThemePayload(parsed) : defaultThemeContent();
    return withCache(
      jsonResponse({ ok: true, theme, updated_at: (row && row.updated_at) || null }, 200, request),
      'public, max-age=60, s-maxage=300'
    );
  }

  async function apiUpdateTheme(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (sess.user.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403, request);

    const body = await readJson(request);
    const normalized = normalizeThemePayload(body);
    const now = new Date().toISOString();

    await saveSiteContent('theme', JSON.stringify(normalized), now, sess.user.email || sess.user.id);

    return jsonResponse({ ok: true, theme: normalized, updated_at: now }, 200, request);
  }

  function parseImageDataUrl(dataUrl) {
    const s = String(dataUrl || '');
    if (!s.startsWith('data:')) return null;
    const commaIdx = s.indexOf(',');
    if (commaIdx < 0) return null;
    const meta = s.slice(5, commaIdx); // "image/png;base64"
    const payload = s.slice(commaIdx + 1);
    const [mimeRaw, ...params] = meta.split(';');
    const mime = (mimeRaw || '').trim().toLowerCase();
    const isBase64 = params.map(p => p.trim().toLowerCase()).includes('base64');
    if (!mime.startsWith('image/')) return null;
    if (!isBase64) return null;
    return { mime, base64: payload };
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function parseImageUrlsField(value) {
    if (value == null) return null;
    const v = value;
    let arr = null;
    if (Array.isArray(v)) arr = v;
    else if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return [];
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j)) arr = j;
        else return null;
      } catch {
        // Treat a single URL string as a one-item list
        arr = [s];
      }
    } else {
      return null;
    }

    const cleaned = arr
      .map(x => String(x || '').trim())
      .filter(Boolean);

    if (cleaned.length > 5) return null;
    for (const u of cleaned) {
      if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return null;
    }
    return cleaned;
  }

  function firstImageUrl(imageUrl, imageUrlsJson) {
    const direct = String(imageUrl || '').trim();
    if (direct) return direct;
    if (!imageUrlsJson) return '';
    try {
      const arr = typeof imageUrlsJson === 'string' ? JSON.parse(imageUrlsJson) : imageUrlsJson;
      if (Array.isArray(arr) && arr.length) return String(arr[0] || '').trim();
    } catch {}
    return '';
  }

  function parseImageUrlsFromRow(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      const cleaned = value.map(x => String(x || '').trim()).filter(Boolean);
      return cleaned.length ? cleaned.slice(0, 5) : null;
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;
      try {
        const j = JSON.parse(s);
        if (!Array.isArray(j)) return null;
        const cleaned = j.map(x => String(x || '').trim()).filter(Boolean);
        return cleaned.length ? cleaned.slice(0, 5) : null;
      } catch {
        return [s].slice(0, 5);
      }
    }
    return null;
  }

  // ---------- Role / input helpers ----------

  function normalizeSlug(input) {
    const s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    return s
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
  }

  function parsePriceCents(body) {
    if (body && body.price_cents != null && body.price_cents !== '') {
      const n = Number(body.price_cents);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.round(n));
    }
    if (body && body.price != null && body.price !== '') {
      const n = Number(String(body.price).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.round(n * 100));
    }
    return 0;
  }

  function isPrivilegedRole(role) {
    return role === 'admin' || role === 'brand';
  }

  function isAdminRole(role) {
    return role === 'admin';
  }

  async function requirePrivilegedSession(request) {
    const sessData = await getSessionUser(request);
    if (sessData && sessData.error) {
      return { error: jsonResponse({ error: 'Session lookup failed' }, 500, request) };
    }
    const sess = sessData;
    if (!sess) return { error: jsonResponse({ error: 'Unauthorized' }, 401, request) };
    if (!isPrivilegedRole(sess.user.role)) return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
    return { sess };
  }

  async function requireAdminSession(request) {
    const sessData = await getSessionUser(request);
    if (sessData && sessData.error) {
      return { error: jsonResponse({ error: 'Session lookup failed' }, 500, request) };
    }
    const sess = sessData;
    if (!sess) return { error: jsonResponse({ error: 'Unauthorized' }, 401, request) };
    if (!isAdminRole(sess.user.role)) return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
    return { sess };
  }

  function isValidEmail(email) {
    const s = String(email || '').trim().toLowerCase();
    if (!s) return false;
    if (s.length > 254) return false;
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  }

  async function ensureBrandIdByName(brandName) {
    const name = (brandName || '').trim();
    if (!name) return null;
    let b = await dbGet('select id from brands where name = ?', name);
    if (!b) {
      await dbRun('insert into brands (name) values (?)', name);
      b = await dbGet('select id from brands where name = ?', name);
    }
    return b ? b.id : null;
  }

  // ---------- Auth APIs ----------

  async function apiBootstrapAdmin(request) {
    const body = await readJson(request);
    const provided = request.headers.get('x-bootstrap-key') || '';
    if (!BOOTSTRAP_ADMIN_KEY || !timingSafeEqual(provided, BOOTSTRAP_ADMIN_KEY)) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!email || !password) return jsonResponse({ error: 'email and password required' }, 400, request);
    if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
    if (String(password).length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

    const existing = await dbGet('select id from users where email = ?', email);
    if (existing) return jsonResponse({ error: 'admin already exists for this email' }, 400, request);

    const salt = randomId('salt_');
    const hash = await hashPassword(password, salt);
    const userId = randomId('usr_');
    await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'admin');
    const token = await createSession(userId);
    const res = jsonResponse({ ok: true, user: { id: userId, email, role: 'admin' } }, 200, request);
    res.headers.append('Set-Cookie', buildSessionCookie(token, request));
    return res;
  }

  async function apiRegister(request) {
    const ip = getClientIP(request);
    if (!rateLimitCheck('register:' + ip, RATE_LIMIT_MAX_AUTH)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
    if (!password || String(password).length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

    const existing = await dbGet('select id from users where email = ?', email);
    if (existing) return jsonResponse({ error: 'Email already registered' }, 409, request);

    const salt = randomId('salt_');
    const hash = await hashPassword(password, salt);
    const userId = randomId('usr_');
    await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'client');

    const token = await createSession(userId);
    const res = jsonResponse({ ok: true, user: { id: userId, email, role: 'client' } }, 201, request);
    res.headers.append('Set-Cookie', buildSessionCookie(token, request));
    return res;
  }

  async function apiLogin(request) {
    const ip = getClientIP(request);
    if (!rateLimitCheck('login:' + ip, RATE_LIMIT_MAX_AUTH)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!email || !password) return jsonResponse({ error: 'email and password required' }, 400, request);

    const user = await dbGet('select id, email, password_hash, role, suspended_until from users where email = ?', email);
    if (!user) return jsonResponse({ error: 'Invalid credentials' }, 401, request);

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return jsonResponse({ error: 'Invalid credentials' }, 401, request);

    if (user.suspended_until && new Date(user.suspended_until).getTime() > Date.now()) {
      return jsonResponse({ error: `This account is temporarily suspended until ${user.suspended_until}.` }, 403, request);
    }

    const token = await createSession(user.id);
    const brands = await dbAll(
      'select b.id, b.name from brand_users bu join brands b on b.id = bu.brand_id where bu.user_id = ?',
      user.id
    );
    const res = jsonResponse({ ok: true, user: { id: user.id, email: user.email, role: user.role, brands } }, 200, request);
    res.headers.append('Set-Cookie', buildSessionCookie(token, request));
    return res;
  }

  async function apiLogout(request) {
    const sess = await getSessionUser(request);
    if (sess?.token) await dbRun('delete from sessions where token = ?', sess.token);
    const res = jsonResponse({ ok: true }, 200, request);
    res.headers.append('Set-Cookie', clearSessionCookie());
    return res;
  }

  async function apiMe(request) {
    const sess = await getSessionUser(request);
    return jsonResponse({ user: sess ? sess.user : null }, 200, request);
  }

  async function apiChangePassword(request) {
    const sess = await getSessionUser(request);
    if (!sess?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const body = await readJson(request);
    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';

    if (!currentPassword || !newPassword) {
      return jsonResponse({ error: 'currentPassword and newPassword required' }, 400, request);
    }
    if (String(newPassword).length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);
    }

    const user = await dbGet('select id, password_hash from users where id = ?', sess.user.id);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return jsonResponse({ error: 'Invalid current password' }, 401, request);

    const salt = randomId('salt_');
    const hash = await hashPassword(newPassword, salt);
    await dbRun('update users set password_hash = ? where id = ?', hash, user.id);

    // Rotate sessions for this user.
    await dbRun('delete from sessions where user_id = ?', user.id);
    const token = await createSession(user.id);

    const res = jsonResponse({ ok: true }, 200, request);
    res.headers.append('Set-Cookie', buildSessionCookie(token, request));
    return res;
  }

  // ---------- Email (Resend) ----------

  function mailConfigured() {
    return !!(String(globalThis.RESEND_API_KEY || '').trim() && String(globalThis.MAIL_FROM || '').trim());
  }

  async function sendMail({ to, subject, text }) {
    const payload = { from: String(globalThis.MAIL_FROM).trim(), to: [to], subject, text };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(globalThis.RESEND_API_KEY).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  async function sha256Hex(value) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const PASSWORD_RESET_TTL_MINUTES = 60;

  // POST /api/auth/forgot-password — body {email}. Answers the same whether or not the
  // account exists. The link is built from this request's own origin, never from the body,
  // so the email can't be made to point anywhere else. Only a SHA-256 of the token is stored.
  async function apiForgotPassword(request) {
    if (!mailConfigured()) return jsonResponse({ error: 'Email is not configured' }, 501, request);
    if (!rateLimitCheck('forgot:' + getClientIP(request), RATE_LIMIT_MAX_AUTH)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);

    const user = await dbGet('select id from users where email = ?', email);
    if (user) {
      const token = randomId('rst_') + randomId();
      await dbRun('delete from password_resets where user_id = ?', user.id);
      await dbRun(
        `insert into password_resets (token_hash, user_id, expires_at)
         values (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+${PASSWORD_RESET_TTL_MINUTES} minutes'))`,
        await sha256Hex(token), user.id
      );
      const link = `${new URL(request.url).origin}/ecommerce/reset-password.html?token=${encodeURIComponent(token)}`;
      try {
        await sendMail({
          to: email,
          subject: 'Reset your InRL password',
          text: `Someone asked to reset the password for this account.\n\nPick a new one here (the link works once, for ${PASSWORD_RESET_TTL_MINUTES} minutes):\n${link}\n\nIf it wasn't you, ignore this email. Nothing changes.`,
        });
      } catch (e) {
        console.error('[forgot-password] send failed', String(e));
        return jsonResponse({ error: 'Could not send the email' }, 502, request);
      }
    }
    return jsonResponse({ ok: true }, 200, request);
  }

  // POST /api/auth/reset-password — body {token, password}. One-time: the token is deleted
  // on use, every existing session is signed out, and the caller is signed in.
  async function apiResetPassword(request) {
    if (!rateLimitCheck('reset:' + getClientIP(request), RATE_LIMIT_MAX_AUTH)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token) return jsonResponse({ error: 'token required' }, 400, request);
    if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

    const tokenHash = await sha256Hex(token);
    const row = await dbGet(
      `select user_id, expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') as fresh from password_resets where token_hash = ?`,
      tokenHash
    );
    if (!row) return jsonResponse({ error: 'This link is not valid' }, 404, request);
    await dbRun('delete from password_resets where token_hash = ?', tokenHash);
    if (!row.fresh) return jsonResponse({ error: 'This link has expired' }, 410, request);

    const salt = randomId('salt_');
    await dbRun('update users set password_hash = ? where id = ?', await hashPassword(password, salt), row.user_id);
    await dbRun('delete from sessions where user_id = ?', row.user_id);
    const sessionToken = await createSession(row.user_id);
    const res = jsonResponse({ ok: true }, 200, request);
    res.headers.append('Set-Cookie', buildSessionCookie(sessionToken, request));
    return res;
  }

  // ---------- Orders APIs ----------

  // ISO country-code map for values the checkout form sends as display names.
  const COUNTRY_CODE_MAP = {
    'united states': 'US', 'us': 'US',
    'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB',
    'canada': 'CA', 'ca': 'CA',
    'australia': 'AU', 'au': 'AU',
    'germany': 'DE', 'de': 'DE',
    'france': 'FR', 'fr': 'FR',
    'netherlands': 'NL', 'nl': 'NL',
    'spain': 'ES', 'es': 'ES',
    'italy': 'IT', 'it': 'IT',
    'brazil': 'BR', 'br': 'BR',
    'mexico': 'MX', 'mx': 'MX',
    'japan': 'JP', 'jp': 'JP',
    'new zealand': 'NZ', 'nz': 'NZ',
  };

  function toCountryCode(raw) {
    const s = String(raw || '').trim();
    if (/^[A-Z]{2}$/.test(s)) return s;
    return COUNTRY_CODE_MAP[s.toLowerCase()] || s.toUpperCase().slice(0, 2);
  }

  // ---------- Printful API helpers ----------

  async function callPrintful(method, path, body) {
    return Printful.callPrintful(printfulEnv(), method, path, body);
  }

  async function callPrintfulV1(method, path, body) {
    return Printful.callPrintfulV1(printfulEnv(), method, path, body);
  }

  // Re-resolves one cart line {slug, size, qty} against D1 — the only trusted source for
  // price, design file, and Printful catalog variant. Never trust client-supplied price/
  // image/variant values; the client only ever gets to say *which* product+size+qty.
  async function resolveOrderItemFromD1(raw, request) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const slug = String(o.slug || '').trim();
    const size = String(o.size || '').trim();
    const qty = Math.max(1, Math.min(99, parseInt(o.qty, 10) || 0));
    if (!slug) throw new Error('Cart item is missing a product slug');
    if (!qty) throw new Error(`Invalid quantity for ${slug}`);

    const row = await dbGet(
      `select id, slug, title, price_cents, currency, image_url, is_published, ar_target_id, printful_qr,
              printful_variant_map, printful_sync_variant_id, printful_design_images
       from products where slug = ?`,
      slug
    );
    if (!row || !row.is_published) throw new Error(`Product not available: ${slug}`);

    let variantMap = null;
    if (row.printful_variant_map) {
      try { variantMap = JSON.parse(row.printful_variant_map); } catch {}
    }
    const mapped = size && variantMap && variantMap[size] != null ? Number(variantMap[size]) : NaN;
    const fallback = row.printful_sync_variant_id != null ? Number(row.printful_sync_variant_id) : NaN;
    const catalogVariantId = Number.isFinite(mapped) && mapped > 0 ? mapped
      : (Number.isFinite(fallback) && fallback > 0 ? fallback : null);

    const imageUrl = row.image_url ? normalizePublicUrl(String(row.image_url), request) : '';

    // Per-placement print files from the product designer (Create Product > Images step),
    // e.g. {"front":"https://.../front.png","back":"https://.../back.png"} — preferred over
    // the plain storefront photo below whenever present, since it's what actually reflects
    // what the admin designed per placement rather than just the shop-listing image.
    let designImages = null;
    if (row.printful_design_images) {
      try { designImages = JSON.parse(row.printful_design_images); } catch {}
    }
    let normalizedDesignImages = null;
    if (designImages && typeof designImages === 'object') {
      const entries = Object.entries(designImages)
        .filter(([, v]) => !!v)
        .map(([placement, v]) => [placement, normalizePublicUrl(String(v), request)]);
      if (entries.length) normalizedDesignImages = Object.fromEntries(entries);
    }

    return {
      slug: row.slug,
      size: size || null,
      name: row.title + (size ? ` (${size})` : ''),
      qty,
      price_cents: Math.max(0, Number(row.price_cents) || 0),
      currency: row.currency || 'USD',
      image_url: imageUrl || null,
      design_images: normalizedDesignImages,
      catalog_variant_id: catalogVariantId,
      product_id: row.id,
      has_ar: row.ar_target_id != null,
      qr: parsePrintfulQr(row.printful_qr),
    };
  }

  function printfulRecipient(customer, countryCode) {
    return {
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
      address1: customer.address,
      city: customer.city || '',
      state_code: customer.state,
      country_code: countryCode,
      zip: customer.zip,
      email: customer.email,
    };
  }

  // products.printful_qr — where each shirt's QR goes, in inches inside the placement's
  // print area: {placement, size_in, top_in, left_in, area_width_in, area_height_in}.
  function parsePrintfulQr(raw) {
    let q = raw;
    if (typeof q === 'string') { try { q = JSON.parse(q); } catch { return null; } }
    if (!q || typeof q !== 'object') return null;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const out = {
      placement: String(q.placement || '').trim().toLowerCase(),
      size_in: num(q.size_in), top_in: num(q.top_in), left_in: num(q.left_in),
      area_width_in: num(q.area_width_in), area_height_in: num(q.area_height_in),
    };
    if (!/^[a-z0-9_]{1,40}$/.test(out.placement)) return null;
    if (!(out.size_in >= 1 && out.size_in <= 6)) return null;
    if (!(out.top_in >= 0) || !(out.left_in >= 0)) return null;
    if (!(out.area_width_in > 0) || !(out.area_height_in > 0)) return null;
    if (out.left_in + out.size_in > out.area_width_in + 0.01 || out.top_in + out.size_in > out.area_height_in + 0.01) return null;
    return out;
  }

  // Art per placement for a resolved item: the product designer's per-placement files,
  // else the storefront photo on the front.
  function itemArt(it) {
    if (it.design_images && Object.keys(it.design_images).length) return { ...it.design_images };
    return it.image_url ? { front: it.image_url } : {};
  }

  // Placements for one Printful item. With a QR, its layer is added to the QR placement
  // (or that placement is created holding only the QR when it has no art).
  function printfulPlacements(art, qrLayer) {
    const placements = Object.entries(art).map(([placement, url]) => ({
      placement, technique: 'dtg', layers: [{ type: 'file', url }],
    }));
    if (qrLayer) {
      const target = placements.find(pl => pl.placement === qrLayer.placement);
      if (target) target.layers.push(qrLayer.layer);
      else placements.push({ placement: qrLayer.placement, technique: 'dtg', layers: [qrLayer.layer] });
    }
    return placements;
  }

  function qrPrintLayer(qr, qrUrl, sizeIn) {
    return {
      placement: qr.placement,
      layer: {
        type: 'file', url: qrUrl,
        position: {
          area_width: qr.area_width_in, area_height: qr.area_height_in,
          width: sizeIn, height: sizeIn, top: qr.top_in, left: qr.left_in,
        },
      },
    };
  }

  // Builds the v2 catalog order for a paid order. AR lines become one item per shirt
  // (quantity 1, external_id = unit id) so each carries its own QR; other lines stay one
  // item with their quantity. `units` are the order's garment_units rows (with qr_url and
  // qr_size_in already set for AR shirts). Throws if any AR shirt is missing its QR.
  function buildPrintfulOrderItems(orderId, resolvedItems, units) {
    const items = [];
    resolvedItems.forEach((it, idx) => {
      const art = itemArt(it);
      if (!it.catalog_variant_id || !Object.keys(art).length) {
        throw new Error(`Line ${idx + 1} (${it.slug}) has no Printful variant or art`);
      }
      if (it.has_ar) {
        if (!it.qr) throw new Error(`Line ${idx + 1} (${it.slug}) has an AR target but no QR settings`);
        const lineUnits = units.filter(u => u.item_index === idx).sort((a, b) => a.unit_index - b.unit_index);
        if (lineUnits.length !== Number(it.qty)) throw new Error(`Line ${idx + 1} (${it.slug}) has ${lineUnits.length} of ${it.qty} shirts minted`);
        for (const u of lineUnits) {
          if (!u.qr_url || !u.qr_size_in) throw new Error(`Shirt ${u.claim_code} has no QR image`);
          items.push({
            source: 'catalog', external_id: u.id, catalog_variant_id: Number(it.catalog_variant_id), quantity: 1,
            placements: printfulPlacements(art, qrPrintLayer(it.qr, u.qr_url, u.qr_size_in)),
          });
        }
      } else {
        items.push({
          source: 'catalog', external_id: `${orderId}-${idx}`, catalog_variant_id: Number(it.catalog_variant_id),
          quantity: Number(it.qty), placements: printfulPlacements(art, null),
        });
      }
    });
    return items;
  }

  // Creates the Printful order, then confirms it — a draft is never produced or billed.
  async function submitPrintfulOrder(orderId, items, customer) {
    const key = typeof PRINTFUL_API_KEY === 'string' ? PRINTFUL_API_KEY.trim() : '';
    if (!key) throw new Error('PRINTFUL_API_KEY is not configured — order was not sent to Printful');

    const payload = { external_id: orderId, recipient: printfulRecipient(customer, toCountryCode(customer.country)), items };
    // v2 wraps the payload under "data"; keep a "result" fallback for API drift/older shapes.
    const pfBody = (resp) => (resp && (resp.data ?? resp.result)) || null;

    const created = await callPrintful('POST', '/orders', payload);
    const createdBody = pfBody(created);
    const draftId = createdBody && createdBody.id;
    if (!draftId) return { result: createdBody, confirmed: false };

    try {
      const confirmed = await callPrintful('POST', `/orders/${draftId}/confirm`, {});
      return { result: pfBody(confirmed) || createdBody, confirmed: true };
    } catch (confirmErr) {
      console.error('[printful] Order', orderId, '— draft', draftId, 'created but confirm failed:', String(confirmErr));
      return { result: createdBody, confirmed: false };
    }
  }

  // Quotes what Printful will bill the store for shipping these resolved items to this
  // customer, so checkout can charge it instead of the store silently absorbing it. Uses
  // Printful's STANDARD method because that is what submitPrintfulOrder gets (it sends no
  // shipping method, so Printful defaults to STANDARD). v1 /shipping/rates takes catalog
  // variant ids; Sync Product items only carry a sync_variant_id, so those are mapped to
  // their catalog variant via /store/variants/{id} first. Returns integer cents. Throws if
  // no usable rate comes back — checkout refuses rather than charging without shipping.
  async function quoteShippingCents(resolvedItems, customer, currency) {
    const items = [];
    for (const it of resolvedItems) {
      const variantId = it.catalog_variant_id ? Number(it.catalog_variant_id) : null;
      if (!variantId) throw new Error(`Could not resolve a Printful variant for ${it.slug}`);
      items.push({ variant_id: variantId, quantity: it.qty });
    }

    const data = await callPrintfulV1('POST', '/shipping/rates', {
      recipient: {
        address1: customer.address,
        city: customer.city || '',
        country_code: toCountryCode(customer.country),
        state_code: customer.state,
        zip: customer.zip,
      },
      items,
      currency,
    });
    const rates = Array.isArray(data && data.result) ? data.result : [];
    const rate = rates.find(r => String(r.id || '').toUpperCase() === 'STANDARD') || rates[0];
    if (!rate) throw new Error('No shipping rate available for this address');
    if (rate.currency && String(rate.currency).toUpperCase() !== String(currency).toUpperCase()) {
      throw new Error(`Shipping quoted in ${rate.currency}, order is in ${currency}`);
    }
    const cents = Math.round(Number(rate.rate) * 100);
    if (!Number.isFinite(cents) || cents < 0) throw new Error('Invalid shipping rate');
    return {
      cents,
      name: String(rate.name || 'Standard shipping').slice(0, 100),
      minDays: Number(rate.minDeliveryDays) || null,
      maxDays: Number(rate.maxDeliveryDays) || null,
    };
  }

  // Stripe Checkout shipping_options entry for a quoted (or previously charged) shipping cost.
  function stripeShippingOption(shipping, currency) {
    const rateData = {
      type: 'fixed_amount',
      fixed_amount: { amount: shipping.cents, currency: String(currency).toLowerCase() },
      display_name: shipping.name || 'Shipping',
    };
    if (shipping.minDays && shipping.maxDays) {
      rateData.delivery_estimate = {
        minimum: { unit: 'business_day', value: shipping.minDays },
        maximum: { unit: 'business_day', value: shipping.maxDays },
      };
    }
    return [{ shipping_rate_data: rateData }];
  }

  // The Stripe Checkout Session for an order — shared by first checkout and resume-payment
  // so both charge exactly the same way. `items` are already D1-priced (resolveOrderItemFromD1
  // output); a zero/absent shipping amount adds no shipping option.
  function createOrderCheckoutSession({ orderId, email, items, currency, shipping, siteUrl }) {
    return Stripe.createCheckoutSession(stripeEnv(), {
      mode: 'payment',
      customer_email: email,
      success_url: `${siteUrl}/ecommerce/order-confirmation.html?order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/ecommerce/checkout.html?cancelled=1`,
      'metadata[order_id]': orderId,
      shipping_options: shipping && shipping.cents > 0 ? stripeShippingOption(shipping, currency) : undefined,
      line_items: items.map(it => ({
        quantity: it.qty,
        price_data: {
          currency: (it.currency || currency).toLowerCase(),
          unit_amount: it.price_cents,
          product_data: { name: it.name, images: it.image_url ? [it.image_url] : undefined },
        },
      })),
    });
  }

  // Admin-only manual/comp order path still accepts a client-supplied price (a trusted
  // admin, not a customer, is entering these values) — kept distinct from the public
  // checkout path, which always re-prices from D1 via resolveOrderItemFromD1.
  function normalizeCartItem(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const id = o.id != null ? String(o.id).trim() : '';
    const slug = o.slug != null ? String(o.slug).trim() : '';
    const name = String(o.name || o.title || '').trim();
    const qty = Math.max(1, Math.min(99, parseInt(o.qty, 10) || 0));
    const price = Number(o.price);
    const image = String(o.image || o.image_url || '').trim();
    const printfulVariantId = o.printful_sync_variant_id != null
      ? String(o.printful_sync_variant_id).trim() || null
      : null;

    if (!name) return null;
    if (!Number.isFinite(price) || price < 0) return null;
    if (!qty) return null;

    // Accept both field names: dashboard sends printful_sync_variant_id; checkout.js sends variantId
    const resolvedVariantId = printfulVariantId ||
      (o.variantId != null ? (String(Number(o.variantId) || '') || null) : null);
    return { id: id || null, slug: slug || null, name, qty, price, image: image || null, printful_sync_variant_id: resolvedVariantId };
  }

  function computeOrderTotalCents(cartItems) {
    let total = 0;
    for (const it of cartItems) {
      const line = Math.round(Number(it.price) * 100) * Number(it.qty);
      if (!Number.isFinite(line) || line < 0) return null;
      total += line;
    }
    if (!Number.isFinite(total) || total < 0) return null;
    return Math.round(total);
  }

  // Shared customer-address validation for both the admin manual-order path and the
  // public Stripe checkout-session path. Throws on invalid input.
  function validateCustomer(body) {
    const customer = body && body.customer && typeof body.customer === 'object' ? body.customer : {};
    const firstName = clampStr(customer.firstName, 80);
    const lastName = clampStr(customer.lastName, 80);
    const email = String(customer.email || '').trim().toLowerCase();
    const address = clampStr(customer.address, 220);
    const city = clampStr(customer.city, 120);
    const country = clampStr(customer.country, 80);
    const state = clampStr(customer.state, 80);
    const zip = clampStr(customer.zip, 20);
    if (!firstName || !lastName) throw new Error('firstName and lastName required');
    if (!isValidEmail(email)) throw new Error('Valid email required');
    if (!address || !country || !state || !zip) throw new Error('address, country, state, zip required');
    return { firstName, lastName, email, address, city, country, state, zip };
  }

  // Inserts a row into `orders`, dropping any column D1 reports missing (pre-migration
  // deploys degrade gracefully — the order still records — instead of hard-failing) and
  // retrying once per missing column.
  // Direct insert — all columns here (base schema + printful_migration.sql + orders_migration.sql
  // + stripe_migration.sql) are required for the order flow to work at all, so there's no
  // graceful-degradation path: if a column is missing, this throws and the caller surfaces it.
  async function insertOrderRow(fields) {
    const cols = Object.keys(fields);
    const sql = `insert into orders (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`;
    await dbRun(sql, ...cols.map(c => fields[c]));
  }

  // POST /api/orders — admin-only manual/comp order recorder. This never talks to Printful
  // or Stripe; it just records an order row. Real customer orders always go through
  // apiCreateCheckoutSession, which is the only path that can trigger real Printful
  // production (gated on confirmed Stripe payment).
  async function apiCreateOrder(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const body = await readJson(request);
    const cartIn = Array.isArray(body.cart) ? body.cart : [];
    const cart = cartIn.map(normalizeCartItem).filter(Boolean);
    if (!cart.length) return jsonResponse({ error: 'cart is required' }, 400, request);

    let customer;
    try { customer = validateCustomer(body); }
    catch (e) { return jsonResponse({ error: String(e && e.message ? e.message : e) }, 400, request); }

    const currency = String(body.currency || 'USD').trim().toUpperCase() || 'USD';
    const totalCents = computeOrderTotalCents(cart);
    if (totalCents == null) return jsonResponse({ error: 'Invalid cart pricing' }, 400, request);

    const orderId = randomId('ord_');
    const now = new Date().toISOString();

    await insertOrderRow({
      id: orderId, user_id: null, email: customer.email, first_name: customer.firstName,
      last_name: customer.lastName, address: customer.address, city: customer.city,
      country: customer.country, state: customer.state, zip: customer.zip,
      currency, total_cents: totalCents, items_json: JSON.stringify(cart),
      status: 'created', created_at: now,
    });

    return jsonResponse({ ok: true, order_id: orderId, total_cents: totalCents, currency }, 201, request);
  }

  // The public link a shirt's QR encodes. PUBLIC_SITE_URL keeps it on the storefront
  // domain whatever host the webhook arrived on.
  function publicSiteBase(request) {
    const configured = String(globalThis.PUBLIC_SITE_URL || '').trim().replace(/\/$/, '');
    if (configured) return /^https?:\/\//i.test(configured) ? configured : 'https://' + configured;
    return request ? new URL(request.url).origin : '';
  }
  function pieceLink(base, code) { return `${base}/p/${encodeURIComponent(code)}`; }

  // Generates and stores the QR PNG for every AR shirt of the order that has none yet.
  // The printed size (from the PNG's whole-pixel width at 300 DPI) is kept on the R2
  // object so Printful gets exactly the size of the image.
  async function ensureOrderQrs(orderId, request) {
    const units = await dbAll(
      `select u.id, u.claim_code, u.qr_url, p.printful_qr, p.ar_target_id
       from garment_units u join products p on p.id = u.product_id
       where u.order_id = ? and p.ar_target_id is not null and u.qr_url is null`,
      orderId
    );
    const base = publicSiteBase(request);
    for (const u of units) {
      const qr = parsePrintfulQr(u.printful_qr);
      const { png, sizeIn } = await QR.qrPng(pieceLink(base, u.claim_code), qr ? qr.size_in : 2.5);
      const key = `qr/${u.claim_code}.png`;
      await ASSETS_BUCKET.put(key, png, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { size_in: String(sizeIn) },
      });
      await dbRun('update garment_units set qr_url = ? where id = ?', buildPublicAssetUrl(request, key), u.id);
    }
  }

  async function qrSizeForUrl(qrUrl) {
    const head = await ASSETS_BUCKET.head(keyFromPublicUrl(qrUrl)).catch(() => null);
    const n = head && head.customMetadata ? Number(head.customMetadata.size_in) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Sends a paid order to Printful from its existing units — never mints, so running it
  // twice (webhook retry, admin resubmit) can't print extra shirts. Any failure leaves
  // payment_status 'paid' and printful_status 'error' for the admin's resubmit.
  async function finalizeOrderPrintfulSubmission(orderId, request) {
    const row = await dbGet(
      `select id, email, first_name, last_name, address, city, country, state, zip, currency, items_json
       from orders where id = ?`,
      orderId
    );
    if (!row) return null;

    let items = [];
    try { items = JSON.parse(row.items_json) || []; } catch {}

    try {
      // Re-resolve against current D1 data so a fixed product (variant, art, QR settings)
      // is picked up on resubmit; prices stay as charged in items_json.
      const resolved = [];
      for (const it of items) {
        const r = await resolveOrderItemFromD1({ slug: it.slug, size: it.size, qty: it.qty }, request);
        resolved.push(r);
      }
      await ensureOrderQrs(orderId, request);
      const units = await dbAll(
        'select id, claim_code, item_index, unit_index, qr_url from garment_units where order_id = ?', orderId
      );
      for (const u of units) u.qr_size_in = u.qr_url ? await qrSizeForUrl(u.qr_url) : null;

      const pfItems = buildPrintfulOrderItems(orderId, resolved, units);
      const pf = await submitPrintfulOrder(orderId, pfItems, {
        firstName: row.first_name, lastName: row.last_name, email: row.email,
        address: row.address, city: row.city, country: row.country, state: row.state, zip: row.zip,
      });
      const printfulOrderId = pf && pf.result && pf.result.id ? String(pf.result.id) : null;
      const ok = !!(pf && pf.confirmed && printfulOrderId);
      await dbRun(
        `update orders set printful_order_id = ?, printful_status = ?, status = ? where id = ?`,
        printfulOrderId, ok ? 'pending' : 'error', ok ? 'pending_fulfillment' : 'paid', orderId
      );
      return { ok, printful_order_id: printfulOrderId };
    } catch (pfErr) {
      console.error('[printful] Failed to submit paid order', orderId, String(pfErr && pfErr.message ? pfErr.message : pfErr));
      await dbRun(`update orders set printful_status = ? where id = ?`, 'error', orderId).catch(() => {});
      return { ok: false, error: String(pfErr && pfErr.message ? pfErr.message : pfErr) };
    }
  }

  // POST /api/checkout/session — the real customer checkout entry point. Resolves every
  // cart line from D1 (price, design file, Printful catalog variant — never the client's
  // values), records a pending_payment order, and creates a hosted Stripe Checkout Session.
  // Printful is NOT contacted here — that only happens once Stripe confirms payment
  // (see apiStripeWebhook / finalizeOrderPrintfulSubmission).
  async function apiCreateCheckoutSession(request) {
    const ip = getClientIP(request);
    if (!rateLimitCheck('order:' + ip, RATE_LIMIT_MAX_ORDER)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }

    const stConfig = Stripe.getStripeConfig(stripeEnv());
    if (!stConfig.secretKey) return jsonResponse({ error: 'STRIPE_SECRET_KEY not configured' }, 500, request);

    // Every shirt is owned from the moment it is paid for, so checkout needs an account.
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Sign in to check out.' }, 401, request);

    const body = await readJson(request);

    let customer;
    try { customer = validateCustomer(body); }
    catch (e) { return jsonResponse({ error: String(e && e.message ? e.message : e) }, 400, request); }

    const cartIn = Array.isArray(body.cart) ? body.cart : [];
    if (!cartIn.length) return jsonResponse({ error: 'cart is required' }, 400, request);
    if (cartIn.length > 50) return jsonResponse({ error: 'Too many cart items' }, 400, request);

    let resolvedItems;
    try {
      resolvedItems = [];
      for (const raw of cartIn) resolvedItems.push(await resolveOrderItemFromD1(raw, request));
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 400, request);
    }

    // Refuse to charge for anything that could never actually ship: every line needs a
    // Printful catalog variant for its size and art, and an AR line also needs its QR
    // settings (submitPrintfulOrder would otherwise fail after the customer paid).
    const unfulfillable = resolvedItems
      .filter(it => !it.catalog_variant_id || !Object.keys(itemArt(it)).length || (it.has_ar && !it.qr))
      .map(it => it.slug);
    if (unfulfillable.length) {
      return jsonResponse({ error: `Not available for purchase yet: ${unfulfillable.join(', ')}` }, 400, request);
    }

    const itemsCents = resolvedItems.reduce((sum, it) => sum + it.price_cents * it.qty, 0);
    if (!Number.isFinite(itemsCents) || itemsCents <= 0) return jsonResponse({ error: 'Invalid cart pricing' }, 400, request);

    const currency = (resolvedItems[0] && resolvedItems[0].currency) || 'USD';

    // Printful bills the store for shipping on every order — charge the customer the same
    // quote. total_cents includes it, so the webhook's amount_total check still holds, and
    // resume-payment recovers it as total_cents minus the items.
    let shipping;
    try {
      shipping = await quoteShippingCents(resolvedItems, customer, currency);
    } catch (e) {
      console.error('[checkout] Shipping quote failed:', String(e && e.message ? e.message : e));
      return jsonResponse({ error: "We couldn't calculate shipping to that address. Check the country, state and ZIP and try again." }, 400, request);
    }
    const totalCents = itemsCents + shipping.cents;
    const siteUrl = String(body.site_url || new URL(request.url).origin).replace(/\/$/, '');

    const orderId = randomId('ord_');
    const now = new Date().toISOString();

    try {
      await insertOrderRow({
        id: orderId, user_id: sess.user.id, email: customer.email,
        first_name: customer.firstName, last_name: customer.lastName, address: customer.address,
        city: customer.city, country: customer.country, state: customer.state, zip: customer.zip,
        currency, total_cents: totalCents, items_json: JSON.stringify(resolvedItems),
        status: 'pending_payment', payment_status: 'unpaid', created_at: now,
      });
    } catch (e) {
      console.error('[checkout] Could not insert order', orderId, String(e));
      return jsonResponse({ error: 'Could not create order' }, 500, request);
    }

    let session;
    try {
      session = await createOrderCheckoutSession({
        orderId, email: customer.email, items: resolvedItems, currency, shipping, siteUrl,
      });
    } catch (e) {
      await dbRun(`update orders set status = ? where id = ?`, 'stripe_error', orderId).catch(() => {});
      return jsonResponse({ error: `Payment session could not be created: ${String(e && e.message ? e.message : e)}` }, 502, request);
    }

    // stripe_session_id is how the confirmation page and webhook find this order back —
    // fail loudly rather than silently proceeding with a session the order can never be
    // matched to.
    try {
      await dbRun(`update orders set stripe_session_id = ? where id = ?`, session.id, orderId);
    } catch (e) {
      return jsonResponse({ error: 'Could not link payment session to order', detail: String(e || '') }, 500, request);
    }

    return jsonResponse({ ok: true, order_id: orderId, checkout_url: session.url }, 201, request);
  }

  // Mints one garment_units row per shirt in a paid order, owned by the buyer from the
  // start. Each shirt has a slot (order_id, item_index, unit_index) with a unique index, so
  // this is idempotent: re-running inserts only missing slots. A claim-code collision
  // (31^8 codes) leaves its slot empty for the next pass with a fresh code.
  async function mintOrderUnits(orderId) {
    const row = await dbGet('select id, user_id, items_json from orders where id = ?', orderId);
    if (!row) return;
    let items = [];
    try { items = JSON.parse(row.items_json) || []; } catch {}

    const slots = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx] || {};
      const slug = String(it.slug || '').trim();
      if (!slug) continue;
      const product = await dbGet('select id, title from products where lower(slug) = lower(?)', slug);
      if (!product) continue;
      const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
      const nickname = String(it.name || product.title || '').trim().slice(0, 120) || null;
      for (let u = 0; u < qty; u++) slots.push({ productId: product.id, itemIndex: idx, unitIndex: u, nickname });
    }

    for (let pass = 0; pass < 3; pass++) {
      const have = new Set((await dbAll('select item_index, unit_index from garment_units where order_id = ?', orderId))
        .map(r => `${r.item_index}:${r.unit_index}`));
      const missing = slots.filter(sl => !have.has(`${sl.itemIndex}:${sl.unitIndex}`));
      if (!missing.length) return;
      await DB.batch(missing.map(sl => DB.prepare(
        `insert into garment_units (id, claim_code, product_id, order_id, item_index, unit_index, owner_user_id, claimed_at, nickname)
         values (?, ?, ?, ?, ?, ?, ?, ${row.user_id ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'null'}, ?)
         on conflict do nothing`
      ).bind(randomId('unit_'), randomClaimCode(), sl.productId, orderId, sl.itemIndex, sl.unitIndex, row.user_id || null, sl.nickname)));
    }
    console.error('[wardrobe] Order', orderId, 'still has unminted shirts after 3 passes');
  }

  // POST /api/webhooks/stripe — no session auth (server-to-server), authenticated instead
  // by verifying Stripe's HMAC signature on the raw body before any D1 write.
  async function apiStripeWebhook(request) {
    const rawBody = await request.text();
    const sigHeader = request.headers.get('Stripe-Signature');
    const stConfig = Stripe.getStripeConfig(stripeEnv());

    const valid = await Stripe.verifyWebhookSignature(rawBody, sigHeader, stConfig.webhookSecret);
    if (!valid) return new Response('Invalid signature', { status: 400 });

    let event;
    try { event = JSON.parse(rawBody); } catch { return new Response('Bad payload', { status: 400 }); }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data && event.data.object;
        const orderId = session && session.metadata && session.metadata.order_id;
        if (orderId) {
          const order = await dbGet('select id, payment_status, total_cents from orders where id = ?', orderId);
          if (!order) {
            console.error('[stripe] Webhook for unknown order', orderId);
          } else if (order.payment_status !== 'paid') {
            const amountOk = session.amount_total == null || Number(session.amount_total) === Number(order.total_cents);
            if (!amountOk) {
              console.error('[stripe] Order', orderId, 'amount mismatch: session', session.amount_total, 'vs order', order.total_cents);
            } else {
              // The conditional update is the idempotency lock: Stripe can deliver the same
              // event twice (retries, overlapping deliveries), and both copies can pass the
              // read above. Only the delivery that actually flips the row to 'paid' goes on
              // to create + confirm the Printful order and mint wardrobe pieces.
              const { changes } = await dbRun(
                `update orders set payment_status = ?, status = ?, stripe_payment_intent_id = ?, paid_at = ?
                 where id = ? and (payment_status is null or payment_status != 'paid')`,
                'paid', 'paid', session.payment_intent || null, new Date().toISOString(), orderId
              );
              if (changes === 1) {
                // Shirts (and their QR codes) first — the Printful order prints them.
                try { await mintOrderUnits(orderId); }
                catch (e) { console.error('[wardrobe] Minting failed for order', orderId, String(e)); }
                await finalizeOrderPrintfulSubmission(orderId, request);
              }
            }
          }
        }
      } else if (event.type === 'checkout.session.expired') {
        const session = event.data && event.data.object;
        const orderId = session && session.metadata && session.metadata.order_id;
        if (orderId) {
          await dbRun(`update orders set status = ? where id = ?`, 'payment_expired', orderId);
        }
      }
    } catch (e) {
      console.error('[stripe] Webhook handling error:', String(e && e.stack ? e.stack : e));
    }

    return new Response('OK', { status: 200 });
  }

  // GET /api/orders/:id/status?session_id=... — guest-safe order status lookup. The Stripe
  // Checkout Session id (only ever seen by the paying customer's own browser, via Stripe's
  // redirect) acts as a bearer capability token for this one order — deliberately returns a
  // minimal, PII-light shape since it isn't gated by a login session.
  async function apiGetOrderStatusPublic(request, id, sessionId) {
    const rawId = String(id || '').trim();
    const sid = String(sessionId || '').trim();
    if (!rawId || !sid) return jsonResponse({ error: 'order id and session_id required' }, 400, request);

    const row = await dbGet(
      `select id, email, status, payment_status, printful_status, tracking_number, tracking_url, carrier,
              total_cents, currency, items_json, stripe_session_id, created_at
       from orders where id = ?`,
      rawId
    );

    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);
    if (!row.stripe_session_id || row.stripe_session_id !== sid) {
      return jsonResponse({ error: 'Not found' }, 404, request);
    }

    let items = [];
    try {
      items = (JSON.parse(row.items_json) || []).map(it => ({
        name: it.name, qty: it.qty, price_cents: it.price_cents, image_url: it.image_url || null,
      }));
    } catch {}

    return jsonResponse({
      order_id: row.id,
      email: row.email || null,
      status: row.status || null,
      payment_status: row.payment_status || null,
      printful_status: row.printful_status || null,
      tracking_number: row.tracking_number || null,
      tracking_url: row.tracking_url || null,
      carrier: row.carrier || null,
      total_cents: row.total_cents,
      currency: row.currency || 'USD',
      created_at: row.created_at || null,
      items,
    }, 200, request);
  }

  // ---------- Admin APIs ----------

  // GET /api/admin/orders — list all orders with Printful status (admin only).
  async function apiAdminListOrders(request) {
    const { sess, error } = await requireAdminSession(request);
    if (error) return error;

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

    const rows = await dbAll(
      `select id, user_id, email, first_name, last_name, address, city, country, state, zip,
              currency, total_cents, status, payment_status, printful_order_id, printful_status, created_at
       from orders
       order by created_at desc
       limit ? offset ?`,
      limit, offset
    );

    return jsonResponse({ items: rows, limit, offset }, 200, request);
  }

  // GET /api/admin/orders/:id/pieces — every shirt of one order: its code, QR, public link,
  // owner and what it plays now.
  async function apiAdminOrderPieces(request, orderId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    const order = await dbGet('select id, payment_status, printful_status, printful_order_id from orders where id = ?', orderId);
    if (!order) return jsonResponse({ error: 'Not found' }, 404, request);
    const rows = await dbAll(
      `select u.id, u.claim_code, u.item_index, u.unit_index, u.qr_url, u.nickname, u.scan_count, u.last_scanned_at,
              p.title as product_title, p.slug as product_slug, p.ar_target_id, us.email as owner_email,
              (select max(version) from garment_layers where unit_id = u.id) as version
       from garment_units u
       join products p on p.id = u.product_id
       left join users us on us.id = u.owner_user_id
       where u.order_id = ?
       order by u.item_index, u.unit_index`,
      orderId
    );
    const base = publicSiteBase(request);
    const items = rows.map(r => ({
      id: r.id, claim_code: r.claim_code, item_index: r.item_index, unit_index: r.unit_index,
      product: { title: r.product_title, slug: r.product_slug, has_ar: r.ar_target_id != null },
      owner_email: r.owner_email || null, nickname: r.nickname || null,
      qr_url: r.qr_url || null, link: pieceLink(base, r.claim_code),
      version: r.version || 0, scan_count: r.scan_count || 0, last_scanned_at: r.last_scanned_at || null,
    }));
    return jsonResponse({
      order: { id: order.id, payment_status: order.payment_status, printful_status: order.printful_status, printful_order_id: order.printful_order_id },
      items,
    }, 200, request);
  }

  // POST /api/admin/orders/:id/resubmit — re-sends a paid order whose Printful submission
  // failed. Rebuilds from the order's existing shirts (generating any missing QR); never
  // mints. Refused once Printful holds a confirmed order for it.
  async function apiAdminResubmitOrder(request, orderId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    const order = await dbGet('select id, payment_status, printful_status, printful_order_id from orders where id = ?', orderId);
    if (!order) return jsonResponse({ error: 'Not found' }, 404, request);
    if (order.payment_status !== 'paid') return jsonResponse({ error: 'Only paid orders can be sent to Printful' }, 400, request);
    if (order.printful_order_id && order.printful_status !== 'error') {
      return jsonResponse({ error: 'Printful already has a confirmed order for this' }, 409, request);
    }
    const result = await finalizeOrderPrintfulSubmission(orderId, request);
    if (!result || !result.ok) return jsonResponse({ error: (result && result.error) || 'Printful did not confirm the order' }, 502, request);
    return jsonResponse({ ok: true, printful_order_id: result.printful_order_id }, 200, request);
  }

  // POST /api/webhooks/printful and /api/admin/printful/webhook — receive Printful event notifications.
  async function apiPrintfulWebhook(request) {
    // Printful calls the URL we registered (apiPrintfulWebhookRegister), which carries
    // ?token=<PRINTFUL_WEBHOOK_SECRET>. Without that check anyone could forge
    // shipment/failure events for any (sequential, guessable) Printful order id.
    const secret = typeof PRINTFUL_WEBHOOK_SECRET === 'string' ? PRINTFUL_WEBHOOK_SECRET.trim() : '';
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!secret || !timingSafeEqual(token, secret)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const rawBody = await request.text();

    let payload = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      // Acknowledge malformed payloads so Printful does not retry indefinitely.
      return new Response('OK', { status: 200 });
    }

    const eventType = String(payload.type || '');
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};

    const orderObj = (data.order && typeof data.order === 'object') ? data.order : null;
    const shipmentObj = (data.shipment && typeof data.shipment === 'object') ? data.shipment : null;
    const nestedShipmentOrder = shipmentObj && shipmentObj.order && typeof shipmentObj.order === 'object'
      ? shipmentObj.order
      : null;
    const printfulOrderId = String(
      (orderObj && orderObj.id) ||
      data.order_id ||
      data.orderId ||
      (nestedShipmentOrder && nestedShipmentOrder.id) ||
      ''
    ).trim();

    try {
      switch (eventType) {
        case 'shipment_sent': {
          if (!printfulOrderId) break;
          const trackingNumber = String(
            (shipmentObj && (shipmentObj.tracking_number || shipmentObj.trackingNumber)) ||
            data.tracking_number ||
            data.trackingNumber ||
            ''
          ).trim() || null;
          const trackingUrl = safeHttpUrl(
            (shipmentObj && (shipmentObj.tracking_url || shipmentObj.trackingUrl)) ||
            data.tracking_url ||
            data.trackingUrl
          );
          const carrier = String((shipmentObj && shipmentObj.carrier) || data.carrier || '').trim() || null;
          await dbRun(
            `update orders
             set status = ?, printful_status = ?, tracking_number = ?, tracking_url = ?, carrier = ?,
                 shipped_at = coalesce(shipped_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             where printful_order_id = ?`,
            'shipped',
            'shipped',
            trackingNumber,
            trackingUrl,
            carrier,
            printfulOrderId
          );
          break;
        }
        case 'order_updated': {
          if (!printfulOrderId) break;
          const newStatus = String((orderObj && orderObj.status) || data.status || '').trim() || 'updated';
          await dbRun(
            `update orders set printful_status = ? where printful_order_id = ?`,
            newStatus,
            printfulOrderId
          );
          break;
        }
        case 'order_failed': {
          if (!printfulOrderId) break;
          await dbRun(
            `update orders set printful_status = ? where printful_order_id = ?`,
            'failed',
            printfulOrderId
          );
          break;
        }
        default:
          // Ignore unsupported event types but still acknowledge delivery.
          break;
      }
    } catch {
      // Always acknowledge webhook receipt to avoid repeated retries for transient DB issues.
    }

    return new Response('OK', { status: 200 });
  }

  async function apiAdminCreateBrandUser(request) {
    const { sess, error } = await requireAdminSession(request);
    if (error) return error;

    const body = await readJson(request);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const brandName = (body.brand || '').trim();

    if (!brandName) return jsonResponse({ error: 'brand required' }, 400, request);
    if (!isValidEmail(email)) return jsonResponse({ error: 'Valid email required' }, 400, request);
    if (!password || String(password).length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, request);

    const existing = await dbGet('select id from users where email = ?', email);
    if (existing) return jsonResponse({ error: 'Email already exists' }, 409, request);

    const brandId = await ensureBrandIdByName(brandName);
    if (!brandId) return jsonResponse({ error: 'Invalid brand' }, 400, request);

    const salt = randomId('salt_');
    const hash = await hashPassword(password, salt);
    const userId = randomId('usr_');
    await dbRun('insert into users (id, email, password_hash, role) values (?, ?, ?, ?)', userId, email, hash, 'brand');
    await dbRun('insert into brand_users (user_id, brand_id) values (?, ?)', userId, brandId);

    return jsonResponse(
      { ok: true, user: { id: userId, email, role: 'brand', brand: { id: brandId, name: brandName } }, created_by: sess.user.email || sess.user.id },
      201,
      request
    );
  }

  // ---------- Products APIs ----------

  async function apiAdminListUsers(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    const url = new URL(request.url);
    const roleFilter = (url.searchParams.get('role') || '').trim().toLowerCase();
    let sql = `
      select u.id, u.email, u.role, u.suspended_until, u.created_at,
             group_concat(b.name, ', ') as brands,
             (select count(*) from targets t where t.user_id = u.id) as target_count,
             (select count(*) from products p
                where p.brand_id in (select brand_id from brand_users where user_id = u.id)) as product_count,
             (select count(*) from orders o where o.user_id = u.id or (o.user_id is null and lower(trim(o.email)) = lower(u.email))) as order_count,
             (select count(*) from brand_designs d
                where d.brand_id in (select brand_id from brand_users where user_id = u.id)) as pending_design_count
      from users u
      left join brand_users bu on bu.user_id = u.id
      left join brands b on b.id = bu.brand_id
    `;
    const where = [];
    const params = [];
    if (roleFilter) { where.push('u.role = ?'); params.push(roleFilter); }
    if (where.length) sql += ' where ' + where.join(' and ');
    sql += ' group by u.id order by u.created_at desc';

    const rows = await dbAll(sql, ...params);
    return jsonResponse({ items: rows }, 200, request);
  }

  // ---------- Account moderation (admin only) ----------

  // POST /api/admin/users/:id/role — change a user's role. Moving *into* 'brand' requires
  // a brand name (creates the brand if it doesn't exist yet, same as
  // apiAdminCreateBrandUser) and replaces any existing brand_users row for this user — one
  // brand per user is the assumption the rest of the app already makes (sess.user.brands[0]).
  // Moving *out of* 'brand' clears any brand_users row so no stale association lingers.
  async function apiAdminChangeUserRole(request, userId) {
    const { sess, error } = await requireAdminSession(request);
    if (error) return error;
    if (!userId) return jsonResponse({ error: 'user id required' }, 400, request);
    if (userId === sess.user.id) return jsonResponse({ error: 'Cannot change your own role' }, 400, request);

    const body = await readJson(request);
    const role = String(body.role || '').trim().toLowerCase();
    if (!['admin', 'brand', 'client'].includes(role)) {
      return jsonResponse({ error: 'role must be admin, brand, or client' }, 400, request);
    }

    const target = await dbGet('select id, role from users where id = ?', userId);
    if (!target) return jsonResponse({ error: 'Not found' }, 404, request);

    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = await dbGet(`select count(*) as c from users where role = 'admin'`);
      if (adminCount && adminCount.c <= 1) {
        return jsonResponse({ error: 'Cannot demote the last remaining admin' }, 400, request);
      }
    }

    let brandInfo = null;
    if (role === 'brand') {
      const brandName = (body.brand || '').trim();
      if (!brandName) return jsonResponse({ error: 'brand required when role is brand' }, 400, request);
      const brandId = await ensureBrandIdByName(brandName);
      await dbRun('delete from brand_users where user_id = ?', userId);
      await dbRun('insert into brand_users (user_id, brand_id) values (?, ?)', userId, brandId);
      brandInfo = { id: brandId, name: brandName };
    } else {
      await dbRun('delete from brand_users where user_id = ?', userId);
    }

    await dbRun('update users set role = ? where id = ?', role, userId);

    return jsonResponse({ ok: true, user: { id: userId, role, brand: brandInfo } }, 200, request);
  }

  // POST /api/admin/users/:id/timeout — temporarily suspends login for a user.
  // body.minutes > 0 sets suspended_until that far in the future and immediately kills
  // every existing session for them; minutes <= 0 (or omitted) lifts an existing timeout.
  async function apiAdminTimeoutUser(request, userId) {
    const { sess, error } = await requireAdminSession(request);
    if (error) return error;
    if (!userId) return jsonResponse({ error: 'user id required' }, 400, request);
    if (userId === sess.user.id) return jsonResponse({ error: 'Cannot time out your own account' }, 400, request);

    const target = await dbGet('select id from users where id = ?', userId);
    if (!target) return jsonResponse({ error: 'Not found' }, 404, request);

    const body = await readJson(request);
    const minutes = Number(body.minutes);
    const suspendedUntil = Number.isFinite(minutes) && minutes > 0
      ? new Date(Date.now() + minutes * 60_000).toISOString()
      : null;

    await dbRun('update users set suspended_until = ? where id = ?', suspendedUntil, userId);

    if (suspendedUntil) {
      await dbRun('delete from sessions where user_id = ?', userId);
    }

    return jsonResponse({ ok: true, suspended_until: suspendedUntil }, 200, request);
  }

  // DELETE /api/admin/users/:id — permanently deletes an account. Sessions, brand_users,
  // targets, and brand_designs all cascade via FK ON DELETE CASCADE; orders.user_id is set
  // null instead (order history survives). Products stay with the brand, not the user, so
  // a brand's catalog is unaffected by deleting one of its logins.
  async function apiAdminDeleteUser(request, userId) {
    const { sess, error } = await requireAdminSession(request);
    if (error) return error;
    if (!userId) return jsonResponse({ error: 'user id required' }, 400, request);
    if (userId === sess.user.id) return jsonResponse({ error: 'Cannot delete your own account' }, 400, request);

    const target = await dbGet('select id, role from users where id = ?', userId);
    if (!target) return jsonResponse({ error: 'Not found' }, 404, request);

    if (target.role === 'admin') {
      const adminCount = await dbGet(`select count(*) as c from users where role = 'admin'`);
      if (adminCount && adminCount.c <= 1) {
        return jsonResponse({ error: 'Cannot delete the last remaining admin' }, 400, request);
      }
    }

    await dbRun('delete from users where id = ?', userId);
    return jsonResponse({ ok: true }, 200, request);
  }

  // Every product column the API returns, plus whether an inline image exists (the image
  // bytes themselves are only served by /api/product-image).
  const PRODUCT_SELECT = `
    select p.id, p.title, p.slug, p.category, p.color, p.sizes, p.description, p.price_cents, p.currency,
           p.image_url, p.image_urls,
           case when p.image_data is not null and length(p.image_data) > 0 then 1 else 0 end as has_image_data,
           p.is_published, p.ar_target_id, p.printful_sync_product_id, p.printful_sync_variant_id,
           p.printful_variant_map, p.printful_design_images, p.printful_design_layers,
           p.printful_catalog_product_id, p.printful_qr,
           p.created_at, p.updated_at, b.name as brand
    from products p
    left join brands b on b.id = p.brand_id`;

  // The one API shape for a product row — list, get, create and update all return it.
  function shapeProduct(r) {
    const imageUrls = parseImageUrlsFromRow(r.image_urls);
    const firstUrl = firstImageUrl(r.image_url, imageUrls || r.image_urls);
    const qs = new URLSearchParams();
    if (r.brand) qs.set('brand', r.brand);
    if (r.slug) qs.set('product', r.slug);
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      category: r.category || null,
      color: r.color || null,
      sizes: r.sizes || null,
      description: r.description,
      price_cents: r.price_cents,
      currency: r.currency,
      image_url: firstUrl || (r.has_image_data ? `/api/product-image?id=${encodeURIComponent(r.id)}&i=0` : null),
      image_urls: imageUrls,
      is_published: !!r.is_published,
      ar_target_id: r.ar_target_id == null ? null : Number(r.ar_target_id),
      printful_sync_product_id: r.printful_sync_product_id || null,
      printful_sync_variant_id: r.printful_sync_variant_id || null,
      printful_variant_map: safeJsonParse(r.printful_variant_map),
      printful_design_images: safeJsonParse(r.printful_design_images),
      printful_design_layers: safeJsonParse(r.printful_design_layers),
      printful_catalog_product_id: r.printful_catalog_product_id || null,
      printful_qr: parsePrintfulQr(r.printful_qr),
      brand: r.brand || null,
      viewer_url: `/viewer${qs.toString() ? `?${qs}` : ''}`,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  async function loadProduct(id) {
    const row = await dbGet(`${PRODUCT_SELECT} where p.id = ?`, id);
    return row ? shapeProduct(row) : null;
  }

  // JSON-ish product fields (variant map, design images/layers) arrive either as an object
  // or as an already-serialized string; store both as text, empty as null.
  function jsonFieldValue(v) {
    if (v == null) return null;
    return typeof v === 'object' ? JSON.stringify(v) : (String(v).trim() || null);
  }

  function isSlugConflict(e) {
    const msg = String(e || '').toLowerCase();
    return msg.includes('unique') && msg.includes('slug');
  }

  async function apiListProducts(request) {
    const url = new URL(request.url);
    const brandName = (url.searchParams.get('brand') || '').trim();
    const includeUnpublished = url.searchParams.get('includeUnpublished') === '1';

    const sess = await getSessionUser(request);
    const role = (sess && sess.user && sess.user.role) || 'anonymous';

    const where = [];
    const params = [];
    if (role === 'brand') {
      const brandIds = sessionBrandIds(sess);
      if (!brandIds.length) return jsonResponse({ items: [] }, 200, request);
      where.push(`p.brand_id in (${brandIds.map(() => '?').join(',')})`);
      params.push(...brandIds);
    }
    if (brandName) {
      where.push('lower(b.name) = lower(?)');
      params.push(brandName);
    }
    const canSeeUnpublished = isPrivilegedRole(role) && includeUnpublished;
    if (!canSeeUnpublished) where.push('p.is_published = 1');

    const rows = await dbAll(
      `${PRODUCT_SELECT}${where.length ? ' where ' + where.join(' and ') : ''} order by p.created_at desc`,
      ...params
    );
    const items = rows.map(shapeProduct);
    return canSeeUnpublished
      ? jsonResponse({ items }, 200, request)
      : withCache(jsonResponse({ items }, 200, request), 'public, max-age=30, s-maxage=120');
  }

  async function apiGetProduct(request, ref) {
    const raw = String(ref || '').trim();
    if (!raw) return jsonResponse({ error: 'Product reference required' }, 400, request);
    const byId = isDigits(raw);
    const row = await dbGet(`${PRODUCT_SELECT} where ${byId ? 'p.id' : 'p.slug'} = ?`, byId ? Number(raw) : raw);
    if (!row || !row.is_published) return jsonResponse({ error: 'Not found' }, 404, request);
    return withCache(jsonResponse({ product: shapeProduct(row) }, 200, request), 'public, max-age=60, s-maxage=300');
  }

  async function apiGetProductImage(request) {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    const idx = Math.max(0, Number(url.searchParams.get('i') || '0') || 0);
    if (!Number.isFinite(id) || id <= 0) return new Response('Bad Request', { status: 400 });

    const row = await dbGet('select image_data from products where id = ?', id);
    if (!row || !row.image_data) return new Response('Not Found', { status: 404 });

    let picked = null;
    const raw = String(row.image_data || '').trim();
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) picked = String(arr[Math.min(idx, arr.length - 1)] || '');
      } catch {}
    }
    if (!picked) picked = raw;

    const parsed = parseImageDataUrl(picked);
    if (!parsed) return new Response('Invalid image data', { status: 500 });

    let bytes;
    try {
      bytes = base64ToBytes(parsed.base64);
    } catch {
      return new Response('Invalid image data', { status: 500 });
    }

    const headers = buildCorsHeaders(request);
    headers.set('Content-Type', parsed.mime);
    headers.set('Cache-Control', 'public, max-age=3600');
    return new Response(bytes, { status: 200, headers });
  }

  async function apiCreateProduct(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const body = await readJson(request);
    // Title/category/color/sizes are only truly required to *publish* a product — creating
    // one is also how a brand-new, not-yet-designed product gets an id to link to a real
    // Printful garment in the first place, so none of these can be a precondition for that.
    // A blank title falls back to a placeholder (still NOT NULL at the DB level) that the
    // Printful sync-import link overwrites with the real product name once picked.
    const titleRaw = (body.title || '').trim();
    const title = titleRaw || 'Untitled Product';
    const category = (body.category || '').trim() || null;
    const color = (body.color || '').trim() || null;
    const sizes = (body.sizes || '').trim() || null;
    const description = (body.description || '').trim() || null;
    const currency = (body.currency || 'USD').trim().toUpperCase() || 'USD';
    const imageUrl = (body.image_url || '').trim() || null;
    const imageData = (body.image_data || '').trim() || null;
    const imageUrlsArr = parseImageUrlsField(body.image_urls);
    const imageUrlsJson = imageUrlsArr ? JSON.stringify(imageUrlsArr) : null;
    const isPublished = body.is_published ? 1 : 0;
    const printfulVariantId = body.printful_sync_variant_id != null
      ? String(body.printful_sync_variant_id).trim() || null
      : null;
    const printfulVariantMap = jsonFieldValue(body.printful_variant_map);
    const printfulDesignImages = jsonFieldValue(body.printful_design_images);
    const printfulDesignLayers = jsonFieldValue(body.printful_design_layers);
    if (imageUrlsArr == null && body.image_urls != null) return jsonResponse({ error: 'Invalid image_urls (max 5)' }, 400, request);
    if (imageData) {
      if (imageData.length > 2_000_000) return jsonResponse({ error: 'image too large' }, 413, request);
      const parsed = parseImageDataUrl(imageData);
      if (!parsed) return jsonResponse({ error: 'Invalid image_data' }, 400, request);
    }
    const priceCents = parsePriceCents(body);
    if (priceCents == null) return jsonResponse({ error: 'Invalid price' }, 400, request);

    let slug = normalizeSlug(body.slug || titleRaw);
    if (!slug) slug = 'draft-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const brandName = (body.brand || '').trim();
    let brandId = brandName ? await ensureBrandIdByName(brandName) : null;

    let targetId = body.ar_target_id != null && body.ar_target_id !== '' ? Number(body.ar_target_id) : null;
    if (targetId != null && !Number.isFinite(targetId)) return jsonResponse({ error: 'Invalid ar_target_id' }, 400, request);
    if (targetId != null) {
      const t = await dbGet('select id, brand_id from targets where id = ?', targetId);
      if (!t) return jsonResponse({ error: 'Target not found' }, 404, request);
    }

    let lastRowId;
    try {
      ({ lastRowId } = await dbRun(
        `insert into products (brand_id, title, slug, category, color, sizes, description, price_cents, currency,
                               image_url, image_urls, image_data, is_published, ar_target_id, printful_sync_variant_id,
                               printful_variant_map, printful_design_images, printful_design_layers)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        brandId, title, slug, category, color, sizes, description, priceCents, currency,
        imageUrl, imageUrlsJson, imageData, isPublished, targetId, printfulVariantId,
        printfulVariantMap, printfulDesignImages, printfulDesignLayers
      ));
    } catch (e) {
      if (isSlugConflict(e)) return jsonResponse({ error: 'slug already exists' }, 409, request);
      throw e;
    }

    await syncTargetBrandFromProduct(lastRowId);

    // Printful linking is a separate step (POST /api/admin/printful/products/:id/link),
    // done after the product exists — no push-on-save here (v2 has no "sync product" to push).
    return jsonResponse({ ok: true, item: await loadProduct(lastRowId) }, 201, request);
  }

  async function apiUpdateProduct(request, id) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!id) return jsonResponse({ error: 'id required' }, 400, request);

    const existing = await dbGet('select id, brand_id from products where id = ?', id);
    if (!existing) return jsonResponse({ error: 'Not found' }, 404, request);

    const body = await readJson(request);
    const fields = [];
    const params = [];

    if (body.title != null) { fields.push('title = ?'); params.push(String(body.title).trim()); }
    if (body.slug != null) {
      const slug = normalizeSlug(body.slug);
      if (!slug) return jsonResponse({ error: 'Invalid slug' }, 400, request);
      fields.push('slug = ?'); params.push(slug);
    }
    if (body.description != null) { fields.push('description = ?'); params.push(String(body.description).trim() || null); }
    if (body.currency != null) { fields.push('currency = ?'); params.push(String(body.currency).trim().toUpperCase() || 'USD'); }
    if (body.image_url != null) { fields.push('image_url = ?'); params.push(String(body.image_url).trim() || null); }
    if (body.image_urls !== undefined) {
      const parsed = parseImageUrlsField(body.image_urls);
      if (parsed == null) return jsonResponse({ error: 'Invalid image_urls (max 5)' }, 400, request);
      fields.push('image_urls = ?');
      params.push(parsed.length ? JSON.stringify(parsed) : null);
    }
    if (body.image_data !== undefined) {
      const v = String(body.image_data || '').trim();
      if (!v) {
        fields.push('image_data = ?');
        params.push(null);
      } else {
        if (v.length > 2_000_000) return jsonResponse({ error: 'image too large' }, 413, request);
        const parsed = parseImageDataUrl(v);
        if (!parsed) return jsonResponse({ error: 'Invalid image_data' }, 400, request);
        fields.push('image_data = ?');
        params.push(v);
      }
    }
    if (body.is_published != null) { fields.push('is_published = ?'); params.push(body.is_published ? 1 : 0); }

    if (body.price_cents != null || body.price != null) {
      const cents = parsePriceCents(body);
      if (cents == null) return jsonResponse({ error: 'Invalid price' }, 400, request);
      fields.push('price_cents = ?'); params.push(cents);
    }

    if (body.ar_target_id !== undefined) {
      let targetId = body.ar_target_id != null && body.ar_target_id !== '' ? Number(body.ar_target_id) : null;
      if (targetId != null && !Number.isFinite(targetId)) return jsonResponse({ error: 'Invalid ar_target_id' }, 400, request);
      if (targetId != null) {
        const t = await dbGet('select id, brand_id from targets where id = ?', targetId);
        if (!t) return jsonResponse({ error: 'Target not found' }, 404, request);
      }
      fields.push('ar_target_id = ?'); params.push(targetId);
    }

    if (body.category != null) {
      const v = String(body.category).trim();
      if (!v) return jsonResponse({ error: 'Invalid category' }, 400, request);
      fields.push('category = ?');
      params.push(v);
    }

    if (body.color != null) {
      const v = String(body.color).trim();
      if (!v) return jsonResponse({ error: 'Invalid color' }, 400, request);
      fields.push('color = ?');
      params.push(v);
    }

    if (body.sizes != null) {
      const v = String(body.sizes).trim();
      if (!v) return jsonResponse({ error: 'Invalid sizes' }, 400, request);
      fields.push('sizes = ?');
      params.push(v);
    }

    if (body.printful_sync_variant_id !== undefined) {
      const v = body.printful_sync_variant_id != null ? String(body.printful_sync_variant_id).trim() || null : null;
      fields.push('printful_sync_variant_id = ?');
      params.push(v);
    }

    if (body.printful_variant_map !== undefined) {
      fields.push('printful_variant_map = ?');
      params.push(jsonFieldValue(body.printful_variant_map));
    }

    if (body.printful_design_images !== undefined) {
      fields.push('printful_design_images = ?');
      params.push(jsonFieldValue(body.printful_design_images));
    }

    if (body.printful_design_layers !== undefined) {
      fields.push('printful_design_layers = ?');
      params.push(jsonFieldValue(body.printful_design_layers));
    }

    if (body.printful_qr !== undefined) {
      const qr = body.printful_qr == null ? null : parsePrintfulQr(body.printful_qr);
      if (body.printful_qr != null && !qr) {
        return jsonResponse({ error: 'QR settings need a placement, a size from 1 to 6 inches, and a position inside the print area' }, 400, request);
      }
      fields.push('printful_qr = ?');
      params.push(qr ? JSON.stringify(qr) : null);
    }

    if (!fields.length) return jsonResponse({ ok: true }, 200, request);
    fields.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))");

    try {
      await dbRun(`update products set ${fields.join(', ')} where id = ?`, ...params, id);
    } catch (e) {
      if (isSlugConflict(e)) return jsonResponse({ error: 'slug already exists' }, 409, request);
      throw e;
    }
    await syncTargetBrandFromProduct(id);
    return jsonResponse({ ok: true, item: await loadProduct(id) }, 200, request);
  }

  // A target the admin uploads has no brand; once it's linked to a brand's product, give it
  // that brand so brand-scoped viewer links (?brand=) and the brand's own target list find it.
  // Never overwrites a brand the target already has.
  async function syncTargetBrandFromProduct(productId) {
    await dbRun(
      `update targets set brand_id = (select brand_id from products where id = ?)
       where id = (select ar_target_id from products where id = ?) and brand_id is null`,
      productId, productId
    ).catch(e => console.error('[targets] brand sync failed', String(e)));
  }

  async function apiDeleteProduct(request, id) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!id) return jsonResponse({ error: 'id required' }, 400, request);

    const existing = await dbGet('select id from products where id = ?', id);
    if (!existing) return jsonResponse({ error: 'Not found' }, 404, request);

    // A product with pieces in customer wardrobes can't be deleted — unpublishing removes it
    // from the shop without touching owned pieces. The DB enforces this too
    // (garment_units.product_id ON DELETE RESTRICT, sql/garment_units_restrict_migration.sql);
    // this check just gives the admin a readable reason. On a DB still on the old CASCADE
    // schema, this check is the only thing stopping a wardrobe wipe.
    const hasPiecesResponse = (count) => jsonResponse({
      error: `This product has ${count} piece(s) in customer wardrobes and can't be deleted. Unpublish it instead.`,
      code: 'has_pieces',
    }, 409, request);
    const units = await dbGet('select count(*) as c from garment_units where product_id = ?', id);
    if (units && Number(units.c) > 0) return hasPiecesResponse(units.c);

    try {
      await dbRun('delete from products where id = ?', id);
    } catch (e) {
      // A piece was minted between the check above and this delete; RESTRICT refused it.
      if (String(e || '').toLowerCase().includes('foreign key constraint')) return hasPiecesResponse('some');
      throw e;
    }
    return jsonResponse({ ok: true }, 200, request);
  }

  // ---------- Reviews APIs (shop) ----------

  function isDigits(s) {
    return /^\d+$/.test(String(s || '').trim());
  }

  async function resolvePublishedProductByRef(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return null;
    if (isDigits(raw)) {
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0) return null;
      const row = await dbGet('select id, slug, is_published from products where id = ?', id);
      if (!row || !row.is_published) return null;
      return { id: Number(row.id), slug: row.slug || null };
    }
    const row = await dbGet('select id, slug, is_published from products where slug = ?', raw);
    if (!row || !row.is_published) return null;
    return { id: Number(row.id), slug: row.slug || raw };
  }

  async function apiListReviews(request, refOverride) {
    const url = new URL(request.url);
    const ref = refOverride || (url.searchParams.get('product') || url.searchParams.get('product_id') || url.searchParams.get('product_slug') || '').trim();
    if (!ref) return jsonResponse({ error: 'product required' }, 400, request);

    const product = await resolvePublishedProductByRef(ref);
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

    // Latest reviews and the rating stats in one round trip.
    const [itemsRes, statsRes] = await DB.batch([
      DB.prepare('select id, rating, author, comment, created_at from product_reviews where product_id = ? order by created_at desc limit 50').bind(product.id),
      DB.prepare('select avg(rating) as average, count(*) as count from product_reviews where product_id = ?').bind(product.id),
    ]);
    const items = itemsRes.results || [];
    const statsRow = (statsRes.results || [])[0] || null;

    const avg = statsRow && statsRow.average != null ? Number(statsRow.average) : 0;
    const count = statsRow && statsRow.count != null ? Number(statsRow.count) : 0;
    return withCache(
      jsonResponse(
        {
          product,
          stats: { average: Number.isFinite(avg) ? avg : 0, count: Number.isFinite(count) ? count : 0 },
          items: items.map(r => ({
            id: r.id,
            rating: Number(r.rating) || 0,
            author: r.author || null,
            comment: r.comment || null,
            created_at: r.created_at || null,
          })),
        },
        200,
        request
      ),
      'public, max-age=60, s-maxage=120'
    );
  }

  async function apiCreateReview(request, refOverride) {
    const ip = getClientIP(request);
    if (!rateLimitCheck('review:' + ip, RATE_LIMIT_MAX_REVIEW)) {
      return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, request);
    }
    const body = await readJson(request);
    const ref = refOverride || (body.product || body.product_id || body.product_slug || '').toString().trim();
    if (!ref) return jsonResponse({ error: 'product required' }, 400, request);

    const rating = parseInt(body.rating, 10);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ error: 'rating must be 1-5' }, 400, request);
    }

    const authorRaw = (body.author || '').toString().trim();
    const commentRaw = (body.comment || '').toString().trim();
    if (authorRaw.length > 60) return jsonResponse({ error: 'author too long' }, 400, request);
    if (commentRaw.length > 1000) return jsonResponse({ error: 'comment too long' }, 400, request);
    const author = authorRaw || null;
    const comment = commentRaw || null;

    const product = await resolvePublishedProductByRef(ref);
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

    const row = await dbGet(
      `insert into product_reviews (product_id, product_slug, rating, author, comment) values (?, ?, ?, ?, ?)
       returning id, rating, author, comment, created_at`,
      product.id, product.slug, rating, author, comment
    );
    return jsonResponse(
      {
        ok: true,
        item: row
          ? { id: row.id, rating: Number(row.rating) || rating, author: row.author || null, comment: row.comment || null, created_at: row.created_at || null }
          : null,
      },
      201,
      request
    );
  }

  // ---------- Targets APIs (admin + brand) ----------

  async function apiListTargets(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    const role = sess.user.role;
    // Targets are console data (admin + brand dashboards). Customers never manage them.
    if (role !== 'admin' && role !== 'brand') return jsonResponse({ error: 'Forbidden' }, 403, request);
    const url = new URL(request.url);
    const brandName = (url.searchParams.get('brand') || '').trim();
    const product   = (url.searchParams.get('product') || '').trim();
    const clientId  = (url.searchParams.get('clientId') || '').trim();
    const uploaderRole = (url.searchParams.get('uploaderRole') || '').trim().toLowerCase();

    let sql = `
      select t.id, t.user_id, u.email as uploader_email, u.role as uploader_role,
        t.name, t.product, t.mind_url, t.video_url, t.image_url,
        t.is_active, t.created_at, b.name as brand
      from targets t
      left join brands b on b.id = t.brand_id
      left join users u on u.id = t.user_id
    `;
    const where = [];
    const params = [];

    if (role === 'brand') {
      const brandIds = sessionBrandIds(sess);
      if (!brandIds.length) return jsonResponse({ items: [] }, 200, request);
      where.push(`t.brand_id in (${brandIds.map(() => '?').join(',')})`);
      params.push(...brandIds);
    }
    if (brandName) { where.push('b.name = ?');      params.push(brandName); }
    if (product)   { where.push('t.product = ?');   params.push(product);   }
    if (clientId && role === 'admin') { where.push('t.user_id = ?'); params.push(clientId); }
    if (uploaderRole && role === 'admin') {
      if (!['admin', 'brand', 'client'].includes(uploaderRole)) {
        return jsonResponse({ error: 'Invalid uploaderRole' }, 400, request);
      }
      where.push('lower(u.role) = lower(?)');
      params.push(uploaderRole);
    }

    if (where.length) sql += ' where ' + where.join(' and ');
    sql += ' order by t.created_at desc';

    const rows = await dbAll(sql, ...params);
    const items = rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      // Who uploaded a target is admin-only — a brand shouldn't see staff accounts.
      uploader_email: role === 'admin' ? (r.uploader_email || null) : null,
      uploader_role: role === 'admin' ? (r.uploader_role || null) : null,
      name: r.name,
      product: r.product,
      mindurl: r.mind_url,
      videourl: r.video_url,
      imageurl: r.image_url,
      is_active: !!r.is_active,
      created_at: r.created_at,
      brand: r.brand || null
    }));
    return jsonResponse({ items }, 200, request);
  }

  async function apiCreateTarget(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    const body = await readJson(request);
    const name    = (body.name || '').trim();
    const product = (body.product || '').trim() || null;
    const mindUrl = (body.mind_url || '').trim();
    const videoUrl= (body.video_url || '').trim();
    const imageUrl= (body.image_url || '').trim() || null;
    let brandName = (body.brand || '').trim();

    if (!name || !mindUrl || !videoUrl) {
      return jsonResponse({ error: 'name, mind_url, video_url required' }, 400, request);
    }

    let brandId = null;
    if (sess.user.role === 'admin') {
      // No brand given: inherit it from the product this target is for, if that product exists.
      if (!brandName && product) {
        const pb = await dbGet('select b.name from products p join brands b on b.id = p.brand_id where lower(p.slug) = lower(?)', product);
        if (pb) brandName = pb.name;
      }
      if (brandName) {
        let b = await dbGet('select id from brands where name = ?', brandName);
        if (!b) {
          await dbRun('insert into brands (name) values (?)', brandName);
          b = await dbGet('select id from brands where name = ?', brandName);
        }
        brandId = b.id;
      }
    } else if (sess.user.role === 'brand') {
      const brands = sess.user.brands || [];
      if (!brands.length) return jsonResponse({ error: 'Brand account has no brand assigned' }, 400, request);
      brandId = brands[0].id;
      brandName = brands[0].name;
    } else {
      return jsonResponse({ error: 'Forbidden' }, 403, request);
    }

    const { lastRowId } = await dbRun(
      'insert into targets (user_id, brand_id, name, product, mind_url, video_url, image_url, is_active) values (?, ?, ?, ?, ?, ?, ?, 0)',
      sess.user.id, brandId, name, product, mindUrl, videoUrl, imageUrl
    );

    const row = await dbGet(
      `select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
              t.is_active, t.created_at, b.name as brand
      from targets t
      left join brands b on b.id = t.brand_id
      where t.id = ?`,
      lastRowId
    );

    const item = row && {
      id: row.id,
      name: row.name,
      product: row.product,
      mindurl: row.mind_url,
      videourl: row.video_url,
      imageurl: row.image_url,
      is_active: !!row.is_active,
      created_at: row.created_at,
      brand: row.brand || brandName || null
    };
    return jsonResponse({ ok: true, item }, 201, request);
  }

  async function apiActivateTarget(request, id) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

    const t = await dbGet(
      'select t.id, t.brand_id, t.product, b.name as brand from targets t left join brands b on b.id = t.brand_id where t.id = ?',
      id
    );
    if (!t) return jsonResponse({ error: 'Not found' }, 404, request);

    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }

    let maxActive = 3;
    if (t.brand_id != null) {
      const limitRow = await dbGet('select max_active from brand_limits where brand_id = ?', t.brand_id);
      if (limitRow && typeof limitRow.max_active === 'number') maxActive = limitRow.max_active;
    }
    const countRow = await dbGet(
      'select count(*) as c from targets where brand_id = ? and is_active = 1',
      t.brand_id
    );
    const activeCount = countRow ? countRow.c : 0;
    if (activeCount >= maxActive) {
      return jsonResponse(
        { error: 'Max active targets for brand reached', brand: t.brand, max: maxActive },
        400,
        request
      );
    }

    await dbRun(
      'update targets set is_active = 0 where brand_id = ? and product is ? and id != ?',
      t.brand_id,
      t.product,
      id
    );
    await dbRun('update targets set is_active = 1 where id = ?', id);
    return jsonResponse({ ok: true }, 200, request);
  }

  async function apiDeactivateTarget(request, id) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

    const t = await dbGet('select id, brand_id from targets where id = ?', id);
    if (!t) return jsonResponse({ error: 'Not found' }, 404, request);
    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, t.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }
    await dbRun('update targets set is_active = 0 where id = ?', id);
    return jsonResponse({ ok: true }, 200, request);
  }

  async function apiDeleteTarget(request, id) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!id)   return jsonResponse({ error: 'id required' }, 400, request);

    const row = await dbGet('select id, brand_id, mind_url, video_url, image_url from targets where id = ?', id);
    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);
    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, row.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }

    await dbRun('delete from targets where id = ?', id);

    const assets = [row.mind_url, row.video_url, row.image_url].filter(Boolean);
    const results = [];
    for (const u of assets) {
      try {
        const key = keyFromPublicUrl(u);
        await ASSETS_BUCKET.delete(key);
        results.push({ url: u, ok: true });
      } catch (e) {
        results.push({ url: u, ok: false, error: String(e) });
      }
    }
    return jsonResponse({ ok: true, deleteResults: results }, 200, request);
  }

  // POST /api/targets/:id/video — replaces the video on an existing target directly
  // (admin, or the brand that owns it) without re-uploading the marker image/.mind. Bumps
  // version/updated_at the same way apiUploadProductVideo does, so the viewer's "V3 ·
  // updated 12 Aug" footer and any product page pointed at this target pick it up.
  async function apiUploadTargetVideo(request, id) {
    if (!id) return jsonResponse({ error: 'id required' }, 400, request);
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!isPrivilegedRole(sess.user.role)) return jsonResponse({ error: 'Forbidden' }, 403, request);

    const target = await dbGet('select id, brand_id, video_url from targets where id = ?', id);
    if (!target) return jsonResponse({ error: 'Not found' }, 404, request);
    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, target.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }

    const upload = await storeVideoUpload(request, 'target-video-upload', (filename) => `videos/${id}/${Date.now()}-${filename}`);
    if (upload.error) return upload.error;
    const { videoUrl } = upload;

    await setTargetVideo(id, videoUrl);

    if (target.video_url && target.video_url !== videoUrl) {
      try { await ASSETS_BUCKET.delete(keyFromPublicUrl(target.video_url)); } catch {}
    }

    return jsonResponse({ ok: true, video_url: videoUrl }, 200, request);
  }

  // ---------- Brand Design Submissions ----------
  // A brand sends a raw design image here — no product exists yet. Admin reviews the queue
  // (GET as admin returns everyone's submissions), builds the real product around it
  // (Printful link, price, AR marker compiled from the image, via the normal admin
  // target/product flows) and assigns the finished product to the brand via products.brand_id.
  // No status/product_id tracking column: admin just deletes the entry once it's been built.

  async function apiListBrandDesigns(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    const role = sess.user.role;
    if (!isPrivilegedRole(role)) return jsonResponse({ error: 'Forbidden' }, 403, request);

    const url = new URL(request.url);
    const brandName = (url.searchParams.get('brand') || '').trim();

    let sql = `
      select d.id, d.name, d.note, d.image_url, d.created_at,
             u.email as submitted_by, b.name as brand
      from brand_designs d
      left join users u on u.id = d.user_id
      left join brands b on b.id = d.brand_id
    `;
    const where = [];
    const params = [];

    if (role === 'brand') {
      const brandIds = sessionBrandIds(sess);
      if (!brandIds.length) return jsonResponse({ items: [] }, 200, request);
      where.push(`d.brand_id in (${brandIds.map(() => '?').join(',')})`);
      params.push(...brandIds);
    }
    if (brandName) { where.push('lower(b.name) = lower(?)'); params.push(brandName); }

    if (where.length) sql += ' where ' + where.join(' and ');
    sql += ' order by d.created_at desc';

    const rows = await dbAll(sql, ...params);
    const items = rows.map(r => ({
      id: r.id,
      name: r.name,
      note: r.note,
      image_url: r.image_url,
      created_at: r.created_at,
      submitted_by: r.submitted_by || null,
      brand: r.brand || null,
    }));
    return jsonResponse({ items }, 200, request);
  }

  async function apiCreateBrandDesign(request) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (sess.user.role !== 'brand') return jsonResponse({ error: 'Forbidden' }, 403, request);

    const brands = sess.user.brands || [];
    if (!brands.length) return jsonResponse({ error: 'Brand account has no brand assigned' }, 400, request);
    const brandId = brands[0].id;

    const body = await readJson(request);
    const name = (body.name || '').trim() || null;
    const note = (body.note || '').trim() || null;
    const imageUrl = (body.image_url || '').trim();
    if (!imageUrl) return jsonResponse({ error: 'image_url required' }, 400, request);

    const { lastRowId } = await dbRun(
      'insert into brand_designs (brand_id, user_id, name, note, image_url) values (?, ?, ?, ?, ?)',
      brandId, sess.user.id, name, note, imageUrl
    );

    const row = await dbGet(
      'select id, name, note, image_url, created_at from brand_designs where id = ?',
      lastRowId
    );
    return jsonResponse({ ok: true, item: row }, 201, request);
  }

  async function apiDeleteBrandDesign(request, id) {
    const sess = await getSessionUser(request);
    if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!id) return jsonResponse({ error: 'id required' }, 400, request);

    const row = await dbGet('select id, brand_id, image_url from brand_designs where id = ?', id);
    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);

    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, row.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    } else if (sess.user.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403, request);
    }

    await dbRun('delete from brand_designs where id = ?', id);

    if (row.image_url) {
      try { await ASSETS_BUCKET.delete(keyFromPublicUrl(row.image_url)); } catch {}
    }

    return jsonResponse({ ok: true }, 200, request);
  }

  // ---------- Viewer API ----------

  async function apiViewerActive(request) {
    const url = new URL(request.url);
    const brand   = (url.searchParams.get('brand') || '').trim();
    const product = (url.searchParams.get('product') || '').trim();
    const targetId = (url.searchParams.get('target') || '').trim();

    // ?target=<id> pins one exact target. Without it, targets that share the same scope (no
    // product — e.g. several unscoped targets, or a brand's up-to-3 active ones) all resolve to
    // the same "newest" row below, so every older target's QR loads the wrong .mind and never
    // detects. Still requires is_active so Deactivate keeps working as an off switch.
    if (targetId) {
      if (!/^\d+$/.test(targetId)) return jsonResponse({ error: 'Invalid target' }, 400, request);
      const row = await dbGet(
        `select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
                t.is_active, t.version, t.created_at, t.updated_at, b.name as brand
         from targets t
         left join brands b on b.id = t.brand_id
         where t.id = ? and t.is_active = 1`,
        Number(targetId)
      );
      if (!row) return jsonResponse({ error: 'No active target found' }, 404, request);
      return withCache(
        jsonResponse({
          id: row.id,
          name: row.name,
          product: row.product,
          brand: row.brand || null,
          mindurl: row.mind_url,
          videourl: row.video_url,
          imageurl: row.image_url,
          is_active: !!row.is_active,
          version: row.version || 1,
          updated_at: row.updated_at || row.created_at,
          created_at: row.created_at,
          source: 'target_id'
        }, 200, request),
        'public, max-age=30, s-maxage=60'
      );
    }

    // Step 12 integration: if a product slug is provided, prefer the catalog link
    // (products.ar_target_id) so ecommerce can drive AR without duplicating product
    // strings into targets.
    if (product) {
      try {
        // Product and its linked target in one read (was two sequential queries).
        let psql = `
          select p.slug, p.title, p.price_cents, p.currency,
                 t.id, t.name, t.mind_url, t.video_url, t.image_url, t.is_active, t.version,
                 t.created_at, t.updated_at, tb.name as brand
          from products p
          left join brands b on b.id = p.brand_id
          join targets t on t.id = p.ar_target_id
          left join brands tb on tb.id = t.brand_id
          where lower(p.slug) = lower(?)
            and p.is_published = 1
            and t.is_active = 1
        `;
        const pparams = [product];
        if (brand) {
          psql += ' and lower(b.name) = lower(?)';
          pparams.push(brand);
        }
        psql += ' limit 1';

        const t = await dbGet(psql, ...pparams);
        if (t) {
          return withCache(
            jsonResponse({
              id: t.id,
              name: t.name,
              product: t.slug,
              product_title: t.title || null,
              price_cents: t.price_cents != null ? t.price_cents : null,
              currency: t.currency || null,
              brand: t.brand || null,
              mindurl: t.mind_url,
              videourl: t.video_url,
              imageurl: t.image_url,
              is_active: !!t.is_active,
              version: t.version || 1,
              updated_at: t.updated_at || t.created_at,
              created_at: t.created_at,
              source: 'product_link'
            }, 200, request),
            'public, max-age=30, s-maxage=60'
          );
        }
      } catch (e) {
        // If products table isn't present yet (or any other issue), fall back to legacy.
        console.warn('viewer active: product link lookup failed; falling back', e);
      }
    }

    let sql = `
      select t.id, t.name, t.product, t.mind_url, t.video_url, t.image_url,
            t.is_active, t.version, t.created_at, t.updated_at, b.name as brand
      from targets t
      left join brands b on b.id = t.brand_id
      where t.is_active = 1
    `;
    const where = [];
    const params = [];

    if (brand)   { where.push('lower(b.name) = lower(?)');    params.push(brand);   }
    if (product) { where.push('lower(t.product) = lower(?)'); params.push(product); }

    if (!brand && !product) {
      where.push('t.brand_id is null');
      where.push('t.product is null');
    }
    if (where.length) sql += ' and ' + where.join(' and ');
    sql += ' order by t.created_at desc limit 1';

    const row = await dbGet(sql, ...params);
    if (!row) return jsonResponse({ error: 'No active target found' }, 404, request);

    return withCache(
      jsonResponse({
        id: row.id,
        name: row.name,
        product: row.product,
        brand: row.brand || null,
        mindurl: row.mind_url,
        videourl: row.video_url,
        imageurl: row.image_url,
        is_active: !!row.is_active,
        version: row.version || 1,
        updated_at: row.updated_at || row.created_at,
        created_at: row.created_at,
        source: 'targets_active'
      }, 200, request),
      'public, max-age=30, s-maxage=60'
    );
  }

  // GET /api/viewer/order?order=&item= — resolves a customer's personal AR link (the
  // unique link/QR they attach to their own shirt). Public, no session required: this is a
  // capability URL — anyone scanning the physical shirt needs to see the AR content without
  // logging in, and the response carries no PII (same shape apiViewerActive already exposes
  // publicly). The marker/target stays whatever the product is linked to (shared across
  // every buyer); only the video can be personal, falling back to the target's own default
  // video if this customer hasn't uploaded one yet, so a freshly-printed QR still works.
  //
  // Deliberately does NOT require products.is_published or targets.is_active, unlike
  // apiViewerActive above — a customer's already-printed shirt shouldn't stop working just
  // because the product was later unpublished or the admin toggled an unrelated flag that
  // exists to control the general catalog-browsing resolution.
  async function apiViewerOrder(request) {
    const url = new URL(request.url);
    const orderId = (url.searchParams.get('order') || '').trim();
    const itemIndex = parseInt(url.searchParams.get('item'), 10);
    if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return jsonResponse({ error: 'order and item required' }, 400, request);
    }

    const order = await dbGet('select id, items_json from orders where id = ?', orderId);
    if (!order) return jsonResponse({ error: 'Not found' }, 404, request);

    let items = [];
    try { items = JSON.parse(order.items_json) || []; } catch {}
    if (itemIndex >= items.length) return jsonResponse({ error: 'Not found' }, 404, request);

    const slug = String((items[itemIndex] && items[itemIndex].slug) || '').trim();
    if (!slug) return jsonResponse({ error: 'No AR content for this item' }, 404, request);

    // Product, its target and this item's personal video in one read (was three queries).
    // Personal per-order videos only apply to house (non-brand) products — a brand product's
    // marker always plays the one shared video the brand uploaded, same as every other buyer.
    const row = await dbGet(
      `select p.title, p.price_cents, p.currency,
              t.id, t.name, t.mind_url, t.video_url, t.image_url, t.is_active, t.version, t.created_at, t.updated_at,
              coalesce(
                (select l.video_url from garment_layers l
                   join garment_units u on u.id = l.unit_id
                  where u.order_id = ? and u.item_index = ? and u.unit_index = 0
                  order by l.version desc limit 1),
                (select v.video_url from order_ar_videos v
                  where v.order_id = ? and v.item_index = ? and p.brand_id is null)
              ) as personal_video_url
       from products p
       join targets t on t.id = p.ar_target_id
       where lower(p.slug) = lower(?)`,
      orderId, itemIndex, orderId, itemIndex, slug
    );
    if (!row) return jsonResponse({ error: 'No AR content for this item' }, 404, request);

    return withCache(
      jsonResponse({
        id: row.id,
        name: row.name,
        product: slug,
        product_title: row.title || null,
        price_cents: row.price_cents != null ? row.price_cents : null,
        currency: row.currency || null,
        brand: null,
        mindurl: row.mind_url,
        videourl: row.personal_video_url || row.video_url,
        imageurl: row.image_url,
        is_active: !!row.is_active,
        version: row.version || 1,
        updated_at: row.updated_at || row.created_at,
        created_at: null,
        source: 'order_personal'
      }, 200, request),
      'no-store'
    );
  }

  // ---------- Wardrobe (garment units) ----------

  function ownsGarmentUnit(sess, unit) {
    return !!(sess && sess.user && unit.owner_user_id != null && String(sess.user.id) === String(unit.owner_user_id));
  }

  // GET /api/pieces — the logged-in customer's own wardrobe: every piece they've claimed,
  // with its product info, whether it has a published layer yet, and its scan count.
  async function apiListMyPieces(request) {
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const units = await dbAll(
      `select u.id, u.claim_code, u.nickname, u.claimed_at, u.scan_count, u.last_scanned_at,
              p.id as product_id, p.title as product_title, p.slug as product_slug, p.image_url as product_image,
              (select max(version) from garment_layers where unit_id = u.id) as version
       from garment_units u
       join products p on p.id = u.product_id
       where u.owner_user_id = ?
       order by u.claimed_at desc`,
      sess.user.id
    );

    const items = units.map(u => ({
      id: u.id,
      claim_code: u.claim_code,
      nickname: u.nickname,
      claimed_at: u.claimed_at,
      scan_count: u.scan_count,
      last_scanned_at: u.last_scanned_at,
      product: { id: u.product_id, title: u.product_title, slug: u.product_slug, image_url: u.product_image },
      version: u.version || 0,
      is_published: !!u.version,
    }));

    return jsonResponse({ items }, 200, request);
  }

  // GET /api/pieces/:id — one owned piece, with its full layer history (newest first).
  async function apiGetPiece(request, id) {
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const unit = await dbGet(
      `select u.*, p.title as product_title, p.slug as product_slug, p.image_url as product_image
       from garment_units u join products p on p.id = u.product_id where u.id = ?`,
      id
    );
    if (!unit || !ownsGarmentUnit(sess, unit)) return jsonResponse({ error: 'Not found' }, 404, request);

    const layers = await dbAll('select id, video_url, version, label, created_at from garment_layers where unit_id = ? order by version desc', id);

    return jsonResponse({
      id: unit.id,
      claim_code: unit.claim_code,
      nickname: unit.nickname,
      claimed_at: unit.claimed_at,
      scan_count: unit.scan_count,
      last_scanned_at: unit.last_scanned_at,
      product: { id: unit.product_id, title: unit.product_title, slug: unit.product_slug, image_url: unit.product_image },
      layers,
      current_layer: layers[0] || null,
      qr_url: unit.qr_url || null,
      viewer_url: pieceLink(publicSiteBase(request), unit.claim_code),
    }, 200, request);
  }

  // PATCH /api/pieces/:id — body {nickname}. The only thing about a unit itself (not its
  // layer) an owner can edit.
  async function apiUpdatePiece(request, id) {
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const unit = await dbGet('select id, owner_user_id from garment_units where id = ?', id);
    if (!unit || !ownsGarmentUnit(sess, unit)) return jsonResponse({ error: 'Not found' }, 404, request);

    const body = await readJson(request);
    if (body.nickname === undefined) return jsonResponse({ error: 'Nothing to update' }, 400, request);
    const nickname = String(body.nickname || '').trim().slice(0, 120) || null;
    await dbRun('update garment_units set nickname = ? where id = ?', nickname, id);
    return jsonResponse({ ok: true }, 200, request);
  }

  // POST /api/pieces/:id/layer — the owner replaces what their piece plays. Always inserts a
  // new version rather than overwriting in place, so the piece's history (and "this one has
  // changed twice" type framing) stays real — the previous video is left in R2 rather than
  // deleted, unlike the order-video upload path.
  async function apiUploadPieceLayer(request, id) {
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const unit = await dbGet('select id, owner_user_id from garment_units where id = ?', id);
    if (!unit || !ownsGarmentUnit(sess, unit)) return jsonResponse({ error: 'Not found' }, 404, request);

    const prev = await dbGet('select max(version) as v from garment_layers where unit_id = ?', id);
    const nextVersion = ((prev && prev.v) || 0) + 1;

    const upload = await storeVideoUpload(request, 'piece-layer-upload', (filename) => `piece-layers/${id}/${nextVersion}-${Date.now()}-${filename}`);
    if (upload.error) return upload.error;
    const { videoUrl, form } = upload;

    const label = String(form.get('label') || '').trim().slice(0, 80) || null;
    await dbRun('insert into garment_layers (unit_id, video_url, version, label) values (?, ?, ?, ?)', id, videoUrl, nextVersion, label);

    return jsonResponse({ ok: true, video_url: videoUrl, version: nextVersion, label }, 200, request);
  }

  // GET /api/viewer/piece?code=<claim_code> — resolves what a specific claimed physical
  // garment plays right now. The marker/target stays whatever the product is linked to
  // (shared across every unit of that product); only the video is this unit's current layer,
  // falling back to the target's own default video if the owner hasn't published one yet.
  // Public, no session required — same reasoning as apiViewerOrder above: a printed QR on
  // someone's actual shirt has to work for anyone scanning it.
  async function apiViewerPiece(request, ctx) {
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return jsonResponse({ error: 'code required' }, 400, request);

    // One read for everything a scan needs: the unit, its product, the product's target and
    // the unit's newest layer (was four sequential queries — this runs on every scan).
    const row = await dbGet(
      `select u.id as unit_id, p.slug, p.title, p.price_cents, p.currency,
              t.id as target_id, t.name, t.mind_url, t.video_url, t.image_url, t.is_active,
              l.video_url as layer_video_url, l.version as layer_version, l.created_at as layer_created_at
       from garment_units u
       join products p on p.id = u.product_id
       left join targets t on t.id = p.ar_target_id
       left join garment_layers l
         on l.id = (select id from garment_layers where unit_id = u.id order by version desc limit 1)
       where u.claim_code = ?`,
      code
    );
    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);
    if (row.target_id == null) return jsonResponse({ error: 'No AR content for this piece' }, 404, request);

    // Scan counting is best-effort and off the response path — never delay or fail actual
    // AR playback over it.
    const countScan = dbRun(
      `update garment_units set scan_count = scan_count + 1, last_scanned_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id = ?`,
      row.unit_id
    ).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(countScan);
    else await countScan;

    return withCache(
      jsonResponse({
        id: row.target_id,
        name: row.name,
        product: row.slug || null,
        product_title: row.title || null,
        price_cents: row.price_cents != null ? row.price_cents : null,
        currency: row.currency || null,
        brand: null,
        mindurl: row.mind_url,
        videourl: row.layer_video_url || row.video_url,
        imageurl: row.image_url,
        is_active: !!row.is_active,
        version: row.layer_version || 1,
        updated_at: row.layer_created_at || null,
        created_at: null,
        source: 'piece',
      }, 200, request),
      'no-store'
    );
  }

  // ---------- Existing R2 handlers (unchanged from your current worker) ----------

  // Serves an R2 object with HTTP byte-range support.
  //
  // This is what makes video play on iOS. Safari on iOS will not play a video
  // unless the server honours byte ranges: its first request for a media URL is
  // typically `Range: bytes=0-1` to probe, and if the server answers 200 with
  // the whole body instead of 206, iOS refuses to play the file at all — no
  // error the page can see, it simply never becomes playable. Android Chrome
  // does not care and plays a plain 200 response happily, which is why this
  // only ever showed up on iPhone. Seeking also depends on it.
  async function serveR2Object(request, key, corsOrigin) {
    if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.get !== 'function') {
      return new Response('R2 binding missing', { status: 500 });
    }
    if (!key) return new Response('Not Found', { status: 404 });

    const rangeHeader = request.headers.get('Range');

    let obj;
    try {
      // Passing the request headers lets R2 parse and resolve the range itself.
      obj = rangeHeader
        ? await ASSETS_BUCKET.get(key, { range: request.headers })
        : await ASSETS_BUCKET.get(key);
    } catch (e) {
      // An unsatisfiable range throws — answer per RFC 9110 so the player can
      // recover instead of treating it as a hard media error.
      const head = await ASSETS_BUCKET.head(key).catch(() => null);
      if (head) {
        const h = new Headers();
        h.set('Content-Range', `bytes */${head.size}`);
        h.set('Accept-Ranges', 'bytes');
        if (corsOrigin) h.set('Access-Control-Allow-Origin', corsOrigin);
        return new Response(null, { status: 416, headers: h });
      }
      return new Response('Not Found', { status: 404 });
    }

    if (!obj) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    const ct = (obj.httpMetadata && obj.httpMetadata.contentType) ||
               (obj.customMetadata && obj.customMetadata.contentType) ||
               'application/octet-stream';
    headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Must be advertised on the full response too — this is the signal that
    // tells Safari it may range-request and seek at all.
    headers.set('Accept-Ranges', 'bytes');
    if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
    if (corsOrigin) {
      headers.set('Access-Control-Allow-Origin', corsOrigin);
      // A cross-origin player can't read range metadata without this.
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
    }

    if (request.method === 'HEAD') {
      headers.set('Content-Length', String(obj.size));
      return new Response(null, { status: 200, headers });
    }

    if (rangeHeader && obj.range) {
      let offset, length;
      if (obj.range.suffix != null) {
        length = obj.range.suffix;
        offset = Math.max(0, obj.size - length);
      } else {
        offset = obj.range.offset || 0;
        length = obj.range.length != null ? obj.range.length : (obj.size - offset);
      }
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set('Content-Length', String(length));
      return new Response(obj.body, { status: 206, headers });
    }

    if (!obj.body) return new Response('Not Found', { status: 404 });
    headers.set('Content-Length', String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }

  async function handleR2Asset(request, key) {
    try {
      return await serveR2Object(request, key, '*');
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

  async function handleGet(request) {
    try {
      if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.get !== 'function') {
        return new Response(
          JSON.stringify({ error: 'R2 binding missing: ASSETS_BUCKET' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const url = new URL(request.url);
      let key = url.pathname.replace(/^\//, '');
      if (!key) return new Response('Not Found', { status: 404 });

      const allowed = getAllowedOrigins();
      const origin = request.headers.get('Origin');
      const corsOrigin = (allowed && origin && allowed.includes(origin)) ? origin : '*';

      // Byte-range aware — see serveR2Object. Videos are served from here too,
      // and iOS will not play one without range support.
      const res = await serveR2Object(request, key, corsOrigin);
      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key, Range');
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const UPLOAD_MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  const UPLOAD_ALLOWED_TYPES = ['image/', 'video/', 'application/octet-stream', 'model/'];
  const UPLOAD_ALLOWED_PATHS = ['videos', 'images', 'minds', 'products', 'homepage', 'banners', 'designs'];

  // Shared body of every video upload endpoint (target, product, order item, wardrobe
  // piece): per-IP rate limit, validate the multipart `file` as a video under
  // UPLOAD_MAX_SIZE, store it in R2 under keyFor(sanitizedFilename), and return its public
  // URL. Returns { error: Response } or { form, videoUrl } (form, for any extra fields).
  // Points a target at a new video and bumps its version/updated_at, so the viewer footer
  // ("V3 · updated 12 Aug") and product pages linked to it pick up the change.
  function setTargetVideo(targetId, videoUrl) {
    return dbRun(
      `update targets set video_url = ?, version = version + 1, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id = ?`,
      videoUrl, targetId
    );
  }

  async function storeVideoUpload(request, rateLimitKey, keyFor) {
    if (!rateLimitCheck(rateLimitKey + ':' + getClientIP(request), RATE_LIMIT_MAX_ORDER_AR_UPLOAD)) {
      return { error: jsonResponse({ error: 'Too many uploads. Please try again later.' }, 429, request) };
    }
    if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.put !== 'function') {
      return { error: jsonResponse({ error: 'R2 binding missing: ASSETS_BUCKET' }, 500, request) };
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file) return { error: jsonResponse({ error: 'file required' }, 400, request) };
    if (file.size && file.size > UPLOAD_MAX_SIZE) {
      return { error: jsonResponse({ error: 'File too large (max 50 MB)' }, 413, request) };
    }
    if (!String(file.type || '').toLowerCase().startsWith('video/')) {
      return { error: jsonResponse({ error: 'Only video files are allowed' }, 415, request) };
    }
    const filename = String(file.name || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const key = keyFor(filename);
    await ASSETS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'video/mp4' } });
    return { form, videoUrl: buildPublicAssetUrl(request, key) };
  }

  async function handleUpload(request) {
    try {
      // Auth: require admin or brand session
      const sess = await getSessionUser(request);
      if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
      if (sess.user.role !== 'admin' && sess.user.role !== 'brand') {
        return jsonResponse({ error: 'Forbidden' }, 403, request);
      }

      // Rate limit
      const ip = getClientIP(request);
      if (!rateLimitCheck('upload:' + ip, RATE_LIMIT_MAX_UPLOAD)) {
        return jsonResponse({ error: 'Too many uploads. Please try again later.' }, 429, request);
      }

      if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.put !== 'function') {
        return jsonResponse({ error: 'R2 binding missing: ASSETS_BUCKET' }, 500, request);
      }

      const form = await request.formData();
      const file = form.get('file');
      if (!file) return jsonResponse({ error: 'file required' }, 400, request);

      // File size check
      if (file.size && file.size > UPLOAD_MAX_SIZE) {
        return jsonResponse({ error: 'File too large (max 50 MB)' }, 413, request);
      }

      // File type validation
      const contentType = (file.type || 'application/octet-stream').toLowerCase();
      if (!UPLOAD_ALLOWED_TYPES.some(t => contentType.startsWith(t))) {
        return jsonResponse({ error: 'File type not allowed' }, 415, request);
      }

      // Sanitize path — only allow known subdirectories, strip traversal
      const rawPath = (form.get('path') || 'videos').toString().replace(/[\\/\.]{2,}/g, '').replace(/^[\/]+|[\/]+$/g, '');
      const path = UPLOAD_ALLOWED_PATHS.includes(rawPath) ? rawPath : 'images';
      const rawName = (form.get('filename') || (file.name || `${Date.now()}`)).toString();
      const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const key = `${path}/${Date.now()}-${filename}`;

      await ASSETS_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' }
      });

      // Route images through /api/r2/<key> — this path is always handled by the Worker
      // (via the /api/* Worker Route) regardless of how Cloudflare Pages routes are configured.
      // If ASSETS_DOMAIN is configured (e.g. an R2 public bucket), use it directly instead.
      const publicUrl = buildPublicAssetUrl(request, key);

      const headers = buildCorsHeaders(request);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, key, url: publicUrl }), { status: 200, headers });
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  async function apiGetOrder(request, id) {
    const rawId = String(id || '').trim();
    if (!rawId) return jsonResponse({ error: 'order id required' }, 400, request);

    const sess = await getSessionUser(request);
    const user = sess && sess.user ? sess.user : null;

    const row = await dbGet(
      `select id, user_id, email, first_name, last_name, address, city, country, state, zip,
              currency, total_cents, items_json, status, created_at,
              printful_order_id, printful_status, tracking_number, tracking_url, carrier, shipped_at
       from orders where id = ?`,
      rawId
    );

    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);

    // Authorization: admin/brand see all; clients must own the order
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (user.role !== 'admin' && user.role !== 'brand') {
      if (user.email !== row.email) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }

    let items = [];
    try { items = JSON.parse(row.items_json); } catch {}

    return jsonResponse({
      order: {
        id: row.id,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        address: row.address,
        city: row.city || null,
        country: row.country,
        state: row.state,
        zip: row.zip,
        currency: row.currency,
        total_cents: row.total_cents,
        items,
        status: row.status,
        created_at: row.created_at,
        printful_status:  row.printful_status  || null,
        tracking_number:  row.tracking_number  || null,
        tracking_url:     row.tracking_url     || null,
        carrier:          row.carrier          || null,
        shipped_at:       row.shipped_at       || null,
      }
    }, 200, request);
  }

  // GET /api/orders/:id/track?email=... — guest-safe order lookup by order id + the email
  // used at checkout. No login session required; the email match is the ownership proof
  // (the standard "track my order" pattern most guest-checkout shops use).
  async function apiGetOrderTrackPublic(request, id, email) {
    const rawId = String(id || '').trim();
    const rawEmail = String(email || '').trim().toLowerCase();
    if (!rawId || !rawEmail) return jsonResponse({ error: 'order id and email required' }, 400, request);

    const row = await dbGet(
      `select id, email, first_name, last_name, currency, total_cents, items_json, status, payment_status, created_at,
              printful_status, tracking_number, tracking_url, carrier, shipped_at
       from orders where id = ?`,
      rawId
    );

    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);
    if (String(row.email || '').trim().toLowerCase() !== rawEmail) {
      return jsonResponse({ error: 'Not found' }, 404, request);
    }

    let items = [];
    try { items = JSON.parse(row.items_json) || []; } catch {}

    return jsonResponse({
      order: {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        currency: row.currency || 'USD',
        total_cents: row.total_cents,
        items,
        status: row.status || null,
        payment_status: row.payment_status || null,
        created_at: row.created_at || null,
        printful_status:  row.printful_status  || null,
        tracking_number:  row.tracking_number  || null,
        tracking_url:     row.tracking_url     || null,
        carrier:          row.carrier          || null,
        shipped_at:       row.shipped_at       || null,
      }
    }, 200, request);
  }

  // Shared "does this session belong to the account that placed this order" check, used by
  // every customer self-service order action below. Endpoints that also accept a guest
  // email (POST body) check that half separately — this only covers the logged-in-session
  // half, since not every caller allows the email fallback.
  function sessionOwnsOrder(sess, orderRow) {
    return !!(sess && sess.user && orderRow.user_id != null && String(sess.user.id) === String(orderRow.user_id));
  }

  // POST /api/orders/:id/resume-payment — creates a fresh Stripe Checkout Session for an
  // order stuck at pending_payment (e.g. the customer closed the tab before finishing on
  // Stripe's page, or the original session expired). Ownership proven by either a logged-in
  // session matching the order's user_id, or a matching email (same trust model as /track).
  async function apiResumeOrderPayment(request, id) {
    const rawId = String(id || '').trim();
    if (!rawId) return jsonResponse({ error: 'order id required' }, 400, request);

    const body = await readJson(request);
    const emailIn = String(body.email || '').trim().toLowerCase();
    const siteUrl = String(body.site_url || new URL(request.url).origin).replace(/\/$/, '');

    const row = await dbGet(
      `select id, user_id, email, currency, total_cents, items_json, payment_status
       from orders where id = ?`,
      rawId
    );
    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);

    const sess = await getSessionUser(request);
    const ownsBySession = sessionOwnsOrder(sess, row);
    const ownsByEmail = !!(emailIn && String(row.email || '').trim().toLowerCase() === emailIn);
    if (!ownsBySession && !ownsByEmail) return jsonResponse({ error: 'Not found' }, 404, request);

    if (row.payment_status === 'paid') {
      return jsonResponse({ error: 'This order is already paid.' }, 400, request);
    }

    let items = [];
    try { items = JSON.parse(row.items_json) || []; } catch {}
    if (!items.length) return jsonResponse({ error: 'Order has no items' }, 400, request);

    const stConfig = Stripe.getStripeConfig(stripeEnv());
    if (!stConfig.secretKey) return jsonResponse({ error: 'STRIPE_SECRET_KEY not configured' }, 500, request);

    // Shipping was folded into total_cents at checkout; charge the same amount again so the
    // new session's amount_total still matches the order (the webhook rejects a mismatch).
    const currency = row.currency || 'USD';
    const itemsCents = items.reduce((sum, it) => sum + (Number(it.price_cents) || 0) * (Number(it.qty) || 0), 0);
    const shippingCents = Math.max(0, (Number(row.total_cents) || 0) - itemsCents);

    let session;
    try {
      session = await createOrderCheckoutSession({
        orderId: rawId, email: row.email, items, currency,
        shipping: { cents: shippingCents, name: 'Shipping' }, siteUrl,
      });
    } catch (e) {
      return jsonResponse({ error: `Payment session could not be created: ${String(e && e.message ? e.message : e)}` }, 502, request);
    }

    try {
      await dbRun(`update orders set stripe_session_id = ? where id = ?`, session.id, rawId);
    } catch (e) {
      return jsonResponse({ error: 'Could not link payment session to order', detail: String(e || '') }, 500, request);
    }

    return jsonResponse({ ok: true, checkout_url: session.url }, 200, request);
  }

  // POST /api/orders/:id/cancel — lets the customer cancel an order that never finished
  // payment (e.g. they changed their mind before returning to Stripe). Same ownership model
  // as resume-payment: a logged-in session matching the order's user_id, or a matching email.
  // Refuses to touch an order that's already paid — cancelling a paid/fulfilled order isn't
  // a self-serve action.
  async function apiCancelOrder(request, id) {
    const rawId = String(id || '').trim();
    if (!rawId) return jsonResponse({ error: 'order id required' }, 400, request);

    const body = await readJson(request);
    const emailIn = String(body.email || '').trim().toLowerCase();

    const row = await dbGet(
      `select id, user_id, email, status, payment_status from orders where id = ?`,
      rawId
    );
    if (!row) return jsonResponse({ error: 'Not found' }, 404, request);

    const sess = await getSessionUser(request);
    const ownsBySession = sessionOwnsOrder(sess, row);
    const ownsByEmail = !!(emailIn && String(row.email || '').trim().toLowerCase() === emailIn);
    if (!ownsBySession && !ownsByEmail) return jsonResponse({ error: 'Not found' }, 404, request);

    if (row.payment_status === 'paid') {
      return jsonResponse({ error: 'This order is already paid and cannot be cancelled here.' }, 400, request);
    }
    if (row.status === 'canceled') {
      return jsonResponse({ ok: true });
    }

    // "canceled" (one L) matches the admin dashboard's orders.status convention
    // (dashboard.html statusBadge/renderOrderStats); "cancelled" (two L's) matches
    // order-tracking.html's STATUS_LABELS, which is keyed on printful_status.
    await dbRun(
      `update orders set status = ?, printful_status = ? where id = ?`,
      'canceled', 'cancelled', rawId
    );

    return jsonResponse({ ok: true }, 200, request);
  }

  // POST /api/products/:id/video — lets a brand (or admin) upload/replace the AR video for a
  // product assigned to their brand. The marker/target itself (compiled by admin from the
  // brand's submitted design) is unchanged — this replaces the target's one shared video,
  // which is what every shirt of the product plays until its owner picks their own video.
  async function apiUploadProductVideo(request, productId) {
    if (!productId || !Number.isFinite(productId)) return jsonResponse({ error: 'Invalid product id' }, 400, request);

    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);
    if (!isPrivilegedRole(sess.user.role)) return jsonResponse({ error: 'Forbidden' }, 403, request);

    const product = await dbGet('select id, brand_id, ar_target_id from products where id = ?', productId);
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

    if (sess.user.role === 'brand') {
      if (!sessionOwnsBrand(sess, product.brand_id)) return jsonResponse({ error: 'Forbidden' }, 403, request);
    }
    if (product.ar_target_id == null) {
      return jsonResponse({ error: "Admin hasn't set up AR for this product yet" }, 400, request);
    }

    const target = await dbGet('select id, video_url from targets where id = ?', product.ar_target_id);
    if (!target) return jsonResponse({ error: "Admin hasn't set up AR for this product yet" }, 400, request);

    const upload = await storeVideoUpload(request, 'product-video-upload', (filename) => `product-videos/${productId}/${Date.now()}-${filename}`);
    if (upload.error) return upload.error;
    const { videoUrl } = upload;

    await setTargetVideo(target.id, videoUrl);

    if (target.video_url && target.video_url !== videoUrl) {
      try { await ASSETS_BUCKET.delete(keyFromPublicUrl(target.video_url)); } catch {}
    }

    return jsonResponse({ ok: true, video_url: videoUrl }, 200, request);
  }

  // GET /api/orders/mine — the logged-in customer's own order history, matched by the
  // account's own email (not user_id) — surfaces every order ever placed under that email,
  // including guest orders placed before the account existed, and reuses the exact lookup
  // shape apiGetOrderTrackPublic already relies on successfully.
  async function apiListMyOrders(request) {
    const sess = await getSessionUser(request);
    if (!sess || !sess.user) return jsonResponse({ error: 'Unauthorized' }, 401, request);

    const email = String(sess.user.email || '').trim().toLowerCase();
    const userId = sess.user.id;
    if (!email && !userId) return jsonResponse({ items: [] }, 200, request);

    // Match by account email OR by user_id — checkout records user_id for anyone logged
    // in at the time of purchase, even if they typed a different email into the checkout
    // form than the one on their account. Matching email alone missed those orders.
    const rows = await dbAll(
      `select id, status, payment_status, printful_status, tracking_number, tracking_url, carrier,
              total_cents, currency, items_json, created_at
       from orders where user_id = ? or lower(trim(email)) = ?
       order by created_at desc
       limit 100`,
      userId, email
    );

    const parsedRows = rows.map((r) => {
      let orderItems = [];
      try { orderItems = JSON.parse(r.items_json) || []; } catch {}
      return { row: r, orderItems };
    });

    // AR eligibility (does the item's product have a linked target?) and any personal video
    // already uploaded for it — batched across every order/item on this page rather than a
    // lookup per item, since a customer's order history can span many distinct products.
    const slugSet = new Set();
    for (const { orderItems } of parsedRows) {
      for (const it of orderItems) { if (it && it.slug) slugSet.add(String(it.slug).toLowerCase()); }
    }
    let arTargetBySlug = {};
    if (slugSet.size) {
      const slugs = Array.from(slugSet);
      const placeholders = slugs.map(() => '?').join(',');
      const prows = await dbAll(`select slug, ar_target_id, brand_id from products where lower(slug) in (${placeholders})`, ...slugs);
      for (const p of prows || []) {
        if (p.ar_target_id != null) {
          arTargetBySlug[String(p.slug).toLowerCase()] = { arTargetId: p.ar_target_id, brandId: p.brand_id };
        }
      }
    }
    const videoByOrderItem = {};
    if (parsedRows.length) {
      const orderIds = parsedRows.map(({ row }) => row.id);
      const placeholders = orderIds.map(() => '?').join(',');
      const vrows = await dbAll(`select order_id, item_index, video_url from order_ar_videos where order_id in (${placeholders})`, ...orderIds);
      for (const v of vrows) videoByOrderItem[`${v.order_id}|${v.item_index}`] = v.video_url;
    }

    const items = parsedRows.map(({ row: r, orderItems }) => {
      const mappedItems = orderItems.map((it, idx) => {
        const slug = it && it.slug ? String(it.slug) : null;
        const arInfo = slug ? arTargetBySlug[slug.toLowerCase()] : undefined;
        // Personal per-order video/QR is only offered for house (non-brand) products — a
        // brand product's marker always plays the one shared video the brand uploaded.
        return {
          name: it.name, qty: it.qty, price_cents: it.price_cents, image_url: it.image_url || null,
          slug, item_index: idx,
          ar_eligible: !!arInfo && arInfo.brandId == null,
          ar_video_url: videoByOrderItem[`${r.id}|${idx}`] || null,
        };
      });
      return {
        id: r.id,
        status: r.status || null,
        payment_status: r.payment_status || null,
        printful_status: r.printful_status || null,
        tracking_number: r.tracking_number || null,
        tracking_url: r.tracking_url || null,
        carrier: r.carrier || null,
        total_cents: r.total_cents,
        currency: r.currency || 'USD',
        created_at: r.created_at || null,
        items: mappedItems,
      };
    });

    return jsonResponse({ items }, 200, request);
  }

  async function apiPrintfulWebhookRegister(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    const apiKey = globalThis.PRINTFUL_API_KEY;
    const storeId = typeof PRINTFUL_STORE_ID === 'string' ? PRINTFUL_STORE_ID : '';
    if (!apiKey) return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);

    const secret = typeof PRINTFUL_WEBHOOK_SECRET === 'string' ? PRINTFUL_WEBHOOK_SECRET.trim() : '';
    if (!secret) {
      return jsonResponse({ error: 'PRINTFUL_WEBHOOK_SECRET not configured — set it before registering, the webhook rejects unauthenticated calls' }, 500, request);
    }

    const body = await readJson(request);
    // Accept the public site URL from the request body, or fall back to the request origin
    const siteUrl = (body && body.site_url)
      ? String(body.site_url).replace(/\/$/, '')
      : new URL(request.url).origin;
    const webhookUrl = `${siteUrl}/api/admin/printful/webhook?token=${encodeURIComponent(secret)}`;

    try {
      const qs = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
      // Printful v2 webhook configuration uses default_url + events[] payload.
      const pfBody = {
        default_url: webhookUrl,
        events: [
          { type: 'shipment_sent', url: webhookUrl },
          { type: 'order_updated', url: webhookUrl },
          { type: 'order_failed', url: webhookUrl },
          { type: 'product_synced', url: webhookUrl },
          { type: 'product_updated', url: webhookUrl },
          { type: 'product_deleted', url: webhookUrl },
        ],
      };
      await callPrintful('POST', `/webhooks${qs}`, pfBody);
      // Don't echo the token-bearing URL back to the browser.
      return jsonResponse({ ok: true, webhook_url: `${siteUrl}/api/admin/printful/webhook` }, 200, request);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  // GET /api/admin/printful/webhooks — verify whether expected webhook URL is currently registered.
  async function apiPrintfulWebhookHealth(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    const reqUrl = new URL(request.url);
    const siteUrl = String(reqUrl.searchParams.get('site_url') || reqUrl.origin).trim().replace(/\/$/, '');
    const expectedPrimaryUrl = `${siteUrl}/api/admin/printful/webhook`;
    const expectedLegacyUrl = `${siteUrl}/api/webhooks/printful`;

    function normalizeWebhookRows(rows) {
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      return list.map((w) => {
        // Registered URLs carry ?token=<secret> — compare (and report) without it.
        const webhookUrl = String((w && (w.url || w.callback_url || w.default_url)) || '').trim().split('?')[0].replace(/\/$/, '');
        const active = !(w && (w.is_deleted || w.deleted || w.disabled));
        const events = Array.isArray(w && w.events)
          ? w.events.map((evt) => (typeof evt === 'string' ? evt : (evt && evt.type) || evt)).filter(Boolean)
          : (Array.isArray(w && w.types) ? w.types : []);
        return {
          id: w && w.id != null ? w.id : null,
          url: webhookUrl,
          active,
          events,
        };
      });
    }

    function findExpectedWebhook(webhooks) {
      return webhooks.find((w) => w.url === expectedPrimaryUrl || w.url === expectedLegacyUrl) || null;
    }

    try {
      const qs = Printful.printfulStoreQuery(pfEnv);
      // Requirement: call Printful GET /webhooks. Keep this as primary check.
      const v1Data = await callPrintful('GET', `/webhooks${qs}`);
      const v1Raw = (v1Data && (v1Data.result ?? v1Data.data)) || null;
      const v1Rows = Array.isArray(v1Raw) ? v1Raw : (v1Raw ? [v1Raw] : []);
      const v1Webhooks = normalizeWebhookRows(v1Rows);
      let matched = findExpectedWebhook(v1Webhooks);

      // Some stores expose webhooks only through v2. Fall back to v2 if v1 has no match.
      if (!matched) {
        try {
          const v2Data = await callPrintful('GET', `/v2/webhooks${qs}`);
          const v2Raw = (v2Data && (v2Data.result ?? v2Data.data)) || null;
          const v2Rows = Array.isArray(v2Raw) ? v2Raw : (v2Raw ? [v2Raw] : []);
          const v2Webhooks = normalizeWebhookRows(v2Rows);
          matched = findExpectedWebhook(v2Webhooks);
          if (matched) {
            return jsonResponse({
              ok: true,
              active: !!matched.active,
              expected_webhook_url: expectedPrimaryUrl,
              expected_webhook_urls: [expectedPrimaryUrl, expectedLegacyUrl],
              matched_webhook: matched,
              webhooks_total: v2Webhooks.length,
              api_version: 'v2',
            }, 200, request);
          }
        } catch {}
      }

      return jsonResponse({
        ok: true,
        active: !!(matched && matched.active),
        expected_webhook_url: expectedPrimaryUrl,
        expected_webhook_urls: [expectedPrimaryUrl, expectedLegacyUrl],
        matched_webhook: matched,
        webhooks_total: v1Webhooks.length,
        api_version: 'v1',
      }, 200, request);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  // GET /api/admin/printful/products — local D1 products currently linked to Printful sync products.
  async function apiPrintfulListLinkedProducts(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const rows = await dbAll(
      `select p.id, p.title, p.slug, p.price_cents, p.currency, p.image_url, p.image_urls,
              p.printful_catalog_product_id, p.printful_sync_variant_id, p.printful_variant_map, p.printful_variant_cost_map,
              p.printful_sync_product_id, p.printful_sync_variant_map,
              p.ar_target_id, p.printful_qr, p.printful_design_images,
              p.updated_at, p.created_at, b.name as brand
       from products p
       left join brands b on b.id = p.brand_id
       where p.printful_variant_map is not null or p.printful_sync_variant_id is not null or p.printful_sync_variant_map is not null
       order by p.updated_at desc, p.created_at desc`
    );
    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      price_cents: Number(r.price_cents || 0),
      currency: r.currency || 'USD',
      image_url: r.image_url || null,
      image_urls: parseImageUrlsFromRow(r.image_urls),
      printful_catalog_product_id: r.printful_catalog_product_id || null,
      printful_sync_variant_id: r.printful_sync_variant_id || null,
      printful_variant_map: safeJsonParse(r.printful_variant_map),
      printful_variant_cost_map: safeJsonParse(r.printful_variant_cost_map),
      printful_sync_product_id: r.printful_sync_product_id || null,
      printful_sync_variant_map: safeJsonParse(r.printful_sync_variant_map),
      ar_target_id: r.ar_target_id == null ? null : Number(r.ar_target_id),
      printful_qr: parsePrintfulQr(r.printful_qr),
      printful_design_images: safeJsonParse(r.printful_design_images),
      brand: r.brand || null,
      updated_at: r.updated_at || null,
      created_at: r.created_at || null,
    }));

    return jsonResponse({ items }, 200, request);
  }

  // GET /api/admin/printful/catalog?search=<q> — browse real Printful catalog products.
  // v2's catalog is read-only; there is no "push"/"sync product" step in this model.
  async function apiPrintfulBrowseCatalog(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    const url = new URL(request.url);
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();

    let products;
    try {
      products = await Printful.listCatalogProducts(pfEnv);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }

    const items = (Array.isArray(products) ? products : [])
      .filter(p => !search || String((p && (p.name || p.title)) || '').toLowerCase().includes(search))
      .slice(0, 100)
      .map(p => ({
        id: p.id,
        name: p.name || p.title || `Product ${p.id}`,
        image: p.image || p.image_url || null,
        variant_count: Number(p.variant_count) || (Array.isArray(p.variants) ? p.variants.length : null),
      }));

    return jsonResponse({ items }, 200, request);
  }

  // GET /api/admin/printful/catalog/:id — full size/color variant grid for one catalog product.
  async function apiPrintfulGetCatalogProduct(request, catalogProductId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!catalogProductId || !Number.isFinite(catalogProductId)) {
      return jsonResponse({ error: 'Invalid catalog product id' }, 400, request);
    }

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    let product;
    try {
      product = await Printful.fetchCatalogProduct(pfEnv, catalogProductId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }
    if (!product) return jsonResponse({ error: 'Catalog product not found' }, 404, request);

    const variants = (Array.isArray(product.variants) ? product.variants : []).map(v => ({
      id: v.id,
      size: v.size || null,
      color: v.color || null,
      color_code: v.color_code || null,
      image: v.image || null,
      price: v.price || null,
    }));

    return jsonResponse({
      id: product.id,
      name: product.name || product.title || `Product ${product.id}`,
      image: product.image || product.image_url || null,
      variants,
    }, 200, request);
  }

  // GET /api/admin/printful/catalog/:id/placements — the real print placements a garment
  // supports (front/back/sleeves/label panels/etc.), each with its physical print-area size
  // and target DPI, straight from Printful's own mockup-styles data (same call
  // apiPrintfulCreateMockup already makes to resolve a style id) — lets the product-designer
  // canvas show an accurate print-area guide and DPI check instead of a generic dropzone.
  async function apiPrintfulGetCatalogPlacements(request, catalogProductId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!catalogProductId || !Number.isFinite(catalogProductId)) {
      return jsonResponse({ error: 'Invalid catalog product id' }, 400, request);
    }

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    let groups;
    try {
      groups = await Printful.listMockupStyles(pfEnv, catalogProductId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }

    const placements = (Array.isArray(groups) ? groups : [])
      .filter(g => g && g.placement && Array.isArray(g.mockup_styles) && g.mockup_styles.length)
      .map(g => ({
        placement: g.placement,
        display_name: g.display_name || g.placement,
        technique: g.technique || null,
        print_area_width: Number(g.print_area_width) || null,
        print_area_height: Number(g.print_area_height) || null,
        dpi: Number(g.dpi) || null,
      }));

    return jsonResponse({ placements }, 200, request);
  }

  // POST /api/admin/printful/products/:id/link — resolve {size: catalog_variant_id} for a
  // product against a real Printful catalog product and store it. No Printful write call at
  // all: v2 catalog products are read-only references, so there's nothing to "push".
  async function apiPrintfulLinkProduct(request, productId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!productId || !Number.isFinite(productId)) return jsonResponse({ error: 'Invalid product id' }, 400, request);

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    const product = await dbGet('select id, brand_id, title, sizes, color from products where id = ?', productId);
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

    const body = await readJson(request);
    const catalogProductId = Number(body.catalog_product_id);
    if (!Number.isFinite(catalogProductId) || catalogProductId <= 0) {
      return jsonResponse({ error: 'catalog_product_id required' }, 400, request);
    }
    const overrideMap = body.catalog_variant_ids && typeof body.catalog_variant_ids === 'object'
      ? body.catalog_variant_ids
      : null;

    const sizes = String(product.sizes || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!sizes.length) return jsonResponse({ error: 'Product has no sizes' }, 400, request);

    let catalogProduct;
    try {
      catalogProduct = await Printful.fetchCatalogProduct(pfEnv, catalogProductId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }
    if (!catalogProduct) return jsonResponse({ error: 'Catalog product not found' }, 404, request);

    const { resolved, missing } = Printful.resolveCatalogVariants(catalogProduct, sizes, product.color || '', overrideMap);

    const variantMap = {};
    const costMap = {};
    for (const r of resolved) {
      variantMap[r.size] = String(r.variant_id);
      if (r.price != null) costMap[r.size] = String(r.price);
    }
    const variantMapJson = Object.keys(variantMap).length ? JSON.stringify(variantMap) : null;
    const costMapJson = Object.keys(costMap).length ? JSON.stringify(costMap) : null;
    const firstVariant = resolved.length ? Number(resolved[0].variant_id) : null;

    await dbRun(
      `update products set printful_catalog_product_id = ?, printful_sync_variant_id = ?, printful_variant_map = ?,
              printful_variant_cost_map = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       where id = ?`,
      catalogProductId, firstVariant, variantMapJson, costMapJson, productId
    );

    return jsonResponse({ ok: true, printful_variant_map: variantMap, printful_variant_cost_map: costMap, missing }, 200, request);
  }

  // GET /api/admin/printful/sync-products — browse the admin's real Printful "Sync
  // Products", created directly on printful.com's own product designer rather than
  // through this dashboard (v1-only — see the Printful module's v1 section for why).
  async function apiPrintfulListSyncProducts(request) {
    const { error } = await requireAdminSession(request);
    if (error) return error;

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    const url = new URL(request.url);
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();

    let products;
    try {
      products = await Printful.listSyncProducts(pfEnv);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }

    const items = (Array.isArray(products) ? products : [])
      .filter(p => !search || String((p && p.name) || '').toLowerCase().includes(search))
      .slice(0, 100)
      .map(p => ({
        id: p.id,
        name: p.name || `Product ${p.id}`,
        thumbnail: p.thumbnail_url || null,
        variant_count: Number(p.variants) || null,
        synced_count: Number(p.synced) || null,
      }));

    return jsonResponse({ items }, 200, request);
  }

  // GET /api/admin/printful/sync-products/:id — full variant grid for one sync product,
  // for the linking picker to show sizes/colors/prices before confirming a link.
  async function apiPrintfulGetSyncProduct(request, syncProductId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!syncProductId || !Number.isFinite(syncProductId)) {
      return jsonResponse({ error: 'Invalid sync product id' }, 400, request);
    }

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    let product;
    try {
      product = await Printful.getSyncProduct(pfEnv, syncProductId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }
    if (!product) return jsonResponse({ error: 'Sync product not found' }, 404, request);

    const syncProductMeta = product.sync_product || {};
    const variants = Array.isArray(product.sync_variants) ? product.sync_variants : [];

    return jsonResponse({
      id: syncProductMeta.id ?? syncProductId,
      name: syncProductMeta.name || `Product ${syncProductId}`,
      thumbnail: syncProductMeta.thumbnail_url || null,
      variants: variants.map(v => ({
        id: v.id,
        size: v.size || null,
        color: v.color || null,
        price: v.retail_price || null,
        currency: v.currency || null,
      })),
    }, 200, request);
  }

  // POST /api/admin/printful/products/:id/link-sync — link a local product to a Printful
  // Sync Product. Unlike catalog linking, the print file is already attached to each sync
  // variant on Printful's side (the admin designed it there), so this also pulls
  // Printful's own already-rendered preview images into the product's storefront gallery
  // — nothing else in this dashboard needs to touch a design for a product linked this way.
  async function apiPrintfulLinkSyncProduct(request, productId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!productId || !Number.isFinite(productId)) return jsonResponse({ error: 'Invalid product id' }, 400, request);

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) {
      return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    }

    const product = await dbGet('select id, brand_id, title, sizes, color, price_cents, image_urls from products where id = ?', productId);
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);

    const body = await readJson(request);
    const syncProductId = Number(body.sync_product_id);
    if (!Number.isFinite(syncProductId) || syncProductId <= 0) {
      return jsonResponse({ error: 'sync_product_id required' }, 400, request);
    }
    const overrideMap = body.sync_variant_ids && typeof body.sync_variant_ids === 'object'
      ? body.sync_variant_ids
      : null;

    let syncProduct;
    try {
      syncProduct = await Printful.getSyncProduct(pfEnv, syncProductId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }
    if (!syncProduct) return jsonResponse({ error: 'Sync product not found' }, 404, request);
    const variants = Array.isArray(syncProduct.sync_variants) ? syncProduct.sync_variants : [];

    const existingSizes = String(product.sizes || '').split(',').map(s => s.trim()).filter(Boolean);

    // No sizes typed locally yet (the common case now that linking can happen before any
    // detail fields are filled in) — take every size Printful actually offers this sync
    // product, instead of requiring something local to match against first.
    let variantMap, missing, derivedSizes = null;
    if (existingSizes.length) {
      const resolvedRes = Printful.resolveSyncVariants(syncProduct, existingSizes, product.color || '', overrideMap);
      variantMap = {};
      for (const r of resolvedRes.resolved) variantMap[r.size] = String(r.sync_variant_id);
      missing = resolvedRes.missing;
    } else {
      variantMap = {};
      derivedSizes = [];
      for (const v of variants) {
        const size = String(v.size || '').trim();
        if (!size || variantMap[size]) continue;
        variantMap[size] = String(v.id);
        derivedSizes.push(size);
      }
      missing = [];
    }
    const variantMapJson = Object.keys(variantMap).length ? JSON.stringify(variantMap) : null;

    // Pull Printful's own already-rendered preview images into the storefront gallery —
    // the admin designed this on printful.com, no need to make them re-upload what
    // Printful already produced. Respects the existing 5-image cap; keeps any images
    // already on the product rather than replacing them outright.
    const previewUrls = [];
    for (const v of variants) {
      const files = Array.isArray(v.files) ? v.files : [];
      for (const f of files) {
        const url = f && (f.preview_url || f.thumbnail_url);
        if (url && !previewUrls.includes(url)) previewUrls.push(url);
      }
    }
    let existingImages = [];
    try { existingImages = product.image_urls ? JSON.parse(product.image_urls) : []; } catch {}
    if (!Array.isArray(existingImages)) existingImages = [];
    const mergedImages = [...existingImages];
    for (const url of previewUrls) {
      if (mergedImages.length >= 5) break;
      if (!mergedImages.includes(url)) mergedImages.push(url);
    }
    const imageUrlsJson = mergedImages.length ? JSON.stringify(mergedImages) : null;

    // "Necessary details" the admin hasn't set yet get pulled straight from Printful too —
    // linking before typing anything should leave as little as possible left to fill in.
    // Never overwrites a value the admin already typed, only fills in what's still blank.
    const syncProductMeta = syncProduct.sync_product || {};
    const currentTitle = String(product.title || '').trim();
    const titleUpdate = (!currentTitle || currentTitle === 'Untitled Product') && syncProductMeta.name
      ? String(syncProductMeta.name).trim()
      : null;
    const sizesUpdate = derivedSizes && derivedSizes.length ? derivedSizes.join(', ') : null;
    const colorUpdate = !String(product.color || '').trim() && variants.length && variants[0].color
      ? String(variants[0].color).trim()
      : null;
    const firstPrice = variants.length && variants[0].retail_price != null ? Number(variants[0].retail_price) : null;
    const priceUpdate = !(product.price_cents > 0) && Number.isFinite(firstPrice)
      ? Math.round(firstPrice * 100)
      : null;

    // Orders go to Printful as catalog items carrying our own art + QR layers, so the import
    // also records each size's catalog variant and copies the print files into R2.
    const catalogVariantMap = {};
    let catalogProductId = null;
    for (const v of variants) {
      const size = String(v.size || '').trim();
      const variantId = Number(v.variant_id || (v.product && v.product.variant_id));
      if (!catalogProductId && v.product && Number(v.product.product_id)) catalogProductId = Number(v.product.product_id);
      if (size && Number.isFinite(variantId) && variantId > 0 && !catalogVariantMap[size]) catalogVariantMap[size] = String(variantId);
    }
    const art = {};
    const artErrors = [];
    for (const v of variants) {
      for (const f of (Array.isArray(v.files) ? v.files : [])) {
        const type = String((f && f.type) || '').toLowerCase();
        if (!type || type === 'preview' || !f.url) continue;
        const placement = type === 'default' ? 'front' : type;
        if (art[placement] || !/^[a-z0-9_]{1,40}$/.test(placement)) continue;
        try {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const key = `products/${productId}/art-${placement}.png`;
          await ASSETS_BUCKET.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: res.headers.get('content-type') || 'image/png' } });
          art[placement] = buildPublicAssetUrl(request, key);
        } catch (e) {
          artErrors.push(`${placement}: ${String(e && e.message ? e.message : e)}`);
        }
      }
    }

    const setClauses = ['printful_sync_product_id = ?', 'printful_sync_variant_map = ?', 'image_urls = ?'];
    const params = [syncProductId, variantMapJson, imageUrlsJson];
    if (Object.keys(catalogVariantMap).length) { setClauses.push('printful_variant_map = ?'); params.push(JSON.stringify(catalogVariantMap)); }
    if (catalogProductId) { setClauses.push('printful_catalog_product_id = ?'); params.push(catalogProductId); }
    if (Object.keys(art).length) { setClauses.push('printful_design_images = ?'); params.push(JSON.stringify(art)); }
    if (titleUpdate) { setClauses.push('title = ?'); params.push(titleUpdate); }
    if (sizesUpdate) { setClauses.push('sizes = ?'); params.push(sizesUpdate); }
    if (colorUpdate) { setClauses.push('color = ?'); params.push(colorUpdate); }
    if (priceUpdate) { setClauses.push('price_cents = ?'); params.push(priceUpdate); }
    params.push(productId);

    await dbRun(
      `update products set ${setClauses.join(', ')}, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id = ?`,
      ...params
    );

    return jsonResponse({
      ok: true, printful_sync_variant_map: variantMap, missing, image_urls: mergedImages,
      printful_variant_map: catalogVariantMap, printful_catalog_product_id: catalogProductId,
      printful_design_images: art, art_errors: artErrors,
    }, 200, request);
  }

  // POST /api/admin/printful/products/:id/mockup — kicks off a real Printful mockup render
  // (the design printed onto an actual photo of the linked garment) for the product's
  // current design image. Requires the product to already be linked (printful_catalog_
  // product_id + printful_variant_map) — that's what supplies the catalog_product_id and
  // catalog_variant_ids the mockup task needs. Fire-and-poll: this only starts the task,
  // see apiPrintfulGetMockupTask for the result.
  async function apiPrintfulCreateMockup(request, productId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!productId || !Number.isFinite(productId)) return jsonResponse({ error: 'Invalid product id' }, 400, request);

    const product = await dbGet(
      'select id, brand_id, image_url, printful_catalog_product_id, printful_variant_map, printful_design_images, printful_qr from products where id = ?',
      productId
    );
    if (!product) return jsonResponse({ error: 'Not found' }, 404, request);
    if (!product.printful_catalog_product_id) {
      return jsonResponse({ error: 'Link this product to a Printful catalog garment first' }, 400, request);
    }

    const body = await readJson(request);
    // With QR settings (proposed in the body, or saved), preview the QR's placement with the
    // art plus a sample QR exactly where each shirt's own QR will print.
    const qr = body.qr !== undefined ? parsePrintfulQr(body.qr) : parsePrintfulQr(product.printful_qr);
    if (body.qr !== undefined && body.qr != null && !qr) {
      return jsonResponse({ error: 'QR settings need a placement, a size from 1 to 6 inches, and a position inside the print area' }, 400, request);
    }
    const requestedPlacement = (qr && qr.placement) || String(body.placement || 'front').trim().toLowerCase() || 'front';
    let designImages = {};
    try { designImages = product.printful_design_images ? JSON.parse(product.printful_design_images) : {}; } catch {}
    const imageUrl = clampStr(body.image_url, 800) || designImages[requestedPlacement] ||
      (requestedPlacement === 'front' ? product.image_url : '');
    if (!imageUrl && !qr) return jsonResponse({ error: 'This product has no design image to preview' }, 400, request);

    const layers = imageUrl ? [{ type: 'file', url: imageUrl }] : [];
    if (qr) {
      const sample = await QR.qrPng(pieceLink(publicSiteBase(request), 'SAMP-LE00'), qr.size_in);
      const sampleKey = `qr/sample-${sample.pixels}.png`;
      await ASSETS_BUCKET.put(sampleKey, sample.png, { httpMetadata: { contentType: 'image/png' } });
      layers.push(qrPrintLayer(qr, buildPublicAssetUrl(request, sampleKey), sample.sizeIn).layer);
    }

    let variantMap = {};
    try { variantMap = product.printful_variant_map ? JSON.parse(product.printful_variant_map) : {}; } catch {}
    const catalogVariantIds = Object.values(variantMap).map(v => Number(v)).filter(Number.isFinite);
    if (!catalogVariantIds.length) return jsonResponse({ error: 'No linked Printful variants to preview' }, 400, request);

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);

    let styleId, placement, technique;
    try {
      // Printful's documented response shape for this endpoint has been wrong twice
      // already (first assumed flat, then assumed grouped-by-placement with a nested
      // mockup_styles[]) — call it raw here instead of going through listMockupStyles'
      // unwrapping, so a resolution failure can report exactly what came back instead of
      // guessing a third shape blind.
      const raw = await Printful.callPrintful(pfEnv, 'GET', `/catalog-products/${Number(product.printful_catalog_product_id)}/mockup-styles`);
      const placementGroups = (raw && (raw.data ?? raw.result)) || [];
      const list = Array.isArray(placementGroups) ? placementGroups : [];
      const matchedGroup = list.find(g => String(g && g.placement || '').toLowerCase() === requestedPlacement);
      if (!matchedGroup) {
        const available = list.map(g => g && g.placement).filter(Boolean).join(', ') || 'none';
        return jsonResponse({ error: `This garment doesn't support a '${requestedPlacement}' print placement. Available: ${available}.` }, 400, request);
      }
      const styles = Array.isArray(matchedGroup.mockup_styles) ? matchedGroup.mockup_styles : [];
      if (!styles.length || styles[0].id == null) {
        // Fold the raw response into the error message itself (not a separate field) —
        // the dashboard's apiFetch() only ever surfaces `error`, so this is the only way
        // the actual shape reaches the UI instead of getting silently dropped.
        const rawStr = JSON.stringify(raw).slice(0, 900);
        return jsonResponse({ error: `No mockup styles available for this garment. Raw response: ${rawStr}` }, 502, request);
      }
      styleId = styles[0].id;
      placement = matchedGroup.placement || requestedPlacement;
      technique = matchedGroup.technique || 'dtg';
    } catch (e) {
      return jsonResponse({ error: `Could not load mockup styles: ${String(e && e.message ? e.message : e)}` }, 502, request);
    }

    let rawTask;
    try {
      // One representative variant is enough for a design preview — this isn't generating
      // a mockup per size, just showing what the print looks like on the garment.
      rawTask = await Printful.createMockupTaskRaw(pfEnv, {
        catalogProductId: product.printful_catalog_product_id,
        catalogVariantIds: catalogVariantIds.slice(0, 1),
        mockupStyleIds: [styleId],
        placement,
        technique,
        layers,
      });
    } catch (e) {
      return jsonResponse({ error: `Mockup generation failed: ${String(e && e.message ? e.message : e)}` }, 502, request);
    }

    // The request body sends products as an array — try both an unwrapped single object
    // and an array-of-one for the response, same uncertainty as the mockup-styles shape.
    const candidates = [
      rawTask,
      rawTask && rawTask.data,
      rawTask && rawTask.result,
      rawTask && Array.isArray(rawTask.data) ? rawTask.data[0] : null,
      rawTask && Array.isArray(rawTask.result) ? rawTask.result[0] : null,
      Array.isArray(rawTask) ? rawTask[0] : null,
    ];
    const task = candidates.find(t => t && t.id != null);

    if (!task) {
      const rawStr = JSON.stringify(rawTask).slice(0, 900);
      return jsonResponse({ error: `Printful did not return a mockup task id. Raw response: ${rawStr}` }, 502, request);
    }
    return jsonResponse({ ok: true, task_id: task.id, status: task.status || 'pending' }, 200, request);
  }

  // GET /api/admin/printful/mockup-tasks/:taskId — poll a task started by apiPrintfulCreateMockup.
  // NOTE: Printful's v2-beta docs don't fully document the shape of a completed task's
  // catalog_variant_mockups entries, so this parses defensively across a few plausible
  // field names rather than assuming one exact shape.
  async function apiPrintfulGetMockupTask(request, taskId) {
    const { error } = await requirePrivilegedSession(request);
    if (error) return error;
    if (!taskId) return jsonResponse({ error: 'task id required' }, 400, request);

    const pfEnv = printfulEnv();
    if (!Printful.getPrintfulConfig(pfEnv).apiKey) return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);

    let rawTask;
    try {
      rawTask = await Printful.getMockupTaskRaw(pfEnv, taskId);
    } catch (e) {
      return jsonResponse({ error: String(e && e.message ? e.message : e) }, 502, request);
    }
    if (!rawTask) return jsonResponse({ error: 'Not found' }, 404, request);

    const candidates = [
      rawTask,
      rawTask.data,
      rawTask.result,
      Array.isArray(rawTask.data) ? rawTask.data[0] : null,
      Array.isArray(rawTask.result) ? rawTask.result[0] : null,
      Array.isArray(rawTask) ? rawTask[0] : null,
    ];
    const task = candidates.find(t => t && (t.id != null || t.status != null)) || rawTask;

    const mockups = Array.isArray(task.catalog_variant_mockups) ? task.catalog_variant_mockups : [];
    const imageUrls = [];
    for (const m of mockups) {
      // Cast a wide net: nested per-variant "mockups" array, or the entry itself carrying
      // the url directly — same shape uncertainty as everywhere else in this feature.
      const nested = Array.isArray(m && m.mockups) ? m.mockups : (m ? [m] : []);
      for (const n of nested) {
        const url = n && (n.mockup_url || n.url || n.image_url || n.preview_url);
        if (url) imageUrls.push(url);
      }
    }

    const statusStr = String(task.status || '').toLowerCase();
    const stillWorking = !statusStr || statusStr.includes('pend') || statusStr.includes('process');
    const debugRaw = (!imageUrls.length && !stillWorking) ? JSON.stringify(rawTask).slice(0, 900) : null;

    return jsonResponse({
      ok: true,
      status: task.status || 'unknown',
      image_urls: imageUrls,
      failure_reasons: Array.isArray(task.failure_reasons) ? task.failure_reasons : [],
      debug_raw_response: debugRaw,
    }, 200, request);
  }

  async function apiPrintfulOrderSync(request, printfulOrderId) {
    const { error } = await requireAdminSession(request);
    if (error) return error;
    if (!printfulOrderId) return jsonResponse({ error: 'printful_order_id required' }, 400, request);
    const apiKey = globalThis.PRINTFUL_API_KEY;
    const storeId = typeof PRINTFUL_STORE_ID === 'string' ? PRINTFUL_STORE_ID : '';
    if (!apiKey) return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    try {
      const qs = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
      const data = await callPrintful('GET', `/v2/orders/${encodeURIComponent(printfulOrderId)}${qs}`);
      const pfOrd = (data && data.result) || (data && data.data) || data || {};
      const status = pfOrd.status || null;
      const shipments = pfOrd.shipments || [];
      const ship = shipments[0] || {};
      await dbRun(
        `update orders set printful_status = ?, tracking_number = ?, tracking_url = ?, carrier = ?
         where printful_order_id = ?`,
        status || 'unknown',
        ship.tracking_number || null,
        safeHttpUrl(ship.tracking_url),
        ship.carrier         || null,
        String(printfulOrderId)
      );
      return jsonResponse({ ok: true, status, tracking_number: ship.tracking_number || null }, 200, request);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  async function apiProductVariants(request, ref) {
    const raw = String(ref || '').trim();
    if (!raw) return jsonResponse({ error: 'product required' }, 400, request);
    const byId = isDigits(raw);
    const whereClause = byId ? 'p.id = ?' : 'p.slug = ?';
    const param = byId ? Number(raw) : raw;
    const row = await dbGet(
      `select p.id, p.slug, p.title, p.color, p.sizes, p.price_cents, p.currency,
              p.printful_sync_product_id, p.printful_sync_variant_id, p.printful_variant_map, p.is_published
       from products p where ${whereClause}`,
      param
    );
    if (!row || !row.is_published) return jsonResponse({ error: 'Not found' }, 404, request);
    const sizes = (row.sizes || '').split(',').map(s => s.trim()).filter(Boolean);
    const color = row.color || '';
    const variantMap = safeJsonParse(row.printful_variant_map);
    const variants = sizes.map(size => {
      const mapped = variantMap && variantMap[size] != null ? String(variantMap[size]).trim() : '';
      return {
        id: `${row.slug || row.id}-${size.toLowerCase().replace(/\s+/g, '-')}`,
        name: `${row.title} \u2014 ${color} / ${size}`,
        size,
        color,
        price_cents: row.price_cents || 0,
        currency: row.currency || 'USD',
        printful_sync_product_id: row.printful_sync_product_id || null,
        // Prefer the per-size mapping (multi-variant products); fall back to the
        // single product-level id for single-variant products.
        printful_sync_variant_id: mapped || row.printful_sync_variant_id || null,
      };
    });
    return withCache(
      jsonResponse({ product: { id: row.id, slug: row.slug }, variants }, 200, request),
      'public, max-age=60, s-maxage=300'
    );
  }

  async function apiShippingRates(request) {
    const body = await readJson(request);
    const apiKey = globalThis.PRINTFUL_API_KEY;
    const storeId = typeof PRINTFUL_STORE_ID === 'string' ? PRINTFUL_STORE_ID : '';
    if (!apiKey) return jsonResponse({ error: 'PRINTFUL_API_KEY not configured' }, 500, request);
    const recipient = body && body.recipient ? body.recipient : {};
    const items = Array.isArray(body && body.items) ? body.items : [];
    if (!recipient.country_code) return jsonResponse({ error: 'recipient.country_code required' }, 400, request);
    if (!items.length)           return jsonResponse({ error: 'items required' }, 400, request);
    try {
      const qs = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
      const data = await callPrintful('POST', `/v2/shipping/rates${qs}`, { recipient, items });
      const rates = (data && data.result) || (data && data.data) || [];
      const normalized = (Array.isArray(rates) ? rates : []).map(r => ({
        id: r.id,
        name: r.name,
        rate: r.rate,
        currency: r.currency || 'USD',
        minDeliveryDays: r.minDeliveryDays || r.min_delivery_days || null,
        maxDeliveryDays: r.maxDeliveryDays || r.max_delivery_days || null,
      }));
      return jsonResponse({ rates: normalized }, 200, request);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  async function handleDelete(request) {
    try {
      if (!ASSETS_BUCKET || typeof ASSETS_BUCKET.delete !== 'function') {
        return jsonResponse({ error: 'R2 binding missing: ASSETS_BUCKET' }, 500, request);
      }

      const provided = request.headers.get('x-admin-key') || '';
      const expected = typeof WORKER_DELETE_KEY === 'string' ? WORKER_DELETE_KEY : '';
      if (!provided || !expected || !timingSafeEqual(provided, expected)) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      const body = await readJson(request);
      const key = body.key || (body.url ? keyFromPublicUrl(body.url) : null);
      if (!key) return jsonResponse({ error: 'key or url required' }, 400, request);

      await ASSETS_BUCKET.delete(key);

      
      try {
        if (CF_ZONE_ID && CF_API_TOKEN) {
          await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [`${ASSETS_DOMAIN.replace(/\/$/, '')}/${key}`] })
          });
        }
      } catch {
        // ignore purge errors 1
      }

      return jsonResponse({ ok: true }, 200, request);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, request);
    }
  }

  async function handlePurge(request) {
    try {
      // Auth: require admin session
      const sess = await getSessionUser(request);
      if (!sess) return jsonResponse({ error: 'Unauthorized' }, 401, request);
      if (sess.user.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403, request);

      const body = await readJson(request);
      const urls = body.urls || [];
      if (!Array.isArray(urls) || !urls.length) return jsonResponse({ error: 'urls required' }, 400, request);
      if (!CF_ZONE_ID || !CF_API_TOKEN)       return jsonResponse({ error: 'CF purge not configured' }, 500, request);

      const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: urls })
      });
      const j = await resp.json().catch(() => ({}));
      return jsonResponse({ ok: true, result: j }, 200, request);
    } catch (e) {
    

      return jsonResponse({ error: String(e) }, 500, request);
    }
  }