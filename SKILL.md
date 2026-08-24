---
name: ecfs
description: 전자소송(ecfs.scourt.go.kr) 자동화 스킬 - 공동인증서 로그인, 송달문서 점검(미확인/전체), 준비서면·서증 등 소송서류 제출. Playwright + 검증된 인증서 파일주입 로그인 경로 사용. 트리거 — "전자소송 송달문서 확인", "미확인 송달 점검", "전자소송 로그인", "준비서면 전자제출", "서증 제출".
license: MIT
metadata:
  category: legal
  locale: ko-KR
---

# 전자소송(ECFS) 자동화 스킬

대한민국 법원 전자소송포털(ecfs.scourt.go.kr)을 Playwright로 자동 제어한다. 공동인증서 로그인, 송달문서함 점검, 소송서류 제출을 수행한다.

## When to use

- "전자소송 송달문서 확인해줘", "미확인 송달 있는지 점검", "송달문서 최근순 확인"
- "전자소송 로그인해서 ○○ 확인"
- "준비서면 전자제출", "서증 제출", "답변서 제출"
- "인지송달료 계산해줘", "소송비용 얼마야", "가상계좌 납부 만들어줘", "인지·송달료 납부", "가상계좌 발급됐는지 확인"

## 실행 환경

- 폴더: `~/.claude/skills/ecfs/` (여기서 `node <script>` 실행)
- 의존성: Playwright(설치됨), Chrome 채널. 브라우저는 `headless:false`로 화면에 뜬다.
- 자격정보(아이디·인증서 암호·NPKI 경로)는 **소스에 없다.** sops 금고 `~/.config/k-skill/secrets.env`에서
  `k-secrets.js`(Node) / `k_secrets.py`(Python)가 읽는다. 키: `ECFS_ID` `ECFS_CERT_PW` `ECFS_CERT_DIR` `TELEGRAM_CHAT_ID` `GMAIL_USER` `GMAIL_APP_PW`.
  값 확인·수정: `cd ~/.config/k-skill && SOPS_AGE_KEY_FILE=age/keys.txt sops secrets.env`
  환경변수가 있으면 그쪽이 우선한다(임시 대체용).

## 로그인 (핵심 — 어렵게 검증한 경로)

`ecfs-login.js`의 `login(browser)` 모듈 사용. 다른 스크립트는 이걸 require 한다.

```js
const { chromium } = require('playwright');
const { login } = require('./ecfs-login');
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await login(browser);   // 로그인된 page 반환
```

**동작 원리 (이 macOS에서 AnySign 데몬이 죽어 포트를 못 여는 환경 대응):**
1. 아이디 입력 후 로그인 버튼은 disabled 강제 해제하고 클릭.
2. 인증서창에서 **인증서찾기**(`#xwup_media_memorystorage`) 클릭 → 숨은 file input `#xwup_openFile` 생성.
3. 그 input에 NPKI 묶음(`signCert.der` + `signPri.key`)을 `setInputFiles`로 **직접 주입**.
4. **"읽어올 인증서의 암호"** 모달(`#xwup_inputpasswd_tek_input1`)에 암호 입력 → 최상단 '확인' 클릭 → 로그인 완료.

⚠️ **주의:** "브라우저/하드디스크 저장소" 또는 "인증서찾기 후 목록에서 선택" 경로는 AnySign 로컬 데몬(wss://127.0.0.1:14440~14449)이 살아있어야 하는데 이 맥에서는 포트가 안 열려 목록이 **빈 채로** 나와 실패한다. 반드시 **file input 직접 주입** 경로를 쓸 것. (자세한 배경: 메모리 `feedback_ecfs_login_method`)

## 송달문서 점검

```
node ecfs-check-delivery.js [전체송달_페이지수(기본3)]
```
- **미확인송달문서**(아직 안 연 것) + **전체송달문서**(수신일자 포함, 최근 N페이지) 수집.
- 결과: `/tmp/ecfs-check/delivery.json` + 스크린샷(`unconfirmed.png`, `all-p*.png`). 콘솔에 요약.
- 메뉴 경로: 나의전자소송 → 나의문서함 → 미확인송달문서(`m=PSP321M01`) / 전체송달문서(`m=PSP311M01`).
- "놓친 것" 판단: **미확인송달문서 목록 = 아직 열지 않은 송달**. 전체송달문서의 수신일자 컬럼이 "미확인"이면 미열람.

## 송달문서 저장소 + DB 관리 (2026-08-03 사용자 확정 운영방식)

송달문서 점검 시 문서 PDF는 **송달문서 저장 폴더**(환경변수/금고 `ECFS_DELIVERY_DIR`, 미설정 시 `~/ecfs-delivery`)에 하나씩 저장하고, 같은 폴더의 **`_송달문서.db`**(SQLite)로 목록·확인상태·파일경로를 관리한다.

표준 사이클 (점검할 때마다):
```
node ecfs-check-delivery.js 3                                  # 1) 조회 → /tmp/ecfs-check/delivery.json
python3 ecfs-delivery-db.py import-check                       # 2) DB 업서트(신규/상태변경 반영)
python3 ecfs-delivery-db.py have-json                          # 3) 기저장 목록 → 폴더/_have.json
node ecfs-open-save.js --pages 3 \
     --out "$ECFS_DELIVERY_DIR" \                       # 생략 시 금고 ECFS_DELIVERY_DIR → ~/ecfs-delivery
     --skip ".../송달문서/_have.json"                           # 4) 새 문서만 PDF 다운로드(미확인 자동 제외)
python3 ecfs-delivery-db.py link-files                         # 5) PDF ↔ DB 매칭
python3 ecfs-delivery-db.py export-csv                         # 6) _송달문서목록.csv 갱신(사람용)
```
- `pending` 명령 = 확인됐는데 PDF 없는 건, `list` = 최근 현황(🔴 미확인 / 💾 저장됨).
- 미확인 문서는 여기서도 절대 자동으로 열지 않는다(아래 안전원칙). 사용자가 **열람을 명시적으로 지시한 건**은 그 지시가 곧 승인이므로 재확인 없이 `--unconfirmed --case`로 열고, 열었으면 다시 import-check → link-files → have-json으로 상태를 갱신한다. (2026-08-03 사용자 확정)
- (이 사무소 설정: 금고 `ECFS_DELIVERY_DIR`이 OneDrive 동기화 폴더를 가리킨다.) `_송달문서.db`·`_have.json`·`_송달문서목록.csv`는 관리파일이므로 삭제 금지.

## 송달문서 열람 + PDF 저장

```
node ecfs-open-save.js [옵션]
```
- 각 송달문서를 **열어서 PDF로 저장**한다(뷰어의 '파일저장'). 파일명은 자동(`사건번호_날짜_문서명_...pdf`).
- 옵션:
  - `--pages N` 전체송달문서 페이지 수(기본 2)
  - `--limit N` 최대 N건
  - `--out DIR` 저장 폴더(기본 `/tmp/ecfs-check/docs`). 사건폴더로 저장하려면 여기에 경로 지정.
  - `--dry` 열지 않고 대상 목록만
  - `--unconfirmed` **미확인송달문서**를 대상으로

### ⚠️ 미확인 문서 안전원칙 (중요)
- **미확인 송달문서를 여는 순간 '송달 확인(열람)'으로 처리**되어 송달 효력이 발생하고 **불복·이의·보정 기간이 기산**된다(되돌릴 수 없음).
- 그래서 **기본 모드(전체송달문서)에서는 '수신일자=미확인'인 행을 자동으로 건너뛴다**(확인처리 방지).
- 미확인 문서를 실제로 열려면 `--unconfirmed`를 **명시**해야 한다. (전략적으로 확인 시점을 늦추는 경우가 있으므로 임의로 열지 말 것.)
- **명시적 열람 지시 = 승인** (2026-08-03 사용자 확정): 사용자가 특정 문서·사건을 지목해 "열람해"라고 명시하면 그 지시 자체가 승인이다 — 재확인 질문 없이 `--unconfirmed --case <번호>`로 바로 열람하고, 저장 → `link-files`/`have-json` DB 반영 → 결과 보고까지 수행한다. 대상이 불명확하거나 "전부 열어"처럼 포괄 지시일 때만 목록을 보여주고 확인받는다.

동작 원리: 목록에서 송달문서명 링크 클릭 → StreamDocs PDF 뷰어(새 창) → '파일저장'(#mf_btn_save) → 다운로드. '일괄저장'(#mf_btn_all_save)은 한 뷰어의 여러 문서 일괄 저장.

## 소송서류 제출

```
node ecfs-submit-generic.js <법원명> <사건번호끝자리> <서류유형> <본문PDF|""> [서증1] [서증2] ...
```
- 서류유형 예: "준비서면", "답변서(청구취지/원인)", "서증", "소장".
- 준비서면 전용: `ecfs-submit-brief.js`.
- ⚠️ 입증서류(서증)는 **"목록에 추가"** 버튼을 눌러야 등록됨("서증입력파일 등록" 아님). 공통 함수는 `ecfs-utils.js`.
- ⚠️ **첨부서류**(판결문 사본 등)도 같은 함정: 서류명 미입력 상태로 "목록에 추가"를 누르면 **조용히 무시**된다. `uploadAttachment()`는 **'파일명과 동일' 체크박스**(`mf_pfwork_wfm_atch_chkFileNmSameYn_input_0`)를 자동으로 켠 뒤 `btn_searchFile → btn_addedList → btn_save` 순으로 처리.
- ⚠️ **서증번호 자동 부여 주의**: 시스템이 사건에 이미 제출된 을호증에 이어 번호를 붙인다(예: 다른 피고가 12번까지 냈으면 13~17). **다수당사자(을가~을하) 사건은 가지부호·번호를 반드시 정정** — `fixEvidenceGrid()` 또는 `ecfs-resume-edit.js --fix-evidence 마:1`. 그리드 셀 좌표: `grd_dcmevdLst_cell_{r}_{1=서증부호(을/병), 2=가지부호(없음~하), 3=서증번호, 5=서증명}`.
- ⚠️ **작성완료 필수요건 = 서류명의인 선택**. 미선택 시 "서류명의인을(를) 선택해 주십시오" 모달에 막힌다 → `selectNominee(page, '이름')`.
- 작성완료 전환 판정은 `prvDocmt_btn_searchFile` **소멸** 기준(`completeAndVerify()`). `btn_wrtCmptn` 존재 여부는 신뢰 불가(최종문서확인에서도 DOM에 남음).
- **작성완료까지만 자동화**하고, 전자서명·전자제출(최종 제출)은 반드시 사용자 확인 후 진행. (메모리 `feedback_ecfs_submission`)

### 보정서는 이폼(전자문서작성)으로 작성 — 파일첨부 PDF보다 우선 (2026-07-21 사용자 확정)

보정서(특히 인지대·송달료 보정)는 **PDF 업로드가 아니라 이폼(전자문서작성)으로 항목별 입력**한다. 이폼은 사건에서 **원고·피고를 자동 기입**하고 "다 음" 앞 preamble("**귀원의 보정명령에 따라 다음과 같이 보정합니다**")을 자동 생성하므로, PDF 본문 캡션에 원고/피고가 안 찍히는 문제가 없다.

- 참고 스크립트: `eform-bojeong-nominee.js`, `eform-bojeong.js`. 필드/화면 탐색은 `probe-bojeong-eform.js`.
- 흐름: `findCase → openSubmission → selectDocType('보정서')`(파일모드 전환 안 함) → 아래 4단계 → `completeAndVerify()`.
  1. **보정명령 선택·등록**: 라디오 `name*=amndm_grd_stmpAmndm` 첫 항목(인지대·송달료) 클릭 → `#mf_pfwork_wfm_amndm_btn_save`.
  2. **보정 사유 입력·등록**: textarea `#mf_pfwork_wfm_file_txa_hangsoInfo`에 본문(“다 음” 이후 내용) 입력 → input/change/keyup 디스패치 → `#mf_pfwork_wfm_file_btn_hangso_save`. 값은 plain text, 번호("1. …")도 직접 타이핑.
  3. **서류명의인 등록**: 원고 소송대리인(변호사)이 이미 있으면 `#mf_pfwork_wfm_docmntNmnr_btn_save`만 누르면 됨(보정서는 selectNominee 없이도 작성완료 통과됨).
  4. **첨부서류(납부확인서)**: 서류종류 `#..._atch_sbx_docKind`를 '직접입력'으로 → 서류명 `#..._atch_ibxDocNm`에 "납부확인서" → `btn_searchFile`(filechooser)로 파일 → `btn_addedList` → `btn_save`.
- ✍️ **"다음" 앞에 들어가는 글(preamble)은 최대한 간결·건조하게.** 이폼 자동 preamble("귀원의 보정명령에 따라 다음과 같이 보정합니다")이 이미 그 기준이다 — "위 사건에 관한 …자 보정명령(…)에 대하여 원고의 소송대리인은 …" 식의 장황한 서두는 쓰지 말 것. (메모리 `feedback_bojeong_eform`)
- **납부확인서 PDF**는 `save-nabu-confirm-pdf.js <out> <사건번호끝자리>`로 전자소송 납부내역에서 추출하되, **가상계좌내역 리스트가 텍스트 레이어로 함께 캡처되어 타 사건 정보가 새므로 반드시 이미지로 flatten**(PyMuPDF `get_pixmap`→jpeg→새 PDF, 텍스트 0)한 `_제출본.pdf`를 첨부한다.
- 재작업으로 **PDF-업로드 초안과 이폼 초안이 중복**되면 `resumeDraft`가 둘 다 매칭해 최종제출 때 엉뚱한 초안을 잡는다. 이폼으로 다시 만들 땐 `delete-draft-<serial>.js`로 **기존 초안을 먼저 삭제**(작성중서류 임시저장목록에서 사건번호+문서명 매칭 행 체크 → 선택항목삭제 → 예)한 뒤 작성한다.

## 최종 제출 (전자서명 + 전자제출) — 반드시 사용자 확인 후

검증된 경로: `ecfs-final-submit.js` 참조.

1. **확인완료된 초안은 작성중서류의 "제출대기목록" 탭에 있다** (임시저장목록 아님 — `resumeDraft`로는 못 찾음). 탭 클릭 후 문서명 링크로 진입.
2. 진입/문서제출 클릭 시 "[인증서] 프로그램이 설치되지 않았습니다. 설치하시겠습니까?" 모달이 뜸 → **반드시 '아니요'** (`dismissModal`은 '예'를 눌러 설치 페이지로 이탈하므로 금지. 전용 `declineInstall` 사용).
3. 최종문서확인 화면에서 "모든 문서의 내용에 이상이 없음" 체크(`mf_pfwork_cbx_confirm_input_0`) → **확인완료** 클릭 → 4.전자제출 화면(버튼명 **"문서제출"**, '전자제출' 아님).
4. **문서제출** 클릭 → 설치 모달 '아니요' → 로그인과 동일한 xwup 웹 인증서창이 뜸 → file input 주입 + 인증서 암호로 서명하면 즉시 접수됨.
5. 접수 화면에서 접수번호·접수일시 확인, 스크린샷 보관. 접수증명신청서는 전자서명 요청 전에만 생성 가능.
6. 제출 여부 사전 확인은 `ecfs-list-submitted.js`(제출서류 목록, 읽기 전용).

### 소장(신규 사건) 최종 제출 특이사항 (2026-07-13 검증)

- 소장 플로우는 준비서면과 달리 **1.문서작성 → 2.최종문서확인 → 3.전자서명 → 4.소송비용납부 → 5.전자제출** 순. 확인완료 후 4.소송비용납부 화면으로 이동한다.
- **소송비용납부 필수 입력**: ① 인지 납부당사자(팝업) ② 납부인(팝업, 원고대리인 행 선택) ③ 송달료 납부당사자(팝업) ④ 송달료 납부당사자 휴대전화 ⑤ 계좌환급 불가시 환급통지 방식(문자메시지 등) ⑥ 가상계좌 납부은행 선택. 환급계좌는 프로필에서 자동 입력됨.
- **납부당사자선택 팝업 함정**: 열자마자 목록이 비어 있음 — **당사자명을 입력 후 '조회'**를 눌러야 행이 나타난다. 행 라디오 선택 → 확인 → "등록하시겠습니까?" 예. 빈 목록에서 확인을 누르면 "납부당사자가 선택되지 않았습니다" 경고가 뜨고 팝업이 중첩되기 시작한다.
- **⚠️ 사건분류를 위한 설문지**: '문서제출' 클릭 시 설문지 팝업이 뜬다. **답변 체크박스는 절대 건드리지 말고 그대로 제출 버튼을 누른다**(설문 미작성 상태로 문서제출이 진행됨 — 사용자 확정 정책 2026-07-13). '작성취소'를 누르면 설문만 닫히고 **문서제출 자체가 중단**되므로 금지. 팝업을 헤더 X로 닫아도 마찬가지이며, 반복하면 wframe DOM이 중복 생성되어("id 중복사용" 다이얼로그) 이후 클릭이 전부 막힌다 → 이 상태가 되면 index.on으로 새로고침 후 제출대기목록에서 재진입.
- **재진입 시 소송비용납부 입력값(당사자·전화번호·가상계좌은행)은 초기화**되어 다시 입력해야 한다 (등록했더라도 유지 안 됨).
- **소송비용납부(전자결제·가상계좌 발급) 서비스 이용시간**: 평일 09:00~22:00, 휴일·공휴일 09:00~20:00. 시간 외에는 납부 단계 진행 불가 안내 화면이 뜬다.
- 인지·송달료는 시스템이 자동 산정(예: 소가 2억 → 인지 769,500원(전자소송 10% 감액), 송달료 169,200원). 가상계좌 납부는 전자결제수수료 없음.

## 소송비용납부 (인지·송달료 가상계좌 발급)

이미 접수된 사건에 인지·송달료를 납부할 때. **소장 제출 플로우 안의 납부단계와는 다른 화면**이다 — 이쪽은 금액이 0으로 비어 있는 **수동입력**이고 시스템이 확정액을 안 알려준다.

```
node ecfs-cost-calc.js --sua 200000000 --defendants 2 --level 단독     # 1) 금액 산정
node ecfs-cost-pay.js ○○지방법원 20XX가단XXXXXX \                  # 2) 폼작성+검증 (기본 미발급)
     --stamp 769500 --delivery 169200 --phone <사무소 연락처>
node ecfs-cost-pay.js ... --confirm                                    # 3) 사용자 승인 후 발급
node ecfs-cost-verify.js XXXXXX                                       # 4) 실제 발급 확인 (필수)
```

### 금액 산정 (`ecfs-cost-calc.js`)
- **인지** = 소가 구간식 × **9/10**(전자소송 감액, 전자문서법 §8). 1억~10억 구간 = 소가×40/10000+55,000. 예) 소가 2억 → 855,000 × 0.9 = **769,500원**
- **송달료** = ⚠️ **피고 수** × 회차 × **5,640원**. 전자소송은 원고가 전자송달을 받으므로 **당사자 전원이 아니라 피고 수만** 곱한다. 회차: 소액 10 / 단독·합의 15 / 항소 12 / 상고 8. 예) 피고 2명 단독 → 2×15×5,640 = **169,200원**
- 🔴 **철칙: 전자소송 시스템이 산정한 금액 > 내 공식 계산.** 어긋나면 공식이 틀린 것이니 산정값을 따르고 역산해 규칙을 고칠 것. (2026-07-15 실사건에서 시스템 169,200을 "공식과 안 맞는다"며 자체계산 247,500으로 덮어 78,300원 과다 가상계좌를 발급 → 재발급으로 수습. 단가 5,640원도 이 역산으로 확정했다. 웹의 5,200/5,500 등은 낡거나 부정확하니 믿지 말 것)

### 화면 진입
`진행중사건 → 메뉴선택 → 소송비용납부`(`mf_pfwork_PSP221P02_wframe_btn_lwstCstPay`). 납부방식은 **가상계좌가 기본 선택**(수수료 없음).

### ⚠️ WebSquare 금액칸 = 10배 사고 지뢰
- 금액칸을 **Backspace로 비우면 WebSquare가 `0`을 자동삽입하고 커서가 그 앞**에 놓인다 → 타이핑하면 뒤에 0이 남아 **10배**가 된다 (769500 → 7,695,000). 실제로 밟았다.
- macOS 전체선택은 `Control+A`가 아니라 **`Meta+A`(Cmd+A)**. → 클릭 → Cmd+A → 타이핑(덮어쓰기) → Tab.
- `el.value=` + input/change 이벤트만으로는 **합계(총 납부금액) 재계산이 안 걸린다**(필드엔 보이는데 합계는 0원) → 반드시 실제 키보드 타이핑.
- `ecfs-cost-pay.js`의 `amtSet()`이 이 경로 + 3회 재시도 + 값 검증을 담당한다.

### 입력 순서와 ID
인지체크 `cbx_stmpAmt_input_0` → 금액 `ibx_stmpAmt` → 계좌확인 `btn_stmpAmtAcntIdnty` → 송달체크 `cbx_dlvrf_input_0` → **인지환급계좌와 동일** `cbx_dlvrf_input_1` → 송달금액 `ibx_dlvrf` → 휴대폰 `sbx_mblTelno1`+`ibx_mblTelno2`+`ibx_mblTelno3` → 계좌확인 `btn_dlvrfAcntIdnty` → 환급통지 `rad_rfndAvtsmtMeansCd_input_0/1/2`(문자/**카카오톡**/우편) → 가상계좌은행 `sbx_vtulAcntIssuBankCd` → 최종 **`btn_lwstCstPay`**
- 환급계좌(은행·계좌·예금주)는 프로필에서 **자동입력**된다. 계좌확인 시 "계좌에 등록하시겠습니까?" 모달 → 예.

### 발급 정책 (사용자 확정 2026-07-15)
- `ecfs-cost-pay.js`는 **기본 미발급(dry)**: 검증 통과해도 캡처만 남기고 멈춘다. 사용자가 금액 확인 후 **`--confirm`**으로 재실행해야 발급.
- 검증(인지·송달료·총액·은행·환급통지)이 **하나라도 어긋나면 발급 버튼을 누르지 않는다**.
- **납부버튼 = 가상계좌 '발급'이지 송금이 아니다.** 금액이 틀렸으면 그 계좌는 **미납 방치(실효)**하고 올바른 금액으로 재발급하면 된다. 취소 기능은 없다. 다만 의뢰인에게는 **유효 계좌만** 전달할 것(내역 캡처엔 폐기 계좌도 같이 보인다).

### 발급 확인 (필수)
납부 클릭 후 **결과화면이 빈 페이지로 캡처되는 경우가 있다**(텍스트 0바이트). 발급 여부는 반드시 `ecfs-cost-verify.js` = **가상계좌내역**(`menuid_150803`)으로 확인. 상태 `발급`=미납, `납부`=입금완료. 목록은 **큰 파란 '조회'** 버튼을 눌러야 뜬다(작은 돋보기 조회 아님).

### 기타
- **서비스 시간**: 평일 09:00~22:00, 휴일 09:00~20:00. 시간 외엔 납부 단계 진행 불가.
- 브라우저 자동화는 **세션 분리 실행** 필수(아래 '주의' 참조) — 이 작업은 로그인만 20초라 세션이 끊기면 로그인 중에 죽는다.

### 이폼 중 리치에디터(청구원인 등)가 있는 서류 — CKEditor API로 넣을 것 (2026-08-19 확인)

「청구취지 및 청구원인 변경신청서」처럼 **변경된 청구원인**이 리치에디터인 이폼이 있다. 보정서 계열은 전부 일반
textarea라 선례가 없어 프레임을 뒤지다 사고가 났다. 정답은 메인 페이지의 CKEditor 인스턴스 API다.

```js
// 인스턴스명 = 원래 textarea id + '_'
await page.check('#mf_pfwork_wfm_prpcl_rad_input_input_0');   // '직접입력' 라디오 먼저
await page.evaluate(({n,html}) => {
  const ed = CKEDITOR.instances[n];      // 'mf_pfwork_wfm_prpcl_txa_clmCas_'
  ed.setData(html); try { ed.updateElement(); } catch(e){}
  return ed.getData();                    // 반드시 되읽어 검증
}, {n:'mf_pfwork_wfm_prpcl_txa_clmCas_', html});
```

🔴 **`page.frames().find(f => f.url().includes('PSPA13M'))` 금지.** 메인 프레임 URL이 `...m=PSPA13M01`이라
이 매칭에 **메인 프레임이 잡히고**, 거기에 `document.body.innerHTML=`을 쓰면 폼 DOM이 통째로 날아간다.
그 뒤 모든 버튼 클릭이 조용히 무시되고, "요소 소멸" 기준의 작성완료 판정은 **거짓 양성**이 된다.
프레임을 꼭 써야 하면 `page.frames().filter(f => f !== page.mainFrame())`로 자식만 본다.

기타 이 서류의 필드: 신청취지 `#..._prpcl_txa_aplyIntnt`(기본문구 "위 사건에 관하여 원고/피고는 다음과 같이
청구취지 및 청구원인 변경을 신청합니다."가 이미 들어 있으므로 **덮어쓰지 말 것**), 변경된 청구취지
`#..._prpcl_txa_prpcl`, 등록 `#..._prpcl_btn_save`, 소가증액 체크 `#..._prpcl_cbx_vsmlIcrs_input_0`(감축이면 미체크).

### 금융거래정보 제출명령 신청서 이폼 — WebSquare setValue 필수 (2026-08-22 검증)

가사/민사 「금융거래정보 제출명령 신청서」는 이폼이고, 컴포넌트 접두어는
`mf_pfwork_wfm_finDlngInfSbmsnOrdAplfrm_`. 참고 스크립트 `fin-order-submit.js`(작성),
`fin-cleanup.js`(초안 일괄 삭제).

🔴 **`el.value = ...` + input/change 디스패치는 이 이폼에서 통하지 않는다.** 화면에는 값이 보이고
바이트 카운터까지 올라가지만 WebSquare 데이터모델에는 안 들어가서, 작성완료 때
"대상기관의 명칭은(는) 필수 입력입니다"로 막힌다. 반드시 컴포넌트 API를 쓸 것.

```js
await page.evaluate(({id,val}) => {
  const c = $w.getComponentById(id);   // $w.getComponentById 사용 가능
  c.setValue(val);
  return c.getValue();                  // 되읽어 검증
}, {id: P + 'txt_trgtInstnNm', val: '주식회사 신한은행'});
```

- **대상기관 명칭/우편번호/기본주소는 DOM상 `disabled`**(조회 전용, 명칭은 `maxlength="4"`)지만
  `setValue`는 정상 반영되고 작성완료·PDF 생성까지 통과한다.
- **조회 팝업(`..._PSPA0EM01_wframe_`)의 기관 DB에는 시중은행 본점이 없다.** 지점·중소법인 위주라
  "신한은행"·"새마을금고중앙회"·"SC제일" 등은 0건 → 조회 경로만으로는 작성 불가. 검색어도 `ibx_search`에
  `setValue`로 넣어야 필터가 걸린다(`page.fill`은 빈 검색어로 조회됨).
- **우편번호가 비면** "우편번호 찾기 버튼을(를) 선택해 주십시오"로 막힌다 → 주소에 5자리 우편번호 필수.
- 입력방식은 `rad_inptMeansCd_input_1`(**서술형 입력**)을 켜야 아래 필드가 열린다:
  `txt_nmnrHmnMtr`(명의인 인적사항) / `cal_demnTrgtPerdBgng`·`cal_demnTrgtPerdEnd`(YYYYMMDD) /
  `txt_usePurp`(사용목적) / `txt_demnInfCtt`(요구하는 거래정보의 내용). **각 6,000 Bytes 한도**
  (한글 3B — 마크다운 `**` 제거 후 길이를 미리 재둘 것).
- 서류명의인(청구인 소송대리인)은 자동 등록되어 `selectNominee` 불필요.
- 한 문서에 **신규입력으로 최대 10개 신청**을 담을 수 있다(문서명에 대상기관이 자동으로 붙는다:
  `금융거래정보 제출명령 신청서(주식회사 신한은행)`). 기관별로 문서를 나눌지 한 문서에 묶을지 먼저 확인할 것.

⚠️ **탭 재사용 금지 + 포털 URL 주의** — 작성완료(최종문서확인) 화면에서 같은 탭으로 이동하면 이후
`page.hover('text=나의전자소송')`가 30초 타임아웃 난다. 문서마다 **탭을 새로 열거나 프로세스를 분리**할 것.
그리고 홈 URL은 `https://ecfs.scourt.go.kr/psp/index.on` — `/ecf/index.on`은 error.html(시스템 작업 안내)로 빠진다.

### 이폼·서류제출 공통 안전수칙 (2026-08-19 사고 반영)

1. **등록 직후 임시저장(`mf_pfwork_btn_tmpSave`)을 먼저 눌러 작업분을 보존**한 뒤 작성완료로 간다.
   임시저장 없이 브라우저를 죽이면 입력분이 전부 사라진다(임시저장목록·제출대기목록 어디에도 안 남는다).
2. 단계마다 **버튼 존재 여부 + 필드값을 되읽어 로그로 남긴다.** 클릭 성공/실패를 true/false로 찍어 두면
   DOM 오염과 정상 전환이 구분된다.
3. 작성완료 판정은 요소 하나가 아니라 **임시저장·등록 버튼이 함께 사라졌는지**로 본다.
4. 작업이 끝나도 브라우저를 죽이지 않는다(사용자 검토용).

### 진행중사건 목록에서 사건 찾기 — 알려진 함정 (2026-08-19)

- **법원 옵션명은 축약형이다.** `의정부지방법원 남양주지원`(X) → **`의정부지법 남양주지원`**(O). 틀리면
  `selectOption` 타임아웃. `#mf_pfwork_sbx_cortList`의 option 텍스트를 먼저 덤프해 확인할 것.
- **목록의 `메뉴선택` 버튼 id(btn11/btn23/…)는 페이지마다 재사용된다.** 찾은 id를 `#id`로 다시 클릭하면
  **다른 사건 팝업이 열린다.** → `findCase`가 대상 버튼에 유일 id(`ECFS_TARGET_MENU_BTN`)를 심어 반환하도록
  수정했고, `openSubmission(page, btnId, 사건번호)`에 **팝업 제목 사건번호 검증**을 넣어 불일치면 예외로 멈춘다.
- 로딩 오버레이 `___processbar2`가 클릭을 가로채고 그 사이 DOM이 교체된다 → `waitBusy(page)` 후 evaluate 내부 클릭.
- 조회 직후 그리드가 채워지기 전에 훑으면 빈 결과가 난다 → 행 탐색을 6회(2초 간격) 재시도.

## 작성중서류 이어쓰기·서류 교체

```
node ecfs-resume-edit.js <사건번호일부> <문서명> [옵션...]
```
- 옵션: `--inspect`(상태 덤프) / `--replace-main <PDF>`(본문 교체) / `--add-evidence <PDF,..>` / `--add-attach <PDF,..>` / `--fix-evidence 마:1[:이름1|이름2..]` / `--nominee <이름>` / `--complete` / `--shot <png>`
- 예: 본문 PDF만 갈아끼우고 작성완료 복귀
  `node ecfs-resume-edit.js 55734 준비서면 --replace-main "/path/새본문.pdf" --complete --shot /tmp/done.png`

**핵심 동작 원리 (어렵게 검증):**
1. 진입은 작성중서류 목록에서 **문서명 링크**(예: '준비서면') 클릭. **사건(문서)번호 링크는 사건정보 팝업만 열리므로 금지.** 화면 전환 판정은 body에서 '임시저장목록' 텍스트 소멸로.
2. 초안이 최종문서확인 단계면 **"이전으로가기"**로 1.문서작성 화면 복귀(`goBackToForm`).
3. 본문 삭제 = 파일명(`gen_atflLst_{N}_spn_atflNm`) 클릭(=행 선택) → `btn_fileDelete` → 확인 모달. 삭제·업로드 후 반드시 `등록`(`btn_save`)으로 확정.
4. 실패·중단 후 재시도 시 **처음부터 다시 제출하지 말 것** — 임시저장 초안이 회차마다 누적되고, 같은 파일이 2중 3중으로 등록된다. **이어쓰기(resume)가 원칙**이고, 끝나면 작성중서류에서 묵은 초안을 정리한다.

## 최종문서확인 미리보기 캡처

```
node ecfs-capture-final.js <사건번호일부> <문서명> <출력폴더>
```
- 초안이 작성완료(최종문서확인) 단계일 때, 좌측 서류목록(준비서면·[을마N]서증·판결문 첨부 등)을 하나씩 클릭해 인라인 뷰어를 문서별로 캡처한다.
- 뷰어는 팝업이 아니라 **같은 페이지 인라인 렌더링**이므로 viewport 캡처 방식. 항목당 로딩 약 8초.
- 제출 전 사용자 검수용 스크린샷 일괄 생성에 사용.

## 송달 알림 메일 감시 데몬 (상시 실행)

- `ecfs-mail-watch.py` — 금고 `GMAIL_USER` 계정을 IMAP IDLE로 감시. scourt.go.kr 발신 + 제목 "전자발송" 메일 감지 시 텔레그램 즉시 알림 → 90초 배칭 → `ecfs-auto-fetch.js` 실행.
- `ecfs-auto-fetch.js` — 미확인송달문서를 **유형 선별** 자동 처리 (2026-07-04 사용자 확정 정책):
  - 자동 열람·저장: '부본' 포함(단 '소장' 미포함) 또는 기일통지서·변경기일통지·기일변경명령·증거설명서·사실조회회신
  - 그 외(판결·결정·명령·조서·소장부본 등 기간 기산 문서)는 **열지 않고** 텔레그램 알림만
  - 저장 위치: `ECFS_DELIVERY_DIR` 폴더 (+ `_auto-index.json` 누적, 텔레그램으로 PDF 전송)
- launchd: `~/Library/LaunchAgents/local.ecfs-mailwatch.plist` (Label `local.ecfs-mailwatch`, KeepAlive)
  - 중지: `launchctl bootout gui/$(id -u)/local.ecfs-mailwatch`
  - 시작: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.ecfs-mailwatch.plist`
  - 로그: `logs/mailwatch.log`, 상태(마지막 UID): `.mail-watch-state.json`

## 파일 구성

2026-08-24 정리: 재사용 코어만 이 폴더에 남기고, 사건별 1회성·진단 스크립트 364개는
`~/.claude/skills-archive/ecfs-oneoffs/`로 옮겼다(삭제 아님, 폴더별 README 있음).
특허로(patent.go.kr) 스크립트 21개는 별도 스킬 `patent-ro`로 분리했다.

### 공유 모듈 (다른 스크립트가 require)
- `ecfs-login.js` — 로그인 모듈(검증된 파일주입 경로).
- `ecfs-utils.js` — 사건찾기·서류선택·업로드 + 이어쓰기(`resumeDraft`/`goBackToForm`/`deleteAllMainFiles`/`uploadMainWithRetry`/`uploadAttachment`/`fixEvidenceGrid`/`selectNominee`/`completeAndVerify`) 공통 함수.

### 송달문서
- `ecfs-check-delivery.js` — 송달문서 점검(미확인/전체 목록).
- `ecfs-open-save.js` — 송달문서 열람 + PDF 저장(미확인 안전가드 내장).
- `ecfs-case-docs.js` — 특정 사건 송달문서를 월별 구간(31일 제한)으로 반복 조회 → 목록/저장.
- `ecfs-record-download.js` — 사건기록 전체 다운로드(나의사건열람 → 문건별 PDF 저장).
- `ecfs-delivery-db.py` — 송달문서 SQLite DB 관리.
- `ecfs-mail-watch.py` + `ecfs-auto-fetch.js` — 송달 알림 메일 감시 데몬 + 유형 선별 자동 수집.

### 서류 제출
- `ecfs-submit-generic.js` / `ecfs-submit-brief.js` — 서류 제출(신규 작성, 파일첨부방식).
- `ecfs-submit-draft.js` — 임시저장까지만(작성완료·제출 안 함).
- `ecfs-submit-complete.js` — 작성완료까지만(전자서명·제출 안 함).
- `ecfs-resume-edit.js` — 작성중서류 이어쓰기·서류 교체·서증 정정·작성완료.
- `ecfs-verify-draft.js` — 임시저장목록 + 제출대기목록 점검.
- `ecfs-list-submitted.js` — 제출서류 목록 조회(읽기 전용).
- `ecfs-capture-final.js` — 최종문서확인 문서별 미리보기 캡처.
- `ecfs-final-submit.js` — **최종 제출(전자서명+전자제출) 검증된 레퍼런스**. 새 제출은 이걸 복사해 고칠 것.
- `delete-draft.js` — 작성중서류 임시저장 초안 삭제(중복 초안 정리 템플릿).

### 이폼(전자문서작성) 템플릿
- `eform-bojeong.js`(기본형) / `eform-bojeong-nominee.js`(서류명의인 등록형) — 보정서 이폼 제출 템플릿.
- `probe-bojeong-eform.js` — 이폼 필드 탐색기. 새 서류종류의 이폼 필드 ID를 찾을 때 먼저 돌린다.
- `fin-order-submit.js` — 금융거래정보 제출명령 신청서 이폼(WebSquare `setValue` 필수 사례).
- `fin-cleanup.js` — 초안 일괄 삭제.

### 소송비용
- `ecfs-cost-calc.js` — 인지액·송달료 계산기(브라우저 불필요). 송달료는 **피고 수**만 곱함.
- `ecfs-cost-pay.js` — 소송비용납부 폼작성 → 엄격검증 → `--confirm` 시에만 가상계좌 발급.
- `ecfs-cost-verify.js` — 가상계좌내역·전자납부내역 조회(발급/납부 확인, 읽기 전용).
- `save-vaccount-pdf.js` — 가상계좌 안내 PDF 저장.
- `save-nabu-confirm-pdf.js` — 납부확인서 PDF 저장(첨부 전 이미지 flatten 필요, 위 보정서 절 참조).

### 상시 세션 (CDP 포트 열고 로그인 상태 유지)
- `sojang-session.js` + `sojang-step.js` — 소장 작성용 상시 세션.
- `cases-session.js` + `cases-step.js` — 진행중사건 점검용 상시 세션(CDP 9444).
- 긴 다단계 작업은 세션을 띄워두고 `*-step.js`로 한 단계씩 밀어넣는 방식이 안전하다. 30분 세션 만료·중간 실패 시 처음부터 다시 안 해도 된다.

### 문서 변환
- `md2legalpdf.js` — 마크다운 → 법률서면 PDF.
- `md2sinchung.js` — 마크다운 → 신청서 PDF.

### 아카이브에서 찾기
화면 구조가 바뀌어 셀렉터를 다시 찾아야 하거나 과거 처리 방식을 확인할 때:
`~/.claude/skills-archive/ecfs-oneoffs/README.md`의 폴더 표를 먼저 볼 것
(`_probes/` 진단, `wikip-sojang/` 소장 전 과정, `bojeong/` 보정서, `fin-jemul/` 제출명령, `video-hearing/` 영상재판 등).
아카이브 스크립트는 `require('./ecfs-login')`을 쓰므로 **이 폴더로 복사한 뒤** 실행해야 한다.

## 주의

- 최종 제출·전자서명 등 되돌리기 어려운 행위는 **반드시 사용자 확인 후** 진행.
- 로그인 세션은 약 30분 유지(연장 버튼 있음). 장시간 작업 시 만료 주의.
- 장시간 브라우저 자동화는 터미널 세션 재시작 시 함께 죽는다. 세션과 분리하려면 `python3 -c "import subprocess; subprocess.Popen(['node','스크립트.js'], start_new_session=True, ...)"` 방식으로 실행(macOS에는 `setsid` 없음). 로그는 파일로 리다이렉트해 추적.
- 성공 알림 모달("정상적으로 삭제하였습니다" 등)이 떠 있는 상태에서 다음 버튼을 누르면 클릭이 무시된다. 각 조작 사이에 `dismissModal` 호출을 끼울 것.
