/* =========================================================================
 * pool-ui.js —— 候选池视图
 *
 * 场景：取名这件事通常发生在出生之前，而预产期前后差几天四柱就全变了。
 * 所以「现在算出的喜用神」很可能不是孩子真正的喜用神 ——
 * 硬按预估八字排出来的名字，出生后可能完全不对路。
 *
 * 正确的流程：
 *   孕期 → 按姓氏和风格挑一批中意的，存进池子（不锁死八字）
 *   出生 → 填真实生辰，一键重筛，看哪个最合适
 *
 * 界面上刻意把「加入时用的八字」和「当前用于重筛的八字」分开显示 ——
 * 就是为了让用户看清：**分数是用现在这个八字算的，不是当初那个**。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function $(id) { return document.getElementById(id); }

  var root = null;
  var lastRows = null;

  function render() {
    root.innerHTML = '';

    root.appendChild(el('div', 'section-title', '候选池'));
    var intro = el('p', 'hint');
    intro.innerHTML = '取名通常发生在出生之前，而预产期前后差几天<b>四柱就全变了</b>，' +
      '所以现在算出的喜用神未必是孩子真正的喜用神。' +
      '把中意的名字先存进池子（<b>不锁死八字</b>），等出生后填上真实生辰，' +
      '一键用真实八字重新评分排序 —— 池子里存的是<b>名字本身</b>，不是当初的分数。';
    root.appendChild(intro);

    /* ---- 重筛区 ---- */
    var box = el('div', 'panel');
    box.appendChild(el('div', 'eval-block-title',
      '① 出生后：填入真实生辰，重新评分'));
    box.appendChild(NS.BirthForm.render('pl', { gender: true }));

    var acts = el('div', 'form-actions');
    var bRe = el('button', 'btn', '用这个生辰重新评分');
    bRe.type = 'button';
    bRe.addEventListener('click', doRescore);
    acts.appendChild(bRe);

    var bList = el('button', 'btn ghost', '只看池子（不重筛）');
    bList.type = 'button';
    bList.addEventListener('click', function () { refresh(false); });
    acts.appendChild(bList);
    box.appendChild(acts);
    root.appendChild(box);

    /* ---- 池子 ---- */
    var poolBox = el('div', 'panel');
    poolBox.id = 'poolList';
    root.appendChild(poolBox);

    /* ---- 导入导出 ---- */
    var io = el('div', 'form-actions');
    var bExp = el('button', 'btn ghost', '导出候选池');
    bExp.type = 'button';
    bExp.addEventListener('click', function () {
      NS.Pool.exportAll().then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)],
          { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '候选池-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      });
    });
    io.appendChild(bExp);

    var bImp = el('button', 'btn ghost', '导入候选池');
    bImp.type = 'button';
    bImp.addEventListener('click', function () {
      var f = document.createElement('input');
      f.type = 'file';
      f.accept = '.json,application/json';
      f.addEventListener('change', function () {
        var file = f.files && f.files[0];
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var data = JSON.parse(fr.result);
            NS.Pool.importAll(data).then(function (r) {
              alert('导入完成：新增 ' + r.added + ' 个，现有 ' + r.size + ' 个。');
              refresh(false);
            }, function (e) { alert('导入失败：' + e.message); });
          } catch (e) { alert('文件不是有效的 JSON。'); }
        };
        fr.readAsText(file, 'utf-8');
      });
      f.click();
    });
    io.appendChild(bImp);

    var bClear = el('button', 'btn ghost', '清空候选池');
    bClear.type = 'button';
    bClear.style.color = '#a63a2e';
    bClear.addEventListener('click', function () {
      NS.Pool.size().then(function (n) {
        if (!n) { alert('候选池已经是空的。'); return; }
        if (!confirm('确定清空候选池里的 ' + n + ' 个候选吗？不可恢复。')) return;
        NS.Pool.clear().then(function () { refresh(false); });
      });
    });
    io.appendChild(bClear);
    root.appendChild(io);
  }

  function doRescore() {
    var bf = NS.BirthForm.read('pl');
    if (!bf.bazi) {
      alert('请先填出生时间 —— 重筛必须用真实八字，' +
        '没填的话算出来的还是名字本身的五行搭配，不是重筛。');
      return;
    }
    NS.Pool.rescore(bf.bazi, bf.gender).then(function (rows) {
      lastRows = rows;
      renderList(rows, bf);
    });
  }

  function renderList(rows, bf) {
    var box = $('poolList');
    box.innerHTML = '';

    if (!rows.length) {
      box.appendChild(el('p', 'hint',
        '池子是空的。到「取名」页挑几个中意的，点卡片上的「加入候选池」。'));
      return;
    }

    box.appendChild(el('div', 'eval-block-title',
      rows[0] && rows[0].report
        ? '② 按' + (bf && bf.bazi ? '真实' : '当前') + '八字重排（共 ' +
          rows.length + ' 个）'
        : '池子（共 ' + rows.length + ' 个）'));

    if (bf && bf.bazi) {
      var n = el('p', 'notice');
      n.innerHTML = '本次评分用的八字：<b>' + esc(bf.bazi.baziStr) + '</b>　' +
        '日主 ' + esc(bf.bazi.dayGan + bf.bazi.dayWx) + '　' +
        esc(bf.bazi.strength) + '　喜用神 <b>' +
        esc(bf.bazi.xiyongshen.join('、')) + '</b>　' +
        '（池子里存的是名字本身，分数每次都用当前八字现算）';
      box.appendChild(n);
    }

    var table = el('table', 'pool-table');
    var thead = el('thead');
    var hr = el('tr');
    ['名次', '名字', '综合分', '五行补益', '音韵 / 谐音', '加入时', '操作']
      .forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tb = el('tbody');
    rows.forEach(function (row, i) {
      var e2 = row.entry;
      var rep = row.report;
      var tr = el('tr');

      tr.appendChild(el('td', 'pool-rank', String(i + 1))).setAttribute('data-th', '名次');

      var tdName = el('td');
      tdName.setAttribute('data-th', '名字');
      tdName.appendChild(el('b', 'pool-name', e2.full));
      if (rep && rep.pinyin) {
        tdName.appendChild(el('span', 'pool-py', rep.pinyin));
      }
      if (i === 0 && rep) tdName.appendChild(el('span', 'tag good', '最佳'));
      tr.appendChild(tdName);

      tr.appendChild(el('td', 'pool-score',
        rep ? String(rep.total) : '—')).setAttribute('data-th', '综合分');

      /* 五行补益：这是重筛时最该看的一列 */
      var tdWx = el('td');
      tdWx.setAttribute('data-th', '五行补益');
      if (rep && rep.chars) {
        tdWx.innerHTML = rep.chars.map(function (c) {
          var cls = c.wxLevel === 'best' ? 'wx-best'
            : c.wxLevel === 'good' ? 'wx-good' : 'wx-idle';
          return '<span class="' + cls + '">' + esc(c.char) +
            esc(c.wuxing) + '</span>';
        }).join(' ');
      } else {
        tdWx.textContent = '—';
      }
      tr.appendChild(tdWx);

      var tdPh = el('td', 'pool-ph');
      tdPh.setAttribute('data-th', '音韵');
      if (rep && rep.score && rep.score.detail) {
        var ph = rep.score.detail.phonetic || {};
        var ho = rep.score.detail.homophone || {};
        var bits = [];
        if (ph.sameInitial && ph.sameInitial.length) {
          bits.push('声母撞 ' + ph.sameInitial.join(''));
        }
        if (!ho.pass) bits.push('谐音风险');
        tdPh.textContent = bits.length ? bits.join('；') : '无';
        if (bits.length) tdPh.className = 'pool-ph warn';
      }
      tr.appendChild(tdPh);

      var tdAdd = el('td', 'pool-added');
      tdAdd.setAttribute('data-th', '加入时');
      tdAdd.textContent = (e2.addedAt || '').slice(0, 10);
      if (row.baziWasEstimated) {
        tdAdd.appendChild(el('div', 'pool-note', '加入时未填八字'));
      } else if (row.baziChanged) {
        tdAdd.appendChild(el('div', 'pool-note',
          '加入时：' + e2.baziStrAtAdd));
      }
      tr.appendChild(tdAdd);

      var tdAct = el('td', 'pool-act');
      tdAct.setAttribute('data-th', '操作');
      var bRep = el('button', 'btn tiny', '看报告');
      bRep.type = 'button';
      bRep.addEventListener('click', function () {
        NS.EvalUI.preset(e2.surname, e2.given);
        NS.switchView('eval');
      });
      tdAct.appendChild(bRep);

      var bDel = el('button', 'btn tiny ghost', '移除');
      bDel.type = 'button';
      bDel.addEventListener('click', function () {
        NS.Pool.remove(e2.full).then(function () { refresh(false); });
      });
      tdAct.appendChild(bDel);
      tr.appendChild(tdAct);

      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);

    var hint = el('p', 'hint');
    hint.innerHTML = '「五行补益」一列是按当前喜用神判的：' +
      '<span class="wx-best">正合首用神</span>、' +
      '<span class="wx-good">属喜用</span>、' +
      '<span class="wx-idle">非喜用</span>。' +
      '重筛后如果发现排在前面的名字补益反而变差了，' +
      '说明这个生辰和当初预估的五行方向不同 —— 这正是要重筛的原因。';
    box.appendChild(hint);
  }

  /** 不重筛，只按已有数据展示（用池子里存的八字没意义，所以就列名字） */
  function refresh(withRescore) {
    if (!root) return;
    root.hidden = false;
    if (!root.firstChild) render();
    /* 同评估页：显示时从「取名」页补一次生辰 */
    if (NS.BirthForm) NS.BirthForm.syncFromMain('pl');

    NS.Pool.list().then(function (items) {
      var bf = NS.BirthForm.read('pl');
      if (bf.bazi) {
        NS.Pool.rescore(bf.bazi, bf.gender).then(function (rows) {
          lastRows = rows;
          renderList(rows, bf);
        });
      } else {
        /* 没有生辰：只列出来，不评分（存下来的分数不该被当结论用） */
        renderList(items.map(function (x) {
          return { entry: x, report: null, score: -1,
            baziWasEstimated: !x.baziStrAtAdd, baziChanged: false };
        }), null);
      }
    });
  }

  NS.PoolUI = {
    init: function (rootEl) { root = rootEl; render(); },
    refresh: refresh,
    rows: function () { return lastRows; }
  };

})(typeof window !== 'undefined' ? window : globalThis);
