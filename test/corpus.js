/**
 * Labelled corpus of real-shaped user messages.
 *
 * Labels are what a pinned policy should keep:
 *   constraint | decision | acceptance | chatter
 * It exists to make "is the classifier good enough" a number instead of an opinion.
 */
export const CORPUS = [
  // --- clear constraints ------------------------------------------------
  { text: '不要改 tests/ 目录', label: 'constraint' },
  { text: '别动生产环境的配置文件', label: 'constraint' },
  { text: '必须用 pnpm，不要用 npm', label: 'constraint' },
  { text: 'don\'t touch the migration files', label: 'constraint' },
  { text: 'you must keep the public API stable', label: 'constraint' },
  // --- postposed / implicit constraints (the hard cases) ----------------
  { text: 'tests 目录先别碰', label: 'constraint' },
  { text: '我不想让你改 tests 目录', label: 'constraint' },
  { text: '改之前先问我', label: 'constraint' },
  { text: '这个模块最好不要有新增依赖', label: 'constraint' },
  { text: '记得跑一下 lint', label: 'constraint' },
  // --- decisions ---------------------------------------------------------
  { text: '我们决定采用 decimal 方案', label: 'decision' },
  { text: '就按 B 方案来', label: 'decision' },
  { text: 'we\'ll go with postgres instead of sqlite', label: 'decision' },
  // --- acceptance --------------------------------------------------------
  { text: '验收标准是 npm test 必须全绿', label: 'acceptance' },
  { text: 'acceptance: the build must pass on CI', label: 'acceptance' },
  // --- chatter (must not be pinned) --------------------------------------
  { text: '好的，谢谢', label: 'chatter' },
  { text: '帮我看看这个项目的结构', label: 'chatter' },
  { text: '今天天气不错我们聊聊别的', label: 'chatter' },
  { text: '嗯嗯', label: 'chatter' },
  { text: 'can you take a look at this file', label: 'chatter' },
  { text: 'go on', label: 'chatter' },
]
