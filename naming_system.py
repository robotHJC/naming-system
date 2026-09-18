#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
五行八字取名系统 · 完整可运行版
=====================================
特性：
  1. 八字排盘（优先 lunar_python，无则降级内置近似算法）
  2. 五行统计 + 喜用神推断
  3. 扩展字库（260+ 字，含五行 / 性别 / 风格 / 寓意 / 笔画）
  4. 三才五格吉凶
  5. 诗词出处（内置经典诗词库）
  6. 谐音过滤（字面 + 拼音）
  7. 多维度评分
  8. 可选：联网重名/域名查询
  9. 可选：LLM 寓意解释
 10. FastAPI 接口（可选）

运行：
  python naming_system.py                    # 命令行演示
  python naming_system.py --api              # 启动 API 服务
  python naming_system.py --surname 李 --gender 女 --style 古风 \
      --birth 2024-05-20-10
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

# ============================================================
# 可选依赖：优雅降级
# ============================================================

try:
    from lunar_python import Solar
    HAS_LUNAR = True
except ImportError:
    HAS_LUNAR = False

try:
    from pypinyin import pinyin as _pinyin, Style as _PyStyle
    HAS_PYPINYIN = True
except ImportError:
    HAS_PYPINYIN = False

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    from fastapi import FastAPI
    from pydantic import BaseModel
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False


# ============================================================
# 一、基础常量
# ============================================================

TIANGAN = "甲乙丙丁戊己庚辛壬癸"
DIZHI = "子丑寅卯辰巳午未申酉戌亥"
TIANGAN_WUXING = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"]
DIZHI_WUXING = ["水", "土", "木", "木", "土", "火", "火", "土",
                "金", "金", "土", "水"]

WUXING = ["金", "木", "水", "火", "土"]

# 五行相生：木→火→土→金→水→木
SHENG = {"木": "火", "火": "土", "土": "金", "金": "水", "水": "木"}
# 五行相克：木克土，土克水，水克火，火克金，金克木
KE = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}
SHENG_WO = {v: k for k, v in SHENG.items()}
KE_WO = {v: k for k, v in KE.items()}

# 三才吉凶简表（(天格五行编号, 人格五行编号) → 吉凶）
# 五行编号：1木 2火 3土 4金 5水
SANCAI_JI = {
    (1, 1): "大吉", (1, 3): "大吉", (1, 5): "大吉",
    (2, 2): "大吉", (2, 4): "大吉",
    (3, 1): "大吉", (3, 3): "大吉", (3, 5): "大吉",
    (4, 2): "大吉", (4, 4): "大吉",
    (5, 1): "大吉", (5, 3): "大吉", (5, 5): "大吉",
    (1, 2): "中吉", (1, 4): "中吉",
    (2, 1): "中吉", (2, 3): "中吉", (2, 5): "中吉",
    (3, 2): "中吉", (3, 4): "中吉",
    (4, 1): "中吉", (4, 3): "中吉", (4, 5): "中吉",
    (5, 2): "中吉", (5, 4): "中吉",
}

WUXING_NUM = {"木": 1, "火": 2, "土": 3, "金": 4, "水": 5}


# ============================================================
# 二、字库（260+ 字）
#    格式：字|拼音|声调|五行|性别|风格|寓意|笔画
#    笔画为康熙繁体笔画近似值，用于三才五格
# ============================================================

RAW_CHARS = """
# ---------------- 木 ----------------
梓|zi|3|木|中性|古风,文雅|梓树，生机勃勃，寓意茁壮成长|11
楠|nan|2|木|中性|古风,大气|楠木，珍贵坚实，寓意稳重可靠|13
森|sen|1|木|男|大气,自然|森林茂盛，寓意生机勃发|12
林|lin|2|木|中性|自然,简约|树林，寓意聚集繁盛|8
栋|dong|4|木|男|大气|栋梁之才，寓意担当重任|12
梁|liang|2|木|男|大气|桥梁栋梁，寓意支撑连接|11
楷|kai|3|木|男|文雅|楷模，寓意品行端正|13
松|song|1|木|男|古风|松树，寓意坚韧长青|8
柏|bai|3|木|男|古风|柏树，寓意坚贞不屈|9
桐|tong|2|木|中性|古风,文雅|梧桐，寓意高洁祥瑞|10
枫|feng|1|木|中性|自然,灵动|枫叶，寓意热情秋意|13
梅|mei|2|木|女|古风|梅花，寓意傲雪凌霜|11
桃|tao|2|木|女|温柔|桃花，寓意美好明艳|10
桂|gui|4|木|中性|古风|桂花，寓意芬芳高贵|10
梦|meng|4|木|女|灵动,温柔|梦想，寓意美好期许|16
若|ruo|4|木|中性|古风,温柔|如同，寓意柔和谦逊|11
芸|yun|2|木|女|温柔,文雅|芸香，寓意清新雅致|10
芮|rui|4|木|女|温柔|草木初生，寓意柔美细腻|10
芊|qian|1|木|女|温柔|草木茂盛，寓意柔美|9
芷|zhi|3|木|女|古风|白芷香草，寓意高洁|10
菡|han|4|木|女|古风|荷花，寓意清雅脱俗|14
茉|mo|4|木|女|温柔|茉莉，寓意清香纯净|11
茵|yin|1|木|女|温柔|绿茵，寓意柔软生机|12
菁|jing|1|木|女|文雅|菁华，寓意精美出众|14
苏|su|1|木|中性|古风|苏醒，寓意生机复苏|22
荣|rong|2|木|男|大气|繁荣，寓意荣耀|14
茂|mao|4|木|男|大气|茂盛，寓意繁茂|11
萱|xuan|1|木|女|温柔|萱草，寓意忘忧|15
蕙|hui|4|木|女|古风|蕙兰，寓意高洁|18
蕴|yun|4|木|中性|文雅|蕴藏，寓意内涵深厚|22
竹|zhu|2|木|中性|古风|竹子，寓意虚心有节|6
笛|di|2|木|中性|文雅|笛子，寓意清越悠扬|11
简|jian|3|木|中性|简约|简洁，寓意质朴|18
策|ce|4|木|男|大气|策略，寓意谋划|12
箫|xiao|1|木|中性|古风|箫，寓意清幽雅致|14
彦|yan|4|木|男|文雅|有才学的人|9
启|qi|3|木|男|大气|启发，寓意开启|11
尧|yao|2|木|男|古风|尧帝，寓意圣明|12
弈|yi|4|木|男|文雅|下棋，寓意智慧|9
谦|qian|1|木|男|文雅|谦虚，寓意谦逊|17
薇|wei|1|木|女|温柔|蔷薇，寓意美丽|19
蕾|lei|3|木|女|温柔|花蕾，寓意含苞待放|19
苍|cang|1|木|男|大气|苍翠，寓意辽阔|16
蔚|wei|4|木|中性|大气|蔚蓝，寓意茂盛|17
桦|hua|4|木|中性|大气|白桦，寓意挺拔|16
杰|jie|2|木|男|大气|杰出，寓意卓越|12
权|quan|2|木|男|大气|权力，寓意掌控|22
榛|zhen|1|木|中性|自然|榛树，寓意茂盛|14
栗|li|4|木|中性|自然|栗树，寓意坚实|10
榕|rong|2|木|中性|大气|榕树，寓意繁茂|14
棋|qi|2|木|男|文雅|棋局，寓意谋略|12

# ---------------- 火 ----------------
炎|yan|2|火|男|大气|火焰，寓意热烈|8
焕|huan|4|火|男|大气|焕发，寓意光彩|11
灿|can|4|火|中性|大气|灿烂，寓意明亮|17
烨|ye|4|火|男|大气|火光，寓意辉煌|12
烁|shuo|4|火|中性|灵动|闪烁，寓意光亮|19
煜|yu|4|火|男|大气|照耀，寓意明亮|13
炜|wei|3|火|男|大气|光彩鲜明|13
炯|jiong|3|火|男|大气|明亮，炯炯有神|9
晗|han|2|火|女|温柔|天将明，寓意希望|11
昕|xin|1|火|女|温柔|黎明，寓意明亮|8
昊|hao|4|火|男|大气|天空广阔|8
昱|yu|4|火|中性|大气|日光，寓意明亮|9
晟|sheng|4|火|男|大气|光明鼎盛|11
曦|xi|1|火|中性|古风|晨曦，寓意阳光|20
曜|yao|4|火|男|大气|光芒，寓意日曜|18
晖|hui|1|火|中性|大气|光辉|13
暖|nuan|3|火|女|温柔|温暖|13
明|ming|2|火|中性|大气|光明，寓意明智|8
昭|zhao|1|火|中性|古风|昭示，寓意光明|9
旭|xu|4|火|男|大气|旭日东升|6
景|jing|3|火|中性|大气|日光，寓意前景|12
晴|qing|2|火|女|温柔|晴朗|12
灵|ling|2|火|女|灵动|灵动，寓意聪慧|24
丹|dan|1|火|女|温柔|红色，寓意赤诚|4
彤|tong|2|火|女|温柔|红色，寓意朝霞|7
熙|xi|1|火|中性|古风|光明，寓意和乐|13
炫|xuan|4|火|男|大气|光彩炫耀|9
照|zhao|4|火|男|大气|照耀|13
智|zhi|4|火|男|文雅|智慧|12
礼|li|3|火|男|文雅|礼仪|6
德|de|2|火|男|文雅|品德|15
宁|ning|2|火|中性|温柔|安宁|14
亮|liang|4|火|男|大气|明亮|9
磊|lei|3|火|男|大气|光明磊落|15
伶|ling|2|火|女|灵动|伶俐|7
朗|lang|3|火|男|大气|明朗|11
廷|ting|2|火|男|大气|朝廷，寓意尊贵|7
帝|di|4|火|男|大气|帝王，寓意尊贵|9
恺|kai|3|火|男|大气|快乐|14
恬|tian|2|火|女|温柔|恬静|10
悦|yue|4|火|女|温柔|喜悦|11
念|nian|4|火|中性|文雅|思念|8
律|lu:|4|火|男|文雅|韵律|9

# ---------------- 土 ----------------
坤|kun|1|土|男|大气|大地，寓意包容|8
垚|yao|2|土|男|古风|高远|9
城|cheng|2|土|男|大气|城池，寓意坚固|10
基|ji|1|土|男|大气|根基|11
培|pei|2|土|男|文雅|培育|11
坚|jian|1|土|男|大气|坚定|11
垠|yin|2|土|中性|大气|边际，寓意广阔|9
垣|yuan|2|土|中性|古风|城墙|9
岳|yue|4|土|男|大气|山岳|8
峰|feng|1|土|男|大气|山峰|10
峻|jun|4|土|男|大气|高峻|10
岚|lan|2|土|女|古风|山间雾气|12
岩|yan|2|土|男|大气|岩石，寓意坚固|8
峥|zheng|1|土|男|大气|高峻|11
嵘|rong|2|土|男|大气|高峻|17
崇|chong|2|土|男|大气|崇高|11
嵩|song|1|土|男|大气|嵩山|13
岱|dai|4|土|男|古风|泰山|8
岐|qi|2|土|男|古风|岐山|7
山|shan|1|土|男|大气|山峰|3
圣|sheng|4|土|男|大气|圣明|13
佳|jia|1|土|女|温柔|美好|8
依|yi|1|土|女|温柔|依靠|8
伟|wei|3|土|男|大气|伟大|11
优|you|1|土|中性|文雅|优秀|17
宇|yu|3|土|男|大气|宇宙，寓意气度|6
安|an|1|土|中性|温柔|平安|6
恩|en|1|土|中性|温柔|恩惠|10
维|wei|2|土|中性|文雅|维系|14
永|yong|3|土|男|大气|永远|5
远|yuan|3|土|男|大气|远大|17
阳|yang|2|土|男|大气|阳光|17
辰|chen|2|土|男|大气|星辰|7
逸|yi|4|土|男|文雅|飘逸|15
雍|yong|1|土|男|古风|雍容|13
圆|yuan|2|土|中性|温柔|圆满|13
园|yuan|2|土|中性|温柔|园林|13
容|rong|2|土|女|温柔|包容|10
宜|yi|2|土|女|温柔|适宜|8
友|you|3|土|男|大气|友爱|4
叶|ye|4|土|中性|自然|叶子|15
韵|yun|4|土|女|文雅|韵味|19
瑛|ying|1|土|女|古风|玉的光彩|14
嫣|yan|1|土|女|温柔|美好|14
婉|wan|3|土|女|温柔|婉约|11
娅|ya|4|土|女|温柔|优雅|11
勇|yong|3|土|男|大气|勇敢|9
忆|yi|4|土|中性|文雅|回忆|17
亦|yi|4|土|中性|简约|也|6
唯|wei|2|土|中性|简约|唯一|11
羽|yu|3|土|中性|灵动|羽毛|6
予|yu|3|土|中性|温柔|给予|4
悠|you|1|土|中性|文雅|悠然|11

# ---------------- 金 ----------------
金|jin|1|金|男|大气|金属，寓意珍贵|8
鑫|xin|1|金|男|大气|财富兴盛|24
锐|rui|4|金|男|大气|锐利|15
铭|ming|2|金|男|文雅|铭记|14
钧|jun|1|金|男|大气|千钧，寓意重要|12
钰|yu|4|金|女|古风|珍宝|13
铄|shuo|4|金|中性|大气|光亮|18
锦|jin|3|金|中性|古风|锦绣|16
镕|rong|2|金|男|大气|熔铸|18
铁|tie|3|金|男|大气|坚强|21
钢|gang|1|金|男|大气|刚强|16
钦|qin|1|金|男|文雅|钦敬|12
镇|zhen|4|金|男|大气|镇守|18
锋|feng|1|金|男|大气|先锋|15
锡|xi|1|金|男|文雅|赐予|16
银|yin|2|金|中性|古风|银色|14
铠|kai|3|金|男|大气|铠甲|18
剑|jian|4|金|男|大气|剑，寓意锐利|15
戈|ge|1|金|男|古风|兵器|4
刚|gang|1|金|男|大气|刚强|10
利|li|4|金|男|大气|锋利|7
则|ze|2|金|男|文雅|准则|9
创|chuang|4|金|男|大气|开创|12
士|shi|4|金|男|文雅|士人|3
壮|zhuang|4|金|男|大气|强壮|7
西|xi|1|金|中性|简约|西方|6
辛|xin|1|金|中性|简约|辛勤|7
白|bai|2|金|中性|简约|洁白|5
秋|qiu|1|金|中性|古风|秋天|9
素|su|4|金|女|文雅|素雅|10
瑞|rui|4|金|中性|大气|祥瑞|14
静|jing|4|金|女|温柔|宁静|16
姗|shan|1|金|女|温柔|姗姗|8
珊|shan|1|金|女|温柔|珊瑚|10
珠|zhu|1|金|女|温柔|珍珠|11
珍|zhen|1|金|女|温柔|珍贵|10
珂|ke|1|金|女|古风|玉名|10
琪|qi|2|金|女|古风|美玉|13
瑾|jin|3|金|女|古风|美玉|16
琛|chen|1|金|中性|古风|珍宝|13
珺|jun|4|金|女|古风|美玉|12
珏|jue|2|金|中性|古风|双玉|10
思|si|1|金|中性|文雅|思念，寓意思考|9
悦|yue|4|金|女|温柔|喜悦|11
心|xin|1|金|女|温柔|心灵|4
紫|zi|3|金|女|古风|紫色，寓意高贵|11
书|shu|1|金|中性|文雅|书籍|10
诗|shi|1|金|女|古风|诗歌|13
舒|shu|1|金|中性|温柔|舒展|12
纯|chun|2|金|女|温柔|纯洁|10
秀|xiu|4|金|女|温柔|秀美|7
初|chu|1|金|中性|简约|初始|7
然|ran|2|金|中性|简约|自然|12
宣|xuan|1|金|中性|文雅|宣扬|9
馨|xin|1|金|女|温柔|温馨|20
辰|chen|2|金|男|大气|星辰|7
镕|rong|2|金|男|大气|熔铸|18
铃|ling|2|金|女|温柔|铃铛|13
锐|rui|4|金|男|大气|锐利|15
银|yin|2|金|中性|古风|银色|14
睿|rui|4|金|男|文雅|智慧|14
倩|qian|4|金|女|温柔|美好|10
仙|xian|1|金|女|古风|仙人|5
仟|qian|1|金|中性|简约|千|5
少|shao|4|金|男|大气|少年|4

# ---------------- 水 ----------------
水|shui|3|水|中性|简约|水，寓意柔韧|4
淼|miao|3|水|中性|大气|水势浩大|12
清|qing|1|水|中性|文雅|清澈|12
澈|che|4|水|中性|文雅|清澈|16
涵|han|2|水|中性|文雅|涵养|12
澜|lan|2|水|中性|大气|波澜|21
波|bo|1|水|男|大气|波涛|9
洋|yang|2|水|男|大气|海洋|10
海|hai|3|水|男|大气|大海|11
江|jiang|1|水|男|大气|江河|7
河|he|2|水|男|大气|河流|9
湖|hu|2|水|中性|大气|湖泊|13
涛|tao|1|水|男|大气|波涛|18
潮|chao|2|水|男|大气|潮水|16
汐|xi|1|水|女|温柔|潮汐|6
洛|luo|4|水|中性|古风|洛水|10
潇|xiao|1|水|中性|古风|潇洒|20
湘|xiang|1|水|女|古风|湘江|13
渭|wei|4|水|男|古风|渭水|13
源|yuan|2|水|男|大气|源头|14
渊|yuan|1|水|男|文雅|渊博|12
泽|ze|2|水|男|大气|恩泽|17
润|run|4|水|中性|温柔|滋润|16
泓|hong|2|水|中性|大气|水深广|9
沛|pei|4|水|男|大气|充沛|8
沁|qin|4|水|女|温柔|沁人心脾|8
沐|mu|4|水|中性|温柔|沐浴|8
寒|han|2|水|中性|清冷|寒冷|12
冬|dong|1|水|中性|简约|冬天|5
冰|bing|1|水|女|清冷|冰清玉洁|6
凌|ling|2|水|中性|大气|凌空|10
凝|ning|2|水|女|清冷|凝聚|16
雨|yu|3|水|中性|温柔|雨水|8
雪|xue|3|水|女|清冷|雪花|11
霖|lin|2|水|中性|大气|甘霖|16
霏|fei|1|水|女|温柔|雨雪纷飞|16
露|lu|4|水|女|温柔|露水|21
霆|ting|2|水|男|大气|雷霆|15
霄|xiao|1|水|男|大气|云霄|15
雯|wen|2|水|女|温柔|云纹|12
云|yun|2|水|中性|古风|云彩|4
飞|fei|1|水|男|大气|飞翔|9
鸿|hong|2|水|男|大气|鸿雁|17
鹏|peng|2|水|男|大气|大鹏|19
鸣|ming|2|水|男|大气|鸣叫|14
学|xue|2|水|男|文雅|学习|16
文|wen|2|水|中性|文雅|文采|4
和|he|2|水|中性|温柔|和谐|8
民|min|2|水|男|大气|民众|5
品|pin|3|水|男|文雅|品格|9
盈|ying|2|水|女|温柔|充盈|9
慧|hui|4|水|女|文雅|智慧|15
敏|min|3|水|女|文雅|敏捷|11
惠|hui|4|水|女|温柔|贤惠|12
贤|xian|2|水|男|文雅|贤能|15
兴|xing|1|水|男|大气|兴盛|16
行|xing|2|水|男|大气|行动|6
向|xiang|4|水|男|大气|方向|6
方|fang|1|水|中性|简约|方正|4
化|hua|4|水|男|大气|变化|4
北|bei|3|水|男|大气|北方|5
贝|bei|4|水|女|温柔|宝贝|7
碧|bi|4|水|女|古风|碧绿|14
秉|bing|3|水|男|文雅|秉持|8
博|bo|2|水|男|大气|博学|12
步|bu|4|水|男|大气|步伐|7
风|feng|1|水|中性|大气|风度|4
平|ping|2|水|中性|简约|平安|5
恒|heng|2|水|男|大气|恒久|10
灏|hao|4|水|男|大气|水势浩大|25
潜|qian|2|水|男|文雅|潜能|16
潜|qian|2|水|男|文雅|潜能|16
"""


# ============================================================
# 三、字库解析
# ============================================================

@dataclass
class ChineseChar:
    char: str
    pinyin: str
    tone: int
    wuxing: str
    gender: str
    styles: List[str]
    meaning: str
    strokes: int


def _parse_chars(raw: str) -> Dict[str, ChineseChar]:
    result: Dict[str, ChineseChar] = {}
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 8:
            continue
        char, py, tone, wx, gender, styles, meaning, strokes = parts
        if char in result:
            continue
        result[char] = ChineseChar(
            char=char,
            pinyin=py.strip(),
            tone=int(tone),
            wuxing=wx,
            gender=gender,
            styles=[s.strip() for s in styles.split(",") if s.strip()],
            meaning=meaning,
            strokes=int(strokes),
        )
    return result


CHAR_DB: Dict[str, ChineseChar] = _parse_chars(RAW_CHARS)


# ============================================================
# 四、诗词库（内置经典诗词）
# ============================================================

class PoetryLibrary:
    """
    内置诗词库。若安装了 chinese-poetry 数据文件，可通过 load_from_json 加载。
    """

    def __init__(self):
        self.poems: List[Dict] = []
        self.index: Dict[str, List[int]] = {}
        self._load_demo()

    def _load_demo(self):
        demo = [
            ("诗经", "周南·桃夭", "桃之夭夭，灼灼其华。之子于归，宜其室家。"),
            ("诗经", "小雅·鹿鸣", "呦呦鹿鸣，食野之苹。我有嘉宾，鼓瑟吹笙。"),
            ("诗经", "周南·关雎", "关关雎鸠，在河之洲。窈窕淑女，君子好逑。"),
            ("诗经", "卫风·淇奥", "瞻彼淇奥，绿竹猗猗。有匪君子，如切如磋。"),
            ("诗经", "郑风·子衿", "青青子衿，悠悠我心。纵我不往，子宁不嗣音？"),
            ("诗经", "小雅·鹤鸣", "鹤鸣于九皋，声闻于野。鱼潜在渊，或在于渚。"),
            ("诗经", "大雅·文王", "周虽旧邦，其命维新。有周不显，帝命不时。"),
            ("楚辞", "离骚", "路漫漫其修远兮，吾将上下而求索。"),
            ("楚辞", "九歌·湘夫人", "沅有芷兮澧有兰，思公子兮未敢言。"),
            ("楚辞", "九歌·少司命", "悲莫悲兮生别离，乐莫乐兮新相知。"),
            ("楚辞", "九章·橘颂", "后皇嘉树，橘徕服兮。受命不迁，生南国兮。"),
            ("唐诗", "李白·静夜思", "床前明月光，疑是地上霜。举头望明月，低头思故乡。"),
            ("唐诗", "李白·望庐山瀑布", "日照香炉生紫烟，遥看瀑布挂前川。飞流直下三千尺，疑是银河落九天。"),
            ("唐诗", "杜甫·春望", "国破山河在，城春草木深。感时花溅泪，恨别鸟惊心。"),
            ("唐诗", "王维·山居秋暝", "空山新雨后，天气晚来秋。明月松间照，清泉石上流。"),
            ("唐诗", "张若虚·春江花月夜", "春江潮水连海平，海上明月共潮生。"),
            ("唐诗", "王勃·送杜少府之任蜀州", "海内存知己，天涯若比邻。"),
            ("唐诗", "王之涣·登鹳雀楼", "白日依山尽，黄河入海流。欲穷千里目，更上一层楼。"),
            ("唐诗", "孟浩然·春晓", "春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。"),
            ("唐诗", "刘禹锡·秋词", "自古逢秋悲寂寥，我言秋日胜春朝。晴空一鹤排云上，便引诗情到碧霄。"),
            ("唐诗", "白居易·赋得古原草送别", "离离原上草，一岁一枯荣。野火烧不尽，春风吹又生。"),
            ("宋词", "苏轼·水调歌头", "明月几时有，把酒问青天。不知天上宫阙，今夕是何年。"),
            ("宋词", "苏轼·念奴娇·赤壁怀古", "大江东去，浪淘尽，千古风流人物。"),
            ("宋词", "辛弃疾·青玉案·元夕", "众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。"),
            ("宋词", "李清照·如梦令", "昨夜雨疏风骤，浓睡不消残酒。试问卷帘人，却道海棠依旧。"),
            ("宋词", "柳永·雨霖铃", "今宵酒醒何处？杨柳岸，晓风残月。"),
            ("宋词", "欧阳修·生查子·元夕", "去年元夜时，花市灯如昼。月上柳梢头，人约黄昏后。"),
            ("宋词", "辛弃疾·破阵子", "醉里挑灯看剑，梦回吹角连营。八百里分麾下炙，五十弦翻塞外声。"),
            ("宋词", "晏殊·浣溪沙", "无可奈何花落去，似曾相识燕归来。小园香径独徘徊。"),
            ("宋词", "秦观·鹊桥仙", "两情若是久长时，又岂在朝朝暮暮。"),
            ("论语", "学而", "学而时习之，不亦说乎？有朋自远方来，不亦乐乎？"),
            ("论语", "为政", "温故而知新，可以为师矣。"),
            ("论语", "子罕", "岁寒，然后知松柏之后凋也。"),
            ("老子", "道德经·第八章", "上善若水，水善利万物而不争。"),
            ("老子", "道德经·第六十四章", "合抱之木，生于毫末；九层之台，起于累土。"),
        ]
        for source, title, content in demo:
            self.poems.append({
                "source": source,
                "title": title,
                "content": content,
                "line": content,
            })
        self._build_index()

    def _build_index(self):
        for i, poem in enumerate(self.poems):
            for ch in set(poem["content"]):
                if "\u4e00" <= ch <= "\u9fff":
                    self.index.setdefault(ch, []).append(i)

    def load_from_json(self, path: str):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        for item in raw:
            content = "".join(item.get("paragraphs", []))
            self.poems.append({
                "source": item.get("source", ""),
                "title": item.get("title", ""),
                "content": content,
                "line": content[:60],
            })
        self.index.clear()
        self._build_index()

    def find_source(self, chars: List[str]) -> Optional[Dict]:
        if not chars:
            return None
        candidates = None
        for ch in chars:
            ids = set(self.index.get(ch, []))
            candidates = ids if candidates is None else (candidates & ids)
            if not candidates:
                return None
        for pid in candidates:
            poem = self.poems[pid]
            return {
                "source": poem["source"],
                "title": poem["title"],
                "line": self._extract_line(poem["content"], chars),
            }
        return None

    @staticmethod
    def _extract_line(content: str, chars: List[str]) -> str:
        import re
        for line in re.split(r"[，。！？；、\n]", content):
            if all(c in line for c in chars):
                return line.strip()
        return content[:50]


POETRY_LIB = PoetryLibrary()


# ============================================================
# 五、八字排盘
# ============================================================

def _jdn(year: int, month: int, day: int) -> int:
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return (day + (153 * m + 2) // 5 + 365 * y
            + y // 4 - y // 100 + y // 400 - 32045)


_JIEQI_DAY = {1: 6, 2: 4, 3: 6, 4: 5, 5: 6, 6: 6,
              7: 7, 8: 8, 9: 8, 10: 8, 11: 7, 12: 7}
_ZHI_AFTER = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
              7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 0}
_ZHI_BEFORE = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
               7: 6, 8: 7, 9: 8, 10: 9, 11: 10, 12: 11}


def _month_zhi(month: int, day: int) -> int:
    return _ZHI_AFTER[month] if day >= _JIEQI_DAY[month] else _ZHI_BEFORE[month]


def calc_bazi_simple(year: int, month: int, day: int, hour: int) -> Dict:
    """内置近似八字算法"""
    if month < 2 or (month == 2 and day < 4):
        y = year - 1
    else:
        y = year
    year_gan = (y - 4) % 10
    year_zhi = (y - 4) % 12

    m_zhi = _month_zhi(month, day)
    m_gan = (year_gan * 2 + m_zhi) % 10

    j = _jdn(year, month, day)
    d_gan = (j + 9) % 10
    d_zhi = (j + 1) % 12

    h_zhi = ((hour + 1) // 2) % 12
    h_gan = (d_gan % 5 * 2 + h_zhi) % 10

    return {
        "年": (year_gan, year_zhi),
        "月": (m_gan, m_zhi),
        "日": (d_gan, d_zhi),
        "时": (h_gan, h_zhi),
    }


def calc_bazi_precise(year: int, month: int, day: int,
                      hour: int, minute: int = 0,
                      longitude: Optional[float] = None) -> Dict:
    """优先使用 lunar_python，降级到内置算法"""
    if not HAS_LUNAR:
        return calc_bazi_simple(year, month, day, hour)

    solar = Solar.fromYmdHms(year, month, day, hour, minute, 0)
    if longitude is not None:
        offset = (longitude - 120.0) * 4
        total_min = hour * 60 + minute + offset
        hour = int(total_min // 60) % 24
        minute = int(total_min % 60)
        solar = Solar.fromYmdHms(year, month, day, hour, minute, 0)

    lunar = solar.getLunar()
    ec = lunar.getEightChar()

    return {
        "年": (TIANGAN.index(ec.getYearGan()), DIZHI.index(ec.getYearZhi())),
        "月": (TIANGAN.index(ec.getMonthGan()), DIZHI.index(ec.getMonthZhi())),
        "日": (TIANGAN.index(ec.getDayGan()), DIZHI.index(ec.getDayZhi())),
        "时": (TIANGAN.index(ec.getTimeGan()), DIZHI.index(ec.getTimeZhi())),
    }


def analyze_bazi(year: int, month: int, day: int,
                 hour: int, minute: int = 0,
                 longitude: Optional[float] = None) -> Dict:
    bz = calc_bazi_precise(year, month, day, hour, minute, longitude)

    cnt = {w: 0 for w in WUXING}
    for gan, zhi in bz.values():
        cnt[TIANGAN_WUXING[gan]] += 1
        cnt[DIZHI_WUXING[zhi]] += 1

    day_gan = bz["日"][0]
    day_wx = TIANGAN_WUXING[day_gan]
    sheng_wo = SHENG_WO[day_wx]
    tong_dang = cnt[day_wx] + cnt[sheng_wo]

    if tong_dang >= 4:
        strength = "身强"
        candidates = [SHENG[day_wx], KE[day_wx], KE_WO[day_wx]]
    else:
        strength = "身弱"
        candidates = [sheng_wo, day_wx]

    candidates.sort(key=lambda w: cnt[w])

    bazi_str = " ".join(
        TIANGAN[g] + DIZHI[z] for g, z in
        [bz["年"], bz["月"], bz["日"], bz["时"]]
    )

    return {
        "bazi": bz,
        "bazi_str": bazi_str,
        "count": cnt,
        "day_wx": day_wx,
        "strength": strength,
        "xiyongshen": candidates,
        "engine": "lunar_python" if HAS_LUNAR else "builtin",
    }


# ============================================================
# 六、三才五格
# ============================================================

def calc_wuge(surname_strokes: int, n1: int, n2: int = 0) -> Dict:
    """单姓单名 / 单姓复名"""
    if n2 == 0:
        tian = surname_strokes + 1
        ren = surname_strokes + n1
        di = n1 + 1
        zong = surname_strokes + n1
        wai = 2
    else:
        tian = surname_strokes + 1
        ren = surname_strokes + n1
        di = n1 + n2
        zong = surname_strokes + n1 + n2
        wai = surname_strokes + n2

    def _wx(n: int) -> str:
        d = n % 10
        if d in (1, 2):
            return "木"
        if d in (3, 4):
            return "火"
        if d in (5, 6):
            return "土"
        if d in (7, 8):
            return "金"
        return "水"   # 9, 0

    wx_tian, wx_ren, wx_di = _wx(tian), _wx(ren), _wx(di)
    key = (WUXING_NUM[wx_tian], WUXING_NUM[wx_ren])
    ji = SANCAI_JI.get(key, "中吉")

    return {
        "天格": tian, "人格": ren, "地格": di,
        "总格": zong, "外格": wai,
        "三才": wx_tian + wx_ren + wx_di,
        "三才吉凶": ji,
    }


# ============================================================
# 七、谐音过滤
# ============================================================

BAD_WORDS = {
    "死", "屎", "尿", "病", "毒", "穷", "蠢", "笨", "傻", "呆",
    "疯", "癫", "残", "废", "凶", "恶", "祸", "灾", "霉", "衰",
    "龟", "鳖", "蛋", "屁", "粪", "尸", "鬼", "妖", "魔", "邪",
    "淫", "娼", "嫖", "赌", "贼", "盗", "匪", "寇", "丧", "亡",
}

# 拼音谐音黑名单（不雅词全拼）
BAD_PINYIN = {"si", "shi", "niao", "bing", "du", "qiong", "chun",
              "ben", "sha", "dai", "feng", "dian", "can", "fei"}


def _to_pinyin(text: str) -> str:
    if HAS_PYPINYIN:
        res = _pinyin(text, style=_PyStyle.NORMAL)
        return "".join(r[0] for r in res if r)
    return ""


def check_homophone(full_name: str) -> Dict:
    hits = []
    # 字面
    for w in BAD_WORDS:
        if w in full_name:
            hits.append({"word": w, "type": "字面"})

    # 拼音
    py = _to_pinyin(full_name)
    if py:
        for w in BAD_PINYIN:
            if w in py:
                hits.append({"word": w, "type": "拼音", "pinyin": py})

    return {"pass": len(hits) == 0, "hits": hits, "pinyin": py}


# ============================================================
# 八、可选：联网查询
# ============================================================

async def query_duplicate(surname: str, given_name: str) -> Dict:
    """查询重名（ApiZero 免费接口，需 httpx）"""
    if not HAS_HTTPX:
        return {"available": False, "reason": "未安装 httpx"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(
                "https://v1.apizero.cn/api/baby-naming",
                params={"action": "duplicate",
                        "surname": surname, "name": given_name},
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("code") == 0:
                    return {"available": True, "data": data["data"]}
    except Exception as e:
        return {"available": False, "reason": str(e)}
    return {"available": False, "reason": "接口未返回有效结果"}


# ============================================================
# 九、可选：LLM 寓意解释
# ============================================================

class LLMExplainer:
    def __init__(self, api_key: Optional[str] = None,
                 base_url: Optional[str] = None,
                 model: str = "deepseek-chat"):
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY") \
            or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv(
            "LLM_BASE_URL", "https://api.deepseek.com/v1")
        self.model = model

    def explain(self, surname: str, name: str, bazi_info: Dict,
                poetry_source: Optional[Dict] = None,
                wuge_info: Optional[Dict] = None) -> str:
        if not self.api_key or not HAS_HTTPX:
            return self._fallback(surname, name, bazi_info, poetry_source, wuge_info)
        try:
            prompt = self._build_prompt(surname, name, bazi_info,
                                        poetry_source, wuge_info)
            resp = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system",
                         "content": "你是精通国学、五行八字和诗词的取名专家，"
                                    "请用优雅简洁的中文解释名字寓意。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 300,
                },
                timeout=20,
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
        except Exception:
            pass
        return self._fallback(surname, name, bazi_info, poetry_source, wuge_info)

    @staticmethod
    def _build_prompt(surname, name, bazi_info, poetry_source, wuge_info):
        parts = [f"请为名字「{surname}{name}」写一段寓意解释（100字以内）。"]
        if bazi_info:
            parts.append(
                f"八字：{bazi_info.get('bazi_str', '')}，"
                f"日主：{bazi_info.get('day_wx', '')}，"
                f"喜用神：{'、'.join(bazi_info.get('xiyongshen', []))}。"
            )
        if poetry_source:
            parts.append(
                f"出处：《{poetry_source['source']}》·{poetry_source['title']}"
                f"：{poetry_source['line']}"
            )
        if wuge_info:
            parts.append(f"三才{wuge_info['三才']}（{wuge_info['三才吉凶']}）。")
        parts.append("结合五行、诗词和数理，语言优美。")
        return "\n".join(parts)

    @staticmethod
    def _fallback(surname, name, bazi_info, poetry_source, wuge_info):
        parts = []
        if bazi_info:
            parts.append(
                f"「{surname}{name}」日主{bazi_info.get('day_wx', '')}，"
                f"喜用神{'、'.join(bazi_info.get('xiyongshen', []))}。"
            )
        if poetry_source:
            parts.append(
                f"出自《{poetry_source['source']}》「{poetry_source['line']}」。")
        if wuge_info:
            parts.append(f"三才{wuge_info['三才']}，{wuge_info['三才吉凶']}。")
        return "".join(parts) if parts else f"「{surname}{name}」寓意美好。"


# ============================================================
# 十、评分
# ============================================================

def _shengmu(py: str) -> str:
    for sm in ("zh", "ch", "sh"):
        if py.startswith(sm):
            return sm
    return py[0] if py else ""


def _yunmu(py: str) -> str:
    sm = _shengmu(py)
    return py[len(sm):] if py else ""


def score_name(chars: List[ChineseChar], surname: str,
               surname_strokes: int, gender: str, style: str,
               keywords: List[str], xiyongshen: List[str]) -> Tuple[float, List[str], Dict]:
    score = 0.0
    reasons: List[str] = []
    detail: Dict = {}

    # 五行（30）
    wx_s = 0
    for c in chars:
        if xiyongshen and c.wuxing == xiyongshen[0]:
            wx_s += 20
        elif len(xiyongshen) > 1 and c.wuxing == xiyongshen[1]:
            wx_s += 10
    score += min(wx_s, 30)
    if wx_s >= 20:
        reasons.append(f"五行补{xiyongshen[0]}")

    # 音韵（15）
    tones = [c.tone for c in chars]
    if len(set(tones)) == len(tones):
        score += 8
        reasons.append("声调错落")
    elif len(set(tones)) >= 2:
        score += 4
    sms = [_shengmu(c.pinyin) for c in chars]
    yms = [_yunmu(c.pinyin) for c in chars]
    if len(set(sms)) == len(sms):
        score += 4
    if len(set(yms)) == len(yms):
        score += 3

    # 寓意（15）
    joined = "".join(c.meaning for c in chars)
    hit = sum(1 for kw in keywords if kw and kw in joined)
    score += min(hit * 8, 15)
    if hit:
        reasons.append(f"含{hit}个关键词")

    # 性别（5）
    g = sum(5 for c in chars if c.gender == gender or c.gender == "中性")
    score += min(g, 5)

    # 风格（5）
    s = sum(2.5 for c in chars if style in c.styles)
    score += min(s, 5)
    if s >= 2.5:
        reasons.append(f"{style}风格")

    # 三才五格（15）
    if len(chars) >= 1:
        n2 = chars[1].strokes if len(chars) > 1 else 0
        wuge = calc_wuge(surname_strokes, chars[0].strokes, n2)
        detail["wuge"] = wuge
        if wuge["三才吉凶"] == "大吉":
            score += 15
            reasons.append(f"三才{wuge['三才']}大吉")
        elif wuge["三才吉凶"] == "中吉":
            score += 10
        else:
            score += 3

    # 诗词（10）
    src = POETRY_LIB.find_source([c.char for c in chars])
    if src:
        score += 10
        detail["poetry"] = src
        reasons.append(f"出自《{src['source']}》")

    # 谐音（5）
    full = surname + "".join(c.char for c in chars)
    homo = check_homophone(full)
    detail["homophone"] = homo
    if homo["pass"]:
        score += 5
    else:
        score -= 10
        reasons.append("⚠️ 谐音风险")

    return round(max(score, 0), 1), reasons, detail


# ============================================================
# 十一、生成主流程
# ============================================================

def generate_names(
    surname: str,
    surname_strokes: int = 8,
    gender: str = "中性",
    style: str = "古风",
    keywords: Optional[List[str]] = None,
    length: int = 2,
    top: int = 10,
    taboo: Optional[List[str]] = None,
    birth: Optional[Tuple[int, int, int, int]] = None,
    birth_minute: int = 0,
    longitude: Optional[float] = None,
    xiyongshen_override: Optional[List[str]] = None,
    use_llm: bool = False,
) -> Dict:
    keywords = keywords or []
    taboo = set(taboo or [])
    taboo.add(surname)

    if xiyongshen_override:
        xiyongshen = xiyongshen_override
        bazi_info = None
    elif birth:
        bazi_info = analyze_bazi(*birth, minute=birth_minute,
                                 longitude=longitude)
        xiyongshen = bazi_info["xiyongshen"]
    else:
        bazi_info = None
        xiyongshen = []

    pool = [
        c for c in CHAR_DB.values()
        if c.char not in taboo
        and (c.gender == gender or c.gender == "中性" or gender == "中性")
    ]
    if not pool:
        return {"bazi": bazi_info, "xiyongshen": xiyongshen, "names": []}

    llm = LLMExplainer() if use_llm else None
    results = []
    seen = set()

    for combo in itertools.product(pool, repeat=length):
        if len({c.char for c in combo}) < length:
            continue
        full = surname + "".join(c.char for c in combo)
        if full in seen:
            continue
        seen.add(full)

        sc, reasons, detail = score_name(
            combo, surname, surname_strokes, gender, style,
            keywords, xiyongshen,
        )

        if detail.get("homophone", {}).get("pass") is False:
            continue   # 谐音不通过直接淘汰

        item = {
            "name": full,
            "chars": [c.char for c in combo],
            "wuxing": [c.wuxing for c in combo],
            "pinyin": " ".join(c.pinyin for c in combo),
            "score": sc,
            "reasons": reasons,
            "meaning": "；".join(c.meaning for c in combo),
            "wuge": detail.get("wuge"),
            "poetry": detail.get("poetry"),
        }
        if llm:
            item["ai_explain"] = llm.explain(
                surname, "".join(item["chars"]), bazi_info,
                item.get("poetry"), item.get("wuge"),
            )
        else:
            item["ai_explain"] = LLMExplainer._fallback(
                surname, "".join(item["chars"]), bazi_info,
                item.get("poetry"), item.get("wuge"),
            )
        results.append(item)

    results.sort(key=lambda x: x["score"], reverse=True)

    return {
        "bazi": bazi_info,
        "xiyongshen": xiyongshen,
        "names": results[:top],
    }


# ============================================================
# 十二、FastAPI 接口（可选）
# ============================================================

if HAS_FASTAPI:
    app = FastAPI(title="五行八字取名系统", version="3.0")

    class NameRequest(BaseModel):
        surname: str
        surname_strokes: int = 8
        gender: str = "中性"
        style: str = "古风"
        keywords: List[str] = []
        length: int = 2
        top: int = 10
        taboo: List[str] = []
        birth_year: Optional[int] = None
        birth_month: Optional[int] = None
        birth_day: Optional[int] = None
        birth_hour: Optional[int] = None
        birth_minute: int = 0
        longitude: Optional[float] = None
        xiyongshen: Optional[List[str]] = None
        use_llm: bool = False

    @app.post("/generate")
    def api_generate(req: NameRequest):
        birth = None
        if all(v is not None for v in
               [req.birth_year, req.birth_month, req.birth_day, req.birth_hour]):
            birth = (req.birth_year, req.birth_month,
                     req.birth_day, req.birth_hour)
        return generate_names(
            surname=req.surname,
            surname_strokes=req.surname_strokes,
            gender=req.gender,
            style=req.style,
            keywords=req.keywords,
            length=req.length,
            top=req.top,
            taboo=req.taboo,
            birth=birth,
            birth_minute=req.birth_minute,
            longitude=req.longitude,
            xiyongshen_override=req.xiyongshen,
            use_llm=req.use_llm,
        )


# ============================================================
# 十三、命令行入口
# ============================================================

def _print_result(result: Dict):
    b = result.get("bazi")
    if b:
        print("=" * 60)
        print(f"八字      ：{b['bazi_str']}")
        print(f"五行统计  ：{b['count']}")
        print(f"日主      ：{b['day_wx']}    强弱：{b['strength']}")
        print(f"喜用神    ：{'、'.join(result['xiyongshen'])}")
        print(f"排盘引擎  ：{b['engine']}")
        print("=" * 60)

    for i, n in enumerate(result["names"], 1):
        print(f"\n【{i}】{n['name']}    评分 {n['score']}")
        print(f"     拼音  ：{n['pinyin']}")
        print(f"     五行  ：{' '.join(n['wuxing'])}")
        if n.get("wuge"):
            w = n["wuge"]
            print(f"     三才  ：{w['三才']}（{w['三才吉凶']}）  "
                  f"人格{w['人格']}  地格{w['地格']}  总格{w['总格']}")
        if n.get("poetry"):
            p = n["poetry"]
            print(f"     出处  ：《{p['source']}》·{p['title']}｜{p['line']}")
        print(f"     寓意  ：{n['meaning']}")
        print(f"     解释  ：{n['ai_explain']}")
        if n["reasons"]:
            print(f"     亮点  ：{' / '.join(n['reasons'])}")


def _parse_birth(s: str) -> Tuple[int, int, int, int, int]:
    """解析 'YYYY-MM-DD-HH[-MM]'"""
    parts = s.split("-")
    if len(parts) < 4:
        raise argparse.ArgumentTypeError("出生时间格式：YYYY-MM-DD-HH[-MM]")
    y, m, d, h = map(int, parts[:4])
    mi = int(parts[4]) if len(parts) > 4 else 0
    return y, m, d, h, mi


def main():
    parser = argparse.ArgumentParser(description="五行八字取名系统")
    parser.add_argument("--surname", default="李", help="姓氏")
    parser.add_argument("--surname-strokes", type=int, default=7,
                        help="姓的康熙笔画（李7，王4，张11，刘15...）")
    parser.add_argument("--gender", default="女", choices=["男", "女", "中性"])
    parser.add_argument("--style", default="古风",
                        help="风格：古风 / 大气 / 温柔 / 文雅 / 简约 / "
                             "灵动 / 自然 / 清冷")
    parser.add_argument("--keywords", default="", help="关键词，逗号分隔")
    parser.add_argument("--length", type=int, default=2, help="名字字数")
    parser.add_argument("--top", type=int, default=8, help="输出条数")
    parser.add_argument("--taboo", default="", help="避讳字，逗号分隔")
    parser.add_argument("--birth", default=None,
                        help="出生时间 YYYY-MM-DD-HH[-MM]")
    parser.add_argument("--longitude", type=float, default=None,
                        help="出生地经度（如成都 104.06）")
    parser.add_argument("--xiyongshen", default=None,
                        help="手动指定喜用神，逗号分隔，如 水,木")
    parser.add_argument("--llm", action="store_true",
                        help="启用 LLM 生成寓意解释（需 API Key）")
    parser.add_argument("--api", action="store_true", help="启动 API 服务")
    parser.add_argument("--api-host", default="127.0.0.1")
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--check", action="store_true",
                        help="只检查环境和依赖")

    args = parser.parse_args()

    # 环境检查
    if args.check:
        print("环境检查：")
        print(f"  lunar_python : {'✓' if HAS_LUNAR else '✗ (降级内置算法)'}")
        print(f"  pypinyin     : {'✓' if HAS_PYPINYIN else '✗ (谐音仅字面检测)'}")
        print(f"  httpx        : {'✓' if HAS_HTTPX else '✗ (无联网查询)'}")
        print(f"  fastapi      : {'✓' if HAS_FASTAPI else '✗ (无法启动 API)'}")
        print(f"  字库         : {len(CHAR_DB)} 字")
        print(f"  诗词库       : {len(POETRY_LIB.poems)} 首")
        return

    # API 模式
    if args.api:
        if not HAS_FASTAPI:
            print("错误：未安装 fastapi，请 pip install fastapi uvicorn")
            sys.exit(1)
        import uvicorn
        print(f"启动 API 服务：http://{args.api_host}:{args.api_port}")
        print(f"文档地址：http://{args.api_host}:{args.api_port}/docs")
        uvicorn.run(app, host=args.api_host, port=args.api_port)
        return

    # 命令行模式
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    taboo = [t.strip() for t in args.taboo.split(",") if t.strip()]
    xiyongshen = None
    if args.xiyongshen:
        xiyongshen = [x.strip() for x in args.xiyongshen.split(",") if x.strip()]

    birth = None
    if args.birth:
        try:
            y, m, d, h, mi = _parse_birth(args.birth)
            birth = (y, m, d, h)
            birth_minute = mi
        except Exception as e:
            print(f"出生时间解析失败：{e}")
            sys.exit(1)
    else:
        birth_minute = 0

    result = generate_names(
        surname=args.surname,
        surname_strokes=args.surname_strokes,
        gender=args.gender,
        style=args.style,
        keywords=keywords,
        length=args.length,
        top=args.top,
        taboo=taboo,
        birth=birth,
        birth_minute=birth_minute,
        longitude=args.longitude,
        xiyongshen_override=xiyongshen,
        use_llm=args.llm,
    )

    _print_result(result)


if __name__ == "__main__":
    main()