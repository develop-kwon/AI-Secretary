# AI 브리핑 오케스트레이터

매일 오전 9시(KST) 자동으로 AI/IT 뉴스를 수집·요약하고 개인 구글 캘린더 일정을 합쳐 Gmail로 발송하는 멀티 에이전트 파이프라인입니다.

![예시 결과](https://github.com/user-attachments/assets/1154503a-6365-4604-9551-d18b4cfe4be7)

---

## 프로젝트 구조

```
newai/
├── index.ts          # 전체 로직 (에이전트 정의 + 워크플로우 + 스케줄러)
├── package.json      # 의존성 및 스크립트
├── .env              # API 키 (git 제외)
└── .gitignore
```

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 언어 | TypeScript (Node.js) |
| AI SDK | `@openai/agents` ^0.11.6 |
| 스케줄러 | `node-cron` ^4.2.1 |
| 환경변수 | `dotenv` ^17.4.2 |
| 실행 | `tsx` (ts-node 대체) |
| 외부 연동 | Zapier MCP (Gmail · Google Calendar) |

---

## 환경 변수 (.env)

```
OPENAI_API_KEY=...   # OpenAI API 키 (필수)
ZAPIER_AUTH=...      # Zapier MCP Bearer 토큰 (필수)
EMAIL_TO=...         # 발송 대상 이메일 (필수)
```

---

## 에이전트 파이프라인 (6단계)

```
[A 뉴스 수집] → [B 분류] → [C 요약] → [D HTML 정제] → [E 캘린더 조회] → [F 메일 발송]
```

### Agent A — 뉴스 수집
- 모델: `gpt-5.5`
- 도구: `webSearchTool` (서울/KR 컨텍스트)
- 역할: 오늘 또는 어제(KST) 발행된 AI/IT 기술 뉴스 3개 수집
- 특이사항: 최대 3회 재시도 (`runAgentAWithRetry`). 허용 날짜(오늘·어제) 범위 밖의 기사가 포함되면 자동 거부 후 재시도.

### Agent B — 분류
- 모델: `gpt-5.4-nano`
- 역할: 수집된 뉴스 3개에 카테고리 태그 부착
- 카테고리: `[인공지능]` `[소프트웨어]` `[하드웨어/반도체]` `[IT비즈니스]`
- 출력: 200토큰 이내

### Agent C — 요약
- 모델: `gpt-5.4-mini`
- 역할: 분류된 뉴스를 카테고리별로 묶어 핵심 불릿 포인트(3~4개)로 정리
- 제약: 수치·기업명·향후 전망 필수 포함, 1000토큰 이내

### Agent D — HTML 정제
- 모델: `gpt-5.4-mini`
- 역할: 요약본을 Gmail 렌더링 가능한 HTML 뉴스레터로 변환
- 형식: `<h2>`, `<h3>`, `<ul>/<li>`, `<hr>` 구조의 순수 HTML

### Agent E — 캘린더 조회
- 모델: `gpt-5.4-mini`
- 도구: `hostedMcpTool` (Zapier MCP)
- 역할: 실행 시점의 날짜를 주입해 동적 생성 (`createAgentE(today)`)
- 순서: `list_enabled_zapier_actions` → Google Calendar 액션 ID 확인 → `execute_zapier_read_action`으로 당일 일정 조회
- 출력: 일정 HTML (없으면 "예정된 일정 없음" 메시지)

### Agent F — 메일 발송
- 모델: `gpt-5.4-mini`
- 도구: `hostedMcpTool` (Zapier MCP)
- 역할: 뉴스 HTML + 캘린더 HTML을 합쳐 Gmail로 발송 (`execute_zapier_write_action`)
- 제목 형식: `[AI 브리핑 & 데일리 일정] YYYY-MM-DD 최신 기술 동향`

---

## 주요 유틸리티 함수

| 함수 | 설명 |
|------|------|
| `getTodayKST()` | KST 기준 오늘 날짜 반환 (`YYYY-MM-DD`) |
| `getKSTDateOffset(n)` | KST 기준 N일 전 날짜 반환 |
| `userMsg(text)` | SDK `AgentInputItem` 형식 메시지 생성 |
| `runAgentSafely(...)` | 에이전트 실행 + 빈 출력 시 에러 처리 |
| `runAgentAWithRetry(...)` | Agent A 최대 3회 재시도 + 날짜 검증 |
| `sanitizeForPrompt(html)` | HTML 내 백슬래시·백틱·`$` 이스케이프 |

---

## 스케줄 설정

```typescript
cron.schedule("0 9 * * *", ...);  // UTC 00:00 = KST 9:00
```

> cron 표현식 `0 9 * * *` = UTC 00:00 = **KST 9:00** 실행

---

## 실행 방법

```bash
# 의존성 설치
npm install

# 직접 실행 (스케줄러 없이 워크플로우 즉시 실행하려면 runWorkflow()를 직접 호출)
npx tsx index.ts

# 또는 ts-node
npx ts-node index.ts
```

---

## 데이터 흐름

```
웹 검색 → 뉴스 원문 (newsRaw)
               ↓
         [분류] categorized
               ↓
         [요약] summarized
               ↓
         [HTML] newsHtml
                              Zapier MCP → [캘린더] calendarHtml
               ↓                                    ↓
         finalHtml = newsHtml + calendarHtml
               ↓
         [Gmail 발송] via Zapier MCP
```

---

## 주의사항

- `.env` 파일은 절대 커밋하지 않습니다 (`.gitignore`에 등록됨).
- Zapier 대시보드에서 **Gmail Send Email** 및 **Google Calendar Find Events** 액션이 활성화되어 있어야 합니다.
- Agent A 날짜 검증 로직: 오늘·어제 날짜가 출력에 2회 이상 등장해야 통과합니다.
- `sanitizeForPrompt`로 HTML을 이스케이프한 뒤 프롬프트에 삽입하여 템플릿 리터럴 주입을 방지합니다.
