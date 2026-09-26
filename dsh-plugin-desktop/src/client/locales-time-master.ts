/** Locales for the Time Master UI. */

export type TimeMasterLocaleKey =
  | 'tab'
  | 'title'
  | 'hint'
  | 'empty'
  | 'loading'
  | 'error'
  | 'close'
  | 'newPlan'
  | 'editPlan'
  | 'save'
  | 'saving'
  | 'delete'
  | 'cancel'
  | 'aiFill'
  | 'aiFilling'
  | 'aiHintPlaceholder'
  | 'aiSourceAi'
  | 'aiSourceHeuristic'
  | 'fieldName'
  | 'fieldProvider'
  | 'fieldCycle'
  | 'fieldStartsAt'
  | 'fieldExpiresAt'
  | 'fieldRemindDays'
  | 'fieldNotes'
  | 'cycleMonthly'
  | 'cycleYearly'
  | 'cycleCustom'
  | 'urgencyExpired'
  | 'urgencySoon'
  | 'urgencyOk'
  | 'refresh'
  | 'tabPlans'
  | 'tabSchedules'
  | 'tabProjects'
  | 'tabCoord'
  | 'schedulesEmpty'
  | 'newSchedule'
  | 'editSchedule'
  | 'fieldScheduleName'
  | 'fieldHorizonDays'
  | 'fieldRationale'
  | 'fieldScheduleItems'
  | 'aiOrchestrate'
  | 'aiOrchestrating'
  | 'projectsEmpty'
  | 'newProject'
  | 'editProject'
  | 'fieldProjectTitle'
  | 'fieldProjectGoal'
  | 'fieldProjectStatus'
  | 'fieldTaskTitle'
  | 'fieldTaskDueAt'
  | 'fieldTaskStatus'
  | 'fieldTaskSession'
  | 'fieldTaskWorkflow'
  | 'fieldTasks'
  | 'aiPlanProject'
  | 'aiPlanning'
  | 'coordEmpty'
  | 'coordConflicts'
  | 'coordAnalyze'
  | 'coordAnalyzing'
  | 'coordApply'
  | 'coordApplied'
  | 'collabHandoff'
  | 'collabStarting'
  | 'statusActive'
  | 'statusPaused'
  | 'statusDone'
  | 'taskTodo'
  | 'taskDoing'
  | 'taskBlocked'
  | 'taskDone'
  | 'rolePrimary'
  | 'roleBackup'
  | 'roleBurst'
  | 'roleIdle'

const sharedEn: Record<TimeMasterLocaleKey, string> = {
  tab: 'Time Master',
  title: 'Time Master',
  hint: 'Register token plans, orchestrate usage windows, plan projects, and coordinate tasks across sessions.',
  empty: 'No plans yet. Click New or AI assist to start.',
  loading: 'Loading…',
  error: 'Request failed',
  close: 'Close',
  newPlan: 'New',
  editPlan: 'Edit plan',
  save: 'Save',
  saving: 'Saving…',
  delete: 'Delete',
  cancel: 'Cancel',
  aiFill: 'AI assist',
  aiFilling: 'Suggesting…',
  aiHintPlaceholder: 'Optional hint, e.g. Claude Pro / project goal…',
  aiSourceAi: 'AI draft ready — review and save',
  aiSourceHeuristic: 'Template heuristic draft — review and save',
  fieldName: 'Name',
  fieldProvider: 'Provider / route',
  fieldCycle: 'Cycle',
  fieldStartsAt: 'Starts',
  fieldExpiresAt: 'Expires',
  fieldRemindDays: 'Remind days (comma-separated)',
  fieldNotes: 'Notes',
  cycleMonthly: 'Monthly',
  cycleYearly: 'Yearly',
  cycleCustom: 'Custom',
  urgencyExpired: 'Expired',
  urgencySoon: 'Expiring soon',
  urgencyOk: 'OK',
  refresh: 'Refresh',
  tabPlans: 'Plans',
  tabSchedules: 'Orchestrate',
  tabProjects: 'Projects',
  tabCoord: 'Coordinate',
  schedulesEmpty: 'No usage schedules yet. AI orchestrate from registered plans.',
  newSchedule: 'New schedule',
  editSchedule: 'Edit schedule',
  fieldScheduleName: 'Schedule name',
  fieldHorizonDays: 'Horizon (days)',
  fieldRationale: 'Rationale',
  fieldScheduleItems: 'Plan windows (JSON)',
  aiOrchestrate: 'AI orchestrate',
  aiOrchestrating: 'Orchestrating…',
  projectsEmpty: 'No projects yet. AI plan from a goal hint.',
  newProject: 'New project',
  editProject: 'Edit project',
  fieldProjectTitle: 'Title',
  fieldProjectGoal: 'Goal',
  fieldProjectStatus: 'Status',
  fieldTaskTitle: 'Task title',
  fieldTaskDueAt: 'Due date',
  fieldTaskStatus: 'Status',
  fieldTaskSession: 'Session ID',
  fieldTaskWorkflow: 'Workflow',
  fieldTasks: 'Tasks (JSON)',
  aiPlanProject: 'AI plan project',
  aiPlanning: 'Planning…',
  coordEmpty: 'No active conflicts detected.',
  coordConflicts: 'Conflicts',
  coordAnalyze: 'Analyze conflicts',
  coordAnalyzing: 'Analyzing…',
  coordApply: 'Apply suggestions',
  coordApplied: 'Suggestions applied',
  collabHandoff: 'Open Collab',
  collabStarting: 'Starting loop…',
  statusActive: 'Active',
  statusPaused: 'Paused',
  statusDone: 'Done',
  taskTodo: 'Todo',
  taskDoing: 'Doing',
  taskBlocked: 'Blocked',
  taskDone: 'Done',
  rolePrimary: 'Primary',
  roleBackup: 'Backup',
  roleBurst: 'Burst',
  roleIdle: 'Idle',
}

export const zh: Record<TimeMasterLocaleKey, string> = {
  tab: '时间大师',
  title: '时间大师',
  hint: '登记套餐、编排使用窗口、规划项目任务，并协调跨会话安排。到期前会发送桌面提醒。',
  empty: '还没有登记套餐。点击「新建」或「AI 辅助填充」开始。',
  loading: '加载中…',
  error: '操作失败',
  close: '关闭',
  newPlan: '新建',
  editPlan: '编辑套餐',
  save: '保存',
  saving: '保存中…',
  delete: '删除',
  cancel: '取消',
  aiFill: 'AI 辅助填充',
  aiFilling: '正在建议…',
  aiHintPlaceholder: '可选提示，例如 Claude Pro / 项目目标…',
  aiSourceAi: '已由 AI 建议，请确认后保存',
  aiSourceHeuristic: '已按模板启发式预填，请确认后保存',
  fieldName: '名称',
  fieldProvider: '提供方 / 路由',
  fieldCycle: '周期',
  fieldStartsAt: '开始日',
  fieldExpiresAt: '到期日',
  fieldRemindDays: '提醒天数（逗号分隔）',
  fieldNotes: '备注',
  cycleMonthly: '月付',
  cycleYearly: '年付',
  cycleCustom: '自定义',
  urgencyExpired: '已过期',
  urgencySoon: '即将到期',
  urgencyOk: '正常',
  refresh: '刷新',
  tabPlans: '套餐',
  tabSchedules: '编排',
  tabProjects: '项目',
  tabCoord: '协调',
  schedulesEmpty: '还没有使用编排。可基于已登记套餐 AI 编排。',
  newSchedule: '新建编排',
  editSchedule: '编辑编排',
  fieldScheduleName: '编排名称',
  fieldHorizonDays: '规划天数',
  fieldRationale: '说明',
  fieldScheduleItems: '套餐窗口（JSON）',
  aiOrchestrate: 'AI 编排',
  aiOrchestrating: '正在编排…',
  projectsEmpty: '还没有项目。输入目标后 AI 规划。',
  newProject: '新建项目',
  editProject: '编辑项目',
  fieldProjectTitle: '标题',
  fieldProjectGoal: '目标',
  fieldProjectStatus: '状态',
  fieldTaskTitle: '任务标题',
  fieldTaskDueAt: '截止日期',
  fieldTaskStatus: '状态',
  fieldTaskSession: '会话 ID',
  fieldTaskWorkflow: '工作流',
  fieldTasks: '任务（JSON）',
  aiPlanProject: 'AI 规划项目',
  aiPlanning: '正在规划…',
  coordEmpty: '未检测到活跃冲突。',
  coordConflicts: '冲突',
  coordAnalyze: '分析冲突',
  coordAnalyzing: '正在分析…',
  coordApply: '应用建议',
  coordApplied: '已应用建议',
  collabHandoff: '打开协作',
  collabStarting: '正在启动 Loop…',
  statusActive: '进行中',
  statusPaused: '暂停',
  statusDone: '已完成',
  taskTodo: '待办',
  taskDoing: '进行中',
  taskBlocked: '阻塞',
  taskDone: '完成',
  rolePrimary: '主力',
  roleBackup: '备用',
  roleBurst: '突发',
  roleIdle: '闲置',
}

export const en: Record<TimeMasterLocaleKey, string> = sharedEn

export const ja: Record<TimeMasterLocaleKey, string> = {
  ...sharedEn,
  tab: 'タイムマスター',
  title: 'タイムマスター',
  tabPlans: 'プラン',
  tabSchedules: '編成',
  tabProjects: 'プロジェクト',
  tabCoord: '調整',
  hint: 'トークンプランの登録、使用ウィンドウの編成、プロジェクト計画、セッション横断の調整。',
  empty: 'プランがありません。「新規」または AI アシストで開始。',
  newPlan: '新規',
  save: '保存',
  delete: '削除',
  cancel: 'キャンセル',
  refresh: '更新',
  collabHandoff: 'コラボを開く',
}

export const ko: Record<TimeMasterLocaleKey, string> = {
  ...sharedEn,
  tab: '타임 마스터',
  title: '타임 마스터',
  tabPlans: '플랜',
  tabSchedules: '편성',
  tabProjects: '프로젝트',
  tabCoord: '조율',
  hint: '토큰 플랜 등록, 사용 창 편성, 프로젝트 계획, 세션 간 조율.',
  empty: '등록된 플랜이 없습니다.「새로 만들기」또는 AI 보조로 시작하세요.',
  newPlan: '새로 만들기',
  save: '저장',
  delete: '삭제',
  cancel: '취소',
  refresh: '새로고침',
  collabHandoff: '협업 열기',
}
