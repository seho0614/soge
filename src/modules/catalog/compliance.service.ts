import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { I18nService } from '../i18n/i18n.service';

/**
 * 제한업종 검사 · 약관 동의.
 *
 * ── 왜 등록 전에 검사하는가 ─────────────────────────────────────────
 * 지금은 등록을 눌러야 막힙니다. 이용자는 다 써 놓고 나서
 * "이 업종은 안 됩니다"를 봅니다 — 그 시간이 통째로 버려집니다.
 *
 * 업종을 고르는 순간 알려주면 다른 업종을 고르거나 그만둡니다.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}

  /**
   * 제한업종 검사.
   *
   * 판정은 DB 가 합니다. 여기서 다시 규칙을 쓰지 않습니다 —
   * 두 곳에 있으면 정책이 바뀔 때 한쪽이 뒤처집니다.
   */
  async check(categoryId?: string, gwanCode?: string, text?: string) {
    const hits = await this.db.query<any>(
      `SELECT r.code, r.name, r.mode, r.legal_basis AS "legalBasis",
              r.block_message AS "message", r.gate_requirement AS "gate"
         FROM restricted_industries r
        WHERE r.is_active
          AND (r.gwan_code IS NULL OR r.gwan_code = $2::text)
          AND (
            -- 카테고리로 직접 걸리는 경우
            EXISTS (SELECT 1 FROM categories c
                     WHERE c.id = $1::uuid AND c.restricted_code = r.code)
            -- 본문에 업종명이 드러나는 경우
            OR ($3::text IS NOT NULL AND position(lower(r.name) in lower($3::text)) > 0)
          )`,
      [categoryId ?? null, gwanCode ?? null, text ?? null]);

    /* AD_ONLY 는 광고만 가능하고 소개·알선은 막힙니다.
     * 등록 검사에서는 BLOCK 과 같이 취급해야 합니다 —
     * "덜 막힌다"로 읽으면 소개가 새어 나갑니다. */
    const blocked = hits.filter(h => h.mode === 'BLOCK' || h.mode === 'AD_ONLY');
    const gated = hits.filter(h => h.mode === 'GATED');
    const adOnly = hits.filter(h => h.mode === 'AD_ONLY');

    return {
      allowed: blocked.length === 0,
      blocked, gated,
      /* 광고로는 길이 있다는 것을 함께 알려 줍니다.
       * "안 됩니다"만 말하면 이용자는 그냥 떠납니다. */
      adOnly,
      // 왜 막혔는지를 이용자 말로 돌려줍니다.
      // "제한업종입니다"만 쓰면 무엇을 고쳐야 할지 모릅니다.
      message: blocked.length
        ? blocked[0].message
        : gated.length
          ? `${gated[0].name}은(는) ${gated[0].gate ?? '자격 확인'} 후에 등록됩니다.`
          : null,
    };
  }

  /** 지금 유효한 제한업종 목록. 등록 폼이 미리 걸러 쓸 수 있습니다. */
  list(gwanCode?: string) {
    return this.db.query(
      `SELECT code, name, mode, legal_basis AS "legalBasis",
              gate_requirement AS "gate", block_message AS "message"
         FROM restricted_industries
        WHERE is_active AND (gwan_code IS NULL OR gwan_code = $1::text)
        ORDER BY mode, code`, [gwanCode ?? null]);
  }

  /* ── 약관 동의 ─────────────────────────────────────────────────── */

  /**
   * 동의해야 하는 약관.
   *
   * **발행된 것만** 냅니다. 초안에 동의를 받으면 나중에 본문이 바뀌어
   * "무엇에 동의했는가"를 답할 수 없습니다.
   */
  async required() {
    const me = RequestCtx.actorId();
    const rows = await this.db.query<Record<string, any>>(
      /* v10.28 (G-214 · D038) — 동의 기록은 바꿀 때마다 한 줄씩 쌓입니다. 지금 상태 = 그 약관의 가장 최근 줄(지금 판) */
      `SELECT t.code, t.title, t.version, t.is_required AS "isRequired",
              t.effective_from AS "effectiveFrom",
              coalesce(c.agreed AND c.term_version = t.version, false) AS agreed,
              (c.term_version IS NOT NULL AND c.term_version <> t.version) AS "oldVersion",
              c.agreed_at AS "changedAt",
              /* v10.28 (재동의) — 마지막으로 동의한 판 · 이 판에서 바뀐 점(D041 change_note) */
              CASE WHEN c.agreed THEN c.term_version END AS "agreedVersion",
              t.change_note AS "changeNote"
         /* v10.161 (D151 · docs/246) — 지금 시행 중인 판. 시행 예정 판은 시행일부터 재동의(그전에는 GET /terms/upcoming 알림) */
         FROM v_terms_current t
         LEFT JOIN v_term_consent_current c ON c.account_id = $1 AND c.term_code = t.code
        WHERE true
          /* v10.28 (G-218 · D042) — 알림(개인정보 처리 위탁 등)은 동의를 받는 항목이 아니라 여기 나오지 않습니다(약관 목록 · 전문에는 「알림」으로) */
          AND NOT t.is_notice
          /* v10.31 (합침 · D090) — 대상이 정해진 약관(파트너 이용약관 audience=PARTNER)은 그 회원에게만. 로그인 전(가입 화면)은 전체 대상만 */
          AND fn_term_applies($1::uuid, t.audience)
        ORDER BY t.display_order`, [me ?? null]);
    /* v10.103 (3-1) — 제목만 참고용 번역(동의는 code 로 받아 원문 판에 기록) */
    return this.i18n.overlay(rows, 'TERM', (r) => `${r.code}@${r.version}`, { title: 'title' }, 'translated');
  }

  /**
   * 동의 기록.
   *
   * 시각과 접속 정보를 함께 남깁니다 — 나중에 "동의한 적 없다"는
   * 분쟁의 근거입니다. 필수 약관은 철회할 수 없습니다.
   */
  async agree(items: Array<{ code: string; agreed: boolean }>) {
    const me = RequestCtx.actorId();
    if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    if (!items?.length) throw new PolicyViolation('NO_ITEMS', '동의할 약관이 없습니다.');

    return this.db.transaction(async () => {
      const saved: string[] = [], unchanged: string[] = [];
      for (const it of items) {
        const [t] = await this.db.query<any>(
          `SELECT version, is_required, is_notice, title, fn_term_applies($2::uuid, audience) AS applies FROM v_terms_current
            WHERE code = $1`, [it.code, me]);
        if (!t) {
          throw new PolicyViolation('NOT_PUBLISHED',
            `${it.code} 는 아직 발행되지 않았습니다. 초안에는 동의할 수 없습니다.`);
        }
        /* v10.31 (합침 · D090) — 파트너 이용약관처럼 대상이 정해진 약관은 그 대상(입점한 파트너의 대표 · 합류 직원)만 동의합니다 */
        if (!t.applies) {
          throw new PolicyViolation('TERM_NOT_APPLICABLE',
            `「${t.title}」은(는) 입점한 파트너(사업자)에게 적용되는 약관입니다. 파트너가 아니면 동의하실 것이 없습니다.`);
        }
        /* v10.28 (G-218 · D042) — 알림에는 동의 · 거부를 기록하지 않습니다(DB 트리거가 마지막 둑) */
        if (t.is_notice) {
          throw new PolicyViolation('NOTICE_ONLY',
            '알림(개인정보 처리 위탁 안내 등)은 동의를 받는 항목이 아닙니다. 따로 동의하실 것이 없습니다.');
        }
        if (t.is_required && !it.agreed) {
          throw new PolicyViolation('REQUIRED_TERM',
            '필수 약관에 동의하지 않으면 서비스를 이용하실 수 없습니다.');
        }
        /* v10.28 (G-214 · D038) — 동의 기록은 바꿀 때마다 한 줄씩 쌓습니다(고치거나 지우지 않음). 지금 판의 가장 최근 줄과
         * 같은 값이면 줄을 더하지 않고(unchanged) · 다르면 새 줄(선택 약관 켜고 끄기). 필수 약관은 위에서 끄기를 막았습니다. */
        const [prev] = await this.db.query<{ agreed: boolean }>(
          `SELECT agreed FROM v_term_consent_current WHERE account_id = $1 AND term_code = $2 AND term_version = $3`,
          [me, it.code, t.version]);
        if (prev && prev.agreed === !!it.agreed) { unchanged.push(it.code); continue; }
        await this.db.query(
          `INSERT INTO term_agreements(account_id, term_code, term_version, agreed, ip, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [me, it.code, t.version, it.agreed,
           RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
        saved.push(it.code);
      }
      return { saved, unchanged,
        note: '동의 시각이 기록되었습니다. 선택 항목은 「약관 동의」 화면에서 언제든 바꾸실 수 있습니다(바꾼 기록이 남습니다).' };
    });
  }

  /** 내 동의 이력. */
  history() {
    return this.db.query(
      `SELECT a.term_code AS "code", t.title, a.term_version AS "version",
              a.agreed, a.agreed_at AS "agreedAt"
         FROM term_agreements a
         LEFT JOIN terms t ON t.code = a.term_code AND t.version = a.term_version
        WHERE a.account_id = $1
        ORDER BY a.agreed_at DESC`, [RequestCtx.actorId() ?? null]);
  }
}
