/* G-94 — 쪽(page.tsx) 맨 바깥이 태그 하나(<div …>)인 반환을 「여러 마디」로 바꿉니다: <>{원래}<i hidden data-root-end="" /></>
 * 근거(10/8 실측): 쪽 맨 바깥이 태그 하나이고 내용이 크면(서버 조각이 뒤로 밀림) 부하 때 수화 오류 #418 이 5 ~ 15% 났고,
 *   맨 바깥을 여러 마디로 바꾸면 0 / 180 이었습니다(같은 시각에 고치지 않은 쪽은 계속 남 — 대조).
 * 사용: node g94_root.js <site/src/app> [--dry]   — 기본 내보내기 함수 몸통의 return 만 봅니다(안쪽 함수 · map 콜백은 건드리지 않음). */
const ts = require(process.env.TSLIB || 'typescript');
const fs = require('fs'), path = require('path');
const root = process.argv[2], dry = process.argv.includes('--dry');
const files = [];
(function walk(d){ for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f === 'page.tsx') files.push(p); } })(root);
let changed = 0, sites = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn = null;
  sf.forEachChild(n => {
    if (ts.isFunctionDeclaration(n) && n.modifiers && n.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) fn = n;
  });
  if (!fn || !fn.body) continue;
  const edits = [];
  (function visit(n){
    if (ts.isFunctionLike(n) && n !== fn) return;            // 안쪽 함수는 건너뜀
    if (ts.isReturnStatement(n) && n.expression) {
      let e = n.expression; while (ts.isParenthesizedExpression(e)) e = e.expression;
      const tag = ts.isJsxElement(e) ? e.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(e) ? e.tagName.getText(sf) : null;
      if (tag && /^[a-z]/.test(tag)) edits.push([e.getStart(sf), e.getEnd()]);
    }
    n.forEachChild(visit);
  })(fn.body);
  if (!edits.length) continue;
  let out = src;
  for (const [a, b] of edits.sort((x, y) => y[0] - x[0])) {
    out = out.slice(0, a) + '<>' + out.slice(a, b) + '<i hidden data-root-end="" /></>' + out.slice(b);
  }
  sites += edits.length; changed++;
  if (!dry) fs.writeFileSync(f, out);
  console.log((dry ? '(dry) ' : '') + path.relative(root, f) + ' · ' + edits.length);
}
console.log(`쪽 ${files.length}개 중 ${changed}개 · 반환 ${sites}곳`);
