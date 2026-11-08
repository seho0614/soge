import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';
import { GeoService } from '../../common/geo/geo.service';
import { coordToRegion, GeoFail } from '../../common/geo/kakao-local.provider';

/* ---------------------------------------------------------------------
 * v10.164 (D154 · docs/253) — 소개광장 동네 인증(GPS 1회 → 행정동만)
 *
 *   켜짐   설정 community.town_verify(처음 off) — 위치기반서비스사업 신고 · 위치기반 약관 게시 뒤 SUPER 가 켬
 *   동의   지금 시행 중인 위치기반서비스 이용약관(LOCATION · v_terms_current)에 동의한 회원만
 *   좌표   요청 본문의 위도 · 경도는 카카오 「좌표 → 행정구역」 한 번에만 쓰고 **저장 · 기록하지 않음**(감사 · 오류 글에도 넣지 않음)
 *   저장   member_towns(행정동 코드 · 이름 · 인증일 · 만료 30일) · town_verify_logs(이용 확인 기록 · 결과 행정동 · 실패 종류)
 * ------------------------------------------------------------------- */
export const TOWN_DAYS = 30;

@Injectable()
export class TownVerifyService {
  constructor(private readonly db: DatabaseService, private readonly geo: GeoService) {}
  private get me() { return RequestCtx.actorId(); }

  private async on() {
    const [r] = await this.db.query<{ is_on: boolean }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'community.town_verify'), 'off') = 'on' AS is_on`);
    return !!r?.is_on;
  }

  /** 공개 — 켜짐 · 유효 기간 (사용자 웹이 단추를 보일지) */
  async config() {
    return { enabled: await this.on(), days: TOWN_DAYS };
  }

  /** 내 동네 — 만료 전 인증 · 약관 동의 여부 */
  async mine() {
    const [t] = await this.db.query(
      `SELECT adm_code AS "admCode", adm_name AS "admName", verified_at AS "verifiedAt", expires_at AS "expiresAt"
         FROM v_member_town_current WHERE account_id = $1`, [this.me]);
    return { enabled: await this.on(), consent: await this.consented(), town: t ?? null };
  }

  private async consented() {
    const [c] = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM v_terms_current t
                        JOIN v_term_consent_current g ON g.term_code = t.code AND g.term_version = t.version
                       WHERE t.code = 'LOCATION' AND g.account_id = $1 AND g.agreed) AS ok`, [this.me]);
    return !!c?.ok;
  }

  async verify(lat: number, lng: number) {
    if (!(await this.on())) throw new PolicyViolation('TOWN_VERIFY_OFF', '동네 인증이 아직 열리지 않았습니다.');
    if (!(await this.consented())) {
      throw new PolicyViolation('TOWN_CONSENT_REQUIRED', '위치기반서비스 이용약관에 동의한 뒤 동네 인증을 할 수 있습니다.');
    }
    const key = await this.geo.restKey();
    if (!key) throw new PolicyViolation('TOWN_GEO_NOT_READY', '동네 인증 준비가 끝나지 않았습니다 — 잠시 뒤 다시 해 주십시오.');
    const r = await coordToRegion(key, Number(lat), Number(lng));
    if (!r.ok) {
      const f = r as GeoFail;   // ts-node strict:false — 실패 쪽은 이렇게 꺼냄(kakao-local.provider 주석)
      await this.db.query(`INSERT INTO town_verify_logs (account_id, ok, fail_kind) VALUES ($1, false, $2)`, [this.me, f.kind]);
      throw new PolicyViolation('TOWN_NOT_FOUND', f.kind === 'NOT_FOUND'
        ? '이 위치의 동네를 찾지 못했습니다 — 국내에서 다시 해 주십시오.'
        : '동네를 확인하지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
    }
    const ok = r as { ok: true; code: string; name: string };
    return this.db.transaction(async () => {
      await this.db.query(
        `INSERT INTO member_towns (account_id, adm_code, adm_name, verified_at, expires_at)
         VALUES ($1, $2, $3, now(), now() + make_interval(days => $4))
         ON CONFLICT (account_id) DO UPDATE
           SET adm_code = EXCLUDED.adm_code, adm_name = EXCLUDED.adm_name, verified_at = EXCLUDED.verified_at, expires_at = EXCLUDED.expires_at`,
        [this.me, ok.code, ok.name, TOWN_DAYS]);
      await this.db.query(`INSERT INTO town_verify_logs (account_id, adm_code, ok) VALUES ($1, $2, true)`, [this.me, ok.code]);
      return this.mine();
    });
  }

  /** v10.210 (D187 · docs/335) — 운영 화면 준비 상태: 켜려면 ① 위치 약관 게시 · 시행 ② 신고번호 ③ 카카오 REST 키 — ①② 는 DB 가 켜기를 막음 */
  async readiness() {
    const [t] = await this.db.query<{ version: string | null; effectiveFrom: Date | null; draftVersion: string | null; draftStatus: string | null; draftBody: string | null }>(
      `SELECT (SELECT version FROM terms WHERE code = 'LOCATION' AND status = 'PUBLISHED' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1) AS version,
              (SELECT effective_from FROM terms WHERE code = 'LOCATION' AND status = 'PUBLISHED' AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1) AS "effectiveFrom",
              d.version AS "draftVersion", d.status AS "draftStatus", d.body AS "draftBody"
         FROM (SELECT 1) x
         LEFT JOIN LATERAL (SELECT version, status, body FROM terms WHERE code = 'LOCATION' AND status IN ('DRAFT', 'LEGAL_REVIEW')
                             ORDER BY length(version) DESC, version DESC LIMIT 1) d ON true`);
    const [s] = await this.db.query<{ reportNo: string | null }>(`SELECT value AS "reportNo" FROM site_settings WHERE key = 'community.lbs_report_no'`);
    /* v10.212 — 〔시행일〕은 게시 때 시행일로 채워짐(약관 표와 같은 셈 · 게시를 막지 않음) */
    const holes = [...new Set((t?.draftBody ?? '').match(/〔[^〕]*〕/g) ?? [])].filter((h) => h !== '〔시행일〕');
    const terms = !!t?.version, report = !!s?.reportNo?.trim(), kakao = !!(await this.geo.restKey());
    return {
      switchOn: await this.on(),
      terms: { published: terms, version: t?.version ?? null, effectiveFrom: t?.effectiveFrom ?? null,
               draft: t?.draftVersion ? { version: t.draftVersion, status: t.draftStatus as string, holes } : null },
      reportNo: { set: report },
      kakao: { set: kakao },
      canTurnOn: terms && report,
      ready: terms && report && kakao,
    };
  }

  /** 인증 지우기 — 회원이 언제든(동의 철회와 함께) */
  async remove() {
    const rows = await this.db.query(`DELETE FROM member_towns WHERE account_id = $1 RETURNING account_id`, [this.me]);
    return { removed: rows.length };
  }
}
