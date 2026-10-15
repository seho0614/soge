/**
 * .env 를 process.env 에 싣습니다 (이미 있는 값은 덮지 않습니다).
 * dotenv 를 쓰지 않는 이유: 의존성 하나를 늘릴 만큼의 일이 아닙니다.
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
