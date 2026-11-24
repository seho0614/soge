import { DatabaseService } from '../../db/database.service';
import { Forbidden } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.771 (docs/879) 페이지 게시 업무 권한 — 게시 · 예약 · 바로 되돌리기 · A/B 시작 · 끝
 *   SUPER 는 그대로 · 그 밖 운영자는 **사람마다 따로 준** 업무 권한 「관 UI/UX」(gwan-ux) 승인(APPROVE)이 있을 때만(직원 · 권한 › 개별 더하기 · 기한 안)
 *   운영자 권한그룹(R_ADMIN)에 이미 gwan-ux APPROVE 가 들어 있어(D258) 그룹 권한으로 보면 모든 운영자가 게시하게 됨 — 그래서 개별 더하기만 봄
 *   사람 없이 도는 정기 작업(예약 게시 등)은 막지 않음 · 새 업무를 만들지 않음
 * ------------------------------------------------------------------- */
export async function canPublish(db: DatabaseService): Promise<boolean> {
  const me = RequestCtx.actorId();
  if (!me) return true;
  const [sup] = await db.query(`SELECT 1 FROM account_roles WHERE account_id = $1 AND role = 'SUPER'`, [me]);
  if (sup) return true;
  const [g] = await db.query(
    `SELECT 1 FROM perm_account_overrides o WHERE o.account_id = $1 AND o.task_key = 'gwan-ux' AND o.level = 'APPROVE' AND o.effect = 'ALLOW' AND (o.expires_at IS NULL OR o.expires_at > now())`, [me]).catch(() => []);
  return !!g;
}
export async function assertPublisher(db: DatabaseService): Promise<void> {
  if (!(await canPublish(db))) throw new Forbidden('PAGE_PUBLISH_FORBIDDEN', '게시 · 예약 · 되돌리기는 최고 관리자(SUPER)나 「관 UI/UX」 승인 권한을 따로 받은 운영자만 합니다.');
}
