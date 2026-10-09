(function () {
  'use strict';

  if (window.hdrezka_plugin) return;
  window.hdrezka_plugin = true;

  // Mirror domain: HDRezka changes it often. Edit here if it stops opening.
  var BASE = 'https://rezka.ag';
  // CORS proxy (your Cloudflare Worker, must end with a slash). Empty = direct.
  var PROXY = 'https://shiny-sea-8fb3.soseliagocha19.workers.dev/';

  var net = new Lampa.Reguest();

  // ---------- network ----------
  function get(url, ok, fail, post) {
    var params = { dataType: 'text' };
    url = PROXY + url;

    net.native(url, ok, function () {
      net.silent(url, ok, function (err) {
        fail(err || 'request failed');
      }, post || false, params);
    }, post || false, params);
  }

  function noty(t) { Lampa.Noty.show('HDRezka: ' + t); }

  function abs(href) {
    if (!href) return '';
    if (href.indexOf('http') === 0) return href;
    return BASE + (href.charAt(0) === '/' ? '' : '/') + href;
  }

  // ---------- stream decoder ----------
  // HDRezka obfuscates the "url" field: junk base64 chunks are mixed into a base64 string.
  var TRASH = (function () {
    var chars = ['@', '#', '!', '^', '$'], out = [];
    [2, 3].forEach(function (n) {
      (function rec(prefix, d) {
        if (d === n) { out.push(btoa(prefix)); return; }
        chars.forEach(function (c) { rec(prefix + c, d + 1); });
      })('', 0);
    });
    return out;
  })();

  function decode(str) {
    if (!str) return '';
    if (str.indexOf('#h') !== 0 && str.indexOf('http') === 0) return str; // not obfuscated
    str = str.replace('#h', '').split('//_//').join('');
    TRASH.forEach(function (t) { str = str.split(t).join(''); });
    try { return atob(str); } catch (e) {}
    try { return atob(str + '=='); } catch (e2) {}
    return '';
  }

  // "[360p]url1 or url2,[1080p]url1 or url2"  ->  { '1080p': url, '360p': url }
  function parseQualities(raw) {
    var list = [];
    raw.split(',').forEach(function (part) {
      var m = part.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
      if (!m) return;
      var urls = m[2].split(' or ').map(function (u) { return u.trim(); }).filter(Boolean);
      var hls = urls.filter(function (u) { return /\.m3u8$/i.test(u); })[0];
      list.push({ label: m[1].trim(), url: hls || urls[0] });
    });

    list.sort(function (a, b) { return (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0); });

    var map = {};
    list.forEach(function (q) { map[q.label] = q.url; });
    return { map: map, best: list.length ? list[0].url : '' };
  }

  // ---------- search ----------
  function searchOne(q, ok, fail) {
    get(BASE + '/search/?do=search&subaction=search&q=' + encodeURIComponent(q), function (html) {
      var doc = new DOMParser().parseFromString(String(html), 'text/html');
      var list = [];

      doc.querySelectorAll('.b-content__inline_item').forEach(function (el) {
        var a = el.querySelector('.b-content__inline_item-link a');
        var info = el.querySelector('.b-content__inline_item-link div');
        var url = el.getAttribute('data-url') || (a && a.getAttribute('href'));
        if (!url || !a) return;
        list.push({
          title: a.textContent.trim() + (info ? ' (' + info.textContent.trim() + ')' : ''),
          url: abs(url),
          info: info ? info.textContent : ''
        });
      });

      ok(list);
    }, function () { fail('search failed'); });
  }

  function search(card, ok, fail) {
    var year = String(card.release_date || card.first_air_date || '').slice(0, 4);
    var queries = [];
    [card.title || card.name, card.original_title || card.original_name].forEach(function (q) {
      q = (q || '').trim();
      if (q.length >= 2 && queries.indexOf(q) < 0) queries.push(q);
    });

    var all = [], seen = {}, i = 0, lastErr = '';
    (function next() {
      if (i >= queries.length) {
        if (!all.length && lastErr) return fail(lastErr);
        // put results with the right year first
        all.sort(function (a, b) {
          return (b.info.indexOf(year) >= 0 ? 1 : 0) - (a.info.indexOf(year) >= 0 ? 1 : 0);
        });
        return ok(all);
      }
      searchOne(queries[i++], function (list) {
        list.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; all.push(it); } });
        next();
      }, function (e) { lastErr = e; next(); });
    })();
  }

  // ---------- title page ----------
  function loadPage(url, ok, fail) {
    get(url, function (html) {
      html = String(html);

      var init = html.match(/initCDN(Movies|Series)Events\(\s*(\d+)\s*,\s*(\d+)/);
      if (!init) return fail('no player data');

      var doc = new DOMParser().parseFromString(html, 'text/html');
      var translators = [];

      doc.querySelectorAll('.b-translator__item').forEach(function (el) {
        translators.push({
          title: (el.getAttribute('title') || el.textContent || '').trim(),
          id: el.getAttribute('data-translator_id'),
          camrip: el.getAttribute('data-camrip') || '0',
          ads: el.getAttribute('data-ads') || '0',
          director: el.getAttribute('data-director') || '0'
        });
      });

      if (!translators.length) {
        translators.push({ title: 'Default', id: init[3], camrip: '0', ads: '0', director: '0' });
      }

      ok({
        id: init[2],
        isSeries: init[1] === 'Series',
        translators: translators
      });
    }, function () { fail('page failed'); });
  }

  // ---------- ajax ----------
  function cdn(action, page, tr, extra, ok, fail) {
    var body = 'id=' + page.id +
      '&translator_id=' + tr.id +
      '&is_camrip=' + tr.camrip +
      '&is_ads=' + tr.ads +
      '&is_director=' + tr.director +
      '&action=' + action + (extra || '');

    get(BASE + '/ajax/get_cdn_series/?t=' + Date.now(), function (txt) {
      var json;
      try { json = JSON.parse(txt); } catch (e) { return fail('bad answer'); }
      if (!json || json.success === false) return fail((json && json.message) || 'not available');
      ok(json);
    }, function () { fail('stream request failed'); }, body);
  }

  function playFrom(json, title) {
    var q = parseQualities(decode(json.url));
    if (!q.best) return noty('no stream in answer');

    Lampa.Player.play({
      url: q.best,
      quality: q.map,       // gives the quality switcher in the player
      title: title
    });
  }

  // ---------- flows ----------
  function playMovie(page, tr, card) {
    noty('loading...');
    cdn('get_movie', page, tr, '', function (json) {
      playFrom(json, card.title || card.name);
    }, noty);
  }

  function playEpisode(page, tr, season, episode, card) {
    noty('loading...');
    cdn('get_stream', page, tr, '&season=' + season + '&episode=' + episode, function (json) {
      playFrom(json, (card.name || card.title) + ' S' + season + 'E' + episode);
    }, noty);
  }

  function pickSeries(page, tr, card) {
    noty('loading episodes...');
    cdn('get_episodes', page, tr, '', function (json) {
      var doc = new DOMParser().parseFromString('<div>' + (json.episodes || '') + '</div>', 'text/html');
      var seasons = {};

      doc.querySelectorAll('.b-simple_episode__item').forEach(function (el) {
        var s = el.getAttribute('data-season_id');
        var e = el.getAttribute('data-episode_id');
        if (!s || !e) return;
        (seasons[s] = seasons[s] || []).push({ title: el.textContent.trim() || ('Episode ' + e), ep: e });
      });

      var keys = Object.keys(seasons).sort(function (a, b) { return a - b; });
      if (!keys.length) return noty('no episodes');

      function showEpisodes(s) {
        Lampa.Select.show({
          title: 'Season ' + s,
          items: seasons[s].map(function (x) { return { title: x.title, ep: x.ep }; }),
          onSelect: function (a) { playEpisode(page, tr, s, a.ep, card); },
          onBack: function () { Lampa.Controller.toggle('content'); }
        });
      }

      if (keys.length === 1) return showEpisodes(keys[0]);

      Lampa.Select.show({
        title: 'HDRezka',
        items: keys.map(function (k) { return { title: 'Season ' + k, key: k }; }),
        onSelect: function (a) { showEpisodes(a.key); },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }, noty);
  }

  function openTitle(item, card) {
    noty('loading...');
    loadPage(item.url, function (page) {
      function go(tr) {
        if (page.isSeries) pickSeries(page, tr, card);
        else playMovie(page, tr, card);
      }

      if (page.translators.length === 1) return go(page.translators[0]);

      Lampa.Select.show({
        title: 'Озвучка',
        items: page.translators.map(function (t, i) { return { title: t.title, index: i }; }),
        onSelect: function (a) { go(page.translators[a.index]); },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }, noty);
  }

  function start(card) {
    noty('searching...');
    search(card, function (list) {
      if (!list.length) return noty('not found');
      if (list.length === 1) return openTitle(list[0], card);

      Lampa.Select.show({
        title: 'HDRezka',
        items: list,
        onSelect: function (a) { openTitle(a, card); },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }, noty);
  }

  // ---------- button on the card ----------
  function init() {
    Lampa.Listener.follow('full', function (e) {
      if (e.type !== 'complite') return;

      var render = e.object.activity.render();
      if (render.find('.view--hdrezka').length) return;

      var btn = $('<div class="full-start__button selector view--hdrezka"><span>HDRezka</span></div>');
      btn.on('hover:enter', function () { start(e.data.movie); });

      var anchor = render.find('.view--mykadri, .view--torrent').last();
      if (anchor.length) anchor.after(btn);
      else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
    });
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
