# PerCVLab 웹사이트 재구축 설계

- 작성일: 2026-07-10
- 대상: `cvlab.khu.ac.kr` (경희대 PerCVLab, 지도교수 이승규)
- 상태: 승인됨 (구현 계획 작성 대기)

## 1. 배경

현재 `cvlab.khu.ac.kr`은 **Google Sites로 제작**되어 있다. 자체 소스코드가 없고, 모든 이미지가
`lh3.googleusercontent.com/sitesv/...` CDN에 호스팅된다. 따라서 이번 작업은 기존 사이트의 개조가
아니라 **콘텐츠를 이전한 신규 구축**이다.

현행 사이트 구성:

| 페이지 | 규모 | 갱신 빈도 |
|---|---|---|
| Home | 랩 소개, 공지 2건, 연구분야 8개, 연락처 | 자주 |
| Members | 53명 (교수 1 / 박사 2 / 석사 8 / 학사 4 / 졸업생 38) | 학기마다 |
| Publications | 약 100편 (1999–2026) | 매년 |
| Photos | 1장 | 거의 없음 |
| Archives | 외부 학회·저널 링크 21개 | 없음 |

## 2. 목표

1. Notion을 CMS로 사용해, 비개발자가 글만 써도 사이트가 갱신되도록 한다.
2. 기존에 없던 **Members Only** 페이지를 신설하고 비밀번호로 보호한다.
3. 도메인 `cvlab.khu.ac.kr`을 유지한다.
4. **완전 무료**로 운영한다. 유료 플랜과 체험판(trial)은 사용하지 않는다.
5. 비개발자 후배에게 인수인계 가능한 구조로 만든다.

## 3. 비목표 (Non-goals)

- 서버사이드 인증, 계정별 로그인, 접근 로그. (§7의 전환 경로로 남겨둠)
- Archives 페이지. **폐기한다.** 학회·저널 링크는 방문자 가치가 없다. 원본은 백업만 보관한다.
- 대용량 파일 호스팅. 발표자료 파일은 Google Drive가 담당한다.

## 4. 제약과 그로부터 도출된 결정

| 제약 | 검증된 사실 | 결정 |
|---|---|---|
| 무료 + 도메인 유지 | 서브도메인만 Cloudflare zone으로 위임하는 subdomain setup은 **Enterprise 전용** | Cloudflare Access 방식 폐기 |
| 무료 | GitHub Pages는 무료 플랜에서 **public 레포만** 배포 가능 | 레포는 public. "레포를 닫아 숨긴다"는 불가능 |
| 인수인계 | npm 의존성은 수년 뒤 빌드 실패의 주원인 | **정적 사이트 생성기 미사용.** Node 내장 모듈만 사용 |
| SEO | 논문·구성원이 검색에 잡혀야 함 | 공개 페이지는 빌드 시 **정적 HTML로 사전 생성** |
| 파일 보안 | 정적 호스팅은 URL을 아는 자를 막지 못함 | 발표자료는 **Google Drive**에 두고 링크만 게시 |

폐기된 대안: `dcom-intranet`(Laravel + MySQL). 서버와 유료 웹호스팅이 필수라 무료 조건과 충돌한다.
단, "가입 후 관리자 승인" 정책 아이디어는 §7 전환 시 채택한다.

## 5. 아키텍처

```
Notion (원본 CMS)
   │  Notion REST API, 버전 2025-09-03
   ▼
GitHub Actions  (3시간마다 + 수동 실행)
   ├─ fetch-notion.js     수집
   ├─ notion-to-html.js   블록 → HTML 변환
   ├─ encrypt-lab.js      Members Only만 AES-256-GCM 암호화
   ├─ upload-pages-artifact → deploy-pages   (레포에 산출물 커밋 안 함)
   └─ keepalive           50일 경과 시에만 타임스탬프 커밋
   ▼
GitHub Pages (org: percvlab-khu, public) ──CNAME──> cvlab.khu.ac.kr
   │
   └─ 발표자료 파일 없음 → Google Drive 링크 (권한은 Drive가 검사)
```

### 디렉토리 구조

레포에 커밋되는 것과 빌드가 생성하는 것을 엄격히 분리한다. **산출물은 커밋하지 않는다**(§7).

**레포 (커밋 대상)**

```
scripts/fetch-notion.js              Notion 수집
scripts/notion-to-html.js            블록 → HTML 변환
scripts/encrypt-lab.js               Members Only 암호화 (전환 시 이 파일만 교체, §8)
scripts/build.js                     위 셋을 엮어 _site/ 생성
scripts/lib/notion-api.js            REST 래퍼 (data_source 조회 포함)
templates/                           페이지 템플릿 (Home, Members, ...)
static/css/site.css                  스타일시트
static/CNAME                         cvlab.khu.ac.kr
tools/migrate-from-google-sites.js   일회성. 본 파이프라인과 분리
tools/archives-backup.json           폐기된 Archives 링크 백업
.github/workflows/notion-sync.yml
.github/workflows/maintenance.yml
.github/last-run                     keepalive 타임스탬프 (§10)
docs/
```

**빌드 산출물 `_site/` (커밋하지 않음, Pages로 직접 배포)**

```
index.html                Home
members/ publications/ photos/ contact/
lab/index.html            Members Only 잠금 화면 (단일 페이지 앱)
data/lab.enc.json         암호화된 Members Only
assets/img/members/       프로필 사진 (Actions 캐시에서 복원 또는 재다운로드)
assets/css/site.css
CNAME
```

**Actions 캐시 (레포 아님)**

```
.cache/images/            Notion에서 받은 이미지
.cache/asset-manifest.json   페이지별 last_edited_time
```

공개 페이지는 완성된 HTML로 생성되므로 `content.json` 같은 중간 산출물을 배포하지 않는다.
브라우저가 fetch하는 JSON은 `lab.enc.json` 하나뿐이다.

### 기술 선택의 근거

레퍼런스로 삼은 `wltjdgns.github.io`는 npm 의존성이 0개다. Node 내장 `https`, `crypto`, `fs`만으로
Notion REST를 직접 호출한다. 연구실 사이트는 수년간 방치되다 급히 손보는 자산이므로,
**의존성 없음 자체가 기능**이다. 이 철학을 계승한다.

단, 해당 사이트는 브라우저가 `content.json`을 받아 클라이언트에서 렌더링한다. 개인 블로그에는
적절하나 연구실 사이트에는 부적절하다(SEO). **공개 페이지는 빌드 시 완성된 HTML로 생성**한다.
Members Only만 예외다 — 어차피 색인되면 안 된다.

## 6. Notion 데이터 모델

데이터베이스 6개 + 설정 페이지 1개.

**Site Config** (일반 페이지) — 랩 소개문, 인사말, 연락처(주소·이메일·전화), 지도 링크.
Home과 Contact가 참조한다.

**News** — Title(제목), Date(날짜), Published(체크박스). 본문은 페이지 블록.

**Research Areas** — Title, Description, Image, Order.
현행 사이트의 연구 소개는 항목이 아니라 서술형 문단 5개였다. 그 문단은 Site Config로 옮겼고,
이 DB는 스키마만 두고 비워둔다. 항목화는 연구실이 직접 정의한다.

**Members**

| 속성 | 타입 | 비고 |
|---|---|---|
| Name | title | |
| Role | select | Professor / PhD / MS / BS |
| Alumni | checkbox | Role과 분리한다 (졸업한 박사를 표현해야 하므로) |
| Photo | files | 빌드 시 다운로드 |
| Email, Interests | rich_text | |
| Current Position | rich_text | 졸업생의 현재 소속 |
| Graduated | number | 졸업 연도 |
| Order | number | 정렬 |

졸업 처리는 Alumni 체크박스를 켜는 것으로 끝난다. Role(학위)은 그대로 둔다.

**Publications** — Title, Authors, Venue, Year(number),
Type(select: Journal/Conference/Workshop/Preprint), Link(url, 선택).
Preprint는 arXiv 논문을 위한 것이며, 링크는 arXiv 식별자에서 자동 생성한다.

**Photos** — Title, Date, Image, Caption.

**Members Only**

| 속성 | 타입 | 비고 |
|---|---|---|
| Title | title | |
| Category | select | 공지 / 세미나 / 일정 / 공용자료 |
| Date | date | |
| Author | rich_text | |
| Drive Link | url | 발표자료 파일 |
| Published | checkbox | |

이 DB에서 나온 것만 암호화된다. 나머지 다섯 개는 전부 공개 HTML로 나간다.

### 이미지 처리 (필수)

Notion API가 반환하는 이미지 URL은 S3 서명 링크이며 **1시간 후 만료**된다. HTML에 그대로 삽입하면
사이트의 모든 사진이 한 시간 뒤 깨진다. 따라서 **빌드 시점에 반드시 다운로드**한다.

`asset-manifest.json`에 각 페이지의 `last_edited_time`을 기록한다. 다음 빌드에서 값이 동일하면
다운로드를 건너뛴다. Notion의 초당 3회 요청 제한을 준수하고 불필요한 재다운로드를 막는다.
파일명에 내용 해시를 붙인다: `hoyeon-a1b2c3d4.jpg`.

### Notion API 주의사항

- 버전 `2025-09-03`부터 `/v1/databases/{id}/query`는 **폐기**되었다. `/v1/data_sources/{id}/query`를
  사용한다. 빌드 시작 시 database ID로 `data_source_id`를 조회하는 단계가 선행된다.
- Search API 필터는 `"page" | "data_source"`만 받는다(`"database"` 불가).
- 통합(integration)을 만든 것만으로는 접근할 수 없다. **각 DB마다 "연결(Connect to)"을 수동으로
  추가**해야 한다. 누락 시 404가 반환된다.

## 7. Members Only 보안 설계

### 위협 모델

| 상황 | 방어 여부 |
|---|---|
| 검색엔진에 내부 공지 노출 | 방어됨 (noindex + robots.txt) |
| 비번 모르는 외부인이 URL 직접 접근 | 방어됨 (복호화 불가) |
| 발표자료 파일 무단 다운로드 | 방어됨 (Drive 권한 검사) |
| 비번을 아는 자가 암호문을 저장 | **방어 불가** |
| 비번 유출 후 과거 자료 열람 | 부분 방어 (아래 참조) |

이 방식은 접근 통제(access control)가 아니라 **암호화된 콘텐츠 배포**다. 브라우저가 복호화하려면
암호문이 먼저 브라우저에 배달되어야 하고, 배달된 것은 누구나 저장할 수 있다. 정적 호스팅의
구조적 한계이며 우회 불가능하다.

### 레퍼런스 대비 개선점

`wltjdgns.github.io`는 3시간마다 암호문을 **레포에 커밋**한다. public 레포이므로 git 히스토리에
수년치 암호문이 누적된다. 비밀번호를 교체해도 옛 커밋을 옛 비번으로 열 수 있어 **교체가 무의미**하다.

본 설계는 **빌드 산출물을 커밋하지 않는다**. `upload-pages-artifact` → `deploy-pages`로 직접 배포하며,
암호문은 **현재 배포본 하나만 존재**한다. 비밀번호 교체 후 재빌드하면 옛 암호문은 소멸한다.
이미지 캐시는 Actions 캐시에 둔다.

### 암호 사양

```
키 유도 : PBKDF2-HMAC-SHA256, 600,000회 (OWASP 권고), salt 32바이트, 빌드마다 새로 생성
암호화  : AES-256-GCM, IV 12바이트
비번 검증: GCM 인증 태그로 대체. 비번 해시를 별도 저장하지 않는다(공격자에게 단서를 주므로)
구현    : 빌드=Node crypto, 브라우저=Web Crypto. 외부 라이브러리 0개
산출물  : data/lab.enc.json
          { "v":1, "kdf":{"iterations":600000,"salt":"…"}, "iv":"…", "ct":"…" }
```

### 비밀번호 정책 (파라미터보다 중요)

레퍼런스의 비밀번호 `tlfgjawltjdgns`는 인명을 한글 두벌식으로 친 것이다. 이런 비밀번호는 반복 횟수와
무관하게 **한글 자모 변환 사전으로 수초 내에 뚫린다.** 실제로 이 사이트의 `lab-encrypted.json`은
해당 비밀번호로 오프라인 복호화가 가능함을 확인했다.

**규칙: 무작위 단어 4개 조합 (예: `granite-sparrow-tunnel-cobalt`).**
연구실명·교수명·학교명에서 파생된 문자열을 사용하지 않는다. 60만 회 PBKDF2와 결합 시 GPU 공격에도
현실적으로 안전하다.

### 세션 처리

복호화 키를 **메모리에만 보관**한다. `sessionStorage`에 비밀번호나 키를 저장하지 않는다.
새로고침 시 재입력이 필요하므로, Members Only를 **단일 페이지 앱**으로 구성해 목록과 본문을
페이지 이동 없이 전환한다. 글 수가 수십 개 수준이라 자연스럽다.

### 이중 방어

발표자료 링크는 암호문 안에만 존재한다. 링크가 유출되어도 Google Drive가 권한을 재검사한다.
Drive 폴더 권한은 **"링크가 있는 모든 사용자"가 아니라 "특정 인원 초대"로 고정**한다.

### 운영 규칙 (README에 명시)

- 유출되면 곤란한 자료는 이 사이트에 올리지 않는다. 파일은 Drive 공유 폴더에 둔다.
- 비밀번호에 연구실명·교수명·학교명을 쓰지 않는다. 무작위 단어 4개를 쓴다.
- 구성원이 졸업하면 비밀번호를 교체한다.

교체 주기는 고정하지 않는다. 대신 `maintenance.yml`이 6개월마다 "비밀번호 교체 검토" 이슈를
자동 생성한다.

## 8. 향후 전환 경로 (서버사이드 인증)

`encrypt-lab.js`는 완성된 Members Only 데이터를 받아 **암호화만 수행하는 마지막 단계**다.
수집(`fetch-notion.js`)과 변환(`notion-to-html.js`)은 인증 방식과 완전히 독립적이다.

Netlify 또는 Vercel로 이전 시:

1. `encrypt-lab.js`를 제거한다.
2. 동일한 데이터를 인증 검사 후 반환하는 서버 함수로 대체한다.
3. 회원 이메일 목록을 `members.json`으로 레포에 두고, 이메일 6자리 코드로 검증한다. **DB 불필요.**
   목록에 한 줄 추가가 곧 가입 승인이고, 삭제가 곧 즉시 차단이다.
4. 도메인은 CNAME만 바꾸면 되며, 두 서비스 모두 외부 DNS를 허용한다.

수집·변환·템플릿 코드는 한 줄도 바뀌지 않는다.

## 9. 마이그레이션

**1단계 — 계정 준비.** `docs/setup-accounts.md` 참조.

**2단계 — 콘텐츠 이전 (일회성, 완료).** `tools/migrate-from-google-sites.js`가 현행 사이트를 파싱하고,
`tools/seed-notion.js`와 `tools/seed-notion-content.js`가 Notion API로 밀어 넣는다.

**프로필 사진은 반드시 먼저 내려받는다.** 실제로 2026-07-10 작업 중 Google Sites가 이미지 CDN을
`lh3.googleusercontent.com/sitesv/`에서 `lh7-us.googleusercontent.com/sitesv-images-rt/`로 교체했다.
하루도 지나지 않아 벌어진 일이다. 추출기는 두 호스트를 모두 인식하며, 프로필(`=w1280`)과
로고(`=w16383`)를 크기 파라미터로 구분한다. `raw_*.html`을 커밋해 두고 `--offline`으로 재현한다.

Archives는 하이퍼링크가 아니라 평문 목록이었다. `tools/out/archives-backup.json`에 백업만 하고
사이트에 싣지 않는다.

실제 결과:

| 항목 | 결과 |
|---|---|
| 구성원 | 45명 (교수 1, 재학 14, 졸업생 30). 사진 42장, 3명은 원본도 기본 아바타 |
| 논문 | 96편 (1999–2026). 랩 표기 "100+"는 반올림이었다 |
| 공지 | 2건 |
| Site Config | About 5문단, Contact 6줄 |

검수가 필요한 두 가지: `M.S - Ph.D Course`(통합과정) 1명을 PhD로 넣었으나 원본은 석사로 셌다.
`Ph.D Candidate` 2명의 재학/졸업 여부는 데이터로 판별할 수 없어 졸업으로 표시했다.

**3단계 — 빌드 파이프라인 구현.** 완료 시 `percvlab-khu.github.io`에서 사이트 확인 가능.

**4단계 — 검수.** 도메인 전환 전에 github.io 주소에서 확인한다. 논문 연도별 그룹핑, 사진 무결성,
Members Only 잠금 동작.

**5단계 — 도메인 전환.** 학교 전산실에 `cvlab` 서브도메인 CNAME을 `percvlab-khu.github.io`로
변경 요청한다. **기존 Google Sites 레코드는 반드시 제거**한다. 잔존 시 Let's Encrypt 인증서 발급이
실패한다. DNS 전파 최대 24시간, 인증서 발급 최대 1시간. **이 기간 Google Sites 원본은 유지**하며,
문제 발생 시 DNS만 되돌린다.

## 10. 운영 자동화

```
notion-sync.yml      3시간마다 + workflow_dispatch
  1. Notion 수집 → HTML 생성 → Members Only 암호화
  2. 이미지는 Actions 캐시에서 재사용, 변경분만 재다운로드
  3. upload-pages-artifact → deploy-pages
  4. keepalive: 마지막 커밋 후 50일 경과 시에만 타임스탬프 파일 갱신 커밋

maintenance.yml      6개월마다
  └─ "비밀번호 교체 검토" 이슈 자동 생성
```

### keepalive가 필요한 이유

GitHub은 **커밋 활동이 60일간 없으면 예약 워크플로를 자동 비활성화**한다. 이슈 생성, 스타, PR 병합은
활동으로 인정되지 않으며 **오직 커밋만 인정**된다. 본 설계는 산출물을 커밋하지 않으므로,
방학 두 달이 지나면 Notion 동기화가 조용히 멈춘다. 알림 메일 한 통이 오지만 공용 계정 메일함에
묻히기 쉽다.

따라서 마지막 커밋 후 50일이 지났을 때만 타임스탬프 파일을 갱신하는 커밋을 만든다. 연 7회 수준이며,
암호문은 여전히 커밋되지 않으므로 §7의 이점은 유지된다.

### GitHub Secrets

`NOTION_TOKEN`, `NOTION_DB_IDS`, `LAB_PASSWORD` 세 개. 레포에는 어떤 비밀값도 남기지 않는다.

## 11. 인수인계

1. 후배 GitHub 개인 계정을 Organization 소유자로 추가
2. Notion 워크스페이스 관리자로 초대
3. 랩 Gmail 비밀번호 및 Drive 폴더 소유권 이전
4. 전임자는 Organization에서 탈퇴

**후배는 레포를 클론하거나 코드를 이해할 필요가 없다.** Notion에 글을 쓰는 것이 전부다.

랩 공용 Gmail 계정은 Organization 소유자로 상주하며, **모든 구성원이 떠나도 조직이 고아가 되지 않게
하는 보험**이다. 학교 메일이 아닌 Gmail을 쓴다 — 학교 계정은 졸업·퇴직 시 정지되어 복구 경로까지 막힌다.

| 자산 | 소유 주체 |
|---|---|
| GitHub Organization | 랩 공용 Gmail |
| Notion 워크스페이스 | 랩 공용 Gmail |
| Google Drive 공유 폴더 | 랩 공용 Gmail |

## 12. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| Notion API 재변경 | 빌드 실패 | 마지막 배포본이 유지되므로 즉시 장애 아님. 버전 헤더 고정 |
| GitHub 무료 정책 변경 | 호스팅 중단 | Netlify 이전. 이때 서버 인증도 함께 획득 (§8) |
| Drive 권한 오설정 | 파일 유출 | "특정 인원 초대"로 고정. 링크 공유 금지 |
| 예약 워크플로 비활성화 | 동기화 중단 | keepalive 커밋 (§10) |
| 비밀번호 유출 | 현재 콘텐츠 노출 | 즉시 교체 후 재빌드. 과거 암호문은 이미 소멸 |
| Google Sites CDN URL 만료 | 프로필 사진 소실 | 마이그레이션 시 전량 다운로드 (§9) |

## 13. 참고

- 현행 사이트: https://cvlab.khu.ac.kr/
- 구조 레퍼런스: https://github.com/wltjdgns/wltjdgns.github.io
- 인증 레퍼런스(폐기): https://github.com/Dcom-KHU/dcom-intranet
- Notion 업그레이드 가이드: https://developers.notion.com/docs/upgrade-guide-2025-09-03
- OWASP Password Storage Cheat Sheet
- GitHub Pages 커스텀 도메인 문서
