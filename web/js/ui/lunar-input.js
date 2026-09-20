/* =========================================================================
 * lunar-input.js —— 「农历」录入助手
 *
 * 设计要点：**#birth 永远是公历值**。
 * 农历面板只是录入助手：用户选完农历日期，立刻换算成公历写回 #birth，
 * 然后照常派发 input 事件。这样 parseLocal / baziOptions / computeBazi /
 * BirthForm / 填写记录 全都不需要改，风险面最小，也不会出现
 * 「两套时间来源不一致」的隐患。
 *
 * 与「时辰未知」的分工：
 *   公历模式下，#birthNoHour 复选框是唯一开关；
 *   农历模式下，时辰下拉里的「不知道时辰」是开关，它会同步写入
 *   #birthNoHour —— 保持 birthNoHour() 是全系统唯一的事实来源。
 *
 * 时辰取该时辰的**正中整点**（子时记 00:00，丑时 02:00 …）。
 * 不提供 23:00–24:00 的「晚子时」：那一段的日柱归属各派有分歧，
 * 与其悄悄按某派算，不如不提供。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳',
    '午', '未', '申', '酉', '戌', '亥'];

  var mode = 'g';          /* 'g' 公历 | 'l' 农历 */
  var installed = false;
  var onModeChange = null;

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function opts(arr) {
    return arr.map(function (o) {
      return '<option value="' + o.v + '">' + o.t + '</option>';
    }).join('');
  }

  /* ---------- 各下拉框的数据 ---------- */

  var HOUR_OPTS = [{ v: -1, t: '不知道时辰' }];
  for (var i = 0; i < 12; i++) {
    HOUR_OPTS.push({ v: i * 2, t: SHICHEN[i] + '时　' + pad2(i * 2) + ':00' });
  }

  function buildYears(cur) {
    var sel = $('lunarYear');
    var out = [];
    /* 倒序：出生年份通常离现在近，越近的越靠上 */
    for (var y = NS.Lunar.MAX_YEAR; y >= NS.Lunar.MIN_YEAR; y--) {
      out.push('<option value="' + y + '">' + y + ' 年</option>');
    }
    sel.innerHTML = out.join('');
    sel.value = String(cur);
  }

  /** 月份下拉：闰月直接作为一个选项插在对应月份之后 */
  function buildMonths(y, keep) {
    var sel = $('lunarMonth');
    var list = NS.Lunar.monthListOf(y);
    var items = list.map(function (m) {
      return { v: m.m + '|' + (m.leap ? 1 : 0), t: m.monthName, days: m.days };
    });
    sel.innerHTML = opts(items);

    var vals = items.map(function (x) { return x.v; });
    if (keep && vals.indexOf(keep) >= 0) sel.value = keep;
    else sel.value = items[0].v;
  }

  function buildDays() {
    var sel = $('lunarDay');
    var y = parseInt($('lunarYear').value, 10);
    var mv = $('lunarMonth').value.split('|');
    var days = NS.Lunar.lunarMonthDays(y, parseInt(mv[0], 10), mv[1] === '1');
    if (!days) days = 30;
    var keep = parseInt(sel.value, 10);
    var out = [];
    for (var d = 1; d <= days; d++) {
      out.push('<option value="' + d + '">' + NS.Lunar.lunarDayName(d) + '</option>');
    }
    sel.innerHTML = out.join('');
    sel.value = String(keep >= 1 && keep <= days ? keep : 1);
  }

  function buildHours(cur) {
    var sel = $('lunarHour');
    sel.innerHTML = opts(HOUR_OPTS);
    sel.value = String(cur === undefined || cur === null ? -1 : cur);
  }

  /* ---------- 读写 ---------- */

  /** 读当前农历选择 → { y,m,d,leap,h,noHour,greg:{y,m,d},gregStr } */
  function read() {
    var y = parseInt($('lunarYear').value, 10);
    var mv = $('lunarMonth').value.split('|');
    var m = parseInt(mv[0], 10);
    var leap = mv[1] === '1';
    var d = parseInt($('lunarDay').value, 10);
    var hRaw = parseInt($('lunarHour').value, 10);
    var noHour = (hRaw < 0);
    var g = NS.Lunar.toGregorian(y, m, d, leap);
    if (!g) return null;
    var h = noHour ? 0 : hRaw;
    return {
      y: y, m: m, d: d, leap: leap, h: h, noHour: noHour,
      monthName: (leap ? '闰' : '') + NS.Lunar.MONTH_NAME[m - 1] + '月',
      dayName: NS.Lunar.lunarDayName(d),
      greg: g,
      /* 时辰一律落在整点，分钟恒为 00。之前误写成 pad2(hRaw % 60)，
       * 于是「巳时 10:00」被写成 10:10 —— 分钟位混进了小时值。 */
      gregStr: g.y + '-' + pad2(g.m) + '-' + pad2(g.d) +
        'T' + pad2(h) + ':00'
    };
  }

  /** 农历选择 → 写入 #birth 并触发下游 */
  function commit(silent) {
    var r = read();
    var echo = $('lunarEcho');
    if (!r) { if (echo) echo.textContent = '该农历日期不存在，请检查。'; return; }
    $('birth').value = r.gregStr;
    if (echo) {
      echo.innerHTML = '农历 <b>' + r.y + '</b> 年 <b>' + r.monthName +
        r.dayName + '</b>' + (r.noHour ? '（时辰未知）' : '') +
        '　→　公历 <b>' + r.greg.y + '-' + pad2(r.greg.m) + '-' + pad2(r.greg.d) +
        '</b>';
    }
    /* 时辰下拉同步到「时辰未知」复选框 —— 保持 birthNoHour() 是唯一事实来源 */
    var cb = $('birthNoHour');
    if (cb && cb.checked !== r.noHour) cb.checked = r.noHour;
    if (!silent) {
      $('birth').dispatchEvent(new Event('input', { bubbles: true }));
      $('birth').dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** 公历（#birth）→ 农历选择。用于切到农历模式，以及启动时恢复 */
  function syncFromBirth() {
    var v = $('birth').value;
    var m = v && v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) { buildDays(); return false; }
    var gy = +m[1], gmo = +m[2], gd = +m[3];
    var hh = m[4] === undefined ? -1 : +m[4];
    var lu = NS.Lunar.toLunar(gy, gmo, gd);
    if (!lu) return false;

    /* 年份要在支持范围内，否则下拉框选不中 */
    var y = Math.max(NS.Lunar.MIN_YEAR, Math.min(NS.Lunar.MAX_YEAR, lu.y));
    buildYears(y);
    buildMonths(y, lu.m + '|' + (lu.leap ? 1 : 0));
    buildDays();
    $('lunarDay').value = String(Math.min(lu.d, $('lunarDay').options.length));

    /* 公历时间 → 最接近的时辰。取该时辰区间内的整点即可 */
    var hOpt = -1;
    if (hh >= 0) {
      /* 子时 23:00–01:00，丑时 01:00–03:00… 取所在时辰的正中整点 */
      var idx = Math.floor(((hh + 1) % 24) / 2);
      hOpt = idx * 2;
      /* 23 点属于子时，但子时的代表整点记 00:00 */
      if (hOpt === 0 && hh >= 23) hOpt = 0;
    }
    buildHours(hOpt);
    return true;
  }

  /* ---------- 模式切换 ---------- */

  function paint() {
    var lunar = (mode === 'l');
    var row = $('lunarRow');
    var b = $('birth');
    var cbRow = $('birthNoHour');
    if (row) row.hidden = !lunar;
    if (b) b.hidden = lunar;
    /* 农历模式下「时辰未知」由时辰下拉接管，避免两个开关打架 */
    if (cbRow) {
      var wrap = cbRow.closest ? cbRow.closest('label') : null;
      if (wrap) wrap.hidden = lunar;
    }
    var lab = $('birthLabel');
    if (lab) lab.setAttribute('for', lunar ? 'lunarYear' : 'birth');

    Array.prototype.forEach.call(
      document.querySelectorAll('#calSwitch button'), function (x) {
        x.setAttribute('aria-pressed', x.dataset.cal === mode ? 'true' : 'false');
      });
    var echo = $('lunarEcho');
    if (echo) echo.hidden = !lunar;
  }

  function setMode(m, silent) {
    if (m !== 'g' && m !== 'l') m = 'g';
    var changed = (m !== mode);
    mode = m;
    if (mode === 'l') syncFromBirth();
    paint();
    if (mode === 'l') commit(true);
    if (changed && !silent && onModeChange) onModeChange(mode);
    return mode;
  }

  /* ---------- 安装 ---------- */

  function install(opt) {
    if (installed) return;
    installed = true;
    onModeChange = (opt && opt.onChange) || null;

    buildYears(1990);
    buildMonths(1990);
    buildDays();
    buildHours(-1);

    var sw = $('calSwitch');
    if (sw) {
      sw.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        setMode(b.dataset.cal);
      });
    }

    /* 年 → 重建月、日 */
    $('lunarYear').addEventListener('change', function () {
      buildMonths(parseInt($('lunarYear').value, 10));
      buildDays();
      commit();
    });
    /* 月 → 重建日（该月 29 还是 30 天） */
    $('lunarMonth').addEventListener('change', function () {
      buildDays();
      commit();
    });
    $('lunarDay').addEventListener('change', function () { commit(); });
    $('lunarHour').addEventListener('change', function () { commit(); });

    paint();
  }

  NS.LunarInput = {
    install: install,
    mode: function () { return mode; },
    setMode: setMode,
    syncFromBirth: function () { return syncFromBirth(); },
    /** 启动时调用：恢复模式，并把 #birth 反推成农历选择 */
    restore: function (m) {
      if (m === 'l') {
        mode = 'l';
        syncFromBirth();
        paint();
        commit(true);
      } else {
        mode = 'g';
        syncFromBirth();      /* 即使不显示，也把选择准备好 */
        paint();
      }
    },
    read: read
  };
})(typeof window !== 'undefined' ? window : globalThis);
