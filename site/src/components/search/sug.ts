/**
 * v10.29 — 시안(proto_lite.html)의 검색 문장 읽기 규칙 그대로: SUGRULE · sugParse · sugWords · sugMatch.
 *
 * 브라우저 안에서 도는 **규칙 엔진**입니다. 모델을 부르지 않습니다 — 'AI' 라고 쓰지 않습니다.
 * 무엇을 읽었는지 보여 주어(「이렇게 찾습니다」) 이해했다는 것을 알립니다.
 * 시안의 글자 · 순서 · 상한(조건 4개 · 낱말 4개 · 목록 7줄)을 바꾸지 않았습니다.
 */

export interface SugCond { k: '지역' | '규모' | '조건' | '상태'; v: string }
export interface SugItem { t: string; k: string; parse?: SugCond[]; words?: string[]; isQ?: boolean }

const SUGRULE: {
  area: Array<[string, string]>;
  scale: Array<[RegExp, (m: RegExpMatchArray) => string]>;
  price: Array<[string, string]>;
  cond: Array<[string, string]>;
} = {
  /* 지역 */
  area: [['서울', '서울'], ['경기', '경기'], ['인천', '인천'], ['부산', '부산'],
    ['대구', '대구'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'],
    ['제주', '제주'], ['강남', '서울 강남'], ['김포', '경기 김포'],
    ['판교', '경기 성남'], ['해운대', '부산 해운대']],
  /* 규모 — 평수 · 인원 · 수량은 숫자로 잡습니다 */
  /* v10.31 — 「10평 이내 · 20평 이상」은 그대로 읽습니다(문장 결과 #prompt 의 서버 규칙과 같게 — 둘이 달리 읽던 결함). 그냥 「30평」은 시안대로 「30평대」 */
  scale: [[/(\d+)\s*평\s*(이내|이하|미만|이상|초과)?/, (m) => m[1] + (m[2] ? (/이상|초과/.test(m[2]) ? '평 이상' : '평 이내') : '평대')],
    [/(\d+)\s*명/, (m) => m[1] + '명 규모'],
    [/(\d+)\s*대/, (m) => m[1] + '대'],
    [/(\d+)\s*박스/, (m) => m[1] + '박스']],
  /* 가격 조건 */
  price: [['저렴', '가격 낮은 순'], ['싼', '가격 낮은 순'], ['할인', '할인 중'],
    ['특가', '할인 중'], ['급매', '급매'], ['무료', '무료'],
    ['가성비', '가격 낮은 순']],
  /* 상태 — "급" 하나만 두면 "급매" 안의 급이 또 잡혀 시안처럼 뺐습니다 */
  cond: [['중고', '중고'], ['신품', '새 상품'], ['새 ', '새 상품'], ['신규', '신규'],
    ['급하', '급함'], ['급히', '급함'], ['즉시', '즉시 가능'], ['당일', '당일']],
};

/** 문장에서 조건을 뽑습니다(시안 sugParse). */
export function sugParse(q: string): SugCond[] {
  let out: SugCond[] = [];
  const t = q.toLowerCase();
  SUGRULE.area.forEach((x) => { if (t.indexOf(x[0]) >= 0) out.push({ k: '지역', v: x[1] }); });
  SUGRULE.scale.forEach((x) => { const m = q.match(x[0]); if (m) out.push({ k: '규모', v: x[1](m) }); });
  SUGRULE.price.forEach((x) => { if (t.indexOf(x[0]) >= 0) out.push({ k: '조건', v: x[1] }); });
  SUGRULE.cond.forEach((x) => { if (t.indexOf(x[0]) >= 0) out.push({ k: '상태', v: x[1] }); });
  /* "서울 강남" 이면 좁은 쪽만 남깁니다 */
  out = out.filter((x) => x.k !== '지역'
    || !out.some((y) => y !== x && y.k === '지역' && y.v.indexOf(x.v) === 0 && y.v !== x.v));
  const seen: Record<string, 1> = {};
  return out.filter((x) => { const k = x.k + x.v; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 4);
}

const STOP = ['가장', '제일', '좀', '많이', '되는', '있는', '싶은', '하는', '것', '거', '좋은',
  '어떤', '무슨', '추천', '해줘', '주세요', '알려', '찾아'];

/** 문장에서 핵심 낱말을 뽑습니다 — 조사와 군더더기를 뗍니다(시안 sugWords). */
export function sugWords(q: string): string[] {
  return q.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(에서|으로|에게|중에|중|에|의|를|을|는|은|이|가|와|과|도|만|까지|부터)$/, ''))
    .filter((w) => w.length >= 2 && STOP.indexOf(w) < 0);
}

/**
 * 입력한 말로 후보를 고릅니다(시안 sugMatch). pool 은 시안 sugPool 과 같은 재료(인기 · 업종 · 등록 제목)를 서버에서 받은 것.
 * ① 앞에서 맞는 것 먼저 ② 문장이면 낱말별로 ③ 6글자 이상이면 맨 위에 「이렇게 찾습니다」.
 */
export function sugMatch(qIn: string, pool: SugItem[]): SugItem[] {
  const q = (qIn || '').trim();
  if (q.length < 1) return [];
  const ql = q.toLowerCase();
  const head: SugItem[] = [], mid: SugItem[] = [];
  for (const x of pool) {
    const t = x.t.toLowerCase();
    if (t === ql) continue;
    if (t.indexOf(ql) === 0) head.push(x);
    else if (t.indexOf(ql) > 0) mid.push(x);
  }
  if (head.length + mid.length < 3 && q.length >= 4) {
    const hit: Record<string, 1> = {};
    sugWords(q).forEach((w) => {
      pool.forEach((x) => {
        if (x.t.toLowerCase().indexOf(w.toLowerCase()) >= 0 && !hit[x.t]) { hit[x.t] = 1; mid.push(x); }
      });
    });
  }
  const list = head.concat(mid).slice(0, 6);
  if (q.length >= 6) {
    const cond = sugParse(q), ws2 = sugWords(q);
    if (cond.length || ws2.length) {
      const used = cond.map((c) => c.v).join(' ');
      const rest = ws2.filter((w) => used.indexOf(w) < 0);
      list.unshift({ t: q, k: '이렇게 찾습니다', parse: cond, words: rest.slice(0, 4), isQ: true });
    }
  }
  return list.slice(0, 7);
}
