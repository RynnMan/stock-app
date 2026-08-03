/* ===========================================================
   个股透视 · 移动端 H5
   数据：东方财富公开行情接口（JSONP，无需后端）
   =========================================================== */

/* ---------------- 基础工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 保留搜索结果里的 <em> 高亮，其余标签全部转义
const escKeepEm = s => esc(s).replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');

const num = v => (v === '-' || v === undefined || v === null || v === '' || isNaN(v)) ? null : Number(v);

/** 金额 → 亿/万 */
function money(v, dec = 2) {
  const n = num(v); if (n === null) return '--';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(dec) + '万亿';
  if (a >= 1e8) return (n / 1e8).toFixed(dec) + '亿';
  if (a >= 1e4) return (n / 1e4).toFixed(dec) + '万';
  return n.toFixed(0);
}
/** 带正负号金额 */
const moneySign = (v, dec = 2) => { const n = num(v); if (n === null) return '--'; return (n > 0 ? '+' : '') + money(n, dec); };
const pct = (v, dec = 2) => { const n = num(v); return n === null ? '--' : n.toFixed(dec) + '%'; };
const pctSign = (v, dec = 2) => { const n = num(v); return n === null ? '--' : (n > 0 ? '+' : '') + n.toFixed(dec) + '%'; };
const cls = v => { const n = num(v); if (n === null || n === 0) return 'flat'; return n > 0 ? 'up' : 'down'; };
const fixed = (v, d = 2) => { const n = num(v); return n === null ? '--' : n.toFixed(d); };
const shortDate = s => (s || '').slice(0, 10);

function timeAgo(str) {
  if (!str) return '';
  const t = new Date(str.replace(/-/g, '/')).getTime();
  if (isNaN(t)) return str;
  const d = (Date.now() - t) / 1000;
  if (d < 3600) return Math.max(1, Math.floor(d / 60)) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  if (d < 86400 * 3) return Math.floor(d / 86400) + '天前';
  return str.slice(5, 16);
}

/* ---------------- JSONP ---------------- */
const _cache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function _once(url, cbName) {
  return new Promise((resolve, reject) => {
    const fn = 'jp_' + Math.random().toString(36).slice(2, 9);
    const s = document.createElement('script');
    let done = false;
    const clean = () => { done = true; try { delete window[fn]; } catch (e) { window[fn] = void 0; } s.remove(); };
    const timer = setTimeout(() => { if (!done) { clean(); reject(new Error('请求超时')); } }, 12000);
    window[fn] = data => { clearTimeout(timer); clean(); resolve(data); };
    s.onerror = () => { clearTimeout(timer); clean(); reject(new Error('网络异常')); };
    s.src = url + (url.includes('?') ? '&' : '?') + cbName + '=' + fn + '&_=' + Date.now();
    document.head.appendChild(s);
  });
}

/** 带缓存 + 自动重试的 JSONP */
async function jsonp(url, cbName = 'cb', ttl = 45000, retry = 2) {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.d;
  let err;
  for (let i = 0; i <= retry; i++) {
    try {
      const d = await _once(url, cbName);
      // 行情接口偶发返回空 data，视为失败以触发重试
      if (d && typeof d === 'object' && 'rc' in d && d.data === null && i < retry) throw new Error('空数据');
      _cache.set(url, { t: Date.now(), d });
      return d;
    } catch (e) { err = e; if (i < retry) await sleep(500 + i * 700); }
  }
  throw err;
}

/** 加载普通 JS 脚本（用于腾讯行情备用源，返回全局变量） */
function loadScript(url, charset) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    if (charset) s.charset = charset;
    const t = setTimeout(() => { s.remove(); reject(new Error('超时')); }, 10000);
    s.onload = () => { clearTimeout(t); s.remove(); resolve(); };
    s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('加载失败')); };
    s.src = url;
    document.head.appendChild(s);
  });
}

/** 备用行情源：腾讯 qt.gtimg.cn（东财限流时降级使用） */
async function tencentQuote(secid) {
  const [mkt, code] = String(secid).split('.');
  let sym = mkt === '1' ? 'sh' + code : mkt === '0' ? 'sz' + code : mkt === '116' ? 'hk' + code : mkt === '105' || mkt === '106' || mkt === '107' ? 'us' + code : null;
  if (!sym) throw new Error('该市场暂无备用行情');
  await loadScript(`https://qt.gtimg.cn/q=${sym}&_=${Date.now()}`, 'gbk');
  const raw = window['v_' + sym];
  if (!raw) throw new Error('备用行情为空');
  const a = raw.split('~');
  const n = i => { const v = parseFloat(a[i]); return isNaN(v) ? null : v; };
  const x100 = i => { const v = n(i); return v === null ? null : Math.round(v * 100); };
  return {
    f57: a[2], f58: a[1], f59: 2,
    f43: x100(3), f60: x100(4), f46: x100(5), f44: x100(33), f45: x100(34),
    f47: n(6), f48: (n(37) || 0) * 1e4,
    f169: x100(31), f170: x100(32), f171: x100(43), f168: x100(38), f50: x100(49),
    f116: (n(45) || 0) * 1e8, f117: (n(44) || 0) * 1e8,
    f162: x100(39), f167: x100(46),
    f84: n(3) ? (n(45) || 0) * 1e8 / n(3) : null,   // 总股本 ≈ 总市值 / 股价
    f85: n(3) ? (n(44) || 0) * 1e8 / n(3) : null,   // 流通股本
    _src: '腾讯行情'
  };
}

const EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/* ---------------- 接口层 ---------------- */
const API = {
  // 搜索建议
  suggest: kw => jsonp(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=${EM_TOKEN}&count=12`, 'cb', 60000),

  // 实时行情（不可混入字符串字段 f127，否则接口返回空）
  quote: secid => jsonp(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f59,f60,f84,f85,f92,f116,f117,f162,f167,f168,f169,f170,f171,f183,f184,f185,f186,f187,f188,f189`, 'cb', 20000),

  // 所属行业
  industry: secid => jsonp(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f127`, 'cb', 600000),

  // 日K线
  kline: (secid, lmt = 90) => jsonp(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=${lmt}&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`, 'cb', 60000),

  // 当日主力资金
  flowToday: secid => jsonp(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secid}&fields=f12,f14,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`, 'cb', 20000),

  // 历史资金流（日）
  flowHistory: secid => jsonp(`https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`, 'cb', 60000),

  // 公司基本信息（行业 / 主营 / 上市日期）
  orgInfo: secucode => jsonp(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECUCODE,SECURITY_NAME_ABBR,INDUSTRYCSRC1,EM2016,LISTING_DATE,ORG_PROFILE,MAIN_BUSINESS&filter=(SECUCODE%3D%22${secucode}%22)&pageNumber=1&pageSize=1&source=HSF10&client=PC`, 'callback', 3600000),

  // 主要财务指标
  finance: secucode => jsonp(`${DC}?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=SECUCODE,REPORT_DATE,REPORT_TYPE,EPSJB,BPS,MGJYXJJE,TOTALOPERATEREVE,PARENTNETPROFIT,KCFJCXSYJLR,TOTALOPERATEREVETZ,PARENTNETPROFITTZ,KCFJCXSYJLRTZ,ROEJQ,XSMLL,XSJLL,ZCFZL&filter=(SECUCODE%3D%22${secucode}%22)&pageNumber=1&pageSize=12&sortTypes=-1&sortColumns=REPORT_DATE&source=HSF10&client=PC`, 'callback', 600000),

  // 十大流通股东
  holders: secucode => jsonp(`${DC}?reportName=RPT_F10_EH_FREEHOLDERS&columns=SECUCODE,END_DATE,HOLDER_RANK,HOLDER_NAME,HOLD_NUM,FREE_HOLDNUM_RATIO,HOLD_NUM_CHANGE,CHANGE_RATIO&filter=(SECUCODE%3D%22${secucode}%22)&pageNumber=1&pageSize=10&sortTypes=-1,1&sortColumns=END_DATE,HOLDER_RANK&source=HSF10&client=PC`, 'callback', 600000),

  // 股东户数
  holderNum: code => jsonp(`${DC}?reportName=RPT_HOLDERNUMLATEST&columns=SECURITY_CODE,END_DATE,HOLDER_NUM,HOLDER_NUM_CHANGE,HOLDER_NUM_RATIO,AVG_MARKET_CAP,AVG_HOLD_NUM&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=END_DATE&source=WEB&client=WEB`, 'callback', 600000),

  // 机构持仓明细（基金/QFII/社保等）
  orgHold: (code, date) => {
    let f = `(SECURITY_CODE%3D%22${code}%22)`;
    if (date) f += `(REPORT_DATE%3D%27${date}%27)`;
    return jsonp(`${DC}?reportName=RPT_MAIN_ORGHOLDDETAIL&columns=SECURITY_CODE,REPORT_DATE,REPORT_DATE_NAME,HOLDER_NAME,F9_ORGTYPE_NAME,TOTAL_SHARES,HOLD_VALUE,FREESHARES_RATIO,TOTALSHARES_RATIO,ORG_NAME&filter=${f}&pageNumber=1&pageSize=12&sortTypes=-1,-1&sortColumns=REPORT_DATE,HOLD_VALUE&source=WEB&client=WEB`, 'callback', 600000);
  },

  // 资讯搜索
  news: (kw, size = 20) => {
    const p = {
      uid: '', keyword: kw, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
      param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: size, preTag: '<em>', postTag: '</em>' } }
    };
    return jsonp('https://search-api-web.eastmoney.com/search/jsonp?param=' + encodeURIComponent(JSON.stringify(p)), 'cb', 180000);
  }
};

/* ---------------- 利好 / 利空 关键词词典 ---------------- */
const GOOD = [
  ['涨停', 3], ['大涨', 2], ['新高', 3], ['创新高', 3], ['业绩预增', 4], ['预增', 3], ['净利增长', 3],
  ['业绩增长', 3], ['超预期', 3], ['扭亏', 3], ['扭亏为盈', 4], ['增持', 3], ['回购', 3], ['股份回购', 3],
  ['中标', 3], ['签约', 2], ['签订', 2], ['大额订单', 3], ['订单', 1], ['获批', 3], ['批准', 2], ['通过审核', 3],
  ['获得专利', 2], ['专利', 1], ['扩产', 2], ['投产', 2], ['量产', 2], ['产能释放', 3], ['提价', 3], ['涨价', 3],
  ['合作', 1], ['战略合作', 2], ['分红', 2], ['派息', 2], ['高送转', 3], ['送转', 2], ['重组', 2], ['资产注入', 3],
  ['并购', 2], ['补贴', 2], ['减税', 2], ['政策支持', 3], ['利好', 4], ['买入评级', 3], ['增持评级', 3],
  ['上调评级', 3], ['上调目标价', 3], ['看好', 2], ['推荐', 1], ['龙头', 1], ['纳入', 2], ['入选', 2],
  ['净流入', 2], ['主力增仓', 3], ['机构加仓', 3], ['社保基金', 1], ['北向资金买入', 3], ['业绩超', 3],
  ['首次覆盖', 1], ['突破', 2], ['放量上涨', 3], ['涨超', 2], ['领涨', 2], ['中签', 1], ['解禁减少', 1],
  ['需求旺盛', 3], ['供不应求', 3], ['景气', 2], ['复苏', 2], ['回暖', 2], ['增产', 1], ['降本', 2]
];
const BAD = [
  ['跌停', 3], ['大跌', 2], ['暴跌', 3], ['新低', 3], ['创新低', 3], ['业绩预减', 4], ['预减', 3], ['预亏', 4],
  ['亏损', 3], ['净利下滑', 3], ['业绩下滑', 3], ['下滑', 2], ['下降', 1], ['不及预期', 3], ['低于预期', 3],
  ['减持', 4], ['清仓式减持', 5], ['质押', 2], ['股权质押', 2], ['冻结', 3], ['诉讼', 3], ['仲裁', 2],
  ['处罚', 4], ['罚款', 3], ['警示函', 3], ['监管', 1], ['问询函', 3], ['立案', 4], ['调查', 3], ['违规', 3],
  ['退市', 5], ['ST', 3], ['风险警示', 4], ['商誉减值', 4], ['计提减值', 3], ['减值', 2], ['破发', 2],
  ['解禁', 2], ['限售股解禁', 3], ['抛售', 3], ['净流出', 2], ['主力减仓', 3], ['机构减仓', 3],
  ['下调评级', 3], ['下调目标价', 3], ['卖出评级', 3], ['终止', 3], ['失败', 3], ['中止', 2], ['取消', 2],
  ['辞职', 1], ['离职', 1], ['被查', 4], ['停产', 3], ['召回', 3], ['事故', 3], ['跌超', 2], ['领跌', 2],
  ['需求疲软', 3], ['产能过剩', 3], ['价格战', 2], ['降价', 2], ['库存高企', 2], ['裁员', 2], ['爆雷', 4],
  ['违约', 4], ['逾期', 3], ['退货', 2], ['流拍', 2]
];
// 干扰词：命中后中和，避免"利空出尽""跌停打开"类误判
const NEUTRALIZE = ['利空出尽', '跌停打开', '止跌', '超跌反弹'];

function analyze(title, content) {
  const T = String(title || ''), C = String(content || '');
  const clean = s => s.replace(/<\/?em>/g, '');
  const t = clean(T), c = clean(C).slice(0, 160);
  let score = 0; const hit = [];
  const scan = (list, sign) => list.forEach(([w, s]) => {
    let got = 0;
    if (t.includes(w)) { got += s * 2; }
    if (c.includes(w)) { got += s; }
    if (got) { score += sign * got; hit.push(w); }
  });
  scan(GOOD, 1); scan(BAD, -1);
  NEUTRALIZE.forEach(w => { if (t.includes(w) || c.includes(w)) score = Math.round(score * 0.3); });
  const type = score >= 3 ? 'good' : score <= -3 ? 'bad' : 'neutral';
  return { type, score, kws: hit.slice(0, 3) };
}

/* ---------------- SVG 图表 ---------------- */
const CU = '#e03131', CD = '#12a05c', CB = '#2b5cd9', CG = '#c9cdd6', CT = '#8a909e';

/** 涨跌柱状图（正红负绿） */
function barChart(items, { h = 150, unit = '亿', dec = 2 } = {}) {
  if (!items.length) return '<div class="loading">暂无数据</div>';
  const W = 320, PL = 6, PR = 6, PT = 14, PB = 18;
  const iw = W - PL - PR, ih = h - PT - PB;
  const vals = items.map(d => d.v);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const range = (max - min) || 1;
  const zeroY = PT + (max / range) * ih;
  const bw = Math.max(2, iw / items.length * .62);
  const step = iw / items.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet">`;
  s += `<line x1="${PL}" y1="${zeroY.toFixed(1)}" x2="${W - PR}" y2="${zeroY.toFixed(1)}" stroke="${CG}" stroke-width="1"/>`;
  items.forEach((d, i) => {
    const x = PL + step * i + (step - bw) / 2;
    const bh = Math.abs(d.v) / range * ih;
    const y = d.v >= 0 ? zeroY - bh : zeroY;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, .8).toFixed(1)}" rx="1" fill="${d.v >= 0 ? CU : CD}" opacity=".9"/>`;
  });
  const showIdx = [0, Math.floor(items.length / 2), items.length - 1];
  showIdx.forEach(i => {
    if (!items[i]) return;
    const x = PL + step * i + step / 2;
    s += `<text x="${x.toFixed(1)}" y="${h - 5}" font-size="9.5" fill="${CT}" text-anchor="${i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle'}">${esc(items[i].l)}</text>`;
  });
  s += `<text x="${PL}" y="10" font-size="9.5" fill="${CT}">最高 ${(max / 1e8).toFixed(dec)}${unit}</text>`;
  s += `<text x="${W - PR}" y="10" font-size="9.5" fill="${CT}" text-anchor="end">最低 ${(min / 1e8).toFixed(dec)}${unit}</text>`;
  return s + '</svg>';
}

/** 价格折线图 */
function lineChart(pts) {
  if (pts.length < 2) return '<div class="loading">暂无数据</div>';
  const W = 320, H = 150, PL = 4, PR = 38, PT = 12, PB = 18;
  const iw = W - PL - PR, ih = H - PT - PB;
  const vs = pts.map(p => p.v);
  let max = Math.max(...vs), min = Math.min(...vs);
  const pad = (max - min) * .12 || max * .02 || 1; max += pad; min -= pad;
  const rng = max - min;
  const X = i => PL + iw * i / (pts.length - 1);
  const Y = v => PT + ih * (1 - (v - min) / rng);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = line + `L${X(pts.length - 1).toFixed(1)},${(PT + ih).toFixed(1)}L${PL},${(PT + ih).toFixed(1)}Z`;
  const rise = pts[pts.length - 1].v >= pts[0].v;
  const col = rise ? CU : CD;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${col}" stop-opacity=".22"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/>
  </linearGradient></defs>`;
  [0, .5, 1].forEach(r => {
    const y = PT + ih * r;
    s += `<line x1="${PL}" y1="${y}" x2="${PL + iw}" y2="${y}" stroke="${CG}" stroke-width=".6" stroke-dasharray="3 3"/>`;
    s += `<text x="${PL + iw + 4}" y="${y + 3.5}" font-size="9.5" fill="${CT}">${(max - rng * r).toFixed(2)}</text>`;
  });
  s += `<path d="${area}" fill="url(#lg)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.7" stroke-linejoin="round"/>`;
  s += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(pts[pts.length - 1].v).toFixed(1)}" r="2.8" fill="${col}"/>`;
  s += `<text x="${PL}" y="${H - 5}" font-size="9.5" fill="${CT}">${esc(pts[0].l)}</text>`;
  s += `<text x="${PL + iw}" y="${H - 5}" font-size="9.5" fill="${CT}" text-anchor="end">${esc(pts[pts.length - 1].l)}</text>`;
  return s + '</svg>';
}

/** 双柱：营收 / 净利 */
function groupBar(rows) {
  if (!rows.length) return '<div class="loading">暂无数据</div>';
  const W = 320, H = 160, PL = 6, PR = 6, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const max = Math.max(...rows.map(r => Math.max(r.a, r.b)), 0);
  const min = Math.min(...rows.map(r => Math.min(r.a, r.b)), 0);
  const rng = (max - min) || 1;
  const zeroY = PT + (max / rng) * ih;
  const step = iw / rows.length, bw = Math.min(13, step * .3);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  s += `<line x1="${PL}" y1="${zeroY.toFixed(1)}" x2="${W - PR}" y2="${zeroY.toFixed(1)}" stroke="${CG}" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const cx = PL + step * i + step / 2;
    [[r.a, CB, -1], [r.b, '#f59f00', 1]].forEach(([v, c, dir]) => {
      const bh = Math.abs(v) / rng * ih;
      const y = v >= 0 ? zeroY - bh : zeroY;
      const x = dir < 0 ? cx - bw - 1.5 : cx + 1.5;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, .8).toFixed(1)}" rx="1.5" fill="${c}" opacity=".88"/>`;
    });
    s += `<text x="${cx.toFixed(1)}" y="${H - 13}" font-size="9" fill="${CT}" text-anchor="middle">${esc(r.l)}</text>`;
    if (r.g != null) s += `<text x="${cx.toFixed(1)}" y="${H - 3}" font-size="8.5" fill="${r.g >= 0 ? CU : CD}" text-anchor="middle">${r.g >= 0 ? '+' : ''}${r.g.toFixed(0)}%</text>`;
  });
  return s + '</svg>';
}

/** 评分环 */
function ring(score) {
  const R = 38, C = 2 * Math.PI * R;
  const col = score >= 75 ? CU : score >= 60 ? '#f59f00' : score >= 45 ? CB : CD;
  const off = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<div class="score-ring">
    <svg viewBox="0 0 88 88" style="width:88px;height:88px">
      <circle cx="44" cy="44" r="${R}" fill="none" stroke="#eef0f3" stroke-width="7"/>
      <circle cx="44" cy="44" r="${R}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 44 44)"/>
    </svg>
    <div class="num"><b style="color:${col}">${score}</b><i>综合评分</i></div>
  </div>`;
}

/* ---------------- 状态 ---------------- */
const state = {
  stock: null,          // {code,name,secid,secucode,market}
  industry: '',
  newsTab: 'stock',
  newsCache: {},
  timer: null,
  activeTab: 'basic',
  basic: null,          // 基本面汇总（供诊股）
  flow: null            // 资金流汇总（供诊股）
};
const LS = {
  get last() { try { return JSON.parse(localStorage.getItem('gp_last') || 'null'); } catch (e) { return null; } },
  set last(v) { localStorage.setItem('gp_last', JSON.stringify(v)); },
  get favs() { try { return JSON.parse(localStorage.getItem('gp_favs') || '[]'); } catch (e) { return []; } },
  set favs(v) { localStorage.setItem('gp_favs', JSON.stringify(v)); },
  get llmKey() { return localStorage.getItem('gp_llm_key') || ''; },
  set llmKey(v) { v ? localStorage.setItem('gp_llm_key', v) : localStorage.removeItem('gp_llm_key'); },
  get llmProvider() { return localStorage.getItem('gp_llm_provider') || 'deepseek'; },
  set llmProvider(v) { localStorage.setItem('gp_llm_provider', v); }
};

/* ---------------- 搜索 ---------------- */
const input = $('#searchInput'), sugBox = $('#suggestBox'), clearBtn = $('#clearBtn');
let sugTimer = null;

input.addEventListener('input', () => {
  const v = input.value.trim();
  clearBtn.hidden = !v;
  clearTimeout(sugTimer);
  if (!v) { sugBox.hidden = true; return; }
  sugTimer = setTimeout(() => doSuggest(v), 260);
});
clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; sugBox.hidden = true; input.focus(); });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const first = sugBox.querySelector('.sug-item'); if (first) first.click(); input.blur(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.topbar')) sugBox.hidden = true; });

async function doSuggest(kw) {
  sugBox.hidden = false;
  sugBox.innerHTML = '<div class="sug-empty">搜索中…</div>';
  try {
    const r = await API.suggest(kw);
    const list = (r?.QuotationCodeTable?.Data || []).filter(d => /AStock|HKStock|USStock|Index/i.test(d.Classify || ''));
    if (!list.length) { sugBox.innerHTML = '<div class="sug-empty">没有找到相关证券</div>'; return; }
    sugBox.innerHTML = list.slice(0, 10).map(d => `
      <div class="sug-item" data-q="${esc(d.QuoteID)}" data-c="${esc(d.Code)}" data-n="${esc(d.Name)}" data-m="${esc(d.SecurityTypeName || '')}">
        <div><div class="sug-name">${esc(d.Name)}</div><div class="sug-code">${esc(d.Code)}</div></div>
        <span class="sug-mkt">${esc(d.SecurityTypeName || '')}</span>
      </div>`).join('');
    $$('.sug-item', sugBox).forEach(el => el.addEventListener('click', () => {
      sugBox.hidden = true; input.value = ''; clearBtn.hidden = true;
      load({ secid: el.dataset.q, code: el.dataset.c, name: el.dataset.n, market: el.dataset.m });
    }));
  } catch (e) {
    sugBox.innerHTML = '<div class="sug-empty">搜索失败，请重试</div>';
  }
}

/* ---------------- 自选 ---------------- */
const favPanel = $('#favPanel');
$('#favBtn').addEventListener('click', openFav);
$('#favClose').addEventListener('click', () => favPanel.hidden = true);
favPanel.addEventListener('click', e => { if (e.target === favPanel) favPanel.hidden = true; });

function isFav(code) { return LS.favs.some(f => f.code === code); }
function toggleFav() {
  if (!state.stock) return;
  const favs = LS.favs, i = favs.findIndex(f => f.code === state.stock.code);
  if (i >= 0) favs.splice(i, 1); else favs.unshift({ ...state.stock });
  LS.favs = favs;
  const st = $('.q-star'); if (st) st.classList.toggle('on', isFav(state.stock.code));
}
async function openFav() {
  favPanel.hidden = false;
  const favs = LS.favs;
  const box = $('#favList');
  if (!favs.length) { box.innerHTML = '<div class="fav-empty">暂无自选，点击行情卡右上角 ★ 添加</div>'; return; }
  box.innerHTML = favs.map(f => `<div class="fav-row" data-code="${esc(f.code)}">
      <span class="n">${esc(f.name)}</span><span class="c">${esc(f.code)}</span>
      <span class="p" data-p>--</span><button class="x" data-del>&times;</button></div>`).join('');
  $$('.fav-row', box).forEach(row => {
    const f = favs.find(x => x.code === row.dataset.code);
    row.addEventListener('click', e => {
      if (e.target.hasAttribute('data-del')) {
        LS.favs = LS.favs.filter(x => x.code !== f.code); openFav();
        if (state.stock?.code === f.code) $('.q-star')?.classList.remove('on');
        return;
      }
      favPanel.hidden = true; load(f);
    });
    API.quote(f.secid).then(r => {
      const d = r?.data; if (!d) return;
      const dg = Math.pow(10, d.f59 ?? 2);
      const p = d.f43 / dg, chg = d.f170 / 100;
      const el = row.querySelector('[data-p]');
      el.textContent = `${p.toFixed(2)}  ${chg > 0 ? '+' : ''}${chg.toFixed(2)}%`;
      el.className = 'p ' + cls(chg);
    }).catch(() => { });
  });
}

/* ---------------- 主加载 ---------------- */
async function load(stock) {
  state.stock = { ...stock, secucode: buildSecucode(stock) };
  LS.last = state.stock;
  state.newsCache = {};
  state.basic = null;
  state.flow = null;
  clearInterval(state.timer);

  renderQuoteLoading();
  ['basic', 'flow', 'hold', 'news'].forEach(k => { $('#pane-' + k).innerHTML = '<div class="card"><div class="loading">加载中…</div></div>'; });

  // 错峰发起，避免瞬时并发被行情网关限流
  loadQuote();
  sleep(250).then(loadFlow);
  sleep(600).then(loadBasic);
  sleep(1000).then(loadHold);
  sleep(1400).then(loadIndustryThenNews);

  state.timer = setInterval(() => { if (!document.hidden) { loadQuote(true); loadFlow(true); } }, 30000);
}

function buildSecucode(s) {
  const suf = s.secid?.startsWith('1.') ? 'SH' : s.secid?.startsWith('0.') ? 'SZ' : s.secid?.startsWith('116.') ? 'HK' : 'SH';
  return `${s.code}.${suf}`;
}
const isA = () => /^(0|1)\./.test(state.stock?.secid || '');

function renderQuoteLoading() {
  $('#quoteCard').innerHTML = `<div class="q-head"><span class="q-name">${esc(state.stock.name)}</span>
    <span class="q-code">${esc(state.stock.code)}</span></div><div class="skeleton-quote">行情加载中…</div>`;
}

/* ---------- 行情数据（东财优先，腾讯兜底） ---------- */
async function getQuoteData() {
  try {
    const r = await API.quote(state.stock.secid);
    if (r?.data) return r.data;
    throw new Error('空数据');
  } catch (e) {
    return await tencentQuote(state.stock.secid);
  }
}

/* ---------- 行情头卡 ---------- */
async function loadQuote(silent) {
  try {
    const d = await getQuoteData(); if (!d) throw new Error('无数据');
    state.quote = d;
    const dg = Math.pow(10, d.f59 ?? 2);
    const price = d.f43 / dg, prev = d.f60 / dg;
    const chgAmt = d.f169 / dg, chgPct = d.f170 / 100;
    const c = cls(chgPct);
    $('#quoteCard').innerHTML = `
      <div class="q-head">
        <span class="q-name">${esc(d.f58 || state.stock.name)}</span>
        <span class="q-code">${esc(d.f57 || state.stock.code)}</span>
        <span class="q-tag" id="indTag" ${state.industry ? '' : 'hidden'}>${esc(state.industry)}</span>
        ${state.stock.market ? `<span class="q-tag gray">${esc(state.stock.market)}</span>` : ''}
        <button class="q-star ${isFav(state.stock.code) ? 'on' : ''}" id="starBtn">
          <svg viewBox="0 0 24 24"><path d="M12 17.27l5.18 3.13-1.37-5.89 4.57-3.96-6.02-.52L12 4.5 9.64 10.03l-6.02.52 4.57 3.96-1.37 5.89z"/></svg>
        </button>
      </div>
      <div class="q-price-row">
        <div class="q-price ${c}">${price ? price.toFixed(2) : '--'}</div>
        <div class="q-chg ${c}"><span>${chgAmt > 0 ? '+' : ''}${chgAmt.toFixed(2)}</span><span>${chgPct > 0 ? '+' : ''}${chgPct.toFixed(2)}%</span></div>
        <div class="q-status">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新<br>${d._src ? d._src + '(备用源)' : '每30秒自动刷新'}</div>
      </div>
      <div class="q-grid">
        <div>今开<b class="${cls(d.f46 / dg - prev)}">${(d.f46 / dg).toFixed(2)}</b></div>
        <div>最高<b class="${cls(d.f44 / dg - prev)}">${(d.f44 / dg).toFixed(2)}</b></div>
        <div>最低<b class="${cls(d.f45 / dg - prev)}">${(d.f45 / dg).toFixed(2)}</b></div>
        <div>昨收<b>${prev.toFixed(2)}</b></div>
        <div>成交额<b>${money(d.f48)}</b></div>
        <div>换手率<b>${(d.f168 / 100).toFixed(2)}%</b></div>
        <div>振幅<b>${(d.f171 / 100).toFixed(2)}%</b></div>
        <div>量比<b>${(d.f50 / 100).toFixed(2)}</b></div>
        <div>总市值<b>${money(d.f116)}</b></div>
      </div>`;
    $('#starBtn').addEventListener('click', toggleFav);
    $('#updateTime').textContent = '最后更新 ' + new Date().toLocaleString('zh-CN', { hour12: false });
    if (state.activeTab === 'diag') refreshDiagPrompt();
  } catch (e) {
    if (!silent) $('#quoteCard').innerHTML = `<div class="errbox">行情加载失败<button onclick="loadQuote()">重试</button></div>`;
  }
}
window.loadQuote = loadQuote;

/* ---------- 行业 → 新闻 ---------- */
async function loadIndustryThenNews() {
  const clean = s => String(s || '').replace(/[ⅠⅡⅢⅣⅤ]/g, '').trim();
  try {
    const r = await API.industry(state.stock.secid);
    state.industry = clean(r?.data?.f127);
  } catch (e) { state.industry = ''; }
  if (!state.industry && isA()) {          // 兜底：从公司基本信息取东财行业
    try {
      const o = await API.orgInfo(state.stock.secucode);
      const em = o?.result?.data?.[0]?.EM2016 || '';
      state.industry = clean(em.split('-').pop());
    } catch (e) { }
  }
  if (state.industry) { const el = $('#indTag'); if (el) { el.textContent = state.industry; el.hidden = false; } }
  loadNews();
}

/* ---------- 基本面 ---------- */
async function loadBasic() {
  const box = $('#pane-basic');
  try {
    const [q, fin, kl, oi] = await Promise.allSettled([
      getQuoteData(),
      isA() ? API.finance(state.stock.secucode) : Promise.resolve(null),
      API.kline(state.stock.secid, 90),
      isA() ? API.orgInfo(state.stock.secucode) : Promise.resolve(null)
    ]);
    const d = q.status === 'fulfilled' ? q.value : null;
    const rows = fin.status === 'fulfilled' ? (fin.value?.result?.data || []) : [];
    const klines = kl.status === 'fulfilled' ? (kl.value?.data?.klines || []) : [];
    const org = oi.status === 'fulfilled' ? (oi.value?.result?.data?.[0] || null) : null;
    if (!d) throw new Error('无行情数据');

    const dg = Math.pow(10, d.f59 ?? 2);
    const pe = d.f162 / 100, pb = d.f167 / 100;
    const mcap = d.f116;

    // TTM 归母净利
    const ttm = calcTTM(rows);
    const peTTM = ttm && ttm > 0 ? mcap / ttm : null;
    const latest = rows[0] || {};
    // 财报数据优先，行情字段兜底（行情降级时仍保证指标完整）
    const F = {
      roe: latest.ROEJQ, gross: latest.XSMLL ?? d.f186, net: latest.XSJLL ?? d.f187,
      debt: latest.ZCFZL ?? d.f188, rev: latest.TOTALOPERATEREVE ?? d.f183,
      revG: latest.TOTALOPERATEREVETZ ?? d.f184, npG: latest.PARENTNETPROFITTZ ?? d.f185,
      bps: latest.BPS ?? d.f92, eps: latest.EPSJB, ocf: latest.MGJYXJJE
    };
    const sc = scoreOf({ pe, peTTM, pb, roe: F.roe, netMargin: F.net, grossMargin: F.gross, debt: F.debt, revG: F.revG, npG: F.npG });

    let html = '';

    /* 综合评分 */
    html += `<div class="card"><div class="card-h"><h3>基本面速评</h3><span class="hint">规则化打分</span></div>
      <div class="card-b"><div class="score-top">${ring(sc.total)}
        <div class="score-bars">
          ${sc.parts.map(p => `<div class="sb"><span class="lb">${p.name}</span>
            <span class="tr"><i class="fi" style="width:${(p.v / p.max * 100).toFixed(0)}%;background:${p.v / p.max >= .7 ? CU : p.v / p.max >= .4 ? '#f59f00' : CD}"></i></span>
            <span class="vv">${p.v}/${p.max}</span></div>`).join('')}
        </div></div>
        <div class="score-note">评级 <b>${sc.grade}</b> · ${esc(sc.comment)}</div>
      </div></div>`;

    /* 估值 */
    html += `<div class="card"><div class="card-h"><h3>估值与市值</h3></div><div class="card-b">
      <div class="kv c3">
        ${kvItem('市盈率TTM', peTTM ? peTTM.toFixed(2) : '--')}
        ${kvItem('市盈率(动)', pe > 0 ? pe.toFixed(2) : (pe ? '亏损' : '--'))}
        ${kvItem('市净率', pb ? pb.toFixed(2) : '--')}
        ${kvItem('总市值', money(d.f116))}
        ${kvItem('流通市值', money(d.f117))}
        ${kvItem('每股净资产', fixed(F.bps))}
        ${kvItem('总股本', money(d.f84, 2).replace('亿', '亿股').replace('万', '万股'))}
        ${kvItem('流通股本', money(d.f85, 2).replace('亿', '亿股').replace('万', '万股'))}
        ${kvItem('上市日期', d.f189 ? String(d.f189).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : (org?.LISTING_DATE ? shortDate(org.LISTING_DATE) : '--'))}
      </div></div></div>`;

    /* 盈利能力 */
    html += `<div class="card"><div class="card-h"><h3>盈利与成长</h3>
      <span class="hint">${latest.REPORT_DATE ? shortDate(latest.REPORT_DATE) + ' ' + (latest.REPORT_TYPE || '') : '最新报告期'}</span></div>
      <div class="card-b"><div class="kv c3">
        ${kvItem('净资产收益率', pct(F.roe))}
        ${kvItem('销售毛利率', pct(F.gross))}
        ${kvItem('销售净利率', pct(F.net))}
        ${kvItem('营业收入', money(F.rev))}
        ${kvItem('营收同比', pctSign(F.revG), cls(F.revG))}
        ${kvItem('净利同比', pctSign(F.npG), cls(F.npG))}
        ${kvItem('资产负债率', pct(F.debt))}
        ${kvItem('每股收益', F.eps != null ? fixed(F.eps) + '元' : '--')}
        ${kvItem('每股经营现金', F.ocf != null ? fixed(F.ocf) + '元' : '--')}
      </div></div></div>`;

    /* 财报趋势 */
    if (rows.length > 1) {
      const useRows = rows.slice(0, 8).reverse();
      const chart = groupBar(useRows.map(r => ({
        l: shortDate(r.REPORT_DATE).slice(2, 7).replace('-', '/'),
        a: (r.TOTALOPERATEREVE || 0) / 1e8,
        b: (r.PARENTNETPROFIT || 0) / 1e8,
        g: r.PARENTNETPROFITTZ != null ? Number(r.PARENTNETPROFITTZ) : null
      })));
      html += `<div class="card"><div class="card-h"><h3>历年财报趋势</h3><span class="hint">单位：亿元</span></div>
        <div class="card-b">${chart}
        <div class="legend"><span><i style="background:${CB}"></i>营业收入</span><span><i style="background:#f59f00"></i>归母净利润</span><span>底部为净利同比</span></div>
        </div></div>`;
    }

    /* 公司概况 */
    if (org) {
      const main = (org.MAIN_BUSINESS || '').trim();
      const profile = (org.ORG_PROFILE || '').replace(/\s+/g, ' ').trim();
      html += `<div class="card"><div class="card-h"><h3>公司概况</h3>
        <span class="hint">${esc((org.EM2016 || '').split('-').slice(0, 2).join(' · '))}</span></div>
        <div class="card-b">
          <div class="kv"><div class="item" style="grid-column:1/-1"><div class="k">证监会行业</div><div class="v" style="font-size:13.5px">${esc(org.INDUSTRYCSRC1 || '--')}</div></div></div>
          ${main ? `<div class="score-note" style="border-top:0;padding-top:8px"><b>主营业务：</b>${esc(main)}</div>` : ''}
          ${profile ? `<div class="score-note"><b>公司简介：</b><span id="pf">${esc(profile.slice(0, 110))}${profile.length > 110 ? '…' : ''}</span>
            ${profile.length > 110 ? `<button id="pfMore" style="color:${CB}">展开</button>` : ''}</div>` : ''}
        </div></div>`;
      setTimeout(() => {
        const b = $('#pfMore'); if (!b) return;
        let open = false;
        b.addEventListener('click', () => { open = !open; $('#pf').textContent = open ? profile : profile.slice(0, 110) + '…'; b.textContent = open ? '收起' : '展开'; });
      }, 0);
    }

    /* 价格走势 */
    if (klines.length > 2) {
      const pts = klines.map(k => { const a = k.split(','); return { l: a[0].slice(5), v: Number(a[2]) }; });
      const first = pts[0].v, last = pts[pts.length - 1].v;
      const chg = (last - first) / first * 100;
      html += `<div class="card"><div class="card-h"><h3>近${pts.length}日走势</h3>
        <span class="hint ${cls(chg)}">区间 ${pctSign(chg)}</span></div>
        <div class="card-b">${lineChart(pts)}</div></div>`;
    }

    state.basic = { pe, peTTM, pb, mcap: d.f116, sc, F, name: state.stock.name, code: state.stock.code };
    box.innerHTML = html;
    if (state.activeTab === 'diag') refreshDiagPrompt();
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="errbox">基本面加载失败：${esc(e.message)}<button onclick="loadBasic()">重试</button></div></div>`;
  }
}
window.loadBasic = loadBasic;

function kvItem(k, v, c = '') { return `<div class="item"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`; }

/** TTM 归母净利：最新累计 + 上年年报 - 上年同期 */
function calcTTM(rows) {
  if (!rows.length) return null;
  const r0 = rows[0];
  const np = x => x?.PARENTNETPROFIT != null ? Number(x.PARENTNETPROFIT) : null;
  const d0 = new Date(String(r0.REPORT_DATE).replace(/-/g, '/'));
  if (d0.getMonth() === 11) return np(r0);           // 年报
  const y = d0.getFullYear(), m = d0.getMonth();
  const find = (yy, mm) => rows.find(r => {
    const dd = new Date(String(r.REPORT_DATE).replace(/-/g, '/'));
    return dd.getFullYear() === yy && dd.getMonth() === mm;
  });
  const lastAnnual = np(find(y - 1, 11)), samePeriod = np(find(y - 1, m)), cur = np(r0);
  if (cur == null || lastAnnual == null || samePeriod == null) return null;
  return cur + lastAnnual - samePeriod;
}

/** 基本面规则评分 */
function scoreOf({ pe, peTTM, pb, roe, netMargin, grossMargin, debt, revG, npG }) {
  const seg = (v, arr) => { if (v == null || isNaN(v)) return arr[arr.length - 1][1] * 0.5; for (const [th, s] of arr) if (v >= th) return s; return 0; };
  // 成长 25
  let g = 0;
  g += seg(num(revG), [[30, 13], [15, 11], [8, 8], [3, 6], [0, 4], [-10, 2]]);
  g += seg(num(npG), [[30, 12], [15, 10], [8, 8], [3, 6], [0, 4], [-10, 2]]);
  // 盈利 30
  let p = 0;
  p += seg(num(roe), [[20, 13], [15, 11], [10, 9], [6, 6], [3, 4], [0, 2]]);
  p += seg(num(netMargin), [[25, 10], [15, 8], [8, 6], [4, 4], [0, 2]]);
  p += seg(num(grossMargin), [[50, 7], [35, 6], [25, 4], [15, 3], [0, 2]]);
  // 估值 25（越低越好）
  const usePE = peTTM || (pe > 0 ? pe : null);
  let v = 0;
  if (usePE == null || usePE <= 0) v += 3;
  else v += usePE < 10 ? 15 : usePE < 15 ? 13 : usePE < 25 ? 11 : usePE < 40 ? 8 : usePE < 60 ? 5 : 3;
  const pbv = num(pb);
  if (pbv == null || pbv <= 0) v += 3;
  else v += pbv < 1 ? 10 : pbv < 2 ? 9 : pbv < 3.5 ? 7 : pbv < 6 ? 5 : pbv < 10 ? 3 : 2;
  // 财务健康 20
  const dv = num(debt);
  let f = dv == null ? 10 : dv < 30 ? 20 : dv < 45 ? 17 : dv < 60 ? 13 : dv < 70 ? 9 : dv < 80 ? 6 : 3;

  const parts = [
    { name: '成长性', v: Math.round(g), max: 25 },
    { name: '盈利力', v: Math.round(p), max: 30 },
    { name: '估值', v: Math.round(v), max: 25 },
    { name: '财务', v: Math.round(f), max: 20 }
  ];
  const total = Math.min(100, parts.reduce((s, x) => s + x.v, 0));
  const grade = total >= 80 ? 'A' : total >= 68 ? 'B+' : total >= 56 ? 'B' : total >= 44 ? 'C' : 'D';
  const good = [], bad = [];
  if (num(roe) >= 15) good.push('ROE 优秀'); else if (num(roe) != null && num(roe) < 5) bad.push('ROE 偏低');
  if (num(npG) >= 15) good.push('利润高增'); else if (num(npG) != null && num(npG) < 0) bad.push('利润负增长');
  if (usePE && usePE < 20) good.push('估值不高'); else if (usePE && usePE > 50) bad.push('估值偏高');
  if (num(debt) != null && num(debt) < 40) good.push('负债率低'); else if (num(debt) > 70) bad.push('负债率高');
  const comment = (good.length ? '优势：' + good.join('、') + '。' : '') + (bad.length ? '关注：' + bad.join('、') + '。' : '') || '各项指标处于中性区间。';
  return { total, parts, grade, comment };
}

/* ---------- 资金流 ---------- */
async function loadFlow(silent) {
  const box = $('#pane-flow');
  if (!silent) box.innerHTML = '<div class="card"><div class="loading">加载中…</div></div>';
  try {
    const [td, hs] = await Promise.allSettled([API.flowToday(state.stock.secid), API.flowHistory(state.stock.secid)]);
    const t = td.status === 'fulfilled' ? td.value?.data?.diff?.[0] : null;
    const kl = hs.status === 'fulfilled' ? (hs.value?.data?.klines || []) : [];
    if (!t && !kl.length) throw new Error('暂无资金数据（该标的可能不支持资金流统计）');

    let html = '';

    if (t) {
      const main = num(t.f62), ratio = num(t.f184);
      const levels = [
        ['超大单', num(t.f66), num(t.f69)],
        ['大单', num(t.f72), num(t.f75)],
        ['中单', num(t.f78), num(t.f81)],
        ['小单', num(t.f84), num(t.f87)]
      ];
      const maxAbs = Math.max(...levels.map(l => Math.abs(l[1] || 0)), 1);
      html += `<div class="card"><div class="card-h"><h3>今日资金流向</h3><span class="hint">主力＝超大单＋大单</span></div>
        <div class="card-b">
          <div class="flow-hero">
            <div class="lbl">主力净${main >= 0 ? '流入' : '流出'}</div>
            <div class="big ${cls(main)}">${moneySign(main)}</div>
            <div class="sm">占成交额 ${pctSign(ratio)}</div>
          </div>
          <div class="flow-rows">
            ${levels.map(([n, v, r]) => {
        const w = Math.abs(v || 0) / maxAbs * 48;
        const pos = v >= 0;
        return `<div class="frow"><span class="fl">${n}</span>
                <span class="fbar"><i class="mid-line"></i>
                  <span style="${pos ? 'left:50%' : 'right:50%'};width:${w.toFixed(1)}%;background:${pos ? CU : CD};opacity:.85"></span>
                </span>
                <span class="fv ${cls(v)}">${moneySign(v)}</span></div>`;
      }).join('')}
          </div>
        </div></div>`;
    }

    if (kl.length) {
      const parsed = kl.map(s => { const a = s.split(','); return { d: a[0], main: Number(a[1]), small: Number(a[2]), mid: Number(a[3]), big: Number(a[4]), huge: Number(a[5]), ratio: Number(a[6]), close: Number(a[11]), chg: Number(a[12]) }; });
      const last20 = parsed.slice(-20);
      const sum = n => parsed.slice(-n).reduce((s, x) => s + x.main, 0);
      // 连续净流入/流出天数
      let streak = 0, dir = 0;
      for (let i = parsed.length - 1; i >= 0; i--) {
        const s = Math.sign(parsed[i].main); if (!s) break;
        if (dir === 0) { dir = s; streak = 1; } else if (s === dir) streak++; else break;
      }
      html += `<div class="card"><div class="card-h"><h3>近20日主力净流入</h3><span class="hint">单位：亿元</span></div>
        <div class="card-b">
          ${barChart(last20.map(x => ({ l: x.d.slice(5), v: x.main })))}
          <div class="stat3">
            <div><div class="k">近5日</div><div class="v ${cls(sum(5))}">${moneySign(sum(5))}</div></div>
            <div><div class="k">近10日</div><div class="v ${cls(sum(10))}">${moneySign(sum(10))}</div></div>
            <div><div class="k">近20日</div><div class="v ${cls(sum(20))}">${moneySign(sum(20))}</div></div>
          </div>
          <div class="score-note">截至 ${parsed[parsed.length - 1].d.slice(5)} 收盘，主力已连续 <b>${streak}</b> 个交易日净${dir > 0 ? '流入' : '流出'}；近20日主力资金合计
            <b class="${cls(sum(20))}">${moneySign(sum(20))}</b>，
            ${sum(20) > 0 ? '资金面偏积极。' : '资金面偏谨慎。'}</div>
        </div></div>`;

      // 明细表
      const rows = parsed.slice(-10).reverse();
      html += `<div class="card"><div class="card-h"><h3>逐日资金明细</h3><span class="hint">近10个交易日</span></div>
        <div class="card-b"><table class="tbl">
          <tr><th>日期</th><th>涨跌幅</th><th>主力净额</th><th>占比</th></tr>
          ${rows.map(r => `<tr>
            <td>${r.d.slice(5)}</td>
            <td class="${cls(r.chg)}">${pctSign(r.chg)}</td>
            <td class="${cls(r.main)}">${moneySign(r.main)}</td>
            <td class="${cls(r.ratio)}">${pctSign(r.ratio)}</td></tr>`).join('')}
        </table></div></div>`;
    }

    state.flow = { main: t ? num(t.f62) : null, ratio: t ? num(t.f184) : null, levels: t ? levels : null, sum5: kl.length ? sum(5) : null, sum10: kl.length ? sum(10) : null, sum20: kl.length ? sum(20) : null, streak, dir, lastDate: parsed.length ? parsed[parsed.length - 1].d : null };
    box.innerHTML = html;
    if (state.activeTab === 'diag') refreshDiagPrompt();
  } catch (e) {
    if (!silent) box.innerHTML = `<div class="card"><div class="errbox">${esc(e.message)}<button onclick="loadFlow()">重试</button></div></div>`;
  }
}
window.loadFlow = loadFlow;

/* ---------- 持仓 ---------- */
async function loadHold() {
  const box = $('#pane-hold');
  if (!isA()) { box.innerHTML = '<div class="card"><div class="loading">该市场暂不支持股东与机构持仓数据</div></div>'; return; }
  try {
    const [hd, hn, og] = await Promise.allSettled([
      API.holders(state.stock.secucode),
      API.holderNum(state.stock.code),
      API.orgHold(state.stock.code)
    ]);
    let html = '';

    // 股东户数
    const n = hn.status === 'fulfilled' ? hn.value?.result?.data?.[0] : null;
    if (n) {
      const chgR = num(n.HOLDER_NUM_RATIO);
      html += `<div class="card"><div class="card-h"><h3>股东户数</h3><span class="hint">${shortDate(n.END_DATE)}</span></div>
        <div class="card-b"><div class="kv c3">
          ${kvItem('股东户数', (n.HOLDER_NUM / 1e4).toFixed(2) + '万户')}
          ${kvItem('较上期', pctSign(chgR), cls(-chgR))}
          ${kvItem('户均持股', money(n.AVG_HOLD_NUM, 2).replace(/亿|万/, m => m + '股') + (Math.abs(n.AVG_HOLD_NUM) < 1e4 ? '股' : ''))}
        </div>
        <div class="score-note">${chgR < 0 ? '股东户数<b class="up">减少</b>，筹码趋于集中，通常偏积极。' : chgR > 0 ? '股东户数<b class="down">增加</b>，筹码趋于分散，需留意。' : '户数基本持平。'}</div>
        </div></div>`;
    }

    // 十大流通股东
    const hs = hd.status === 'fulfilled' ? (hd.value?.result?.data || []) : [];
    if (hs.length) {
      const date = shortDate(hs[0].END_DATE);
      const totalRatio = hs.reduce((s, x) => s + (num(x.FREE_HOLDNUM_RATIO) || 0), 0);
      html += `<div class="card"><div class="card-h"><h3>十大流通股东</h3><span class="hint">${date}</span></div>
        <div class="card-b"><table class="tbl">
          <tr><th>股东名称</th><th>持股</th><th>占流通</th><th>变动</th></tr>
          ${hs.map(h => {
        const chg = h.HOLD_NUM_CHANGE;
        let chgTxt = '不变', chgCls = 'flat';
        if (chg && chg !== '不变') {
          const cv = Number(chg);
          if (!isNaN(cv)) { chgTxt = (cv > 0 ? '+' : '') + money(Math.abs(cv) >= 1e4 ? cv : cv, 2); chgCls = cls(cv); }
          else { chgTxt = String(chg).slice(0, 4); }
        }
        return `<tr>
              <td><span class="rank ${h.HOLDER_RANK <= 3 ? 'top' : ''}">${h.HOLDER_RANK}</span><span class="nm" style="display:inline-block;vertical-align:middle">${esc(h.HOLDER_NAME)}</span></td>
              <td>${money(h.HOLD_NUM, 2)}</td>
              <td>${pct(h.FREE_HOLDNUM_RATIO)}</td>
              <td class="${chgCls}">${chgTxt}</td></tr>`;
      }).join('')}
        </table>
        <div class="score-note">前十大流通股东合计持有流通股 <b>${totalRatio.toFixed(2)}%</b>，${totalRatio > 60 ? '筹码高度集中。' : totalRatio > 40 ? '筹码相对集中。' : '筹码较为分散。'}</div>
        </div></div>`;
    }

    // 机构持仓
    const ogRows = og.status === 'fulfilled' ? (og.value?.result?.data || []) : [];
    if (ogRows.length) {
      const newest = ogRows[0].REPORT_DATE;
      const list = ogRows.filter(r => r.REPORT_DATE === newest).slice(0, 10);
      html += `<div class="card"><div class="card-h"><h3>机构持仓 TOP10</h3><span class="hint">${ogRows[0].REPORT_DATE_NAME || shortDate(newest)}</span></div>
        <div class="card-b"><table class="tbl">
          <tr><th>机构 / 产品</th><th>类型</th><th>持股</th><th>市值</th></tr>
          ${list.map((r, i) => `<tr>
            <td><span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span><span class="nm" style="display:inline-block;vertical-align:middle">${esc(r.HOLDER_NAME)}</span></td>
            <td>${esc(r.F9_ORGTYPE_NAME || '-')}</td>
            <td>${money(r.TOTAL_SHARES, 2)}</td>
            <td>${money(r.HOLD_VALUE, 2)}</td></tr>`).join('')}
        </table>
        <div class="score-note">按持仓市值排序，数据来源于机构定期报告，存在披露滞后。</div>
        </div></div>`;
    }

    box.innerHTML = html || '<div class="card"><div class="loading">暂无持仓数据</div></div>';
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="errbox">持仓数据加载失败<button onclick="loadHold()">重试</button></div></div>`;
  }
}
window.loadHold = loadHold;

/* ---------- 新闻 ---------- */
async function loadNews() {
  const box = $('#pane-news');
  box.innerHTML = '<div class="card"><div class="loading">正在搜集资讯…</div></div>';
  try {
    const kwStock = state.stock.name;
    const kwInd = state.industry || state.stock.name;
    const [a, b] = await Promise.allSettled([API.news(kwStock, 25), state.industry ? API.news(kwInd, 20) : Promise.resolve(null)]);
    const pick = r => (r.status === 'fulfilled' ? (r.value?.result?.cmsArticleWebOld || []) : []);
    state.newsCache.stock = pick(a).map(x => ({ ...x, ...analyze(x.title, x.content) }));
    state.newsCache.industry = pick(b).map(x => ({ ...x, ...analyze(x.title, x.content) }));
    renderNews();
    if (state.activeTab === 'diag') refreshDiagPrompt();
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="errbox">资讯加载失败<button onclick="loadNews()">重试</button></div></div>`;
  }
}
window.loadNews = loadNews;

function renderNews() {
  const box = $('#pane-news');
  const list = state.newsCache[state.newsTab === 'stock' ? 'stock' : 'industry'] || [];
  const _t = s => { const d = new Date(String(s || '').replace(/-/g, '/')); return isNaN(d.getTime()) ? 0 : d.getTime(); };
  const sorted = [...list].sort((a, b) => _t(b.date) - _t(a.date));
  const g = list.filter(x => x.type === 'good').length;
  const b = list.filter(x => x.type === 'bad').length;
  const n = list.length - g - b;
  const tot = list.length || 1;
  const mood = g > b * 1.5 ? '偏多' : b > g * 1.5 ? '偏空' : '中性';
  const moodCls = g > b * 1.5 ? 'up' : b > g * 1.5 ? 'down' : 'flat';

  let html = `<div class="card"><div class="card-h"><h3>舆情概览</h3><span class="hint">关键词规则判定</span></div>
    <div class="card-b">
      <div class="seg">
        <button class="${state.newsTab === 'stock' ? 'on' : ''}" data-nt="stock">个股新闻</button>
        <button class="${state.newsTab === 'industry' ? 'on' : ''}" data-nt="industry">${state.industry ? esc(state.industry) + '行业' : '行业资讯'}</button>
      </div>
      <div class="senti">
        <div><div class="n up">${g}</div><div class="t">利好</div></div>
        <div><div class="n flat">${n}</div><div class="t">中性</div></div>
        <div><div class="n down">${b}</div><div class="t">利空</div></div>
      </div>
      <div class="senti-bar">
        <i style="width:${g / tot * 100}%;background:${CU}"></i>
        <i style="width:${n / tot * 100}%;background:#d3d7de"></i>
        <i style="width:${b / tot * 100}%;background:${CD}"></i>
      </div>
      <div class="score-note">当前${state.newsTab === 'stock' ? '个股' : '行业'}资讯情绪 <b class="${moodCls}">${mood}</b>，
        共分析 ${list.length} 条近期资讯。判定基于关键词规则，仅供快速筛选，请以原文为准。</div>
    </div></div>`;

  html += `<div class="card"><div class="card-h"><h3>${state.newsTab === 'stock' ? '个股相关资讯' : esc(state.industry || '') + '行业资讯'}</h3></div>
    <div class="card-b" id="newsList">`;
  if (!list.length) html += '<div class="loading">暂无相关资讯</div>';
  else html += sorted.map(x => {
    const badge = x.type === 'good' ? '<span class="badge good">利好</span>' : x.type === 'bad' ? '<span class="badge bad">利空</span>' : '<span class="badge neu">中性</span>';
    return `<a class="news-item" href="${esc(x.url)}" target="_blank" rel="noopener">
      <div class="news-title">${escKeepEm(x.title)}</div>
      ${x.content ? `<div class="news-sum">${escKeepEm(x.content)}</div>` : ''}
      <div class="news-meta">${badge}<span>${esc(x.mediaName || '')}</span><span>${timeAgo(x.date)}</span>
        ${x.kws.length ? `<span class="kw">命中：${esc(x.kws.join('/'))}</span>` : ''}</div>
    </a>`;
  }).join('');
  html += '</div></div>';

  box.innerHTML = html;
  $$('[data-nt]', box).forEach(btn => btn.addEventListener('click', () => {
    state.newsTab = btn.dataset.nt; renderNews();
    document.scrollingElement.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

/* ---------------- 诊股（大模型） ---------------- */
const LLM_PRESETS = {
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  moonshot: { name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  qwen: { name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
};
const SYS_PROMPT = '你是一名严谨、客观的证券分析师。请基于用户提供的真实行情与公开数据，给出结构化的今日个股诊断：多空判断明确、结合量价与资金面、给出关键参考位与操作提示、提示主要风险。语气克制不夸大，末尾必须注明"以上为基于公开数据的量化梳理，不构成任何投资建议"。';

function buildDiagPrompt() {
  const s = state.stock, q = state.quote, b = state.basic, f = state.flow;
  if (!s) return '（请先搜索并加载一只股票）';
  const L = [];
  L.push(`请作为证券分析师，基于以下「${s.name}（${s.code}）」的真实行情数据，给出今日（${new Date().toLocaleDateString('zh-CN')}）的诊股结论。`);
  L.push(''); L.push('【基本信息】');
  L.push(`股票：${s.name}（${s.code}）  行业：${state.industry || '未知'}`);
  if (q) {
    const dg = Math.pow(10, q.f59 ?? 2);
    const price = q.f43 / dg, chg = q.f170 / 100, prev = q.f60 / dg;
    L.push(`现价：${price.toFixed(2)}元  涨跌幅：${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%  涨跌额：${(q.f169 / dg >= 0 ? '+' : '') + (q.f169 / dg).toFixed(2)}元`);
    L.push(`今开/最高/最低：${(q.f46 / dg).toFixed(2)} / ${(q.f44 / dg).toFixed(2)} / ${(q.f45 / dg).toFixed(2)}  昨收：${prev.toFixed(2)}`);
    L.push(`换手率：${(q.f168 / 100).toFixed(2)}%  量比：${(q.f50 / 100).toFixed(2)}  振幅：${(q.f171 / 100).toFixed(2)}%`);
    L.push(`总市值：${money(q.f116)}  成交额：${money(q.f48)}`);
  }
  if (b) {
    L.push(''); L.push('【基本面】');
    L.push(`综合评级：${b.sc.grade}（${b.sc.total}分）— ${b.sc.comment}`);
    L.push(`市盈率TTM：${b.peTTM ? b.peTTM.toFixed(2) : '—'}  市净率：${b.pb ? b.pb.toFixed(2) : '—'}  总市值：${money(b.mcap)}`);
    L.push(`ROE：${pct(b.F.roe)}  毛利率：${pct(b.F.gross)}  净利率：${pct(b.F.net)}  负债率：${pct(b.F.debt)}`);
    L.push(`营收同比：${pctSign(b.F.revG)}  净利同比：${pctSign(b.F.npG)}`);
  } else {
    L.push(''); L.push('【基本面】该股为港股/美股或非A股，暂无A股财报维度数据。');
  }
  if (f && (f.main != null || f.sum20 != null)) {
    L.push(''); L.push('【资金面】');
    if (f.main != null) L.push(`今日主力净${f.main >= 0 ? '流入' : '流出'}：${moneySign(f.main)}（占成交额${pctSign(f.ratio)}）`);
    if (f.levels) L.push('今日分单：' + f.levels.map(([n, v]) => `${n} ${moneySign(v)}`).join('，'));
    if (f.sum20 != null) L.push(`近5/10/20日主力净流入：${moneySign(f.sum5)} / ${moneySign(f.sum10)} / ${moneySign(f.sum20)}`);
    if (f.streak > 0) L.push(`主力已连续 ${f.streak} 个交易日净${f.dir > 0 ? '流入' : '流出'}`);
  }
  const ns = state.newsCache.stock || [];
  if (ns.length) {
    const good = ns.filter(x => x.type === 'good').length, bad = ns.filter(x => x.type === 'bad').length, neu = ns.length - good - bad;
    L.push(''); L.push('【新闻情绪】');
    L.push(`近 ${ns.length} 条个股资讯：利好 ${good} ／ 利空 ${bad} ／ 中性 ${neu}`);
    ns.slice(0, 6).forEach(x => L.push(`· [${x.type === 'good' ? '利好' : x.type === 'bad' ? '利空' : '中性'}] ${x.title}`));
  }
  L.push(''); L.push('【输出要求】');
  L.push('请给出：1）今日多空强弱判断；2）量价与资金面解读；3）关键参考位与操作提示（仅供参考）；4）主要风险。控制在 400 字以内。');
  return L.join('\n');
}

function refreshDiagPrompt() {
  const el = $('#diagPrompt');
  if (el) el.textContent = buildDiagPrompt();
}

function renderDiag() {
  const box = $('#pane-diag');
  if (!box) return;
  const prov = LS.llmProvider || 'deepseek';
  const key = LS.llmKey || '';
  const prompt = buildDiagPrompt();
  box.innerHTML = `
    <div class="card"><div class="card-h"><h3>AI 诊股设置</h3><span class="hint">密钥仅存本机</span></div>
      <div class="card-b diag-set">
        <label class="dl">模型
          <select id="llmProv">${Object.entries(LLM_PRESETS).map(([k, v]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
        </label>
        <label class="dl">API Key
          <input id="llmKey" type="password" inputmode="text" autocomplete="off" placeholder="sk-… 仅存于本机浏览器，不会上传" value="${esc(key)}">
        </label>
        <button id="llmSave" class="btn-sm">保存密钥</button>
      </div>
      <div class="score-note" style="border-top:1px solid #eee">未填 Key 也能用：下方「复制提示词」后粘贴到任意大模型（ChatGPT / Kimi / 通义 / 文心）即可得到诊断；填了 Key 则可一键诊断。</div>
    </div>
    <div class="card"><div class="card-h"><h3>今日诊股数据（已自动汇总）</h3><span class="hint">${new Date().toLocaleDateString('zh-CN')}</span></div>
      <div class="card-b">
        <pre id="diagPrompt" class="diag-pre"></pre>
        <div class="diag-actions">
          <button id="diagCopy" class="btn-sm">复制提示词</button>
          <button id="diagRun" class="btn-sm primary">开始 AI 诊断</button>
        </div>
        <div id="diagMsg" class="diag-msg"></div>
      </div>
    </div>
    <div class="card" id="diagResultCard" hidden><div class="card-h"><h3>AI 诊断结论</h3></div>
      <div class="card-b"><div id="diagResult" class="diag-result"></div></div>
    </div>`;
  $('#diagPrompt').textContent = prompt;

  $('#llmSave').addEventListener('click', () => {
    LS.llmProvider = $('#llmProv').value;
    LS.llmKey = $('#llmKey').value.trim();
    const m = $('#diagMsg'); m.textContent = '已保存（密钥仅存于本机浏览器，不会上传到任何服务器）。'; m.className = 'diag-msg ok';
  });
  $('#diagCopy').addEventListener('click', async () => {
    const txt = $('#diagPrompt').textContent;
    try { await navigator.clipboard.writeText(txt); const m = $('#diagMsg'); m.textContent = '提示词已复制到剪贴板，去大模型粘贴即可。'; m.className = 'diag-msg ok'; }
    catch (e) { const m = $('#diagMsg'); m.textContent = '复制失败，请长按上方文本手动复制。'; m.className = 'diag-msg'; }
  });
  $('#diagRun').addEventListener('click', diagnose);
}

async function diagnose() {
  const key = LS.llmKey || '';
  const prov = LLM_PRESETS[LS.llmProvider || 'deepseek'] || LLM_PRESETS.deepseek;
  const card = $('#diagResultCard'), res = $('#diagResult'), msg = $('#diagMsg');
  if (!key) { msg.textContent = '请先填写 API Key 并点「保存密钥」（或复制提示词到任意大模型）。'; msg.className = 'diag-msg'; $('#llmKey').focus(); return; }
  const prompt = buildDiagPrompt();
  card.hidden = false; res.textContent = '诊断中…（约 10-30 秒）'; res.className = 'diag-result loading'; msg.textContent = '';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 70000);
  try {
    const r = await fetch(prov.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: prov.model, messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: prompt }], temperature: 0.6, stream: false }),
      signal: ctrl.signal
    });
    clearTimeout(to);
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('接口返回 ' + r.status + (t ? '：' + t.slice(0, 160) : '')); }
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content || '（模型未返回内容）';
    res.textContent = txt; res.className = 'diag-result';
  } catch (e) {
    clearTimeout(to);
    res.className = 'diag-result err';
    if (e.name === 'AbortError') res.textContent = '请求超时（70秒）。请检查网络或换用其他模型。';
    else res.textContent = '诊断失败：' + e.message + '\n\n提示：若报 CORS / 跨域错误，说明该模型不支持浏览器直连，请改用「复制提示词」方式。';
    msg.textContent = '若密钥无误但仍失败，多为跨域(CORS)限制，建议复制提示词到网页版大模型。'; msg.className = 'diag-msg';
  }
}

/* ---------------- Tab 切换 ---------------- */
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const k = t.dataset.tab;
  state.activeTab = k;
  ['basic', 'flow', 'hold', 'news', 'diag'].forEach(x => $('#pane-' + x).hidden = x !== k);
  if (k === 'diag') renderDiag();
  document.scrollingElement.scrollTo({ top: 0, behavior: 'smooth' });
}));

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.stock) { loadQuote(true); }
});

/* ---------------- 启动 ---------------- */
const DEFAULT = { secid: '1.600519', code: '600519', name: '贵州茅台', market: '沪A' };
(function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    API.suggest(code).then(r => {
      const d = r?.QuotationCodeTable?.Data?.[0];
      load(d ? { secid: d.QuoteID, code: d.Code, name: d.Name, market: d.SecurityTypeName } : (LS.last || DEFAULT));
    }).catch(() => load(LS.last || DEFAULT));
  } else {
    load(LS.last || DEFAULT);
  }
})();
