import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import type { Manage } from './shared';
import { useAct } from '../../../lib/act';
import { Flash } from '../../../components/Flash';

/* ── SB-ADM-SIT-020 새 관 만들기 ─────────────────────────────────── */
const TARGETS = [
  ['GOODS', '상품 · 서비스', '고정자산이 넘어가지 않습니다 — 소개장터 계열'],
  ['ASSET', '자산 · 매물', '고정자산이 넘어갑니다 — 안심소개 계열 (A-01)'],
  ['BIZ', '사업 기회', '가맹 · 출점 · 점포 양수도 — 소개창업 계열'],
] as const;

const STEPS = [
  ['무엇을 소개하는 관인가', '고정자산이 넘어가는가로 가릅니다 (A-01). 이것을 먼저 정하지 않으면 요율도 게이트도 정할 수 없습니다.'],
  ['관 이름 · 코드 · 상위 관', '코드와 소개 대상은 생성 후 바꿀 수 없습니다. 사용자 웹 주소는 sogaebank.com/g/<코드 소문자>입니다.'],
  ['업종 · 등급', '카테고리가 등급을 결정합니다 (A-11). 업종 › 업종 승인 › 「새 업종 추가」로 이 관에 업종을 만들고, 다른 관리자가 승인합니다(v10.643).'],
  ['소개비 부담 주체', '업종마다 정합니다 — 새 업종 추가 때 또는 승인 칸에서 부담 주체(판매자 · 구매자 · 협의)를 고릅니다.'],
  ['오픈 체크리스트', '전부 통과해야 준비중 → 운영중으로 넘어갑니다.'],
];

export function GwanNew({ onCreated, onCancel }: { onCreated: (code: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState<string>('GOODS');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [step, setStep] = useState<0 | 1>(0);   // v10.32 — 시안 위자드: 1단계(소개 대상) → 다음 → 2단계(이름 · 코드)
  const a = useAct();
  /* v10.646 (D309 · docs/791) 상위 관(허브) — 허브 아래에 두면 허브 화면 · 「소개하고 벌기」 묶음에 함께 나옴 */
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const hubs = (manage.data ?? []).filter((x) => x.isHub);
  const [parent, setParent] = useState<string>('');
  useEffect(() => { if (!parent && hubs[0]) setParent(hubs[0].code); }, [hubs.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* v10.695 (docs/803) 만들면서 업종 복사 — 다른 관의 승인된 업종을 골라 두면, 관을 만든 뒤 이 관에 「승인 대기」로 복사(POST /admin/categories/copy ·
     옮기지 않음 · 같은 이름 · 판정 · 부담 주체 · 코드 앞머리만 새 관 코드) · 다른 관리자가 승인 */
  const cats = useApi<Array<{ id: string; gwanCode: string; code: string; name: string; status: string }>>('/admin/categories');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const srcCats = (cats.data ?? []).filter((c) => c.status === 'APPROVED' && (!q.trim() || c.name.includes(q.trim()) || c.code.includes(q.trim().toUpperCase())));

  const codeOk = /^[A-Z]{3,4}$/.test(code);   // v10.646 — 관 표(gwans_code_check)와 같게 3 ~ 4자
  const nameOk = name.trim().length >= 2 && name.trim().length <= 20;

  async function create() {
    const t = TARGETS.find((x) => x[0] === target)?.[1];
    const r = await a.run('new', () => api<{ code?: string }>('/admin/gwans', {
      method: 'POST',
      body: JSON.stringify({
        code, name: name.trim(),
        description: desc.trim() || undefined,
        introTarget: t ? target : undefined,   // v10.646 (D309) 소개 대상 칸(전에는 설명 앞 글자)
        ...(parent ? { parentCode: parent } : {}),
      }),
    }), undefined, '관을 만들었습니다. 비활성(준비중)으로 만들어집니다 — 업종을 붙인 뒤 여십시오.');
    if (!r) return;
    if (picked.length) {   // v10.695 — 관을 만든 뒤 고른 업종을 승인 대기로 복사(하나가 실패해도 나머지는 계속)
      let ok = 0; const fail: string[] = [];
      for (const id of picked) {
        const c = (cats.data ?? []).find((x) => x.id === id);
        try { await api('/admin/categories/copy', { method: 'POST', body: JSON.stringify({ fromId: id, gwanCode: code }) }); ok++; }
        catch { fail.push(c?.name ?? id); }
      }
      setCopied(`업종 ${ok}개를 「승인 대기」로 복사했습니다 — 다른 관리자가 업종 › 업종 승인에서 승인합니다.${fail.length ? ` 복사 못 함: ${fail.join(' · ')}` : ''}`);
      if (fail.length) return;   // 실패가 있으면 이 화면에 남겨 까닭을 보게 함
    }
    onCreated(code);
  }

  /* v10.32 — 시안(scAdmSitNew) 배치: 세로 5단계(지금 단계 강조) → 지금 단계 카드 하나 → 노란 띠 → 다음 · 취소.
   * 전에는 5단계를 가로 5칸으로 두고 1 · 2단계 입력을 한 카드에 함께 보였습니다. 입력 · 서버 호출(POST /admin/gwans)은 그대로입니다. */
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'gwans/new') */}
      <ol className="ad-nsteps" data-gwan-steps>
        {STEPS.map(([t, d], i) => (
          <li key={t} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="n">{i + 1}</span><div><b>{t}</b><p>{d}</p></div>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="ad-fset" data-gwan-step="1">
          <h3>1. 무엇을 소개하는 관인가</h3>
          {TARGETS.map(([k, t, d]) => (
            <label key={k} className={`ad-rz${target === k ? ' on' : ''}`}>
              <input type="radio" name="gwan-target" checked={target === k} onChange={() => setTarget(k)} aria-label={t} />
              <b>{t}</b><span>{d}</span>
            </label>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="ad-fset" data-gwan-step="2">
          <h3>2. 관 이름 · 코드 <span className="dim" style={{ fontWeight: 500 }}>· 소개 대상 {TARGETS.find((x) => x[0] === target)?.[1]}</span></h3>
          <div className="form-grid">
            <label>
              <span>코드 (영문 대문자 3 ~ 4자 · 생성 후 변경 불가)</span>
              <input value={code} maxLength={4} placeholder="예) EDU"
                     onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            </label>
            <label>
              <span>관 이름 (2~20자)</span>
              <input value={name} maxLength={20} placeholder="예) 소개배움" onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>상위 관(허브)</span>
              <select value={parent} onChange={(e) => setParent(e.target.value)} data-gwan-new-parent>
                <option value="">없음(허브 밖 · 따로 둠)</option>
                {hubs.map((h) => <option key={h.code} value={h.code}>{h.name} ({h.code})</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명 (메인 카드에 나갑니다)</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          <details className="card pad" data-gwan-new-copy open={picked.length > 0 || undefined}>
            <summary><b>업종 복사(선택)</b> <span className="dim">— 다른 관의 승인된 업종을 골라 두면, 관을 만든 뒤 이 관에 「승인 대기」로 복사합니다(옮기지 않음 · 다른 관리자 승인) · 고른 것 {picked.length}개</span></summary>
            <div className="form-grid">
              <label><span>찾기</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업종 이름 · 코드" /></label>
              <div className="acts">
                <button className="btn-plain" onClick={() => setPicked([...new Set([...picked, ...srcCats.slice(0, 200).map((c) => c.id)])])} data-gwan-new-copy-all>보이는 것 모두 고르기</button>
                <button className="btn-plain" onClick={() => setPicked([])}>고른 것 비우기</button>
              </div>
            </div>
            <div className="ad-tw" style={{ maxHeight: 260, overflow: 'auto' }}><table className="tbl">
              <thead><tr><th></th><th>업종</th><th>코드</th><th>지금 관</th></tr></thead>
              <tbody>
                {srcCats.slice(0, 200).map((c) => (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`${c.name} 복사`} checked={picked.includes(c.id)}
                               onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} data-gwan-new-copy-pick={c.code} /></td>
                    <td>{c.name}</td><td className="mono">{c.code}</td><td>{c.gwanCode}</td>
                  </tr>
                ))}
                {srcCats.length === 0 && <tr><td colSpan={4} className="muted">{cats.error ? '업종 목록을 읽지 못했습니다.' : '승인된 업종이 없습니다.'}</td></tr>}
              </tbody>
            </table></div>
          </details>
          {copied && <p className="form-ok" data-gwan-new-copied>{copied} <button className="btn-plain" onClick={() => onCreated(code)}>관 설정으로 →</button></p>}
          {code && !codeOk && <p className="warn-text">코드는 영문 대문자 3 ~ 4자입니다.</p>}
          <Flash msg={a.msg} err={a.err} />
        </div>
      )}

      <div className="ad-nt warn">
        <b>새 관은 준비중(비활성) 상태로만 생성됩니다.</b> 업종 · 검수 인력 · 정산 흐름이 준비되기 전에
        열면 등록만 쌓이고 노출이 안 됩니다. 여는 것은 관 설정의 &lsquo;공개 상태&rsquo;에서 합니다 — 만든 뒤 ① 관 설정 › &lsquo;등록 폼 문구&rsquo; ② 업종 › 업종 승인 › &lsquo;새 업종 추가&rsquo; 또는 &lsquo;다른 관 업종 가져오기&rsquo;(다른 관리자 승인) ③ &lsquo;오픈 점검&rsquo; 통과 뒤 엽니다(v10.646).
      </div>

      <div className="ad-dact">
        {step === 0 ? (
          <button className="btn-ok" onClick={() => setStep(1)} data-gwan-next>다음</button>
        ) : (
          <>
            <button className="btn-ok" disabled={!codeOk || !nameOk || a.busy === 'new'} onClick={() => void create()}>
              만들기
            </button>
            <button className="btn-plain" onClick={() => setStep(0)}>← 이전</button>
          </>
        )}
        <button className="btn-plain" onClick={onCancel}>취소</button>
      </div>
    </>
  );
}
