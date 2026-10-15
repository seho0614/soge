'use client';
/**
 * v10.31 (w1) — 시안 등록 폼 조각(「상품/서비스 등록하기」 SB-HOM-REG-010 · 「소개받기 등록하기」 SB-HOM-REQ-010 공용).
 *   Field   — 시안 fld(라벨 · * · 글자 수 · 단위 · 도움말 · 「필수 항목입니다.」)
 *   CategoryBlock — 관 → 업종(등급으로 묶음) → 등급 「자동」(카테고리가 등급을 정합니다 · A-11)
 *   ImagePicker   — 대표 이미지 + 상세 이미지(최대 5) · JPG · PNG 10MB. 고르면 바로 올립니다
 *                   (POST /files → PUT → POST /files/{id}/complete — 서버가 크기 · 형식을 다시 봄) · 붙이는 것은 등록 때(파일 id)
 */
import { useRef, useState } from 'react';

export interface Cat { id: string; gwanCode: string; name: string; gradeCode: string; feeBearer?: string | null }
export interface Gwan { code: string; name: string }

export function Field({ id, label, req, hint, miss, count, max, unit, auto, children }: {
  id?: string; label: string; req?: boolean; hint?: React.ReactNode; miss?: boolean; count?: number; max?: number; unit?: string; auto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`w1-rfld${miss ? ' fmiss' : ''}`}>
      <label htmlFor={id}>{label}{req && <i>*</i>}{auto && <i className="auto">자동</i>}</label>
      {unit ? <div className="funit">{children}<span>{unit}</span></div> : children}
      {max !== undefined && <div className="fcnt">{count ?? 0} / {max}</div>}
      {hint && <div className="fh">{hint}</div>}
      {miss && <div className="fmsg">필수 항목입니다.</div>}
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
  const list = cats.filter((c) => c.gwanCode === gwan);
  const groups = [...new Set(list.map((c) => c.gradeCode))].sort();
  const cur = list.find((c) => c.id === cat);
  return (
    <div className="w1-g3 catrow">
      <Field id="f-gwan" label="관 (대분류)" req miss={miss.has('gwan')} hint="관마다 등록 폼과 업종 목록이 다릅니다.">
        <select id="f-gwan" className="w1-in" value={gwan} onChange={(e) => onGwan(e.target.value)} name="gwanCode">
          <option value="">관을 선택하세요</option>
          {gwans.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
        </select>
      </Field>
      <Field id="f-cat" label="업종 (세부 분류)" req miss={miss.has('cat')} hint={gwan ? '이 관의 등급표에 있는 업종입니다.' : '관을 고르면 목록이 열립니다.'}>
        <select id="f-cat" className="w1-in" value={cat} onChange={(e) => onCat(e.target.value)} disabled={!gwan} name="categoryId">
          <option value="">{gwan ? '업종을 선택하세요' : '관을 먼저 고르세요'}</option>
          {groups.map((g) => (
            <optgroup key={g} label={gradeLabels[g] ?? g}>
              {list.filter((c) => c.gradeCode === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="등급" auto hint={<><b>카테고리가 등급을 정합니다(A-11).</b> 등급은 노출 순서와 소개비 기준선에 쓰입니다.</>}>
        <div className={`w1-in gradebox${cur ? ' on' : ''}`} aria-live="polite">{cur ? (gradeLabels[cur.gradeCode] ?? cur.gradeCode) : '업종을 고르면 정해집니다'}</div>
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

/** 한 장 올리기 — 파일 id 를 돌려줍니다. 실패하면 사람이 읽을 문장을 던집니다 */
export async function upload(file: File, purpose: string, pdf = false): Promise<string> {
  if (!(pdf ? /^(image\/(jpeg|png)|application\/pdf)$/ : /^image\/(jpeg|png)$/).test(file.type)) {
    throw new Error(pdf ? '이미지(JPG · PNG) · PDF 파일만 올릴 수 있습니다.' : 'JPG · PNG 파일만 올릴 수 있습니다.');
  }
  if (file.size > MAXB) throw new Error('10MB 를 넘는 파일은 받지 않습니다.');
  const buf = await file.arrayBuffer();
  const r = await fetch('/api/v1/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose, name: file.name.slice(0, 200) || 'image', contentType: file.type, size: file.size, sha256: await sha256(buf) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? '올릴 자리를 만들지 못했습니다.');
  const put = await fetch(j.uploadUrl, { method: j.method ?? 'PUT', headers: { ...(j.headers ?? {}), 'Content-Type': file.type }, body: buf });
  if (!put.ok) throw new Error('그림을 보내지 못했습니다. 잠시 후 다시 시도해 주십시오.');
  const c = await fetch(`/api/v1/files/${j.fileId}/complete`, { method: 'POST' });
  const cj = await c.json().catch(() => ({}));
  if (!c.ok || cj.status !== 'READY') throw new Error(cj.message ?? '그림을 확인하지 못했습니다(형식 · 크기).');
  return j.fileId as string;
}

export function ImagePicker({ purpose, value, onChange, what = '상품/서비스' }: {
  purpose: 'LISTING_IMAGE' | 'REQUEST_IMAGE'; value: Img[]; onChange: (v: Img[]) => void; what?: string;
}) {
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
      const id = await upload(f, purpose);
      const img = { id, url: URL.createObjectURL(f), name: f.name };
      const next = [...value];
      if (at < next.length) next[at] = img; else next.push(img);
      onChange(next.slice(0, 6));
    } catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); }
    setBusy(null);
    if (ref.current) ref.current.value = '';
  }
  const open = (i: number) => { slot.current = Math.min(i, value.length); ref.current?.click(); };
  const drop = (i: number) => onChange(value.filter((_, k) => k !== i));
  const main = value[0];

  return (
    <div className="w1-imgp">
      <input ref={ref} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => void pick(e.target.files)} data-img-input="" />
      <label className="w1-rlab">대표 이미지 (선택)</label>
      <div className="fsub">{what}의 이미지를 등록해주세요.</div>
      <div className="upmain">
        <button type="button" className={`upbox${main ? ' has' : ''}`} onClick={() => open(0)} disabled={busy !== null} aria-label="대표 이미지 올리기">
          {main ? <img src={main.url} alt="고른 대표 이미지" />
            : <><span className="ui" aria-hidden="true">🖼</span><span className="ut2">{busy === 0 ? '올리는 중…' : '이미지 업로드'}</span><span className="us">JPG, PNG 파일 (최대 10MB)</span></>}
        </button>
        <div className="upguide"><b>등록 가이드</b><ul>
          <li>{what === '상품/서비스' ? '상품/서비스를 잘 보여 주는 대표 이미지를 등록해주세요.' : '관심 있는 상품/서비스의 대표 이미지를 등록해주세요.'}</li>
          <li>가로형 이미지가 가장 잘 보여집니다.</li>
          <li>최대 6장까지 등록 가능 (첫 번째 이미지가 대표 이미지입니다.)</li>
          <li>번호판 · 얼굴 · 연락처가 보이지 않게 가려 주세요(검수에서 걸립니다).</li>
        </ul>
          {main && <div style={{ marginTop: 8 }}><button type="button" className="w1-bo sm" onClick={() => drop(0)}>대표 이미지 빼기</button></div>}
        </div>
      </div>
      <label className="w1-rlab" style={{ marginTop: 18 }}>상세 이미지 (선택, 최대 5장)</label>
      <div className="upsub">
        {[1, 2, 3, 4, 5].map((i) => {
          const im = value[i];
          return (
            <div key={i} className={`upc${im ? ' has' : ''}`}>
              {im ? (
                <><img src={im.url} alt={`상세 이미지 ${i}`} /><button type="button" className="x" onClick={() => drop(i)} aria-label={`상세 이미지 ${i} 빼기`}>×</button></>
              ) : (
                <button type="button" onClick={() => open(i)} disabled={busy !== null || !main || i > value.length}
                  title={!main ? '대표 이미지를 먼저 올려 주세요' : undefined}>
                  <span className="up2" aria-hidden="true">+</span>{busy === i ? '올리는 중…' : '이미지 업로드'}
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
