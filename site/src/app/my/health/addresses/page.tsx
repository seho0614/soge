/** SB-HLT-ADR-010 배송지 관리 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltAddress } from '@/components/health/types';
import { MyHltNav } from '@/components/health/MyHltNav';
import { AddressForm } from '@/components/health/AddressForm';
import { AddressActions } from '@/components/health/AddressActions';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hAddr.meta') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ next?: string }> };

/**
 * 배송지 관리 — GET · POST /me/health/addresses,
 * PATCH /me/health/addresses/{id}/default (기본으로) · DELETE /me/health/addresses/{id} (삭제) — D002.
 * 진행 중인 주문이 가리키는 배송지는 지울 수 없습니다(서버가 막고 사유를 줍니다).
 */
export default async function MyHltAddresses({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  /* 돌아갈 곳은 사이트 안 경로만 받습니다 — 바깥 주소로 튕기지 않게 */
  const raw = (await searchParams).next;
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;

  let rows: HltAddress[] | null = null;
  let err: string | null = null;
  try {
    rows = await apiGetPersonal<HltAddress[]>('/me/health/addresses');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : t('hAddr.loadFail');
  }

  return (
    <><div className="hlt">
      <MyHltNav on="addresses" />
      <div className="page-head">
        <h1>{t('hNav.addresses')}</h1>
        {next && <Link className="hlt-btn sm" href={next}>{t('hAddr.back')}</Link>}
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t('hAddr.empty')}</p>
      ) : (
        <div className="rows">
          {rows.map((a) => (
            <div key={a.id} className="hlt-box">
              <div className="hlt-ord-h">
                <span>{a.isDefault && <span className="hlt-bdg">{t('hAddr.default')}</span>} <b>{a.label || t('hAddr.addr')}</b></span>
                <span className="hint">{a.receiver} · {a.phone}</span>
              </div>
              <p>({a.zipcode}) {a.addr1} {a.addr2 ?? ''}</p>
              <AddressActions id={a.id} isDefault={a.isDefault} label={a.label || a.addr1} />
            </div>
          ))}
        </div>
      )}

      <section className="hlt-box hlt-gap">
        <h3>{t('hAddr.new')}</h3>
        <AddressForm next={next} />
      </section>
    </div><i hidden data-root-end="" /></>
  );
}
