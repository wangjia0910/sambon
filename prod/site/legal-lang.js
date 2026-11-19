/**
 * 三宝殿 · 法务页语言落地脚本（同源外部脚本，兼容严格 CSP: script-src 'self'）
 *
 * 背景：legal.html 的双语切换由 radio + :has() 纯 CSS 实现，本身不读取 URL。
 * 但页面声明了 hreflang=zh-CN/en → legal.html?lang=zh-CN / ?lang=en，
 * 若落地 URL 不切换语言，会违反 hreflang 语义（英文 URL 显示中文）。
 * 本脚本只做一件事：按 URL 的 ?lang= 勾选对应 radio，其余渲染仍交给纯 CSS。
 * 无 ?lang= 或值非法时保持默认（中文），不影响既有行为；无外部依赖、无网络请求。
 */
(function () {
  'use strict';
  var lang = null;
  try { lang = new URLSearchParams(location.search).get('lang'); } catch (e) { /* 保留默认 */ }
  if (lang !== 'en' && lang !== 'zh-CN') return;
  var radio = document.getElementById(lang === 'en' ? 'doc-lang-en' : 'doc-lang-zh');
  if (radio) radio.checked = true;
})();
