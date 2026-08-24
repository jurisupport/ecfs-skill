#!/usr/bin/env bash
# ecfs-skill 원클릭 설치 스크립트 (멱등 — 이미 설치된 항목은 건너뜀)
#
#   git clone git@github.com:jurisupport/ecfs-skill.git ~/.claude/skills/ecfs
#   cd ~/.claude/skills/ecfs && ./install.sh              # 기본 설치
#   ./install.sh --with-daemon                            # + 송달 알림 감시 데몬까지
#
# 하는 일:
#   1. 필수 도구 확인 (node, npm, python3, Google Chrome)
#   2. npm install (playwright)
#   3. sops + age 설치 및 자격증명 금고 생성 (~/.config/k-skill/)
#      - 대화형 터미널이면 ECFS_ID·인증서 암호를 물어보고 NPKI 폴더를 자동 탐지
#   4. 동작 검증 (금고 연결 + 인지송달료 계산기)
#   5. --with-daemon 시 launchd 데몬 설치
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
CFG_DIR="$HOME/.config/k-skill"
VAULT="$CFG_DIR/secrets.env"
AGE_KEY="$CFG_DIR/age/keys.txt"
SOPS_CFG="$CFG_DIR/.sops.yaml"
WITH_DAEMON=0
[ "${1:-}" = "--with-daemon" ] && WITH_DAEMON=1

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

echo "── [1/5] 필수 도구 확인"
[ "$(uname)" = "Darwin" ] || die "macOS 전용입니다."
command -v node >/dev/null || die "Node.js가 없습니다: brew install node"
command -v npm  >/dev/null || die "npm이 없습니다."
command -v python3 >/dev/null || die "python3가 없습니다."
[ -d "/Applications/Google Chrome.app" ] || warn "Google Chrome이 안 보입니다. 브라우저 자동화에 필요합니다: https://www.google.com/chrome/"
ok "node $(node --version) / python3 $(python3 -V 2>&1 | cut -d' ' -f2)"

echo "── [2/5] npm 의존성"
if [ -e "$SKILL_DIR/node_modules/playwright" ]; then
  ok "playwright 이미 설치됨"
else
  (cd "$SKILL_DIR" && npm install --no-fund --no-audit)
  ok "playwright 설치 완료"
fi

echo "── [3/5] 자격증명 금고"
if ! command -v sops >/dev/null || ! command -v age-keygen >/dev/null; then
  command -v brew >/dev/null || die "sops·age 설치에 Homebrew가 필요합니다: https://brew.sh"
  brew install sops age
fi
ok "sops $(sops --version 2>/dev/null | head -1 | grep -oE '[0-9.]+' | head -1)"

mkdir -p "$CFG_DIR/age"
if [ -f "$AGE_KEY" ]; then
  ok "age 키 이미 존재: $AGE_KEY"
else
  age-keygen -o "$AGE_KEY" 2>/dev/null
  chmod 600 "$AGE_KEY"
  ok "age 키 생성: $AGE_KEY  ← 이 파일을 잃으면 금고를 못 엽니다. 백업하세요."
fi
PUBKEY="$(grep -o 'age1[a-z0-9]*' "$AGE_KEY" | head -1)"
[ -n "$PUBKEY" ] || die "age public key를 읽지 못했습니다: $AGE_KEY"

if [ -f "$SOPS_CFG" ]; then
  ok ".sops.yaml 이미 존재"
else
  cat > "$SOPS_CFG" <<EOF
creation_rules:
  - path_regex: .*secrets\\.env(\\.plain)?\$
    age: $PUBKEY
EOF
  ok ".sops.yaml 생성"
fi

if [ -f "$VAULT" ]; then
  ok "금고 이미 존재: $VAULT (수정: SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env)"
else
  PLAIN="$CFG_DIR/secrets.env.plain"   # .sops.yaml path_regex와 반드시 일치해야 함
  ECFS_ID_IN="" ECFS_PW_IN="" CERT_DIR_IN=""
  if [ -t 0 ]; then
    printf '  전자소송 아이디: ';              read -r ECFS_ID_IN
    printf '  공동인증서 암호 (입력 숨김): ';  read -rs ECFS_PW_IN; echo
    # NPKI 개인 인증서 폴더 자동 탐지
    CANDIDATES=()
    while IFS= read -r d; do CANDIDATES+=("$d"); done < <(find "$HOME/Library/Preferences/NPKI" -maxdepth 3 -type d -name 'cn=*' 2>/dev/null)
    if [ "${#CANDIDATES[@]}" -eq 1 ]; then
      CERT_DIR_IN="${CANDIDATES[0]}"
      ok "NPKI 인증서 자동 탐지: $CERT_DIR_IN"
    elif [ "${#CANDIDATES[@]}" -gt 1 ]; then
      echo "  NPKI 인증서 폴더 선택:"
      i=1; for d in "${CANDIDATES[@]}"; do echo "    $i) $d"; i=$((i+1)); done
      printf '  번호: '; read -r n
      CERT_DIR_IN="${CANDIDATES[$((n-1))]}"
    else
      printf '  NPKI 인증서 폴더 절대경로: '; read -r CERT_DIR_IN
    fi
  else
    warn "비대화형 실행 — 금고를 빈 값 템플릿으로 만듭니다. 설치 후 sops로 값을 채우세요."
  fi
  umask 077
  cat > "$PLAIN" <<EOF
ECFS_ID=$ECFS_ID_IN
ECFS_CERT_PW=$ECFS_PW_IN
ECFS_CERT_DIR=$CERT_DIR_IN
GMAIL_USER=
GMAIL_APP_PW=
TELEGRAM_CHAT_ID=
ECFS_DELIVERY_DIR=
EOF
  ( cd "$CFG_DIR" && SOPS_AGE_KEY_FILE="$AGE_KEY" sops --config "$SOPS_CFG" -e \
      --input-type dotenv --output-type dotenv secrets.env.plain > secrets.env )
  rm -f "$PLAIN"
  chmod 600 "$VAULT"
  # 암호화 검증: 복호화가 되고 평문이 아닌지 확인
  SOPS_AGE_KEY_FILE="$AGE_KEY" sops --config "$SOPS_CFG" -d --input-type dotenv --output-type dotenv "$VAULT" >/dev/null \
    || die "금고 복호화 검증 실패"
  grep -q "ENC\[" "$VAULT" || die "금고가 암호화되지 않았습니다"
  ok "금고 생성·암호화 검증 완료: $VAULT"
fi

echo "── [4/5] 동작 검증"
ID_CHECK="$(cd "$SKILL_DIR" && node -e "const{secret}=require('./k-secrets');process.stdout.write(secret('ECFS_ID','(미설정)'))")"
if [ "$ID_CHECK" = "(미설정)" ] || [ -z "$ID_CHECK" ]; then
  warn "ECFS_ID가 비어 있습니다. 실제 사용 전 금고에 값을 채우세요."
else
  ok "금고 연결 확인 (ECFS_ID=${ID_CHECK:0:3}***)"
fi
(cd "$SKILL_DIR" && node ecfs-cost-calc.js --sua 10000000 --defendants 1 >/dev/null) \
  && ok "인지송달료 계산기 정상" || die "계산기 실행 실패"

echo "── [5/5] 송달 알림 감시 데몬"
if [ "$WITH_DAEMON" = "1" ]; then
  GM="$(cd "$SKILL_DIR" && node -e "const{secret}=require('./k-secrets');process.stdout.write(secret('GMAIL_APP_PW',''))")"
  [ -n "$GM" ] || die "데몬에는 금고의 GMAIL_USER·GMAIL_APP_PW·TELEGRAM_CHAT_ID가 필요합니다. 채운 뒤 다시 실행하세요."
  mkdir -p "$SKILL_DIR/logs"
  sed "s|HOME_DIR|$HOME|g" "$SKILL_DIR/launchd/local.ecfs-mailwatch.plist.example" \
    > "$HOME/Library/LaunchAgents/local.ecfs-mailwatch.plist"
  launchctl bootout "gui/$(id -u)/local.ecfs-mailwatch" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.ecfs-mailwatch.plist"
  sleep 3
  tail -1 "$SKILL_DIR/logs/mailwatch.log" 2>/dev/null || true
  ok "데몬 설치 완료 (로그: logs/mailwatch.log)"
else
  echo "  (건너뜀 — 필요하면 ./install.sh --with-daemon)"
fi

echo
echo "설치 완료. Claude Code에서 \"전자소송 송달문서 확인해줘\"처럼 요청하면 됩니다."
echo "금고 값 수정: cd ~/.config/k-skill && SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env"
