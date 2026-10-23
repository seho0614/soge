import { useState } from 'react';
import { api } from '../../../lib/api';
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
  ['관 이름 · 코드 · 서브도메인', '코드와 소개 대상은 생성 후 바꿀 수 없습니다.'],
  ['업종 · 등급', '카테고리가 등급을 결정합니다 (A-11). 업종 승인 화면에서 붙입니다.'],
  ['소개비 부담 주체', '업종마다 정합니다 — 업종 관리에서 붙인 업종에 부담 주체(판매자 · 구매자)를 정합니다.'],
  ['오픈 체크리스트', '전부 통과해야 준비중 → 운영중으로 넘어갑니다.'],
];

export function GwanNew({ onCreated, onCancel }: { onCreated: (code: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState<string>('GOODS');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [step, setStep] = useState<0 | 1>(0);   // v10.32 — 시안 위자드: 1단계(소개 대상) → 다음 → 2단계(이름 · 코드)
  const a = useAct();

  const codeOk = /^[A-Z]{3}$/.test(code);
  const nameOk = name.trim().length >= 2 && name.trim().length <= 20;

  async function create() {
    const t = TARGETS.find((x) => x[0] === target)?.[1];
    const r = await a.run('new', () => api<{ code?: string }>('/admin/gwans', {
      method: 'POST',
      body: JSON.stringify({
        code, name: name.trim(),
        // 소개 대상은 아직 서버 필드가 없어 설명 앞에 적어 둡니다(보고서 참조)
        description: [t ? `[${t}]` : '', desc.trim()].filter(Boolean).join(' ') || undefined,
      }),
    }), undefined, '관을 만들었습니다. 비활성(준비중)으로 만들어집니다 — 업종을 붙인 뒤 여십시오.');
    if (r) onCreated(code);
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
              <span>코드 (영문 대문자 3자 · 생성 후 변경 불가)</span>
              <input value={code} maxLength={3} placeholder="예) EDU"
                     onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            </label>
            <label>
              <span>관 이름 (2~20자)</span>
              <input value={name} maxLength={20} placeholder="예) 소개배움" onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명 (메인 카드에 나갑니다)</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          {code && !codeOk && <p className="warn-text">코드는 영문 대문자 3자입니다.</p>}
          <Flash msg={a.msg} err={a.err} />
        </div>
      )}

      <div className="ad-nt warn">
        <b>새 관은 준비중(비활성) 상태로만 생성됩니다.</b> 업종 · 검수 인력 · 정산 흐름이 준비되기 전에
        열면 등록만 쌓이고 노출이 안 됩니다. 여는 것은 관 설정의 &lsquo;공개 상태&rsquo;에서 합니다 — 3~5단계(업종 · 부담 주체 · 오픈 체크리스트)는 만든 뒤 관 설정에서 합니다.
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
