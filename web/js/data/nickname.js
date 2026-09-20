/* =========================================================================
 * nickname.js —— 小名（乳名）用字与构词规则
 *
 * 设计取舍：小名不重新生成，而是**从已选中的大名里衍生**。
 * 理由：用户已经认可了这个大名（字义、五行都合适），小名只要好叫、亲切、
 * 没有谐音问题就够了，没必要再引入一套独立的用字库和评分体系。
 *
 * 常见小名构词法（按使用频率）：
 *   叠字      涵涵 / 朵朵            —— 最普遍
 *   小 + 字   小满 / 小团            —— 通用
 *   阿 + 字   阿宝 / 阿妹            —— 江南、闽粤一带
 *   字 + 儿   可儿 / 宝儿            —— 偏书面、秀气
 *   直接取一字 霖 / 朵               —— 单字叫，干脆
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 小名友好字：这些字叠字或加前缀后特别顺口、亲切。
   * 只列字库里真实存在的字——列字库外的字等于永远不生效。 */
  NS.NICKNAME_FRIENDLY = (function () {
    var m = Object.create(null);
    ('安 宁 佳 宜 恬 悦 暖 阳 云 雨 雪 露 圆 盈 心 念 恩 瑞 灵 秀 清 明 ' +
      '亮 和 平 珍 珠 沐 涵 萱 韵 婉 嫣 珊 琪 瑾 悠 予 羽 亦 唯 芷 芸 芊 ' +
      '芮 茉 菡 蕾 薇 梅 桃 桐 竹 笛 熙 昭 晗 昕 晴 彤 丹 曦 岚 雯 霖 ' +
      '汐 沁 洛 潇 湘 仙 倩 素 纯 舒 书 诗 碧 贝 慧 敏 惠 恒 友 依 容 ' +
      '园 叶 瑛 娅 忆 若 梦 柔 佳 宁 安').split(/\s+/)
      .forEach(function (c) { if (c.length === 1) m[c] = 1; });
    return m;
  })();

  /* 小名不那么友好的字：叠字后容易被笑或拗口（硬、肃、大气的用字） */
  NS.NICKNAME_AWKWARD = (function () {
    var m = Object.create(null);
    ('铁 钢 锋 剑 戈 铠 镇 帝 廷 权 岳 峰 峻 峥 嵘 崇 嵩 岩 苍 坚 伟 勇 ' +
      '刚 德 礼 律 则 创 士 壮 利 秋 冬 寒 冰 凝 凌 坤 垚 城 基 培 垣 山 ' +
      '圣 杰 桦 榛 栗 榕 棋 策 箫 简').split(/\s+/)
      .forEach(function (c) { if (c.length === 1) m[c] = 1; });
    return m;
  })();

  /* 构词模板。
   *
   * build(char, fullName) 里 {c} 是用字、{cc} 是叠字、{full} 是大名两字。
   *
   * 为什么要加这么多：用户反馈「小名也可以多样化，也不一定是叠词」。
   * 旧版只有 5 种（叠字/小X/阿X/X儿/单字），而且**只返回分数最高的一个**，
   * 叠字权重又最高（1.0），所以永远只给出叠词 —— 那不是「最合适」，
   * 是评分把其他构词法全压住了。
   *
   * 现在改两处：
   *   1. 构词法扩到 15 种，覆盖北方（X妞/X哥）、南方（X妹/X仔）、
   *      通用（X宝/X子）、以及「直接叫大名」（清和 / 小清和）
   *   2. 返回**一组**候选，且强制构词法不重复（见 core/nickname.js）
   *
   * suffix 字段是给后缀字的读音用的（这些字不在字库里，要自带拼音）。 */
  NS.NICKNAME_PATTERNS = [
    /* ---- 单字衍生 ---- */
    { id: 'repeat', label: '叠字', suffix: null, weight: 1.00, gender: null,
      build: function (c) { return c + c; } },
    { id: 'xiao', label: '小+字', suffix: null, weight: 0.86, gender: null,
      build: function (c) { return '小' + c; } },
    { id: 'bao', label: '字+宝', suffix: '宝', weight: 0.78, gender: null,
      build: function (c) { return c + '宝'; } },
    { id: 'a', label: '阿+字', suffix: null, weight: 0.72, gender: null,
      build: function (c) { return '阿' + c; } },
    { id: 'er', label: '字+儿', suffix: '儿', weight: 0.66, gender: null,
      build: function (c) { return c + '儿'; } },
    { id: 'zi', label: '字+子', suffix: '子', weight: 0.58, gender: null,
      build: function (c) { return c + '子'; } },
    { id: 'mei', label: '字+妹', suffix: '妹', weight: 0.54, gender: '女',
      build: function (c) { return c + '妹'; } },
    { id: 'zai', label: '字+仔', suffix: '仔', weight: 0.52, gender: '男',
      build: function (c) { return c + '仔'; } },
    { id: 'single', label: '单字', suffix: null, weight: 0.50, gender: null,
      build: function (c) { return c; } },
    { id: 'niu', label: '字+妞', suffix: '妞', weight: 0.46, gender: '女',
      build: function (c) { return c + '妞'; } },
    { id: 'ge', label: '字+哥', suffix: '哥', weight: 0.44, gender: '男',
      build: function (c) { return c + '哥'; } },
    { id: 'xiaoDie', label: '小+叠字', suffix: null, weight: 0.48, gender: null,
      build: function (c) { return '小' + c + c; } },

    /* ---- 双字（用整个大名）---- */
    { id: 'full', label: '直接叫', suffix: null, weight: 0.92, gender: null,
      needFull: true,
      build: function (c, full) { return full; } },
    { id: 'xiaofull', label: '小+两字', suffix: null, weight: 0.56, gender: null,
      needFull: true,
      build: function (c, full) { return '小' + full; } }
  ];

  /* 前缀/后缀字的读音，用于谐音检测（这些字不在字库里，需要自带读音） */
  NS.NICKNAME_AFFIX_PINYIN = {
    '小': { pinyin: 'xiao', tone: 3 },
    '阿': { pinyin: 'a', tone: 1 },
    '儿': { pinyin: 'er', tone: 2 },
    '宝': { pinyin: 'bao', tone: 3 },
    '子': { pinyin: 'zi', tone: 3 },
    '妹': { pinyin: 'mei', tone: 4 },
    '仔': { pinyin: 'zai', tone: 3 },
    '妞': { pinyin: 'niu', tone: 1 },
    '哥': { pinyin: 'ge', tone: 1 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
