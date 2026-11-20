import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';
import { contentDisposition } from '../file/sniff';
import { LSY_UUID_RE, lsyReadAll, lsyReason, lsySettings } from './common';

/* ---------------------------------------------------------------------
 * v10.526 (D279 · docs/664) 매물 동영상 — 짧은 영상 1개 · 스위치 lsy.video(처음 꺼짐)
 *   ① 올리기는 기존 파일 길 그대로(POST /files → PUT → complete · 서버가 크기 · SHA-256 · 매직바이트 확인) · 새 파일 용도 LISTING_VIDEO(MP4 만 · DB 상한 50MB)
 *   ② 붙이기 POST /me/lsy/listings/{id}/video — 내 매물 · 내가 올린 READY 파일만 · lsy.video_max_mb(30) · lsy.video_max_sec(60)
 *      길이는 서버가 MP4 머리(moov › mvhd)를 읽어 잼(보낸 값을 믿지 않음) · 못 읽으면 422 · 매물마다 살아 있는 영상 1개(새로 붙이면 앞 것은 REPLACED)
 *   ③ 검수 — 운영(검수 › 매물 동영상)이 보고 승인 · 반려(사유) · 승인한 것만 공개 · 매물을 고쳐도 영상 승인은 그대로(영상이 바뀌면 다시 검수)
 *   ④ 공개 GET /site/lsy/listings/{id}/video — 스위치 켬 · 매물 게시 중 · 영상 승인 · 파일 READY 일 때만 5분짜리 주소(저장소 서명 주소 · LOCAL 은 토큰 주소)
 *      fn_file_can_read 는 고치지 않음 — 공개 주소는 이 API 가 조건을 보고 직접 만듦 · 주인 · 운영(ADMIN · SUPER · REVIEWER)은 기존 GET /files/{id} 로 엶
 *   ⑤ 붙은 영상 파일은 지우지 못함(trg_lsy_video_file_guard) — 먼저 「영상 빼기」
 * ------------------------------------------------------------------- */

export const VIDEO_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'REPLACED', 'REMOVED'] as const;
const LIVE = ['PENDING', 'APPROVED'];

export interface Mp4Meta { durationMs: number; width: number | null; height: number | null }

/** MP4(ISO BMFF) 머리 읽기 — moov › mvhd 의 길이 · 첫 영상 trak › tkhd 의 가로 · 세로 · 못 읽으면 null */
export function mp4Meta(buf: Buffer): Mp4Meta | null {
  const boxes = (start: number, end: number): Array<{ type: string; at: number; size: number; body: number }> => {
    const out: Array<{ type: string; at: number; size: number; body: number }> = [];
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = buf.subarray(i + 4, i + 8).toString('latin1');
      let body = i + 8;
      if (size === 1) {
        if (i + 16 > end) break;
        const big = Number(buf.readBigUInt64BE(i + 8));
        if (!Number.isSafeInteger(big)) break;
        size = big; body = i + 16;
      } else if (size === 0) size = end - i;
      if (size < 8 || i + size > end) { out.push({ type, at: i, size: end - i, body }); break; }
      out.push({ type, at: i, size, body });
      i += size;
    }
    return out;
  };
  const top = boxes(0, buf.length);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return null;
  const kids = boxes(moov.body, moov.at + moov.size);
  const mvhd = kids.find((b) => b.type === 'mvhd');
  if (!mvhd || mvhd.body + 32 > buf.length) return null;
  const v = buf[mvhd.body]!;
  let scale: number, dur: number;
  if (v === 1) {
    if (mvhd.body + 36 > buf.length) return null;
    scale = buf.readUInt32BE(mvhd.body + 20); dur = Number(buf.readBigUInt64BE(mvhd.body + 24));
  } else {
    scale = buf.readUInt32BE(mvhd.body + 12); dur = buf.readUInt32BE(mvhd.body + 16);
  }
  if (!scale || !Number.isFinite(dur) || dur <= 0) return null;
  let width: number | null = null, height: number | null = null;
  for (const t of kids.filter((b) => b.type === 'trak')) {
    const tk = boxes(t.body, t.at + t.size).find((b) => b.type === 'tkhd');
    if (!tk) continue;
    const off = buf[tk.body] === 1 ? 88 : 76;
    if (tk.body + off + 8 > buf.length) continue;
    const w = buf.readUInt32BE(tk.body + off) / 65536, h = buf.readUInt32BE(tk.body + off + 4) / 65536;
    if (w > 0 && h > 0) { width = Math.round(w); height = Math.round(h); break; }
  }
  return { durationMs: Math.round((dur / scale) * 1000), width, height };
}

/** 회원 — 영상을 붙일 수 있는 내 매물 · 살아 있는 영상 · 사진 경고 수 */
export async function myVideos(db: DatabaseService, me: string) {
  const s = await lsySettings(db);
  const rows = await db.query<{ id: string; title: string; status: string; listingNo: number; videoId: string | null; videoState: string | null; durationMs: number | null;
    rejectReason: string | null; photoWarn: number }>(
    `SELECT l.id::text, l.title, l.status, l.listing_no AS "listingNo",
            v.id::text AS "videoId", v.state AS "videoState", v.duration_ms AS "durationMs",
            (SELECT x.decide_reason FROM lsy_listing_videos x WHERE x.listing_id = l.id AND x.state = 'REJECTED' ORDER BY x.id DESC LIMIT 1) AS "rejectReason",
            (SELECT count(*)::int FROM lsy_photo_checks c WHERE c.listing_id = l.id AND cardinality(c.warnings) > 0) AS "photoWarn"
       FROM listings l
       LEFT JOIN lsy_listing_videos v ON v.listing_id = l.id AND v.state IN ('PENDING', 'APPROVED')
      WHERE l.owner_account_id = $1 AND l.status IN ('PUBLISHED', 'IN_REVIEW', 'DRAFT', 'REJECTED')
      ORDER BY l.updated_at DESC LIMIT 200`, [me]);
  return { on: s.video, maxMb: s.videoMaxMb, maxSec: s.videoMaxSec, photoCheck: s.photoCheck, items: rows };
}

/** 회원 — 영상 붙이기(검수 대기) */
export async function attachVideo(db: DatabaseService, me: string, listingId: string, d: { fileId?: string }) {
  const s = await lsySettings(db);
  if (!s.video) throw new PolicyViolation('LSY_VIDEO_OFF', '지금은 매물 동영상을 쓸 수 없습니다.');
  if (!LSY_UUID_RE.test(listingId)) throw new NotFound('매물을 찾을 수 없습니다.');
  const [l] = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1 AND owner_account_id = $2`, [listingId, me]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  if (!['PUBLISHED', 'IN_REVIEW', 'DRAFT', 'REJECTED'].includes(l.status)) throw new StateConflict('LSY_VIDEO_LISTING_STATE', '내렸거나 정지된 매물에는 동영상을 붙일 수 없습니다.');
  const fileId = String(d.fileId ?? '');
  if (!LSY_UUID_RE.test(fileId)) throw new PolicyViolation('LSY_VIDEO_FILE', '매물 동영상 용도(LISTING_VIDEO)로 올리기를 마친 내 파일만 붙일 수 있습니다.');
  const [f] = await db.query<{ storage_key: string; size_bytes: string }>(
    `SELECT storage_key, size_bytes::text FROM files WHERE id = $1 AND owner_account_id = $2 AND purpose = 'LISTING_VIDEO' AND status = 'READY'`, [fileId, me]);
  if (!f) throw new PolicyViolation('LSY_VIDEO_FILE', '매물 동영상 용도(LISTING_VIDEO)로 올리기를 마친 내 파일만 붙일 수 있습니다.');
  const max = s.videoMaxMb * 1024 * 1024;
  if (Number(f.size_bytes) > max) throw new PolicyViolation('LSY_VIDEO_TOO_BIG', `동영상은 ${s.videoMaxMb}MB 까지입니다.`);
  const stream = await storageFromEnv().open(f.storage_key);
  const buf = stream ? await lsyReadAll(stream, max) : null;
  const meta = buf ? mp4Meta(buf) : null;
  if (!meta) throw new PolicyViolation('LSY_VIDEO_UNREADABLE', '동영상 길이를 읽지 못했습니다. MP4 로 다시 저장해 올려 주십시오.');
  if (meta.durationMs > s.videoMaxSec * 1000) throw new PolicyViolation('LSY_VIDEO_TOO_LONG', `동영상은 ${s.videoMaxSec}초까지입니다.`);
  return db.transaction(async () => {
    const [same] = await db.query(`SELECT 1 FROM lsy_listing_videos WHERE listing_id = $1 AND file_id = $2 AND state IN ('PENDING', 'APPROVED')`, [listingId, fileId]);
    if (same) throw new StateConflict('LSY_VIDEO_SAME', '이미 붙인 동영상입니다.');
    await db.query(`UPDATE lsy_listing_videos SET state = 'REPLACED', updated_at = now() WHERE listing_id = $1 AND state IN ('PENDING', 'APPROVED')`, [listingId]);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO lsy_listing_videos (listing_id, file_id, owner_account_id, state, duration_ms, width, height, bytes)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7) RETURNING id::text`,
      [listingId, fileId, me, meta.durationMs, meta.width, meta.height, Number(f.size_bytes)]);
    return { ok: true, id: Number(r!.id), state: 'PENDING', durationSec: Math.round(meta.durationMs / 100) / 10, note: '동영상을 붙였습니다 — 운영자가 확인한 뒤 매물 상세에 보입니다.' };
  });
}

/** 회원 — 영상 빼기 */
export async function removeVideo(db: DatabaseService, me: string, listingId: string) {
  if (!LSY_UUID_RE.test(listingId)) throw new NotFound('매물을 찾을 수 없습니다.');
  const r = await db.query<{ id: string }>(
    `UPDATE lsy_listing_videos v SET state = 'REMOVED', updated_at = now()
       FROM listings l WHERE l.id = v.listing_id AND v.listing_id = $1 AND l.owner_account_id = $2 AND v.state IN ('PENDING', 'APPROVED') RETURNING v.id::text`, [listingId, me]);
  if (!r.length) throw new NotFound('붙인 동영상이 없습니다.');
  return { ok: true, note: '동영상을 뺐습니다. 파일은 나의공간에서 지울 수 있습니다.' };
}

/** 공개 — 승인한 영상의 5분짜리 주소 */
export async function publicVideo(db: DatabaseService, listingId: string) {
  if (!LSY_UUID_RE.test(listingId)) return { video: null };
  const s = await lsySettings(db);
  if (!s.video) return { video: null };
  const [v] = await db.query<{ file_id: string; storage_key: string; content_type: string; original_name: string; duration_ms: number; width: number | null; height: number | null }>(
    `SELECT f.id::text AS file_id, f.storage_key, f.content_type, f.original_name, v.duration_ms, v.width, v.height
       FROM lsy_listing_videos v JOIN listings l ON l.id = v.listing_id JOIN files f ON f.id = v.file_id
      WHERE v.listing_id = $1 AND v.state = 'APPROVED' AND l.status = 'PUBLISHED' AND f.status = 'READY' AND f.purpose = 'LISTING_VIDEO'
      ORDER BY v.id DESC LIMIT 1`, [listingId]);
  if (!v) return { video: null };
  const t = await storageFromEnv().downloadTarget({ id: v.file_id, key: v.storage_key, contentType: v.content_type, disposition: contentDisposition('inline', v.original_name) }, 300);
  return { video: { url: t.url, expiresAt: t.expiresAt, contentType: v.content_type, durationSec: Math.round(v.duration_ms / 100) / 10, width: v.width, height: v.height } };
}

/* ── 운영 ── */
export async function adminVideoList(db: DatabaseService, state = 'PENDING') {
  const st = (VIDEO_STATES as readonly string[]).includes(state) ? state : 'PENDING';
  const s = await lsySettings(db);
  const rows = await db.query(
    `SELECT v.id::text, v.listing_id::text AS "listingId", l.listing_no AS "listingNo", l.title, l.status AS "listingStatus", v.file_id::text AS "fileId",
            v.state, v.duration_ms AS "durationMs", v.width, v.height, v.bytes::text AS bytes, v.created_at AS "createdAt",
            v.decided_at AS "decidedAt", v.decide_reason AS "decideReason"
       FROM lsy_listing_videos v JOIN listings l ON l.id = v.listing_id
      WHERE v.state = $1 ORDER BY v.id ASC LIMIT 200`, [st]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM lsy_listing_videos GROUP BY 1`);
  return { state: st, on: s.video, maxMb: s.videoMaxMb, maxSec: s.videoMaxSec, counts: Object.fromEntries(counts.map((c) => [c.state, c.n])), rows };
}

/** 승인 · 반려(사유) — 사람만 */
export async function decideVideo(db: DatabaseService, actorId: string, id: number, d: { approve?: boolean; reason?: string }) {
  if (d.approve !== true && d.approve !== false) throw new PolicyViolation('LSY_DECIDE', '승인(approve: true) 또는 반려(approve: false)를 골라 주십시오.');
  const reason = d.approve ? (d.reason ? String(d.reason).replace(/\s+/g, ' ').trim().slice(0, 300) || null : null) : lsyReason(d.reason);
  const r = await db.query<{ id: string }>(
    `UPDATE lsy_listing_videos SET state = $2, decided_by = $3, decided_at = now(), decide_reason = $4, updated_at = now()
      WHERE id = $1 AND state = 'PENDING' RETURNING id::text`, [id, d.approve ? 'APPROVED' : 'REJECTED', actorId, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM lsy_listing_videos WHERE id = $1`, [id]);
    if (!x) throw new NotFound('동영상을 찾을 수 없습니다.');
    throw new StateConflict('LSY_VIDEO_STATE', '검수 대기인 동영상만 승인 · 반려할 수 있습니다.');
  }
  return { ok: true, id, state: d.approve ? 'APPROVED' : 'REJECTED' };
}

export const VIDEO_LIVE_STATES = LIVE;
