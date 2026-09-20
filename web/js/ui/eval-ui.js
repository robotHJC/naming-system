/* =========================================================================
 * eval-ui.js —— 评估视图
 *
 * 输入一个已有名字（自己想的、长辈给的、网上抄的都可以），
 * 配上生辰，输出一份分层的命理批注报告。
 *
 * 界面设计上最重要的一点：**报告按「依据强度」分组显示**，
 * 而不是混成一个总分完事。
 *   命理（八字五行）  —— 正统八字，权重最高
 *   数理（三才五格）  —— 数理派，与八字不同源
 *   民俗参考          —— 生肖、纳音、姓名卦
 *   语言              —— 音韵、谐音（不涉命理）
 * 用户能一眼看出哪条是硬的、哪条是软的 —— 这是这个视图存在的意义。
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

  /** 极简 markdown：只处理 **加粗**，报告文本里用它标重点 */
  function md(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  var root = null;
  var lastReport = null;

  /* 「依据强度」的标签文字与 CSS 类名。
   * 类名用 ASCII 而不是中文 —— CSS 选择器里塞中文能跑，但不好维护，
   * 也容易在别的编辑器里出编码问题。 */
  var BASIS_CLS = {
    '命理': 'basis-ming', '用字': 'basis-yong', '数理': 'basis-shu',
    '民俗': 'basis-min', '语言': 'basis-yu'
  };

  function render() {
    root.innerHTML = '';

    root.appendChild(el('div', 'section-title', '名字评估'));

    var intro = el('p', 'hint');
    intro.innerHTML = '输入一个已经想好的名字，配上生辰，系统会给出**分层**的命理批注。' +
      '评估<b>完全在本地完成，生辰八字不会上传到任何服务器</b> —— ' +
      '命理判断需要的数据（八字、五行、康熙笔画、音韵、诗词）本地都有，' +
      '联网只能补字典和诗词库，对命理分析没有帮助，所以这里不做联网。';
    intro.innerHTML = md(intro.innerHTML);
    root.appendChild(intro);

    /* ---- 表单 ---- */
    var form = el('div', 'panel eval-form');

    var fName = el('div', 'row2');
    var fS = el('div', 'field');
    var lS = el('label', null, '姓氏');
    lS.setAttribute('for', 'evSurname');
    fS.appendChild(lS);
    var inS = document.createElement('input');
    inS.type = 'text'; inS.id = 'evSurname'; inS.maxLength = 2;
    inS.placeholder = '如 郝';
    var mainS = $('surname');
    if (mainS && mainS.value) inS.value = mainS.value;
    fS.appendChild(inS);
    fName.appendChild(fS);

    var fG = el('div', 'field');
    var lG = el('label', null, '名字 ');
    lG.setAttribute('for', 'evGiven');
    lG.appendChild(el('span', 'sub', '不含姓'));
    fG.appendChild(lG);
    var inG = document.createElement('input');
    inG.type = 'text'; inG.id = 'evGiven'; inG.maxLength = 4;
    inG.placeholder = '如 沐涵';
    fG.appendChild(inG);
    fName.appendChild(fG);
    form.appendChild(fName);

    /* 生辰 + 性别（复用组件） */
    form.appendChild(NS.BirthForm.render('ev', { gender: true }));

    var btns = el('div', 'form-actions');
    var bGo = el('button', 'btn', '开 始 评 估');
    bGo.type = 'button';
    bGo.id = 'evGo';
    bGo.addEventListener('click', doEvaluate);
    btns.appendChild(bGo);

    var bClear = el('button', 'btn ghost', '清空');
    bClear.type = 'button';
    bClear.addEventListener('click', function () {
      inG.value = '';
      root.querySelector('#evResult').innerHTML = '';
      lastReport = null;
    });
    btns.appendChild(bClear);
    form.appendChild(btns);

    root.appendChild(form);

    var out = el('div', null);
    out.id = 'evResult';
    root.appendChild(out);

    /* 回车即评估 */
    [inS, inG].forEach(function (i) {
      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doEvaluate(); }
      });
    });
    /* 生辰变了就把旧报告标为过期，避免用户看着旧结论改了生辰却不知道 */
    ['evBirth', 'evLongitude', 'evUseTST'].forEach(function (id) {
      var e2 = $(id);
      if (e2) e2.addEventListener('change', markStale);
    });
  }

  function markStale() {
    var out = $('evResult');
    if (!out || !out.firstChild) return;
    var w = $('evStale');
    if (w) return;
    out.insertBefore(el('p', 'notice warn',
      '生辰已改动，下面这份报告是按改之前的生辰算的 —— 请重新点「开始评估」。'),
    out.firstChild).id = 'evStale';
  }

  function doEvaluate() {
    var surname = ($('evSurname').value || '').trim();
    var given = ($('evGiven').value || '').trim();
    var out = $('evResult');
    out.innerHTML = '';

    if (!surname || !given) {
      out.appendChild(el('p', 'notice warn', '姓氏和名字都要填。'));
      return;
    }
    /* 名字里含姓氏的情况：用户可能把全名填进了「名」 */
    if (given.indexOf(surname) === 0 && given.length > surname.length) {
      given = given.slice(surname.length);
      $('evGiven').value = given;
    }

    var bf = NS.BirthForm.read('ev');
    var rep;
    try {
      rep = NS.Report.evaluate(surname, given, {
        bazi: bf.bazi, gender: bf.gender
      });
    } catch (e) {
      out.appendChild(el('p', 'notice warn', '评估出错：' + (e && e.message)));
      return;
    }
    if (!rep) {
      out.appendChild(el('p', 'notice warn',
        '这个名字里没有字库里认识的字 —— 可能是生僻字。' +
        '可以到「词库管理」联网补字后再评估。'));
      return;
    }
    if (!bf.bazi) {
      out.insertBefore(el('p', 'notice',
        '没有填生辰 —— 下面只评了名字本身的五行搭配、音韵、笔画与出处，' +
        '**没有**涉及八字喜用神。要完整评估请填出生时间。'), out.firstChild);
    }

    lastReport = rep;
    renderReport(rep, out);
  }

  function renderReport(rep, out) {
    /* ---- 总分卡 ---- */
    var head = el('div', 'panel eval-head');
    var scoreCls = rep.total >= 75 ? 'good' : rep.total >= 65 ? 'ok' : 'low';
    head.innerHTML =
      '<div class="eval-title"><span class="eval-name">' + esc(rep.fullName) +
      '</span><span class="eval-py">' + esc(rep.pinyin) + '</span></div>' +
      '<div class="eval-score ' + scoreCls + '"><b>' + rep.total +
      '</b><span>综合分</span></div>' +
      '<p class="eval-verdict">' + esc(rep.verdict) + '</p>' +
      (rep.highlights.length
        ? '<ul class="eval-hl">' + rep.highlights.map(function (h) {
          return '<li>' + esc(h) + '</li>';
        }).join('') + '</ul>'
        : '') +
      (rep.unknownChars.length
        ? '<p class="notice warn">字库里没有：' + esc(rep.unknownChars.join('、')) +
          '　这些字没能参与评估。</p>' : '');
    out.appendChild(head);

    /* ---- 各分块，按依据强度分组 ---- */
    var order = ['命理', '用字', '数理', '民俗', '语言'];
    var byBasis = {};
    rep.blocks.forEach(function (b) {
      (byBasis[b.basis] = byBasis[b.basis] || []).push(b);
    });

    order.forEach(function (basis) {
      var list = byBasis[basis];
      if (!list || !list.length) return;

      var sec = el('div', 'panel eval-section');
      var h = el('div', 'eval-sec-head');
      h.appendChild(el('span', 'eval-basis ' + (BASIS_CLS[basis] || ''),
        NS.Report.BASIS_LABEL[basis] || basis));
      sec.appendChild(h);

      list.forEach(function (b) {
        var card = el('div', 'eval-block' + (b.tone === 'warn' ? ' warn' : ''));
        card.appendChild(el('div', 'eval-block-title', b.title));
        b.lines.forEach(function (l) {
          var p = el('p', l ? 'eval-line' : 'eval-gap');
          p.innerHTML = md(l);
          card.appendChild(p);
        });
        sec.appendChild(card);
      });
      out.appendChild(sec);
    });

    /* ---- 免责声明，永远显示在最末 ---- */
    var dis = el('p', 'notice');
    dis.innerHTML = md(rep.disclaimer);
    out.appendChild(dis);

    /* ---- 加入候选池 ---- */
    var act = el('div', 'form-actions');
    var b = el('button', 'btn ghost', '加入候选池');
    b.type = 'button';
    b.addEventListener('click', function () {
      NS.Pool.add({
        surname: rep.surname, given: rep.given,
        gender: (NS.BirthForm.read('ev').gender || ''),
        baziStr: rep.bazi ? rep.bazi.baziStr : ''
      }).then(function (r) {
        b.textContent = r.added ? '已加入 ✓' : (r.reason || '未加入');
        b.disabled = true;
      });
    });
    act.appendChild(b);
    out.appendChild(act);
  }

  NS.EvalUI = {
    init: function (rootEl) { root = rootEl; render(); },
    refresh: function () {
      if (!root || !root.firstChild) render();
      root.hidden = false;
      /* 评估页有自己一套生辰输入，显示时从「取名」页补一次 ——
       * 启动时主表单的填写记录可能还没恢复完，那时读到的是空值。 */
      if (NS.BirthForm) NS.BirthForm.syncFromMain('ev');
    },
    /** 供候选池跳转过来时预填名字（不自动评估，让用户自己确认生辰） */
    preset: function (surname, given) {
      if (!root || !root.firstChild) render();
      if ($('evSurname')) $('evSurname').value = surname || '';
      if ($('evGiven')) $('evGiven').value = given || '';
      var out = $('evResult');
      if (out) out.innerHTML = '';
      /* 预填后把焦点放到评估按钮附近，用户点一下或按回车就出报告 */
      var g = $('evGiven');
      if (g) g.focus();
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
