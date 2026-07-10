# PerCVLab 웹사이트

경희대학교 컴퓨터비전 연구실(PerCVLab) 웹사이트. **Notion에 글을 쓰면 사이트가 갱신된다.**

- 배포: https://percvlab-khu.github.io (도메인 신청 승인 후 `cvlab.khu.ac.kr`)
- 콘텐츠 원본: Notion 워크스페이스 (랩 공용 Google 계정 소유)
- 발표자료 파일: Google Drive 공유 폴더

---

## 운영 규칙

> **1. 유출되면 곤란한 자료는 이 사이트에 올리지 않는다.**
>
> Members Only는 접근 통제가 아니라 **암호화된 콘텐츠 배포**다. 브라우저가 복호화하려면
> 암호문이 먼저 브라우저에 배달되어야 하고, 배달된 것은 누구나 저장할 수 있다.
> 정적 호스팅의 구조적 한계이며 우회할 수 없다.

### 파일을 올리는 두 가지 방법

| | 암호화 첨부 (`Files`) | Drive 링크 (`Drive Link`) |
|---|---|---|
| 용량 | 파일당 5MB (Notion 무료) | 무제한 |
| 보호 방식 | 비밀번호로 복호화 | Google이 **매번 신원 확인** |
| 비밀번호 유출 시 | 저장해둔 암호문이 전부 열림 | 안전 (권한이 따로 있음) |
| 편의성 | Notion에 끌어다 놓으면 끝 | Drive에 올리고 링크 복사 |

**세미나 슬라이드·스터디 자료처럼 새어나가도 치명적이지 않은 것**은 `Files`에 첨부한다.
**미공개 연구자료·개인정보**는 반드시 `Drive Link`를 쓴다. Drive는 링크가 유출돼도
권한 없는 사람이 열지 못한다.

암호화 첨부는 `[IV(12B) || 암호문+태그]` 원시 바이너리로 배포된다. 파일명·크기조차
암호문 안에만 있어서 잠금 밖에서는 목록도 볼 수 없다. 오버헤드는 28바이트다.
CI가 평문 시그니처(`%PDF`, `PK`, `JFIF` 등)를 검사해 실수로 평문이 배포되는 것을 막는다.

> **2. 비밀번호에 연구실명·교수명·학교명을 쓰지 않는다.**
>
> 무작위 단어 4개를 쓴다. 이름을 한글 두벌식으로 친 문자열 같은 것은 반복 횟수와 무관하게
> 사전 공격으로 수초 만에 뚫린다.
>
> ```bash
> shuf -n4 /usr/share/dict/words | tr '\n' '-' | sed 's/-$//'
> ```

> **3. 구성원이 졸업하면 비밀번호를 교체하고 Drive 공유 목록에서 제거한다.**
>
> 반년마다 GitHub 이슈로 알림이 온다(`maintenance.yml`).

---

## 콘텐츠를 고치려면

**코드를 만질 필요가 없다.** Notion에서 고치면 최대 3시간 안에 사이트에 반영된다.
급하면 Actions 탭에서 `Notion sync & deploy`를 수동 실행한다.

| 하고 싶은 것 | Notion에서 할 일 |
|---|---|
| 공지 추가 | `News` DB에 행 추가 후 `Published` 체크 |
| 새 논문 등록 | `Publications` DB에 행 추가 |
| 신입생 추가 | `Members` DB에 행 추가, `Photo`에 사진 첨부, `Order` 지정 |
| 졸업 처리 | `Members`의 `Alumni` 체크, `Current Position` 입력 |
| 랩 소개·연락처 수정 | `Site Config` 페이지 편집 |
| 내부 공지 | `Members Only` DB에 행 추가, `Category` 선택 후 `Published` 체크 |
| 자료실에 파일 올리기 | `Members Only` 행의 `Files`에 첨부 (5MB 이하). 큰 파일·민감 자료는 `Drive Link` |

`Members Only` 페이지는 `Category`(공지 / 세미나 / 일정 / 공용자료)별로 섹션이 나뉜다.
분류를 비워두면 "기타"로 모인다. 제목에 `[공지]` 같은 말머리를 붙일 필요가 없다.

새 데이터베이스를 만들면 반드시 **통합(integration)을 연결**해야 한다.
`···` → Connections → Connect to. 빠뜨리면 빌드가 404로 실패한다.

---

## 구조

```
Notion (원본)
   │  REST API 2025-09-03, 빌드 시점 fetch
   ▼
GitHub Actions (3시간마다 + 수동)
   ├─ scripts/fetch-notion.js     수집 + 이미지 다운로드
   ├─ scripts/notion-to-html.js   블록 → HTML
   ├─ scripts/build.js            _site/ 생성
   ├─ scripts/encrypt-lab.js      Members Only 암호화 (AES-256-GCM)
   └─ deploy-pages                레포에 커밋하지 않고 바로 배포
   ▼
GitHub Pages
```

**npm 의존성이 하나도 없다.** Node 내장 모듈만 쓴다. 연구실 사이트는 몇 년씩 방치되다
급히 손보는 물건이라, 의존성이 없다는 것 자체가 기능이다. `npm install`도 필요 없다.

**빌드 산출물을 커밋하지 않는다.** 그래서 git 히스토리에 옛 암호문이 쌓이지 않고,
비밀번호 교체가 실제로 효력을 갖는다.

### 로컬에서 빌드하기

```bash
export NOTION_TOKEN=$(cat ~/.config/percvlab/notion_token)
export LAB_PASSWORD=아무거나
node scripts/build.js <SITE_CONFIG_PAGE_ID>
python3 -m http.server 8000 --directory _site
```

`notion-db-ids.json`이 있어야 한다(gitignore 대상). 없으면 `NOTION_DB_IDS` 환경변수로 준다.

---

## 도메인 전환 (아직 하지 않음)

학교에 `cvlab` 서브도메인 CNAME을 `percvlab-khu.github.io`로 변경 신청한다.
**기존 Google Sites 레코드를 반드시 제거**해야 한다. 남아 있으면 인증서 발급이 실패한다.

승인되면 `.github/workflows/notion-sync.yml`의 두 줄을 주석 해제한다.

```yaml
SITE_ORIGIN: https://cvlab.khu.ac.kr
CUSTOM_DOMAIN: cvlab.khu.ac.kr
```

`CUSTOM_DOMAIN`이 설정되면 `CNAME` 파일이 배포된다. **DNS가 준비되기 전에 켜면
github.io 주소마저 열리지 않는다.** 전환 기간에도 Google Sites 원본은 살려둔다.

---

## 인수인계

1. 후배 GitHub 계정을 Organization(`percvlab-khu`) 소유자로 추가
2. Notion 워크스페이스와 Drive 폴더 접근 권한 이전 (랩 공용 Google 계정)
3. 전임자는 Organization에서 탈퇴

랩 공용 Google 계정은 조직 소유자로 상주하며, **모두가 떠나도 조직이 고아가 되지 않게 하는
보험**이다. 지우지 말 것.

---

## Secrets

| 이름 | 용도 |
|---|---|
| `NOTION_TOKEN` | Notion 통합 토큰 |
| `NOTION_DB_IDS` | 데이터베이스 ID (JSON) |
| `NOTION_CONFIG_PAGE_ID` | Site Config 페이지 ID |
| `LAB_PASSWORD` | Members Only 비밀번호 |

설계 문서: [docs/superpowers/specs/2026-07-10-percvlab-site-design.md](docs/superpowers/specs/2026-07-10-percvlab-site-design.md)
계정 셋업: [docs/setup-accounts.md](docs/setup-accounts.md)
