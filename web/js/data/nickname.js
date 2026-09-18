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

  /* 构词模板：{c} 代表用字，{cc} 代表叠字 */
  NS.NICKNAME_PATTERNS = [
    { id: 'repeat', label: '叠字', build: function (c) { return c + c; }, weight: 1.0 },
    { id: 'xiao', label: '小+字', build: function (c) { return '小' + c; }, weight: 0.85 },
    { id: 'a', label: '阿+字', build: function (c) { return '阿' + c; }, weight: 0.7 },
    { id: 'er', label: '字+儿', build: function (c) { return c + '儿'; }, weight: 0.6 },
    { id: 'single', label: '单字', build: function (c) { return c; }, weight: 0.5 }
  ];

  /* 前缀/后缀字的读音，用于谐音检测（这些字不在字库里，需要自带读音） */
  NS.NICKNAME_AFFIX_PINYIN = {
    '小': { pinyin: 'xiao', tone: 3 },
    '阿': { pinyin: 'a', tone: 1 },
    '儿': { pinyin: 'er', tone: 2 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
