/*!
 * Hu's Noodle Nook — in-page agent tools (WebMCP).
 * Registers read-only tools with navigator.modelContext when a browser/agent supports it.
 * Also exposes window.husNook = { ready, tools, call(name, args) } so the page itself
 * (e.g. an "Ask the Nook" panel) can use the same answers. Fails soft everywhere.
 * Data: menu.json + data/restaurant.json, resolved relative to this script's own URL (../).
 */
(function () {
  'use strict';
  var TZ = 'America/Edmonton';
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var script = document.currentScript;
  var base;
  try { base = new URL('../', script && script.src ? script.src : location.href); } catch (e) { base = null; }

  function getJSON(path) {
    if (!base) return Promise.resolve(null);
    return fetch(new URL(path, base).href, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }); // file:// or offline → fail soft
  }

  function nowInEdmonton(date) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date || new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return { day: o.weekday, minutes: Number(o.hour) * 60 + Number(o.minute), hhmm: o.hour + ':' + o.minute };
  }
  function toMin(hhmm) { var a = hhmm.split(':'); return Number(a[0]) * 60 + Number(a[1]); }
  function fmt(hhmm) {
    var a = hhmm.split(':').map(Number), h = a[0], m = a[1];
    return (((h + 11) % 12) + 1) + (m ? ':' + String(m).padStart(2, '0') : '') + (h >= 12 ? ' pm' : ' am');
  }

  function isOpenNow(hours, date) {
    var now = nowInEdmonton(date);
    var byDay = {};
    hours.forEach(function (h) { byDay[h.day] = h; });
    var today = byDay[now.day];
    var open = !!(today && !today.closed && now.minutes >= toMin(today.open) && now.minutes < toMin(today.close));
    var res = {
      timezone: TZ,
      localTime: now.day + ' ' + now.hhmm,
      open: open,
      today: today ? (today.closed ? 'Closed today' : fmt(today.open) + ' – ' + fmt(today.close)) : 'Unknown'
    };
    if (open) {
      res.closesAt = fmt(today.close);
      res.minutesUntilClose = toMin(today.close) - now.minutes;
    } else {
      var idx = DAYS.indexOf(now.day);
      for (var i = 0; i < 8; i++) {
        var d = byDay[DAYS[(idx + i) % 7]];
        if (!d || d.closed) continue;
        if (i === 0 && now.minutes >= toMin(d.open)) continue; // already past today's opening
        res.nextOpen = (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.day) + ' at ' + fmt(d.open);
        break;
      }
    }
    res.note = 'Holiday hours may differ — call (780) 250-2600 to confirm.';
    return res;
  }

  function flatItems(menu) {
    return menu.categories.reduce(function (acc, c) {
      return acc.concat(c.items.map(function (i) { return Object.assign({ category: c.id, categoryName: c.name }, i); }));
    }, []);
  }

  function searchMenu(menu, a) {
    a = a || {};
    var q = (a.query || '').toLowerCase().trim();
    var list = function (v) { return v == null ? [] : [].concat(v).map(function (s) { return String(s).toLowerCase().trim(); }); };
    var exA = list(a.exclude_allergen), exP = list(a.exclude_protein); // agents often send a single string
    var res = flatItems(menu).filter(function (i) {
      if (!i.tags) return false; // toppings/drinks have no dish facets
      if (a.diet && (i.diet || []).indexOf(a.diet) < 0) return false;
      if (a.spicy === true && i.spice === 'none') return false;
      if (a.spicy === false && i.spice !== 'none') return false;
      if (exA.some(function (x) { return (i.allergens || []).indexOf(x) >= 0; })) return false;
      if (exP.some(function (x) { return (i.contains || []).indexOf(x) >= 0; })) return false;
      if (typeof a.max_price === 'number' && i.price > a.max_price) return false;
      if (q && (i.name + ' ' + (i.description || '') + ' ' + i.categoryName).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (i) {
      return { name: i.name, price: i.priceDisplay, category: i.categoryName, spice: i.spice, diet: i.diet, allergens: i.allergens, description: i.description };
    });
    return { count: res.length, results: res, caveat: menu.allergenNote };
  }

  var state = { menu: null, info: null };
  var ready = Promise.all([getJSON('menu.json'), getJSON('data/restaurant.json')]).then(function (r) {
    state.menu = r[0];
    state.info = r[1] && r[1].restaurant;
    return !!(state.menu && state.info);
  });

  function need(key) {
    if (!state[key]) throw new Error('Data unavailable — see https://husnoodlenook.ca/llms-full.txt or call (780) 250-2600.');
    return state[key];
  }

  var tools = [
    { name: 'get_hours', description: "Weekly opening hours for Hu's Noodle Nook (America/Edmonton).",
      inputSchema: { type: 'object', properties: {} },
      run: function () { var R = need('info'); return { timezone: TZ, hours: R.hours.map(function (h) { return { day: h.day, hours: h.closed ? 'Closed' : fmt(h.open) + ' – ' + fmt(h.close) }; }), note: R.hoursNote }; } },
    { name: 'is_open_now', description: "Is Hu's Noodle Nook open right now? Uses Edmonton local time.",
      inputSchema: { type: 'object', properties: {} },
      run: function () { return isOpenNow(need('info').hours); } },
    { name: 'get_menu', description: 'Full menu or one category, prices in CAD.',
      inputSchema: { type: 'object', properties: { category: { type: 'string' } } },
      run: function (a) {
        var m = need('menu');
        var cats = a && a.category ? m.categories.filter(function (c) { return c.id === a.category; }) : m.categories;
        return { currency: m.currency, lastVerified: m.lastVerified, pricesNote: m.pricesNote, categories: cats };
      } },
    { name: 'search_menu', description: 'Filter dishes by diet, spice, excluded allergens/proteins, max price or text.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string' }, diet: { type: 'string', enum: ['vegetarian', 'vegan'] }, spicy: { type: 'boolean' },
        exclude_allergen: { type: 'array', items: { type: 'string', enum: ['peanut', 'sesame', 'shellfish', 'fish-or-seafood', 'fish'] } },
        exclude_protein: { type: 'array', items: { type: 'string', enum: ['pork', 'beef', 'chicken'] } },
        max_price: { type: 'number' } } },
      run: function (a) { return searchMenu(need('menu'), a); } },
    { name: 'get_location_and_parking', description: 'Address, map link, parking, accessibility and contact.',
      inputSchema: { type: 'object', properties: {} },
      run: function () {
        var R = need('info'), ad = R.address;
        return { address: ad.street + ', ' + ad.city + ', ' + ad.region + ' ' + ad.postalCode, building: ad.building,
          neighbourhood: ad.neighbourhood, map: R.mapsUrl, parking: R.parking, accessibility: R.accessibility, phone: R.phoneDisplay };
      } },
    { name: 'start_order', description: 'Official ordering link and delivery partners. Does not place an order.',
      inputSchema: { type: 'object', properties: {} },
      run: function () { var R = need('info'); return { pickup: R.orderOnline, delivery: R.delivery, promotions: R.promotions, phone: R.phoneDisplay }; } }
  ];

  function call(name, args) {
    var t = tools.filter(function (x) { return x.name === name; })[0];
    if (!t) return Promise.reject(new Error('Unknown tool ' + name));
    return ready.then(function () { return t.run(args || {}); });
  }

  // WebMCP registration (emerging standard; feature-detected, no-op otherwise)
  var mc = navigator.modelContext;
  if (mc) {
    var defs = tools.map(function (t) {
      return {
        name: t.name, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: true },
        execute: function (args) {
          return call(t.name, args).then(
            function (r) { return { content: [{ type: 'text', text: JSON.stringify(r) }] }; },
            function (e) { return { content: [{ type: 'text', text: String(e.message || e) }], isError: true }; });
        }
      };
    });
    try {
      if (typeof mc.provideContext === 'function') mc.provideContext({ tools: defs });
      else if (typeof mc.registerTool === 'function') defs.forEach(function (d) { mc.registerTool(d); });
    } catch (e) { /* fail soft */ }
  }

  window.husNook = { ready: ready, tools: tools.map(function (t) { return t.name; }), call: call, isOpenNow: isOpenNow };
})();
