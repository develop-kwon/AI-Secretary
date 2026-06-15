import {
  webSearchTool,
  hostedMcpTool,
  Agent,
  AgentInputItem,
  Runner,
  withTrace,
} from "@openai/agents";
import * as cron from "node-cron";
import "dotenv/config";

// ============================================================
// 🔑 API 키 설정
// ============================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const ZAPIER_AUTH    = process.env.ZAPIER_AUTH    ?? "";
const EMAIL_TO       = process.env.EMAIL_TO       ?? "eric010316@gmail.com";

if (!OPENAI_API_KEY) throw new Error("❌ OPENAI_API_KEY 없음 (.env 확인)");
if (!ZAPIER_AUTH)    throw new Error("❌ ZAPIER_AUTH 없음 (.env 확인)");

process.env.OPENAI_API_KEY = OPENAI_API_KEY;

// ============================================================
// 1. Tools
// ============================================================
const webSearch = webSearchTool({
  searchContextSize: "high",
  userLocation: { type: "approximate" },
});

const mcp = hostedMcpTool({
  serverLabel: "zapier",
  allowedTools: [
    "discover_zapier_actions",
    "enable_zapier_action",
    "disable_zapier_action",
    "list_enabled_zapier_actions",
    "execute_zapier_read_action",
    "execute_zapier_write_action",
    "send_feedback",
    "auto_provision_mcp",
    "list_zapier_skills",
    "get_zapier_skill",
    "create_zapier_skill",
    "update_zapier_skill",
    "delete_zapier_skill",
    "write_code_action",
    "get_configuration_url",
  ],
  authorization: ZAPIER_AUTH,
  requireApproval: "never",
  serverUrl: "https://mcp.zapier.com/api/mcp/mcp",
});

// ============================================================
// 2. Agents
// ============================================================

const agentA = new Agent({
  name: "Agent A - 뉴스 수집",
  instructions: `당신은 뉴스 수집 에이전트입니다. 반드시 웹 검색 도구를 사용해서 실제 기사를 찾아야 합니다.

[필수 실행 순서]
1. 사용자가 알려준 TODAY_DATE와 YESTERDAY_DATE 값을 확인하세요.
2. 웹 검색 도구로 아래 쿼리를 실행하세요 (쿼리에 날짜가 포함되어 있어 최신 결과가 나옵니다).
   - 쿼리1: "AI 뉴스 TODAY_DATE"
   - 쿼리2: "인공지능 기술 TODAY_DATE"
   - 쿼리3: "AI technology news TODAY_DATE"
3. 검색 결과의 각 기사에서 발행 날짜를 먼저 확인하세요.
   - TODAY_DATE이면 → 채택
   - YESTERDAY_DATE이면 → 오늘 기사가 3개 미만일 때만 채택
   - 그 이전 날짜이면 → 무조건 제외
4. 채택한 기사의 제목, 출처, 날짜를 검색 결과에서 그대로 복사하세요.

[절대 금지]
- 발행 날짜가 YESTERDAY_DATE보다 오래된 기사 포함
- "(기사 제목 미제공)", "미상" 같은 플레이스홀더 사용
- 발행 날짜 확인 없이 기사 선택
- 기사 제목이나 날짜 임의 작성

[출력 형식]
실제 기사 제목 (출처 언론사, YYYY-MM-DD) - 기사 주요 내용 (수치/기업명/전망 포함)
실제 기사 제목 (출처 언론사, YYYY-MM-DD) - 기사 주요 내용 (수치/기업명/전망 포함)
실제 기사 제목 (출처 언론사, YYYY-MM-DD) - 기사 주요 내용 (수치/기업명/전망 포함)`,
  model: "gpt-5.5",
  tools: [webSearch],
  modelSettings: { maxTokens: 3000, store: true },
});

const agentB = new Agent({
  name: "Agent B - 분류",
  instructions: `당신은 뉴스 분류 에이전트입니다.
뉴스 3개에 각각 아래 카테고리 중 하나를 태그로 붙이세요.
카테고리: [인공지능], [소프트웨어], [하드웨어/반도체], [IT비즈니스]
출력 형식: [카테고리] 기사 제목
200토큰 이내로 간결하게 출력하세요.`,
  model: "gpt-5.4-nano",
  modelSettings: { temperature: 0.3, topP: 1, maxTokens: 512, store: true },
});

const agentC = new Agent({
  name: "Agent C - 요약",
  instructions: `당신은 뉴스 상세 요약 에이전트입니다.
분류된 뉴스를 카테고리별로 묶어, 각 뉴스당 3~4개의 핵심 불릿 포인트(-)로 정리하세요.
- 구체적인 수치, 기업명, 향후 전망을 반드시 포함하세요.
- 1000토큰 이내로 작성하세요.`,
  model: "gpt-5.4-mini",
  modelSettings: { temperature: 0.5, topP: 1, maxTokens: 2048, store: true },
});

const agentD = new Agent({
  name: "Agent D - 정제",
  instructions: `당신은 뉴스레터 편집 에이전트입니다.
요약본을 Gmail에서 바로 렌더링되는 HTML로 변환하세요.

[HTML 템플릿 - 기사 3개 모두 적용]
<h2>📌 [카테고리명]</h2>
<h3>📰 [기사 제목]</h3>
<ul>
  <li><b>출처 및 날짜:</b> [출처, YYYY-MM-DD]</li>
  <li><b>핵심 요약:</b>
    <ul>
      <li>[상세 내용 1]</li>
      <li>[상세 내용 2]</li>
      <li>[상세 내용 3]</li>
    </ul>
  </li>
  <li><b>💡 한 줄 시사점:</b> [AI 관점에서 1~2문장]</li>
</ul>
<hr>

[주의사항]
- \`\`\`html 같은 코드 블록 기호 절대 금지
- 순수 HTML 텍스트만 반환
- 1500토큰 이내`,
  model: "gpt-5.4-mini",
  modelSettings: { temperature: 0.5, topP: 1, maxTokens: 2048, store: true },
});

// agentE는 실행 시점의 날짜를 instructions에 직접 주입하기 위해 함수로 생성
function createAgentE(today: string): Agent {
  // Zapier "Find Events" 파라미터 매핑:
  //   start_time → "Start Time Before" (이 시각 이전에 시작하는 이벤트)
  //   end_time   → "End Time After"   (이 시각 이후에 끝나는 이벤트)
  // 오늘 하루 일정 전체를 잡으려면 값을 뒤집어야 함
  const startTimeBefore = `${today}T23:59:59`; // 오늘 자정 이전에 시작한 이벤트
  const endTimeAfter    = `${today}T00:00:00`; // 오늘 자정 이후에 끝나는 이벤트

  return new Agent({
    name: "Agent E - 캘린더 조회",
    instructions: `당신은 캘린더 일정 조회 전용 에이전트입니다.
오늘 날짜: ${today}

[실행 순서 - 반드시 준수]
STEP 1. 'list_enabled_zapier_actions' 도구를 호출해서 활성화된 액션 목록을 가져오세요.
STEP 2. 목록에서 Google Calendar 관련 액션의 정확한 action ID를 찾으세요.
         우선순위: "Find Events" > "Find Event" > "Quick Find Event" 순으로 찾으세요.
STEP 3. 찾은 action ID로 'execute_zapier_read_action' 도구를 호출하세요.
         아래 instructions 문자열을 그대로 사용하세요:
         "Find Google Calendar events where start_time is before ${startTimeBefore} and end_time is after ${endTimeAfter}. Return all events occurring on ${today} with title, start time, and end time."
STEP 4. STEP 3의 실제 응답 결과를 보고 HTML을 출력하세요.

[중요 규칙]
- STEP 1~3을 반드시 모두 실행한 뒤에만 출력하세요.
- 도구를 호출하지 않고 임의로 "일정 없음"을 출력하는 것은 절대 금지입니다.
- Google Calendar 액션을 찾지 못한 경우에만: <h2>🗓️ 오늘의 개인 일정</h2><ul><li>❌ Google Calendar 액션 없음. Zapier 연동 확인 필요.</li></ul>

[출력 형식]
일정 있는 경우:
<h2>🗓️ 오늘의 개인 일정</h2><ul><li>[시작시간]~[종료시간] - [일정명]</li></ul>

일정 없는 경우(도구 실행 결과가 실제로 비어있을 때만):
<h2>🗓️ 오늘의 개인 일정</h2><ul><li>오늘은 예정된 일정이 없습니다.</li></ul>

추가 텍스트 절대 금지.`,
    model: "gpt-5.4-mini",
    tools: [mcp],
    modelSettings: { temperature: 0.0, topP: 1, maxTokens: 2048, store: true },
  });
}

const agentF = new Agent({
  name: "Agent F - 최종 메일 발송",
  instructions: `당신은 이메일 발송 전용 에이전트입니다.
텍스트 답변 없이 즉시 'execute_zapier_write_action' 도구만 호출하세요.
호출 후 성공/실패 결과만 한 줄로 보고하세요.`,
  model: "gpt-5.4-mini",
  tools: [mcp],
  modelSettings: { temperature: 0.0, topP: 1, maxTokens: 8192, store: true },
});

// ============================================================
// 3. Helpers
// ============================================================

/** KST 기준 오늘 날짜 → YYYY-MM-DD */
function getTodayKST(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 메시지 헬퍼 — SDK AgentInputItem 타입에 맞게 생성 */
function userMsg(text: string): AgentInputItem {
  return {
    role: "user",
    content: [{ type: "input_text", text }],
  } as AgentInputItem;
}

/** 에이전트 실행 + 빈 출력 감지 */
async function runAgentSafely(
  runner: Runner,
  agent: Agent,
  history: AgentInputItem[],
  agentName: string
): Promise<string> {
  try {
    const result = await runner.run(agent, [...history]);
    const output = (result.finalOutput as string | undefined) ?? "";
    if (!output.trim()) throw new Error("출력이 비어 있습니다.");
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[${agentName} 실패] ${msg}`);
  }
}

/** KST 기준 N일 전 날짜 → YYYY-MM-DD */
function getKSTDateOffset(offsetDays: number): string {
  const now = new Date();
  now.setDate(now.getDate() - offsetDays);
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Agent A 재시도 래퍼 */
async function runAgentAWithRetry(
  runner: Runner,
  today: string,
  maxRetry = 3
): Promise<string> {
  const yesterday = getKSTDateOffset(1);
  const allowedDates = [today, yesterday]; // 허용 날짜: 오늘 + 어제

  const history: AgentInputItem[] = [
    userMsg(
      `TODAY_DATE = ${today}\nYESTERDAY_DATE = ${yesterday}\n오늘(${today}) 또는 어제(${yesterday}) 발행된 AI/IT 기술 뉴스 3개를 수집하세요. 오늘 기사를 우선 수집하고, 부족하면 어제 기사로 채우세요.`
    ),
  ];

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    console.log(`   🔄 뉴스 수집 시도 ${attempt}/${maxRetry} (허용 날짜: ${today}, ${yesterday})`);
    const output = await runAgentSafely(runner, agentA, history, "Agent A");

    // 허용 날짜(오늘/어제) 중 하나라도 2회 이상 등장하는지 확인
    const allowedCount = allowedDates.reduce((sum, date) => {
      return sum + (output.match(new RegExp(date, "g")) ?? []).length;
    }, 0);

    // 허용 날짜보다 오래된 날짜 패턴이 있는지 검사 (YYYY-MM-DD 형식)
    const datePattern = /\d{4}-\d{2}-\d{2}/g;
    const foundDates = output.match(datePattern) ?? [];
    const oldDates = foundDates.filter(d => !allowedDates.includes(d) && d < yesterday);

    if (oldDates.length > 0) {
      console.warn(`   ⚠️  허용 범위 초과 날짜 감지 (${oldDates[0]}) → 거부 후 재시도`);
      continue;
    }

    if (allowedCount >= 2) {
      console.log(`   ✅ 날짜 검증 통과 (최근 2일 내 기사 ${allowedCount}회 등장)`);
      return output;
    }
    console.warn(`   ⚠️  최근 기사 부족 (${allowedCount}회) → 재시도`);
  }

  console.warn("   ⚠️  최대 재시도 초과. 최근 기사 수집 실패.");
  return `최근 2일(${yesterday}~${today}) 내 AI/IT 뉴스를 찾지 못했습니다. 검색 엔진 색인 지연일 수 있습니다.`;
}

/** HTML 특수문자 이스케이프 */
function sanitizeForPrompt(html: string): string {
  return html
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

// ============================================================
// 4. Main Workflow
// ============================================================
export async function runWorkflow(): Promise<{ output_text: string }> {
  return withTrace("ai-briefing-agent", async () => {
    const today = getTodayKST();
    console.log(`\n📅 오늘 날짜 (KST): ${today}`);

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_6a2a5de6df7c81909a4bb1ba562e9fdb085d1ded040d84ce",
      },
    });

    // ── Step 1: 뉴스 수집 ────────────────────────────────────────
    console.log("\n🔍 [1/6] Agent A - 뉴스 수집");
    const newsRaw = await runAgentAWithRetry(runner, today);
    console.log("   ✅ 뉴스 수집 완료");

    // ── Step 2: 분류 ─────────────────────────────────────────────
    console.log("\n🏷️  [2/6] Agent B - 분류");
    const categorized = await runAgentSafely(
      runner,
      agentB,
      [userMsg(`다음 뉴스 3개를 분류해주세요:\n${newsRaw}`)],
      "Agent B"
    );
    console.log("   ✅ 분류 완료");

    // ── Step 3: 요약 ─────────────────────────────────────────────
    console.log("\n📝 [3/6] Agent C - 요약");
    const summarized = await runAgentSafely(
      runner,
      agentC,
      [userMsg(`다음 분류된 뉴스를 상세 요약하세요:\n${categorized}\n\n원문:\n${newsRaw}`)],
      "Agent C"
    );
    console.log("   ✅ 요약 완료");

    // ── Step 4: HTML 정제 ─────────────────────────────────────────
    console.log("\n🎨 [4/6] Agent D - HTML 정제");
    const newsHtml = await runAgentSafely(
      runner,
      agentD,
      [userMsg(`다음 요약을 HTML 뉴스레터로 변환하세요:\n${summarized}`)],
      "Agent D"
    );
    console.log("   ✅ HTML 정제 완료");

    // ── Step 5: 캘린더 조회 ───────────────────────────────────────
    console.log("\n📅 [5/6] Agent E - 캘린더 조회");
    const agentE = createAgentE(today);
    const calendarHtml = await runAgentSafely(
      runner,
      agentE,
      [
        userMsg(
          `오늘(${today}) 구글 캘린더 일정을 조회하세요. list_enabled_zapier_actions 먼저 호출해서 Google Calendar 액션 ID를 확인한 뒤 execute_zapier_read_action을 실행하세요.`
        ),
      ],
      "Agent E"
    );
    console.log("   ✅ 캘린더 조회 완료");

    // ── Step 6: 이메일 발송 ───────────────────────────────────────
    console.log("\n📧 [6/6] Agent F - 메일 발송");
    const finalHtml = `${newsHtml}\n<br><hr><br>\n${calendarHtml}`;
    const safeHtml  = sanitizeForPrompt(finalHtml);

    const finalOutput = await runAgentSafely(
      runner,
      agentF,
      [
        userMsg(
          `즉시 'execute_zapier_write_action' 도구를 호출해.
instructions 파라미터 값:

Execute the 'Send Email' action in Gmail.
To: ${EMAIL_TO}
Subject: [AI 브리핑 & 데일리 일정] ${today} 최신 기술 동향
Body:
${safeHtml}`
        ),
      ],
      "Agent F"
    );
    console.log("   ✅ 메일 발송 완료");

    return { output_text: finalOutput };
  });
}

// ============================================================
// 5. Scheduler
// ============================================================
console.log("⏰ AI 브리핑 오케스트레이터 가동. (대기 중...)");
console.log(`   📧 발송 대상: ${EMAIL_TO}`);
console.log("   🕐 실행 시간: 매일 오전 9시 KST (cron: 0 9 * * *)");

cron.schedule("46 13 * * *", async () => {
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log(`\n🚀 [${now}] 자동 실행 시작`);
  try {
    const result = await runWorkflow();
    console.log("\n✅ 완료:", result.output_text);
  } catch (err) {
    console.error("❌ 오류:", err instanceof Error ? err.message : err);
  }
});
