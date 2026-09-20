/* =========================================================================
 * birth-form.js —— 可复用的「生辰 + 性别」输入组
 *
 * 评估视图和候选池视图都需要重新输入生辰（可能是不同的孩子，
 * 也可能是出生后拿真实生辰重算），但又不想把「取名」页那一整套表单
 * 复制两份。所以抽出一个小控件：
 *
 *   NS.BirthForm.render('ev', { gender: true })  → 生成 DOM
 *   NS.BirthForm.read('ev')                      → 读值并排八字
 *
 * 前缀是为了同页多份实例的 id 不打架。
 *
 * 设计取舍：这里**不重复城市选择器**，只留经度数字输入。
 * 城市表有 234 条，塞进小控件里太重；需要选城市时回「取名」页填一次，
 * 经度会自动带过来。
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

  function $(id) { return document.getElementById(id); }

  function parseLocal(v) {
    if (!v) return null;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  }

  /**
   * 渲染输入组
   * @param {string} p 前缀
   * @param {Object} [opt] { gender:bool, hint:string }
   * @returns {Element}
   */
  function render(p, opt) {
    opt = opt || {};
    var box = el('div', 'birth-form');

    /* ---- 生辰 ---- */
    var fBirth = el('div', 'field');
    var lb = el('label', null, '出生时间 ');
    lb.setAttribute('for', p + 'Birth');
    lb.appendChild(el('span', 'sub', '选填；填了才按真实八字评分'));
    fBirth.appendChild(lb);

    var inp = document.createElement('input');
    inp.type = 'datetime-local';
    inp.id = p + 'Birth';
    /* 默认沿用「取名」页已填的值 —— 用户刚填过，不该让他再填一次 */
    var mainBirth = $('birth');
    if (mainBirth && mainBirth.value) inp.value = mainBirth.value;
    fBirth.appendChild(inp);

    var hint = el('p', 'hint');
    hint.id = p + 'BaziHint';
    hint.style.margin = '6px 0 0';
    fBirth.appendChild(hint);
    box.appendChild(fBirth);

    /* ---- 真太阳时（经度）---- */
    var fTst = el('div', 'field');
    var tstWrap = el('label', 'check');
    var tst = document.createElement('input');
    tst.type = 'checkbox';
    tst.id = p + 'UseTST';
    var mainTst = $('useTST');
    if (mainTst) tst.checked = mainTst.checked;
    tstWrap.appendChild(tst);
    tstWrap.appendChild(document.createTextNode(' 用真太阳时'));
    fTst.appendChild(tstWrap);

    var lon = document.createElement('input');
    lon.type = 'number';
    lon.id = p + 'Longitude';
    lon.step = 'any';
    lon.placeholder = '经度，如 104.07';
    var mainLon = $('longitude');
    if (mainLon && mainLon.value) lon.value = mainLon.value;
    lon.style.marginTop = '6px';
    fTst.appendChild(lon);
    fTst.appendChild(el('p', 'hint',
      '经度差 1° = 真太阳时差 4 分钟，会影响时柱乃至日柱。'));
    box.appendChild(fTst);

    /* ---- 性别 ---- */
    if (opt.gender) {
      var fG = el('div', 'field');
      fG.appendChild(el('label', null, '性别'));
      var seg = el('div', 'segmented');
      seg.id = p + 'Gender';
      ['男', '女', '不限'].forEach(function (v, i) {
        var b = el('button', null, v);
        b.type = 'button';
        b.dataset.v = v;
        b.setAttribute('aria-pressed', i === 2 ? 'true' : 'false');
        seg.appendChild(b);
      });
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        Array.prototype.forEach.call(seg.querySelectorAll('button'),
          function (x) {
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
        read(p, { silent: true });
      });
      fG.appendChild(seg);
      box.appendChild(fG);
    }

    /* ---- 实时八字提示 ---- */
    function update() {
      var r = read(p, { silent: true });
      var h = $(p + 'BaziHint');
      if (!h) return;
      if (!r.dt) {
        h.textContent = '未填生辰 → 只按名字本身的五行搭配评，不算八字。';
        return;
      }
      if (!r.bazi) { h.textContent = '生辰解析失败，请检查格式。'; return; }
      h.innerHTML = '八字 <b>' + r.bazi.baziStr + '</b>　日主 ' + r.bazi.dayGan +
        r.bazi.dayWx + '　' + r.bazi.strength +
        '　喜用神 <b>' + (r.bazi.xiyongshen.join('、') || '—') + '</b>' +
        (r.bazi.missing.length
          ? '　不显 ' + r.bazi.missing.join('、') : '') +
        '　生肖 <b>' + r.bazi.shengxiao + '</b>' +
        (r.bazi.nayin ? '　纳音 <b>' + r.bazi.nayin.name + '</b>' : '');
    }
    inp.addEventListener('change', update);
    inp.addEventListener('input', update);
    lon.addEventListener('input', update);
    tst.addEventListener('change', update);
    /* 首帧就要把提示填上（可能沿用了主表单的值） */
    setTimeout(update, 0);

    return box;
  }

  /**
   * 读值并排八字
   * @param {string} p 前缀
   * @param {Object} [o] { silent:true } 静默模式下不写日志
   * @returns {{dt:Object|null, bazi:Object|null, gender:string, longitude:number|null}}
   */
  function read(p, o) {
    o = o || {};
    var dt = parseLocal($(p + 'Birth') ? $(p + 'Birth').value : '');
    var useTST = $(p + 'UseTST') ? $(p + 'UseTST').checked : false;
    var lon = parseFloat($(p + 'Longitude') ? $(p + 'Longitude').value : '');
    var gender = '不限';
    var seg = $(p + 'Gender');
    if (seg) {
      var on = seg.querySelector('button[aria-pressed="true"]');
      if (on) gender = on.dataset.v;
    }

    var bazi = null;
    if (dt) {
      try {
        bazi = NS.Bazi.analyzeBazi(dt.y, dt.m, dt.d, dt.h, dt.mi, {
          trueSolarTime: useTST && isFinite(lon),
          longitude: isFinite(lon) ? lon : undefined
        });
      } catch (e) {
        bazi = null;
      }
    }
    return {
      dt: dt, bazi: bazi, gender: gender,
      longitude: isFinite(lon) ? lon : null
    };
  }

  NS.BirthForm = { render: render, read: read, parseLocal: parseLocal };

})(typeof window !== 'undefined' ? window : globalThis);
