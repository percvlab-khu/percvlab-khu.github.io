# 계정 셋업 가이드

사이트 구현을 시작하기 전에 사람이 직접 해야 하는 작업이다. 순서를 지킬 것.

> **되돌리기 어려운 두 지점**
>
> 1. GitHub **개인 계정 이름과 조직 이름은 같은 네임스페이스**를 쓴다. 개인 계정을
>    `percvlab-khu`로 만들면 조직에 그 이름을 못 쓴다.
> 2. **조직 이름은 곧 사이트의 CNAME 대상**(`percvlab-khu.github.io`)이 된다.
>    나중에 바꾸면 DNS를 다시 신청해야 한다.

---

## 1단계. 랩 공용 Google 계정

`https://accounts.google.com/signup`

- 주소: `percvlab.khu@gmail.com` 형태를 권장. **학교 메일(`@khu.ac.kr`)로 만들지 않는다.**
  학교 계정은 졸업·퇴직 시 정지되며, 그 순간 복구 경로까지 함께 막힌다.
- **복구 수단이 이 계정의 수명을 결정한다.**
  - 복구 이메일: 지도교수 계정. (개인 학생 메일로 하면 졸업 시 복구 불가)
  - 복구 전화: 개인 휴대폰을 넣되, 인수인계 시 후배 번호로 교체할 것.
- 2단계 인증을 켜고 **백업 코드 10개를 인쇄해 연구실에 보관**한다.
  폰을 잃어버리면 이 코드가 유일한 복구 수단이다.

이 계정이 앞으로 GitHub 조직, Notion 워크스페이스, Drive 공유 폴더의 최종 소유자가 된다.

---

## 2단계. GitHub 가입 (Google 연동)

GitHub은 2025년 7월부터 Google 소셜 로그인을 정식 지원한다.

1. `https://github.com/signup` 접속
2. **"Continue with Google"** 선택 → 1단계에서 만든 계정으로 로그인
3. 사용자 이름(username)을 입력한다

**여기가 첫 번째 함정이다.** 이 계정의 username을 `percvlab-khu`로 정하면, 3단계에서 조직 이름으로
같은 문자열을 쓸 수 없다. 다음처럼 나눈다.

| | 이름 | 용도 |
|---|---|---|
| 개인 계정 (공용 Gmail) | `percvlab-owner` | 조직 소유자로 상주만 함 |
| 조직 | `percvlab-khu` | 실제 레포·사이트 |

4. 가입 후 **Settings → Password and authentication → 2FA를 활성화**한다.
   백업 코드는 1단계와 같은 곳에 보관한다.

> 이 계정으로는 평소 작업하지 않는다. 아무도 남지 않았을 때 조직을 되찾기 위한 **보험**이다.

---

## 3단계. Organization 생성

> 2026년 1월부터 **개인 계정을 조직으로 전환하는 기능은 폐기**되었다.
> 반드시 처음부터 조직으로 만들어야 한다.

1. `percvlab-owner`로 로그인한 상태에서
   우측 상단 프로필 → **Settings** → 좌측 **Organizations** → **New organization**
2. 요금제는 **Free**를 선택한다. (public 레포 무제한, 구성원 무제한)
3. 조직 이름: `percvlab-khu`
4. 연락 이메일: 랩 공용 Gmail

### 소유자 추가

조직 → **People** → **Invite member** → 본인 개인 GitHub 계정 초대 → 역할을 **Owner**로 지정.

이후 실제 작업은 본인 개인 계정으로 한다. 공용 계정은 다시 로그인할 일이 없다.

### 인수인계 시

후배 개인 계정을 Owner로 추가 → 전임자는 People에서 자신을 제거.
**비밀번호를 넘길 일이 없다.**

---

## 4단계. 레포지토리 생성

조직 페이지에서 **New repository**

- 이름: `percvlab-khu.github.io` — **정확히 `<조직명>.github.io`여야 한다.** 대문자 불가.
- 공개 범위: **Public** (무료 플랜은 public 레포만 Pages 배포 가능)
- README 생성 체크

생성 후 **Settings → Pages → Build and deployment → Source**를 **`GitHub Actions`**로 바꾼다.
(기본값인 "Deploy from a branch"가 아니다. 우리는 산출물을 커밋하지 않는다.)

---

## 5단계. Notion 워크스페이스

1. `https://notion.so` → **Google로 계속하기** → 공용 Gmail로 로그인
2. 새 워크스페이스 생성 (이름: PerCVLab)
3. 본인 개인 Notion 계정을 관리자로 초대

### 통합(Integration) 토큰 발급

1. `https://notion.so/my-integrations` → **New integration**
2. 유형: Internal, 워크스페이스: PerCVLab
3. **Secrets** 탭에서 `Internal Integration Token` 복사 → 안전한 곳에 임시 보관

### 두 번째 함정 — 데이터베이스 연결

**통합을 만든 것만으로는 API가 아무것도 못 읽는다.** 각 데이터베이스마다 수동으로 연결해야 하며,
빠뜨리면 빌드가 `404`로 실패한다.

데이터베이스를 만든 뒤, 각각에서:

> 우측 상단 `···` → **Connections** → **Connect to** → 방금 만든 통합 선택

연결이 필요한 대상 (설계 문서 §6):

- [ ] Site Config (페이지)
- [ ] News
- [ ] Research Areas
- [ ] Members
- [ ] Publications
- [ ] Photos
- [ ] Members Only

---

## 6단계. Google Drive 공유 폴더

공용 Gmail로 Drive에 폴더 생성 (예: `PerCVLab 세미나 자료`)

**공유 설정에서 "링크가 있는 모든 사용자"를 절대 선택하지 않는다.**
반드시 **"특정 사용자 추가"**로 랩 구성원 이메일을 개별 초대한다.

사이트에는 파일이 아니라 이 폴더 안 파일의 **링크만** 실린다. 링크가 유출되어도 Drive가 권한을
다시 검사하므로 권한 없는 사람은 열 수 없다. 이것이 이 설계의 이중 방어다.

졸업생은 이 폴더의 공유 목록에서 제거한다.

---

## 7단계. GitHub Secrets 등록

조직 레포 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `NOTION_TOKEN` | 5단계의 Internal Integration Token |
| `NOTION_DB_IDS` | 각 DB의 ID (JSON 형태, 구현 단계에서 확정) |
| `LAB_PASSWORD` | Members Only 비밀번호 |

### 비밀번호 생성

**무작위 단어 4개**를 쓴다. 연구실명·교수명·학교명이 들어가면 안 된다.

```bash
shuf -n4 /usr/share/dict/words | tr '\n' '-' | sed 's/-$//'
```

예: `granite-sparrow-tunnel-cobalt`

레퍼런스 사이트가 쓴 `tlfgjawltjdgns`(인명의 두벌식 표기) 같은 형태는 반복 횟수와 무관하게
한글 자모 변환 사전으로 수초 내에 뚫린다. 실제로 해당 사이트의 암호문은 이 비밀번호로
오프라인 복호화가 가능함을 확인했다.

---

## 완료 체크리스트

- [ ] 공용 Gmail 생성, 2FA 활성화, 백업 코드 인쇄 보관
- [ ] 복구 이메일을 지도교수 계정으로 설정
- [ ] GitHub 개인 계정 `percvlab-owner` 생성 (Google 로그인), 2FA 활성화
- [ ] 조직 `percvlab-khu` 생성 (Free)
- [ ] 본인 개인 계정을 조직 Owner로 추가
- [ ] 레포 `percvlab-khu.github.io` 생성 (Public)
- [ ] Pages Source를 `GitHub Actions`로 변경
- [ ] Notion 워크스페이스 생성, 통합 토큰 발급
- [ ] **DB 7개 전부에 통합 연결**
- [ ] Drive 공유 폴더 생성 (특정 사용자 초대 방식)
- [ ] GitHub Secrets 3개 등록

여기까지 끝나면 구현을 시작할 수 있다.

DNS 변경(`cvlab` → `percvlab-khu.github.io`) 요청은 **사이트 검수가 끝난 뒤**에 한다.
그전까지 Google Sites 원본은 그대로 둔다.
