/* =========================================================================
 * radical.js —— 偏旁重复检测
 *
 * 「李浅涵」三字全带氵、「李诗语」两字全带讠，这类名字念着不别扭，
 * 但写在纸上一排同偏旁会显得笨重，是取名时的常见忌讳。
 *
 * 只做提示，不参与评分、不淘汰结果：
 *   偏旁表只覆盖内置字库（278 字），联网扩充的字查不到。
 *   若拿它扣分，会让「联网加字」这件事暗中拉低分数，属于数据缺陷污染排序，
 *   因此这里只报告事实，是否在意由用户决定。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var _index = null;   /* 字 → [分组下标, ...] */

  function buildIndex() {
    if (_index) return _index;
    _index = Object.create(null);
    var groups = NS.RADICAL_GROUPS || [];
    for (var g = 0; g < groups.length; g++) {
      var chars = groups[g].chars || '';
      for (var i = 0; i < chars.length; i++) {
        var c = chars.charAt(i);
        if (!_index[c]) _index[c] = [];
        if (_index[c].indexOf(g) < 0) _index[c].push(g);
      }
    }
    return _index;
  }

  /** 某字属于哪些偏旁分组，返回分组对象数组（通常 0 或 1 个） */
  function groupsOf(ch) {
    var idx = buildIndex();
    var hit = idx[ch];
    if (!hit) return [];
    return hit.map(function (g) { return NS.RADICAL_GROUPS[g]; });
  }

  /**
   * 检测偏旁重复。
   * @param {string[]|string} chars 名字用字（不含姓氏——姓氏是既定的，不参与挑选）
   * @returns {{dupes: Array, unknown: string[], covered: number, total: number}}
   *   dupes   —— [{name, label, chars:[...]}]，同一偏旁出现 ≥2 次的那些分组
   *   unknown —— 不在偏旁表里的字（联网扩充的字会出现在这里）
   */
  function check(chars) {
    var list = typeof chars === 'string' ? chars.split('') : (chars || []);
    var idx = buildIndex();
    var bucket = Object.create(null);
    var order = [];
    var unknown = [];
    var covered = 0;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var hit = idx[c];
      if (!hit || !hit.length) {
        if (unknown.indexOf(c) < 0) unknown.push(c);
        continue;
      }
      covered++;
      for (var k = 0; k < hit.length; k++) {
        var g = NS.RADICAL_GROUPS[hit[k]];
        if (!bucket[g.name]) {
          bucket[g.name] = { name: g.name, label: g.label, chars: [] };
          order.push(g.name);
        }
        bucket[g.name].chars.push(c);
      }
    }

    var dupes = [];
    for (var j = 0; j < order.length; j++) {
      if (bucket[order[j]].chars.length >= 2) dupes.push(bucket[order[j]]);
    }

    return {
      dupes: dupes,
      unknown: unknown,
      covered: covered,
      total: list.length
    };
  }

  /** 提示文案，例如「氵 重复（浅、涵）」 */
  function describe(res) {
    if (!res || !res.dupes.length) return '';
    return res.dupes.map(function (d) {
      return d.name + ' 重复（' + d.chars.join('、') + '）';
    }).join('；');
  }

  /** 偏旁表对内置字库的覆盖率，用于界面如实说明检测范围 */
  function coverage() {
    var idx = buildIndex();
    var list = NS.CHAR_LIST || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (idx[list[i].char]) n++;
    }
    return { covered: n, total: list.length };
  }

  function reset() { _index = null; }

  NS.Radical = {
    groupsOf: groupsOf,
    check: check,
    describe: describe,
    coverage: coverage,
    reset: reset
  };

})(typeof window !== 'undefined' ? window : globalThis);
