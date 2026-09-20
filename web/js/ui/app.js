/* =========================================================================
 * app.js —— 界面交互层
 * 纯原生 JS，无构建步骤，直接双击 index.html 即可运行。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = global.NS;

  /* ---------------- 小工具 ---------------- */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function splitChars(s) {
    return String(s || '').replace(/[\s,，、;；]/g, '').split('').filter(Boolean);
  }
  function splitWords(s) {
    return String(s || '').split(/[,，、;；\s]+/).map(function (x) {
      return x.trim();
    }).filter(Boolean);
  }

  var WX_CLASS = { 金: 'wx-4', 木: 'wx-1', 水: 'wx-5', 火: 'wx-2', 土: 'wx-3' };
  var WX_COLOR = {
    金: '#6b6f7a', 木: '#2f5d50', 水: '#2b5d8a',
    火: '#a63a2e', 土: '#a9782c'
  };

  /* ---------------- 状态 ---------------- */

  var state = {
    gender: '中性',
    givenLength: 2,
    xiManual: Object.create(null),
    cancel: null,
    lastResults: null,
    lastBazi: null,
    /* 生成器交回的完整推荐排序，「换一批」从这里切片，不必重新枚举 */
    ranking: [],
    lastOpts: null,
    /* 复用评分上下文，同音替换重算分数时需要它的缓存 */
    ctx: null,
    page: 0,
    onlyKw: false,
    /* 简洁模式：名字卡片折叠掉字义/小名/出处/五格。
     * 用户的原始抱怨是「想换下一批还得翻回最上面」——
     * 页面越短这个问题越轻，所以默认打开。 */
    compact: true,
    /* 勾选待对比的名字（跨批次保留） */
    picked: [],
    /* 选中的偏好部首（按钮选的；手输的另算） */
    radPicked: []
  };

  /* ---------------- 初始化表单 ---------------- */

  function initSelects() {
    /* 姓氏候选 */
    var dl = $('surnameList');
    NS.SURNAME_LIST.slice().sort().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      dl.appendChild(o);
    });

    /* 风格 */
    var sel = $('style');
    [{ v: '', t: '不限风格' }].concat(
      NS.STYLE_TAGS.map(function (t) { return { v: t, t: t }; })
    ).forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.v;
      o.textContent = it.t;
      sel.appendChild(o);
    });
    sel.value = '';

    /* 喜用神多选 */
    var box = $('xiSeg');
    NS.WUXING.forEach(function (w) {
      var b = el('button', 'wx-chip', w);
      b.type = 'button';
      b.dataset.v = w;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        if (state.xiManual[w]) delete state.xiManual[w];
        else state.xiManual[w] = 1;
        b.setAttribute('aria-pressed', state.xiManual[w] ? 'true' : 'false');
        updateBaziHint();
      });
      box.appendChild(b);
    });

    /* 城市候选（带省份，便于辨认同名城市） */
    var cityList = $('cityList');
    if (cityList) {
      NS.CITY_LIST.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.name;
        o.label = c.province + '　东经 ' + c.longitude + '°';
        cityList.appendChild(o);
      });
    }
  }

  /* ---------------- 城市 → 经度 ---------------- */

  function updateCity(fromUser) {
    var name = ($('city').value || '').trim();
    var hint = $('cityHint');
    if (!hint) return;

    if (!name) {
      hint.textContent = '';
      return;
    }
    var c = NS.CITY_BY_NAME[name];
    if (!c) {
      hint.innerHTML = '未收录「' + esc(name) + '」，可在「高级选项」里直接填经度。';
      return;
    }

    $('longitude').value = c.longitude;
    var inSC = NS.isSichuanArea(name);
    hint.innerHTML = '东经 <b>' + c.longitude + '°</b>　' + esc(c.province) +
      (inSC ? '　<b style="color:#2f5d50">属西南官话区</b>' : '');

    /* 选了四川/重庆就默认打开四川话检测（用户手动点选时才自动勾） */
    if (fromUser && inSC && $('useSC') && !$('useSC').checked) {
      $('useSC').checked = true;
      hint.innerHTML += '<br>已自动开启四川话谐音提示' +
        (NS.Dialect.available() ? '' :
          '，但还没同步蜀拼字表，请到「词库管理」更新。');
    }
    if (fromUser && !inSC && $('useSC') && $('useSC').checked) {
      $('useSC').checked = false;
    }
    updateBaziHint();
  }

  /** 四川话检测是否真正可用（已勾选且有数据） */
  function sichuanEnabled() {
    var cb = $('useSC');
    return !!(cb && cb.checked && NS.Dialect.available());
  }

  /** 给结果补充四川话读音与谐音提示 */
  function attachSichuan(results) {
    if (!sichuanEnabled()) return 0;
    var n = 0;
    results.forEach(function (it) {
      var r = NS.Dialect.check(it.name);
      it.sichuan = r;
      if (r.hits && r.hits.length) n++;
    });
    return n;
  }

  function initSegmented(id, key) {
    var wrap = $(id);
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call(wrap.querySelectorAll('button'),
        function (b) { b.setAttribute('aria-pressed', 'false'); });
      btn.setAttribute('aria-pressed', 'true');
      if (key === 'gender') state.gender = btn.dataset.v;
      else state.givenLength = parseInt(btn.dataset.v, 10);
    });
  }

  /* ---------------- 视图切换 ---------------- */

  /* ---------------- 填写记录（表单草稿） ----------------
   *
   * 用户需求：「加一个填写缓存，不然每次打开都要重新填写信息」。
   *
   * 只缓存**填的条件**，不缓存**结果** ——
   * 结果依赖当前数据（联网同步过词库就不一样了），
   * 而且把上次的结果原样端出来，用户会以为那是「按现在条件算的」。
   * 条件记住就够了，这是他真正不想每次重填的东西。
   * ------------------------------------------------ */

  /* 要缓存的表单控件，key 就是元素 id。
   *
   * strokes 故意**不在**这里面：它是「姓氏康熙笔画」的手工覆盖值，
   * 留空才表示「按姓氏表自动」。缓存它会让上次自动填进去的数字
   * 每次打开都被恢复回来 —— 换个姓氏之后那就是个错值，
   * 还会静默污染三才五格与姓名卦。宁可让手动改的那一次不记住。 */
  var PREF_IDS = ['surname', 'birth', 'longitude', 'useTST', 'city',
    'style', 'top', 'keywords', 'taboo', 'mustInclude', 'useSC',
    'birthNoHour', 'birthNoDay', 'birthNoMonth'];

  /** 收集当前表单状态（含不在 input 里的那些 state） */
  function collectPrefs() {
    var p = {};
    PREF_IDS.forEach(function (id) {
      var e = $(id);
      if (!e) return;
      p[id] = (e.type === 'checkbox') ? !!e.checked : e.value;
    });
    p.gender = state.gender;
    p.givenLength = state.givenLength;
    p.compact = !!state.compact;
    p.xiManual = Object.keys(state.xiManual);
    p.radPicked = state.radPicked.slice();
    var rc = $('radCustom');
    if (rc) p.radCustom = rc.value;
    var ra = $('radAll');
    if (ra) p.radMode = ra.checked ? 'all' : 'any';
    /* 公历 / 农历。农历的**选择本身不用记** —— #birth 永远是公历值，
     * 启动时反推回来就行，少一份可能不一致的状态。 */
    p.calMode = (NS.LunarInput ? NS.LunarInput.mode() : 'g');
    return p;
  }

  /** 设置分段控件的选中项 */
  function setSegmented(id, value) {
    var wrap = $(id);
    if (!wrap) return false;
    var hit = false;
    Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
      var on = String(b.dataset.v) === String(value);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) hit = true;
    });
    return hit;
  }

  /**
   * 把记录写回表单
   * @returns {boolean} 是否确实恢复了内容
   */
  function applyPrefs(p) {
    if (!p) return false;
    var any = false;
    PREF_IDS.forEach(function (id) {
      var e = $(id);
      if (!e || p[id] === undefined) return;
      if (e.type === 'checkbox') e.checked = !!p[id];
      else e.value = p[id];
      any = true;
    });

    if (p.gender && setSegmented('genderSeg', p.gender)) {
      state.gender = p.gender; any = true;
    }
    if (p.givenLength && setSegmented('lenSeg', String(p.givenLength))) {
      state.givenLength = parseInt(p.givenLength, 10) || 2; any = true;
    }

    /* 手工指定的喜用神 */
    if (p.xiManual && p.xiManual.length) {
      state.xiManual = Object.create(null);
      p.xiManual.forEach(function (w) { state.xiManual[w] = 1; });
      var xiBox = $('xiSeg');
      if (xiBox) {
        Array.prototype.forEach.call(xiBox.querySelectorAll('button'), function (b) {
          b.setAttribute('aria-pressed', state.xiManual[b.dataset.v] ? 'true' : 'false');
        });
      }
      any = true;
    }

    /* 偏好部首（按钮选的） */
    if (p.radPicked && p.radPicked.length) {
      state.radPicked = p.radPicked.slice();
      if (typeof syncRadChips === 'function') syncRadChips();
      any = true;
    }
    if (p.radMode) {
      var ra = $('radAll');
      if (ra) ra.checked = (p.radMode === 'all');
    }
    /* 简洁模式是界面偏好，不代表「填了内容」，所以不计入 any ——
     * 否则只存过这一个开关也会提示「已恢复上次填写的条件」。 */
    if (p.compact !== undefined) state.compact = !!p.compact;

    /* 公历/农历要在 #birth 已经写完之后才能恢复。
     * LunarInput.restore 内部会做「#birth → 农历选择」的反推。 */
    if (NS.LunarInput) NS.LunarInput.restore(p.calMode === 'l' ? 'l' : 'g');
    return any;
  }

  function savePrefsNow() {
    return NS.Prefs.flush(collectPrefs);
  }

  /** 表单底部那行说明 + 清除入口 */
  function renderPrefHint(restored, when) {
    var h = $('prefHint');
    if (!h) return;
    h.innerHTML = '';
    if (!restored) {
      h.textContent = '填写内容会自动记住，下次打开不用重新填。' +
        '（只记条件，不记结果；生辰保存在本机浏览器里）';
      return;
    }
    var whenText = '';
    if (when) {
      var d = new Date(when);
      if (!isNaN(d.getTime())) {
        whenText = '（' + d.toLocaleString('zh-CN',
          { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
          ' 保存）';
      }
    }
    h.innerHTML = '已恢复上次填写的条件' + esc(whenText) +
      '。<b>只恢复了填写内容，名字没有沿用上次结果</b>（重新点「开始取名」即可）。';
    var b = el('button', 'btn tiny ghost', '清除填写记录');
    b.type = 'button';
    b.style.marginLeft = '8px';
    b.addEventListener('click', function () {
      NS.Prefs.clear().then(function () {
        b.textContent = '已清除';
        b.disabled = true;
        setTimeout(function () { renderPrefHint(false); }, 900);
      });
    });
    h.appendChild(b);
  }

  /* ---------------- 部首偏好 ---------------- */

  /** 建候选部首按钮。每个按钮右上角标出字库里有几个这样的字，
   * 让用户在选之前就知道选择空间有多大（走之底只有 2 个字时一目了然）。 */
  function initRadicalPicker() {
    var box = $('radSeg');
    if (!box || !NS.Radical) return;
    box.innerHTML = '';
    NS.Radical.pickerList().forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rad-chip';
      b.setAttribute('data-rad', r.name);
      b.innerHTML = esc(r.name) + '<i>' + r.count + '</i>';
      b.title = r.label + '：字库里有 ' + r.count + ' 个字';
      b.addEventListener('click', function () {
        var i = state.radPicked.indexOf(r.name);
        if (i >= 0) state.radPicked.splice(i, 1);
        else state.radPicked.push(r.name);
        syncRadChips();
        updateRadHint();
      });
      box.appendChild(b);
    });

    var xi = $('radByXi');
    if (xi) xi.addEventListener('click', function () { recommendByXi(); });
    var zo = $('radByZodiac');
    if (zo) zo.addEventListener('click', function () { recommendByZodiac(); });
    var cl = $('radClear');
    if (cl) {
      cl.addEventListener('click', function () {
        state.radPicked = [];
        if ($('radCustom')) $('radCustom').value = '';
        syncRadChips();
        updateRadHint();
      });
    }
    var cu = $('radCustom');
    if (cu) cu.addEventListener('input', updateRadHint);
    var av = $('radAvoid');
    if (av) av.addEventListener('input', updateRadHint);
    syncRadChips();
    updateRadHint();
  }

  function syncRadChips() {
    var box = $('radSeg');
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (b) {
      var n = b.getAttribute('data-rad');
      b.classList.toggle('on', state.radPicked.indexOf(n) >= 0);
      b.setAttribute('aria-pressed', state.radPicked.indexOf(n) >= 0 ? 'true' : 'false');
    });
  }

  /** 当前生效的偏好/避用部首（按钮选的 + 手输的） */
  function pickedRadicals() {
    var typed = splitWords($('radCustom') ? $('radCustom').value : '');
    var all = state.radPicked.concat(typed);
    return all.filter(function (n, i) { return all.indexOf(n) === i; });
  }

  function avoidedRadicals() {
    return splitWords($('radAvoid') ? $('radAvoid').value : '');
  }

  function updateRadHint() {
    var hint = $('radHint');
    if (!hint || !NS.Radical) return;

    var want = pickedRadicals();
    var avoid = avoidedRadicals();
    var msgs = [];

    /* 手输的部首名可能根本不存在，得报出来而不是静默忽略 */
    var unknown = want.concat(avoid).filter(function (n) {
      return !NS.Radical.isValidName(n);
    });
    var uniqUnknown = unknown.filter(function (n, i) {
      return unknown.indexOf(n) === i;
    });
    if (uniqUnknown.length) {
      msgs.push('<b style="color:#a63a2e">认不出的部首：' + esc(uniqUnknown.join('、')) +
        '</b>（可用的见上方按钮）');
    }

    if (want.length) {
      var chars = [];
      want.forEach(function (n) {
        if (!NS.Radical.isValidName(n)) return;
        NS.Radical.charsOf(n).forEach(function (c) {
          if (chars.indexOf(c) < 0) chars.push(c);
        });
      });
      if (!chars.length) {
        msgs.push('<b style="color:#a63a2e">字库里没有符合这些部首的字，' +
          '请换一个，或到词库管理的「按部首找字」联网扩充。</b>');
      } else {
        msgs.push('符合的候选字 <b>' + chars.length + '</b> 个：' +
          esc(chars.slice(0, 24).join('')) + (chars.length > 24 ? '…' : ''));
        var thin = want.filter(function (n) {
          return NS.Radical.isValidName(n) && NS.Radical.charsOf(n).length < 3;
        });
        if (thin.length) {
          msgs.push('其中 ' + esc(thin.join('、')) +
            ' 的字偏少，结果会很局限，建议到词库管理联网找字。');
        }
      }
    }

    if (avoid.length) {
      var n = 0;
      avoid.forEach(function (x) {
        if (NS.Radical.isValidName(x)) n += NS.Radical.charsOf(x).length;
      });
      if (n) msgs.push('已排除 ' + n + ' 个带这些偏旁的字。');
    }

    hint.innerHTML = msgs.join('　') ||
      '不选则由系统按八字喜用神挑字。按生肖推荐属<b>民俗参考</b>。';
  }

  /** 按喜用神推荐部首：用的是系统自己给字库定的五行口径，两边一致 */
  function recommendByXi() {
    var xi = currentXi();
    if (!xi || !xi.length) {
      var dt = parseLocal($('birth').value, birthFlags());
      if (dt) xi = computeBazi(dt).xiyongshen;
    }
    if (!xi || !xi.length) {
      alert('还没定出喜用神。请填出生时间，或在上方手动勾选喜用神。');
      return;
    }
    var names = [];
    var wxMap = (NS.Radical && NS.Radical.wuxingMap) ? NS.Radical.wuxingMap() : null;
    if (!wxMap) {
      alert('部首数据还没就绪。');
      return;
    }
    var parts = [];
    xi.forEach(function (w) {
      var rs = (wxMap[w] || []).filter(function (x) {
        return NS.Radical.charsOf(x.name).length > 0;
      });
      if (rs.length) parts.push(w + '→' + rs.map(function (x) { return x.name; }).join('/'));
      rs.forEach(function (x) { names.push(x.name); });
    });
    if (!names.length) {
      alert('喜用神「' + xi.join('、') + '」在字库里没有五行一致的偏旁可用。');
      return;
    }
    state.radPicked = names.filter(function (n, i) { return names.indexOf(n) === i; });
    syncRadChips();
    updateRadHint();
    $('radHint').innerHTML = '喜用神 ' + esc(xi.join('、')) + ' → ' +
      esc(parts.join('，')) + '。' + $('radHint').innerHTML;
  }

  /** 按生肖推荐部首。民俗说法，必须用户主动点，且界面上标明性质 */
  function recommendByZodiac() {
    var dt = parseLocal($('birth').value, birthFlags());
    if (!dt) {
      alert('按生肖推荐需要出生日期。请先填出生时间。');
      return;
    }
    var info = computeBazi(dt);
    var zodiac = info && info.shengxiao;
    if (!zodiac || !NS.ZODIAC_RADICALS[zodiac]) {
      alert('没能定出生肖。');
      return;
    }
    var names = NS.ZODIAC_RADICALS[zodiac].filter(function (r) {
      return NS.Radical.isValidName(r) && NS.Radical.charsOf(r).length > 0;
    });
    state.radPicked = names;
    syncRadChips();
    updateRadHint();
    $('radHint').innerHTML = '属' + esc(zodiac) + ' → 已选中 ' +
      esc(names.join('、')) +
      '。<b>这是民间说法，没有经典出处，各流派不一致，仅供你参考；' +
      '八字喜用神优先级更高。</b>' + $('radHint').innerHTML;
  }

  function initViewSwitch() {
    var wrap = $('viewSwitch');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      switchView(btn.dataset.view);
    });
  }

  /**
   * 切换视图。四个：取名 / 候选池 / 评估 / 词库管理。
   *
   * 每个视图**切进来时才刷新** —— 启动时把所有视图都算一遍既慢又没意义，
   * 而且候选池与评估都需要生辰参数，启动时用户还没填。
   */
  function switchView(view) {
    var wrap = $('viewSwitch');
    if (wrap) {
      Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed',
          b.dataset.view === view ? 'true' : 'false');
      });
    }
    /* 用表驱动而不是写死几行，加视图时不会漏掉一个 */
    var map = {
      naming: 'viewNaming', pool: 'viewPool',
      eval: 'viewEval', lexicon: 'viewLexicon'
    };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el) el.hidden = (k !== view);
    });
    if (view === 'lexicon' && NS.SyncUI) NS.SyncUI.refreshStatus();
    if (view === 'pool' && NS.PoolUI) NS.PoolUI.refresh();
    if (view === 'eval' && NS.EvalUI) NS.EvalUI.refresh();
    state.view = view;
  }
  /* 供候选池/评估视图内部跳转用（例如「去评估这个名字」） */
  NS.switchView = switchView;

  /** 词库有联网扩充时，在「词库管理」按钮上点一个小圆点 */
  function refreshLexDot(st) {
    if (!st) {
      try { st = NS.Lexicon.status(); } catch (e) { return; }
    }
    var dot = $('lexDot');
    if (!dot) return;
    var enriched = (st.customChars > 0) ||
      (st.poems > st.builtinPoems) ||
      (st.dictCount > 0) ||
      (st.shupinCount > 0);
    dot.hidden = !enriched;
    dot.title = enriched
      ? '已联网扩充：加入 ' + st.customChars + ' 字，诗篇 ' + st.poems + ' 首' +
      (st.shupinCount ? '，蜀拼 ' + st.shupinCount + ' 字' : '')
      : '';
  }
  /* 暴露给 sync-ui.js：同步完成后由它回调，保证状态即时刷新 */
  NS.refreshLexDot = refreshLexDot;

  /** 候选池里有东西时，在「候选池」按钮上点一个小圆点 */
  function refreshPoolDot() {
    var dot = $('poolDot');
    if (!dot || !NS.Pool) return;
    NS.Pool.size().then(function (n) {
      dot.hidden = !n;
      dot.title = n ? ('候选池里有 ' + n + ' 个候选') : '';
    }).catch(function () { /* 忽略：无持久化环境 */ });
  }
  NS.refreshPoolDot = refreshPoolDot;

  /* ---------------- 姓氏信息 ---------------- */

  /** 取姓氏的 {pinyin[], tones[], strokes[]}；库中没有则退化用字库，再用联网词库 */
  function resolveSurname(s) {
    if (!s) return null;
    if (NS.SURNAME_DB[s]) {
      var d = NS.SURNAME_DB[s];
      return {
        pinyin: d.pinyin.slice(), tones: d.tones.slice(),
        strokes: d.strokes.slice(), known: true, compound: d.compound
      };
    }
    var chars = s.split('');
    var py = [], tones = [], st = [], ok = true, fromNet = false;
    chars.forEach(function (c) {
      var info = NS.CHAR_DB[c];
      if (info) {
        py.push(info.pinyin); tones.push(info.tone); st.push(info.strokes);
        return;
      }
      var L = NS.Lexicon;
      var lp = L && L.pinyinMap && L.pinyinMap[c];
      var ld = L && L.dict && L.dict[c];
      if (lp || ld) {
        py.push(lp ? lp.pinyin : '');
        tones.push(lp ? lp.tone : 0);
        st.push(ld ? ld[0] : 0);
        ok = false;
        fromNet = true;
        return;
      }
      py.push(''); tones.push(0); st.push(0); ok = false;
    });
    return {
      pinyin: py, tones: tones, strokes: st,
      known: false, partial: ok, fromNet: fromNet
    };
  }

  /** 手工填的姓氏笔画；留空（或填了非法值）返回 null，表示「按姓氏表自动」 */
  function manualStrokes() {
    var e = $('strokes');
    if (!e) return null;
    var v = parseInt(e.value, 10);
    return (isFinite(v) && v > 0) ? v : null;
  }

  /**
   * 笔画的补充说明。
   *
   * 笔画框现在默认是空的，自动值只在这里显示 ——
   * 用户不用去改那个框，也能一眼看到系统到底用了多少画；
   * 手动改过就明确写出「已改为 X」，免得两边不一致还看不出来。
   */
  function strokesNote(autoTotal, reliable) {
    var m = manualStrokes();
    if (m !== null) {
      return m === autoTotal
        ? '　笔画 <b>' + m + '</b>'
        : '　<span style="color:#a9782c">笔画已手动改为 <b>' + m +
          '</b>（自动值 ' + autoTotal + '）</span>';
    }
    return reliable
      ? '　笔画取自动值 <b>' + autoTotal + '</b>'
      : '　暂用笔画 <b>' + autoTotal + '</b>（不可靠，建议手动填）';
  }

  function updateSurname() {
    var s = $('surname').value.trim();
    var info = resolveSurname(s);
    var hint = $('surnameInfo');

    if (!info) {
      hint.textContent = '';
      return;
    }
    var total = info.strokes.reduce(function (a, b) { return a + b; }, 0);
    if (info.known) {
      hint.innerHTML = '康熙笔画 ' + info.strokes.join(' + ') +
        (info.strokes.length > 1 ? ' = <b>' + total + '</b>' : '') +
        '　拼音 ' + info.pinyin.join(' ') + strokesNote(total, true);
    } else if (info.fromNet) {
      hint.innerHTML = '该姓氏不在常见姓氏表中。拼音取自联网拼音表：<b>' +
        esc(info.pinyin.join(' ')) + '</b>；笔画是联网字典的<b>简体笔画</b>（' +
        info.strokes.join(' + ') + '），不是康熙笔画，' +
        '<span style="color:#a63a2e">请核对后手动修正</span>。' +
        strokesNote(total, false);
    } else if (info.partial) {
      hint.innerHTML = '该姓氏不在常见姓氏表中，笔画取自字库，请自行核对后修正。' +
        strokesNote(total, false);
    } else {
      hint.innerHTML = '<span style="color:#a63a2e">未收录该姓氏：拼音未知，' +
        '谐音检测将无法覆盖姓氏，请手动填写康熙笔画。' +
        '（可在「词库管理」里联网更新拼音表后再试）</span>';
    }
  }

  /* ---------------- 八字实时提示 ---------------- */

  function currentXi() {
    var manual = Object.keys(state.xiManual);
    if (manual.length) return manual;
    return null; /* 交给八字推断 */
  }

  function updateBaziHint() {
    var v = $('birth').value;
    var hint = $('baziHint');
    var manual = currentXi();

    if (!v) {
      hint.innerHTML = manual
        ? '未填生辰，将按手动指定的喜用神「' + esc(manual.join('、')) + '」选字。'
        : '未填生辰，将按「名字内部五行搭配」评分。';
      return;
    }
    if (manual) {
      hint.innerHTML = '已手动指定喜用神「' + esc(manual.join('、')) + '」，将忽略自动推断。';
      return;
    }

    var dt = parseLocal(v, birthFlags());
    if (!dt) { hint.textContent = ''; return; }
    var info = computeBazi(dt);
    if (!info) { hint.textContent = ''; return; }

    /* 四柱少了哪几柱、哪一柱是推定的，必须写在提示里 ——
     * 否则用户会以为这就是完整四柱，也看不懂喜用神为什么是空的 */
    var miss = info.missing.length
      ? '　缺 <b style="color:#a63a2e">' + esc(info.missing.join('、')) + '</b>'
      : '';

    if (!info.dayGan) {
      hint.innerHTML = '八字 <b>' + esc(info.baziStr) + '</b>　' +
        '<span style="color:#a9782c">缺少日柱 → 没有日主，' +
        '身强身弱与喜用神都推不出来</span>' + fuzzyNote(info) + miss;
      return;
    }

    hint.innerHTML = '八字 <b>' + esc(info.baziStr) + '</b>　日主 <b>' +
      esc(info.dayGan + info.dayWx) + '</b>　' + esc(info.strength) +
      '　喜用神 <b style="color:#2f5d50">' + esc(info.xiyongshen.join('、')) +
      '</b>' + miss + fuzzyNote(info);
  }

  /**
   * 生辰模糊的说明语。三档由粗到细，**只说最粗的那一档** ——
   * 三句堆在一起会把真正要注意的那句洗干净。
   */
  function fuzzyNote(info) {
    var c = '　<span style="color:#a9782c">';
    var e = '</span>';
    if (info.noMonth) {
      return c + '只知道年份 → 月、日、时三柱未知，年柱按立春后推定' + e;
    }
    if (info.noDay) {
      return c + '只知道年月 → 日、时两柱未知，月柱按该月 15 日推定' + e;
    }
    if (info.noHour) {
      return c + '时辰未知 → 时柱未计入' + e;
    }
    return '';
  }

  /**
   * 「生辰模糊」三档的界面同步。
   *
   * 勾选关系是单向包含的：只知道年份 ⇒ 不知道哪一天 ⇒ 不知道几点。
   * 勾了粗档，下面两档自动跟着勾上并**压暗**。
   * 压暗而不是 disabled：disabled 的复选框不派发事件、也不显示为
   * 「被上一档决定的」，用户只会觉得它坏了；压暗 + title 才能说明原因。
   */
  function syncBirthMode() {
    var noM = $('birthNoMonth'), noD = $('birthNoDay'), noH = $('birthNoHour');
    if (!noM || !noD || !noH) return;

    /* 勾粗档时把细档一起勾上；取消粗档**不**自动取消细档 ——
     * 用户可能真的只想退回「不知道哪一天」这一档 */
    if (noM.checked) noD.checked = true;
    if (noD.checked) noH.checked = true;

    var f = birthFlags();
    lockCheck(noD, f.noMonth, '只知道年份 → 哪一天自然也未知');
    lockCheck(noH, f.noDay, '不知道哪一天 → 几点也无从谈起');

    var lunar = !!(NS.LunarInput && NS.LunarInput.mode() === 'l');
    var fuzzy = (f.noMonth || f.noDay) && !lunar;
    var row = $('fuzzyRow'), mSel = $('fuzzyMonth'), b = $('birth');
    var wasHidden = !row || row.hidden;

    if (row) row.hidden = !fuzzy;
    /* 只知道年份时月份整个隐藏 —— 留着它反而暗示月份是已知的 */
    if (mSel) mSel.hidden = f.noMonth;
    if (b) b.hidden = lunar || fuzzy;
    /* 农历模式下日期由农历面板负责，模糊档不参与 */
    var checks = $('fuzzyChecks');
    if (checks) checks.hidden = lunar;

    if (fuzzy) {
      /* 只在刚露出来时从 #birth 反推，否则每勾一下都会覆盖用户刚选的年月 */
      if (wasHidden) syncFuzzyFromBirth();
      writeFuzzyBirth();
    }

    /* 真太阳时算的正是时柱与日柱，缺任一一柱它都失去意义 */
    var off = !!(f.noMonth || f.noDay);
    var tst = $('useTST');
    if (tst) {
      tst.disabled = off;
      var tstRow = tst.closest('label');
      if (tstRow) tstRow.style.opacity = off ? '.5' : '';
    }
    if (b) b.disabled = false;
    updateBaziHint();
  }

  /** 压暗一个被上一档连带勾上的勾选框，并把原因写进 title */
  function lockCheck(cb, locked, why) {
    var wrap = cb.closest ? cb.closest('label') : null;
    if (wrap) wrap.classList.toggle('locked', !!locked);
    cb.title = locked ? why : '';
  }

  /** 建「只知道哪一年 / 哪年哪月」的年·月下拉 */
  function initFuzzySelects() {
    var ys = $('fuzzyYear'), ms = $('fuzzyMonth');
    if (!ys || !ms) return;
    var out = [];
    /* 倒序：出生年份通常离现在近，越近的越靠上。
     * 下限取 1900，与农历面板的范围保持一致，免得两处对不上。 */
    var cur = new Date().getFullYear();
    for (var y = cur; y >= 1900; y--) {
      out.push('<option value="' + y + '">' + y + ' 年</option>');
    }
    ys.innerHTML = out.join('');
    ys.value = '1990';

    var mo = [];
    for (var mm = 1; mm <= 12; mm++) {
      mo.push('<option value="' + mm + '">' + mm + ' 月</option>');
    }
    ms.innerHTML = mo.join('');
    ms.value = '6';
  }

  /**
   * 把「只知道哪一年 / 哪年哪月」的选择写成一个公历占位日期。
   *
   * 月和日固定填 1 —— 它们本来就被声明为未知，bazi.js 不会去读；
   * 写进去只为让 #birth 继续当**唯一的时间来源**，
   * 下游的填写记录、农历反推、分享链接都不必再加一套分支。
   */
  function writeFuzzyBirth() {
    var b = $('birth'), ys = $('fuzzyYear'), ms = $('fuzzyMonth');
    if (!b || !ys || !ys.value) return;
    var mo = $('birthNoMonth') && $('birthNoMonth').checked
      ? 1
      : Math.max(1, Math.min(12, parseInt(ms && ms.value, 10) || 1));
    b.value = ys.value + '-' + pad2(mo) + '-01T00:00';
    b.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 从 #birth 反推年·月下拉的初始值（只在模糊区刚露出来时用） */
  function syncFuzzyFromBirth() {
    var v = $('birth').value;
    var ys = $('fuzzyYear'), ms = $('fuzzyMonth');
    var m = v && v.match(/^(\d{4})-(\d{2})/);
    if (!m) return;
    if (ys && ys.querySelector('option[value="' + (+m[1]) + '"]')) {
      ys.value = String(+m[1]);
    }
    var mo = Math.max(1, Math.min(12, +m[2]));
    if (ms && ms.querySelector('option[value="' + mo + '"]')) {
      ms.value = String(mo);
    }
  }

  function parseLocal(v, flags) {
    if (!v) return null;
    /* 兼容直接传布尔的旧调用（只表示时辰未知） */
    var f = (typeof flags === 'boolean') ? { noHour: flags } : (flags || {});
    var noMonth = !!f.noMonth;
    var noDay = noMonth || !!f.noDay;
    var noHour = noDay || !!f.noHour;

    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    /* 只到日期（不带 T 时间）也接受，同样按「时辰未知」处理 */
    var dm = m ? null : v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m && !dm) return null;
    var g = m || dm;
    /* 模糊的那些部分**强行忽略**，而不是把时柱瞎填成 00:00 ——
     * 一柱变了整个五行力量就变了，算出来的喜用神是假的，比不算更糟。
     * 标志一并带出去，下游（baziOptions / computeBazi）不用再读一遍 DOM。 */
    return {
      y: +g[1], m: +g[2], d: +g[3],
      h: m ? +m[4] : 0,
      mi: m ? +m[5] : 0,
      noHour: noHour, noDay: noDay, noMonth: noMonth
    };
  }

  /** 输入框当前是否处于「时辰未知」模式 */
  function birthNoHour() {
    var cb = $('birthNoHour');
    return !!(cb && cb.checked);
  }

  /**
   * 生辰模糊的三档标志。
   *
   * 三档是**单向包含**的：只知道年份 ⇒ 哪一天也不知道 ⇒ 几点更无从谈起。
   * 所以读出三个勾选框之后要向上补齐 —— 否则「只勾了年份」会算出
   * 「日柱已知、月柱未知」这种自相矛盾的组合。
   * 补齐逻辑与 core/bazi.js 的 calcBazi 必须同源，改一处要改两处。
   */
  function birthFlags() {
    var cbM = $('birthNoMonth'), cbD = $('birthNoDay'), cbH = $('birthNoHour');
    var noMonth = !!(cbM && cbM.checked);
    var noDay = noMonth || !!(cbD && cbD.checked);
    return {
      noMonth: noMonth, noDay: noDay,
      noHour: noDay || !!(cbH && cbH.checked)
    };
  }

  function baziOptions(flags) {
    var f = flags || {};
    var lon = parseFloat($('longitude').value);
    var noDay = !!(f.noMonth || f.noDay);
    /* 真太阳时算的正是时柱与日柱，这两柱都不存在时它没有意义 ——
     * 硬算只会把一个未知的东西变成一个看起来确定的值。 */
    var useTST = !noDay && $('useTST').checked && isFinite(lon);
    return {
      trueSolarTime: useTST,
      noHour: noDay || !!f.noHour,
      noDay: noDay,
      noMonth: !!f.noMonth,
      longitude: isFinite(lon) ? lon : undefined
    };
  }

  function computeBazi(dt) {
    try {
      /* dt 里已经带着三档标志（parseLocal 写进去的），直接传即可 */
      return NS.Bazi.analyzeBazi(dt.y, dt.m, dt.d, dt.h, dt.mi,
        baziOptions(dt));
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  /* ---------------- 提交 ---------------- */

  function buildOptions() {
    var surname = $('surname').value.trim();
    if (!surname) throw new Error('请先填写姓氏。');

    var info = resolveSurname(surname);
    /* 留空 = 按姓氏表自动（这正是现在的默认状态）；
     * 手工填了才覆盖。下面对复姓再单独处理一次。 */
    var ms = manualStrokes();
    var strokes = (ms !== null) ? [ms] : (info ? info.strokes : [8]);

    /* 复姓的手工笔画：按录入的一个总数平均分配不合适，
     * 因此复姓时优先使用内置数据，未收录则提示。 */
    if (surname.length > 1 && info && info.known) strokes = info.strokes;

    var dt = parseLocal($('birth').value, birthFlags());
    var baziInfo = dt ? computeBazi(dt) : null;

    var xi = currentXi();
    if (!xi && baziInfo) xi = baziInfo.xiyongshen;

    return {
      surname: surname,
      surnameStrokes: strokes,
      surnameSyllables: info
        ? surname.split('').map(function (c, i) {
          return { char: c, pinyin: info.pinyin[i] || '', tone: info.tones[i] || 0 };
        })
        : undefined,
      gender: state.gender,
      style: $('style').value,
      length: state.givenLength,
      top: Math.max(1, Math.min(parseInt($('top').value, 10) || 12, 60)),
      keywords: splitWords($('keywords').value),
      taboo: splitChars($('taboo').value),
      mustInclude: splitChars($('mustInclude').value),
      preferRadicals: pickedRadicals(),
      avoidRadicals: avoidedRadicals(),
      radicalMode: ($('radAll') && $('radAll').checked) ? 'all' : 'any',
      xiyongshen: xi || [],
      _baziInfo: baziInfo
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    if (state.cancel) state.cancel();

    var opts;
    try {
      opts = buildOptions();
    } catch (err) {
      renderError(err.message);
      return;
    }

    var plan;
    try {
      plan = NS.Generator.plan(opts);
    } catch (err) {
      console.error(err);
      renderError('生成计划失败：' + err.message);
      return;
    }

    if (!plan.pool.length) {
      renderError('没有符合条件（性别 / 避用字）的用字，请放宽条件。');
      return;
    }

    renderProgress(plan, opts);
    $('go').disabled = true;

    state.cancel = NS.Generator.runAsync(plan, {
      onProgress: function (done, total) {
        var pct = total ? Math.min(100, done / total * 100) : 0;
        var f = $('progressFill'), t = $('progressPct');
        if (f) f.style.width = pct.toFixed(1) + '%';
        if (t) t.textContent = pct.toFixed(0) + '%';
      },
      onDone: function (results, stats) {
        state.cancel = null;
        $('go').disabled = false;
        state.lastResults = results;
        state.lastBazi = opts._baziInfo;
        state.lastOpts = opts;
        state.ranking = (stats && stats.ranking) ? stats.ranking : results;
        state.ctx = plan.ctx;
        state.page = 0;
        state.onlyKw = false;
        state.picked = [];
        renderResults(results, stats, plan, opts);
      }
    });
  }

  /* ---------------- 渲染 ---------------- */

  function renderError(msg) {
    $('results').innerHTML = '';
    var box = el('div', 'panel');
    box.style.padding = '18px 20px';
    var a = el('div', 'alert', msg);
    box.appendChild(a);
    $('results').appendChild(box);
  }

  function renderProgress(plan, opts) {
    var box = el('div', 'panel progress-panel');
    box.appendChild(el('div', 'section-title', '正在筛选名字…'));

    var p = el('p', 'hint');
    p.style.margin = '0 0 4px';
    p.innerHTML = '候选用字池 <b>' + plan.poolInfo.pickedSize + '</b> 字' +
      '（字库共 ' + plan.poolInfo.poolSize + ' 字符合性别与避用条件）' +
      '，需枚举 <b>' + plan.total.toLocaleString() + '</b> 种组合。';
    box.appendChild(p);

    var track = el('div', 'progress-bar');
    var fill = el('div', 'fill');
    fill.id = 'progressFill';
    track.appendChild(fill);
    box.appendChild(track);

    var txt = el('div', 'progress-text');
    txt.appendChild(el('span', null, '逐组合比对五行、音韵、谐音与诗词出处'));
    var pct = el('span', null, '0%');
    pct.id = 'progressPct';
    txt.appendChild(pct);
    box.appendChild(txt);

    $('results').innerHTML = '';
    $('results').appendChild(box);
  }

  /* --- 八字面板 --- */

  /**
   * 某一柱为什么是空的。三档模糊的原因各不相同，
   * 一律写「时辰未填」会在「不知道哪一天」时误导用户 ——
   * 他会以为只需补时辰，而实际缺的是整个日期。
   */
  function unknownWhy(label) {
    if (label === '月') return '月份未知';
    if (label === '日') return '日期未知';
    return '时辰未填';
  }

  function unknownTip(label) {
    if (label === '月') {
      return '只知道出生年份 → 月柱无法确定。\n五行力量只计入了年柱。';
    }
    if (label === '日') {
      return '不知道具体哪一天 → 没有日柱，也就没有日主。\n' +
        '身强身弱、十神、喜用神都是以日主为参照物推的，因此都算不了。';
    }
    return '不知道出生时辰 → 时柱无法确定。\n' +
      '五行力量与十神均未计入时柱。';
  }

  /**
   * 八字面板底部的模糊说明。三档由粗到细，只说最粗的那一档 ——
   * 三句堆在一起会把真正要注意的那句洗干净。
   */
  function fuzzyPanelNote(info) {
    var p = el('p', 'more-note');
    if (info.noMonth) {
      p.innerHTML = '<b>你选了「只知道哪一年」</b> —— 月柱、日柱、时柱' +
        '<b>三柱都无法确定</b>，上面的五行分布只计入了年柱。' +
        '年柱本身也是按「立春后」推定的：若生于当年 1 月 1 日到 2 月初之间，' +
        '年柱与生肖应当退一年。<br>' +
        '<b>没有日柱就没有日主</b>，身强身弱、十神、喜用神都是以日主为' +
        '参照物推出来的，所以一个都算不了 —— 本次<b>不做喜用神判断</b>，' +
        '选字只按名字本身的五行搭配评分。能问到出生月份就能多出一柱，' +
        '问到具体日期则一切完整。';
      return p;
    }
    if (info.noDay) {
      p.innerHTML = '<b>你选了「不知道具体哪一天」</b> —— 日柱与时柱' +
        '<b>无法确定</b>，上面的五行分布只计入了年柱与月柱；' +
        '月柱是按<b>该月 15 日</b>推定的（每个月的「节」落在 3–9 日，' +
        '所以只有生于该月 1–8 日左右才可能有差异）。<br>' +
        '<b>没有日柱就没有日主</b>，身强身弱、十神、喜用神都推不出来 —— ' +
        '本次<b>不做喜用神判断</b>，选字只按名字本身的五行搭配评分。' +
        '日期是可以查到的（出生证、户口本、医院记录），补上后结果会完整得多。';
      return p;
    }
    if (info.noHour) {
      p.innerHTML = '<b>你选了「不知道几点出生」</b> —— ' +
        '时柱（也就是出生的时辰）无法确定，因此上面的五行力量与十神' +
        '<b>都没有计入时柱</b>，喜用神是按年、月、日三柱推出来的。' +
        '一个日期换个时辰，整张盘的五行强弱就可能翻转，所以' +
        '<b>这个喜用神只是个大概方向</b>。' +
        '若能问到出生时辰（出生证、接生记录、家人回忆「上午还是下午」都有帮助），' +
        '填上后结果会准很多。';
      return p;
    }
    return null;
  }

  function renderBazi(info, opts) {
    var panel = el('div', 'panel bazi-panel');
    var title = el('div', 'section-title');
    title.appendChild(el('span', null, '八字与喜用神'));
    var tag = el('span', 'tag-mini');
    if (info) {
      tag.textContent = info.meta.trueSolarTime
        ? '含真太阳时校正 ' + (info.meta.deltaMin > 0 ? '+' : '') + info.meta.deltaMin + ' 分钟'
        : '按北京时间';
    } else {
      tag.textContent = opts.xiyongshen.length ? '手动指定喜用神' : '未提供生辰';
    }
    title.appendChild(tag);
    panel.appendChild(title);

    if (!info) {
      var msg = el('p', 'hint');
      msg.style.margin = '0';
      msg.innerHTML = opts.xiyongshen.length
        ? '未填出生时间，按手动指定的喜用神「<b>' +
        esc(opts.xiyongshen.join('、')) + '</b>」选字。'
        : '未填出生时间，五行项按「名字内部五行搭配」评分。' +
        '填写生辰可获得更准确的补益建议。';
      panel.appendChild(msg);
      return panel;
    }

    /* 四柱 */
    var grid = el('div', 'pillar-grid');
    info.pillars.forEach(function (p) {
      var cell = el('div', 'pillar' + (p.unknown ? ' unknown' : ''));
      cell.appendChild(el('div', 'lbl', p.label + '柱'));
      /* 时辰未知：明确写出来，不能留空 ——
       * 空格子容易被当成「算过了但没显示」。 */
      if (p.unknown) {
        cell.appendChild(el('div', 'ss', '未知'));
        cell.appendChild(el('div', 'gz nz', '？？'));
        cell.appendChild(el('div', 'cg', unknownWhy(p.label)));
        cell.title = unknownTip(p.label);
        grid.appendChild(cell);
        return;
      }
      /* 十神按传统排盘放在干支**上方** —— 先看十神再看字，
       * 这也是所有八字软件的习惯位置，换位置反而要重新适应。 */
      var ss = el('div', 'ss' + (p.ganShishen === '日主' ? ' self' : ''),
        p.ganShishen);
      if (p.ganYinYang) ss.title = p.gan + '为' + p.ganYinYang + p.ganWx;
      cell.appendChild(ss);
      var gz = el('div', 'gz');
      gz.innerHTML = '<span class="' + WX_CLASS[p.ganWx] + '">' + esc(p.gan) +
        '</span><span class="' + WX_CLASS[p.zhiWx] + '">' + esc(p.zhi) + '</span>';
      cell.appendChild(gz);
      /* 藏干带上各自的十神，鼠标悬停可见 */
      var cg = el('div', 'cg');
      cg.innerHTML = p.cangGan.map(function (g) {
        return '<span title="' + esc(g.gan + '（' + g.yinYang + '）＝' + g.shishen) +
          '">' + esc(g.gan) + '</span>';
      }).join('·');
      cell.appendChild(cg);
      grid.appendChild(cell);
    });
    panel.appendChild(grid);

    /* 五行条形图 */
    var max = Math.max.apply(null, NS.WUXING.map(function (w) {
      return info.power[w];
    }).concat([1]));
    var bars = el('div', 'wx-bars');
    NS.WUXING.forEach(function (w) {
      var row = el('div', 'wx-bar');
      row.appendChild(el('div', 'name ' + WX_CLASS[w], w));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = (info.power[w] / max * 100).toFixed(1) + '%';
      fill.style.background = WX_COLOR[w];
      track.appendChild(fill);
      row.appendChild(track);
      var cnt = info.count[w];
      row.appendChild(el('div', 'val', cnt + '个'));
      bars.appendChild(row);
    });
    panel.appendChild(bars);

    /* 结论 */
    var facts = el('div', 'bazi-facts');
    function fact(label, valueHtml) {
      var s = el('span');
      s.innerHTML = label + ' ' + valueHtml;
      facts.appendChild(s);
    }
    fact('四柱', '<b>' + esc(info.baziStr) + '</b>');
    fact('生肖', '<b>' + esc(info.shengxiao) + '</b>');
    if (info.dayGan) {
      fact('日主', '<b class="' + WX_CLASS[info.dayWx] + '">' +
        esc(info.dayGan + info.dayWx) + '</b>');
      fact('强弱', '<b>' + esc(info.strength) + '</b>');
      fact('喜用神', '<span class="fact-xi">' +
        esc(info.xiyongshen.join('、') || '—') + '</span>');
    } else {
      /* 没有日柱就没有日主 —— 这两项不能显示空白，
       * 空白会被当成「算过了但没值」 */
      fact('日主', '<span class="fact-miss">未知（缺日柱）</span>');
      fact('喜用神', '<span class="fact-miss">推不出来</span>');
    }
    if (info.missing.length) {
      fact('五行缺', '<span class="fact-miss">' + esc(info.missing.join('、')) + '</span>');
    } else {
      fact('五行', '齐全');
    }
    if (info.meta.jieqi) fact('当前节气', '<b>' + esc(info.meta.jieqi) + '</b>');
    /* 缺了哪一柱、哪一柱是推定的，必须逐项写出来 ——
     * 同样一个日期换个时辰，整张盘的五行力量就变了，
     * 不能让人以为这是完整四柱。 */
    if (info.noMonth) {
      fact('月柱', '<span class="fact-miss">未知</span>');
    } else if (info.monthAssumed) {
      fact('月柱', '<span style="color:#a9782c">按 15 日推定</span>');
    }
    if (info.noDay) fact('日柱', '<span class="fact-miss">未知</span>');
    if (info.noHour) fact('时柱', '<span class="fact-miss">未知</span>');
    panel.appendChild(facts);

    var fuzzyWarn = fuzzyPanelNote(info);
    if (fuzzyWarn) panel.appendChild(fuzzyWarn);

    /* 十神。放在五行之后、结论之前 ——
     * 它是「五行力量的另一种说法」：五行说的是能量的属性，
     * 十神说的是这股能量相对于日主扮演什么角色（同辈/长辈/子女/财/官）。
     * 顺序写死（比劫→印→食伤→财→官杀），不按数值排，
     * 否则同一份八字在不同页面上的顺序会乱跳。 */
    if (info.shishen) {
      var ssBox = el('div', 'ss-box');
      var ssHead = el('div', 'ss-head');
      ssHead.innerHTML = '十神　<span class="ss-sub">日主 ' +
        esc(info.dayGan) + '（' + esc(info.dayYinYang + info.dayWx) + '）　' +
        '力量按天干 1.0、藏干本气 1.0 / 中气 0.5 / 余气 0.3、月令 ×1.5 加权</span>';
      ssBox.appendChild(ssHead);

      var ssList = el('div', 'ss-list');
      NS.Bazi.SHISHEN_ORDER.forEach(function (n) {
        var v = info.shishen.power[n] || 0;
        var item = el('span', 'ss-item' + (v ? '' : ' zero') +
          (n === info.shishen.dominant ? ' top' : ''));
        item.innerHTML = '<b>' + esc(n) + '</b><i>' +
          (v ? v.toFixed(1) : '—') + '</i>';
        item.title = n + '（' + NS.SHISHEN_GROUP[n] + '）　力量 ' +
          (v ? v.toFixed(1) : '0，八字里没有出现');
        ssList.appendChild(item);
      });
      ssBox.appendChild(ssList);

      if (info.shishen.missing.length) {
        var ssNote = el('p', 'more-note');
        ssNote.innerHTML = '八字里没有出现的十神：<b>' +
          esc(info.shishen.missing.join('、')) + '</b>。' +
          '和「五行缺」一样，<b>缺什么不等于该补什么</b> —— ' +
          '十神要不要补，要看它对日主是喜是忌，本系统不因「缺某个十神」而改推荐。';
        ssBox.appendChild(ssNote);
      }
      panel.appendChild(ssBox);
    }

    /* 调候：只做「冬宜火、夏宜水」这条无争议的原则，春秋不判定。
     * 与扶抑法不一致时用 warn 色标出来，但**不改推荐**。 */
    if (info.tiaohou && info.tiaohou.applies) {
      var th = info.tiaohou;
      var thBox = el('div', 'th-box' + (th.conflict ? ' warn' : ''));
      thBox.innerHTML = '<b>调候</b>　月支 ' + esc(th.monthZhi) +
        '（' + esc(th.seasonLabel) + '）宜见 ' +
        '<b class="' + WX_CLASS[th.needWx] + '">' + esc(th.needWx) + '</b>' +
        '（本命局占 ' + (th.ratio * 100).toFixed(0) + '%' +
        (th.weak ? '，偏虚' : '，不虚') + '）';
      if (th.conflict) {
        thBox.innerHTML += '<span class="th-cf">与扶抑法口径不一致：' +
          '扶抑取「' + esc(info.xiyongshen.join('、')) + '」，' +
          '调候取「' + esc(th.needWx) + '」—— <b>本次仍按扶抑法选字</b></span>';
      } else if (th.weak) {
        thBox.innerHTML += '<span class="th-ok">与扶抑法方向一致</span>';
      }
      thBox.title = th.note;
      panel.appendChild(thBox);
    }

    /* 地支刑冲合害。**只展示、不改推荐分数** ——
     * 按地支关系去修正五行力量（合化/冲损）是有流派分歧的做法，
     * 详见 core/branches.js 头部。 */
    var br = info.branchRel;
    if (br) {
      var brBox = el('div', 'br-box');
      var brHead = el('div', 'br-head');
      brHead.innerHTML = '地支关系　<span class="br-sub">' +
        esc(br.pillars.map(function (p) { return p.zhi; }).join(' ')) +
        '　（只作参考，不参与评分）</span>';
      brBox.appendChild(brHead);

      var brList = el('div', 'br-list');
      function brChip(cls, text) {
        brList.appendChild(el('span', 'br-chip ' + cls, text));
      }
      br.chong.forEach(function (c) {
        brChip('chong', c.a + c.b + ' 冲（' + c.where + '）');
      });
      br.he.forEach(function (c) {
        brChip('he', c.a + c.b + ' 合（' + c.where + '）');
      });
      br.xing.forEach(function (c) {
        brChip('xing', c.full
          ? c.a + ' ' + c.name
          : c.a + c.b + ' ' + (c.a === c.b ? '自刑' : c.name) +
            '（' + c.where + '）');
      });
      br.hai.forEach(function (c) {
        brChip('hai', c.a + c.b + ' 害（' + c.where + '）');
      });
      br.sanhe.concat(br.sanhui).forEach(function (g) {
        brChip(g.complete ? 'full' : 'part',
          g.label + '　' + (g.complete ? '齐' : '有' + g.present.join('') +
            '缺' + g.missing.join('')));
      });
      if (!brList.children.length) {
        brChip('none', '四支之间没有冲/合/刑/害');
      }
      brBox.appendChild(brList);

      br.advice.forEach(function (a) {
        var adv = el('p', 'br-advice');
        adv.innerHTML = '<b>' + esc(a.title) + '</b>　' + esc(a.text);
        brBox.appendChild(adv);
      });
      if (br.note) {
        brBox.appendChild(el('p', 'more-note', br.note));
      }
      panel.appendChild(brBox);
    }

    if (opts.xiyongshen.join('') !== info.xiyongshen.join('')) {
      var note = el('p', 'more-note');
      note.innerHTML = '本次按手动指定的喜用神「<b>' +
        esc(opts.xiyongshen.join('、')) + '</b>」选字。';
      panel.appendChild(note);
    }

    return panel;
  }

  /* --- 名字卡片 --- */

  function scoreColor(s) {
    if (s >= 85) return '#2f5d50';
    if (s >= 72) return '#3f7d6b';
    if (s >= 58) return '#a9782c';
    return '#8b857a';
  }

  function renderNameCard(item, rank) {
    /* compact 类给 CSS 用：简洁模式下收紧内边距与行距 */
    var card = el('div', 'panel name-card' + (state.compact ? ' compact' : ''));

    /* 同音替换建议：卡片摘要与详细分析共用一次计算，避免重复评分 */
    var variants = state.ctx
      ? NS.Variant.forName(item, state.ctx, { limit: 3, outerLimit: 2 }) : [];

    /* 头部 */
    var head = el('div', 'nc-head');
    var left = el('div');

    var isCompound = item.name.length > item.given.length + 1;
    var h = el('h3', 'nc-name');
    if (isCompound) {
      h.innerHTML = esc(item.name.slice(0, 2)) +
        '<span style="opacity:.92">' + esc(item.given) + '</span>';
    } else {
      h.innerHTML = esc(item.name.slice(0, 1)) +
        '<span style="opacity:.92">' + esc(item.given) + '</span>';
    }
    left.appendChild(h);

    var pyLine = el('div', 'nc-pinyin');
    pyLine.innerHTML = '<span style="white-space:nowrap">' +
      esc(item.pinyin) + '</span>　·　<span style="white-space:nowrap">第 ' +
      rank + ' 名</span>';
    left.appendChild(pyLine);

    var tags = el('div', 'nc-tags');
    item.wuxing.forEach(function (w, i) {
      tags.appendChild(el('span', 'tag jade', '五行 ' + w));
    });
    if (item.wuge) {
      var ji = item.wuge.三才吉凶;
      tags.appendChild(el('span', 'tag ' + (ji === '大吉' ? 'gold' : ''),
        '三才 ' + item.wuge.三才 + ' · ' + ji));
    }
    if (item.heat) {
      tags.appendChild(el('span', 'tag ' +
        (item.heat.level === 'rare' ? 'jade'
          : item.heat.level === 'very-hot' ? 'red' : ''),
        '重名热度 ' + item.heat.value));
    }
    if (item.strokes && item.strokes.length) {
      tags.appendChild(el('span', 'tag', '笔画 ' + item.strokes.join('+')));
    }
    /* 偏旁重复：只提示、不扣分。偏旁表只覆盖内置字库，
     * 若参与评分会让「联网加字」暗中拉低分数，属于数据缺陷污染排序。 */
    var rad = NS.Radical.check(item.chars);
    if (rad.dupes.length) {
      var radTag = el('span', 'tag warn', '偏旁重复 ' +
        rad.dupes.map(function (d) { return d.name; }).join(''));
      radTag.title = NS.Radical.describe(rad) +
        '。同一个名字里多个字共用偏旁，写出来偏笨重，仅作提示。';
      tags.appendChild(radTag);
    }
    /* 含联网加入的「推断字」时明确标注，避免把推断值当权威数据 */
    var inferChars = item.chars.filter(function (c) {
      return NS.CHAR_DB[c] && NS.CHAR_DB[c].__inferred;
    });
    if (inferChars.length) {
      var inferTag = el('span', 'tag red', '含推断字 ' + inferChars.join(''));
      inferTag.title = '这些字是联网加入的：五行按部首推断、康熙笔画为估算值，请人工核对';
      tags.appendChild(inferTag);
    }
    left.appendChild(tags);
    head.appendChild(left);

    /* 评分环 */
    var ring = el('div', 'score-ring');
    ring.style.setProperty('--pct', item.score);
    ring.style.setProperty('--ring', scoreColor(item.score));
    var inner = el('div');
    inner.appendChild(el('div', 'num', String(Math.round(item.score))));
    inner.appendChild(el('span', 'unit', '分'));
    ring.appendChild(inner);
    head.appendChild(ring);

    card.appendChild(head);

    /* 评分理由 */
    if (item.reasons && item.reasons.length) {
      var rs = el('div', 'nc-reasons');
      item.reasons.forEach(function (r) {
        var bad = r.indexOf('谐音') >= 0;
        rs.appendChild(el('span', 'reason' + (bad ? ' warn' : ''), r));
      });
      card.appendChild(rs);
    }

    /* 补充信息区：字义 / 小名 / 方言 / 同音替换 / 出处 / 热度条。
     * 简洁模式下整块塞进卡片底部的 <details>，一屏能多看好几个名字。
     * 用一层容器包住，折叠时只需移动一个节点。 */
    var extra = el('div', 'nc-extra');

    /* 字义 */
    extra.appendChild(el('p', 'nc-meaning', item.meaning));

    /* 小名建议 —— 列出一组不同构词法的候选。
     * 用户反馈「小名也可以多样化，也不一定是叠词」：
     * 旧版只给分数最高的一个，而叠字权重最高，所以永远只看到叠词。 */
    var nnList = item.nicknames || (item.nickname ? [item.nickname] : []);
    if (nnList.length) {
      var nick = el('div', 'nc-nick');
      var nHead = el('span', 'nc-nick-head', '小名建议');
      if (nnList[0].risky) {
        nHead.appendChild(el('span', 'nc-nick-risk', '有谐音风险，仅供参考'));
      }
      nick.appendChild(nHead);

      var nList = el('div', 'nc-nick-list');
      nnList.forEach(function (nn, i) {
        var chip = el('span', 'nc-nick-item' + (i === 0 ? ' top' : ''));
        chip.innerHTML = '<b>' + esc(nn.name) + '</b>' +
          '<i>' + esc(nn.patternLabel) + '</i>';
        chip.title = nn.pinyin + '　' + nn.patternLabel +
          (nn.reasons.length ? '　' + nn.reasons.join(' · ') : '');
        nList.appendChild(chip);
      });
      nick.appendChild(nList);

      nick.appendChild(el('span', 'nc-nick-why',
        esc(nnList[0].pinyin) +
        (nnList[0].reasons.length ? '　' + esc(nnList[0].reasons.join(' · ')) : '')));
      extra.appendChild(nick);
    }

    /* 四川话提示 */
    if (item.sichuan && (item.sichuan.hits.length || item.sichuan.notes.length)) {
      var sc = el('div', 'nc-dialect');
      var parts = [];
      item.sichuan.hits.forEach(function (h) {
        parts.push('<b class="bad">' + esc(h.desc) + '</b>');
      });
      item.sichuan.notes.forEach(function (h) {
        parts.push(esc(h.desc));
      });
      sc.innerHTML = '四川话读作 <span class="sc-py">' +
        esc(item.sichuan.pinyin) + '</span>　' + parts.join('；') +
        '<span class="nc-nick-meta">（方言提示，不代表名字不好，请自行取舍）</span>';
      extra.appendChild(sc);
    }

    /* 同音替换：读音不变、五行尽量不变，换成更冷门的字 */
    if (variants.length) {
      var vbox = el('div', 'nc-variant');
      var vparts = ['<span class="ncv-label">同音可换</span>'];
      var anyApprox = false;
      variants.forEach(function (g) {
        vparts.push('<span class="ncv-group"><b>' + esc(g.from) + '</b> → ');
        g.options.slice(0, 3).forEach(function (o, oi) {
          if (oi) vparts.push(' ');
          if (o.approx) anyApprox = true;
          var heatTxt = o.heat ? o.heat.value : '?';
          var tip = o.char + '　' + o.wuxing + '　' + o.strokes +
            ' 画　热度 ' + heatTxt + '　换成「' + o.name + '」得 ' + o.score + ' 分' +
            (o.delta === 0 ? '（分数不变）'
              : '（' + (o.delta > 0 ? '+' : '') + o.delta + ' 分）') +
            (o.approx ? '　※ 词库外的字：五行与笔画按部首推断，需人工核对' : '');
          vparts.push('<span class="ncv-opt' + (o.approx ? ' approx' : '') +
            '" title="' + esc(tip) + '">' +
            esc(o.char) + (o.approx ? '<u>*</u>' : '') +
            '<i>' + heatTxt + '</i></span>');
        });
        vparts.push('</span>');
      });
      vparts.push('<span class="ncv-note">同音且五行相同者优先，' +
        '小字为重名热度，越低越冷门' +
        (anyApprox ? '；<b>*</b> 为词库外同音字，五行按部首推断，仅供参考' : '') +
        '</span>');
      vbox.innerHTML = vparts.join('');
      extra.appendChild(vbox);
    }

    /* 诗词出处。分级显示 —— 「出处成词」和「同篇出处」的含金量差很多，
     * 不加区分的话，用户无从判断这条出处是不是硬凑的。 */
    if (item.poetry) {
      var KIND_LABEL = {
        classic: '出处成词',
        weak: '疑似成词',
        everyday: '常见词语（不算典故）',
        line: '同句出处',
        poem: '同篇出处'
      };
      var kind = item.pairKind || 'poem';
      var dim = (kind === 'poem' || kind === 'everyday');
      var po = el('div', 'nc-poetry' + (dim ? ' weak' : ''));
      var kindCls = 'nc-poetry-kind'
        + (kind === 'classic' ? ' good' : '')
        + (kind === 'everyday' ? ' warn' : '');
      var head = el('span', kindCls,
        KIND_LABEL[kind] || '出处');
      if (kind === 'classic' && item.poetry.pair) {
        head.textContent = KIND_LABEL.classic + '「' + item.poetry.pair + '」';
      }
      po.appendChild(head);
      po.appendChild(document.createTextNode('「' + item.poetry.line + '」'));
      po.appendChild(el('span', 'src',
        '—— 《' + item.poetry.source + '》·' + item.poetry.title));
      extra.appendChild(po);
    }

    /* 底部信息：热度条 + 五格摘要 —— 属于补充信息，跟着折叠区走 */
    if (item.heat) {
      var heat = el('div', 'heat ' + item.heat.level);
      heat.appendChild(el('span', null, '重名热度'));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = item.heat.value + '%';
      track.appendChild(fill);
      heat.appendChild(track);
      heat.appendChild(el('span', null, item.heat.text));
      extra.appendChild(heat);
    }
    if (item.wuge) {
      var wm = el('div', 'wuge-mini');
      wm.innerHTML = '天格 <b>' + item.wuge.天格 + '</b>　人格 <b>' +
        item.wuge.人格 + '</b>　地格 <b>' + item.wuge.地格 +
        '</b>　总格 <b>' + item.wuge.总格 + '</b>';
      extra.appendChild(wm);
    }

    /* 操作行：加入对比 / 加入候选池。
     * 这两个不折叠 —— 「挑几个存进候选池」是主流程，
     * 藏进 <details> 会让每一步都多一次点击。 */
    var foot = el('div', 'nc-foot');

    /* 加入对比（跨批次保留，方便「换一批」后继续挑） */
    var pick = el('label', 'nc-pick');
    var pcb = document.createElement('input');
    pcb.type = 'checkbox';
    pcb.checked = state.picked.indexOf(item.name) >= 0;
    pcb.addEventListener('change', function () {
      var k = state.picked.indexOf(item.name);
      if (pcb.checked) {
        if (k < 0) state.picked.push(item.name);
      } else if (k >= 0) {
        state.picked.splice(k, 1);
      }
      updateCompareBar();
    });
    pick.appendChild(pcb);
    pick.appendChild(el('span', null, '加入对比'));
    foot.appendChild(pick);

    /* 加入候选池 —— 孕期先存起来，出生后填真实八字重筛。
     * 之所以要这个按钮：取名通常发生在出生前，而预估的喜用神
     * 很可能不是孩子真正的喜用神（差几天四柱就全变了）。 */
    var poolBtn = el('button', 'btn tiny ghost nc-pool', '加入候选池');
    poolBtn.type = 'button';
    poolBtn.addEventListener('click', function () {
      var surname = (state.lastOpts && state.lastOpts.surname) ||
        ($('surname') ? $('surname').value.trim() : '');
      var baziInfo = state.lastOpts && state.lastOpts._baziInfo;
      NS.Pool.add({
        surname: surname,
        given: item.chars.join(''),
        gender: state.gender || '',
        baziStr: baziInfo ? baziInfo.baziStr : ''
      }).then(function (r) {
        poolBtn.textContent = r.added
          ? '已加入候选池 ✓'
          : (r.reason || '未加入');
        poolBtn.disabled = r.added;
        refreshPoolDot();
      });
    });
    foot.appendChild(poolBtn);

    /* 补充信息放在操作行之前。行高顺序：名字 → 理由 → 补充信息 → 操作 → 详情 */
    if (!state.compact) card.appendChild(extra);
    card.appendChild(foot);

    /* 详情。简洁模式下这里还兼作「补充信息」的收纳处 ——
     * 字义、小名、方言、同音替换、出处、热度条全塞进来，
     * 卡片留在屏幕上不被遮的部分就只剩名字、分数、标签和一句理由。 */
    var more = document.createElement('details');
    more.className = 'more';
    var sum = document.createElement('summary');
    sum.textContent = state.compact
      ? '展开详情（字义 · 小名 · 出处 · 热度 · 五格）'
      : '查看详细分析';
    more.appendChild(sum);

    var body = el('div', 'more-body');
    /* 简洁模式才折叠；详细模式让 extra 平铺在卡片里，与旧版一致 */
    if (state.compact) body.appendChild(extra);

    if (item.wuge) {
      var t = el('table', 'wuge-table');
      [['天格', item.wuge.天格, item.wuge.天格五行],
      ['人格', item.wuge.人格, item.wuge.人格五行],
      ['地格', item.wuge.地格, item.wuge.地格五行],
      ['总格', item.wuge.总格, item.wuge.总格五行],
      ['外格', item.wuge.外格, item.wuge.外格五行]].forEach(function (r) {
        var tr = el('tr');
        var td1 = el('td', null, r[0]);
        var td2 = el('td');
        td2.innerHTML = '<b>' + r[1] + '</b><span class="wx ' +
          WX_CLASS[r[2]] + '">' + r[2] + '</span>';
        /* 第三列原本一直是空的（建了 td 却没填内容，也一直没人发现）。
         * 现在放 81 数理的判语 —— 这才是姓名学使用者真正想看的东西。 */
        var td3 = el('td', 'sl-cell');
        var sl = NS.shuliOf ? NS.shuliOf(r[1]) : null;
        if (sl) {
          td3.innerHTML = '<b class="sl-' + (sl.ji === '吉' ? 'ji' :
            sl.ji === '凶' ? 'xiong' : 'half') + '">' + esc(sl.ji) +
            '</b><span class="sl-name">' + esc(sl.name) + '</span>';
          td3.title = sl.n + ' ' + sl.name + '（' + sl.ji + '）：' + sl.text +
            '\n\n此为姓名学（五格剖象法）说法，与八字喜用神不同源，仅供参考。';
        }
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        t.appendChild(tr);
      });
      body.appendChild(t);

      var note = el('p', 'more-note');
      note.innerHTML = '三才 <b>' + esc(item.wuge.三才) + '</b>（' +
        esc(item.wuge.三才关系) + '）→ <b>' + esc(item.wuge.三才吉凶) +
        '</b>。数理派与八字喜用神体系不同，仅供参考，以八字为准。';
      body.appendChild(note);
    }

    /* 音韵与谐音 */
    var h = item.homophone;
    if (h) {
      var hy = el('p', 'more-note');
      var parts = ['全拼 <b>' + esc(h.pinyin) + '</b>'];
      if (h.hits.length) {
        parts.push('<span style="color:#a63a2e">谐音拦截：' +
          esc(h.hits.map(function (x) { return x.desc; }).join('；')) + '</span>');
      }
      if (h.warnings.length) {
        parts.push('提示：' + esc(h.warnings.map(function (x) {
          return x.desc;
        }).join('；')));
      }
      if (!h.hits.length && !h.warnings.length) {
        parts.push('谐音与音韵检查均通过');
      }
      hy.innerHTML = parts.join('　');
      body.appendChild(hy);
    }

    /* 逐字信息 */
    var charsNote = el('p', 'more-note');
    charsNote.innerHTML = item.chars.map(function (c, i) {
      var info = NS.CHAR_DB[c];
      if (!info) return esc(c);
      return '<b>' + esc(c) + '</b>（' + esc(info.wuxing) + '·' +
        esc(NS.Pinyin.toneMark(info.pinyin, info.tone)) + '·' +
        info.strokes + '画·' + esc(info.styles.join('/')) + '）';
    }).join('　');
    body.appendChild(charsNote);

    /* 方言读音（若已开启） */
    if (item.sichuan) {
      var scNote = el('p', 'more-note');
      if (item.sichuan.available && item.sichuan.syllables) {
        scNote.innerHTML = '<b>四川话读音</b>　' +
          esc(item.sichuan.pinyin) + '　' +
          esc(NS.SICHUAN_MERGE_NOTES.join('；'));
      } else {
        scNote.innerHTML = '<b>四川话读音</b>　' +
          esc(item.sichuan.reason || '暂不可用');
      }
      body.appendChild(scNote);
    }

    /* 小名的谐音检查明细（逐个候选列出，便于对照挑选） */
    var nnAll = item.nicknames || (item.nickname ? [item.nickname] : []);
    if (nnAll.length) {
      var nnNote = el('p', 'more-note');
      nnNote.innerHTML = '<b>小名谐音检查</b>　' + nnAll.map(function (n) {
        var h = n.homophone || {};
        var sc = (n.sichuan && n.sichuan.hits && n.sichuan.hits.length)
          ? '，四川话近似「' + esc(n.sichuan.hits[0].word) + '」' : '';
        return esc(n.name) + '（' + esc(h.pinyin || n.pinyin) + '　' +
          (h.pass ? '无谐音' : '<span class="warn">有谐音风险</span>') + sc + '）';
      }).join('　·　');
      body.appendChild(nnNote);
    }

    /* 同音替换明细 */
    if (variants.length) {
      var vnote = el('p', 'more-note');
      vnote.innerHTML = '<b>同音替换</b>　' + variants.map(function (g) {
        return esc(g.from) + '（热度' + (g.fromHeat ? g.fromHeat.value : '?') +
          '）→ ' + g.options.map(function (o) {
            return esc(o.char) + (o.approx ? '<sup>*</sup>' : '') +
              '（' + esc(o.wuxing) + '·' + o.strokes + '画·热度' +
              (o.heat ? o.heat.value : '?') + '·换成后 ' + o.score + ' 分' +
              (o.delta === 0 ? ''
                : '，' + (o.delta > 0 ? '+' : '') + o.delta) + '）';
          }).join('、');
      }).join('　｜　') +
      (variants.some(function (g) { return g.hasApprox; })
        ? '<br><sup>*</sup> 词库外的字：读音来自联网拼音表，' +
        '五行与康熙笔画按部首推断，<b>请人工核对后再用</b>。要把它真正加进字库，' +
        '可在「词库管理」里查字入库并修正。'
        : '');
      body.appendChild(vnote);
    }

    more.appendChild(body);
    card.appendChild(more);

    return card;
  }

  function renderResults(results, stats, plan, opts) {
    var root = $('results');
    root.innerHTML = '';

    var stack = el('div', 'stack');

    /* 八字面板 */
    stack.appendChild(renderBazi(opts._baziInfo, opts));

    /* 工具条 */
    var bar = el('div', 'result-bar');
    var meta = el('div', 'meta');
    meta.innerHTML = '候选池 ' + stats.poolSize + ' 字 · 枚举 ' +
      stats.scanned.toLocaleString() + ' 组 · 命中 ' + stats.kept +
      ' 个 · 耗时 ' + stats.elapsed.toFixed(0) + ' ms';
    bar.appendChild(meta);

    var actions = el('div', 'actions');

    /* 简洁模式开关。默认打开 —— 一屏能看好几个名字，
     * 看中哪个再展开它的详情，比一上来就铺满长卡片好翻。
     * 选择会记进填写记录，下次打开保持。 */
    var densRow = el('label', 'check dens-toggle');
    densRow.title = '折叠字义、小名、出处与五格，一屏显示更多名字';
    var densCb = document.createElement('input');
    densCb.type = 'checkbox';
    densCb.checked = !!state.compact;
    densCb.addEventListener('change', function () {
      state.compact = densCb.checked;
      renderPage();
      savePrefsNow();
    });
    densRow.appendChild(densCb);
    densRow.appendChild(el('span', null, '简洁模式'));
    actions.appendChild(densRow);

    var copyBtn = el('button', 'btn ghost', '复制这一批');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      copyText(buildText(state.ranking.slice(
        state.page * state.lastOpts.top,
        (state.page + 1) * state.lastOpts.top), opts), copyBtn);
    });
    actions.appendChild(copyBtn);

    var printBtn = el('button', 'btn ghost', '打印 / 存为 PDF');
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () { global.print(); });
    actions.appendChild(printBtn);

    bar.appendChild(actions);
    stack.appendChild(bar);

    /* 分页条：候选已经过一次多样性排序，往后翻依然是不雷同的名字 */
    stack.appendChild(buildPager(true));

    /* 关键词筛选：五行/音韵的权重高于寓意，所以命中关键词的字未必能排进前列。
     * 与其悄悄埋没关键词，不如给用户一个「只看命中关键词」的开关。 */
    if (opts.keywords && opts.keywords.length) {
      var kwChars = plan.pool.filter(function (r) { return r.kwHits.length; }).length;
      var row = el('label', 'check');
      row.style.margin = '0 0 2px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () {
        state.onlyKw = cb.checked;
        renderPage();
      });
      row.appendChild(cb);
      row.appendChild(el('span', null,
        '只显示含关键词「' + opts.keywords.join('、') + '」的结果' +
        '（候选池里有 ' + kwChars + ' 个字命中）'));
      stack.appendChild(row);
    }

    /* 对比条（吸顶） */
    var cmpBar = el('div', 'compare-bar');
    cmpBar.id = 'compareBar';
    cmpBar.hidden = true;
    stack.appendChild(cmpBar);

    var list = el('div', 'stack');
    list.id = 'resultList';
    stack.appendChild(list);

    /* 底部再来一条：名字一路看完想换下一批时，不必再翻回页面顶部 */
    stack.appendChild(buildPager(false));

    var cmpBox = el('div', 'compare-box');
    cmpBox.id = 'compareBox';
    stack.appendChild(cmpBox);

    root.appendChild(stack);
    renderPage();
  }

  /**
   * 分页条。上、下各一条。
   *
   * 用 class 而不是 id：一个文档里 id 只能有一个，
   * 而 updatePageBar 要同时更新两条（按钮文案、当前位置、禁用状态）。
   *
   * @param {boolean} withNote 是否附上「候选共 N 个…」那行长说明。
   *                           只在顶部显示一次，底部那条要短。
   */
  function buildPager(withNote) {
    var pager = el('div', 'pager ' + (withNote ? 'pager-top' : 'pager-bottom'));

    if (withNote) pager.appendChild(el('span', 'pager-note', ''));

    var btns = el('div', 'pager-btns');

    var prev = el('button', 'btn ghost pager-prev', '上一批');
    prev.type = 'button';
    prev.addEventListener('click', function () { turnPage(-1); });

    var pos = el('span', 'pager-pos', '');

    var next = el('button', 'btn ghost pager-next', '换一批');
    next.type = 'button';
    next.addEventListener('click', function () { turnPage(1); });

    btns.appendChild(prev);
    btns.appendChild(pos);
    btns.appendChild(next);
    pager.appendChild(btns);
    return pager;
  }

  /* ---------------- 分页 ---------------- */

  /**
   * 小名与四川话只在真要显示时才算，且每个名字只算一次。
   *
   * 不能只在生成结束时给第一批算——那样「换一批」出来的名字没有小名，
   * 对比表里也会全是「—」。分页后按需补齐，每批十来个，开销很小。
   */
  function ensureExtras(items) {
    var todo = items.filter(function (it) {
      return it && it.__extras !== true;
    });
    if (!todo.length) return;
    todo.forEach(function (it) { it.__extras = true; });

    var opts = state.lastOpts || {};
    NS.Nickname.attach(todo, {
      surname: opts.surname,
      surnameSyllables: opts.surnameSyllables,
      sichuan: sichuanEnabled()
    });
    if (sichuanEnabled()) attachSichuan(todo);
  }

  /** 当前一批的名字（应用关键词过滤后） */
  function pageItems() {
    var size = state.lastOpts.top;
    var from = state.page * size;
    var items = state.ranking.slice(from, from + size);
    if (state.onlyKw) {
      items = items.filter(function (r) {
        return r.reasons.some(function (x) { return x.indexOf('含关键词') >= 0; });
      });
    }
    return items;
  }

  function renderPage() {
    var list = $('resultList');
    if (!list) return;
    var items = pageItems();
    ensureExtras(items);
    list.innerHTML = '';

    if (!items.length) {
      var none = el('div', 'panel');
      none.style.padding = '20px';
      none.appendChild(el('div', 'alert', state.onlyKw
        ? '当前这一批里没有命中关键词的名字，点「换一批」继续往后找。'
        : '没有找到同时满足条件的结果。可以试试：放宽性别/风格、去掉必含字、或换用字数。'));
      list.appendChild(none);
    } else {
      items.forEach(function (item) {
        list.appendChild(renderNameCard(item, state.ranking.indexOf(item) + 1));
      });
    }
    updatePageBar();
    updateCompareBar();
  }

  function updatePageBar() {
    var size = state.lastOpts.top;
    var total = state.ranking.length;
    var pages = Math.max(1, Math.ceil(total / size));
    var from = state.page * size;
    var atStart = state.page <= 0;
    var atEnd = state.page >= pages - 1;

    var posText = '第 ' + (state.page + 1) + ' / ' + pages + ' 批';
    each('.pager-pos', function (n) { n.textContent = posText; });
    each('.pager-prev', function (b) { b.disabled = atStart; });
    /* 末页不让「换一批」变成死按钮 —— 用户会以为坏了。
     * 改成「回到第一批」，点了从头再挑，正好是那一刻想干的事。 */
    each('.pager-next', function (b) {
      b.disabled = false;
      b.textContent = atEnd ? '回到第一批' : '换一批';
    });

    var note = document.querySelector('.pager-note');
    if (note) {
      note.innerHTML = '候选共 <b>' + total + '</b> 个，当前显示第 ' +
        (from + 1) + '–' + Math.min(total, from + size) +
        ' 名。<span class="pager-why">已按「同位不重字」排列，' +
        '同一批里没有重字的名字。</span>';
    }
  }

  /** 对所有匹配元素执行 fn（分页条有上、下两条，不能再用 id 取） */
  function each(sel, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(sel), fn);
  }

  function turnPage(delta) {
    var size = state.lastOpts.top;
    var pages = Math.max(1, Math.ceil(state.ranking.length / size));
    var t = state.page + delta;
    /* 末页再点「换一批」= 回到第一批（与按钮文案一致），不然是空操作 */
    if (t >= pages) t = 0;
    if (t < 0) t = 0;
    state.page = t;
    renderPage();
    /* 滚到列表开头，而不是整个 #results 顶部 ——
     * 后者会把八字面板和工具条也推上来，新一批的名字反而在屏幕外。
     *
     * 用 behavior:'auto'（瞬时）而不是 'smooth'：平滑滚动靠动画帧推进，
     * 页面在后台标签页时根本不跑，表现就是「点了没反应」——
     * 实测在同一页面上 'auto' 立刻到位、'smooth' 纹丝不动。
     * 何况「换一批」本来就是想看新内容，瞬时更跟手。 */
    var anchor = $('resultList') || $('results');
    if (anchor && anchor.scrollIntoView) {
      anchor.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }

  /* ---------------- 并排对比 ---------------- */

  /** 按名字取回结果对象（对比可以跨批次） */
  function pickedItems() {
    return state.picked.map(function (name) {
      for (var i = 0; i < state.ranking.length; i++) {
        if (state.ranking[i].name === name) return state.ranking[i];
      }
      return null;
    }).filter(Boolean);
  }

  function updateCompareBar() {
    var bar = $('compareBar');
    if (!bar) return;
    bar.innerHTML = '';
    var n = state.picked.length;
    bar.hidden = n === 0;
    if (!n) return;

    bar.appendChild(el('span', 'cb-note', '已选 ' + n + ' 个名字'));

    var go = el('button', 'btn', '并排对比');
    go.type = 'button';
    go.disabled = n < 2;
    go.title = n < 2 ? '至少选两个才能对比' : '';
    go.addEventListener('click', function () { renderCompare(); });
    bar.appendChild(go);

    var clr = el('button', 'btn ghost', '清空');
    clr.type = 'button';
    clr.addEventListener('click', function () {
      state.picked = [];
      var box = $('compareBox');
      if (box) box.innerHTML = '';
      renderPage();
    });
    bar.appendChild(clr);
  }

  function renderCompare() {
    var box = $('compareBox');
    if (!box) return;
    var items = pickedItems();
    if (items.length < 2) return;
    ensureExtras(items);
    box.innerHTML = '';

    var panel = el('div', 'panel compare-panel');
    var title = el('div', 'section-title');
    title.appendChild(el('span', null, '并排对比（' + items.length + ' 个）'));
    var close = el('button', 'btn ghost', '关闭');
    close.type = 'button';
    close.addEventListener('click', function () { box.innerHTML = ''; });
    title.appendChild(close);
    panel.appendChild(title);

    var table = el('table', 'compare-table');

    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', 'cmp-key', '对比项'));
    items.forEach(function (it) {
      var th = document.createElement('th');
      th.innerHTML = '<b>' + esc(it.name) + '</b><span class="cmp-py">' +
        esc(it.pinyin) + '</span>';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var rows = [
      ['总分', function (it) {
        return '<b style="color:' + scoreColor(it.score) + ';font-size:15px">' +
          it.score + '</b>';
      }],
      ['五行', function (it) { return it.wuxing.join(' · '); }],
      ['三才', function (it) {
        return it.wuge ? it.wuge.三才 + '（' + it.wuge.三才吉凶 + '）' : '—';
      }],
      ['五格', function (it) {
        if (!it.wuge) return '—';
        return '天' + it.wuge.天格 + ' 人' + it.wuge.人格 +
          ' 地' + it.wuge.地格 + ' 总' + it.wuge.总格;
      }],
      ['笔画', function (it) { return it.strokes.join(' + '); }],
      ['重名热度', function (it) {
        return it.heat ? it.heat.value + '（' + it.heat.text + '）' : '—';
      }],
      ['谐音', function (it) {
        return (it.homophone && it.homophone.pass)
          ? '通过' : '<span style="color:#a63a2e">有风险</span>';
      }],
      ['偏旁', function (it) {
        var r = NS.Radical.check(it.chars);
        if (!r.dupes.length) return '无重复';
        return '<span style="color:#a9782c">' +
          esc(r.dupes.map(function (d) { return d.name; }).join('')) +
          ' 重复</span>';
      }],
      ['诗词出处', function (it) {
        return it.poetry ? '《' + esc(it.poetry.source) + '》' : '—';
      }],
      ['小名', function (it) {
        var l = it.nicknames || (it.nickname ? [it.nickname] : []);
        return l.length ? l.map(function (n) { return esc(n.name); }).join('、') : '—';
      }],
      ['字义', function (it) { return esc(it.meaning); }]
    ];

    var tbody = el('tbody');
    rows.forEach(function (spec) {
      var tr = el('tr');
      tr.appendChild(el('th', 'cmp-key', spec[0]));
      items.forEach(function (it) {
        var td = document.createElement('td');
        td.innerHTML = spec[1](it);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);

    var best = items.slice().sort(function (a, b) { return b.score - a.score; })[0];
    var note = el('p', 'more-note');
    note.innerHTML = '这一组里总分最高的是 <b>' + esc(best.name) + '</b>（' +
      best.score + ' 分）。分数只是参考——三才五格属数理派，与八字喜用神体系不同，' +
      '最终以读音顺口、家人喜欢为准。';
    panel.appendChild(note);

    box.appendChild(panel);
  }

  /* ---------------- 导出文本 ---------------- */

  function buildText(results, opts) {
    var lines = [];
    lines.push('【取名结果】姓氏：' + opts.surname +
      '　性别：' + opts.gender +
      (opts.style ? '　风格：' + opts.style : '') +
      '　喜用神：' + (opts.xiyongshen.join('、') || '未指定'));
    if (opts._baziInfo) {
      lines.push('八字：' + opts._baziInfo.baziStr +
        '　日主：' + opts._baziInfo.dayGan + opts._baziInfo.dayWx +
        '　' + opts._baziInfo.strength +
        '　喜用神：' + opts._baziInfo.xiyongshen.join('、'));
    }
    lines.push('');
    results.forEach(function (r, i) {
      lines.push((i + 1) + '. ' + r.name + '　' + r.pinyin +
        '　' + r.score + ' 分');
      lines.push('   五行：' + r.wuxing.join('、') +
        '　笔画：' + r.strokes.join('+') +
        (r.wuge ? '　三才：' + r.wuge.三才 + '(' + r.wuge.三才吉凶 + ')' : '') +
        (r.heat ? '　重名热度：' + r.heat.value + '（' + r.heat.text + '）' : ''));
      lines.push('   理由：' + r.reasons.join('、'));
      lines.push('   字义：' + r.meaning);
      var nnOut = r.nicknames || (r.nickname ? [r.nickname] : []);
      if (nnOut.length) {
        lines.push('   小名：' + nnOut.map(function (n) {
          return n.name + '（' + n.pinyin + '·' + n.patternLabel + '）' +
            (n.risky ? '［有谐音风险］' : '');
        }).join('，'));
      }
      if (r.sichuan && r.sichuan.pinyin) {
        lines.push('   四川话读音：' + r.sichuan.pinyin +
          (r.sichuan.hits.length
            ? '　⚠ ' + r.sichuan.hits.map(function (x) {
              return x.desc;
            }).join('；')
            : '　无负面谐音'));
      }
      if (r.poetry) {
        lines.push('   出处：《' + r.poetry.source + '》·' + r.poetry.title +
          '「' + r.poetry.line + '」');
      }
      lines.push('');
    });
    lines.push('—— 由本地取名系统生成，五行/数理/热度均为参考，请结合家庭意愿取用。');
    return lines.join('\n');
  }

  function copyText(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    initSelects();
    initFuzzySelects();
    initSegmented('genderSeg', 'gender');
    initSegmented('lenSeg', 'length');
    initViewSwitch();
    initRadicalPicker();

    /* 词库管理面板：初始化后会自动恢复上次同步的数据 */
    if (NS.SyncUI && $('viewLexicon')) {
      NS.SyncUI.init($('viewLexicon'));
      NS.Lexicon.restore().then(function (st) {
        refreshLexDot(st);
      }).catch(function () { /* 忽略：无持久化环境 */ });
    }

    /* 候选池与评估：**延迟构建**。
     * 它们的表单要读「取名」页的生辰，而用户可能还没填；
     * 而且启动时构建它们没有意义（用户还没切过去）。
     * 所以只在第一次切进去时 init 一次（见 switchView）。 */
    if (NS.PoolUI && $('viewPool')) NS.PoolUI.init($('viewPool'));
    if (NS.EvalUI && $('viewEval')) NS.EvalUI.init($('viewEval'));
    /* init 只建骨架，先藏起来 —— 否则四个视图会同时出现在页面上 */
    if ($('viewPool')) $('viewPool').hidden = true;
    if ($('viewEval')) $('viewEval').hidden = true;
    /* 候选池里有东西就点个小圆点，提示用户「你之前存过备选」 */
    setTimeout(refreshPoolDot, 0);

    $('surname').addEventListener('input', function () {
      updateSurname();
      updateBaziHint();
    });
    if ($('city')) {
      $('city').addEventListener('change', function () { updateCity(true); });
      $('city').addEventListener('input', function () { updateCity(false); });
    }
    if ($('useSC')) {
      $('useSC').addEventListener('change', function () {
        var cb = $('useSC');
        if (cb.checked && !NS.Dialect.available()) {
          $('cityHint').innerHTML =
            '<span style="color:#a9782c">四川话检测需要先在「词库管理」里' +
            '同步「蜀拼字表」，否则无法生效。</span>';
        } else {
          updateCity(false);
        }
      });
    }
    $('birth').addEventListener('change', updateBaziHint);
    $('birth').addEventListener('input', updateBaziHint);
    /* 三档模糊的勾选框。syncBirthMode 会自己把包含关系理清，
     * 所以三个用同一个处理函数就够，不必各写一套。 */
    ['birthNoMonth', 'birthNoDay', 'birthNoHour'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', syncBirthMode);
    });
    /* 年·月下拉改动 → 重写 #birth（下游提示与填写记录靠它带动） */
    ['fuzzyYear', 'fuzzyMonth'].forEach(function (id) {
      if (!$(id)) return;
      $(id).addEventListener('change', function () {
        writeFuzzyBirth();
        NS.Prefs.saveSoon(collectPrefs);
      });
    });
    /* 手工改笔画 → 刷新「取自动值 / 已手动改为」那句提示 */
    if ($('strokes')) $('strokes').addEventListener('input', updateSurname);
    /* 农历录入助手。它不直接算八字 —— 选完只把公历值写回 #birth，
     * 下游照旧走上面那两个监听器，所以这里只需负责存一次填写记录。 */
    if (NS.LunarInput) {
      NS.LunarInput.install({
        onChange: function () {
          /* 切换公历/农历会改变模糊区与 #birth 的可见性，
           * 必须重跑一次 syncBirthMode，否则切回公历后
           * 那两个下拉会停在农历模式留下的隐藏状态里 */
          syncBirthMode();
          NS.Prefs.saveSoon(collectPrefs);
        }
      });
    }
    $('longitude').addEventListener('input', updateBaziHint);
    $('useTST').addEventListener('change', updateBaziHint);
    $('form').addEventListener('submit', onSubmit);

    /* 任何表单改动都**防抖**存一次。
     * 不防抖会把存储写爆：每次按键都开一个 IndexedDB 写事务会排队堆积。 */
    ['input', 'change'].forEach(function (evt) {
      $('form').addEventListener(evt, function () {
        NS.Prefs.saveSoon(collectPrefs);
      });
    });
    /* 分段控件与部首 chip 不是原生控件，不会冒泡 input/change，单独挂 */
    ['genderSeg', 'lenSeg', 'xiSeg', 'radSeg'].forEach(function (id) {
      var e2 = $(id);
      if (e2) e2.addEventListener('click', function () {
        NS.Prefs.saveSoon(collectPrefs);
      });
    });
    /* 关页面/切后台时立即落盘，避免最后一次输入还在防抖窗口里就丢了 */
    global.addEventListener('pagehide', savePrefsNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') savePrefsNow();
    });

    updateSurname();
    updateBaziHint();

    /* 先恢复填写记录，**再**处理 URL 参数 ——
     * URL 是用户这次明确指定的，优先级必须高于上次的记录。 */
    NS.Prefs.load().then(function (p) {
      var restored = applyPrefs(p);
      updateSurname();
      /* 恢复完记录要让「时辰未知」模式跟上 ——
       * 勾选状态恢复回来后，真太阳时需要相应禁用。 */
      syncBirthMode();
      updateBaziHint();
      renderPrefHint(restored, p && p.savedAt);
      applyUrlParams();
    }).catch(function () {
      renderPrefHint(false);
      applyUrlParams();
    });
  }

  /* URL 参数支持：?surname=李&gender=女&birth=2024-05-20T10:00&style=古风
   * 单独抽出来，是因为它必须在「恢复填写记录」之后执行才有意义。 */
  function applyUrlParams() {
    try {
      var q = new URLSearchParams(global.location.search);
      if (q.get('surname')) $('surname').value = q.get('surname');
      if (q.get('birth')) $('birth').value = q.get('birth');
      /* 链接里的生辰是公历，农历面板要跟着反推一次 */
      if (NS.LunarInput) NS.LunarInput.syncFromBirth();
      if (q.get('gender')) {
        Array.prototype.forEach.call(
          $('genderSeg').querySelectorAll('button'), function (b) {
            b.setAttribute('aria-pressed', b.dataset.v === q.get('gender')
              ? 'true' : 'false');
          });
        state.gender = q.get('gender');
      }
      if (q.get('style')) $('style').value = q.get('style');
      updateSurname();
      updateBaziHint();
      if (q.get('auto') === '1') {
        setTimeout(function () { $('form').dispatchEvent(new Event('submit')); }, 60);
      }
    } catch (e) { /* 忽略 */ }

    /* 脚注里的字库规模改成运行时填。
     * 原来写死了「412 字」，结果每次加字都要手工改两处，漏改就变成假信息
     * —— 和之前偏旁表漏收「梓」是同一类问题：**数据会变，文案不该硬编码**。 */
    try {
      var total = (NS.CHAR_LIB_STATS && NS.CHAR_LIB_STATS.total)
        || Object.keys(NS.CHAR_DB).length;
      Array.prototype.forEach.call(
        document.querySelectorAll('.lib-count'), function (el) {
          el.textContent = String(total);
        });
    } catch (e2) { /* 忽略 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
