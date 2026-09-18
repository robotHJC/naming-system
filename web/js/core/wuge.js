/* =========================================================================
 * wuge.js —— 三才五格（姓名学数理）
 *
 * 支持单姓/复姓 × 单名/双名 四种组合，公式按姓名学通行规则。
 * 数理五行取「个位数字」：1,2 木 · 3,4 火 · 5,6 土 · 7,8 金 · 9,0 水。
 * 三才吉凶沿用原 Python 版的判定表（相生/比和为吉，相克为中吉）。
 *
 * ⚠️ 笔画须用康熙笔画，且三才五格属「数理派」，与八字喜用神未必一致，
 *    界面上仅作参考显示，不参与主要评分权重过高。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /** 数字 → 数理五行 */
  function numToWuxing(n) {
    var d = ((n % 10) + 10) % 10;
    if (d === 1 || d === 2) return '木';
    if (d === 3 || d === 4) return '火';
    if (d === 5 || d === 6) return '土';
    if (d === 7 || d === 8) return '金';
    return '水';                       /* 9, 0 */
  }

  /**
   * @param {number[]} s 姓氏各字笔画（单姓长度 1，复姓长度 2）
   * @param {number[]} g 名字各字笔画（单名长度 1，双名长度 2）
   */
  function calcWuge(s, g) {
    var single = s.length === 1;
    var tian, ren, di, wai, zong;

    if (single && g.length === 1) {          /* 单姓单名 */
      tian = s[0] + 1;
      ren = s[0] + g[0];
      di = g[0] + 1;
      zong = s[0] + g[0];
      wai = 2;
    } else if (single && g.length === 2) {   /* 单姓双名 */
      tian = s[0] + 1;
      ren = s[0] + g[0];
      di = g[0] + g[1];
      zong = s[0] + g[0] + g[1];
      wai = 1 + g[1];
    } else if (!single && g.length === 1) {  /* 复姓单名 */
      tian = s[0] + s[1];
      ren = s[1] + g[0];
      di = g[0] + 1;
      zong = s[0] + s[1] + g[0];
      wai = s[0] + 1;
    } else {                                 /* 复姓双名 */
      tian = s[0] + s[1];
      ren = s[1] + g[0];
      di = g[0] + g[1];
      zong = s[0] + s[1] + g[0] + g[1];
      wai = s[0] + g[1];
    }

    var wxTian = numToWuxing(tian);
    var wxRen = numToWuxing(ren);
    var wxDi = numToWuxing(di);
    var ji = NS.SANCAI_JI[NS.WUXING_NUM[wxTian] + '-' + NS.WUXING_NUM[wxRen]]
      || '中吉';

    /* 三才相生关系的细描述 */
    var relText = describeRelation(wxTian, wxRen, wxDi);

    return {
      天格: tian, 人格: ren, 地格: di, 总格: zong, 外格: wai,
      天格五行: wxTian, 人格五行: wxRen, 地格五行: wxDi,
      总格五行: numToWuxing(zong), 外格五行: numToWuxing(wai),
      三才: wxTian + wxRen + wxDi,
      三才吉凶: ji,
      三才关系: relText
    };
  }

  function describeRelation(a, b, c) {
    var pairs = [[a, b], [b, c]];
    var parts = pairs.map(function (p) {
      if (p[0] === p[1]) return p[0] + p[1] + '比和';
      if (NS.SHENG[p[0]] === p[1]) return p[0] + '生' + p[1];
      if (NS.SHENG[p[1]] === p[0]) return p[1] + '生' + p[0];
      if (NS.KE[p[0]] === p[1]) return p[0] + '克' + p[1];
      if (NS.KE[p[1]] === p[0]) return p[1] + '克' + p[0];
      return p[0] + p[1];
    });
    return parts.join('、');
  }

  NS.Wuge = {
    calcWuge: calcWuge,
    numToWuxing: numToWuxing
  };
})(typeof window !== 'undefined' ? window : globalThis);
