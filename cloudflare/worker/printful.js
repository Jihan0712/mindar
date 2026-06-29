/**
 * Printful API client for MindAR Cloudflare Worker.
 *
 * Required Worker secrets / vars (Cloudflare Dashboard → Worker → Settings):
 *   PRINTFUL_API_KEY          — Bearer token from Printful → Settings → API
 *   PRINTFUL_STORE_ID         — Store ID for a Manual/API store (not Shopify/Woo)
 *   PRINTFUL_WEBHOOK_SECRET   — Optional HMAC secret for inbound webhooks
 *   PRINTFUL_CATALOG_PRODUCT_ID — Optional default blank catalog product (e.g. 71 = Bella Canvas 3001)
 *
 * Push flow uses Printful v1 Sync API: POST /store/products
 * (v2 does not yet expose sync-product creation — see Printful v2 docs.)
 */

const PRINTFUL_BASE = 'https://api.printful.com';

/** Read and validate Printful credentials from Worker env bindings. */
export function getPrintfulConfig(env) {
  const apiKey = String(env?.PRINTFUL_API_KEY || '').trim();
  const storeId = String(env?.PRINTFUL_STORE_ID || '').trim();
  const webhookSecret = String(env?.PRINTFUL_WEBHOOK_SECRET || '').trim();
  const catalogProductId = parseInt(env?.PRINTFUL_CATALOG_PRODUCT_ID, 10) || null;
  return { apiKey, storeId, webhookSecret, catalogProductId };
}

/** Append ?store_id= when a store is configured (required for multi-store tokens). */
export function printfulStoreQuery(env) {
  const { storeId } = getPrintfulConfig(env);
  return storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
}

/**
 * Authenticated fetch wrapper for Printful REST API.
 * @throws {Error} when PRINTFUL_API_KEY is missing or Printful returns non-2xx
 */
export async function callPrintful(env, method, path, body) {
  const { apiKey } = getPrintfulConfig(env);
  if (!apiKey) throw new Error('PRINTFUL_API_KEY is not configured');

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-PF-Language': 'EN',
    },
  };
  if (body != null) opts.body = JSON.stringify(body);

  const res = await fetch(`${PRINTFUL_BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || JSON.stringify(json);
    throw new Error(`Printful ${res.status}: ${msg}`);
  }
  return json;
}

/** GET /products/:id — blank catalog product with all size/color variants. */
export async function fetchCatalogProduct(env, catalogProductId) {
  const id = Number(catalogProductId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid catalog product id');
  }
  const data = await callPrintful(env, 'GET', `/products/${id}`);
  return (data && data.result) || null;
}

function normalizeSizeLabel(s) {
  return String(s || '').trim().toUpperCase();
}

function normalizeColorLabel(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Match local product sizes + color to Printful catalog variant_id values.
 * @param {object} catalogProduct — result from fetchCatalogProduct
 * @param {string[]} sizes — e.g. ['S','M','L']
 * @param {string} color — e.g. 'Black'
 * @param {Record<string, number>|null} overrideMap — optional size → catalog variant_id
 */
export function resolveCatalogVariants(catalogProduct, sizes, color, overrideMap) {
  const variants = Array.isArray(catalogProduct?.variants) ? catalogProduct.variants : [];
  const colorNorm = normalizeColorLabel(color);
  const resolved = [];
  const missing = [];

  for (const size of sizes) {
    const sizeNorm = normalizeSizeLabel(size);
    if (!sizeNorm) continue;

    if (overrideMap && overrideMap[sizeNorm] != null) {
      resolved.push({ size, variant_id: Number(overrideMap[sizeNorm]) });
      continue;
    }
    if (overrideMap && overrideMap[size] != null) {
      resolved.push({ size, variant_id: Number(overrideMap[size]) });
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
      resolved.push({ size, variant_id: Number(match.id) });
    } else {
      missing.push(size);
    }
  }

  return { resolved, missing };
}

/**
 * Resolve a publicly reachable design URL for Printful file ingestion.
 * Printful must be able to GET this URL — use HTTPS absolute URLs only.
 */
export function resolveDesignFileUrl(product, options = {}) {
  if (options.print_file_url) {
    const u = String(options.print_file_url).trim();
    if (!/^https:\/\//i.test(u)) {
      throw new Error('print_file_url must be an absolute https URL');
    }
    return u;
  }

  const siteOrigin = String(options.site_origin || '').replace(/\/$/, '');
  const candidates = [];

  if (product.image_url) candidates.push(String(product.image_url).trim());
  if (product.image_urls) {
    try {
      const arr = typeof product.image_urls === 'string' ? JSON.parse(product.image_urls) : product.image_urls;
      if (Array.isArray(arr)) candidates.push(...arr.map(String));
    } catch { /* ignore */ }
  }

  for (let raw of candidates) {
    if (!raw) continue;
    if (/^https:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/api/product-image') && siteOrigin) {
      return `${siteOrigin}${raw.startsWith('/') ? raw : '/' + raw}`;
    }
    if (raw.startsWith('/') && siteOrigin) {
      return `${siteOrigin}${raw}`;
    }
  }

  throw new Error(
    'No public design URL found. Set product image_url to an https URL, ' +
    'or pass print_file_url / site_origin when pushing to Printful.'
  );
}

/**
 * Build POST /store/products body from a local D1 product row.
 */
export function buildSyncProductPayload(product, catalogVariants, options = {}) {
  const placement = String(options.placement || 'front').trim() || 'front';
  const designUrl = resolveDesignFileUrl(product, options);
  const priceCents = Number(product.price_cents) || 0;
  const retailPrice = (priceCents / 100).toFixed(2);
  const thumbnail = designUrl;

  const sync_variants = catalogVariants.map(({ size, variant_id }) => ({
    external_id: String(size),
    variant_id: Number(variant_id),
    retail_price: retailPrice,
    files: [{ type: placement, url: designUrl }],
  }));

  if (!sync_variants.length) {
    throw new Error('No catalog variants resolved — check sizes, color, and catalog product id');
  }

  return {
    sync_product: {
      name: String(product.title || product.slug || 'Product').trim(),
      thumbnail,
    },
    sync_variants,
  };
}

/**
 * Option B (Push): create a Sync Product in Printful from local product data.
 * Uses POST /store/products (Printful Sync API v1).
 *
 * @returns {{ syncProductId, syncVariantMap, raw }}
 */
export async function pushProductToPrintful(env, product, options = {}) {
  const catalogProductId = Number(options.catalog_product_id) ||
    getPrintfulConfig(env).catalogProductId;

  if (!catalogProductId) {
    throw new Error(
      'catalog_product_id required (pass in request body or set PRINTFUL_CATALOG_PRODUCT_ID). ' +
      'Find IDs via GET /products in the Printful Catalog API.'
    );
  }

  const sizes = String(product.sizes || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!sizes.length) throw new Error('Product has no sizes');

  const catalogProduct = await fetchCatalogProduct(env, catalogProductId);
  const overrideMap = options.catalog_variant_ids && typeof options.catalog_variant_ids === 'object'
    ? options.catalog_variant_ids
    : null;

  const { resolved, missing } = resolveCatalogVariants(
    catalogProduct,
    sizes,
    product.color || '',
    overrideMap
  );

  if (missing.length) {
    throw new Error(
      `Could not match catalog variants for size(s): ${missing.join(', ')} ` +
      `(color: ${product.color || 'any'}). Pass catalog_variant_ids to override.`
    );
  }

  const payload = buildSyncProductPayload(product, resolved, options);
  const qs = printfulStoreQuery(env);
  const data = await callPrintful(env, 'POST', `/store/products${qs}`, payload);

  const result = (data && data.result) || {};
  const syncProduct = result.sync_product || {};
  const syncVariants = Array.isArray(result.sync_variants) ? result.sync_variants : [];

  /** Map size label → Printful sync_variant id (stored in D1 printful_variant_map). */
  const syncVariantMap = {};
  let firstSyncVariantId = null;

  for (const sv of syncVariants) {
    const syncId = sv.id != null ? String(sv.id) : null;
    if (!syncId) continue;
    if (!firstSyncVariantId) firstSyncVariantId = syncId;

    const ext = sv.external_id != null ? String(sv.external_id).trim() : '';
    if (ext) syncVariantMap[ext] = syncId;

    // Fallback: match by catalog variant_id
    const catId = sv.variant_id != null ? Number(sv.variant_id) : null;
    if (catId) {
      const match = resolved.find(r => Number(r.variant_id) === catId);
      if (match) syncVariantMap[match.size] = syncId;
    }
  }

  return {
    syncProductId: syncProduct.id != null ? Number(syncProduct.id) : null,
    syncVariantId: firstSyncVariantId,
    syncVariantMap,
    raw: result,
  };
}

/** Option A (Pull): list sync products — GET /store/products or /v2/sync-products. */
export async function listSyncProducts(env) {
  const qs = printfulStoreQuery(env);
  try {
    const data = await callPrintful(env, 'GET', `/v2/sync-products${qs}`);
    return (data && data.result) || (data && data.data) || [];
  } catch {
    const data = await callPrintful(env, 'GET', `/store/products${qs}`);
    return (data && data.result) || [];
  }
}
