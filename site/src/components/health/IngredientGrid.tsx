'use client';

/**
 * 성분 목록 + 「성분 찾기」 칸 — 시안 SB-HLT-CAT-030 (v10.25 · v10.26 세 묶음).
 *
 * 서버가 준 목록을 화면에서 거릅니다(이름 · 다른 이름). 서버에 다시 묻지 않습니다 — 성분은 많아야 수십 개입니다.
 * 상품이 없는 성분도 숨기지 않고 회색으로 둡니다(시안).
 */
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HltIngredient } from './types';
import { krw } from './util';

/** 성분 칩 한 장 — 시안 chip(): 「월 N원 부터 · N개」 (개월 수가 없는 단품뿐이면 「최저 N원」) */
function Chip({ g }: { g: HltIngredient }) {
  const unit = g.minUnit != null ? Number(g.minUnit) : null;
  const min = g.minPrice != null ? Number(g.minPrice) : null;
  const t = useTranslations('hlt.ingGrid');
  const tc = useTranslations('hlt.common');
  const n = String(g.productCount);
  const b = (c: React.ReactNode) => <b>{c}</b>;
  return (
    <Link href={`/health/i/${encodeURIComponent(g.code)}`} data-ing={g.code}
      className={`hlt-icard${g.productCount ? '' : ' off'}`}>
      <span className="nm">{g.name}</span>
      {g.aliases && g.aliases.length > 0 && <span className="hint">{g.aliases.join(' · ')}</span>}
      <span className="pr">
        {unit != null ? <>{t.rich('unitFrom', { amt: krw(unit), n, b })}</>
          : min != null ? <>{t.rich('minFrom', { amt: krw(min), n, b })}</>
            : g.productCount ? <>{t('soldNow', { n })}</> : t('notCarried')}
      </span>
      {/* v10.31 (시안 「자격 필요」 — 건강기능식품 기능성 원료 · 서버 needsLicense) */}
      {g.needsLicense && <span className="hlt-bdg st" data-license="">{tc('license')}</span>}
    </Link>
  );
}

/**
 * v10.26 — 시안의 세 묶음: 많이 찾는 성분 · 전체 성분 · 성분군(군마다 상자 · 하위 성분).
 * 「성분 찾기」에 글자를 넣으면 묶음 없이 맞는 성분만 한 줄로 보여 드립니다(군 이름 · 하위 성분 모두 찾음).
 * 시안의 「자격 필요」 표는 넣지 않습니다(10/8 확인 B-6).
 */
export function IngredientGrid({ ings }: { ings: HltIngredient[] }) {
  const t = useTranslations('hlt.ingGrid');
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  const hit = (g: HltIngredient) =>
    g.name.toLowerCase().includes(k) || (g.aliases ?? []).some((a) => a.toLowerCase().includes(k));

  const feat = ings.filter((g) => g.featured && !g.isGroup);
  const flat = ings.filter((g) => !g.isGroup && !g.parent && !g.featured);
  const groups = ings.filter((g) => g.isGroup);
  const found = k ? ings.filter(hit) : [];

  return (
    <>
      <label className="hlt-find">
        <span className="hint">{t('find')}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('findPh')} aria-label={t('find')} />
      </label>
      {k ? (
        found.length === 0
          ? <p className="hint" role="status">{t('noMatch', { q: q.trim() })}</p>
          : <div className="hlt-igrid" data-ing-found>{found.map((g) => <Chip key={g.code} g={g} />)}</div>
      ) : (
        <>
          {feat.length > 0 && (
            <section className="hlt-sec" data-ing-sec="featured">
              <h2>{t('featured')}</h2>
              <div className="hlt-igrid">{feat.map((g) => <Chip key={g.code} g={g} />)}</div>
            </section>
          )}
          <section className="hlt-sec" data-ing-sec="all">
            <h2>{t('all')}</h2>
            <div className="hlt-igrid">{flat.map((g) => <Chip key={g.code} g={g} />)}</div>
          </section>
          {groups.length > 0 && (
            <section className="hlt-sec" data-ing-sec="groups">
              <h2>{t('groups')}</h2>
              {groups.map((g) => {
                const kids = ings.filter((x) => x.parent === g.code);
                return (
                  <div key={g.code} className="hlt-box" style={{ marginBottom: 10 }} data-ing-group={g.code}>
                    <h3><Link href={`/health/i/${encodeURIComponent(g.code)}`}>{g.name}</Link> <span className="hlt-sm hlt-mut3">{t('kinds', { n: String(kids.length) })}</span></h3>
                    <div className="hlt-igrid" style={{ marginTop: 10 }}>{kids.map((x) => <Chip key={x.code} g={x} />)}</div>
                  </div>
                );
              })}
              <p className="hlt-sm hlt-mut3">{t.rich('treeNote', { b: (c) => <b>{c}</b> })}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
