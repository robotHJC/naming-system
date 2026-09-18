/* =========================================================================
 * surnames.js —— 姓氏数据
 *   strokes 为「康熙笔画」（姓名学数理通用），不是简体笔画。
 *   例：张(張)=11、刘(劉)=15、陈(陳)=16、罗(羅)=20。
 *   pinyin / tone 用于音韵与谐音检测。
 *   若姓氏不在表中，界面允许手工填写笔画（会明确提示）。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 单姓：字|拼音|声调|康熙笔画 */
  NS.RAW_SURNAMES = [
    '李|li|3|7', '王|wang|2|4', '张|zhang|1|11', '刘|liu|2|15', '陈|chen|2|16',
    '杨|yang|2|13', '黄|huang|2|12', '赵|zhao|4|14', '吴|wu|2|7', '周|zhou|1|8',
    '徐|xu|2|10', '孙|sun|1|10', '马|ma|3|10', '朱|zhu|1|6', '胡|hu|2|11',
    '郭|guo|1|15', '林|lin|2|8', '何|he|2|7', '高|gao|1|10', '罗|luo|2|20',
    '郑|zheng|4|19', '梁|liang|2|11', '谢|xie|4|17', '宋|song|4|7', '唐|tang|2|10',
    '许|xu|3|11', '韩|han|2|17', '冯|feng|2|12', '邓|deng|4|19', '曹|cao|2|11',
    '彭|peng|2|12', '曾|zeng|1|12', '萧|xiao|1|19', '田|tian|2|5', '董|dong|3|15',
    '袁|yuan|2|10', '潘|pan|1|16', '于|yu|2|3', '蒋|jiang|3|17', '蔡|cai|4|17',
    '余|yu|2|7', '杜|du|4|7', '叶|ye|4|15', '程|cheng|2|12', '魏|wei|4|18',
    '苏|su|1|22', '吕|lv|3|7', '丁|ding|1|2', '任|ren|4|6', '卢|lu|2|16',
    '姚|yao|2|9', '沈|shen|3|8', '钟|zhong|1|17', '姜|jiang|1|9', '崔|cui|1|11',
    '谭|tan|2|19', '陆|lu|4|16', '范|fan|4|11', '汪|wang|1|8', '廖|liao|4|14',
    '石|shi|2|5', '金|jin|1|8', '韦|wei|2|9', '贾|jia|3|13', '夏|xia|4|10',
    '付|fu|4|5', '方|fang|1|4', '邹|zou|1|17', '熊|xiong|2|14', '白|bai|2|5',
    '孟|meng|4|8', '秦|qin|2|10', '邱|qiu|1|12', '侯|hou|2|9', '江|jiang|1|7',
    '尹|yin|3|4', '薛|xue|1|19', '闫|yan|2|12', '段|duan|4|9', '雷|lei|2|13',
    '龙|long|2|16', '黎|li|2|15', '史|shi|3|5', '陶|tao|2|16', '贺|he|4|12',
    '毛|mao|2|4', '郝|hao|3|14', '顾|gu|4|21', '龚|gong|1|22', '邵|shao|4|12',
    '万|wan|4|15', '覃|qin|2|12', '武|wu|3|8', '钱|qian|2|16', '戴|dai|4|18',
    '严|yan|2|20', '欧|ou|1|15', '莫|mo|4|13', '孔|kong|3|4', '向|xiang|4|6',
    '常|chang|2|11', '汤|tang|1|13', '康|kang|1|11', '易|yi|4|8', '乔|qiao|2|12',
    '温|wen|1|13', '岳|yue|4|8', '施|shi|1|9', '文|wen|2|4', '庞|pang|2|19',
    '樊|fan|2|15', '兰|lan|2|23', '殷|yin|1|10', '颜|yan|2|18', '倪|ni|2|10',
    '牛|niu|2|4', '章|zhang|1|11', '鲁|lu|3|15', '葛|ge|3|15', '伍|wu|3|6',
    '纪|ji|4|9', '舒|shu|1|12', '屈|qu|1|8', '项|xiang|4|12', '祝|zhu|4|10',
    '阮|ruan|3|12', '毕|bi|4|11', '聂|nie|4|18', '焦|jiao|1|12', '柳|liu|3|9',
    '骆|luo|4|16', '詹|zhan|1|13', '游|you|2|13', '柯|ke|1|9', '管|guan|3|14',
    '柴|chai|2|9', '华|hua|2|12', '瞿|qu|2|18', '戚|qi|1|11', '鲍|bao|4|16',
    '帅|shuai|4|9', '关|guan|1|19', '阎|yan|2|16', '佟|tong|2|7', '米|mi|3|6',
    '岑|cen|2|7', '齐|qi|2|14', '丛|cong|2|18', '应|ying|1|17', '房|fang|2|8',
    '边|bian|1|22', '苗|miao|2|11', '凤|feng|4|14', '花|hua|1|10', '晋|jin|4|10',
    '晏|yan|4|10', '冷|leng|3|7', '全|quan|2|6', '卓|zhuo|2|8', '简|jian|3|18',
    '强|qiang|2|11', '楚|chu|3|13', '卫|wei|4|15', '蓝|lan|2|20', '连|lian|2|14',
    '路|lu|4|13', '奚|xi|1|10', '满|man|3|15', '冉|ran|3|5', '祁|qi|2|8',
    '薄|bo|2|19', '缪|miao|4|17', '车|che|1|7', '滕|teng|2|14', '庄|zhuang|1|13',
    '沙|sha|1|8', '鞠|ju|1|17', '闻|wen|2|14', '党|dang|3|20', '宫|gong|1|10',
    '费|fei|4|12', '廉|lian|2|13', '岑|cen|2|7', '栾|luan|2|23', '盛|sheng|4|12',
    '刁|diao|1|2', '霍|huo|4|16', '虞|yu|2|13', '冉|ran|3|5', '桑|sang|1|10',
    '丛|cong|2|18', '屠|tu|2|12', '蒙|meng|2|16', '池|chi|2|7', '阴|yin|1|16',
    '郁|yu|4|13', '胥|xu|1|11', '能|neng|2|10', '苍|cang|1|16', '双|shuang|1|18'
  ];

  /* 复姓：姓|拼音1|声调1|笔画1|拼音2|声调2|笔画2 */
  NS.RAW_COMPOUND_SURNAMES = [
    '欧阳|ou|1|15|yang|2|17',
    '司马|si|1|5|ma|3|10',
    '上官|shang|4|3|guan|1|8',
    '诸葛|zhu|1|16|ge|3|15',
    '东方|dong|1|8|fang|1|4',
    '皇甫|huang|2|9|fu|3|7',
    '夏侯|xia|4|10|hou|2|9',
    '公孙|gong|1|4|sun|1|10',
    '慕容|mu|4|15|rong|2|10',
    '长孙|zhang|3|8|sun|1|10',
    '宇文|yu|3|6|wen|2|4',
    '司徒|si|1|5|tu|2|10',
    '司空|si|1|5|kong|1|8',
    '尉迟|wei|4|11|chi|2|19',
    '令狐|ling|4|5|hu|2|9',
    '南宫|nan|2|9|gong|1|10',
    '西门|xi|1|6|men|2|8',
    '独孤|du|2|16|gu|1|8',
    '端木|duan|1|14|mu|4|4',
    '百里|bai|3|6|li|3|7',
    '呼延|hu|1|8|yan|2|7'
  ];

  function norm(py) {
    return String(py).replace(/u:/g, 'ü').replace(/^lv$/, 'lü');
  }

  NS.SURNAME_DB = (function () {
    var db = Object.create(null);
    NS.RAW_SURNAMES.forEach(function (line) {
      var p = line.split('|');
      if (p.length !== 4) return;
      if (db[p[0]]) return;
      db[p[0]] = {
        char: p[0], compound: false,
        pinyin: [norm(p[1])], tones: [parseInt(p[2], 10)],
        strokes: [parseInt(p[3], 10)],
        totalStrokes: parseInt(p[3], 10)
      };
    });
    NS.RAW_COMPOUND_SURNAMES.forEach(function (line) {
      var p = line.split('|');
      if (p.length !== 7) return;
      if (db[p[0]]) return;
      db[p[0]] = {
        char: p[0], compound: true,
        pinyin: [norm(p[1]), norm(p[4])],
        tones: [parseInt(p[2], 10), parseInt(p[5], 10)],
        strokes: [parseInt(p[3], 10), parseInt(p[6], 10)],
        totalStrokes: parseInt(p[3], 10) + parseInt(p[6], 10)
      };
    });
    return db;
  })();

  NS.SURNAME_LIST = Object.keys(NS.SURNAME_DB);
})(typeof window !== 'undefined' ? window : globalThis);
