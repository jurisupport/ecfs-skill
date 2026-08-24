// k-skill 공용 자격증명 로더 (Node)
//
// 우선순위: 환경변수 → sops 금고(~/.config/k-skill/secrets.env)
// 소스코드에 비밀번호를 하드코딩하지 말 것. 값은 금고에만 둔다.
//
// 사용:
//   const { secret } = require('./k-secrets');
//   const PW = secret('ECFS_CERT_PW');            // 없으면 throw
//   const id = secret('TELEGRAM_CHAT_ID', null);  // 없으면 null
//
// 금고 편집:
//   cd ~/.config/k-skill
//   SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function findSops() {
  for (const c of ['/opt/homebrew/bin/sops', '/usr/local/bin/sops', '/usr/bin/sops']) {
    if (fs.existsSync(c)) return c;
  }
  return 'sops';  // PATH에 있길 기대
}

const CFG_DIR = path.join(os.homedir(), '.config/k-skill');
const VAULT = path.join(CFG_DIR, 'secrets.env');
const SOPS_CFG = path.join(CFG_DIR, '.sops.yaml');
const AGE_KEY = path.join(CFG_DIR, 'age/keys.txt');

let _cache = null;

function loadVault() {
  if (_cache) return _cache;
  _cache = {};
  if (!fs.existsSync(VAULT)) return _cache;
  try {
    const env = { ...process.env };
    if (fs.existsSync(AGE_KEY)) env.SOPS_AGE_KEY_FILE = env.SOPS_AGE_KEY_FILE || AGE_KEY;
    const args = ['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv'];
    if (fs.existsSync(SOPS_CFG)) args.unshift('--config', SOPS_CFG);
    const out = execFileSync(findSops(), [...args, VAULT], { env, encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) _cache[m[1]] = m[2];
    }
  } catch (e) {
    // sops 미설치·키 없음 등 → 환경변수만으로 동작 시도
  }
  return _cache;
}

function secret(key, fallback) {
  if (process.env[key]) return process.env[key];
  const v = loadVault()[key];
  if (v !== undefined && v !== '') return v;
  if (arguments.length >= 2) return fallback;
  throw new Error(
    `자격증명 '${key}' 없음. 환경변수로 주거나 금고에 넣을 것:\n` +
    `  cd ~/.config/k-skill && SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env`
  );
}

module.exports = { secret, VAULT };
