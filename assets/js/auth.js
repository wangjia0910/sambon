/*
 * auth.js — 三宝殿登录系统（本地演示版）
 * 重要：纯前端、localStorage 存储，密码仅做轻量编码，**不具备任何真实安全性**。
 *   生产环境请改用 Cloudflare Access（零信任）或 Cloudflare Workers + KV 做真实验证与同八字用户关联。
 * 本模块职责：注册 / 登录 / 退出 / 当前会话，以及按用户保存八字档案（含八字指纹，为后期同八字社群预留）。
 */
(function (root) {
  'use strict';
  var ACC = 'sambon_accounts';   // { 用户名: {pass, created} }
  var SES = 'sambon_session';    // { name, loginAt }

  function rd(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function wr(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function rm(k) { localStorage.removeItem(k); }

  // 轻量编码，仅防明文裸露，绝非加密
  function obf(p) { var o = ''; for (var i = 0; i < p.length; i++) o += String.fromCharCode(p.charCodeAt(i) + 3); return o; }
  function list() { return rd(ACC) || {}; }

  function register(name, pass) {
    name = (name || '').trim();
    if (!name) return { ok: false, msg: '请填写用户名' };
    if (!pass || pass.length < 4) return { ok: false, msg: '密码至少 4 位' };
    var a = list();
    if (a[name]) return { ok: false, msg: '该用户名已存在，请直接登录' };
    a[name] = { pass: obf(pass), created: Date.now() };
    wr(ACC, a);
    wr(SES, { name: name, loginAt: Date.now() });
    return { ok: true, msg: '注册成功，已自动登录', name: name };
  }

  function login(name, pass) {
    name = (name || '').trim();
    var a = list();
    var u = a[name];
    if (!u) return { ok: false, msg: '用户不存在，请先注册' };
    if (u.pass !== obf(pass)) return { ok: false, msg: '密码错误' };
    wr(SES, { name: name, loginAt: Date.now() });
    return { ok: true, msg: '登录成功', name: name };
  }

  function logout() { rm(SES); }
  function me() { return rd(SES); }
  function isLogin() { return !!rd(SES); }

  // 按用户保存/读取八字档案（含八字指纹，供后期同八字社群匹配）
  function setProfile(p) {
    var m = rd(SES); if (!m) return false;
    wr('sambon_profile_' + m.name, p);
    return true;
  }
  function getProfile() {
    var m = rd(SES); if (!m) return null;
    return rd('sambon_profile_' + m.name);
  }

  root.Auth = {
    register: register, login: login, logout: logout, me: me, isLogin: isLogin,
    setProfile: setProfile, getProfile: getProfile
  };
})(typeof self !== 'undefined' ? self : this);
