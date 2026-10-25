import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { ApplyForm } from '@/components/ApplyForm';
import { AxisApply } from '@/components/AxisApply';
import { Bg, Note, Pgh, Tw, bizNo } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('apply') };
}

/** v10.32 — 시안 「STEP 01 · 사업자 확인」 표의 값(GET /me/account — 본인 것만) */
interface Acc {
  account: { email: string; name: string; phone: string | null; identityVerifiedAt: string | null };
  business: { bizRegNo: string; companyName: string | null; ceoName: string | null; bizType: string | null; bizItem: string | null; verifiedAt: string | null; ntsStatus: string | null } | null;
}
const maskPhone = (v: string | null) => (v ? v.replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3') : null);
const maskEmail = (e: string) => e.replace(/^(.{3})[^@]*/, '$1****');

interface Dash { applied: boolean; status?: string; company?: string; note?: string; rejectReason?: string | null }

/**
 * SB-PTC-CTR-100 입점 신청 — v10.29 시안 scPtnApply 배치(.nsteps 3단계 → .fset 「입점할 축」 → 단추 줄)
 *
 * ── 3단계입니다 ─────────────────────────────────────────────────────
 *   1. 본인 · 사업자 확인  본인인증이면 개인으로, 사업자 인증이면 사업자로 신청합니다(v10.38 · P2P — 사업자 인증은 선택)
 *   2. 입점 신청     업종과 지역을 정합니다
 *   3. 운영 승인     사람이 봅니다 — 자동 승인은 두지 않았습니다
 *
 * 대조가 맞아도 **명의 도용은 거를 수 없어서** 마지막은 사람이 봅니다.
 * v10.32 — 시안의 「STEP 01 값 · 확인」 표는 이 계정의 실제 값 · 상태로 넣었습니다(개발 현황 칩 대신). 「본사 승인 화면 보기」(BO) 단추 · 워크스루는 시연 전용이라 그대로 둡니다.
 */
export default async function ApplyPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partner.apply');
  const B = (c: React.ReactNode) => <b>{c}</b>;

  const [d, acc] = await Promise.all([
    apiGet<Dash>('/partner/dashboard', 0).catch(() => null),
    apiGetPersonal<Acc>('/me/account').catch(() => null),
  ]);
  /* v10.38 (D096 · P2P) — 계정 기준. 본인인증 개인은 사업자 정보 없이 「개인 활동 정보」로 신청합니다 */
  const actorOk = !!(p.identityVerifiedAt || p.businessVerifiedAt);
  const asBiz = !!p.businessVerifiedAt;
  /* 반려된 신청은 고쳐서 다시 낼 수 있습니다 — 사유를 먼저 보여 드립니다. */
  const rejected = d?.status === 'REJECTED';
  const applied = !!d?.applied && !rejected;
  const active = d?.status === 'ACTIVE';
  const cls = (done: boolean, now: boolean) => (done ? 'done' : now ? 'on' : undefined);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />

      <ol className="pt-nsteps">
        <li className={cls(actorOk, !actorOk)}>
          <span className="n">1</span>
          <div>
            <b>{t('s1')}</b><Bg tone={actorOk ? 'ok' : 'wait'}>{asBiz ? t('s1Biz') : actorOk ? t('s1Id') : t('need')}</Bg>
            <p>{t.rich('s1P', { b: B })}</p>
            {!actorOk ? <p><Link className="pt-bp sm" href="/verify">{t('goVerify')}</Link></p> : null}
          </div>
        </li>

        <li className={cls(applied, actorOk && !applied)}>
          <span className="n">2</span>
          <div>
            <b>{t('s2')}</b><Bg tone={applied ? 'ok' : rejected ? 'no' : 'off'}>{applied ? t('received') : rejected ? t('rejected') : t('waiting')}</Bg>
            <p>{t('s2P')}</p>
            {rejected ? (
              <div className="note warn" id="partner-rejected">
                <b>{t('rejTitle')}</b>
                {d?.rejectReason ? <><br />{t('rejReason', { reason: d.rejectReason })}</> : null}
                <br />{t('rejFix')}
              </div>
            ) : null}
            {actorOk && !applied ? <ApplyForm /> : null}
          </div>
        </li>

        <li className={cls(active, applied && !active)}>
          <span className="n">3</span>
          <div>
            <b>{t('s3')}</b><Bg tone={active ? 'ok' : applied ? 'wait' : 'off'}>{active ? t('approved') : applied ? t('reviewing') : t('waiting')}</Bg>
            <p>
              {t.rich('s3P', { strong: (c) => <strong>{c}</strong> })}
            </p>
            {applied && !active ? (
              <div className="note info">{t('s3Wait')}</div>
            ) : null}
          </div>
        </li>
      </ol>

      {/* 2026-10-02 — 안심소개 축별 입점 (서버 D018). 본인 · 사업자 확인 뒤에 고릅니다(v10.38 · 개인 가능). 입점 승인과 따로 축마다 심사합니다. */}
      {/* 시안 .fset 「입점할 축 — 여러 개 고를 수 있고 축마다 따로 승인합니다」 자리. 부품(AxisApply)이 제 제목 · 표를 그립니다 */}
      {actorOk ? <AxisApply /> : <Note kind="info">{t.rich('axisFirst', { b: B })}</Note>}

      {/* v10.32 — 시안 「STEP 01 · 사업자 확인」 표 + 알림 안내 띠. 시안의 개발 현황 칩(국세청 키 없음 · PASS 미연동) 대신 이 계정의 실제 상태를 적습니다 */}
      {acc && (
        <section className="pt-fset" data-apply-step1="">
          <h3>{t('step1')}</h3>
          <Tw head={[t('thItem'), t('thValue'), t('thCheck')]}>
            <tr><td><b>{t('bizNo')}</b></td><td>{acc.business ? bizNo(acc.business.bizRegNo) : '—'}</td>
              <td>{acc.business?.verifiedAt ? <Bg tone="ok">{t('ntsOk')}</Bg> : acc.business ? <Bg tone="wait">{t('checkWait')}</Bg> : <Bg tone="off">{t('noBiz')}</Bg>}</td></tr>
            <tr><td><b>{t('company')}</b></td><td>{acc.business?.companyName ?? '—'}</td><td>{acc.business?.companyName ? <Bg tone="ok">{t('saved')}</Bg> : <Bg tone="off">{t('none')}</Bg>}</td></tr>
            <tr><td><b>{t('ceo')}</b></td><td>{acc.business?.ceoName ?? '—'}</td><td>{acc.business?.ceoName ? <Bg tone="ok">{t('saved')}</Bg> : <Bg tone="off">{t('none')}</Bg>}</td></tr>
            <tr><td><b>{t('bizType')}</b></td><td>{[acc.business?.bizType, acc.business?.bizItem].filter(Boolean).join(' · ') || '—'}</td><td>{acc.business?.bizType || acc.business?.bizItem ? <Bg tone="ok">{t('saved')}</Bg> : <Bg tone="off">{t('none')}</Bg>}</td></tr>
            <tr><td><b>{t('manager')}</b></td><td>{[acc.account.name, maskPhone(acc.account.phone)].filter(Boolean).join(' · ')}</td>
              <td>{acc.account.identityVerifiedAt ? <Bg tone="ok">{t('idOk')}</Bg> : <Bg tone="wait">{t('idNeed')}</Bg>}</td></tr>
            <tr><td><b>{t('loginId')}</b></td><td>{maskEmail(acc.account.email)}</td><td><Bg tone="ok">{t('emailIsId')}</Bg></td></tr>
          </Tw>
        </section>
      )}
      <Note kind="warn" data-apply-notify="">{t.rich('notify', { b: B })}</Note>

      {active ? (
        <Note kind="ok">
          <b>{t('already')}</b> <Link href="/partner">{t('toCenter')}</Link>
        </Note>
      ) : null}

      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/listings">{t('myListings')}</Link>
        <Link className="pt-bo" href="/partner">{t('home')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
