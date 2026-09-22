/* Shared storefront helpers for the FINAL design: money, escaping, the
   product card (1570:1119 + editorial 1716:1102), loading skeletons and a
   cached product fetch. Loaded before page scripts on every storefront page. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, currency) {
    var v = Number(n || 0);
    var sym = (currency || 'USD') === 'USD' ? '$' : '';
    return sym + v.toFixed(2);
  }
  function moneyFromCents(cents, currency) { return money(Number(cents || 0) / 100, currency); }

  function imageUrl(u) {
    var s = (u || '').toString();
    if (!s) return '';
    if (/^(data:|https?:|\/api\/|\/ecommerce\/)/.test(s)) return s;
    if (s.indexOf('/images/') === 0) return s.replace(/^\/images\//, 'images/');
    return s;
  }

  function productHref(p) {
    return p && p.slug ? 'product.html?slug=' + encodeURIComponent(p.slug) : 'product.html';
  }

  function isSoldOut(p) {
    if (!p) return false;
    if (p.sold_out === true || p.sold_out === 1) return true;
    if (p.stock != null && Number(p.stock) <= 0) return true;
    return false;
  }

  /* AR layer tag. The catalogue knows whether a piece has a layer (ar_target_id);
     a version number is shown when the API supplies one. */
  function layerTag(p) {
    if (isSoldOut(p)) return '<span class="pcard__tag is-muted">Restock soon</span>';
    if (p && p.ar_target_id) {
      var v = p.layer_version || p.ar_version || p.target_version;
      return '<span class="pcard__tag">AR layer' + (v ? ' &middot; V' + esc(v) : '') + '</span>';
    }
    return '<span class="pcard__tag is-muted">No layer yet</span>';
  }

  function cardImage(p, label) {
    var img = imageUrl(p && p.image_url);
    var title = esc((p && p.title) || 'Product');
    return '<div class="ph pcard__img">' + (img
      ? '<img src="' + esc(img) + '" alt="' + title + '" loading="lazy" onerror="this.remove()">'
      : '') + '<span>' + esc(label || 'Product image') + '</span></div>';
  }

  /* Grid card: title / "From $x" / tag stacked. */
  function productCard(p) {
    var sold = isSoldOut(p);
    var price = sold ? 'Sold out' : '<span class="from">From</span>' + esc(moneyFromCents(p.price_cents, p.currency));
    return '<a class="pcard' + (sold ? ' is-soldout' : '') + '" href="' + esc(productHref(p)) + '">'
      + cardImage(p, 'Primary image')
      + '<p class="pcard__title">' + esc(p.title || 'Product') + '</p>'
      + '<div class="pcard__price tnum">' + price + '</div>'
      + layerTag(p)
      + '</a>';
  }

  /* Editorial card: title, then price left and tag right on one row. */
  function productCardRow(p) {
    var sold = isSoldOut(p);
    var price = sold ? 'Sold out' : esc(moneyFromCents(p.price_cents, p.currency));
    return '<a class="pcard pcard--row' + (sold ? ' is-soldout' : '') + '" href="' + esc(productHref(p)) + '">'
      + cardImage(p, 'Product image · 4:5')
      + '<p class="pcard__title">' + esc(p.title || 'Product') + '</p>'
      + '<div class="pcard__row"><span class="pcard__price tnum">' + price + '</span>' + layerTag(p) + '</div>'
      + '</a>';
  }

  function skeletonCards(n) {
    var out = '';
    for (var i = 0; i < (n || 4); i++) {
      out += '<div class="pcard pcard-skel" aria-hidden="true"><div class="ph pcard__img"></div><div class="bar"></div><div class="bar"></div></div>';
    }
    return out;
  }

  var productsPromise = null;
  function fetchProducts() {
    if (productsPromise) return productsPromise;
    productsPromise = fetch('/api/products', { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('Products API error (' + res.status + ')');
        return res.json();
      })
      .then(function (data) { return Array.isArray(data && data.items) ? data.items : []; })
      .catch(function (e) { productsPromise = null; throw e; });
    return productsPromise;
  }

  function parseSizes(p) {
    if (!p || !p.sizes) return [];
    return String(p.sizes).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseVariantMap(p) {
    var m = p && p.printful_variant_map;
    if (!m) return {};
    if (typeof m === 'string') { try { return JSON.parse(m) || {}; } catch (e) { return {}; } }
    return m;
  }

  window.INRL = {
    esc: esc,
    money: money,
    moneyFromCents: moneyFromCents,
    imageUrl: imageUrl,
    productHref: productHref,
    isSoldOut: isSoldOut,
    layerTag: layerTag,
    productCard: productCard,
    productCardRow: productCardRow,
    skeletonCards: skeletonCards,
    fetchProducts: fetchProducts,
    parseSizes: parseSizes,
    parseVariantMap: parseVariantMap
  };
})();
