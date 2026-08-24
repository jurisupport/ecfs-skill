# ecfs — 대한민국 법원 전자소송 자동화 스킬

대한민국 법원 전자소송포털([ecfs.scourt.go.kr](https://ecfs.scourt.go.kr))을 Playwright로 자동 제어하는 [Claude Code](https://claude.com/claude-code) 스킬입니다.

## 기능

- **공동인증서 로그인** — 보안 데몬(AnySign) 없이 NPKI 파일 직접 주입으로 로그인하는 검증된 경로
- **송달문서 점검·열람·저장** — 미확인/전체 송달문서 조회, PDF 저장, SQLite 목록 관리
- **송달 알림 감시 데몬** — IMAP IDLE로 법원 전자발송 메일을 감지해 유형 선별 자동 수집 + 텔레그램 알림
- **소송서류 제출** — 준비서면·서증 등 파일첨부 제출, 보정서 등 이폼(전자문서작성) 제출, 임시저장/작성완료/최종제출 단계 분리
- **소송비용 납부** — 인지액·송달료 계산, 가상계좌 발급(--confirm 게이트), 납부 확인
- **WebSquare 함정 대응 노트** — 금액칸 10배 입력 사고, CKEditor 주입, 모달 클릭 무시 등 실전에서 축적한 우회법

## 설치

### 1. 저장소 클론

Claude Code 스킬 폴더에 바로 클론합니다.

```bash
git clone git@github.com:jurisupport/ecfs-skill.git ~/.claude/skills/ecfs
cd ~/.claude/skills/ecfs
npm install          # playwright 설치
```

브라우저는 시스템에 설치된 **Google Chrome**을 사용합니다(`channel: 'chrome'`). Chrome이 없다면 [google.com/chrome](https://www.google.com/chrome/)에서 설치하세요.

### 2. 자격증명 금고 만들기

[sops](https://github.com/getsops/sops)와 [age](https://github.com/FiloSottile/age)로 암호화 금고를 만듭니다.

```bash
brew install sops age

mkdir -p ~/.config/k-skill/age
age-keygen -o ~/.config/k-skill/age/keys.txt        # 출력되는 public key 복사
chmod 600 ~/.config/k-skill/age/keys.txt

cat > ~/.config/k-skill/.sops.yaml <<EOF
creation_rules:
  - path_regex: .*secrets\.env(\.plain)?$
    age: <위에서 복사한 public key>
EOF

# 평문으로 작성 → 암호화 → 평문 삭제
cat > ~/.config/k-skill/secrets.env.plain <<EOF
ECFS_ID=전자소송_아이디
ECFS_CERT_PW=공동인증서_암호
ECFS_CERT_DIR=/Users/<계정>/Library/Preferences/NPKI/yessign/USER/cn=.../...
EOF
cd ~/.config/k-skill
SOPS_AGE_KEY_FILE=age/keys.txt sops -e --input-type dotenv --output-type dotenv secrets.env.plain > secrets.env
rm secrets.env.plain && chmod 600 secrets.env
```

이후 값 추가·수정은 `SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env` 한 줄로 합니다.
⚠️ 평문 임시 파일명은 반드시 `secrets.env.plain`이어야 합니다(`.sops.yaml`의 `path_regex` 규칙).

| 키 | 용도 | 필수 |
|---|---|---|
| `ECFS_ID` | 전자소송 아이디 | ✅ |
| `ECFS_CERT_PW` | 공동인증서 암호 | ✅ |
| `ECFS_CERT_DIR` | NPKI 인증서 폴더 절대경로 | ✅ |
| `GMAIL_USER` / `GMAIL_APP_PW` | 송달 알림 감시용 Gmail·앱 비밀번호 | 데몬 사용 시 |
| `TELEGRAM_CHAT_ID` | 송달 알림 받을 텔레그램 chat id | 데몬 사용 시 |
| `ECFS_DELIVERY_DIR` | 송달문서 PDF 저장 폴더 (기본 `~/ecfs-delivery`) | 선택 |

금고 대신 같은 이름의 **환경변수**로 줘도 됩니다(환경변수가 우선).

### 3. 동작 확인

```bash
cd ~/.claude/skills/ecfs
node -e "const{secret}=require('./k-secrets');console.log('ID:',secret('ECFS_ID'))"   # 금고 연결 확인
node ecfs-cost-calc.js --sua 100000000 --defendants 1                                  # 브라우저 없이 계산기 테스트
node ecfs-check-delivery.js                                                            # 실제 로그인 + 송달문서 점검
```

### 4. 송달 알림 감시 데몬 (선택)

법원 전자발송 메일을 감지해 자동 수집·텔레그램 알림을 보내는 상시 데몬입니다. `GMAIL_*`·`TELEGRAM_CHAT_ID` 키를 채운 뒤:

```bash
sed "s|HOME_DIR|$HOME|g" launchd/local.ecfs-mailwatch.plist.example \
  > ~/Library/LaunchAgents/local.ecfs-mailwatch.plist
mkdir -p logs
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.ecfs-mailwatch.plist
tail -f logs/mailwatch.log      # "IMAP 연결됨. 감시 중..." 확인
```

중지는 `launchctl bootout gui/$(id -u)/local.ecfs-mailwatch`.

## 사용법

Claude Code 스킬 폴더(`~/.claude/skills/ecfs/`)에 두고 자연어로 요청합니다. 상세 절차·스크립트 목록·주의사항은 [SKILL.md](SKILL.md) 참조.

```
"전자소송 송달문서 확인해줘"
"준비서면 전자제출 준비해줘"
"인지송달료 계산해줘"
```

## 자격증명

소스에 자격증명이 없습니다. `k-secrets.js`/`k_secrets.py` 로더가 환경변수 → sops 금고 순으로 읽습니다. 키 목록과 금고 생성 방법은 위 [설치](#설치) 절 참조.

## 요구사항

- macOS, Node.js 18+, Python 3, Google Chrome
- 공동인증서(NPKI `signCert.der` + `signPri.key`)
- 전자소송포털 계정 (공동인증서 등록 완료 상태)

## 주의

- 최종 제출·전자서명 등 **되돌릴 수 없는 행위는 사용자 확인 후에만** 실행하도록 설계돼 있습니다.
- 미확인 송달문서를 여는 순간 송달 간주되어 불복·이의 기간이 기산됩니다. 자동 열람은 기간 기산과 무관한 유형으로 제한됩니다.
- 법원 시스템 화면 구조(WebSquare)는 예고 없이 바뀔 수 있습니다. 셀렉터가 깨지면 SKILL.md의 진단 절차를 참고하세요.
- 본인의 계정·사건에 대해서만 사용하세요.

## License

MIT
