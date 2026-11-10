/* TRJ 留言板：随机长宽的玻璃便签 + 提交后邮件通知站长 */
(function () {
  'use strict';
  var grid = document.getElementById('gb-grid');
  var form = document.getElementById('gb-form');
  if (!grid || !form) return;

  var GLASSES = ['glass-liquid', 'glass-fluted', 'glass-frosted'];
  var statusEl = document.getElementById('gb-status');
  var submitEl = document.getElementById('gb-submit');
  var nickEl = document.getElementById('gb-nick');
  var mailEl = document.getElementById('gb-email');
  var textEl = document.getElementById('gb-text');
  var hpEl = document.getElementById('gb-website');

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function setStatus(msg, cls) {
    statusEl.textContent = msg || '';
    statusEl.className = 'gb-status' + (cls ? ' ' + cls : '');
  }
  function glassOf(g) { return GLASSES.indexOf(g) >= 0 ? g : pick(GLASSES); }
  function spanOf(v, min, max, dflt) {
    v = parseInt(v, 10);
    return (isNaN(v) || v < min || v > max) ? dflt : v;
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  function makeNote(item) {
    var el = document.createElement('article');
    el.className = 'note ' + glassOf(item.glass);
    el.style.setProperty('--c', spanOf(item.c, 3, 5, rnd(3, 5)));
    el.style.setProperty('--r', spanOf(item.r, 5, 9, rnd(5, 9)));

    var top = document.createElement('div'); top.className = 'note-top';
    var nick = document.createElement('span'); nick.className = 'note-nick';
    nick.textContent = item.nick || '匿名';
    var time = document.createElement('span'); time.className = 'note-time';
    time.textContent = fmtTime(item.time);
    top.appendChild(nick); top.appendChild(time);

    var text = document.createElement('p'); text.className = 'note-text';
    text.textContent = item.text || '';
    var seal = document.createElement('span'); seal.className = 'note-seal';
    seal.textContent = 'TRJ';

    el.appendChild(top); el.appendChild(text); el.appendChild(seal);
    return el;
  }

  function render(items) {
    Array.prototype.forEach.call(
      grid.querySelectorAll('.note:not(.gb-form), .gb-empty'),
      function (n) { n.remove(); }
    );
    if (!items || !items.length) {
      var empty = document.createElement('div');
      empty.className = 'gb-empty';
      empty.textContent = '还没有留言，贴第一张吧。';
      grid.appendChild(empty);
      return;
    }
    items.forEach(function (it, i) {
      var n = makeNote(it);
      n.style.animationDelay = Math.min(i * 32, 640) + 'ms';
      grid.appendChild(n);
    });
  }

  function load() {
    fetch('/api/guestbook', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) render(d.items || []); })
      .catch(function () {});
  }

  try {
    var saved = localStorage.getItem('gb-nick');
    if (saved) nickEl.value = saved;
  } catch (e) {}

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var nick = (nickEl.value || '').trim();
    var text = (textEl.value || '').trim();
    var email = (mailEl.value || '').trim();
    if (!nick) { setStatus('写个名字吧。', 'err'); nickEl.focus(); return; }
    if (!text) { setStatus('还没写内容。', 'err'); textEl.focus(); return; }
    if (text.length > 300) { setStatus('最多 300 字。', 'err'); return; }

    submitEl.disabled = true;
    setStatus('正在贴上…');
    var payload = {
      nick: nick, email: email, text: text,
      glass: pick(GLASSES), c: rnd(3, 5), r: rnd(5, 9),
      website: hpEl ? hpEl.value : ''
    };

    fetch('/api/guestbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, body: d }; });
      })
      .then(function (res) {
        if (res.status !== 200 || !res.body || !res.body.ok) {
          setStatus((res.body && res.body.msg) || '没贴上去，稍后再试。', 'err');
          return;
        }
        textEl.value = '';
        setStatus('已贴上，也发到站长的邮箱了。', 'ok');
        var empty = grid.querySelector('.gb-empty');
        if (empty) empty.remove();
        var n = makeNote(res.body.item || payload);
        n.style.animationDelay = '0ms';
        grid.insertBefore(n, form.nextSibling);
        try { localStorage.setItem('gb-nick', nick); } catch (e) {}
      })
      .catch(function () { setStatus('连不上服务器，稍后再试。', 'err'); })
      .then(function () { submitEl.disabled = false; });
  });

  load();
})();
