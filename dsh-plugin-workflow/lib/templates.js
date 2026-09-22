/**
 * Built-in workflow templates for the Desktop UI.
 */
import { WORKFLOW_API_VERSION } from './engine/models.js';
/** Ship common templates with the canonical apiVersion. */
export function listBuiltinTemplates() {
    return [
        {
            id: 'code-review',
            name: 'Code Review',
            description: 'Lint, test, review findings, and approval gate',
            category: 'development',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: code-review
  title: Automated Code Review
  description: Review code changes, run tests, and generate report
spec:
  steps:
    - id: lint
      type: script
      run: npm run lint
    - id: test
      type: script
      run: npm test
    - id: review
      type: task
      deps: [lint, test]
      inputs:
        focus: security,performance
      role: review
    - id: approve
      type: approval
      deps: [review]
      question: Approve code review report?
      options: [approved, rejected, needs-changes]
    - id: report
      type: llm
      deps: [approve]
      prompt: |
        Summarize lint, tests, and review findings as markdown.
`,
        },
        {
            id: 'multi-llm-code-review',
            name: 'Multi-LLM Code Review',
            description: 'Parallel multi-perspective LLM review of code changes, summarized into a report',
            category: 'development',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: multi-llm-code-review
  title: Multi-LLM Code Review & Summary
  description: Collect recent diffs, run parallel LLM reviews (security / quality / architecture), then summarize
spec:
  max_concurrency: 3
  steps:
    - id: collect-diff
      type: script
      run: |
        set -e
        echo "## Workspace"
        pwd
        echo
        echo "## Status"
        git status -sb || true
        echo
        echo "## Recent commits"
        git log --oneline -n 8 || true
        echo
        echo "## Diff (truncated)"
        if git rev-parse --verify HEAD >/dev/null 2>&1; then
          if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
            git diff --stat HEAD~1..HEAD || true
            echo
            git diff HEAD~1..HEAD | head -n 500 || true
          else
            git diff --stat || true
            echo
            git diff | head -n 500 || true
          fi
        else
          echo "Not a git repository; listing tracked sources is skipped."
        fi
      timeout: 120

    - id: review-security
      type: llm
      deps: [collect-diff]
      role: security-reviewer
      prompt: |
        You are a security-focused code reviewer.
        Using the collected git status/diff context from the previous step and any
        workflow params (workspaceRoot, workspaceId), review for:
        1. Injection, XSS, SSRF, path traversal, and secret leakage
        2. AuthZ / AuthN mistakes
        3. Unsafe deserialization or command execution
        4. Dependency / supply-chain risks visible in the diff
        Return markdown with severity (critical/high/medium/low), file hints, and fixes.
        If context is insufficient, state assumptions explicitly.

    - id: review-quality
      type: llm
      deps: [collect-diff]
      role: quality-reviewer
      prompt: |
        You are a software quality reviewer.
        Using the collected diff/context, review for:
        1. Correctness and edge cases
        2. Readability, naming, and API clarity
        3. Error handling and observability
        4. Tests that should be added or updated
        Return markdown findings with concrete suggestions. Avoid restating the whole diff.

    - id: review-architecture
      type: llm
      deps: [collect-diff]
      role: architecture-reviewer
      prompt: |
        You are an architecture reviewer.
        Using the collected diff/context, review for:
        1. Layering / module boundary issues
        2. Coupling, duplication, and abstraction fit
        3. Scalability, performance, and operational risks
        4. Migration or compatibility concerns
        Return markdown findings prioritized by impact.

    - id: summarize
      type: llm
      deps: [review-security, review-quality, review-architecture]
      role: summary-editor
      prompt: |
        Merge the three parallel review outputs into one executive summary in markdown:
        1. Overall risk level (critical/high/medium/low) with one-sentence rationale
        2. Top findings table: severity | area | summary | suggested action
        3. Consensus themes across reviewers
        4. Disagreements or open questions
        5. Recommended next steps (ordered)
        Keep it concise and actionable. Do not invent findings not present in the reviews.

    - id: approve
      type: approval
      deps: [summarize]
      question: Accept the multi-LLM review summary?
      options: [approved, rejected, needs-changes]
`,
        },
        {
            id: 'multi-llm-problem-review',
            name: 'Multi-LLM Problem Review',
            description: 'Parallel multi-perspective LLM review of a stated problem, summarized (pass PROBLEM)',
            category: 'analysis',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: multi-llm-problem-review
  title: Multi-LLM Problem Review & Summary
  description: Analyze a user-specified problem with parallel LLM reviews, then summarize. Pass run param PROBLEM (or QUESTION).
spec:
  max_concurrency: 3
  steps:
    - id: collect-context
      type: script
      run: |
        set -e
        echo "## Problem"
        echo "\${PROBLEM:-<not provided>}"
        echo
        echo "## Workspace"
        pwd
        echo
        echo "## Status"
        git status -sb || true
        echo
        echo "## Recent commits"
        git log --oneline -n 8 || true
        echo
        echo "## Diff (truncated)"
        if git rev-parse --verify HEAD >/dev/null 2>&1; then
          if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
            git diff --stat HEAD~1..HEAD || true
            echo
            git diff HEAD~1..HEAD | head -n 400 || true
          else
            git diff --stat || true
            echo
            git diff | head -n 400 || true
          fi
        else
          echo "Not a git repository; code context is limited."
        fi
      timeout: 120

    - id: review-security
      type: llm
      deps: [collect-context]
      role: security-reviewer
      prompt: |
        You are a security-focused analyst.
        User problem / question:
        $PROBLEM

        Using the collected workspace/diff context and the problem above, assess:
        1. Security risks related to the problem
        2. Exploitability and blast radius
        3. Concrete mitigations and verification steps
        Return markdown with severity (critical/high/medium/low) and actionable fixes.
        If the problem is unrelated to security, say so briefly and note residual risks.

    - id: review-quality
      type: llm
      deps: [collect-context]
      role: quality-reviewer
      prompt: |
        You are a software quality analyst.
        User problem / question:
        $PROBLEM

        Using the collected context, analyze:
        1. Likely root causes and failure modes
        2. Correctness, edge cases, and missing tests
        3. Debugging steps and evidence to gather
        4. Practical code/process fixes
        Return concise markdown findings tied to the stated problem.

    - id: review-architecture
      type: llm
      deps: [collect-context]
      role: architecture-reviewer
      prompt: |
        You are an architecture analyst.
        User problem / question:
        $PROBLEM

        Using the collected context, analyze:
        1. Whether the issue is local, cross-module, or systemic
        2. Boundary, coupling, and design mismatches
        3. Longer-term structural options vs short-term patches
        4. Risks of each option
        Return prioritized markdown recommendations for this problem.

    - id: summarize
      type: llm
      deps: [review-security, review-quality, review-architecture]
      role: summary-editor
      prompt: |
        User problem / question:
        $PROBLEM

        Merge the three parallel analyses into one executive summary in markdown:
        1. Problem restatement (one sentence)
        2. Overall severity / urgency with rationale
        3. Top findings table: severity | area | summary | suggested action
        4. Most likely root cause
        5. Recommended next steps (ordered, concrete)
        6. Open questions / missing evidence
        Keep it actionable and do not invent findings absent from the reviews.

    - id: approve
      type: approval
      deps: [summarize]
      question: Accept the multi-LLM problem analysis summary?
      options: [approved, rejected, needs-changes]
`,
        },
        {
            id: 'multi-llm-coder',
            name: 'Multi-LLM Coder',
            description: 'Route a coding prompt, then parallel implement/verify/critique and synthesize (pass PROMPT)',
            category: 'development',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: multi-llm-coder
  title: Multi-LLM Coder Pipeline
  description: Route a coding prompt to a plan, then parallel implement/verify/critique and synthesize. Pass run param PROMPT.
spec:
  max_concurrency: 3
  steps:
    - id: route
      type: llm
      role: router
      prompt: |
        You are a workflow router for a multi-LLM coding pipeline.
        User prompt:
        $PROMPT

        Known preset template ids (prefer match when clearly applicable):
        - multi-llm-code-review: review a diff for security/quality/architecture
        - multi-llm-problem-review: analyze a stated defect/question with code context
        - multi-llm-coder: general implement/verify/critique coding work (this pipeline)

        Return ONLY a JSON object:
        {
          "match": "<templateId>|null",
          "plan": [{"id":"string","role":"implement|verify|critique|other","goal":"string"}],
          "rationale": "string",
          "shared": {
            "problem": "one-sentence restatement",
            "constraints": ["..."]
          }
        }
        If match is not null, still provide a short plan for this coder skeleton.
        Do not invent repository facts you cannot verify from the prompt.

    - id: dispatch
      type: llm
      deps: [route]
      role: dispatcher
      prompt: |
        User prompt:
        $PROMPT

        Read the router JSON from upstream. Publish a concise shared vision for downstream coders:
        1. Restate the goal
        2. If match is a different preset, note "suggested_preset: <id>" but continue this coder pipeline
        3. Expand the plan into concrete implementation/verify/critique goals
        Return markdown plus a final JSON block:
        { "shared": { "goal": "...", "plan": [...], "suggested_preset": null|"..." } }

    - id: implement
      type: llm
      deps: [dispatch]
      role: implement
      prompt: |
        You are an implementation-focused coder.
        User prompt:
        $PROMPT

        Using shared vision and upstream outputs, propose concrete code changes:
        - files to touch
        - unified-diff style patches when possible
        - risks / test gaps
        Keep changes minimal and tied to the plan.

    - id: verify
      type: llm
      deps: [dispatch]
      role: verify
      prompt: |
        You are a verification engineer.
        User prompt:
        $PROMPT

        Using shared vision, list how to validate the implementation:
        - commands/tests to run
        - edge cases
        - acceptance checks
        Do not rewrite the whole feature; focus on evidence.

    - id: critique
      type: llm
      deps: [dispatch]
      role: critique
      prompt: |
        You are a critical reviewer.
        User prompt:
        $PROMPT

        Challenge the plan and likely implementation:
        - correctness holes
        - security/performance risks
        - simpler alternatives
        Be specific and actionable.

    - id: synthesize
      type: llm
      deps: [implement, verify, critique]
      role: synthesize
      prompt: |
        User prompt:
        $PROMPT

        Merge implement/verify/critique into one markdown delivery:
        1. Goal
        2. Recommended changes (ordered)
        3. Verification checklist
        4. Residual risks
        5. Whether a different preset (suggested_preset) would fit better
        Do not invent findings absent from upstream outputs.

    - id: approve
      type: approval
      deps: [synthesize]
      question: Accept the Multi-LLM Coder synthesis?
      options: [approved, rejected, needs-changes]
`,
        },
        {
            id: 'problem-analysis',
            name: 'Problem Analysis',
            description: 'Collect context, analyze issues, propose recommendations',
            category: 'analysis',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: problem-analysis
  title: Problem Analysis Suggestions
  description: Analyze the current workspace problem and suggest next steps
spec:
  steps:
    - id: gather
      type: task
      inputs:
        scope: current-workspace
      role: research
    - id: analyze
      type: llm
      deps: [gather]
      prompt: |
        Analyze the gathered workspace context. Identify root causes,
        risks, and concrete recommended actions.
    - id: approve
      type: approval
      deps: [analyze]
      question: Accept the analysis recommendations?
      options: [approved, rejected, needs-changes]
`,
        },
        {
            id: 'deploy-pipeline',
            name: 'Deploy Pipeline',
            description: 'Build, test, and deploy with production approval',
            category: 'devops',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: deploy-pipeline
  title: Deploy Pipeline
  description: Build, test, and deploy
spec:
  steps:
    - id: build
      type: script
      run: npm run build
    - id: test
      type: script
      deps: [build]
      run: npm test
    - id: approve-prod
      type: approval
      deps: [test]
      question: Deploy to production?
      options: [approved, rejected]
    - id: deploy
      type: script
      deps: [approve-prod]
      run: npm run deploy
`,
        },
        {
            id: 'stock-trading-signal-review-approval-gate',
            name: 'Stock Signal Review Gate',
            description: 'Intraday A-share buy-signal AI triage: 3-way parallel LLM review → deliberation → pure-JSON verdict (no human gate); feeds stock_trader_client local OpenAI API',
            category: 'analysis',
            yaml: `apiVersion: ${WORKFLOW_API_VERSION}
kind: Workflow
metadata:
  name: stock-trading-signal-review-approval-gate
  title: "Stock Signal Review Gate (multi-LLM)"
  description: >
    A-share intraday signal quality gate for stock_trader_client via local OpenAI API.
    Model id equals metadata.name. Chat messages map to run param PROMPT (DecisionSnapshot).
    Flow: parallel specialist LLMs, then discuss/merge, then decide with pure accept/reject JSON.
    No human approval. Bind different models per step.role in workflow Settings providers.
spec:
  max_concurrency: 3
  steps:
    - id: review-technical
      type: llm
      role: market-analyst
      timeout: 90
      maxTokens: 8192
      prompt: |
        你是 A 股盘中「技术/量价」专项评审（AI盯盘）。
        只基于下列评估说明与 DecisionSnapshot，禁止臆造价格、指标或盘面事实；缺失字段必须忽略。

        专项重点：
        - 触发截面量价配合；仅当 post_trigger_use_for_decision=true 时可用触后短窗站稳
        - 禁止用事后长滞后涨跌（hindsight）否决或放行
        - 触发位置（低位突破 vs 高位追涨）、形态/风格风险、evidence_card 量价相关项
        - invalid_data / missing_fields：不得据此硬否决

        输出务必精简（全文不超过 600 汉字）。输出中文 markdown：
        - verdict: support / neutral / oppose
        - confidence: high / medium / low
        - 证据要点（3–6 条）
        - 会改变观点的关键字段
        - 明确标注未知项
        本步不要输出最终闸门 JSON。

        =====
        $PROMPT

    - id: review-sector
      type: llm
      role: market-analyst
      timeout: 90
      maxTokens: 8192
      prompt: |
        你是 A 股盘中「板块协同/可交易性」专项评审（AI盯盘）。
        只基于下列评估说明与 DecisionSnapshot，禁止臆造；缺失维度不得推断好坏。

        专项重点：
        - 共振真伪：top_resonance.authentic + strength_score，勿单看 rising_ratio
        - resonance_scope=same_plate 才可谈板块协同；pool_fallback/unavailable 时不得用 no_sector_synergy 或伪共振作为否决理由
        - 可交易性：tradable_label / under_band / over_band——over_band 不得 accept 追高
        - score_available=false 时不得以评分否决；score_exempt_upper 须按高分强势票审量价协同

        输出务必精简（全文不超过 600 汉字）。输出中文 markdown：
        - verdict: support / neutral / oppose
        - confidence: high / medium / low
        - 证据要点（3–6 条）
        - 会改变观点的关键字段
        - 明确标注未知项
        本步不要输出最终闸门 JSON。

        =====
        $PROMPT

    - id: review-risk
      type: llm
      role: risk-manager
      timeout: 90
      maxTokens: 8192
      prompt: |
        你是 A 股盘中「风控/弱市/仓位软约束」专项评审（AI盯盘）。
        只基于下列评估说明与 DecisionSnapshot，禁止臆造。

        专项重点：
        - market_regime.ai_enforce_block 与 risk_zone/allow_new_entry（缺失按 true 保守）
        - 弱市 soft/hard 口径；不得用「评估时点才变 BLOCK」覆盖触发截面
        - combined_risk_score / asia_hsi_divergence / timing_window_urgency
        - holdings：target_already_held、深套处置优先于新开仓讨论
        - 禁止仅因槽位已满或不在择时窗口而否决（那是硬过滤闸门职责）
        - risk_flags 优先受控词：chase_high、fake_resonance、weak_market、evidence_insufficient、nearby_day_high、block_soft、window_closed 等

        输出务必精简（全文不超过 600 汉字）。输出中文 markdown：
        - verdict: approve / reduce_confidence / reject
        - risk rating: critical / high / medium / low
        - 硬否决条件（若有）
        - 证据要点与未知项
        本步不要输出最终闸门 JSON。

        =====
        $PROMPT

    - id: discuss
      type: llm
      deps: [review-technical, review-sector, review-risk]
      role: summary-editor
      timeout: 90
      maxTokens: 8192
      prompt: |
        你是合议主持人。上游已注入三路专项评审（technical / sector / risk）的完整输出。
        结合下列原始评估材料，做多视角合议（不是简单投票算术平均）。

        合议要求：
        1. 共识：三路一致支持或一致反对的点
        2. 分歧：何处冲突、哪一路证据更贴近触发截面规则
        3. 规则优先：ai_enforce_block、over_band、事后 hindsight 禁用、缺失字段忽略等硬规则优先于口吻强弱
        4. 给出合议倾向：lean_accept / lean_reject，以及建议 confidence 区间与候选 risk_flags
        5. 一句话中文理由草稿（不超过 50 个汉字，供下游 decide 压缩）

        输出中文 markdown 合议备忘录即可（全文不超过 800 汉字）。禁止输出最终闸门 JSON。

        =====
        原始评估材料：
        $PROMPT

    - id: decide
      type: llm
      deps: [discuss]
      role: risk-control
      timeout: 60
      maxTokens: 8192
      prompt: |
        根据上游 discuss 合议备忘录与下列原始评估材料，给出最终自动闸门裁决。
        你是最后一道程序可读出口：交易客户端只会解析本步全文为 JSON。

        输出契约（必须逐字遵守，违反即无效）：
        1. 整个回答只能是一个 JSON 对象：第一个字符是左花括号，最后一个字符是右花括号；
        2. 禁止 markdown 代码块、禁止 JSON 前后任何文字；思考过程不要写入回答；
        3. 字段与顺序固定，decision 必须是第一个字段，且仅含 decision、confidence、risk_flags、reason；
        4. decision 只能是英文小写 accept 或 reject；
        5. confidence 为 0~1 小数；risk_flags 可为空数组；reason 不超过 50 个汉字；
        6. risk_flags 尽量用受控词：chase_high、fake_resonance、post_trigger_fade、volume_divergence、weak_market、invalid_data、extended_rally、gap_fade、evidence_insufficient、weak_volume、score_unavailable、plates_unavailable、pool_fallback、nearby_day_high、weak_breadth、window_closed、block_soft；仅 same_plate 且同伴弱时可用 no_sector_synergy。

        正确示例（整段回答仅此一行）：
        {"decision":"reject","confidence":0.8,"risk_flags":["chase_high"],"reason":"触发截面量价背离且板块协同不足"}

        =====
        原始评估材料：
        $PROMPT
`,
        },
    ];
}
//# sourceMappingURL=templates.js.map