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

  // try several spellings of the title and merge the results
  function searchMulti(card, ok, fail) {
    var raw = [
      card.original_title, card.original_name, card.title, card.name
    ];
    var queries = [];
    function add(q) {
      q = (q || '').replace(/\s+/g, ' ').trim();
      if (q.length >= 3 && queries.indexOf(q) < 0) queries.push(q);
    }
    raw.forEach(function (t) {
      add(t);
      add((t || '').replace(/[:\-–—].*$/, ''));        // drop subtitle
      add((t || '').replace(/[^\w\s\u00C0-\u024F\u0400-\u04FF]/g, ' ')); // drop punctuation
    });
    queries = queries.slice(0, 5);

    var all = [], seen = {}, i = 0, lastErr = '';
    (function next() {
      if (i >= queries.length) return all.length ? ok(all) : (lastErr ? fail(lastErr) : ok([]));
      search(queries[i++], function (list) {
        list.forEach(function (it) { if (!seen[it.url]) { seen[it.url] = 1; all.push(it); } });
        if (all.length >= 8) return ok(all);
        next();
      }, function (e) { lastErr = e; next(); });
    })();
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

      // series: playlist: {"1":[{"title":"..","languages":[{"label":"..","sources":[{"file":"..","type":"hls"}]}]}], "2":[...]}
      var seasons = parsePlaylist(html);
      if (seasons) return ok(null, null, seasons);

      // movie: take only the Georgian panel / movie: [...] block when present
      var mi = html.indexOf('movie:');
      var block = mi >= 0 ? html.slice(mi, mi + 4000) : html;

      while ((m = re.exec(block))) {
        var link = m[2].replace(/\\\//g, '/');
        quality[m[1]] = link;
        if (!first) first = link;
      }

      // fallback: any m3u8/mp4 file url inside the movie block, any key order
      if (!first) {
        var re2 = /"file"\s*:\s*"(https?:[^"]+?\.(?:m3u8|mp4)[^"]*)"/g;
        while ((m = re2.exec(block))) {
          var l2 = m[1].replace(/\\\//g, '/');
          quality['auto'] = l2;
          if (!first) first = l2;
        }
      }

      // Russian dub lives in a third-party iframe panel (movie-rus)
      var rm = html.match(/data-player-id="movie-rus"[\s\S]{0,800}?data-src="([^"]+)"/);
      var rus = rm ? rm[1].replace(/&amp;/g, '&') : '';

      if (!first && !rus) return fail('no stream');
      ok(first, quality, null, rus);
    }, fail);
  }

  function parsePlaylist(html) {
    var i = html.indexOf('playlist:');
    if (i < 0) return null;
    var s = html.indexOf('{', i);
    if (s < 0) return null;

    // balanced-brace scan (respects strings)
    var depth = 0, inStr = false, esc = false, e = -1;
    for (var k = s; k < html.length; k++) {
      var c = html.charAt(k);
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { e = k; break; } }
    }
    if (e < 0) return null;

    var data;
    try { data = JSON.parse(html.slice(s, e + 1)); } catch (x) { return null; }

    var out = [];
    Object.keys(data).sort(function (a, b) { return a - b; }).forEach(function (num) {
      var eps = [];
      (data[num] || []).forEach(function (ep) {
        var lang = (ep.languages || [])[0];
        var src = lang && (lang.sources || [])[0];
        if (src && src.file) eps.push({ title: ep.title || 'Episode', url: src.file.replace(/\\\//g, '/') });
      });
      if (eps.length) out.push({ season: num, episodes: eps });
    });
    return out.length ? out : null;
  }

  // Russian: open the iframe page and look for a direct m3u8/mp4 inside it
  function playRussian(iframeUrl, card) {
    Lampa.Noty.show('mykadri: loading Russian...');

    get(iframeUrl, function (html) {
      html = String(html).replace(/\\\//g, '/');
      var m = html.match(/https?:\/\/[^"'\s\\<>]+?\.m3u8[^"'\s\\<>]*/i) ||
              html.match(/https?:\/\/[^"'\s\\<>]+?\.mp4[^"'\s\\<>]*/i);

      if (!m) return Lampa.Noty.show('mykadri: Russian player hides the link');

      Lampa.Player.play({
        url: m[0],
        title: (card.title || card.name || '') + ' (RU)'
      });
    }, function () {
      Lampa.Noty.show('mykadri: Russian player failed');
    });
  }

  function playEpisodes(eps, index, card) {
    var pl = eps.map(function (ep) {
      return { title: (card.name || card.title || '') + ' - ' + ep.title, url: ep.url };
    });
    Lampa.Player.play(pl[index]);
    Lampa.Player.playlist(pl);
  }

  function pickEpisode(season, card) {
    Lampa.Select.show({
      title: 'Season ' + season.season,
      items: season.episodes.map(function (ep, i) { return { title: ep.title, index: i }; }),
      onSelect: function (a) { playEpisodes(season.episodes, a.index, card); },
      onBack: function () { Lampa.Controller.toggle('content'); }
    });
  }

  function pickSeason(seasons, card) {
    if (seasons.length === 1) return pickEpisode(seasons[0], card);

    Lampa.Select.show({
      title: 'mykadri.tv',
      items: seasons.map(function (s, i) { return { title: 'Season ' + s.season, index: i }; }),
      onSelect: function (a) { pickEpisode(seasons[a.index], card); },
      onBack: function () { Lampa.Controller.toggle('content'); }
    });
  }

  // ---------- play ----------
  function play(item, card) {
    Lampa.Noty.show('mykadri: loading...');

    getStream(item.url, function (url, quality, seasons, rus) {
      if (seasons) return pickSeason(seasons, card);

      if (!url && rus) return playRussian(rus, card);

      if (url && rus) {
        return Lampa.Select.show({
          title: 'mykadri.tv',
          items: [
            { title: 'ქართულად (Georgian)', ka: true },
            { title: 'Русская озвучка', ru: true }
          ],
          onSelect: function (a) {
            if (a.ru) return playRussian(rus, card);
            Lampa.Player.play({ url: url, quality: quality, title: card.title || card.name || item.title });
          },
          onBack: function () { Lampa.Controller.toggle('content'); }
        });
      }

      Lampa.Player.play({
        url: url,
        quality: quality,
        title: card.title || card.name || item.title
      });
    }, function () {
      Lampa.Noty.show('mykadri: no Georgian stream on this page');
    });
  }

  function start(card) {
    Lampa.Noty.show('mykadri: searching...');

    searchMulti(card, function (list) {
      if (!list.length) return Lampa.Noty.show('mykadri: not on the site');
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
