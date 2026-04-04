# Korean Law MCP

**대한민국 법령 검색·조회·분석 89개 도구** — 법령, 판례, 행정규칙, 자치법규, 조약, 해석례를 AI 어시스턴트나 터미널에서 바로 사용.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 법제처 Open API 기반 MCP 서버 + CLI. Claude Desktop, Cursor, Windsurf, Zed, Claude.ai 등에서 바로 사용 가능.

[English](./README-EN.md)

![Korean Law MCP 데모](./demo.gif)

---

## v2.3.2 변경사항

**프로덕션 코드 품질 개선** (47파일, -179줄)
- 이모지/장식 포맷팅 축소 → LLM 컨텍스트 토큰 절약
- 체인 도구 findLaws 캐시 적용 → 중복 API 호출 30-50% 절감
- 조문 파싱 코드 통합 (`formatArticleUnit` 공통 함수)
- Retry-After 헤더 지원, console.error 제거, 에러 처리 통일
- allTools Map 변환 (O(1) 조회), execute_tool 재귀 방지

<details>
<summary>v2.3.0~2.3.1 변경사항</summary>

## v2.3 변경사항

**원격 MCP 주소** (`your-key` 부분에 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 발급받은 본인 인증키(OC)를 넣으세요):

| 프로필 | URL | 도구 수 | 용도 |
|--------|-----|---------|------|
| lite | `https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=your-key` | 14개 | Claude.ai 등 웹 클라이언트 (컨텍스트 87% 절감) |
| full | `https://korean-law-mcp.fly.dev/mcp?oc=your-key` | 89개 | Claude Desktop, Cursor 등 네이티브 클라이언트 |

예시: 발급받은 인증키가 `honggildong`이면 → `https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=honggildong`

> lite는 체인 8개 + 핵심 4개 + 메타 2개로 동일 기능 커버. 특수 도구는 `discover_tools` → `execute_tool`로 접근.

- **도구 프로필 (lite/full)** — 89개 → 14개 자동 축소. 체인 도구가 내부에서 하위 도구를 직접 호출하므로 기능 손실 없음.
- **URL 쿼리 API 키** — `?oc=your-key`로 세션 전체에 API 키 자동 적용. 커스텀 헤더 설정이 어려운 웹 클라이언트에서 필수.
- **체인 자동 전문 조회** — `chain_ordinance_compare`가 자치법규 검색 후 상위 1건 전문을 자동 조회. 별도 `get_ordinance` 호출 불필요.
- **lite 도구 라우팅 개선** — 체인/메타 도구 description을 사용자 질문 의도 기반으로 재작성 + 예시 포함. Claude 웹이 "광진구 복무 조례" 같은 자치법규 질문에도 정확한 도구 선택.
- **도구 힌트 통일** — 비lite 도구 안내를 `execute_tool()` 호출 예시로 변경. 존재하지 않는 도구 직접 호출 문제 방지.
- **kordoc 통합 파서** — 자체 HWP5/HWPX/PDF 파서 5개를 [kordoc](https://github.com/chrisryugj/kordoc) 통합 파서로 교체. 의존성 경량화.

</details>

<details>
<summary>v2.2.0 변경사항</summary>

- **23개 신규 도구 (64 → 87)** — 조약, 법령-자치법규 연계, 학칙/공단/공공기관 규정, 특별행정심판, 감사원 결정, 조항상세, 문서분석, 행정규칙 신구대조 등 대폭 확장.
- **문서분석 엔진** — 8종 문서유형 분류, 17개 리스크규칙, 금액/기간 추출, 조항 충돌 탐지.
- **법령-자치법규 연계 (4개 도구)** — 법률↔조례 위임 체인을 양방향 추적.
- **조약 지원 (2개 도구)** — 대한민국이 체결한 양자/다자 조약 검색 및 전문 조회.
- **보안 강화** — CORS 오리진 제어, API 키 헤더 전용, 보안 헤더, 세션 ID 마스킹.

</details>

<details>
<summary>v1.8.0 – v1.9.0 기능</summary>

- **체인 도구 8개** — 복합 리서치를 한 번의 호출로: `chain_full_research`(AI검색→법령→판례→해석), `chain_law_system`, `chain_action_basis`, `chain_dispute_prep`, `chain_amendment_track`, `chain_ordinance_compare`, `chain_procedure_detail`.
- **일괄 조문 조회** — `get_batch_articles`가 `laws` 배열로 복수 법령 한 번에 조회.
- **AI 검색 법령종류 필터** — `search_ai_law`에 `lawTypes` 필터 추가.
- **구조화 에러 포맷** — `[에러코드] + 도구명 + 제안` 형식으로 64개 도구 통일.
- **HWP 테이블 수정** — 구형 HWP 파서에서 `paragraph.controls[].content` 경로의 테이블 추출 지원.

</details>

---

## 왜 만들었나

대한민국에는 **1,600개 이상의 현행 법률**, **10,000개 이상의 행정규칙**, 그리고 대법원·헌법재판소·조세심판원·관세청까지 이어지는 방대한 판례 체계가 있습니다. 이 모든 게 [법제처](https://www.law.go.kr)라는 하나의 사이트에 있지만, 개발자 경험은 최악입니다.

이 프로젝트는 그 전체 법령 시스템을 **89개 구조화된 도구**로 감싸서, AI 어시스턴트나 스크립트에서 바로 호출할 수 있게 만듭니다. 법제처를 백 번째 수동 검색하다 지친 공무원이 만들었습니다.

---

## 설치 및 사용법

### 0단계: API 키 발급 (무료, 1분)

모든 방법에 공통으로 필요한 **법제처 Open API 인증키(OC)**를 먼저 발급받으세요.

1. [법제처 Open API 신청 페이지](https://open.law.go.kr/LSO/openApi/guideList.do)에 접속합니다.
2. 회원가입 후 로그인합니다.
3. **"Open API 사용 신청"** 버튼을 누릅니다.
4. 신청서를 작성하면 **인증키(OC)**가 발급됩니다. (예: `honggildong`)
5. 이 인증키를 아래 설정에서 사용합니다.

---

### 방법 1: Claude.ai 웹에서 바로 사용 (설치 없음, 가장 쉬움)

아무것도 설치하지 않고, 주소 하나만 입력하면 됩니다. Claude Pro/Max/Team/Enterprise 요금제가 필요합니다 (Free는 커넥터 1개만 가능).

**커넥터 추가 방법:**

1. [claude.ai](https://claude.ai)에 로그인합니다.
2. 왼쪽 사이드바 하단의 **본인 이름**을 클릭합니다.
3. **"설정"** (또는 Settings)을 선택합니다.
4. **"커넥터"** (또는 Connectors) 메뉴로 들어갑니다.
5. **"커스텀 커넥터"** 영역에서 **"커스텀 커넥터 추가"** 버튼을 클릭합니다.
6. 아래 내용을 입력합니다:
   - **이름**: `korean-law` (원하는 이름 아무거나 OK)
   - **URL**: 아래 주소를 붙여넣으세요. `honggildong` 부분을 **0단계에서 발급받은 본인 인증키**로 바꾸세요:

```
https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=honggildong
```

7. **추가** 버튼을 누르면 등록 완료!

**도구 활성화 (중요!):**

8. 추가한 커넥터의 **"구성"** (또는 Configure)을 클릭합니다.
9. 도구 목록이 나오면, 모든 도구를 **"항상 사용"** (또는 Always allow)으로 설정합니다.
10. 이렇게 하면 매번 승인할 필요 없이 AI가 바로 법령을 검색할 수 있습니다.

**사용하기:**

11. 채팅 화면으로 돌아가서 "근로기준법 제74조 알려줘"라고 입력하면 끝!

> **참고**: 커넥터 URL을 수정하려면 삭제 후 다시 추가해야 합니다.

> **lite vs full 차이**: 위 주소는 lite 모드(14개 도구)입니다. 14개로도 89개 전체 기능을 사용할 수 있어요 — AI가 필요할 때 나머지 도구를 알아서 꺼내 씁니다. 모든 도구를 직접 보고 싶으면 주소에서 `profile=lite&`를 빼면 됩니다.

---

### 방법 2: AI 데스크톱 앱에서 사용 (설치 없음)

Claude Desktop, Cursor, Windsurf 같은 **데스크톱 앱**을 쓰고 있다면, 설정 파일에 아래 내용을 추가하세요.

**설정 파일 위치 찾기:**

| 앱 이름 | Windows | Mac |
|---------|---------|-----|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | 프로젝트 폴더 안 `.cursor/mcp.json` | 프로젝트 폴더 안 `.cursor/mcp.json` |
| Windsurf | 프로젝트 폴더 안 `.windsurf/mcp.json` | 프로젝트 폴더 안 `.windsurf/mcp.json` |

**설정 파일에 추가할 내용** (`honggildong`을 본인 인증키로 바꾸세요):

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp?oc=honggildong"
    }
  }
}
```

> 이미 다른 MCP 서버가 설정되어 있다면, `"mcpServers": { ... }` 안에 `"korean-law": { ... }` 부분만 추가하면 됩니다.

저장 후 앱을 **재시작**하면 법령 도구가 활성화됩니다.

---

### 방법 3: 내 컴퓨터에 직접 설치 (오프라인 가능)

인터넷 없이 쓰고 싶거나, 원격 서버를 거치지 않으려면 직접 설치할 수 있습니다.

**사전 준비:** [Node.js](https://nodejs.org) 18 이상이 설치되어 있어야 합니다.

**1. 터미널(명령 프롬프트)을 열고 설치합니다:**

```bash
npm install -g korean-law-mcp
```

**2. AI 앱 설정 파일에 아래 내용을 추가합니다** (`honggildong`을 본인 인증키로 바꾸세요):

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "honggildong"
      }
    }
  }
}
```

**3. 앱을 재시작하면 완료!**

---

### 방법 4: 터미널(CLI)에서 직접 사용

개발자라면 터미널에서 직접 법령을 검색할 수 있습니다.

```bash
# 설치
npm install -g korean-law-mcp

# 인증키 설정 (honggildong을 본인 키로 바꾸세요)
export LAW_OC=honggildong        # Mac/Linux
set LAW_OC=honggildong           # Windows CMD
$env:LAW_OC="honggildong"       # Windows PowerShell

# 사용 예시
korean-law "민법 제1조"                    # 자연어로 바로 조회
korean-law search_law --query "관세법"     # 도구 직접 호출
korean-law list                            # 89개 전체 도구 목록
korean-law list --category 판례            # 카테고리별 필터
korean-law help search_law                 # 도구별 도움말
```

---

### API 키 전달 방법 정리

여러 방법으로 인증키를 전달할 수 있습니다. 위에서부터 우선 적용됩니다:

| 방법 | 사용법 | 언제 쓰나 |
|------|--------|-----------|
| URL에 포함 | 주소 끝에 `?oc=내키` | 웹 클라이언트에서 가장 간편 |
| HTTP 헤더 | `apikey: 내키` | 프로그래밍으로 연동할 때 |
| 환경변수 | `LAW_OC=내키` | 로컬 설치(방법 3, 4) |
| 도구 파라미터 | `apiKey: "내키"` | 특정 요청만 다른 키 쓸 때 |

---

## 사용 예시

```
"관세법 제38조 알려줘"
→ search_law("관세법") → MST 획득 → get_law_text(mst, jo="003800")

"화관법 최근 개정 비교"
→ "화관법" → "화학물질관리법" 자동 변환 → compare_old_new(mst)

"근로기준법 제74조 해석례"
→ search_interpretations("근로기준법 제74조") → get_interpretation_text(id)

"산업안전보건법 별표1 내용 알려줘"
→ get_annexes(lawName="산업안전보건법 별표1") → HWPX 파일 다운로드 → 표/텍스트 Markdown 변환
```

---

## 도구 목록 (89개)

| 카테고리 | 개수 | 주요 도구 |
|----------|------|----------|
| **검색** | 11 | `search_law`, `search_precedents`, `search_all`, `get_annexes` |
| **조회** | 9 | `get_law_text`, `get_batch_articles`, `compare_old_new`, `get_three_tier` |
| **분석** | 10 | `compare_articles`, `get_law_tree`, `summarize_precedent`, `analyze_document` |
| **전문: 조세/관세** | 4 | `search_tax_tribunal_decisions`, `search_customs_interpretations` |
| **전문: 헌재/행심** | 4 | `search_constitutional_decisions`, `search_admin_appeals` |
| **전문: 위원회 결정** | 8 | 공정위, 개보위, 노동위, 감사원 |
| **특별행정심판** | 4 | `search_acr_special_appeals`, `search_appeal_review_decisions` |
| **법령-자치법규 연계** | 4 | `get_linked_ordinances`, `get_delegated_laws` |
| **조약** | 2 | `search_treaties`, `get_treaty_text` |
| **학칙/공단/공공기관** | 6 | `search_school_rules`, `search_public_corp_rules`, `search_public_institution_rules` |
| **지식베이스** | 7 | `get_legal_term_kb`, `get_daily_to_legal`, `get_related_laws` |
| **체인** | 8 | `chain_full_research`, `chain_law_system`, `chain_document_review` |
| **메타** | 2 | `discover_tools`, `execute_tool` (lite 프로필용) |
| **기타** | 10 | AI 검색, 영문법령, 연혁법령, 법령용어, 약칭, 법체계도, 행정규칙비교 |

전체 도구 상세는 [영문 README](./README-EN.md#tool-categories-89-total) 참조.

---

## 주요 특징

- **89개 법률 도구** — 법령, 판례, 행정규칙, 자치법규, 헌재결정, 조세심판, 관세해석, 조약, 학칙/공단/공공기관 규정, 법령용어
- **MCP + CLI** — Claude Desktop에서도, 터미널에서도 같은 89개 도구 사용
- **법률 도메인 특화** — 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출** — HWPX·HWP 파일 자동 다운로드 → 표/텍스트를 Markdown 변환
- **8개 체인 도구** — 복합 리서치를 한 번의 호출로 (예: `chain_full_research`: AI검색→법령→판례→해석)
- **도구 프로필** — 웹 클라이언트용 lite(14개), 파워유저용 full(89개) 자동 선택
- **캐시** — 검색 1시간, 조문 24시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-law-mcp.fly.dev/mcp`로 바로 사용

---

## 문서

- [docs/API.md](docs/API.md) — 89개 도구 레퍼런스 (프로필 포함)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 개발 가이드

## 라이선스

[MIT](./LICENSE)

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
