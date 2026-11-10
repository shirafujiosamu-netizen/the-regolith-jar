/* 欢迎页同款星空：真实星表 + 用户定位 + 当前时刻，canvas 2D 绘制。
 * 与主页 WebGL 场景数据源一致（/data/stars.json），但不常驻 rAF：
 * 天球 60 秒重算一次，漂移交给 CSS 合成层，页面隐藏时挂起。 */
(function () {
  'use strict';
  var host = document.getElementById('sky');
  var canvas = document.getElementById('skyCanvas');
  if (!host || !canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var DEG = Math.PI / 180;
  var lon = 121.47, lat = 31.23;   // 定位不可用时的默认值：上海
  var catalog = [];
  var W = 0, H = 0, dpr = 1;
  var timer = null;
  var disposed = false;

  function julian(d) { return d.getTime() / 86400000 + 2440587.5; }
  function gmstDeg(d) {
    var jd = julian(d), T = (jd - 2451545.0) / 36525;
    var g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
          + 0.000387933 * T * T - T * T * T / 38710000;
    return ((g % 360) + 360) % 360;
  }
  // 赤经/赤纬 -> 地平坐标（高度角 / 方位角）
  function altAz(raHours, decDeg, date, longitude, latitude) {
    var lst = (gmstDeg(date) + longitude + 360) % 360;
    var Ha = ((lst - raHours * 15) % 360 + 360) % 360 * DEG;
    var dec = decDeg * DEG, phi = latitude * DEG;
    var sinAlt = Math.sin(dec) * Math.sin(phi)
               + Math.cos(dec) * Math.cos(phi) * Math.cos(Ha);
    var alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    var ca = (Math.sin(dec) - Math.sin(phi) * Math.sin(alt))
           / (Math.cos(phi) * Math.cos(alt) || 1e-6);
    var A = Math.acos(Math.max(-1, Math.min(1, ca)));
    var az = Math.sin(Ha) < 0 ? A / DEG : 360 - A / DEG;
    return { alt: alt / DEG, az: az };
  }

  function fallback() {
    var out = [];
    for (var i = 0; i < 1100; i++) {
      out.push([Math.random() * 24, Math.random() * 180 - 90,
                Math.random() * 6.2, Math.random() * 1.4 - 0.2]);
    }
    return out;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, host.clientWidth || window.innerWidth);
    H = Math.max(1, host.clientHeight || window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (disposed || document.hidden) return;
    if (!W || !H) resize();
    var g = ctx.createRadialGradient(W * 0.5, H * 0.44, 0, W * 0.5, H * 0.44, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#0a0d1c');
    g.addColorStop(0.55, '#060814');
    g.addColorStop(1, '#03040a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 极淡的银河雾，只叠两层，不用贴图
    var mist = ctx.createRadialGradient(W * 0.22, H * 0.18, 0, W * 0.22, H * 0.18, W * 0.62);
    mist.addColorStop(0, 'rgba(120,140,220,0.055)');
    mist.addColorStop(1, 'rgba(120,140,220,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, 0, W, H);

    var now = new Date();
    var fov = 112;                    // 水平视场
    var centerAz = 180;               // 朝南
    var halfW = W / 2, halfH = H / 2;
    for (var i = 0; i < catalog.length; i++) {
      var s = catalog[i];
      var p = altAz(s[0], s[1], now, lon, lat);
      if (p.alt < -4) continue;
      var dAz = ((p.az - centerAz + 540) % 360) - 180;
      if (Math.abs(dAz) > fov / 2) continue;
      var x = halfW + (dAz / (fov / 2)) * halfW * 1.18;
      var y = halfH + ((34 - p.alt) / 76) * H * 1.16;
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;

      var mag = s[2], bv = s[3] || 0.6;
      if (mag > 6.1) continue;
      var light = Math.max(0.16, Math.min(1, (6.4 - mag) / 6.4));
      var size = mag < 1.6 ? 1.65 : mag < 3.4 ? 1.05 : mag < 5 ? 0.72 : 0.5;
      var col = bv < 0.1 ? '190,214,255' : bv < 0.7 ? '245,247,255'
              : bv < 1.3 ? '255,238,210' : '255,208,178';
      ctx.fillStyle = 'rgba(' + col + ',' + (light * 0.92).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      if (mag < 1.2) {
        ctx.fillStyle = 'rgba(' + col + ',' + (light * 0.09).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, size * 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(draw, 60000);       // 天球 1 分钟重算足够
  }

  function start(cat) {
    catalog = cat && cat.length ? cat : fallback();
    resize();
    draw();
    schedule();
  }

  if (navigator.geolocation) {
    try {
      navigator.geolocation.getCurrentPosition(function (pos) {
        lon = pos.coords.longitude;
        lat = pos.coords.latitude;
        draw();
      }, function () {}, { timeout: 6000, maximumAge: 600000 });
    } catch (e) {}
  }

  // 先用兜底星表立刻铺满，真实星表到达后再替换，避免慢网下首屏纯黑
  start(null);
  fetch('/data/stars.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.length) { catalog = d; draw(); }
    })
    .catch(function () {});

  window.addEventListener('resize', function () { resize(); draw(); }, { passive: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) draw(); });
  window.addEventListener('pagehide', function () { disposed = true; if (timer) clearInterval(timer); });
})();
