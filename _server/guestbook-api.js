/* TRJ 留言板 API
 * - GET  /api/guestbook  最近 60 条（只回公开字段，不回邮箱 / IP）
 * - POST /api/guestbook  落盘 data/guestbook.jsonl + 异步发邮件给站长
 * 凭据只在 config/mail.json，绝不进 public/。 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'guestbook.jsonl');
const CFG = path.join(ROOT, 'config', 'mail.json');

const MAX_ITEMS = 60;
const MAX_TEXT = 300;
const MAX_NICK = 20;
const GLASSES = ['glass-liquid', 'glass-fluted', 'glass-frosted'];
const RATE_GAP = 10 * 1000;          // 同 IP 两条之间至少 10 秒
const RATE_HOUR = 60 * 60 * 1000;
const RATE_HOUR_LIMIT = 20;
const hits = new Map();

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
  catch (e) { return null; }
}

function loadItems(limit) {
  try {
    const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])); } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

function publicItem(it) {
  return {
    id: it.id, nick: it.nick, text: it.text, time: it.time,
    glass: it.glass, c: it.c, r: it.r
  };
}

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || 'unknown';
}

function rateCheck(ip) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  let h = hits.get(ip);
  if (!h) { h = { last: 0, hourStart: now, hourCount: 0 }; hits.set(ip, h); }
  if (now - h.hourStart > RATE_HOUR) { h.hourStart = now; h.hourCount = 0; }
  if (now - h.last < RATE_GAP) return '贴得太快了，等几秒再试。';
  if (h.hourCount >= RATE_HOUR_LIMIT) return '今天贴得有点多，晚点再来。';
  h.last = now; h.hourCount += 1;
  return null;
}

function sendMail(item) {
  const cfg = readCfg();
  if (!cfg || !cfg.pass || !cfg.user || !cfg.to) {
    console.warn('[GUESTBOOK] mail config missing, saved only');
    return Promise.resolve(false);
  }
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (e) {
    console.warn('[GUESTBOOK] nodemailer missing:', e.message);
    return Promise.resolve(false);
  }

  const transport = nodemailer.createTransport({
    host: cfg.host || 'smtp.qq.com',
    port: cfg.port || 465,
    secure: cfg.secure !== false,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  const when = new Date(item.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const mail = {
    from: '"THE REGOLITH JAR" <' + cfg.user + '>',
    to: cfg.to,
    cc: cfg.cc || undefined,
    subject: '【TRJ 留言板】来自 ' + item.nick + ' 的新留言',
    text: [
      '留言板收到一条新留言。',
      '',
      '名字：' + item.nick,
      '时间：' + when,
      '邮箱：' + (item.email || '未填'),
      'IP：' + item.ip,
      '',
      '内容：',
      item.text,
      '',
      '---',
      'https://theregolithjar.monster/?page=5'
    ].join('\n'),
    html:
      '<div style="max-width:600px;margin:auto;padding:26px;font-family:-apple-system,Segoe UI,sans-serif;' +
      'background:#0d1220;color:#e9f1fa;border:1px solid rgba(196,222,232,.22);border-radius:14px">' +
      '<div style="font-size:10px;letter-spacing:.4em;color:#c9a227">THE REGOLITH JAR / GUESTBOOK</div>' +
      '<h2 style="font-weight:300;letter-spacing:.12em;margin:18px 0 22px">收到一条新留言</h2>' +
      '<table style="width:100%;font-size:12px;line-height:2;color:#b9cbe0">' +
      '<tr><td style="width:64px">名字</td><td style="color:#e9f1fa">' + esc(item.nick) + '</td></tr>' +
      '<tr><td>时间</td><td>' + esc(when) + '</td></tr>' +
      '<tr><td>邮箱</td><td>' + esc(item.email || '未填') + '</td></tr>' +
      '<tr><td>IP</td><td>' + esc(item.ip) + '</td></tr>' +
      '</table>' +
      '<div style="margin:22px 0 0;padding:16px 18px;border-left:2px solid #c9a227;' +
      'background:rgba(196,222,232,.06);font-size:14px;line-height:1.9;white-space:pre-wrap">' +
      esc(item.text) + '</div>' +
      '<p style="margin:24px 0 0;font-size:11px;color:#7f93ad">' +
      '留言已存到服务器 data/guestbook.jsonl，可在站点第 6 页查看。</p></div>'
  };

  return transport.sendMail(mail)
    .then(function () { console.log('[GUESTBOOK] mail sent', item.id); return true; })
    .catch(function (e) {
      console.error('[GUESTBOOK] mail failed', item.id, e.message);
      return false;
    });
}

function register(app) {
  app.get('/api/guestbook', function (req, res) {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, items: loadItems(MAX_ITEMS).map(publicItem) });
  });

  app.post('/api/guestbook', express.json({ limit: '8kb' }), function (req, res) {
    const b = req.body || {};
    const nick = clean(b.nick, MAX_NICK);
    const text = clean(b.text, MAX_TEXT);
    let email = clean(b.email, 80);
    const glass = GLASSES.indexOf(b.glass) >= 0 ? b.glass : GLASSES[0];
    const c = Math.min(5, Math.max(3, parseInt(b.c, 10) || 3));
    const r = Math.min(9, Math.max(5, parseInt(b.r, 10) || 7));
    const ip = clientIp(req);

    // 蜜罐：机器人填了隐藏字段就静默"成功"，不落盘不发信
    if (b.website) {
      const fake = {
        id: 'hp', nick: nick || '匿名', text: text || '', time: new Date().toISOString(),
        glass: glass, c: c, r: r
      };
      return res.json({ ok: true, item: publicItem(fake) });
    }
    if (!nick) return res.status(400).json({ ok: false, msg: '写个名字吧。' });
    if (!text) return res.status(400).json({ ok: false, msg: '还没写内容。' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
    if ((text.match(/https?:\/\/|www\./gi) || []).length >= 3) {
      return res.status(400).json({ ok: false, msg: '链接太多了。' });
    }
    const rateErr = rateCheck(ip);
    if (rateErr) return res.status(429).json({ ok: false, msg: rateErr });

    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      nick: nick, text: text, email: email,
      glass: glass, c: c, r: r,
      time: new Date().toISOString(),
      ip: ip
    };

    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(FILE, JSON.stringify(item) + '\n', 'utf8');
    } catch (e) {
      console.error('[GUESTBOOK] write failed', e.message);
      return res.status(500).json({ ok: false, msg: '没存上，稍后再试。' });
    }

    // 留言已落盘，邮件异步发；失败只进日志，不影响用户
    sendMail(item).catch(function () {});
    res.json({ ok: true, item: publicItem(item) });
  });
}

module.exports = { register: register };
