import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.389 (D244 · docs/526) 전표 CSV 양식 맞춤
 *   회계 프로그램(세무사랑 · 기타)마다 올리기 양식이 달라 칸 순서 · 칸 이름 · 날짜 모양 · 차변/대변 표시를 고릅니다.
 *   SPLIT — 차변 칸 · 대변 칸 따로 / SIGN — 「구분」 칸(차변 · 대변 글자) + 「금액」 칸 하나.
 *   양식 파일을 받으면 그대로 맞춰 「기본」으로 둡니다. 내려받기(전표 CSV)는 기본 양식 또는 고른 양식.
 *   v10.392 (D245 · docs/529) — 월 · 일 칸(month · day) 더함 · 「세무사랑 일반전표」 양식(구분 3 차변 · 4 대변)을 기본으로.
 * ------------------------------------------------------------------- */

export const FIELDS: Record<string, string> = {
  date: '일자', month: '월', day: '일', no: '전표번호', line: '줄', code: '계정코드', name: '계정명', debit: '차변', credit: '대변',
  dc: '구분(차변 · 대변)', amount: '금액', party: '거래처', memo: '적요', evidence: '증빙', src: '근거', blank: '빈 칸',
};
export const DATE_STYLES = ['YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD', 'YYYY.MM.DD'] as const;

export interface Fmt { id: string; name: string; columns: Array<{ field: string; title: string }>; dateStyle: string; dcStyle: 'SPLIT' | 'SIGN'; dcDebit: string; dcCredit: string; header: boolean; isDefault: boolean }

export async function listFormats(db: DatabaseService): Promise<Fmt[]> {
  return db.query<Fmt>(
    `SELECT id::text AS id, name, columns, date_style AS "dateStyle", dc_style AS "dcStyle", dc_debit AS "dcDebit", dc_credit AS "dcCredit", header, is_default AS "isDefault"
       FROM acct_export_formats ORDER BY is_default DESC, id`);
}

export async function pickFormat(db: DatabaseService, id?: string): Promise<Fmt> {
  const all = await listFormats(db);
  const f = id ? all.find((x) => x.id === String(id)) : all.find((x) => x.isDefault) ?? all[0];
  if (!f) throw new NotFound('전표 양식이 없습니다.');
  return f;
}

/** 입력 검사 — 칸 1 ~ 20 · 아는 field 만 · 칸 이름 1 ~ 30자 · SIGN 이면 dc · amount 둘 다 · SPLIT 이면 debit · credit 둘 다 */
export function checkFormat(b: { name?: string; columns?: Array<{ field: string; title?: string }>; dateStyle?: string; dcStyle?: string; dcDebit?: string; dcCredit?: string }) {
  const name = (b.name ?? '').trim();
  if (name.length < 1 || name.length > 40) throw new PolicyViolation('ACCT_FORMAT', '양식 이름은 1 ~ 40자입니다.');
  const cols = Array.isArray(b.columns) ? b.columns : [];
  if (cols.length < 1 || cols.length > 20) throw new PolicyViolation('ACCT_FORMAT', '칸은 1 ~ 20개입니다.');
  const out = cols.map((c) => {
    if (!c || typeof c.field !== 'string' || !(c.field in FIELDS)) throw new PolicyViolation('ACCT_FORMAT', `모르는 칸입니다: ${String(c?.field ?? '')}`);
    const title = (c.title ?? FIELDS[c.field]).toString().trim().slice(0, 30);
    return { field: c.field, title: title || FIELDS[c.field] };
  });
  const has = (f: string) => out.some((c) => c.field === f);
  const dcStyle = b.dcStyle === 'SIGN' ? 'SIGN' : 'SPLIT';
  if (dcStyle === 'SPLIT' && !(has('debit') && has('credit'))) throw new PolicyViolation('ACCT_FORMAT', '차변/대변 두 칸 방식은 차변 · 대변 칸이 모두 있어야 합니다.');
  if (dcStyle === 'SIGN' && !(has('dc') && has('amount'))) throw new PolicyViolation('ACCT_FORMAT', '구분 + 금액 방식은 구분 · 금액 칸이 모두 있어야 합니다.');
  if (!has('code') && !has('name')) throw new PolicyViolation('ACCT_FORMAT', '계정코드 또는 계정명 칸이 있어야 합니다.');
  const dateStyle = (DATE_STYLES as readonly string[]).includes(b.dateStyle ?? '') ? b.dateStyle! : 'YYYY-MM-DD';
  const dcDebit = (b.dcDebit ?? '차변').trim().slice(0, 10) || '차변', dcCredit = (b.dcCredit ?? '대변').trim().slice(0, 10) || '대변';
  if (dcDebit === dcCredit) throw new PolicyViolation('ACCT_FORMAT', '차변 · 대변 표시 글자가 같습니다.');
  return { name, columns: out, dateStyle, dcStyle, dcDebit, dcCredit };
}

const fmtDate = (d: string, style: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-');
  return style === 'YYYYMMDD' ? `${y}${m}${dd}` : style === 'YYYY/MM/DD' ? `${y}/${m}/${dd}` : style === 'YYYY.MM.DD' ? `${y}.${m}.${dd}` : `${y}-${m}-${dd}`;
};

/** 전표 줄 → 양식대로 머리줄 · 줄 */
export function renderRows(f: Fmt, rows: Array<Record<string, unknown>>, evKo: Record<string, string>) {
  const head = f.columns.map((c) => c.title);
  const body = rows.map((r) => f.columns.map((c) => {
    const debit = Number(r.debit ?? 0), credit = Number(r.credit ?? 0);
    switch (c.field) {
      case 'date': return fmtDate(String(r.date), f.dateStyle);
      case 'month': return String(r.date).slice(5, 7);   // v10.392 세무사랑 일반전표 — 월 · 일 칸 따로
      case 'day': return String(r.date).slice(8, 10);
      case 'dc': return debit > 0 ? f.dcDebit : f.dcCredit;
      case 'amount': return debit > 0 ? debit : credit;
      case 'debit': return f.dcStyle === 'SPLIT' ? debit : (debit || '');
      case 'credit': return f.dcStyle === 'SPLIT' ? credit : (credit || '');
      case 'evidence': return evKo[String(r.evidence)] ?? '';
      case 'blank': return '';
      default: return r[c.field] ?? '';
    }
  }));
  return { head, body };
}
