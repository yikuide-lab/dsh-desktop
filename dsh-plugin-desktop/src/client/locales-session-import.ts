/** Locales for the harness session-import UI. */

export type SessionImportLocaleKey =
  | 'tab'
  | 'title'
  | 'searchPlaceholder'
  | 'searchContent'
  | 'sourceClaude'
  | 'sourceCodex'
  | 'sourceOpencode'
  | 'refresh'
  | 'importSelected'
  | 'importing'
  | 'empty'
  | 'loading'
  | 'error'
  | 'selectHint'
  | 'imported'
  | 'warnings'
  | 'close'

export const zh: Record<SessionImportLocaleKey, string> = {
  tab: '导入会话',
  title: '跨 Harness 会话导入',
  searchPlaceholder: '搜索标题、路径或预览…',
  searchContent: '同时搜索正文前缀',
  sourceClaude: 'Claude Code',
  sourceCodex: 'Codex',
  sourceOpencode: 'OpenCode',
  refresh: '刷新',
  importSelected: '导入所选',
  importing: '正在导入…',
  empty: '未找到可导入的会话。确认本机已安装对应工具并产生过会话。',
  loading: '正在扫描…',
  error: '扫描失败',
  selectHint: '勾选一条或多条会话后导入。导入后将出现在侧边栏并可继续对话。',
  imported: '已导入',
  warnings: '部分内容',
  close: '关闭',
}

export const en: Record<SessionImportLocaleKey, string> = {
  tab: 'Import sessions',
  title: 'Import harness sessions',
  searchPlaceholder: 'Search title, path, or preview…',
  searchContent: 'Also search transcript heads',
  sourceClaude: 'Claude Code',
  sourceCodex: 'Codex',
  sourceOpencode: 'OpenCode',
  refresh: 'Refresh',
  importSelected: 'Import selected',
  importing: 'Importing…',
  empty: 'No importable sessions found. Confirm the tools are installed and have local history.',
  loading: 'Scanning…',
  error: 'Scan failed',
  selectHint: 'Select one or more sessions to import. They appear in the sidebar and can continue chatting.',
  imported: 'Imported',
  warnings: 'Partial import',
  close: 'Close',
}
