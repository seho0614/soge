import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Setting { key: string; value: string | null; description: string }
interface Integration { code: string; name: string; status: string }

/** 스위치 하나 — 「실제로 돌리는 쪽(go)」으로 바꿀 때 서버가 조건을 봅니다(admin.service.ts SWITCH_RULES 와 같은 조건) */
interface Sw { key: string; label: string; go: 'on' | 'off'; goLabel: string; backLabel: string; integ?: string[]; need?: string[]; bank?: boolean; why: string; warn: string }

const SWITCHES: Sw[] = [
  { key: 'assume.etax', label: '전자세금계산서 간주', go: 'off', goLabel: '간주 끄기(국세청 실제 전송)', backLabel: '간주 다시 켜기',
    integ: ['ETAX'], need: ['TESTING', 'LIVE'], why: '전자세금계산서 연동이 시험 중이거나 연결됨 · 업체 주소 · 키(ETAX_URL · ETAX_KEY — 아래 「간주 끄기 전 설정 확인」이 켜져 있으면 서버가 봄)',
    warn: '끄면 「발행」이 국세청으로 실제 전송됩니다. 업체 시험 주소로 1건 전송 · 조회 · 취소를 먼저 확인하십시오(docs/111 6-3).' },
  { key: 'assume.broker', label: '중개사 인증 간주', go: 'off', goLabel: '간주 끄기(국토부 실제 대조)', backLabel: '간주 다시 켜기',
    integ: ['BROKER'], need: ['TESTING', 'LIVE'], why: '국토부 중개사 대조가 시험 중이거나 연결됨',
    warn: '끄면 중개사 자격 심사가 국토부 자료와 실제로 대조됩니다. 실제 중개사 1건 대조 결과를 먼저 확인하십시오.' },
  { key: 'assume.payment', label: '결제 간주', go: 'off', goLabel: '간주 끄기(실제 결제)', backLabel: '간주 다시 켜기',
    integ: ['PG'], need: ['TESTING', 'LIVE'], why: '전자결제(PG)가 시험 중이거나 연결됨',
    warn: '끄면 결제 화면의 「간주」 표시가 사라지고 오픈 점검이 실제 결제를 기준으로 봅니다. 실결제 · 부분 취소를 먼저 실측하십시오.' },
  { key: 'assume.bank', label: '수금 계좌 간주', go: 'off', goLabel: '간주 끄기', backLabel: '간주 다시 켜기',
    bank: true, why: '사이트 기본 정보에 실제 수금 계좌 세 항목',
    warn: '실제 수금 계좌 세 항목(은행 · 계좌 · 예금주)을 넣으면 저절로 꺼집니다. 손으로 끄는 것은 계좌를 넣은 뒤에만 됩니다.' },
  { key: 'feature.referral_fee', label: '소개비 기능', go: 'on', goLabel: '소개비 켜기', backLabel: '소개비 끄기',
    integ: ['PASS', 'BANK'], need: ['LIVE'], why: '본인인증 · 1원 계좌인증이 모두 연결됨(LIVE)',
    warn: '켜면 거래 확정 때 소개비 약정 · 정산 줄이 만들어집니다. 본인인증 · 계좌인증이 실제로 도는지 먼저 확인하십시오.' },
];

/**
 * 오픈 체크리스트 › 관리자 스위치 (v10.65 · docs/121)
 *
 * 간주 모드 4종과 소개비 스위치를 운영 화면에서 켜고 끕니다. 전에는 운영 화면에 단추가 없어 관리자 API 를 손으로 불러야 했습니다(docs/111 6-2).
 *   · 값 저장은 전과 같은 PATCH /admin/site-settings — 바꾼 사람 · 시각이 감사 기록 SITE_SETTING_UPDATE 로 남습니다.
 *   · 「실제로 돌리는 쪽」으로 바꿀 때는 한 번 더 누르게 하고(확인 칸), 서버도 조건을 봅니다(SWITCH_PREREQ). 되돌리는 쪽은 바로 됩니다.
 *   · v10.153 (D146 · docs/233) — 「간주 끄기 전 설정 확인」(etax.require_config · SUPER) 켜져 있으면 ETAX_URL · ETAX_KEY 없이 세금계산서 간주를 못 끔(ETAX_CONFIG_FIRST)
 */
export function Switches() {
  const settings = useApi<Setting[]>('/admin/site-settings');
  const integ = useApi<Integration[]>('/admin/integrations');
  const a = useAct();
  const [ask, setAsk] = useState<string | null>(null);
  const isSuper = tokenRoles().includes('SUPER');

  if (settings.error) return <ErrorView error={settings.error} />;
  const val = (k: string) => (settings.data ?? []).find((s) => s.key === k)?.value?.trim() ?? '';
  const st = (c: string) => (integ.data ?? []).find((i) => i.code === c)?.status ?? '—';
  /* 계좌번호는 서버가 가려서 보내므로(끝 4자리만) 「들어 있는지」 · 「시험용 글자」만 봅니다 — 999999- 시험 계좌는 서버가 마저 거릅니다 */
  const bankReady = ['company.bank_name', 'company.bank_account', 'company.bank_holder']
    .every((k) => { const v = val(k); return v !== '' && !v.includes('시험용'); });
  const ready = (s: Sw) => (s.integ ? s.integ.every((c) => s.need!.includes(st(c))) : true) && (!s.bank || bankReady);

  const save = (s: Sw, v: string) => a.run(s.key, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: s.key, value: v }) }),
    () => { setAsk(null); settings.reload(); }, `${s.label} — ${v === 'on' ? '켰습니다' : '껐습니다'}. 감사 기록에 남았습니다.`);

  return (
    <section className="card" data-admin-switches>
      <h2 className="ad-s2">관리자 스위치 <small className="dim">간주 모드 4종 · 소개비 — 끄는 순서: 전자세금계산서 → 중개사 → 결제 → 수금 계좌 → 소개비 켜기(docs/111 6-3)</small></h2>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>스위치</th><th>지금</th><th>바꾸는 조건</th><th style={{ width: 230 }}>바꾸기</th></tr></thead>
        <tbody>{SWITCHES.map((s) => {
          const v = val(s.key); const atGo = v === s.go; const ok = ready(s);
          return (
            <tr key={s.key} data-switch={s.key}>
              <td><b>{s.label}</b><br /><code className="dim">{s.key}</code></td>
              <td><span className={`ad-bg ${s.key.startsWith('assume.') ? (v === 'on' ? 'no' : 'ok') : (v === 'on' ? 'ok' : 'no')}`}>{v || '값 없음'}</span></td>
              <td>{s.why}{s.integ && <><br /><span className="dim">지금: {s.integ.map((c) => `${c} ${st(c)}`).join(' · ')}</span></>}
                {s.bank && <><br /><span className="dim">지금: {bankReady ? '세 항목 들어 있음' : '비어 있거나 시험용'}</span></>}</td>
              <td>
                {atGo
                  ? <button className="btn-plain" disabled={a.busy === s.key} onClick={() => void save(s, s.go === 'on' ? 'off' : 'on')}>{s.backLabel}</button>
                  : ask === s.key
                    ? <div>
                        <p className="ad-nt warn" style={{ margin: '0 0 6px' }}>{s.warn}</p>
                        <button className="btn-ok" disabled={a.busy === s.key} onClick={() => void save(s, s.go)} data-switch-confirm>확인 — {s.goLabel}</button>{' '}
                        <button className="btn-plain" onClick={() => setAsk(null)}>그만두기</button>
                      </div>
                    : <button className="btn-ok" disabled={!ok || a.busy === s.key} onClick={() => setAsk(s.key)}
                              title={ok ? undefined : `조건이 맞지 않습니다 — ${s.why}`}>{s.goLabel}</button>}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="hint" style={{ marginTop: 6 }} data-etax-require-config={val('etax.require_config') === 'off' ? 'off' : 'on'}>
        간주 끄기 전 설정 확인(전자세금계산서): <b>{val('etax.require_config') === 'off' ? '꺼짐 — 연동 상태만 봄(주소 · 키가 없으면 발행이 멈출 수 있음)' : '켜짐 — 업체 주소 · 키(ETAX_URL · ETAX_KEY)가 있어야 끔'}</b>
        {isSuper && <>{' '}<button className="btn-plain" disabled={a.busy === 'etax.require_config'} data-etax-require-flip
          onClick={() => { const on = val('etax.require_config') !== 'off'; if (!on || window.confirm('「간주 끄기 전 설정 확인」을 끌까요? 업체 주소 · 키 없이 간주를 끄면 세금계산서 발행이 멈춥니다.'))
            void a.run('etax.require_config', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'etax.require_config', value: on ? 'off' : 'on' }) }),
              () => settings.reload(), on ? '간주 끄기 전 설정 확인을 껐습니다.' : '간주 끄기 전 설정 확인을 켰습니다.'); }}>{val('etax.require_config') === 'off' ? '켜기' : '끄기'}</button></>}
      </p>
      <p className="dim" style={{ marginTop: 6 }}>간주 모드를 하나라도 남긴 채 사용자 웹 접근 제한을 풀지 마십시오. 다 끈 뒤 오픈 점검(open:check)의 「간주 모드」가 0 인지 확인합니다.</p>
    </section>
  );
}
