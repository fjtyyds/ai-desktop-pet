const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(message) {
  console.error(`[check] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[check] OK: ${message}`);
}

console.log(`[check] Node ${process.version}`);

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  fail('Node 版本过低，需要 >= 20');
}
pass('Node 版本满足要求');

try {
  const electronPath = require('electron');
  console.log(`[check] Electron 可执行文件: ${electronPath}`);
} catch {
  fail('Electron 未安装，请先运行 npm install');
}

const requiredFiles = [
  'AGENTS.md',
  'PLAN.md',
  'ROADMAP.md',
  'docs/SPEC.md',
  'docs/DECISIONS.md',
  'docs/STATUS.md',
  'src/main/main.js',
  'src/main/preload.js',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'src/renderer/renderer.js'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`缺少文件: ${file}`);
  }
}
pass('关键文件齐全');

const contracts = require(path.join(root, 'src', 'shared', 'contracts.js'));
if (
  !Number.isInteger(contracts.DEFAULT_SHORT_TERM_WINDOW) ||
  contracts.DEFAULT_SHORT_TERM_WINDOW <= 0
) {
  fail('contracts.DEFAULT_SHORT_TERM_WINDOW 缺失或非法');
}
if (
  !Number.isInteger(contracts.MAX_MEMORIES_IN_CONTEXT) ||
  contracts.MAX_MEMORIES_IN_CONTEXT <= 0
) {
  fail('contracts.MAX_MEMORIES_IN_CONTEXT 缺失或非法');
}
pass('M2 契约常量齐全');

const rendererChatSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'chat.js'),
  'utf8'
);
if (!rendererChatSource.includes('history.get')) {
  fail('renderer/chat.js 缺少 petAPI.history.get 历史恢复集成');
}
pass('renderer 历史恢复集成存在');

if (
  !rendererChatSource.includes('settings.get') ||
  !rendererChatSource.includes('settings.set')
) {
  fail('renderer/chat.js 缺少 petAPI.settings.get/set 设置页集成');
}
pass('renderer 设置页 petAPI.settings 集成存在');

const rendererIndexSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'index.html'),
  'utf8'
);
if (
  !rendererIndexSource.includes('id="api-key"') ||
  !rendererIndexSource.includes('type="password"')
) {
  fail('renderer/index.html 缺少 API Key 密码输入框');
}
if (!rendererIndexSource.includes('id="model"')) {
  fail('renderer/index.html 缺少模型输入框');
}
if (!rendererIndexSource.includes('密钥仅保存在本机')) {
  fail('renderer/index.html 缺少“密钥仅保存在本机”说明');
}
pass('renderer 设置页 API Key/模型输入存在');

// T-24：窗口可缩放、小部件可折叠、移除底部平台/版本信息
// T-25：工具栏导出 + 最小化（契约 window:minimize 已冻结，ADR-026）
// T-29：全局快捷键移除（ADR-026）：源码不得再注册/暴露快捷键契约
// T-31：贴边吸附语义同步（方案 B：靠边吸附、不自动隐藏；ADR-026）
const preloadSource = fs.readFileSync(
  path.join(root, 'src', 'main', 'preload.js'),
  'utf8'
);
const mainSource = fs.readFileSync(
  path.join(root, 'src', 'main', 'main.js'),
  'utf8'
);
if (!mainSource.includes('resizable: true')) {
  fail('main.js 未启用窗口可缩放（resizable: true）');
}
const minWidthDef = mainSource.match(/const MIN_WINDOW_WIDTH\s*=\s*(\d+)/);
const minHeightDef = mainSource.match(/const MIN_WINDOW_HEIGHT\s*=\s*(\d+)/);
if (!minWidthDef || Number(minWidthDef[1]) < 280) {
  fail('main.js 缺少合理最小窗口宽度（建议 ≥280）');
}
if (!minHeightDef || Number(minHeightDef[1]) < 360) {
  fail('main.js 缺少合理最小窗口高度（建议 ≥360）');
}
if (
  !mainSource.includes('minWidth: MIN_WINDOW_WIDTH') ||
  !mainSource.includes('minHeight: MIN_WINDOW_HEIGHT')
) {
  fail('main.js 未将最小尺寸应用到 BrowserWindow');
}
pass('窗口可缩放且最小尺寸合理');

const rendererSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'renderer.js'),
  'utf8'
);
if (
  rendererSource.includes('platformVersion') ||
  rendererSource.includes('meta.textContent')
) {
  fail('renderer.js 仍写入底部平台/版本信息');
}
if (
  rendererIndexSource.includes('id="meta"') ||
  rendererIndexSource.includes('class="meta"')
) {
  fail('index.html 仍包含底部 meta footer');
}
for (const localeFile of ['zh-CN.json', 'en.json']) {
  const localeSource = fs.readFileSync(
    path.join(root, 'src', 'shared', 'locales', localeFile),
    'utf8'
  );
  if (localeSource.includes('platformVersion')) {
    fail(`locales/${localeFile} 仍包含 platformVersion 文案`);
  }
}
pass('底部平台/版本信息已移除');

if (!rendererIndexSource.includes('id="weather-toggle"')) {
  fail('index.html 缺少天气小部件折叠按钮（weather-toggle）');
}
if (
  !rendererChatSource.includes('weatherCollapsed') ||
  !rendererChatSource.includes('toggleWeatherCollapsed')
) {
  fail('renderer/chat.js 缺少天气小部件折叠状态与交互');
}
pass('天气小部件默认收起/可折叠');
if (!preloadSource.includes("windowMinimize: 'window:minimize'")) {
  fail('preload.js 缺少 window:minimize 通道');
}
if (!preloadSource.includes('minimize: () => ipcRenderer.invoke')) {
  fail('preload.js 缺少 petAPI.window.minimize 暴露');
}
if (!mainSource.includes("minimize: 'window:minimize'")) {
  fail('main.js 缺少 window:minimize 通道注册');
}
if (!mainSource.includes('win.minimize()')) {
  fail('main.js 缺少 BrowserWindow.minimize 调用');
}
if (!rendererChatSource.includes('minimizeBtn')) {
  fail('renderer/chat.js 缺少最小化按钮集成');
}
if (!rendererChatSource.includes('window.petAPI.window.minimize')) {
  fail('renderer/chat.js 缺少 petAPI.window.minimize 调用');
}
if (!rendererChatSource.includes('exportMenu')) {
  fail('renderer/chat.js 缺少导出菜单逻辑');
}
if (!rendererIndexSource.includes('id="minimize-btn"')) {
  fail('renderer/index.html 缺少最小化按钮');
}
if (!rendererIndexSource.includes('id="export-menu"')) {
  fail('renderer/index.html 缺少工具栏导出菜单');
}
if (!rendererIndexSource.includes('data-i18n-title="data.exportTitle"')) {
  fail('renderer/index.html 工具栏导出按钮缺少导出文案标题');
}
const exportMenuIndex = rendererIndexSource.indexOf('id="export-menu"');
const exportMdIndex = rendererIndexSource.indexOf('id="export-md"');
const exportJsonIndex = rendererIndexSource.indexOf('id="export-json"');
const settingsViewIndex = rendererIndexSource.indexOf('id="settings-view"');
if (
  exportMenuIndex < 0 ||
  exportMdIndex < 0 ||
  exportJsonIndex < 0 ||
  settingsViewIndex < 0 ||
  !(exportMenuIndex < exportMdIndex && exportMdIndex < exportJsonIndex && exportJsonIndex < settingsViewIndex)
) {
  fail('导出入口未完整位于工具栏（设置页仍可能存在导出区块）');
}
if (
  rendererIndexSource.indexOf('id="export-md"', settingsViewIndex) !== -1 ||
  rendererIndexSource.indexOf('id="export-json"', settingsViewIndex) !== -1
) {
  fail('设置页仍包含导出按钮');
}
if (rendererIndexSource.includes('data-i18n="data.exportTitle"')) {
  fail('设置页仍包含导出区块标题（应移入工具栏）');
}
const zhLocale = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'shared', 'locales', 'zh-CN.json'), 'utf8')
);
const enLocale = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'shared', 'locales', 'en.json'), 'utf8')
);
if (
  !zhLocale.window ||
  typeof zhLocale.window.minimize !== 'string' ||
  !zhLocale.window.minimize ||
  !enLocale.window ||
  typeof enLocale.window.minimize !== 'string' ||
  !enLocale.window.minimize
) {
  fail('locales 缺少 window.minimize 按钮文案');
}
pass('T-25 工具栏导出 + 最小化集成存在');

// T-26：天气自动刷新增强（15 分钟间隔、恢复显示即刷新、更新时间展示、失败重试）
if (!rendererChatSource.includes('WEATHER_AUTO_REFRESH_MS = 15 * 60 * 1000')) {
  fail('renderer/chat.js 未将天气自动刷新间隔改为 15 分钟');
}
if (
  !rendererChatSource.includes("document.addEventListener('visibilitychange'") ||
  !rendererChatSource.includes("window.addEventListener('focus'")
) {
  fail('renderer/chat.js 缺少窗口恢复显示时的天气刷新触发');
}
if (
  !rendererChatSource.includes('weatherRetryTimer') ||
  !rendererChatSource.includes('scheduleWeatherRetry')
) {
  fail('renderer/chat.js 缺少天气失败自动重试/退避逻辑');
}
if (!rendererChatSource.includes('weather-updated')) {
  fail('renderer/chat.js 缺少“上次更新”时间展示');
}
pass('T-26 天气自动刷新增强集成存在');

if (!rendererIndexSource.includes('id="weather-updated"')) {
  fail('renderer/index.html 缺少“上次更新”时间元素');
}
pass('T-26 天气更新时间元素存在');

const zhLocales = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'shared', 'locales', 'zh-CN.json'), 'utf8')
);
const enLocales = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'shared', 'locales', 'en.json'), 'utf8')
);
for (const key of ['updatedAt', 'refreshFailed', 'retryNotice']) {
  if (
    !zhLocales.weather ||
    typeof zhLocales.weather[key] !== 'string' ||
    !zhLocales.weather[key]
  ) {
    fail(`zh-CN.json 缺少 weather.${key} 文案`);
  }
  if (
    !enLocales.weather ||
    typeof enLocales.weather[key] !== 'string' ||
    !enLocales.weather[key]
  ) {
    fail(`en.json 缺少 weather.${key} 文案`);
  }
}
pass('T-26 天气文案键齐全（zh-CN/en）');

// T-28：人格模板卡片精简（名称 + 一句话，完整描述选中后展开）
if (
  !rendererChatSource.includes("className = 'template-desc'") ||
  !rendererChatSource.includes('desc.title =')
) {
  fail('renderer/chat.js 模板卡片缺少一句话简介（template-desc）');
}
if (!rendererChatSource.includes("className = 'template-details'")) {
  fail('renderer/chat.js 模板卡片缺少可展开的完整描述区（template-details）');
}
if (!rendererChatSource.includes("setAttribute('aria-expanded'")) {
  fail('renderer/chat.js 模板卡片缺少 aria-expanded 展开状态');
}
if (rendererChatSource.includes("className = 'template-traits'")) {
  fail('renderer/chat.js 模板卡片仍整段铺开 traits（应精简为名称+一句话）');
}
pass('renderer 人格模板卡片精简实现存在');

const rendererChatCssSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'chat.css'),
  'utf8'
);
if (!rendererChatCssSource.includes('.template-card .template-details')) {
  fail('chat.css 缺少模板详情折叠态样式');
}
if (
  !rendererChatCssSource.includes('.template-card.selected .template-details')
) {
  fail('chat.css 缺少模板详情选中展开样式');
}
pass('人格模板折叠/展开样式存在');

if (
  !rendererIndexSource.includes('id="persona-template-list"') ||
  !rendererIndexSource.includes('id="onboarding-template-list"')
) {
  fail('renderer/index.html 缺少设置页/引导模板卡片容器');
}
if (rendererIndexSource.includes('onboarding-template-preview')) {
  fail('renderer/index.html 仍保留引导旧预览面板（应统一使用卡片内展开）');
}
pass('设置页与引导共用同一套精简模板卡片');

if (
  !rendererChatSource.includes('template.persona.traits.slice()') ||
  !rendererChatSource.includes('typeof template.persona.tone') ||
  !rendererChatSource.includes('typeof template.persona.backstory')
) {
  fail('renderer/chat.js 应用模板时未保留完整 persona 内容');
}
pass('应用模板后 persona 内容保持不变');
if (/\bglobalShortcut\b/.test(mainSource)) {
  fail('main.js 仍引用 globalShortcut（T-29 应移除）');
}
if (
  /SHORTCUT_CANDIDATES|setShortcutEnabled|window:set-shortcut/.test(
    mainSource + preloadSource
  )
) {
  fail('main/preload 仍包含全局快捷键注册/契约（T-29 应移除）');
}
if (/setShortcutEnabled|shortcutEnabled/.test(rendererChatSource)) {
  fail('renderer/chat.js 仍包含全局快捷键开关逻辑（T-29 应移除）');
}
pass('T-29 全局快捷键源码已移除');

// T-30：系统状态小部件已移除（主进程/UI/设置/文案/存储全触点回归断言）
const forbiddenMain = [
  'readSystemStatus',
  'broadcastSystemStatus',
  'startSystemStatusWidgets',
  'stopSystemStatusWidgets',
  'STATUS_POLL_MS',
  'BATTERY_POLL_MS',
  'powerMonitor'
];
for (const token of forbiddenMain) {
  if (mainSource.includes(token)) {
    fail(`main.js 仍包含已移除的系统状态代码：${token}`);
  }
}
for (const token of [
  'createIdleMonitor',
  'consumePomodoroNotificationRequest',
  'startPomodoroNotificationPolling'
]) {
  if (!mainSource.includes(token)) {
    fail(`main.js 缺少保留能力：${token}`);
  }
}
pass('main.js 系统状态轮询已移除，idle/番茄钟保留');

const forbiddenIndex = [
  'widgets-panel',
  'system-status-widget',
  'widget-stats',
  'stat-cpu',
  'stat-mem',
  'stat-battery',
  'widgets-toggle',
  'widgets-enabled',
  'widgets.'
];
for (const token of forbiddenIndex) {
  if (rendererIndexSource.includes(token)) {
    fail(`index.html 仍包含系统状态小部件标记：${token}`);
  }
}
if (!rendererIndexSource.includes('pomodoro-widget')) {
  fail('index.html 缺少番茄钟小部件（不应被误删）');
}
pass('index.html 系统状态小部件与设置入口已移除，番茄钟保留');

const forbiddenRenderer = [
  'applySystemStatus',
  'toggleWidgets',
  'syncWidgetsVisibility',
  'lastSystemStatus',
  'widgetsEnabled',
  'widgetsToggle',
  'widgetsPanel'
];
for (const token of forbiddenRenderer) {
  if (rendererChatSource.includes(token)) {
    fail(`chat.js 仍包含系统状态逻辑：${token}`);
  }
}
if (!rendererChatSource.includes('subscribeIdle')) {
  fail('chat.js 缺少 idle 空闲互动订阅（不应被误删）');
}
pass('chat.js 系统状态逻辑已移除，idle 订阅保留');

const currentStore = require(path.join(root, 'src', 'storage', 'store.js'));
if (currentStore.DEFAULT_SETTINGS.widgetsEnabled !== undefined) {
  fail('DEFAULT_SETTINGS.widgetsEnabled 应已移除');
}
pass('store.js widgetsEnabled 字段已移除');

for (const localeFile of ['zh-CN', 'en']) {
  const locale = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
      'utf8'
    )
  );
  if (locale.widgets !== undefined) {
    fail(`${localeFile}.json 仍包含 widgets.* 文案`);
  }
  if (
    !locale.idle ||
    !Array.isArray(locale.idle.phrases) ||
    locale.idle.phrases.length === 0
  ) {
    fail(`${localeFile}.json 缺少 idle 主动话术（不应被误删）`);
  }
}
pass('语言包 widgets.* 文案已移除，idle 话术保留');

// T-33：TTS 专属语音包（按人格）——渲染层语音包表/设置页 UI/语言包同步断言
const ttsPacksMarker = 'const TTS_VOICE_PACKS';
if (!rendererChatSource.includes(ttsPacksMarker)) {
  fail('chat.js 缺少 TTS_VOICE_PACKS 语音包表');
}
const ttsPacksStart = rendererChatSource.indexOf(ttsPacksMarker);
const ttsPacksEnd = rendererChatSource.indexOf('};', ttsPacksStart);
const ttsPacksBlock = rendererChatSource.slice(ttsPacksStart, ttsPacksEnd);
const ttsPackIds = ['warm', 'sage', 'playful', 'gentle', 'cool', 'curious'];
for (const id of ttsPackIds) {
  if (!new RegExp(`\\b${id}\\s*:\\s*\\{`).test(ttsPacksBlock)) {
    fail(`TTS_VOICE_PACKS 缺少 ${id} 语音包`);
  }
}
if ((ttsPacksBlock.match(/pitch:/g) || []).length < ttsPackIds.length) {
  fail('TTS_VOICE_PACKS 语音包 pitch 参数缺失');
}
if ((ttsPacksBlock.match(/rate:/g) || []).length < ttsPackIds.length) {
  fail('TTS_VOICE_PACKS 语音包 rate 参数缺失');
}
for (const token of [
  'resolveTtsVoicePack',
  'utter.pitch',
  'utter.rate',
  'ttsVoicePackEnabled',
  'ttsVoicePackId'
]) {
  if (!rendererChatSource.includes(token)) {
    fail(`chat.js 缺少 T-33 语音包逻辑：${token}`);
  }
}
for (const id of ['tts-voice-pack-enabled', 'tts-voice-pack-id']) {
  if (!rendererIndexSource.includes(`id="${id}"`)) {
    fail(`index.html 缺少语音包设置控件：${id}`);
  }
}
for (const localeFile of ['zh-CN', 'en']) {
  const locale = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
      'utf8'
    )
  );
  for (const key of [
    'ttsVoicePackEnabled',
    'ttsVoicePackEnabledHint',
    'ttsVoicePack',
    'ttsVoicePackAuto',
    'ttsVoicePackHint'
  ]) {
    if (typeof locale.settings[key] !== 'string' || !locale.settings[key].trim()) {
      fail(`${localeFile}.json 缺少 settings.${key} 文案`);
    }
  }
}
pass('T-33 语音包渲染层/设置页/语言包同步断言通过');

if (
  !mainSource.includes('function dockWindow') ||
  !mainSource.includes('function findDockEdge')
) {
  fail('main.js 缺少贴边吸附实现（dockWindow/findDockEdge）');
}
if (
  mainSource.includes('function pollDock') ||
  mainSource.includes('DOCK_STRIP') ||
  mainSource.includes('computeHiddenBounds') ||
  mainSource.includes('slideWindowTo')
) {
  fail('main.js 仍包含贴边自动隐藏逻辑（方案 B 应移除）');
}
if (!rendererChatSource.includes('靠边吸附')) {
  fail('renderer/chat.js 未同步“靠边吸附”文案');
}
if (
  rendererChatSource.includes('贴边隐藏') ||
  rendererChatSource.includes('自动收起成细条')
) {
  fail('renderer/chat.js 仍包含“贴边隐藏/自动收起”旧文案');
}
pass('T-31 贴边吸附语义同步');

// T-08：store persona 默认值、读写与清洗（非法值丢弃/超长截断，不破坏 settings.json）
const { createStore, DEFAULT_SETTINGS } = require(path.join(
  root,
  'src',
  'storage',
  'store.js'
));
const defaultPersona = DEFAULT_SETTINGS.persona;
if (
  !defaultPersona ||
  typeof defaultPersona !== 'object' ||
  Array.isArray(defaultPersona) ||
  !Array.isArray(defaultPersona.traits) ||
  typeof defaultPersona.tone !== 'string' ||
  typeof defaultPersona.backstory !== 'string'
) {
  fail('DEFAULT_SETTINGS.persona 缺失或形状非法');
}
pass('DEFAULT_SETTINGS.persona 形状合法');

const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-check-'));
try {
  const store = createStore(checkDir);
  const written = store.writeSettings({
    petName: '测试宠',
    persona: {
      traits: ['友好', 123, '', '超长标签'.repeat(20), '冷静'],
      tone: 42,
      backstory: '背景'.repeat(400)
    }
  });
  if (
    !Array.isArray(written.persona.traits) ||
    written.persona.traits.includes(123) ||
    written.persona.traits.includes('')
  ) {
    fail('persona.traits 清洗失败（非字符串/空串未丢弃）');
  }
  if (written.persona.traits.some((item) => item.length > 20)) {
    fail('persona.traits 未按 20 字截断');
  }
  if (written.persona.tone !== defaultPersona.tone) {
    fail('persona.tone 非法值未丢弃（应保留默认值）');
  }
  if (written.persona.backstory.length !== 500) {
    fail(`persona.backstory 未按 500 字截断（实际 ${written.persona.backstory.length}）`);
  }
  const reread = store.readSettings();
  if (
    reread.persona.traits.length !== written.persona.traits.length ||
    reread.persona.tone !== written.persona.tone ||
    reread.persona.backstory !== written.persona.backstory
  ) {
    fail('persona 持久化后读取不一致');
  }

  const afterInvalid = store.writeSettings({ persona: 'bad' });
  if (!afterInvalid.persona || !Array.isArray(afterInvalid.persona.traits)) {
    fail('非法 persona 未被丢弃（settings.json 被破坏）');
  }
  if (afterInvalid.persona.traits.length !== written.persona.traits.length) {
    fail('非法 persona 覆盖了已有合法值');
  }

  const afterPartial = store.writeSettings({
    persona: { traits: 'bad', tone: ' 冷峻 ', backstory: '' }
  });
  if (afterPartial.persona.traits.length !== written.persona.traits.length) {
    fail('persona.traits 非数组未丢弃');
  }
  if (afterPartial.persona.tone !== '冷峻' || afterPartial.persona.backstory !== '') {
    fail('persona.tone/backstory 合法字符串未保存（空 backstory 应允许）');
  }

  const raw = JSON.parse(fs.readFileSync(path.join(checkDir, 'settings.json'), 'utf8'));
  if (!raw || typeof raw.persona !== 'object' || !Array.isArray(raw.persona.traits)) {
    fail('settings.json 写入内容损坏');
  }
  pass('store persona 读写与清洗通过');

  // T-09：apiKey/model 默认值、读写与清洗（非法值丢弃/超长截断，不破坏 settings.json）
  if (DEFAULT_SETTINGS.apiKey !== '') {
    fail('DEFAULT_SETTINGS.apiKey 应为空串');
  }
  if (DEFAULT_SETTINGS.model !== contracts.DEFAULT_MODEL) {
    fail('DEFAULT_SETTINGS.model 应为契约默认模型');
  }
  pass('DEFAULT_SETTINGS apiKey/model 默认值合法');

  const invalidPatch = store.writeSettings({ apiKey: 12345, model: '' });
  if (invalidPatch.apiKey !== '') {
    fail('apiKey 非字符串应丢弃（保留当前值）');
  }
  if (invalidPatch.model !== contracts.DEFAULT_MODEL) {
    fail('model 空串应保留默认模型');
  }

  const longApiKey = `sk-${'a'.repeat(300)}`;
  const longModel = `deepseek-${'m'.repeat(150)}`;
  const cleaned = store.writeSettings({ apiKey: longApiKey, model: longModel });
  if (cleaned.apiKey.length !== 256) {
    fail(`apiKey 未按 256 截断（实际 ${cleaned.apiKey.length}）`);
  }
  if (cleaned.model.length !== 100) {
    fail(`model 未按 100 截断（实际 ${cleaned.model.length}）`);
  }
  const rereadKeyModel = store.readSettings();
  if (rereadKeyModel.apiKey !== cleaned.apiKey || rereadKeyModel.model !== cleaned.model) {
    fail('apiKey/model 持久化后读取不一致');
  }
  const rawKeyModel = JSON.parse(
    fs.readFileSync(path.join(checkDir, 'settings.json'), 'utf8')
  );
  if (rawKeyModel.apiKey !== cleaned.apiKey || rawKeyModel.model !== cleaned.model) {
    fail('settings.json 中 apiKey/model 内容损坏');
  }
  pass('store apiKey/model 读写与清洗通过');

  // T-27：pomodoroNotifyAt 信号读写/清零语义 + 普通设置保存不回写陈旧信号
  const signalAt = 1234567890123;
  const withSignal = store.writeSettings({
    pomodoroNotifyAt: signalAt,
    pomodoroNotifyMinutes: 25
  });
  if (
    withSignal.pomodoroNotifyAt !== signalAt ||
    withSignal.pomodoroNotifyMinutes !== 25
  ) {
    fail('pomodoroNotifyAt 信号写入失败');
  }
  const normalSaveWithSignal = store.writeSettings({ petName: '信号保留测试' });
  if (normalSaveWithSignal.pomodoroNotifyAt !== signalAt) {
    fail('普通设置保存不应清除待消费信号');
  }
  const cleared = store.writeSettings({
    pomodoroNotifyAt: 0,
    pomodoroNotifyMinutes: 0
  });
  if (cleared.pomodoroNotifyAt !== 0 || cleared.pomodoroNotifyMinutes !== 0) {
    fail('pomodoroNotifyAt 信号清零失败');
  }
  const normalSaveAfterClear = store.writeSettings({ petName: '清零后保存测试' });
  if (
    normalSaveAfterClear.pomodoroNotifyAt !== 0 ||
    normalSaveAfterClear.pomodoroNotifyMinutes !== 0
  ) {
    fail('普通设置保存回写了已消费的陈旧信号');
  }
  const rereadSignal = store.readSettings();
  if (rereadSignal.pomodoroNotifyAt !== 0) {
    fail('pomodoroNotifyAt 信号清理后读取不一致');
  }
  pass('store pomodoro 信号读写与清理语义通过');

  // T-29：旧 shortcutEnabled 设置字段兼容忽略/清理（不报错、不再暴露）
  const legacySettingsPath = path.join(checkDir, 'settings.json');
  const legacyRaw = JSON.parse(
    fs.readFileSync(legacySettingsPath, 'utf8')
  );
  legacyRaw.shortcutEnabled = true;
  fs.writeFileSync(
    legacySettingsPath,
    JSON.stringify(legacyRaw, null, 2),
    'utf8'
  );
  const legacyRead = store.readSettings();
  if (Object.prototype.hasOwnProperty.call(legacyRead, 'shortcutEnabled')) {
    fail('旧 shortcutEnabled 字段未被兼容清理/忽略（T-29）');
  }
  pass('store 旧 shortcutEnabled 兼容忽略通过');

  // T-31：贴边吸附开关（方案 B）默认开启，且读写清洗正常
  if (DEFAULT_SETTINGS.dockEnabled !== true) {
    fail('DEFAULT_SETTINGS.dockEnabled 应为 true（靠边吸附默认开启）');
  }
  const dockOff = store.writeSettings({ dockEnabled: false });
  if (dockOff.dockEnabled !== false || store.readSettings().dockEnabled !== false) {
    fail('store dockEnabled 关闭后写入/读取不一致');
  }
  const dockOn = store.writeSettings({ dockEnabled: true });
  if (dockOn.dockEnabled !== true) {
    fail('store dockEnabled 重新开启失败');
  }
  pass('store dockEnabled（靠边吸附）读写与清洗通过');

  // T-33：TTS 语音包设置默认值、读写与清洗（仅允许协调者预确认的两个新字段）
  const ttsSettingKeys = Object.keys(DEFAULT_SETTINGS).filter((key) =>
    key.startsWith('tts')
  );
  if (
    ttsSettingKeys.length !== 2 ||
    !ttsSettingKeys.includes('ttsVoicePackEnabled') ||
    !ttsSettingKeys.includes('ttsVoicePackId')
  ) {
    fail(
      `DEFAULT_SETTINGS 新增 TTS 字段超出预确认范围：${ttsSettingKeys.join(',')}`
    );
  }
  if (DEFAULT_SETTINGS.ttsVoicePackEnabled !== true) {
    fail('DEFAULT_SETTINGS.ttsVoicePackEnabled 应为 true（默认开启专属语音包）');
  }
  if (DEFAULT_SETTINGS.ttsVoicePackId !== '') {
    fail('DEFAULT_SETTINGS.ttsVoicePackId 应为空串（自动跟随人格模板）');
  }
  const packExplicit = store.writeSettings({
    ttsVoicePackEnabled: false,
    ttsVoicePackId: 'sage'
  });
  if (
    packExplicit.ttsVoicePackEnabled !== false ||
    packExplicit.ttsVoicePackId !== 'sage'
  ) {
    fail('store ttsVoicePackEnabled/ttsVoicePackId 显式写入失败');
  }
  const packInvalid = store.writeSettings({
    ttsVoicePackEnabled: 'yes',
    ttsVoicePackId: 'x'.repeat(50)
  });
  if (packInvalid.ttsVoicePackEnabled !== false) {
    fail('ttsVoicePackEnabled 非布尔值应丢弃（保留当前值）');
  }
  if (packInvalid.ttsVoicePackId.length !== 40) {
    fail(`ttsVoicePackId 未按 40 截断（实际 ${packInvalid.ttsVoicePackId.length}）`);
  }
  const packAuto = store.writeSettings({
    ttsVoicePackEnabled: true,
    ttsVoicePackId: ''
  });
  if (packAuto.ttsVoicePackEnabled !== true || packAuto.ttsVoicePackId !== '') {
    fail('ttsVoicePackId 空值（自动跟随人格）写入失败');
  }
  if (store.readSettings().ttsVoicePackId !== '') {
    fail('ttsVoicePackId 持久化后读取不一致');
  }
  pass('store TTS 语音包设置读写与清洗通过');
} finally {
  fs.rmSync(checkDir, { recursive: true, force: true });
}

(async () => {
  try {
    const { createChatService } = require(path.join(root, 'src', 'llm', 'chat.js'));
    const { DEFAULT_SHORT_TERM_WINDOW, MAX_MEMORIES_IN_CONTEXT } = contracts;

    // 1) T-05/T-06 模块缺失时的降级收发 + 短期窗口组装
    let appended = [];
    const oldMessages = Array.from({ length: 30 }, (_value, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `旧消息 ${index + 1}`
    }));
    const fakeStore = {
      readMessages: () => oldMessages,
      appendMessages: (items) => {
        appended.push(...items);
        return appended;
      },
      readSettings: () => ({
        petName: '测试宠',
        persona: { traits: ['友好', '话痨'], tone: '温柔', backstory: '测试背景' }
      })
    };

    let captured = [];
    const spyProvider = {
      chat: async ({ messages }) => {
        captured = messages;
        return { reply: '（测试）收到。' };
      }
    };

    const svc = createChatService({ provider: spyProvider, store: fakeStore, memoryStore: null });
    const result = await svc.send('你好');
    if (!result.ok) {
      fail(`降级收发失败: ${result.error}`);
    }
    const expectedWindow = 1 + Math.min(DEFAULT_SHORT_TERM_WINDOW, oldMessages.length) + 1;
    if (captured.length !== expectedWindow) {
      fail(`短期窗口组装不正确（消息数 ${captured.length}，期望 ${expectedWindow}）`);
    }
    if (captured[0].role !== 'system' || !String(captured[0].content).includes('测试宠')) {
      fail('system 提示未包含默认人格');
    }
    if (appended.length !== 2) {
      fail('发送成功后未持久化用户/助手两条消息');
    }
    pass('chat 服务降级收发与短期窗口通过');

    // 2) 长期记忆注入与异步抽取（注入 fake memoryStore，等价 T-05 合入后）
    const added = [];
    const memoryCaptured = [];
    const memoryStore = {
      getMemories: ({ keyword }) =>
        keyword === '咖啡'
          ? [
              {
                id: 'm1',
                content: '用户喜欢咖啡',
                sessionId: 'default',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 2
              }
            ]
          : [],
      listMemories: () => [],
      touchMemory: () => null,
      appendMessages: () => [],
      addMemory: (item) => {
        added.push(item);
        return { ...item, id: 'new' };
      }
    };

    let callIndex = 0;
    const memoryProvider = {
      chat: async ({ messages }) => {
        callIndex += 1;
        if (messages[0].content.includes('记忆抽取')) {
          return { reply: '```json\n["用户喜欢咖啡"]\n```' };
        }
        memoryCaptured.push(messages);
        return { reply: '好的，记住了。' };
      }
    };
    const svcMemory = createChatService({
      provider: memoryProvider,
      store: {
        ...fakeStore,
        readSettings: () => ({ ...fakeStore.readSettings(), apiKey: 'test-key' })
      },
      memoryStore
    });
    const memoryResult = await svcMemory.send('咖啡');
    if (!memoryResult.ok) {
      fail(`记忆路径发送失败: ${memoryResult.error}`);
    }
    if (callIndex < 1 || !String(memoryCaptured[0][0].content).includes('用户喜欢咖啡')) {
      fail('长期记忆未注入 system 提示');
    }
    if (memoryCaptured[0].length > 1 + DEFAULT_SHORT_TERM_WINDOW + 1) {
      fail('长期记忆注入超出短期窗口约束');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (added.length !== 1 || added[0].content !== '用户喜欢咖啡') {
      fail('异步记忆抽取未保存预期事实');
    }
    pass('chat 服务长期记忆注入与异步抽取通过');
  } catch (error) {
    fail(`chat 服务功能检查异常: ${error && error.message ? error.message : error}`);
  }
  console.log('[check] 全部通过');
})();
