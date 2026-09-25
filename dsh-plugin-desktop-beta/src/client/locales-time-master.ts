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

export const zh: Record<TimeMasterLocaleKey, string> = {
  tab: '时间大师',
  title: '时间大师',
  hint: '手工登记各家 token / 订阅套餐的周期与到期日。可用 AI 根据本机 Models 与工作流上下文预填，到期前会发送桌面提醒。',
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
  aiHintPlaceholder: '可选提示，例如 Claude Pro / Codex…',
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
}

export const en: Record<TimeMasterLocaleKey, string> = {
  tab: 'Time Master',
  title: 'Time Master',
  hint: 'Manually register token/subscription plan cycles and expiry dates. AI can prefill from local Models and workflow context. Desktop reminders fire before expiry.',
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
  aiHintPlaceholder: 'Optional hint, e.g. Claude Pro / Codex…',
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
}
