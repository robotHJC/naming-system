/* =========================================================================
 * sync-ui.js —— 词库管理面板
 *
 * 包含四块：
 *   1. 状态总览（已扩充多少字、多少首诗、数据存在哪里）
 *   2. 数据源勾选 + 联网更新（带进度与日志）
 *   3. 单字联网查询 → 校正 → 加入字库
 *   4. 导出 / 导入 / 清空 联网数据
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = global.NS;

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
  function fmtSize(n) { return NS.formatSize(n); }
  function fmtTime(iso) {
    if (!iso) return '从未';
    try {
      var d = new Date(iso);
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return iso; }
  }

  var SyncUI = {
    root: null,
    busy: false,

    init: function (container) {
      this.root = container;
      this.render();
      /* 恢复上次同步的数据 */
      NS.Lexicon.restore().then(function () {
        SyncUI.refreshStatus();
      }).catch(function (e) {
        console.warn('[sync] 恢复数据失败：', e && e.message);
      });
    },

    refreshStatus: function () {
      var st = NS.Lexicon.status();
      var box = $('lexStatus');
      if (!box) return;

      var backendText = {
        idb: 'IndexedDB（可保存大文件）',
        ls: 'localStorage（约 5MB 上限，字典可能存不下）',
        memory: '内存（刷新后会丢失，建议导出数据文件）',
        none: '未就绪'
      }[st.backend] || st.backend;

      box.innerHTML =
        '<div class="lex-stat"><b>' + st.customChars + '</b><span>联网加入的字</span></div>' +
        '<div class="lex-stat"><b>' + st.poems + '</b><span>可用诗篇' +
        '（内置 ' + st.builtinPoems + '）</span></div>' +
        '<div class="lex-stat"><b>' + st.pinyinCount + '</b><span>拼音表收录字</span></div>' +
        '<div class="lex-stat"><b>' + st.dictCount + '</b><span>字典收录字</span></div>' +
        '<div class="lex-stat"><b>' + st.fantiCount + '</b><span>联网繁简对照</span></div>' +
        '<div class="lex-stat"><b>' + (st.shupinCount || 0) + '</b>' +
        '<span>蜀拼（四川话）字</span></div>';
      box.className = 'lex-status';

      var line = $('lexStorage');
      if (line) {
        line.innerHTML = '数据存放：<b>' + esc(backendText) + '</b>　' +
          '上次更新：<b>' + esc(fmtTime(st.lastSync)) + '</b>';
        if (st.backend === 'memory') {
          line.innerHTML += '　<span style="color:#a63a2e">' +
            '当前环境无法持久化，请用「导出数据文件」保存成果。</span>';
        }
      }
      this.renderCustomChars();
      /* 通知主界面更新「词库管理」按钮上的小圆点 */
      if (NS.refreshLexDot) NS.refreshLexDot(st);
    },

    /* ---------------- 主面板 ---------------- */

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      var head = el('div', 'section-title', '联网更新词库');
      root.appendChild(head);

      var intro = el('p', 'hint');
      intro.innerHTML = '从公开数据源拉取字词数据，缓存到浏览器本地，之后离线也能用。' +
        '数据源均返回 <code>Access-Control-Allow-Origin: *</code>，因此纯前端可直接访问，无需后端。' +
        '四川话读音数据来自第三方个人项目、未声明授权，默认不勾选，也不会被打进安装包。';
      root.appendChild(intro);

      /* 状态 */
      var status = el('div', 'lex-status');
      status.id = 'lexStatus';
      root.appendChild(status);
      var storage = el('p', 'more-note');
      storage.id = 'lexStorage';
      root.appendChild(storage);

      /* 数据源 */
      var srcTitle = el('div', 'lex-sub', '选择要下载的数据源');
      root.appendChild(srcTitle);

      ['core', 'poetry', 'dialect', 'dict'].forEach(function (g) {
        var items = NS.SOURCES.filter(function (s) { return s.group === g; });
        if (!items.length) return;

        var group = el('div', 'lex-group');
        var gh = el('div', 'lex-group-head');
        var totalSize = items.reduce(function (a, s) { return a + (s.size || 0); }, 0);
        gh.innerHTML = '<span>' + esc(NS.GROUP_NAMES[g]) + '</span>' +
          '<span class="lex-group-size">共 ' + fmtSize(totalSize) + '</span>';
        group.appendChild(gh);

        items.forEach(function (s) {
          var row = el('label', 'lex-src');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = s.id;
          cb.checked = !!s.defaultOn;
          cb.dataset.group = s.group;
          row.appendChild(cb);

          var body = el('div', 'lex-src-body');
          var nameRow = el('div', 'lex-src-name');
          nameRow.innerHTML = esc(s.name) +
            ' <span class="lex-size">' + fmtSize(s.size) + '</span>' +
            (s.big ? ' <span class="tag red">较大</span>' : '') +
            (s.licenseNote ? ' <span class="tag gold">授权待确认</span>' : '');
          body.appendChild(nameRow);
          body.appendChild(el('div', 'lex-src-desc', s.desc));
          if (s.licenseNote) {
            body.appendChild(el('div', 'lex-src-desc',
              '⚠ ' + s.licenseNote + '；如要对外分发请先自行确认授权。'));
          }
          row.appendChild(body);
          group.appendChild(row);
        });
        root.appendChild(group);
      });

      var quick = el('div', 'lex-quick');
      var bLight = el('button', 'btn ghost', '只选轻量（诗词+拼音）');
      bLight.type = 'button';
      bLight.addEventListener('click', function () { pick(false); });
      var bAll = el('button', 'btn ghost', '全选');
      bAll.type = 'button';
      bAll.addEventListener('click', function () { pick(true); });
      quick.appendChild(bLight);
      quick.appendChild(bAll);
      root.appendChild(quick);

      /* 更新按钮 + 进度 */
      var go = el('button', 'btn', '开 始 联 网 更 新');
      go.type = 'button';
      go.id = 'lexGo';
      go.style.marginTop = '12px';
      go.addEventListener('click', function () { SyncUI.startSync(); });
      root.appendChild(go);

      var prog = el('div', 'lex-progress');
      prog.id = 'lexProgress';
      prog.style.display = 'none';
      var bar = el('div', 'progress-bar');
      var fill = el('div', 'fill');
      fill.id = 'lexFill';
      bar.appendChild(fill);
      prog.appendChild(bar);
      var ptxt = el('div', 'progress-text');
      ptxt.appendChild(el('span', null, ''));
      var pct = el('span', null, '0%');
      pct.id = 'lexPct';
      ptxt.appendChild(pct);
      prog.appendChild(ptxt);
      prog.lastElementChild.firstChild.id = 'lexProgLabel';
      root.appendChild(prog);

      var log = el('div', 'lex-log');
      log.id = 'lexLog';
      root.appendChild(log);

      /* 单字查询 */
      root.appendChild(el('div', 'lex-sub', '单字联网查询 → 加入字库'));

      var hint = el('p', 'hint');
      hint.innerHTML = '字库里没有的字，可以联网查它的拼音、部首、笔画与释义，' +
        '确认后加入字库参与取名。<b>注意：康熙笔画与五行是按部首推断的，' +
        '没有权威公开数据源，务必人工核对。</b>';
      root.appendChild(hint);

      var row = el('div', 'lex-lookup');
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'lexChar';
      input.maxLength = 1;
      input.placeholder = '输入一个字';
      row.appendChild(input);
      var btn = el('button', 'btn ghost', '查询');
      btn.type = 'button';
      btn.addEventListener('click', function () { SyncUI.lookup(); });
      row.appendChild(btn);
      root.appendChild(row);

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); SyncUI.lookup(); }
      });

      var result = el('div', 'lex-result');
      result.id = 'lexResult';
      root.appendChild(result);

      /* 已加入的字 */
      root.appendChild(el('div', 'lex-sub', '已加入字库的字'));
      var custom = el('div', 'lex-custom');
      custom.id = 'lexCustom';
      root.appendChild(custom);

      /* 导入导出 */
      root.appendChild(el('div', 'lex-sub', '数据备份'));
      var io = el('div', 'lex-io');

      var bExport = el('button', 'btn ghost', '导出数据文件');
      bExport.type = 'button';
      bExport.title = '导出为 JSON，可用于打包固化或迁移到其他电脑';
      bExport.addEventListener('click', function () { SyncUI.exportData(); });
      io.appendChild(bExport);

      var bImport = el('button', 'btn ghost', '导入数据文件');
      bImport.type = 'button';
      bImport.addEventListener('click', function () {
        var f = document.createElement('input');
        f.type = 'file';
        f.accept = '.json,application/json';
        f.addEventListener('change', function () {
          if (!f.files || !f.files[0]) return;
          SyncUI.importData(f.files[0]);
        });
        f.click();
      });
      io.appendChild(bImport);

      var bReset = el('button', 'btn ghost', '清空联网数据');
      bReset.type = 'button';
      bReset.style.color = '#a63a2e';
      bReset.addEventListener('click', function () {
        if (!global.confirm('确定清空所有联网数据吗？\n' +
          '（会删除联网加入的字与诗篇，内置字库不受影响）')) return;
        NS.Lexicon.reset().then(function () {
          SyncUI.refreshStatus();
          SyncUI.log('已清空联网数据，回到内置字库状态。', 'warn');
        });
      });
      io.appendChild(bReset);
      root.appendChild(io);
    },

    /* ---------------- 同步 ---------------- */

    startSync: function () {
      if (this.busy) return;
      var ids = this.selectedIds();
      if (!ids.length) {
        this.log('请先勾选至少一个数据源。', 'warn');
        return;
      }

      var totalSize = ids.reduce(function (a, id) {
        return a + (NS.SOURCE_BY_ID[id].size || 0);
      }, 0);
      if (totalSize > 5 * 1024 * 1024 &&
        !global.confirm('本次需要下载约 ' + fmtSize(totalSize) +
          '，字典较大可能耗时 1-2 分钟，确定继续？')) {
        return;
      }

      this.busy = true;
      $('lexGo').disabled = true;
      $('lexProgress').style.display = 'block';
      $('lexLog').innerHTML = '';
      this.log('开始更新，共 ' + ids.length + ' 个源，约 ' + fmtSize(totalSize) + '。');

      var self = this;
      NS.Lexicon.sync(ids, {
        onSourceStart: function (src) {
          self.log('↓ 正在下载「' + src.name + '」（' + fmtSize(src.size) + '）…');
          self.progress(0, '下载 ' + src.name);
        },
        onProgress: function (src, rec, total, pct) {
          self.progress(pct, '下载 ' + src.name);
        },
        onSourceDone: function (src, res, ms) {
          self.log('✓ 「' + src.name + '」新增 ' + res.added + ' 条，' +
            (ms / 1000).toFixed(1) + 's', 'ok');
        },
        onSourceError: function (src, err) {
          self.log('✗ 「' + src.name + '」失败：' + err.message, 'err');
        }
      }).then(function (report) {
        self.busy = false;
        $('lexGo').disabled = false;
        $('lexProgress').style.display = 'none';
        self.refreshStatus();

        var okN = report.success.length, failN = report.failed.length;
        self.log('更新完成：成功 ' + okN + ' 个，失败 ' + failN + ' 个。',
          failN ? 'warn' : 'ok');
        if (okN) {
          self.log('字库与诗词库已更新，回到「取名」页重新生成即可看到效果。', 'ok');
        }
        if (failN) {
          self.log('失败的源通常是网络不通或镜像不可达，可以稍后重试；' +
            '已成功的数据不会丢失。', 'warn');
        }
      }).catch(function (e) {
        self.busy = false;
        $('lexGo').disabled = false;
        $('lexProgress').style.display = 'none';
        self.log('更新中断：' + e.message, 'err');
      });
    },

    selectedIds: function () {
      return Array.prototype.map.call(
        this.root.querySelectorAll('.lex-src input:checked'),
        function (cb) { return cb.value; }
      );
    },

    progress: function (pct, label) {
      var f = $('lexFill'), t = $('lexPct'), l = $('lexProgLabel');
      if (f) f.style.width = pct.toFixed(1) + '%';
      if (t) t.textContent = pct.toFixed(0) + '%';
      if (l && label) l.textContent = label;
    },

    log: function (text, kind) {
      var box = $('lexLog');
      if (!box) return;
      var line = el('div', 'lex-log-line' + (kind ? ' ' + kind : ''), text);
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    },

    /* ---------------- 单字查询 ---------------- */

    lookup: function () {
      var input = $('lexChar');
      var ch = (input.value || '').trim();
      var box = $('lexResult');
      box.innerHTML = '';

      if (!ch) { box.appendChild(el('div', 'alert', '请输入一个字。')); return; }
      if (!/^[\u4e00-\u9fff]$/.test(ch)) {
        box.appendChild(el('div', 'alert', '请输入单个汉字（不含字母、数字、标点）。'));
        return;
      }

      var st = NS.Lexicon.status();
      if (!st.pinyinCount && !st.dictCount) {
        box.appendChild(el('div', 'alert',
          '还没有联网数据。请先在上方勾选「汉字拼音表」或「新华字典」并更新，再查询。'));
        return;
      }

      var r = NS.Lexicon.lookupChar(ch);

      if (NS.CHAR_DB[ch]) {
        box.appendChild(el('div', 'alert',
          '「' + ch + '」已经在字库里了（' + NS.CHAR_DB[ch].wuxing + '·' +
          NS.CHAR_DB[ch].strokes + '画）。如需修改，请直接编辑 js/data/chars.js。'));
        return;
      }

      if (r.missing) {
        box.appendChild(el('div', 'alert',
          '已联网的数据里没有查到「' + ch + '」。' +
          '若只同步了诗词库，请再同步「汉字拼音表」或「新华字典」。'));
        return;
      }

      this.renderLookupResult(r);
    },

    renderLookupResult: function (r) {
      var box = $('lexResult');
      box.innerHTML = '';

      var inf = r.__inferred || {};
      var card = el('div', 'lex-card');

      var head = el('div', 'lex-card-head');
      head.innerHTML = '<span class="lex-big">' + esc(r.char) + '</span>' +
        '<span class="lex-srcs">数据来自：' + esc((r.sources || []).join(' + ')) + '</span>';
      card.appendChild(head);

      /* 可编辑字段 */
      var fields = el('div', 'lex-fields');

      function field(label, id, value, note) {
        var w = el('div', 'lex-field');
        var l = el('label', null, label);
        l.setAttribute('for', id);
        w.appendChild(l);
        var i = document.createElement('input');
        i.type = 'text';
        i.id = id;
        i.value = value === undefined || value === null ? '' : value;
        w.appendChild(i);
        if (note) w.appendChild(el('div', 'lex-field-note', note));
        fields.appendChild(w);
        return i;
      }

      field('拼音（不带调）', 'lexPinyin', r.pinyin,
        '来自拼音表，用于谐音检测');
      field('声调 1-4', 'lexTone', r.tone || '', '0 表示未知/轻声');
      field('五行', 'lexWuxing', r.wuxing,
        inf.wuxingBasis || '需手工指定');
      field('康熙笔画', 'lexStrokes', r.strokes,
        inf.strokesBasis || '需手工填写');

      /* 性别 / 风格 */
      var gw = el('div', 'lex-field');
      gw.appendChild(el('label', null, '适用性别'));
      var gsel = document.createElement('select');
      gsel.id = 'lexGender';
      ['中性', '男', '女'].forEach(function (g) {
        var o = document.createElement('option');
        o.value = g; o.textContent = g;
        gsel.appendChild(o);
      });
      gw.appendChild(gsel);
      fields.appendChild(gw);

      var sw = el('div', 'lex-field');
      sw.appendChild(el('label', null, '风格标签'));
      var sinput = document.createElement('input');
      sinput.type = 'text';
      sinput.id = 'lexStyles';
      sinput.placeholder = '逗号分隔，可留空';
      sw.appendChild(sinput);
      fields.appendChild(sw);

      var mw = el('div', 'lex-field lex-field-wide');
      mw.appendChild(el('label', null, '寓意'));
      var minput = document.createElement('input');
      minput.type = 'text';
      minput.id = 'lexMeaning';
      minput.value = r.meaning || '';
      mw.appendChild(minput);
      fields.appendChild(mw);

      card.appendChild(fields);

      /* 推断置信度提示 */
      var warn = el('p', 'more-note');
      var confText = inf.wuxingConfidence === 'high' && inf.strokesConfidence === 'mid'
        ? '五行按部首推断（各派基本一致）；康熙笔画为估算值。'
        : '五行与康熙笔画均为推断/估算，请人工核对后再使用。';
      warn.innerHTML = '<b>可信度说明：</b>' + esc(confText) +
        '姓名学中的康熙笔画与五行不存在权威公开数据集，' +
        '本系统只能按部首规则推断。若你在意数理准确性，请查证后手工修正上方数值。';
      card.appendChild(warn);

      var actions = el('div', 'lex-actions');
      var add = el('button', 'btn', '加入字库');
      add.type = 'button';
      add.style.width = 'auto';
      add.addEventListener('click', function () { SyncUI.commitLookup(r); });
      actions.appendChild(add);
      card.appendChild(actions);

      box.appendChild(card);
    },

    commitLookup: function (r) {
      var ch = r.char;
      var tone = parseInt($('lexTone').value, 10);
      var strokes = parseInt($('lexStrokes').value, 10);
      var wuxing = ($('lexWuxing').value || '').trim();

      if (!wuxing || '金木水火土'.indexOf(wuxing) < 0) {
        global.alert('五行必须是「金 木 水 火 土」之一。');
        return;
      }
      if (!isFinite(strokes) || strokes <= 0) {
        global.alert('康熙笔画必须是正整数。');
        return;
      }

      var entry = {
        char: ch,
        pinyin: ($('lexPinyin').value || '').trim(),
        tone: isFinite(tone) ? tone : 0,
        wuxing: wuxing,
        gender: $('lexGender').value,
        styles: ($('lexStyles').value || '').split(/[,，、\s]+/)
          .map(function (s) { return s.trim(); }).filter(Boolean),
        meaning: ($('lexMeaning').value || '').trim() || '（未填写寓意）',
        strokes: strokes,
        __inferred: r.__inferred
      };

      NS.Lexicon.addCustomChar(entry).then(function () {
        SyncUI.refreshStatus();
        SyncUI.log('已把「' + ch + '」加入字库（' + wuxing + '·' +
          strokes + '画）。', 'ok');
        $('lexResult').innerHTML = '';
        $('lexChar').value = '';
      });
    },

    renderCustomChars: function () {
      var box = $('lexCustom');
      if (!box) return;
      box.innerHTML = '';
      var list = NS.Lexicon.customChars || [];
      if (!list.length) {
        box.appendChild(el('div', 'hint', '还没有联网加入的字。'));
        return;
      }
      list.forEach(function (c) {
        var chip = el('span', 'lex-chip');
        chip.innerHTML = '<b>' + esc(c.char) + '</b>' + esc(c.wuxing) +
          '·' + c.strokes + '画';
        var x = el('button', null, '×');
        x.type = 'button';
        x.title = '从字库移除';
        x.addEventListener('click', function () {
          NS.Lexicon.removeCustomChar(c.char).then(function () {
            SyncUI.refreshStatus();
            SyncUI.log('已移除「' + c.char + '」。', 'warn');
          });
        });
        chip.appendChild(x);
        box.appendChild(chip);
      });
    },

    /* ---------------- 导入导出 ---------------- */

    exportData: function () {
      var data = NS.Lexicon.exportBaked();
      var text;
      try {
        text = JSON.stringify(data);
      } catch (e) {
        global.alert('导出失败：' + e.message);
        return;
      }
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'naming-lexicon-' +
        new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      this.log('已导出数据文件（' + fmtSize(text.length) + '）。' +
        '放在 tools/ 目录下再打包，即可固化进单文件版。', 'ok');
    },

    importData: function (file) {
      var self = this;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try {
          data = JSON.parse(reader.result);
        } catch (e) {
          global.alert('文件不是合法 JSON：' + e.message);
          return;
        }
        NS.Store.importAll(data).then(function () {
          return NS.Lexicon.restore();
        }).then(function () {
          self.refreshStatus();
          self.log('已导入数据文件：' + file.name, 'ok');
        }).catch(function (e) {
          global.alert('导入失败：' + e.message);
        });
      };
      reader.readAsText(file);
    }
  };

  function pick(all) {
    Array.prototype.forEach.call(
      SyncUI.root.querySelectorAll('.lex-src input'),
      function (cb) {
        var src = NS.SOURCE_BY_ID[cb.value];
        cb.checked = all ? true : !src.big && src.group !== 'dict';
      });
  }

  NS.SyncUI = SyncUI;
})(typeof window !== 'undefined' ? window : globalThis);
