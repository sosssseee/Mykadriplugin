(function () {
  'use strict';

  if (window.mykadri_plugin) return;
  window.mykadri_plugin = true;

  var BASE = 'https://mykadri.tv';
  // optional CORS proxy prefix, e.g. 'https://my-proxy.example/' (empty = direct)
  var PROXY = 'https://shiny-sea-8fb3.soseliagocha19.workers.dev/';
  var net = new Lampa.Reguest();
  var hash = '';

  // ---------- network ----------
  function get(url, ok, fail, post) {
    var params = { dataType: 'text' };
    url = PROXY + url;

    // native first (no CORS limits on Android/Tizen/WebOS apps), then plain ajax
    net.native(url, ok, function () {
      net.silent(url, ok, function (err) {
        fail(err || 'request failed');
      }, post || false, params);
    }, post || false, params);
  }

  // DLE puts a session token into the page as dle_login_hash
  function getHash(ok, fail) {
    if (hash) return ok(hash);
    get(BASE + '/', function (html) {
      var m = String(html).match(/dle_login_hash\s*=\s*['"]([a-f0-9]+)['"]/i);
      if (!m) return fail('no user_hash');
      hash = m[1];
      ok(hash);
    }, function (e) { fail('home page failed' + (e && e.status !== undefined ? ' (' + e.status + ')' : '')); });
  }

  // ---------- search ----------
  function search(query, ok, fail) {
    getHash(function (h) {
      var body = 'query=' + encodeURIComponent(query) + '&user_hash=' + h;

      get(BASE + '/engine/ajax/controller.php?mod=search', function (html) {
        var doc = new DOMParser().parseFromString(String(html), 'text/html');
        var seen = {};
        var list = [];

        doc.querySelectorAll('a[href]').forEach(function (a) {
          var href = a.getAttribute('href') || '';
          var title = (a.textContent || '').replace(/\s+/g, ' ').trim();

          if (!/\/\d+-[^\/]*\.html/.test(href) || !title || seen[href]) return;
          seen[href] = 1;

          if (href.indexOf('http') !== 0) {
            href = BASE + (href.charAt(0) === '/' ? '' : '/') + href;
          }
          list.push({ title: title, url: href });
        });

        ok(list);
      }, function () { fail('search failed'); }, body);
    }, fail);
  }

  // ---------- stream extraction ----------
  // The movie page contains: movie: [{"label":"...","sources":[{"label":"720p","type":"hls","file":"https://cdn2.mykadri.net/.../playlist.m3u8"}]}]
  function getStream(url, ok, fail) {
    get(url, function (html) {
      var re = /"label"\s*:\s*"([^"]*)"\s*,\s*"type"\s*:\s*"hls"\s*,\s*"file"\s*:\s*"([^"]+)"/g;
      var quality = {};
      var first = '';
      var m;

      html = String(html);
      while ((m = re.exec(html))) {
        var link = m[2].replace(/\\\//g, '/');
        quality[m[1]] = link;
        if (!first) first = link;
      }

      if (!first) return fail('no stream');
      ok(first, quality);
    }, fail);
  }

  // ---------- play ----------
  function play(item, card) {
    Lampa.Noty.show('mykadri: loading...');

    getStream(item.url, function (url, quality) {
      Lampa.Player.play({
        url: url,
        quality: quality,
        title: card.title || card.name || item.title
      });
    }, function () {
      Lampa.Noty.show('mykadri: stream not found');
    });
  }

  function start(card) {
    var q = card.original_title || card.original_name || card.title || card.name;
    Lampa.Noty.show('mykadri: searching...');

    search(q, function (list) {
      if (!list.length) return Lampa.Noty.show('mykadri: nothing found');
      if (list.length === 1) return play(list[0], card);

      Lampa.Select.show({
        title: 'mykadri.tv',
        items: list,
        onSelect: function (a) { play(a, card); },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }, function (err) {
      Lampa.Noty.show('mykadri: ' + (typeof err === 'string' ? err : 'request failed'));
    });
  }

  // ---------- button on the movie card ----------
  function init() {
    Lampa.Listener.follow('full', function (e) {
      if (e.type !== 'complite') return;

      var render = e.object.activity.render();
      if (render.find('.view--mykadri').length) return;

      var btn = $(
        '<div class="full-start__button selector view--mykadri">' +
          '<span>ქართულად</span>' +
        '</div>'
      );

      btn.on('hover:enter', function () {
        start(e.data.movie);
      });

      var anchor = render.find('.view--torrent');
      if (anchor.length) anchor.after(btn);
      else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
    });
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
