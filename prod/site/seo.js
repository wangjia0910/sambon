/* ==========================================================================
 * Sambon · 结构化数据注入（SEO / AEO）
 *
 * 设计要点：
 *  1. 生产页 CSP 为 script-src 'self'，禁止内联 <script>。本文件作为同源
 *     外部脚本由 <script src="/seo.js"> 加载，运行时创建
 *     <script type="application/ld+json"> 注入 document.head —— Google 明确
 *     支持"JavaScript 生成的结构化数据"，且该做法不弱化 CSP。
 *  2. 结构化数据只描述站点真实属性与公开信息，零 PII、零用户数据、
 *     不宣称"已上线/已通过备案/官方认证"，严守合规红线。
 *  3. 核心语义锚点：品牌口号「无事不登三宝殿」+ 悬赏互助定位。
 * ========================================================================== */
(function () {
  'use strict';

  var ORG = {
    '@type': 'Organization',
    '@id': 'https://sambon.net/#organization',
    name: '三宝殿 · Sambon',
    alternateName: ['三宝殿', 'Sambon', '无事不登三宝殿'],
    url: 'https://sambon.net/',
    description: '面向全球的悬赏互助平台：发布悬赏、接单履约，以平台内贡献积分 SBC 记录声望。',
    slogan: '无事不登三宝殿',
    foundingDate: '2026',
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'privacy',
      email: 'privacy@sambon.net',
      availableLanguage: ['zh-CN', 'en']
    }]
  };

  var WEBSITE = {
    '@type': 'WebSite',
    '@id': 'https://sambon.net/#website',
    url: 'https://sambon.net/',
    name: '三宝殿 · 悬赏互助平台',
    alternateName: 'Sambon Bounty Hunters Guild',
    inLanguage: ['zh-CN', 'en'],
    publisher: { '@id': 'https://sambon.net/#organization' },
    description: '无事不登三宝殿。悬赏互助平台：任务大厅、赏金猎人榜、发布悬赏、SBC 平台内贡献积分。',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://sambon.net/#/hall?q={search_term_string}'
      },
      'query-input': 'required name=search_term_string'
    }
  };

  var FAQ = {
    '@type': 'FAQPage',
    '@id': 'https://sambon.net/#faq',
    mainEntity: [
      {
        '@type': 'Question',
        name: '什么是三宝殿？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '三宝殿（sambon.net）是一个悬赏互助平台。发布方发布带验收标准的悬赏任务，接单人接单并交付成果，平台用 SBC 平台内贡献积分记录贡献与声望。口号是「无事不登三宝殿」。'
        }
      },
      {
        '@type': 'Question',
        name: '「无事不登三宝殿」在这里是什么意思？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '它既是平台名称的记忆点，也是产品隐喻：有需要解决的事，就来三宝殿发布悬赏；猎人有能力解决事，就来接单。无事不登三宝殿，有事必有所托。'
        }
      },
      {
        '@type': 'Question',
        name: 'SBC 是什么？可以兑换现金吗？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'SBC（Sambon Credit）是三宝殿平台内的贡献积分，用于度量贡献与兑换平台内权益。它不是加密资产、不是支付工具，不可兑付法币、不可转让、不设二级市场、无收益承诺。'
        }
      },
      {
        '@type': 'Question',
        name: '什么是任务大厅和赏金猎人榜？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '任务大厅展示开放的悬赏委托，可按状态与分类浏览；赏金猎人榜按完成数、净 SBC、准时率等维度对接单人排名。榜单使用版本化权重，争议任务降权，关闭个性化后按时间与距离中性排序。'
        }
      }
    ]
  };

  var GRAPH = {
    '@context': 'https://schema.org',
    '@graph': [ORG, WEBSITE, FAQ]
  };

  try {
    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(GRAPH);
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    // 注入失败不应影响页面主功能；结构化数据为增强项，静默降级。
    if (window.console && console.warn) console.warn('[sambon-seo] structured data injection failed', e);
  }
})();
