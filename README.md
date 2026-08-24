# ecfs — 대한민국 법원 전자소송 자동화 스킬

대한민국 법원 전자소송포털([ecfs.scourt.go.kr](https://ecfs.scourt.go.kr))을 Playwright로 자동 제어하는 [Claude Code](https://claude.com/claude-code) 스킬입니다.

## 기능

- **공동인증서 로그인** — 보안 데몬(AnySign) 없이 NPKI 파일 직접 주입으로 로그인하는 검증된 경로
- **송달문서 점검·열람·저장** — 미확인/전체 송달문서 조회, PDF 저장, SQLite 목록 관리
- **송달 알림 감시 데몬** — IMAP IDLE로 법원 전자발송 메일을 감지해 유형 선별 자동 수집 + 텔레그램 알림
- **소송서류 제출** — 준비서면·서증 등 파일첨부 제출, 보정서 등 이폼(전자문서작성) 제출, 임시저장/작성완료/최종제출 단계 분리
- **소송비용 납부** — 인지액·송달료 계산, 가상계좌 발급(--confirm 게이트), 납부 확인
- **WebSquare 함정 대응 노트** — 금액칸 10배 입력 사고, CKEditor 주입, 모달 클릭 무시 등 실전에서 축적한 우회법

## 사용법

Claude Code 스킬 폴더(`~/.claude/skills/ecfs/`)에 두고 자연어로 요청합니다. 상세 절차·스크립트 목록·주의사항은 [SKILL.md](SKILL.md) 참조.

```
"전자소송 송달문서 확인해줘"
"준비서면 전자제출 준비해줘"
"인지송달료 계산해줘"
```

## 자격증명

소스에 자격증명이 없습니다. [sops](https://github.com/getsops/sops)+age로 암호화된 금고(`~/.config/k-skill/secrets.env`)에서 `k-secrets.js`/`k_secrets.py` 로더가 읽습니다(환경변수 우선). 필요한 키: `ECFS_ID`, `ECFS_CERT_PW`, `ECFS_CERT_DIR`, `GMAIL_USER`, `GMAIL_APP_PW`, `TELEGRAM_CHAT_ID`.
선택 키: `ECFS_DELIVERY_DIR`(송달문서 PDF 저장 폴더, 미설정 시 `~/ecfs-delivery`).

## 요구사항

- macOS, Node.js, Playwright(Chrome 채널), Python 3
- 공동인증서(NPKI `signCert.der` + `signPri.key`)
- 전자소송포털 계정

## 주의

- 최종 제출·전자서명 등 **되돌릴 수 없는 행위는 사용자 확인 후에만** 실행하도록 설계돼 있습니다.
- 미확인 송달문서를 여는 순간 송달 간주되어 불복·이의 기간이 기산됩니다. 자동 열람은 기간 기산과 무관한 유형으로 제한됩니다.
- 법원 시스템 화면 구조(WebSquare)는 예고 없이 바뀔 수 있습니다. 셀렉터가 깨지면 SKILL.md의 진단 절차를 참고하세요.
- 본인의 계정·사건에 대해서만 사용하세요.

## License

MIT
