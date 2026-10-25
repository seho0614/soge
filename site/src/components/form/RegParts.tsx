'use client';
/**
 * v10.31 (w1) — 시안 등록 폼 조각(「상품/서비스 등록하기」 SB-HOM-REG-010 · 「소개받기 등록하기」 SB-HOM-REQ-010 공용).
 *   Field   — 시안 fld(라벨 · * · 글자 수 · 단위 · 도움말 · 「필수 항목입니다.」)
 *   CategoryBlock — 관 → 업종(등급으로 묶음) → 등급 「자동」(카테고리가 등급을 정합니다 · A-11)
 *   ImagePicker   — 대표 이미지 + 상세 이미지(최대 5) · JPG · PNG 10MB. 고르면 바로 올립니다
 *                   (POST /files → PUT → POST /files/{id}/complete — 서버가 크기 · 형식을 다시 봄) · 붙이는 것은 등록 때(파일 id)
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** v10.101 (2-5b) — 등록 · 수정 양식 사전(forms.*) */
export type FormsT = ReturnType<typeof useTranslations<'forms'>>;

export interface Cat { id: string; gwanCode: string; name: string; gradeCode: string; feeBearer?: string | null }
export interface Gwan { code: string; name: string }

export function Field({ id, label, req, hint, miss, count, max, unit, auto, children }: {
  id?: string; label: string; req?: boolean; hint?: React.ReactNode; miss?: boolean; count?: number; max?: number; unit?: string; auto?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('forms');
  return (
    <div className={`w1-rfld${miss ? ' fmiss' : ''}`}>
      <label htmlFor={id}>{label}{req && <i>*</i>}{auto && <i className="auto">{t('reg.auto')}</i>}</label>
      {unit ? <div className="funit">{children}<span>{unit}</span></div> : children}
      {max !== undefined && <div className="fcnt">{count ?? 0} / {max}</div>}
      {hint && <div className="fh">{hint}</div>}
      {miss && <div className="fmsg">{t('common.required')}</div>}
    </div>
  );
}

/** 금액 칸 — 숫자만 받아 천 단위 쉼표로 보여 줍니다(시안 data-money) */
export function MoneyInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (digits: string) => void; placeholder?: string }) {
  return (
    <input id={id} className="w1-in" inputMode="numeric" placeholder={placeholder}
      value={value ? Number(value).toLocaleString('ko-KR') : ''}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))} />
  );
}

export function CategoryBlock({ gwans, cats, gwan, cat, onGwan, onCat, gradeLabels, miss }: {
  gwans: Gwan[]; cats: Cat[]; gwan: string; cat: string; onGwan: (g: string) => void; onCat: (c: string) => void;
  gradeLabels: Record<string, string>; miss: Set<string>;
}) {
  const t = useTranslations('forms.reg');
  const list = cats.filter((c) => c.gwanCode === gwan);
  const groups = [...new Set(list.map((c) => c.gradeCode))].sort();
  const cur = list.find((c) => c.id === cat);
  return (
    <div className="w1-g3 catrow">
      <Field id="f-gwan" label={t('gwanLabel')} req miss={miss.has('gwan')} hint={t('gwanHint')}>
        <select id="f-gwan" className="w1-in" value={gwan} onChange={(e) => onGwan(e.target.value)} name="gwanCode">
          <option value="">{t('gwanPick')}</option>
          {gwans.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
        </select>
      </Field>
      <Field id="f-cat" label={t('catLabel')} req miss={miss.has('cat')} hint={gwan ? t('catHint') : t('catHintNoGwan')}>
        <select id="f-cat" className="w1-in" value={cat} onChange={(e) => onCat(e.target.value)} disabled={!gwan} name="categoryId">
          <option value="">{gwan ? t('catPick') : t('catPickNoGwan')}</option>
          {groups.map((g) => (
            <optgroup key={g} label={gradeLabels[g] ?? g}>
              {list.filter((c) => c.gradeCode === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label={t('grade')} auto hint={<>{t.rich('gradeHint', { b: (c) => <b>{c}</b> })}</>}>
        <div className={`w1-in gradebox${cur ? ' on' : ''}`} aria-live="polite">{cur ? (gradeLabels[cur.gradeCode] ?? cur.gradeCode) : t('gradeEmpty')}</div>
      </Field>
    </div>
  );
}

interface Img { id: string; url: string; name: string }
const MAXB = 10 * 1024 * 1024;

async function sha256(buf: ArrayBuffer): Promise<string | undefined> {
  try {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

/** 한 장 올리기 — 파일 id 를 돌려줍니다. 실패하면 사람이 읽을 문장을 던집니다
 *  v10.101 (2-5b) — 문장은 부르는 쪽이 넘긴 사전(t · forms)으로 씁니다. 부르는 곳: ImagePicker(이 파일) · InquiryForm */
export async function upload(file: File, purpose: string, pdf: boolean, t: FormsT): Promise<string> {
  if (!(pdf ? /^(image\/(jpeg|png)|application\/pdf)$/ : /^image\/(jpeg|png)$/).test(file.type)) {
    throw new Error(pdf ? t('upload.onlyImgPdf') : t('upload.onlyImg'));
  }
  if (file.size > MAXB) throw new Error(t('upload.tooBig'));
  const buf = await file.arrayBuffer();
  const r = await fetch('/api/v1/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose, name: file.name.slice(0, 200) || 'image', contentType: file.type, size: file.size, sha256: await sha256(buf) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? t('upload.slotFail'));
  const put = await fetch(j.uploadUrl, { method: j.method ?? 'PUT', headers: { ...(j.headers ?? {}), 'Content-Type': file.type }, body: buf });
  if (!put.ok) throw new Error(t('upload.putFail'));
  const c = await fetch(`/api/v1/files/${j.fileId}/complete`, { method: 'POST' });
  const cj = await c.json().catch(() => ({}));
  if (!c.ok || cj.status !== 'READY') throw new Error(cj.message ?? t('upload.checkFail'));
  return j.fileId as string;
}

/** v10.101 (2-5b) — 전: what(「상품/서비스」 · 「원하는 상품/서비스」 글자) → kind(listing · request) · 글자는 사전 forms.img.* */
export function ImagePicker({ purpose, value, onChange, kind = 'listing' }: {
  purpose: 'LISTING_IMAGE' | 'REQUEST_IMAGE'; value: Img[]; onChange: (v: Img[]) => void; kind?: 'listing' | 'request';
}) {
  const ft = useTranslations('forms');
  const t = useTranslations('forms.img');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const slot = useRef(0);

  async function pick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const at = slot.current;
    setErr(null); setBusy(at);
    try {
      const id = await upload(f, purpose, false, ft);
      const img = { id, url: URL.createObjectURL(f), name: f.name };
      const next = [...value];
      if (at < next.length) next[at] = img; else next.push(img);
      onChange(next.slice(0, 6));
    } catch (e) { setErr(e instanceof Error ? e.message : t('fail')); }
    setBusy(null);
    if (ref.current) ref.current.value = '';
  }
  const open = (i: number) => { slot.current = Math.min(i, value.length); ref.current?.click(); };
  const drop = (i: number) => onChange(value.filter((_, k) => k !== i));
  const main = value[0];

  return (
    <div className="w1-imgp">
      <input ref={ref} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => void pick(e.target.files)} data-img-input="" />
      <label className="w1-rlab">{t('main')}</label>
      <div className="fsub">{t(kind === 'listing' ? 'subListing' : 'subRequest')}</div>
      <div className="upmain">
        <button type="button" className={`upbox${main ? ' has' : ''}`} onClick={() => open(0)} disabled={busy !== null} aria-label={t('mainUpload')}>
          {main ? <img src={main.url} alt={t('mainAlt')} />
            : <><span className="ui" aria-hidden="true">🖼</span><span className="ut2">{busy === 0 ? t('uploading') : t('upload')}</span><span className="us">{t('types')}</span></>}
        </button>
        <div className="upguide"><b>{t('guide')}</b><ul>
          <li>{kind === 'listing' ? t('g1Listing') : t('g1Request')}</li>
          <li>{t('g2')}</li>
          <li>{t('g3')}</li>
          <li>{t('g4')}</li>
        </ul>
          {main && <div style={{ marginTop: 8 }}><button type="button" className="w1-bo sm" onClick={() => drop(0)}>{t('mainRemove')}</button></div>}
        </div>
      </div>
      <label className="w1-rlab" style={{ marginTop: 18 }}>{t('sub')}</label>
      <div className="upsub">
        {[1, 2, 3, 4, 5].map((i) => {
          const im = value[i];
          return (
            <div key={i} className={`upc${im ? ' has' : ''}`}>
              {im ? (
                <><img src={im.url} alt={t('subAlt', { i: String(i) })} /><button type="button" className="x" onClick={() => drop(i)} aria-label={t('subRemove', { i: String(i) })}>×</button></>
              ) : (
                <button type="button" onClick={() => open(i)} disabled={busy !== null || !main || i > value.length}
                  title={!main ? t('mainFirst') : undefined}>
                  <span className="up2" aria-hidden="true">+</span>{busy === i ? t('uploading') : t('upload')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}
    </div>
  );
}
export type { Img };
