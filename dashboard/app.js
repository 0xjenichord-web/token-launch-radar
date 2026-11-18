// Token Radar dashboard (own work). Reads window.RADAR, written beside
// dashboard/ by main.ts, and renders the board, filters, sorting and a
// per-protocol detail view. No network: every byte shown is in data.js.
// Hash state: #p=<slug> opens a detail, #q= searches, #category= and
// #chain= filter, #tab=pre-token|live switches the view.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  var drawer = document.getElementById('detail');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };
  var fmtUsd = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  var fmtPct = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };
  // Short axis labels for the scatter plot's powers of ten.
  var fmtAxis = function (n) {
    if (n >= 1e12) return '$' + (n / 1e12) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3) + 'K';
    return '$' + n;
  };
  var fmtAge = function (d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  };
  var esc = function (s) { return String(s === null || s === undefined ? '' : s); };
  var escHtml = function (s) {
    return esc(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // Total implied value by category, top five, as an inline SVG chart.
  // The chart is built from the rows already in data.js: no fetch, no
  // library, no network. Markup is written through innerHTML so the
  // page never names a namespace address in its source.
  function categoryChart() {
    var totals = {};
    DATA.rows.forEach(function (r) {
      var k = r.category || 'Uncategorised';
      totals[k] = (totals[k] || 0) + r.implied_value_usd;
    });
    var list = Object.keys(totals).map(function (k) { return { name: k, total: totals[k] }; });
    list.sort(function (a, b) { return b.total - a.total; });
    var top = list.slice(0, 5);
    var max = top.length ? top[0].total : 1;
    var rowH = 26, pad = 8;
    var h = top.length * rowH + pad * 2 + 24;
    var out = '<svg viewBox="0 0 640 ' + h + '" class="chart" role="img" aria-label="Total implied value by category, top five categories">';
    out += '<text x="0" y="16" class="chart-title">Total implied value by category — top 5</text>';
    top.forEach(function (c, i) {
      var y = pad + 24 + i * rowH;
      var w = Math.max(4, Math.round(300 * c.total / max));
      out += '<text x="0" y="' + (y + 13) + '" class="chart-label">' + escHtml(c.name) + '</text>';
      out += '<rect x="170" y="' + y + '" width="' + w + '" height="14" rx="3" class="chart-bar" />';
      out += '<text x="' + (180 + w) + '" y="' + (y + 13) + '" class="chart-value">' + escHtml(fmtUsd(c.total)) + '</text>';
    });
    out += '</svg>';
    var wrap = el('div', { 'class': 'panel chart-panel' });
    wrap.innerHTML = out;
    return wrap;
  }

  // Scatter plot of TVL against implied value, one dot per board row,
  // log scales on both axes. Built from the rows already in data.js:
  // no fetch, no library, no network. Markup is written through
  // innerHTML so the page never names a namespace address in its source.
  function scatterChart() {
    var rows = DATA.rows.filter(function (r) { return r.tvl_usd > 0 && r.implied_value_usd > 0; });
    var W = 640, H = 340, ml = 72, mr = 16, mt = 28, mb = 44;
    var xs = rows.map(function (r) { return Math.log10(r.tvl_usd); });
    var ys = rows.map(function (r) { return Math.log10(r.implied_value_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var px = function (v) { return ml + (v - x0) / (x1 - x0) * (W - ml - mr); };
    var py = function (v) { return H - mb - (v - y0) / (y1 - y0) * (H - mt - mb); };
    var out = '<svg viewBox="0 0 640 340" class="chart scatter" role="img" aria-label="Scatter plot of TVL against implied value, both axes logarithmic, one dot per protocol">';
    out += '<text x="0" y="16" class="chart-title">TVL against implied value — both axes logarithmic</text>';
    var gx, gy;
    for (gx = x0; gx <= x1; gx++) {
      out += '<line x1="' + px(gx).toFixed(1) + '" y1="' + (H - mb) + '" x2="' + px(gx).toFixed(1) + '" y2="' + mt + '" class="scatter-grid" />';
      out += '<text x="' + px(gx).toFixed(1) + '" y="' + (H - mb + 16) + '" class="chart-label scatter-tick">' + escHtml(fmtAxis(Math.pow(10, gx))) + '</text>';
    }
    for (gy = y0; gy <= y1; gy++) {
      out += '<line x1="' + ml + '" y1="' + py(gy).toFixed(1) + '" x2="' + (W - mr) + '" y2="' + py(gy).toFixed(1) + '" class="scatter-grid" />';
      out += '<text x="' + (ml - 8) + '" y="' + (py(gy) + 4).toFixed(1) + '" class="chart-label scatter-tick-y">' + escHtml(fmtAxis(Math.pow(10, gy))) + '</text>';
    }
    out += '<text x="' + ((W - ml - mr) / 2 + ml).toFixed(1) + '" y="' + (H - 6) + '" class="chart-label scatter-axis-label">TVL (log scale)</text>';
    var midY = ((H - mt - mb) / 2 + mt).toFixed(1);
    out += '<text x="14" y="' + midY + '" class="chart-label scatter-axis-label" transform="rotate(-90 14 ' + midY + ')">Implied value (log scale)</text>';
    rows.forEach(function (r) {
      out += '<circle cx="' + px(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + py(Math.log10(r.implied_value_usd)).toFixed(1) + '" r="3" class="scatter-dot' + (r.watchlist ? ' watch' : '') + '"><title>' + escHtml(r.name + ' — TVL ' + fmtUsd(r.tvl_usd) + ', implied ' + fmtUsd(r.implied_value_usd)) + '</title></circle>';
    });
    out += '</svg>';
    var wrap = el('div', { 'class': 'panel chart-panel', id: 'charts' });
    wrap.innerHTML = out;
    wrap.appendChild(el('div', { 'class': 'legend' },
      el('span', { 'class': 'legend-item' }, el('span', { 'class': 'dot watch' }), 'Watchlist'),
      el('span', { 'class': 'legend-item' }, el('span', { 'class': 'dot' }), 'Other board rows'),
      el('span', { 'class': 'note' }, rows.length + ' dots, one per board row. Both axes are base-10 logarithmic, so a step right or up is ten times more.')));
    return wrap;
  }

  // Top movers: the five board rows with the largest seven-day TVL
  // growth and the five with the smallest. Rows with no seven-day
  // change in the snapshot are left out. Clicking a row opens its detail.
  function moversPanel() {
    var withGrowth = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined && isFinite(r.change_7d); });
    var sorted = withGrowth.slice().sort(function (a, b) { return b.change_7d - a.change_7d; });
    var top = sorted.slice(0, 5);
    var bottom = sorted.slice(-5).reverse();
    function moverList(list, heading) {
      var box = el('div', null, el('h3', null, heading));
      list.forEach(function (r) {
        box.appendChild(el('div', { 'class': 'mover', onclick: function () { state.selected = r.slug; render(); openDetail(r); } },
          el('span', { 'class': 'num' }, '#' + r.rank),
          el('span', { 'class': 'mover-name' }, r.name),
          el('span', { 'class': 'num ' + (r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)),
          el('span', { 'class': 'num' }, fmtUsd(r.implied_value_usd))));
      });
      return box;
    }
    var wrap = el('div', { 'class': 'panel movers-panel' });
    wrap.appendChild(el('h2', null, 'Top movers — 7-day TVL growth'));
    var grid = el('div', { 'class': 'movers' });
    grid.appendChild(moverList(top, 'Biggest gains'));
    grid.appendChild(moverList(bottom, 'Biggest falls'));
    wrap.appendChild(grid);
    wrap.appendChild(el('p', { 'class': 'note' }, withGrowth.length + ' of ' + DATA.rows.length + ' board rows carry a seven-day change in the snapshot; the rest are left out. Click a row to open its detail.'));
    return wrap;
  }

  // Download the currently filtered board rows as a CSV, built
  // entirely in the browser from the rows already in data.js.
  function downloadCsv() {
    var rows = filteredRows();
    var cell = function (v) {
      var s = String(v === null || v === undefined ? '' : v);
      return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = ['rank,slug,name,category,tvl_usd,change_7d,implied_value_usd,watchlist'];
    rows.forEach(function (r) {
      lines.push([r.rank, r.slug, r.name, r.category || '', r.tvl_usd, r.change_7d, r.implied_value_usd, r.watchlist ? 'yes' : 'no'].map(cell).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-launch-radar.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('watchlist') === '1') state.watchlistOnly = true;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.watchlistOnly) p.set('watchlist', '1');
    if (state.selected) p.set('p', state.selected);
    var h = p.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname);
  }

  var categories = [];
  DATA.rows.forEach(function (r) { if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category); });
  categories.sort();
  var chains = [];
  DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  chains.sort();

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'growth') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'name') d = a.name < b.name ? -1 : 1;
      return d * state.dir;
    });
    return rows;
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } }, label + arrow);
  }

  function render() {
    writeHash();
    app.textContent = '';
    var shell = el('div', { 'class': 'shell' });
    var top = el('div', { 'class': 'top' },
      el('div', { 'class': 'brand' }, el('span', { 'class': 'mark' }), 'TOKEN RADAR'),
      el('div', { 'class': 'meta' },
        el('span', null, 'Snapshot ', el('b', null, DATA.as_of)),
        el('span', null, 'Watchlist ', el('b', null, String(DATA.watchlist_size))),
        el('span', null, 'Board ', el('b', null, String(DATA.board_size)))));
    var lede = el('div', { 'class': 'lede' },
      el('div', null,
        el('h1', null, 'Protocols that record no token, ranked by what a launch could be worth.'),
        el('p', null, 'Each row is a protocol from the sealed snapshot that records no token. Its implied value comes from the snapshot alone: TVL times the peer multiple of tokenised protocols in its category, adjusted for seven-day growth, how long it has run, and how many chains it is on. ', el('b', null, 'This is not a prediction that any token will launch.'))),
      el('div', { 'class': 'facts' },
        el('div', { 'class': 'fact' }, el('span', null, 'Top implied value'), el('b', null, fmtUsd(DATA.rows[0].implied_value_usd))),
        el('div', { 'class': 'fact' }, el('span', null, 'Watchlist floor'), el('b', null, fmtUsd(DATA.floor_usd))),
        el('div', { 'class': 'fact' }, el('span', null, 'Early rows below the floor'), el('b', null, String(DATA.early_size))),
        el('div', { 'class': 'fact' }, el('span', null, 'Already launched, set aside'), el('b', null, String(DATA.live_size)))));

    var controls = el('div', { 'class': 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; render(); } });
    controls.appendChild(el('div', { 'class': 'field' }, el('label', null, 'Search'), search));
    var catSel = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } });
    catSel.appendChild(el('option', { value: 'all' }, 'All categories'));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, selected: state.category === c ? 'selected' : null }, c)); });
    controls.appendChild(el('div', { 'class': 'field' }, el('label', null, 'Category'), catSel));
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } });
    chainSel.appendChild(el('option', { value: 'all' }, 'All chains'));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, selected: state.chain === c ? 'selected' : null }, c)); });
    controls.appendChild(el('div', { 'class': 'field' }, el('label', null, 'Chain'), chainSel));
    var tvlSel = el('select', { 'aria-label': 'Minimum TVL', onchange: function (e) { state.minTvl = Number(e.target.value); render(); } });
    [[0, 'Any TVL'], [50000000, 'TVL $50M+'], [100000000, 'TVL $100M+'], [500000000, 'TVL $500M+']].forEach(function (o) {
      tvlSel.appendChild(el('option', { value: String(o[0]), selected: state.minTvl === o[0] ? 'selected' : null }, o[1]));
    });
    controls.appendChild(el('div', { 'class': 'field' }, el('label', null, 'Minimum TVL'), tvlSel));
    var tabs = el('div', { 'class': 'tabs' },
      el('button', { type: 'button', 'aria-pressed': String(state.tab === 'pre-token'), onclick: function () { state.tab = 'pre-token'; render(); } }, 'Pre-token board'),
      el('button', { type: 'button', 'aria-pressed': String(state.tab === 'live'), onclick: function () { state.tab = 'live'; render(); } }, 'Already launched'));
    controls.appendChild(tabs);

    var panel = el('div', { 'class': 'panel' });
    if (state.tab === 'live') {
      var liveHead = el('tr', null, el('th', null, 'Protocol'), el('th', null, 'Category'), el('th', null, 'TVL'), el('th', null, 'Market cap'), el('th', null, '7d'));
      var liveBody = el('tbody', null);
      DATA.live.forEach(function (r) {
        liveBody.appendChild(el('tr', null,
          el('td', { 'class': 'name' }, el('b', null, r.name), el('span', { 'class': 'sub' }, r.slug)),
          el('td', null, esc(r.category || '—')),
          el('td', { 'class': 'num' }, fmtUsd(r.tvl_usd)),
          el('td', { 'class': 'num' }, fmtUsd(r.mcap_usd)),
          el('td', { 'class': 'num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d))));
      });
      panel.appendChild(el('div', { 'class': 'table-wrap' }, el('table', null, el('thead', null, liveHead), liveBody)));
      controls.appendChild(el('span', { 'class': 'count' }, DATA.live.length + ' launched protocols, by market cap — shown for comparison, never ranked as launches'));
    } else {
      var rows = filteredRows();
      var maxImplied = DATA.rows[0].implied_value_usd;
      var head = el('tr', null,
        el('th', null, sortButton('Rank', 'rank')),
        el('th', null, sortButton('Protocol', 'name')),
        el('th', null, sortButton('TVL', 'tvl')),
        el('th', null, sortButton('7d', 'growth')),
        el('th', null, 'Age'),
        el('th', null, sortButton('Implied value', 'implied')));
      var body = el('tbody', null);
      rows.forEach(function (r) {
        var tr = el('tr', {
          'data-selected': String(state.selected === r.slug),
          onclick: function () { state.selected = r.slug; render(); openDetail(r); }
        },
          el('td', { 'class': 'num' }, String(r.rank)),
          el('td', { 'class': 'name' }, el('b', null, r.name), r.watchlist ? el('span', { 'class': 'badge watch' }, 'Watchlist') : null, el('span', { 'class': 'sub' }, r.slug + ' · ' + (r.category || '—') + ' · ' + (r.chains || []).join(', '))),
          el('td', { 'class': 'num' }, fmtUsd(r.tvl_usd)),
          el('td', { 'class': 'num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)),
          el('td', { 'class': 'num' }, fmtAge(r.age_days)),
          el('td', null, el('div', { 'class': 'implied' }, el('span', { 'class': 'num' }, fmtUsd(r.implied_value_usd)), el('span', { 'class': 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%' })))));
        body.appendChild(tr);
      });
      panel.appendChild(el('div', { 'class': 'table-wrap' }, el('table', null, el('thead', null, head), body)));
      if (rows.length === 0) panel.appendChild(el('div', { 'class': 'empty' }, el('h2', null, 'No protocols match'), el('p', null, 'Clear the search or widen the filters.'), el('button', { 'class': 'button', type: 'button', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; render(); } }, 'Clear filters')));
      controls.appendChild(el('button', { type: 'button', 'class': 'toggle', 'aria-pressed': String(state.watchlistOnly), onclick: function () { state.watchlistOnly = !state.watchlistOnly; render(); } }, 'Watchlist only'));
      controls.appendChild(el('button', { type: 'button', 'class': 'button', onclick: function () { downloadCsv(); } }, 'Download CSV'));
      controls.appendChild(el('span', { 'class': 'count' }, rows.length + ' of ' + DATA.rows.length + ' protocols'));
    }

    var model = el('div', { 'class': 'panel model' },
      el('h2', null, 'How the value is worked out'),
      el('p', { 'class': 'formula' }, 'implied = TVL x peer multiple x growth factor x age factor x breadth factor'),
      el('p', null, DATA.model_note),
      el('p', null, 'Overall peer multiple: ' + DATA.overall_multiple + '. A category multiple shrinks its own median toward the overall median, (n x category median + 3 x overall median) / (n + 3), where n is the category tokenised peer count, used only when n is at least 3; a category with fewer peers uses the overall median. Growth is the seven-day TVL change, clipped to -30%..+30%. Age is days since first tracked, to the snapshot date.'));

    shell.appendChild(top);
    shell.appendChild(lede);
    shell.appendChild(categoryChart());
    shell.appendChild(controls);
    shell.appendChild(panel);
    shell.appendChild(scatterChart());
    shell.appendChild(moversPanel());
    shell.appendChild(model);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) {
      var found = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) found = r; });
      if (found) openDetail(found);
    }
  }

  // One model factor as a horizontal bar, scaled to its own range.
  function factorBar(label, value, lo, hi) {
    var pct = Math.max(2, Math.min(100, Math.round(100 * (value - lo) / (hi - lo))));
    return el('div', { 'class': 'factor' },
      el('span', { 'class': 'factor-label' }, label),
      el('span', { 'class': 'bar factor-track' }, el('i', { style: 'width:' + pct + '%' })),
      el('b', { 'class': 'num' }, 'x' + value));
  }

  function openDetail(r) {
    drawer.textContent = '';
    drawer.hidden = false;
    var m = r.model;
    var head = el('div', { 'class': 'detail-head' },
      el('div', null, el('span', { 'class': 'badge' }, 'Pre-token · records no token'), r.watchlist ? el('span', { 'class': 'badge watch' }, 'Watchlist') : null, el('h2', null, r.name), el('p', { 'class': 'sub' }, r.slug + ' · ' + (r.category || '—') + ' · ' + (r.chains || []).join(', '))),
      el('button', { 'class': 'close', type: 'button', onclick: function () { state.selected = null; drawer.hidden = true; render(); } }, 'Close'));
    var facts = el('div', { 'class': 'detail-section' },
      el('h3', null, 'Rank #' + r.rank + ' — implied value ' + fmtUsd(r.implied_value_usd)),
      el('div', { 'class': 'equation' },
        el('div', null, el('span', null, 'TVL'), el('b', null, fmtUsd(r.tvl_usd))),
        el('div', null, el('span', null, 'Peer multiple' + (m.peer_category ? ' (' + m.peer_category + ', ' + m.peer_count + ' peers)' : ' (overall median)')), el('b', null, String(m.peer_multiple))),
        el('div', null, el('span', null, 'Growth, 7d'), el('b', null, fmtPct(r.change_7d) + ' → x' + m.growth_factor)),
        el('div', null, el('span', null, 'Age'), el('b', null, fmtAge(r.age_days) + ' → x' + m.age_factor)),
        el('div', null, el('span', null, 'Chain breadth'), el('b', null, (r.chains || []).length + ' chains → x' + m.breadth_factor)),
        el('div', null, el('span', null, 'First tracked'), el('b', null, r.listed_at || 'unknown'))));
    var bars = el('div', { 'class': 'detail-section' },
      el('h3', null, 'Model breakdown'),
      factorBar('Peer multiple', m.peer_multiple, 0, 1),
      factorBar('Growth factor', m.growth_factor, 0.7, 1.3),
      factorBar('Age factor', m.age_factor, 1, 1.25),
      factorBar('Breadth factor', m.breadth_factor, 1, 1.1),
      el('p', { 'class': 'note' }, 'Peer multiple is shrunk toward the overall median: (n x category median + 3 x overall median) / (n + 3), where n is the category tokenised peer count (' + m.peer_count + ' peers' + (m.peer_category ? ' in ' + m.peer_category : ', overall median') + ').'));
    var steps = el('div', { 'class': 'detail-section' }, el('h3', null, 'How to farm it'), el('ol', { 'class': 'steps' }));
    var ol = steps.querySelector('ol');
    (r.farm_steps || []).forEach(function (s) { ol.appendChild(el('li', null, s)); });
    steps.appendChild(el('p', { 'class': 'note' }, 'No airdrop is confirmed for this protocol. The plan is about using it as a real user; a launch, if it ever happens, is the protocol\u2019s own decision.'));
    drawer.appendChild(head);
    drawer.appendChild(facts);
    drawer.appendChild(bars);
    drawer.appendChild(steps);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) { state.selected = null; drawer.hidden = true; render(); }
  });
})();
