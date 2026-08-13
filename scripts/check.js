const fs = require('fs');
const http = require('http');
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
  'src/main/pet-overlay.js',
  'src/main/telemetry.js',
  'src/main/preload.js',
  'src/renderer/index.html',
  'src/renderer/overlay.html',
  'src/renderer/overlay.css',
  'src/renderer/overlay.js',
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
if (!mainSource.includes('createIdleMonitor')) {
  fail('main.js 缺少 idle 空闲互动能力（不应被误删）');
}
for (const token of [
  'POMODORO_POLL_MS',
  'DEFAULT_POMODORO_MINUTES',
  'pomodoroTimer',
  'showPomodoroNotification',
  'consumePomodoroNotificationRequest',
  'startPomodoroNotificationPolling',
  'stopPomodoroNotificationPolling'
]) {
  if (mainSource.includes(token)) {
    fail(`main.js 仍包含已移除的番茄钟代码：${token}`);
  }
}
pass('main.js 系统状态轮询与番茄钟通知轮询已移除，idle 保留');

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
for (const token of [
  'pomodoro-widget',
  'pomodoro-enabled',
  'pomodoro-minutes',
  'pomodoro-time',
  'pomodoro-start'
]) {
  if (rendererIndexSource.includes(token)) {
    fail(`index.html 仍包含番茄钟标记：${token}`);
  }
}
for (const token of ['focus-widget', 'license-feature-focus']) {
  if (rendererIndexSource.includes(token)) {
    fail(`index.html 仍包含已移除的专注统计标记：${token}`);
  }
}
pass('index.html 系统状态小部件/番茄钟/专注统计（面板与设置项）已移除');

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

// T-34（ADR-029）：Edge 在线神经语音——模块/IPC/preload/渲染层映射/CSP/回退断言
const ttsEdgePath = path.join(root, 'src', 'main', 'tts-edge.js');
if (!fs.existsSync(ttsEdgePath)) {
  fail('缺少 src/main/tts-edge.js（T-34 在线神经语音客户端）');
}
const ttsEdgeSource = fs.readFileSync(ttsEdgePath, 'utf8');
for (const token of [
  'speech.platform.bing.com',
  'TrustedClientToken',
  'Sec-MS-GEC',
  'speech.config',
  'Path:ssml',
  'Path:audio',
  'Path:turn.end',
  'OUTPUT_FORMAT',
  'handshakeTimeout',
  'CACHE_MAX'
]) {
  if (!ttsEdgeSource.includes(token)) {
    fail(`tts-edge.js 缺少 ${token}`);
  }
}
const EXPECTED_TTS_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';
if (
  !ttsEdgeSource.includes(`const OUTPUT_FORMAT = '${EXPECTED_TTS_FORMAT}'`)
) {
  fail(`tts-edge.js 缺少 96kbps 输出格式常量（${EXPECTED_TTS_FORMAT}）`);
}
if (!ttsEdgeSource.includes('"outputFormat":"${OUTPUT_FORMAT}"')) {
  fail('tts-edge.js 的 speech.config 未使用 OUTPUT_FORMAT 常量');
}
if (ttsEdgeSource.includes('audio-24khz-48kbitrate-mono-mp3')) {
  fail('tts-edge.js 仍包含旧 48kbps 输出格式');
}
const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
if (!ipcSource.includes("ttsSpeak: 'tts:speak'")) {
  fail('ipc.js 缺少 ttsSpeak 通道');
}
if (!ipcSource.includes('ipcMain.handle(CHANNELS.ttsSpeak')) {
  fail('ipc.js 未注册 tts:speak 处理器');
}
if (!ipcSource.includes("require('./tts-edge')")) {
  fail('ipc.js 未引入 tts-edge');
}
if (!preloadSource.includes("ttsSpeak: 'tts:speak'")) {
  fail('preload.js 缺少 ttsSpeak 通道');
}
if (!preloadSource.includes('tts: {')) {
  fail('preload.js 缺少 petAPI.tts 命名空间');
}
if (!preloadSource.includes('speak:')) {
  fail('preload.js 缺少 tts.speak');
}
for (const token of [
  'petAPI.tts.speak',
  'HTMLAudioElement',
  'new Audio(',
  'currentAudio',
  'speakWithSystem',
  'speakWithEdge',
  'speechSynthesis'
]) {
  if (!rendererChatSource.includes(token)) {
    fail(`chat.js 缺少 T-34 逻辑：${token}`);
  }
}
const edgeVoiceMap = {
  warm: ['zh-CN-XiaoxiaoNeural', '-3%', '+1Hz'],
  sage: ['zh-CN-YunyangNeural', '-5%', '-1Hz'],
  playful: ['zh-CN-YunxiNeural', '+6%', '+3Hz'],
  gentle: ['zh-CN-XiaoyiNeural', '-6%', '+0Hz'],
  cool: ['zh-CN-YunjianNeural', '-2%', '-2Hz'],
  curious: ['zh-CN-YunxiaNeural', '+2%', '+2Hz']
};
for (const [packId, expected] of Object.entries(edgeVoiceMap)) {
  const packStart = ttsPacksBlock.indexOf(`${packId}: {`);
  if (packStart < 0) {
    fail(`TTS_VOICE_PACKS 缺少 ${packId} 语音包（T-34）`);
  }
  let depth = 0;
  let packEnd = -1;
  for (let i = packStart; i < ttsPacksBlock.length; i += 1) {
    if (ttsPacksBlock[i] === '{') {
      depth += 1;
    } else if (ttsPacksBlock[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        packEnd = i + 1;
        break;
      }
    }
  }
  if (packEnd < 0) {
    fail(`TTS_VOICE_PACKS ${packId} 语音包对象未闭合`);
  }
  const packBlock = ttsPacksBlock.slice(packStart, packEnd);
  const voiceMatch = packBlock.match(/edgeVoice:\s*'([^']+)'/);
  const rateMatch = packBlock.match(/edgeRate:\s*'([^']+)'/);
  const pitchMatch = packBlock.match(/edgePitch:\s*'([^']+)'/);
  if (!voiceMatch || voiceMatch[1] !== expected[0]) {
    fail(`${packId} edgeVoice 应为 ${expected[0]}`);
  }
  if (!rateMatch || rateMatch[1] !== expected[1]) {
    fail(`${packId} edgeRate 应为 ${expected[1]}`);
  }
  if (!pitchMatch || pitchMatch[1] !== expected[2]) {
    fail(`${packId} edgePitch 应为 ${expected[2]}`);
  }
}
if (!rendererIndexSource.includes("media-src 'self' data:")) {
  fail('index.html CSP 缺少 media-src data:（在线 MP3 data URL 播放）');
}
for (const localeFile of ['zh-CN', 'en']) {
  const locale = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
      'utf8'
    )
  );
  const hint = locale.settings.ttsVoicePackEnabledHint || '';
  if (
    localeFile === 'zh-CN' &&
    (!hint.includes('神经') || !hint.includes('回退'))
  ) {
    fail('zh-CN.json ttsVoicePackEnabledHint 未说明在线神经语音与回退');
  }
  if (
    localeFile === 'en' &&
    (!hint.toLowerCase().includes('neural') ||
      !hint.toLowerCase().includes('fall'))
  ) {
    fail('en.json ttsVoicePackEnabledHint 未说明 online neural voice 与回退');
  }
}
pass('T-34 Edge 神经语音模块/IPC/preload/映射/CSP/回退断言通过');

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

// T-35：Windows 上 moved 事件不触发 → move 防抖判定拖放结束；macOS moved 兼容保留
const dockDebounceMatch = mainSource.match(
  /const DOCK_MOVE_DEBOUNCE_MS\s*=\s*(\d+)/
);
if (
  !dockDebounceMatch ||
  Number(dockDebounceMatch[1]) < 150 ||
  Number(dockDebounceMatch[1]) > 250
) {
  fail('main.js 缺少合理的 move 防抖间隔（DOCK_MOVE_DEBOUNCE_MS ≈200ms）');
}
if (!mainSource.includes('function handleDragEnd')) {
  fail('main.js 缺少共享拖放结束处理函数（handleDragEnd）');
}
if (!mainSource.includes('function scheduleDockMoveEnd')) {
  fail('main.js 缺少 move 防抖调度函数（scheduleDockMoveEnd）');
}
if (!mainSource.includes('dockMoveDebounceTimer')) {
  fail('main.js 缺少 move 防抖定时器状态（dockMoveDebounceTimer）');
}
if (
  !mainSource.includes("win.on('move', handleWindowMove)") ||
  !mainSource.includes("win.on('moved', handleWindowMoved)")
) {
  fail('main.js 未同时保留 move 防抖入口与 moved 兼容监听');
}
if (!/function handleWindowMoved[\s\S]{0,120}handleDragEnd\(\)/.test(mainSource)) {
  fail('main.js moved 兼容入口未复用共享拖放结束处理（handleDragEnd）');
}
if (
  !mainSource.includes('Math.abs(bounds.x - aligned.x) >= 1') ||
  !mainSource.includes('dockFullBounds = full')
) {
  fail('main.js 缺少吸附对齐 ≥1px 判定或 dockFullBounds 状态（防回环）');
}
if (
  !mainSource.includes('function undockWindow') ||
  !mainSource.includes('function syncDockFullBounds') ||
  !mainSource.includes('function handleWindowResize')
) {
  fail('main.js 缺少取消吸附/沿边同步/缩放贴齐语义（T-35）');
}
pass('T-35 贴边吸附拖放结束防抖与 moved 兼容保留');

// T-53：源码出现 stopDockPolling( 调用时，必须存在其函数声明/定义（T-25 遗留回归防复发）
const srcJsFiles = [];
function collectSrcJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isFile()) continue;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSrcJs(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
}
collectSrcJs(path.join(root, 'src'), srcJsFiles);
let stopDockPollingCallCount = 0;
for (const file of srcJsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const callCount =
    (source.match(/stopDockPolling\s*\(/g) || []).length -
    (source.match(/function\s+stopDockPolling\s*\(/g) || []).length;
  if (callCount === 0) continue;
  stopDockPollingCallCount += callCount;
  const hasDefinition =
    /function\s+stopDockPolling\s*\(/.test(source) ||
    /(?:const|let|var)\s+stopDockPolling\s*=/.test(source);
  if (!hasDefinition) {
    fail(`stopDockPolling() 调用缺少函数声明/定义（T-53）: ${path.relative(root, file)}`);
  }
}
if (stopDockPollingCallCount > 0) {
  pass(`T-53 stopDockPolling 调用（${stopDockPollingCallCount} 处）均存在定义`);
} else {
  pass('T-53 无 stopDockPolling 调用残留');
}

// T-37：自动更新（ADR-031）——updater 模块、isPackaged 守卫、托盘接入、双语文案
const updaterSource = fs.readFileSync(
  path.join(root, 'src', 'main', 'updater.js'),
  'utf8'
);
if (
  !updaterSource.includes("require('electron-updater')") ||
  !updaterSource.includes('autoUpdater')
) {
  fail('updater.js 未封装 electron-updater autoUpdater');
}
for (const eventName of [
  "'update-available'",
  "'update-not-available'",
  "'download-progress'",
  "'update-downloaded'",
  "'error'"
]) {
  if (!updaterSource.includes(eventName)) {
    fail(`updater.js 缺少更新事件监听：${eventName}`);
  }
}
if (
  !updaterSource.includes('function checkForUpdates') ||
  !updaterSource.includes('function handleBeforeQuit') ||
  !updaterSource.includes('quitAndInstall')
) {
  fail('updater.js 缺少 checkForUpdates/handleBeforeQuit/quitAndInstall');
}
if (!updaterSource.includes('if (!app.isPackaged)')) {
  fail('updater.js 缺少 isPackaged 守卫（开发模式不得检查）');
}
pass('updater.js 模块与事件链路齐全');

if (
  !mainSource.includes("require('./updater')") ||
  !mainSource.includes('initUpdater')
) {
  fail('main.js 未初始化 updater 模块');
}
if (
  !mainSource.includes('if (app.isPackaged)') ||
  !mainSource.includes('AUTO_UPDATE_CHECK_DELAY_MS') ||
  !mainSource.includes('setTimeout')
) {
  fail('main.js 缺少 isPackaged 初始化守卫或延迟自动检查');
}
if (!mainSource.includes('checkForUpdates({ manual: true })')) {
  fail('main.js 未将手动检查接入托盘回调');
}
if (
  !mainSource.includes("app.on('before-quit'") ||
  !mainSource.includes('handleBeforeQuit()')
) {
  fail('main.js 退出前未处理 quitAndInstall');
}
pass('main.js isPackaged 守卫与退出处理通过');

const traySource = fs.readFileSync(path.join(root, 'src', 'main', 'tray.js'), 'utf8');
if (
  !traySource.includes('checkForUpdates') ||
  !traySource.includes("t('updater.checkForUpdates')")
) {
  fail('tray.js 未接入“检查更新”菜单项');
}
pass('tray.js 检查更新菜单接入通过');

const updaterLocaleKeys = [
  'checkForUpdates',
  'checking',
  'upToDate',
  'upToDateTitle',
  'updateAvailableTitle',
  'updateAvailableBody',
  'download',
  'cancel',
  'downloading',
  'updateReadyTitle',
  'updateReadyBody',
  'restartNow',
  'restartLater',
  'errorTitle',
  'error',
  'storeUpdateTitle',
  'storeUpdateBody',
  'ok'
];
for (const localeFile of ['zh-CN', 'en']) {
  const locale = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
      'utf8'
    )
  );
  for (const key of updaterLocaleKeys) {
    if (
      !locale.updater ||
      typeof locale.updater[key] !== 'string' ||
      !locale.updater[key].trim()
    ) {
      fail(`${localeFile}.json 缺少 updater.${key} 文案`);
    }
  }
}
pass('T-37 自动更新双语文案齐全（zh-CN/en）');

// T-38：发布产物命名 ASCII 化——artifactName 纯 ASCII、productName 保持中文、
// dist 产物与更新清单（latest.yml）引用静态比对（dist/ 不入库，存在才比对）
const builderConfigSource = fs.readFileSync(
  path.join(root, 'electron-builder.yml'),
  'utf8'
);
const artifactNameMatch = builderConfigSource.match(
  /^\s*artifactName:\s*([^\r\n#]+)/m
);
if (!artifactNameMatch) {
  fail('electron-builder.yml 缺少 artifactName 配置');
}
const artifactName = artifactNameMatch[1].trim();
const EXPECTED_ARTIFACT_NAME = 'ai-desktop-pet-${version}-Setup.${ext}';
if (artifactName !== EXPECTED_ARTIFACT_NAME) {
  fail(
    `artifactName 必须为约定的 ASCII 命名 ${EXPECTED_ARTIFACT_NAME}（当前: ${artifactName}）`
  );
}
if (!/^[\x21-\x7E]+$/.test(artifactName)) {
  fail(`artifactName 必须为纯 ASCII（当前: ${artifactName}）`);
}
if (!artifactName.includes('${version}') || !artifactName.includes('${ext}')) {
  fail('artifactName 必须包含 ${version} 与 ${ext} 占位符');
}
const productNameMatch = builderConfigSource.match(
  /^\s*productName:\s*([^\r\n#]+)/m
);
if (!productNameMatch || productNameMatch[1].trim() !== 'AI桌宠') {
  fail('productName 必须保持 AI桌宠（安装/快捷方式显示名不变）');
}
pass('T-38 artifactName 纯 ASCII 且 productName 保持 AI桌宠');

const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  const distTopFiles = fs.readdirSync(distDir);
  const topLevelExes = distTopFiles.filter((file) =>
    file.toLowerCase().endsWith('.exe')
  );
  for (const file of topLevelExes) {
    if (!/^[\x21-\x7E]+$/.test(file)) {
      fail(`dist 产物文件名必须为纯 ASCII（当前: ${file}）`);
    }
  }
  const latestYmlPath = path.join(distDir, 'latest.yml');
  if (fs.existsSync(latestYmlPath)) {
    const latestYmlSource = fs.readFileSync(latestYmlPath, 'utf8');
    const refs = [];
    for (const line of latestYmlSource.split(/\r?\n/)) {
      // electron-builder 27 alpha 起 latest.yml 以 "- url: xxx" 列表项输出（26.x 为顶层 url/path）
      const refMatch = line.match(/^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/);
      if (refMatch) {
        const value = refMatch[1].replace(/^["']|["']$/g, '');
        if (value) {
          refs.push(value);
        }
      }
    }
    if (refs.length === 0) {
      fail('dist/latest.yml 未包含 url/path 引用，无法与产物比对');
    }
    for (const ref of refs) {
      const baseName = path.basename(ref);
      if (!fs.existsSync(path.join(distDir, baseName))) {
        fail(`dist/latest.yml 引用文件不存在于 dist: ${ref}`);
      }
    }
    for (const file of topLevelExes) {
      if (!refs.some((ref) => path.basename(ref) === file)) {
        fail(`dist 产物未出现在 latest.yml 引用中: ${file}`);
      }
    }
    pass(`T-38 dist/latest.yml 引用与实际产物一致（共 ${refs.length} 个引用）`);
  } else if (topLevelExes.length > 0) {
    pass('T-38 dist 产物名已确认 ASCII（无 latest.yml，清单比对跳过）');
  }
} else {
  pass('T-38 dist 不存在，产物静态比对跳过（打包后运行 check 将比对）');
}

// T-39：最终打包产物——win-unpacked 更新清单存在且指向 GitHub Releases（ADR-031）
if (fs.existsSync(distDir)) {
  const appUpdateYmlPath = path.join(
    distDir,
    'win-unpacked',
    'resources',
    'app-update.yml'
  );
  if (!fs.existsSync(appUpdateYmlPath)) {
    fail('dist/win-unpacked/resources/app-update.yml 不存在（T-39）');
  }
  const appUpdateYmlSource = fs.readFileSync(appUpdateYmlPath, 'utf8');
  const appUpdateRefs = {};
  for (const line of appUpdateYmlSource.split(/\r?\n/)) {
    const refMatch = line.match(/^\s*(provider|owner|repo):\s*(.+?)\s*$/);
    if (refMatch) {
      appUpdateRefs[refMatch[1]] = refMatch[2].trim();
    }
  }
  const expectedAppUpdate = { provider: 'github', owner: 'fjtyyds', repo: 'ai-desktop-pet' };
  for (const [key, expected] of Object.entries(expectedAppUpdate)) {
    if (appUpdateRefs[key] !== expected) {
      fail(`app-update.yml ${key} 应为 ${expected}（当前: ${appUpdateRefs[key]}）`);
    }
  }
  pass('T-39 win-unpacked app-update.yml 存在且指向 github/fjtyyds/ai-desktop-pet');
} else {
  pass('T-39 dist 不存在，app-update.yml 断言跳过（打包后运行 check 将断言）');
}

// T-52：MSIX 打包实施与商店版更新守卫（ADR-040）
const msixSection = builderConfigSource.slice(builderConfigSource.indexOf('msix:'));
for (const token of [
  'target: msix',
  'identityName:',
  'publisher:',
  'publisherDisplayName:',
  'languages:',
  'setBuildNumber: true',
  'createMsixupload: true'
]) {
  if (!builderConfigSource.includes(token)) {
    fail(`electron-builder.yml 缺少 T-52 MSIX 配置项：${token}`);
  }
}
const msixArtifactNameMatch = msixSection.match(/^\s*artifactName:\s*([^\r\n#]+)/m);
if (
  !msixArtifactNameMatch ||
  msixArtifactNameMatch[1].trim() !== 'ai-desktop-pet-${version}-${arch}.${ext}'
) {
  fail('msix.artifactName 必须为约定的 ASCII 命名 ai-desktop-pet-${version}-${arch}.${ext}');
}
pass('electron-builder.yml MSIX target/身份/语言/四段版本/产物命名配置齐全');

if (!updaterSource.includes('if (process.windowsStore)')) {
  fail('updater.js 缺少 process.windowsStore 商店版守卫');
}
if (updaterSource.indexOf('process.windowsStore') > updaterSource.indexOf('autoUpdater.on(')) {
  fail('updater.js 的 process.windowsStore 守卫必须位于 autoUpdater 事件注册之前');
}
if (!updaterSource.includes('checkForUpdates: async () => null')) {
  fail('updater.js 商店版守卫应返回无操作 API（checkForUpdates 不发起请求）');
}
pass('updater.js process.windowsStore 守卫前置且商店版不初始化 electron-updater');

if (!traySource.includes('process.windowsStore')) {
  fail('tray.js 缺少商店版“检查更新”处理');
}
if (
  !traySource.includes("t('updater.storeUpdateTitle')") ||
  !traySource.includes("t('updater.storeUpdateBody')")
) {
  fail('tray.js 商店版提示缺少 storeUpdateTitle/storeUpdateBody 文案引用');
}
pass('tray.js 商店版检查更新提示走 Microsoft Store');

const appxLogoDir = path.join(root, 'assets', 'appx');
const expectedAppxLogos = {
  'StoreLogo.png': [50, 50],
  'Square150x150Logo.png': [150, 150],
  'Square44x44Logo.png': [44, 44],
  'Wide310x150Logo.png': [310, 150]
};
function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    fail(`${path.relative(root, filePath)} 不是合法 PNG`);
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
for (const [name, expected] of Object.entries(expectedAppxLogos)) {
  const logoPath = path.join(appxLogoDir, name);
  if (!fs.existsSync(logoPath)) {
    fail(`assets/appx 缺少必选 logo：${name}`);
  }
  const actual = readPngSize(logoPath);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    fail(
      `assets/appx/${name} 尺寸应为 ${expected[0]}x${expected[1]}（实际 ${actual[0]}x${actual[1]}）`
    );
  }
}
pass('assets/appx 四个必选 MSIX logo 存在且尺寸正确');

if (fs.existsSync(distDir)) {
  const msixArtifacts = fs
    .readdirSync(distDir)
    .filter((file) => /\.(msix|msixbundle|msixupload)$/i.test(file));
  if (msixArtifacts.length === 0) {
    fail('dist 缺少 MSIX 产物（.msix/.msixbundle/.msixupload）');
  }
  for (const file of msixArtifacts) {
    if (!/^[\x21-\x7E]+$/.test(file)) {
      fail(`MSIX 产物文件名必须为纯 ASCII（当前: ${file}）`);
    }
  }
  const latestYmlPath = path.join(distDir, 'latest.yml');
  if (fs.existsSync(latestYmlPath)) {
    const latestYmlSource = fs.readFileSync(latestYmlPath, 'utf8');
    for (const line of latestYmlSource.split(/\r?\n/)) {
      const refMatch = line.match(/^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/);
      if (refMatch && /\.(msix|msixbundle|msixupload)$/i.test(refMatch[1])) {
        fail(
          `latest.yml 不应引用 MSIX 产物（electron-updater 不支持 MSIX）: ${refMatch[1]}`
        );
      }
    }
  }
  pass(`T-52 dist MSIX 产物存在且命名 ASCII（${msixArtifacts.join(', ')}）`);
} else {
  pass('T-52 dist 不存在，MSIX 产物断言跳过（打包后运行 check 将断言）');
}

// T-42：匿名遥测——模块/端点默认空/IPC/preload/渲染层接线静态断言
const telemetrySource = fs.readFileSync(
  path.join(root, 'src', 'main', 'telemetry.js'),
  'utf8'
);
const telemetryModule = require(path.join(root, 'src', 'main', 'telemetry.js'));
if (telemetryModule.DEFAULT_ENDPOINT !== '') {
  fail('telemetry 上报端点默认应为空串（默认不发送）');
}
if (!telemetrySource.includes('AI_PET_TELEMETRY_ENDPOINT')) {
  fail('telemetry 上报端点应仅由环境变量 AI_PET_TELEMETRY_ENDPOINT 配置');
}
if (telemetrySource.includes('https://') || telemetrySource.includes('http://')) {
  fail('telemetry.js 不得内置任何真实上报端点');
}
for (const eventName of [
  'app_install',
  'app_start',
  'chat_sent',
  'chat_reply',
  'license_state_change',
  'weather_refresh'
]) {
  if (!telemetrySource.includes(`'${eventName}'`)) {
    fail(`telemetry 事件白名单缺少 ${eventName}`);
  }
}
if (telemetrySource.includes('pomodoro_complete')) {
  fail('telemetry.js 仍包含已移除的 pomodoro_complete 事件');
}
if (!telemetrySource.includes('crypto.randomUUID')) {
  fail('telemetry deviceId 应使用随机 UUID 生成');
}
if (!ipcSource.includes("telemetryGetStatus: 'telemetry:get-status'") ||
    !ipcSource.includes("telemetrySetEnabled: 'telemetry:set-enabled'") ||
    !ipcSource.includes("telemetryFlush: 'telemetry:flush'")) {
  fail('ipc.js 缺少 telemetry:get-status/set-enabled/flush 通道');
}
for (const hook of [
  "track('chat_sent'",
  "track('chat_reply'",
  "track('weather_refresh'"
]) {
  if (!ipcSource.includes(hook)) {
    fail(`ipc.js 缺少事件接线 ${hook}`);
  }
}
if (ipcSource.includes("track('pomodoro_complete'")) {
  fail('ipc.js 仍包含已移除的 pomodoro_complete 事件接线');
}
if (!preloadSource.includes('telemetry:get-status') ||
    !preloadSource.includes('telemetry:set-enabled') ||
    !preloadSource.includes('telemetry:flush') ||
    !preloadSource.includes('telemetry:')) {
  fail('preload.js 缺少 petAPI.telemetry API');
}
if (!rendererIndexSource.includes('id="telemetry-enabled"') ||
    !rendererIndexSource.includes('id="telemetry-clear"') ||
    !rendererIndexSource.includes('id="onboarding-telemetry-enabled"')) {
  fail('renderer/index.html 缺少遥测 opt-in 控件（设置页/引导）');
}
if (!rendererChatSource.includes('petAPI.telemetry') ||
    !rendererChatSource.includes('telemetryEnabled')) {
  fail('renderer/chat.js 缺少遥测开关/清除接线');
}
pass('T-42 遥测模块、IPC/preload、渲染层接线与端点默认空断言通过');
// T-43：皮肤与配件 MVP——模块/默认皮肤/IPC/preload/渲染层/locales/格式校验/往返断言
const skinStoreModule = require(path.join(root, 'src', 'main', 'skin-store.js'));
if (typeof skinStoreModule.createSkinStore !== 'function') {
  fail('skin-store.js 缺少 createSkinStore');
}
if (skinStoreModule.DEFAULT_SKIN_ID !== 'default') {
  fail('skin-store DEFAULT_SKIN_ID 应为 default');
}
if (skinStoreModule.SKIN_ID_MAX_LENGTH !== 64) {
  fail('skin-store SKIN_ID_MAX_LENGTH 应为 64');
}
if (skinStoreModule.MAX_PACK_BYTES !== 10 * 1024 * 1024) {
  fail('skin-store MAX_PACK_BYTES 应为 10 MB');
}
const skinStoreSource = fs.readFileSync(
  path.join(root, 'src', 'main', 'skin-store.js'),
  'utf8'
);
for (const token of ['child_process', 'eval(', 'new Function']) {
  if (skinStoreSource.includes(token)) {
    fail(`skin-store.js 不应包含 ${token}（禁止引入代码执行机制）`);
  }
}
pass('T-43 skin-store 模块与安全边界（无代码执行机制）');

const defaultSkinsDir = path.join(root, 'src', 'main', 'default-skins');
const builtinIds = fs.existsSync(defaultSkinsDir)
  ? fs
      .readdirSync(defaultSkinsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];
if (!builtinIds.includes('default') || builtinIds.length < 3) {
  fail(
    `内置默认皮肤应至少 3 套且包含 default（当前: ${builtinIds.join(',')}）`
  );
}
for (const id of builtinIds) {
  const dir = path.join(defaultSkinsDir, id);
  if (fs.existsSync(path.join(dir, 'pet.json'))) {
    // Codex 宠物包格式的内置皮肤（T-62）：pet.json + spritesheet.webp
    for (const rel of ['pet.json', 'spritesheet.webp']) {
      if (!fs.existsSync(path.join(dir, rel))) {
        fail(`内置宠物包 ${id} 缺少 ${rel}`);
      }
    }
    const pet = JSON.parse(
      fs.readFileSync(path.join(dir, 'pet.json'), 'utf8')
    );
    if (
      pet.id !== id ||
      typeof pet.displayName !== 'string' ||
      !pet.displayName.trim() ||
      pet.spritesheetPath !== 'spritesheet.webp'
    ) {
      fail(`内置宠物包 ${id} pet.json 结构非法`);
    }
    const petDims = skinStoreModule.parseWebpSize(
      fs.readFileSync(path.join(dir, 'spritesheet.webp'))
    );
    if (!petDims || petDims.width % 8 !== 0 || petDims.height % 9 !== 0) {
      fail(`内置宠物包 ${id} spritesheet.webp 非 8×9 图集`);
    }
    continue;
  }
  for (const rel of ['manifest.json', 'preview.png', 'assets/idle.png']) {
    if (!fs.existsSync(path.join(dir, rel))) {
      fail(`内置皮肤 ${id} 缺少 ${rel}`);
    }
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
  );
  if (
    manifest.id !== id ||
    !manifest.preview ||
    !manifest.roleAssets ||
    !manifest.roleAssets.idle
  ) {
    fail(`内置皮肤 ${id} manifest 结构非法`);
  }
}
pass(`T-43 内置默认皮肤齐全（${builtinIds.join(', ')}）`);

// T-62：动画宠物包——生成脚本 + 内置 pixel-pet（8 列×9 行、单元格 128px）
const makePetPackPath = path.join(root, 'scripts', 'make-pet-pack.js');
const makePetPackSource = fs.readFileSync(makePetPackPath, 'utf8');
for (const token of [
  "require('electron')",
  'BrowserWindow',
  'show: false',
  "toDataURL('image/webp'",
  'spritesheet.webp',
  'preview.webp',
  '1024',
  '1152'
]) {
  if (!makePetPackSource.includes(token)) {
    fail(`scripts/make-pet-pack.js 缺少生成脚本要素: ${token}`);
  }
}
pass('T-62 动画宠物包生成脚本存在且要素齐全');

const pixelPetDir = path.join(defaultSkinsDir, 'pixel-pet');
for (const rel of ['pet.json', 'spritesheet.webp', 'preview.webp']) {
  if (!fs.existsSync(path.join(pixelPetDir, rel))) {
    fail(`pixel-pet 内置包缺少 ${rel}`);
  }
}
const pixelPetManifest = JSON.parse(
  fs.readFileSync(path.join(pixelPetDir, 'pet.json'), 'utf8')
);
if (
  pixelPetManifest.id !== 'pixel-pet' ||
  typeof pixelPetManifest.displayName !== 'string' ||
  !pixelPetManifest.displayName.trim() ||
  pixelPetManifest.displayName.length > 80 ||
  typeof pixelPetManifest.description !== 'string' ||
  pixelPetManifest.description.length > 200 ||
  pixelPetManifest.spritesheetPath !== 'spritesheet.webp' ||
  pixelPetManifest.preview !== 'preview.webp'
) {
  fail('pixel-pet pet.json 结构或字段约束非法');
}
const pixelSheetDims = skinStoreModule.parseWebpSize(
  fs.readFileSync(path.join(pixelPetDir, 'spritesheet.webp'))
);
if (
  !pixelSheetDims ||
  pixelSheetDims.width !== 1024 ||
  pixelSheetDims.height !== 1152
) {
  fail(
    `pixel-pet spritesheet.webp 应为 1024×1152，实际 ${JSON.stringify(pixelSheetDims)}`
  );
}
const pixelPreviewDims = skinStoreModule.parseWebpSize(
  fs.readFileSync(path.join(pixelPetDir, 'preview.webp'))
);
if (
  !pixelPreviewDims ||
  pixelPreviewDims.width < 64 ||
  pixelPreviewDims.height < 64
) {
  fail('pixel-pet preview.webp 尺寸非法');
}
pass('T-62 pixel-pet 内置包文件与图集尺寸合法');

const t62CheckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-t62-check-'));
try {
  const t62Store = skinStoreModule.createSkinStore({
    baseDir: path.join(t62CheckDir, 'skins'),
    defaultsDir: defaultSkinsDir
  });
  const pixelEntry = t62Store.list().find((entry) => entry.id === 'pixel-pet');
  if (
    !pixelEntry ||
    pixelEntry.builtin !== true ||
    pixelEntry.kind !== 'atlas' ||
    pixelEntry.atlas.cols !== 8 ||
    pixelEntry.atlas.rows !== 9 ||
    pixelEntry.atlas.cellWidth !== 128 ||
    pixelEntry.atlas.cellHeight !== 128 ||
    !pixelEntry.spritesheetDataUrl.startsWith('data:image/webp;base64,') ||
    !pixelEntry.previewDataUrl.startsWith('data:image/webp;base64,')
  ) {
    fail(
      `skin-store 解析 pixel-pet 运行时索引异常: ${JSON.stringify({
        id: pixelEntry && pixelEntry.id,
        builtin: pixelEntry && pixelEntry.builtin,
        kind: pixelEntry && pixelEntry.kind,
        atlas: pixelEntry && pixelEntry.atlas
      })}`
    );
  }
  pass('T-62 skin-store 运行时解析内置动画包通过（atlas 8×9、单元格 128px）');
} finally {
  fs.rmSync(t62CheckDir, { recursive: true, force: true });
}

for (const channel of [
  "skinList: 'skin:list'",
  "skinImport: 'skin:import'",
  "skinExport: 'skin:export'",
  "skinApply: 'skin:apply'",
  "skinRemove: 'skin:remove'"
]) {
  if (!ipcSource.includes(channel) || !preloadSource.includes(channel)) {
    fail(`ipc.js/preload.js 缺少皮肤通道定义: ${channel}`);
  }
}
for (const channel of [
  'skinList',
  'skinImport',
  'skinExport',
  'skinApply',
  'skinRemove'
]) {
  if (!ipcSource.includes(`ipcMain.handle(CHANNELS.${channel}`)) {
    fail(`ipc.js 未注册 ${channel} 处理器`);
  }
}
if (!preloadSource.includes('skin: {')) {
  fail('preload.js 缺少 petAPI.skin 命名空间');
}
for (const token of ['petAPI.skin.list', 'petAPI.skin.apply', 'renderSkinList']) {
  if (!rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 缺少皮肤逻辑: ${token}`);
  }
}
for (const id of ['skin-page', 'skin-list', 'skin-import-btn', 'pet-avatar']) {
  if (!rendererIndexSource.includes(`id="${id}"`)) {
    fail(`renderer/index.html 缺少皮肤控件: ${id}`);
  }
}
pass('T-43 IPC/preload/渲染层皮肤通道与页面骨架齐全');

const skinLocaleKeys = [
  'manage',
  'title',
  'hint',
  'import',
  'export',
  'apply',
  'applied',
  'remove',
  'builtin',
  'installed'
];
for (const localeFile of ['zh-CN', 'en']) {
  const locale = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
      'utf8'
    )
  );
  for (const key of skinLocaleKeys) {
    if (!locale.skin || typeof locale.skin[key] !== 'string' || !locale.skin[key].trim()) {
      fail(`${localeFile}.json 缺少 skin.${key} 文案`);
    }
  }
}
pass('T-43 皮肤双语文案齐全（zh-CN/en）');

const skinCheckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-skin-check-'));
try {
  const skinStore = skinStoreModule.createSkinStore({
    baseDir: path.join(skinCheckDir, 'skins'),
    defaultsDir: defaultSkinsDir
  });
  const builtinList = skinStore.list();
  if (builtinList.length < 3) {
    fail(`皮肤索引内置套数不足（实际 ${builtinList.length}）`);
  }
  const defaultEntry = builtinList.find((entry) => entry.id === 'default');
  if (
    !defaultEntry ||
    defaultEntry.builtin !== true ||
    !defaultEntry.previewDataUrl.startsWith('data:image/png;base64,') ||
    !defaultEntry.roleAssets.idle ||
    !defaultEntry.roleAssets.idle.startsWith('data:image/png;base64,')
  ) {
    fail('内置 default 皮肤索引/预览/角色资源异常');
  }

  // 合法目录包导入
  const packDir = path.join(skinCheckDir, 'pack');
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(packDir, 'manifest.json'),
    JSON.stringify({
      id: 'roundtrip',
      name: 'Round Trip',
      author: 'check',
      version: '1.0.0',
      preview: 'preview.png',
      roleAssets: { idle: 'assets/idle.png' }
    })
  );
  fs.writeFileSync(path.join(packDir, 'preview.png'), Buffer.from('fake-preview'));
  fs.writeFileSync(path.join(packDir, 'assets', 'idle.png'), Buffer.from('fake-idle'));
  const imported = skinStore.importPack(packDir);
  if (imported.id !== 'roundtrip' || imported.name !== 'Round Trip') {
    fail('目录皮肤包导入失败');
  }

  // 导出 → 移除 → 重导入（zip 往返一致）
  const zipOut = path.join(skinCheckDir, 'roundtrip.zip');
  const exported = skinStore.exportPack('roundtrip', zipOut);
  if (!fs.existsSync(exported.path)) {
    fail('导出 zip 文件不存在');
  }
  skinStore.remove('roundtrip');
  if (skinStore.find('roundtrip')) {
    fail('移除导入皮肤失败');
  }
  const reimported = skinStore.importPack(zipOut);
  if (
    reimported.id !== 'roundtrip' ||
    reimported.name !== 'Round Trip' ||
    reimported.version !== '1.0.0'
  ) {
    fail('zip 导出→重导入清单不一致');
  }
  if (
    !fs.existsSync(
      path.join(skinCheckDir, 'skins', 'roundtrip', 'assets', 'idle.png')
    )
  ) {
    fail('zip 往返后角色资源缺失');
  }
  pass('T-43 导入→导出→重导入往返一致');

  // 非法包拒绝（缺清单/exe/脚本/超大小/路径跳转/内置不可移除），全程不崩溃
  function expectSkinReject(label, fn, keyword) {
    let thrown = null;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    if (!thrown) {
      fail(`T-43 ${label} 未被拒绝`);
    }
    if (keyword && !String(thrown.message).includes(keyword)) {
      fail(`T-43 ${label} 错误信息不符: ${thrown.message}`);
    }
  }
  const noManifest = path.join(skinCheckDir, 'no-manifest');
  fs.mkdirSync(noManifest);
  fs.writeFileSync(path.join(noManifest, 'preview.png'), Buffer.from('x'));
  expectSkinReject('缺清单包', () => skinStore.importPack(noManifest), 'manifest');

  function makeValidPack(name, id) {
    const dir = path.join(skinCheckDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id,
        name: 'Bad',
        author: 'check',
        version: '1.0.0',
        preview: 'preview.png',
        roleAssets: { idle: 'a.png' }
      })
    );
    fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.from('x'));
    fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from('x'));
    return dir;
  }
  const exePack = makeValidPack('exe-pack', 'exebad');
  fs.writeFileSync(path.join(exePack, 'evil.exe'), Buffer.from('MZ'));
  expectSkinReject('含可执行文件包', () => skinStore.importPack(exePack), '不允许的文件类型');

  const jsPack = makeValidPack('js-pack', 'jsbad');
  fs.writeFileSync(path.join(jsPack, 'evil.js'), Buffer.from('alert(1)'));
  expectSkinReject('含脚本文件包', () => skinStore.importPack(jsPack), '不允许的文件类型');

  const bigPack = makeValidPack('big-pack', 'bigbad');
  fs.writeFileSync(path.join(bigPack, 'preview.png'), Buffer.alloc(11 * 1024 * 1024));
  expectSkinReject('超大小包', () => skinStore.importPack(bigPack), '大小上限');

  expectSkinReject(
    '路径跳转',
    () =>
      skinStoreModule.validateSkinPackFiles([
        { name: '../evil.png', data: Buffer.from('x') }
      ]),
    '上级跳转'
  );
  expectSkinReject('内置皮肤移除', () => skinStore.remove('default'), '内置');
  pass('T-43 非法皮肤包（缺清单/exe/脚本/超大小/路径跳转）拒绝且不崩溃');
} finally {
  fs.rmSync(skinCheckDir, { recursive: true, force: true });
}

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

  // T-50：存量 pomodoro 设置字段兼容清理（不迁移、不暴露；ADR-038）
  const legacyPomodoroRaw = JSON.parse(
    fs.readFileSync(path.join(checkDir, 'settings.json'), 'utf8')
  );
  legacyPomodoroRaw.pomodoroEnabled = true;
  legacyPomodoroRaw.pomodoroMinutes = 25;
  legacyPomodoroRaw.pomodoroNotifyAt = 1234567890123;
  legacyPomodoroRaw.pomodoroNotifyMinutes = 25;
  fs.writeFileSync(
    path.join(checkDir, 'settings.json'),
    JSON.stringify(legacyPomodoroRaw, null, 2),
    'utf8'
  );
  const legacyPomodoroRead = store.readSettings();
  for (const key of [
    'pomodoroEnabled',
    'pomodoroMinutes',
    'pomodoroNotifyAt',
    'pomodoroNotifyMinutes'
  ]) {
    if (Object.prototype.hasOwnProperty.call(legacyPomodoroRead, key)) {
      fail(`store 仍暴露已移除的 pomodoro 字段：${key}`);
    }
  }
  pass('store pomodoro 字段已移除（存量字段兼容清理，不迁移/不暴露）');

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

  // T-43：skinId 白名单字段（默认 default、≤64 清洗、非法值丢弃、可回退默认）
  if (DEFAULT_SETTINGS.skinId !== 'default') {
    fail('DEFAULT_SETTINGS.skinId 应为 default（内置经典皮肤）');
  }
  const skinLong = store.writeSettings({ skinId: 'x'.repeat(100) });
  if (skinLong.skinId.length !== 64) {
    fail(`skinId 未按 64 截断（实际 ${skinLong.skinId.length}）`);
  }
  const skinInvalid = store.writeSettings({ skinId: 12345 });
  if (skinInvalid.skinId !== skinLong.skinId) {
    fail('skinId 非字符串应丢弃（保留当前值）');
  }
  if (store.readSettings().skinId !== skinLong.skinId) {
    fail('skinId 持久化后读取不一致');
  }
  const skinOk = store.writeSettings({ skinId: 'star' });
  if (skinOk.skinId !== 'star') {
    fail('skinId 显式写入失败');
  }
  const skinReset = store.writeSettings({ skinId: 'default' });
  if (skinReset.skinId !== 'default') {
    fail('skinId 回退 default 失败');
  }
  pass('store skinId 白名单读写与清洗通过');
} finally {
  fs.rmSync(checkDir, { recursive: true, force: true });
}

// T-40：许可证与付费墙（源码接线/存储白名单/门控/状态机/IPC/双语文案）
const licenseModulePath = path.join(root, 'src', 'main', 'license.js');
if (!fs.existsSync(licenseModulePath)) {
  fail('缺少 src/main/license.js（T-40 许可证状态机）');
}
const licenseModule = require(licenseModulePath);
if (
  !licenseModule.TIERS ||
  licenseModule.TIERS.join(',') !== 'free,yearly,lifetime'
) {
  fail('license.js TIERS 应为 free/yearly/lifetime 三态');
}
if (
  !licenseModule.CLOUD_QUOTA ||
  licenseModule.CLOUD_QUOTA.free.limit !== 10 ||
  licenseModule.CLOUD_QUOTA.free.period !== 'day'
) {
  fail('免费版云 AI 额度应为 10 次/日');
}
if (
  !licenseModule.CLOUD_QUOTA.yearly ||
  licenseModule.CLOUD_QUOTA.yearly.limit !== 200 ||
  licenseModule.CLOUD_QUOTA.yearly.period !== 'month'
) {
  fail('Pro 订阅云 AI 额度应为 200 次/月');
}
pass('license.js 三态档位与云额度常量合法');

// 存储白名单：仅允许 5 个 T-40 字段，默认值与清洗规则
const licenseSettingKeys = Object.keys(DEFAULT_SETTINGS).filter(
  (key) =>
    key.startsWith('license') ||
    key === 'deviceId' ||
    key === 'complianceAccepted'
);
const expectedLicenseKeys = [
  'licenseTier',
  'licenseKey',
  'licenseExpiresAt',
  'deviceId',
  'complianceAccepted'
];
if (licenseSettingKeys.join(',') !== expectedLicenseKeys.join(',')) {
  fail(
    `DEFAULT_SETTINGS 许可证字段超出白名单：${licenseSettingKeys.join(',')}`
  );
}
if (
  DEFAULT_SETTINGS.licenseTier !== 'free' ||
  DEFAULT_SETTINGS.licenseKey !== '' ||
  DEFAULT_SETTINGS.licenseExpiresAt !== 0 ||
  DEFAULT_SETTINGS.deviceId !== '' ||
  DEFAULT_SETTINGS.complianceAccepted !== false
) {
  fail('DEFAULT_SETTINGS 许可证字段默认值非法');
}
pass('store.js 许可证白名单与默认值合法');

// IPC/preload 通道接线
for (const token of [
  "licenseGet: 'license:get'",
  "licenseActivate: 'license:activate'",
  "licenseDeactivate: 'license:deactivate'",
  'ipcMain.handle(CHANNELS.licenseGet',
  'ipcMain.handle(CHANNELS.licenseActivate',
  'ipcMain.handle(CHANNELS.licenseDeactivate',
  'consumeCloudQuotaIfNeeded'
]) {
  if (!ipcSource.includes(token)) {
    fail(`ipc.js 缺少许可证接线：${token}`);
  }
}
for (const token of [
  "licenseGet: 'license:get'",
  "licenseActivate: 'license:activate'",
  "licenseDeactivate: 'license:deactivate'",
  'license: {',
  'activate: (code) => ipcRenderer.invoke(CHANNELS.licenseActivate',
  'deactivate: () => ipcRenderer.invoke(CHANNELS.licenseDeactivate'
]) {
  if (!preloadSource.includes(token)) {
    fail(`preload.js 缺少许可证暴露：${token}`);
  }
}
pass('license:get/activate/deactivate IPC 与 preload 接线存在');

// 渲染层门控/合规/额度接线
for (const token of [
  'license.get',
  'license-quota-exceeded',
  'complianceRefused',
  'syncComplianceVisibility',
  'applyLicenseUi'
]) {
  if (!rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 缺少许可证/合规接线：${token}`);
  }
}
for (const token of [
  'id="account-section"',
  'id="compliance-view"',
  'id="compliance-accept"',
  'id="compliance-decline"'
]) {
  if (!rendererIndexSource.includes(token)) {
    fail(`renderer/index.html 缺少许可证/合规元素：${token}`);
  }
}
for (const token of ['.license-row', '.license-pro-features', '.compliance-view']) {
  if (!rendererChatCssSource.includes(token)) {
    fail(`chat.css 缺少许可证/合规样式：${token}`);
  }
}
for (const token of [
  'id="license-activate"',
  'id="license-deactivate"',
  'id="license-code"',
  'id="license-message"',
  'id="payment-plans"',
  'id="payment-buy-yearly"',
  'id="payment-buy-lifetime"',
  'id="payment-message"'
]) {
  if (rendererIndexSource.includes(token)) {
    fail(`renderer/index.html 仍保留已移除的开发测试桩元素：${token}`);
  }
}
for (const token of [
  'activateLicense',
  'deactivateLicense',
  'sandboxPurchase',
  'showLicenseMessage',
  'showPaymentMessage'
]) {
  if (rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 仍保留已移除的开发测试桩流程：${token}`);
  }
}
for (const token of ['payment-plans', 'payment-plan', 'payment-buy-btn', 'payment-notice']) {
  if (rendererChatCssSource.includes(token)) {
    fail(`chat.css 仍保留已移除的沙箱支付样式：${token}`);
  }
}
const zhLocalesRaw = fs.readFileSync(
  path.join(root, 'src', 'shared', 'locales', 'zh-CN.json'),
  'utf8'
);
const enLocalesRaw = fs.readFileSync(
  path.join(root, 'src', 'shared', 'locales', 'en.json'),
  'utf8'
);
for (const [sourceName, source] of [
  ['renderer/index.html', rendererIndexSource],
  ['zh-CN.json', zhLocalesRaw],
  ['en.json', enLocalesRaw]
]) {
  if (/沙箱|模拟支付|未接入真实网关|sandbox\s*purchase|sandbox\s*buy/i.test(source)) {
    fail(`${sourceName} 仍包含沙箱/模拟支付测试文案`);
  }
}
if (!rendererIndexSource.includes('id="review-onboarding-btn"')) {
  fail('renderer/index.html 缺少“重新查看新手引导”入口（review-onboarding-btn）');
}
if (!rendererChatSource.includes('reviewOnboardingBtn')) {
  fail('renderer/chat.js 缺少“重新查看新手引导”入口接线');
}
pass('渲染层账户/订阅区块、门控与合规弹窗接线存在');

// 双语文案键
const requiredLicenseKeys = [
  'accountTitle',
  'tierFree',
  'tierYearly',
  'tierLifetime',
  'statusActive',
  'statusExpired',
  'statusRevoked',
  'statusInactive',
  'statusDeviceMismatch',
  'quotaDay',
  'quotaMonth',
  'quotaByok',
  'quotaExceeded',
  'comingSoonTitle',
  'comingSoonHint',
  'complianceTitle',
  'complianceAccept',
  'complianceDecline',
  'complianceRequired',
  'complianceRefusedNotice'
];
for (const locale of [zhLocales, enLocales]) {
  for (const key of requiredLicenseKeys) {
    if (
      !locale.license ||
      typeof locale.license[key] !== 'string' ||
      !locale.license[key]
    ) {
      fail(`locales 缺少 license.${key} 文案`);
    }
  }
}
pass('license 双语文案键齐全（zh-CN/en）');

// T-44：UI 大改 M3.6——主题/动效/小组件/无障碍（源码接线 + store 白名单 + 对比度）
const t44IndexIds = [
  'id="theme"',
  'id="reduce-motion"',
  'id="water-widget"',
  'id="water-enabled"',
  'id="water-interval"',
  'id="todos-widget"',
  'id="todo-input"',
  'id="todo-list"',
  'id="todo-status"'
];
for (const id of t44IndexIds) {
  if (!rendererIndexSource.includes(id)) {
    fail(`renderer/index.html 缺少 T-44 元素：${id}`);
  }
}
for (const token of [
  'applyTheme',
  'reduceMotion',
  'waterReminderSettings',
  'syncWaterWidget',
  'recordWaterDrink',
  'renderTodos',
  'saveTodos',
  'updateWidgetVisibility',
  'licenseTierIsPaid',
  'dataset.theme'
]) {
  if (!rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 缺少 T-44 逻辑：${token}`);
  }
}
for (const token of [
  'focusWidget',
  'focusCount',
  'focusMinutes',
  'normalizeFocusStats',
  'renderFocusStats',
  'recordFocusSession',
  'getFocusStats'
]) {
  if (rendererChatSource.includes(token)) {
    fail(`chat.js 仍包含已移除的专注统计代码：${token}`);
  }
}
for (const token of [
  ":root[data-theme='light']",
  'html.reduce-motion',
  '@keyframes pet-breathe',
  '@keyframes pet-blink',
  '@keyframes pet-bounce',
  '--t44-text-primary',
  '--t44-assistant-bubble',
  '.message-assistant .bubble',
  'backdrop-filter',
  '.t44-widget[hidden]',
  '0.3s ease'
]) {
  if (!rendererChatCssSource.includes(token)) {
    fail(`chat.css 缺少 T-44 主题/动效/小组件样式：${token}`);
  }
}
const t44LocaleKeys = {
  settings: [
    'theme',
    'themeDark',
    'themeLight',
    'themeHint',
    'reduceMotion',
    'reduceMotionHint'
  ],
  water: [
    'widgetAriaLabel',
    'title',
    'settingsLabel',
    'settingsHint',
    'interval',
    'intervalHint',
    'next',
    'due',
    'drinkNow',
    'recorded'
  ],
  todos: [
    'widgetAriaLabel',
    'title',
    'inputPlaceholder',
    'inputAriaLabel',
    'add',
    'empty',
    'delete',
    'doneAria',
    'undoAria',
    'limit'
  ]
};
for (const locale of [zhLocales, enLocales]) {
  for (const [section, keys] of Object.entries(t44LocaleKeys)) {
    for (const key of keys) {
      if (
        !locale[section] ||
        typeof locale[section][key] !== 'string' ||
        !locale[section][key].trim()
      ) {
        fail(`locales 缺少 ${section}.${key} 文案（T-44）`);
      }
    }
  }
}

// 对比度断言：提取 CSS 变量中的主/次文本色与底色，按 WCAG 2.1 计算
function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}
function channelLuminance(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const rgb = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
function cssVarValues(source, name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g');
  const values = [];
  let match = null;
  while ((match = re.exec(source)) !== null) {
    values.push(match[1].toLowerCase());
  }
  return values;
}
const cssVar = (name) => cssVarValues(rendererChatCssSource, name);
const darkBg = '#171a2b';
const lightBg = '#eef0f8';
const darkPrimary = cssVar('t44-text-primary')[0];
const darkSecondary = cssVar('t44-text-secondary')[0];
const lightPrimary = cssVar('t44-text-primary').pop();
const lightSecondary = cssVar('t44-text-secondary').pop();
const darkFocus = cssVar('t44-focus-ring')[0];
const lightFocus = cssVar('t44-focus-ring').pop();
const contrastPairs = [
  [darkPrimary, darkBg, '深色主文本'],
  [darkSecondary, darkBg, '深色次要文本'],
  [lightPrimary, lightBg, '浅色主文本'],
  [lightSecondary, lightBg, '浅色次要文本']
];
for (const [foreground, background, label] of contrastPairs) {
  if (!foreground || !/^#[0-9a-f]{6}$/.test(foreground)) {
    fail(`chat.css 缺少可解析的 ${label} 色值`);
  }
  const ratio = contrastRatio(foreground, background);
  if (ratio < 4.5) {
    fail(`T-44 ${label} 对比度不足：${foreground} vs ${background} = ${ratio.toFixed(2)}（需 ≥4.5）`);
  }
}
for (const [foreground, background, label] of [
  [darkFocus, darkBg, '深色焦点环'],
  [lightFocus, lightBg, '浅色焦点环']
]) {
  if (!foreground || !/^#[0-9a-f]{6}$/.test(foreground)) {
    fail(`chat.css 缺少可解析的 ${label} 色值`);
  }
  const ratio = contrastRatio(foreground, background);
  if (ratio < 3) {
    fail(`T-44 ${label} 对比度不足：${foreground} vs ${background} = ${ratio.toFixed(2)}（非文本需 ≥3）`);
  }
}
pass('T-44 主题变量/动效/小组件源码接线与 WCAG 对比度断言通过');

// T-44：store 白名单默认值、读写与清洗（theme/reduceMotion/waterReminder/todos）
const t44CheckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-t44-'));
try {
  const t44Store = createStore(t44CheckDir);
  if (DEFAULT_SETTINGS.theme !== 'dark') {
    fail('DEFAULT_SETTINGS.theme 应为 dark（默认深色玻璃拟态）');
  }
  if (DEFAULT_SETTINGS.reduceMotion !== false) {
    fail('DEFAULT_SETTINGS.reduceMotion 应为 false（默认不减弱动效）');
  }
  const defaultWater = DEFAULT_SETTINGS.waterReminder;
  if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'focusStats')) {
    fail('DEFAULT_SETTINGS 不应再包含 focusStats');
  }
  if (
    !defaultWater ||
    typeof defaultWater !== 'object' ||
    defaultWater.enabled !== false ||
    defaultWater.intervalMinutes !== 60 ||
    defaultWater.lastDrinkAt !== 0
  ) {
    fail('DEFAULT_SETTINGS.waterReminder 默认形状非法');
  }
  if (!Array.isArray(DEFAULT_SETTINGS.todos) || DEFAULT_SETTINGS.todos.length !== 0) {
    fail('DEFAULT_SETTINGS.todos 应为空数组');
  }

  // 主题与减弱动效
  const themeLight = t44Store.writeSettings({ theme: 'light' });
  if (themeLight.theme !== 'light' || t44Store.readSettings().theme !== 'light') {
    fail('store theme 浅色写入/读取不一致');
  }
  const themeInvalid = t44Store.writeSettings({ theme: 'blue' });
  if (themeInvalid.theme !== 'light') {
    fail('store theme 非法值应丢弃（保留当前值）');
  }
  const motionOn = t44Store.writeSettings({ reduceMotion: true });
  if (motionOn.reduceMotion !== true) {
    fail('store reduceMotion 开启失败');
  }
  const motionInvalid = t44Store.writeSettings({ reduceMotion: 'yes' });
  if (motionInvalid.reduceMotion !== true) {
    fail('store reduceMotion 非布尔值应丢弃（保留当前值）');
  }

  // 喝水提醒（间隔钳制/时间戳清洗）
  const waterWritten = t44Store.writeSettings({
    waterReminder: { enabled: true, intervalMinutes: 90, lastDrinkAt: 12345 }
  });
  if (
    waterWritten.waterReminder.enabled !== true ||
    waterWritten.waterReminder.intervalMinutes !== 90 ||
    waterWritten.waterReminder.lastDrinkAt !== 12345
  ) {
    fail('store waterReminder 写入失败');
  }
  const waterClamped = t44Store.writeSettings({
    waterReminder: { enabled: true, intervalMinutes: 999, lastDrinkAt: -1 }
  });
  if (
    waterClamped.waterReminder.intervalMinutes !== 240 ||
    waterClamped.waterReminder.lastDrinkAt !== 0
  ) {
    fail('store waterReminder 间隔未钳制到 240 / 时间戳未钳制到 0');
  }

  // 待办（上限 100、去重、文本截断、done 布尔清洗）
  const manyTodos = Array.from({ length: 99 }, (_v, i) => ({
    id: `todo-${i}`,
    text: `任务 ${i}`,
    done: i % 2 === 0,
    createdAt: i,
    completedAt: 0
  }));
  manyTodos.push({ id: 'todo-0', text: '重复 id 应被丢弃' });
  manyTodos.push({ id: 'no-text', text: '   ' });
  manyTodos.push({ id: 'long', text: '长'.repeat(300), done: 'yes' });
  const todosWritten = t44Store.writeSettings({ todos: manyTodos });
  if (todosWritten.todos.length !== 100) {
    fail(`store todos 应截断到 100 条（实际 ${todosWritten.todos.length}）`);
  }
  if (todosWritten.todos.some((item) => item.text.length > 200)) {
    fail('store todos 文本未按 200 截断');
  }
  const longItem = todosWritten.todos.find((item) => item.id === 'long');
  if (!longItem || longItem.done !== false || longItem.text.length !== 200) {
    fail('store todos done 非布尔值应清洗为 false，长文本应截断');
  }
  if (todosWritten.todos.filter((item) => item.id === 'todo-0').length !== 1) {
    fail('store todos 重复 id 未去重');
  }
  const todosInvalid = t44Store.writeSettings({ todos: 'bad' });
  if (todosInvalid.todos.length !== 100) {
    fail('store todos 非数组应丢弃（保留当前值）');
  }
  pass('T-44 store 白名单（theme/reduceMotion/waterReminder/todos）读写与清洗通过');
} finally {
  fs.rmSync(t44CheckDir, { recursive: true, force: true });
}

// T-51：存量 focusStats 设置字段兼容清理（不迁移、不暴露；ADR-039）
const legacyFocusCheckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-t51-'));
try {
  const legacyFocusStore = createStore(legacyFocusCheckDir);
  fs.writeFileSync(
    path.join(legacyFocusCheckDir, 'settings.json'),
    JSON.stringify({ petName: 'legacy-focus' }, null, 2),
    'utf8'
  );
  const legacyFocusRaw = JSON.parse(
    fs.readFileSync(path.join(legacyFocusCheckDir, 'settings.json'), 'utf8')
  );
  legacyFocusRaw.focusStats = { date: '2026-08-11', count: 3, minutes: 75 };
  fs.writeFileSync(
    path.join(legacyFocusCheckDir, 'settings.json'),
    JSON.stringify(legacyFocusRaw, null, 2),
    'utf8'
  );
  const legacyFocusRead = legacyFocusStore.readSettings();
  if (Object.prototype.hasOwnProperty.call(legacyFocusRead, 'focusStats')) {
    fail('store 仍暴露已移除的 focusStats 字段');
  }
  const focusPatch = legacyFocusStore.writeSettings({
    focusStats: { date: '2026-08-11', count: 5, minutes: 120 }
  });
  if (Object.prototype.hasOwnProperty.call(focusPatch, 'focusStats')) {
    fail('store focusStats 写入应被忽略（白名单已移除）');
  }
  const focusRawAfterWrite = JSON.parse(
    fs.readFileSync(path.join(legacyFocusCheckDir, 'settings.json'), 'utf8')
  );
  if (Object.prototype.hasOwnProperty.call(focusRawAfterWrite, 'focusStats')) {
    fail('settings.json 中 focusStats 字段未被删除');
  }
  pass('store focusStats 字段已移除（存量字段兼容清理，不迁移/不暴露）');
} finally {
  fs.rmSync(legacyFocusCheckDir, { recursive: true, force: true });
}

(async () => {
  try {
    // T-40：许可证状态机（三态切换/持久化/过期/吊销/设备绑定/额度/mock 回调）
    const fixedNow = Date.UTC(2026, 7, 11, 8, 0, 0);
    const licenseCheckDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-pet-license-')
    );
    try {
      const licenseStoreInstance = createStore(licenseCheckDir);
      const licenseStore = {
        readSettings: () => licenseStoreInstance.readSettings(),
        writeSettings: (patch) => licenseStoreInstance.writeSettings(patch)
      };
      const license = licenseModule.createLicenseManager({
        settings: licenseStore,
        baseDir: licenseCheckDir,
        now: () => fixedNow
      });

      const initial = license.getPublicStatus();
      if (
        initial.tier !== 'free' ||
        initial.effectiveTier !== 'free' ||
        initial.status !== 'inactive' ||
        initial.entitlements.advancedNeuralVoices !== false ||
        initial.entitlements.skinMarket !== false ||
        initial.entitlements.todos !== false ||
        initial.entitlements.byokChat !== true ||
        initial.entitlements.localMemory !== true ||
        initial.entitlements.weather !== true
      ) {
        fail('默认许可证应为 free/inactive，Pro 门控锁定、本地功能保留');
      }
      if (initial.entitlements.pomodoro !== undefined) {
        fail('license entitlements 不应再包含 pomodoro');
      }
      if (initial.entitlements.focusStats !== undefined) {
        fail('license entitlements 不应再包含 focusStats');
      }
      if (initial.quota.limit !== 10 || initial.quota.period !== 'day') {
        fail('免费版云 AI 额度默认应为 10 次/日');
      }

      // 非法写入清洗
      const cleanedLicense = licenseStoreInstance.writeSettings({
        licenseTier: 'gold',
        licenseKey: 'x'.repeat(300),
        licenseExpiresAt: -5,
        deviceId: 123,
        complianceAccepted: 'yes'
      });
      if (
        cleanedLicense.licenseTier !== 'free' ||
        cleanedLicense.licenseKey.length !== 128 ||
        cleanedLicense.licenseExpiresAt !== 0 ||
        cleanedLicense.deviceId !== initial.deviceId ||
        cleanedLicense.complianceAccepted !== false
      ) {
        fail('store 许可证字段清洗失败（非法值未丢弃/超长未截断）');
      }

      // 合规同意持久化
      const accepted = licenseStoreInstance.writeSettings({
        complianceAccepted: true
      });
      if (
        accepted.complianceAccepted !== true ||
        licenseStoreInstance.readSettings().complianceAccepted !== true
      ) {
        fail('complianceAccepted 持久化失败');
      }

      // Pro 订阅激活（小写输入应归一化为大写）
      const yearly = license.activate('pro-yearly-abcdefabcdef0123');
      if (
        !yearly.ok ||
        yearly.status.tier !== 'yearly' ||
        yearly.status.effectiveTier !== 'yearly' ||
        yearly.status.expiresAt <= fixedNow ||
        yearly.status.deviceBound !== true
      ) {
        fail('Pro 订阅激活失败或设备绑定未生效');
      }
      const yearlyEntitlements = yearly.status.entitlements;
      if (
        yearlyEntitlements.advancedNeuralVoices !== true ||
        yearlyEntitlements.skinMarket !== true ||
        yearlyEntitlements.todos !== true ||
        yearly.status.quota.limit !== 200 ||
        yearly.status.quota.period !== 'month'
      ) {
        fail('Pro 订阅门控/额度错误');
      }
      const persistedLicense = licenseStoreInstance.readSettings();
      if (
        persistedLicense.licenseTier !== 'yearly' ||
        persistedLicense.licenseKey !== 'PRO-YEARLY-ABCDEFABCDEF0123' ||
        !persistedLicense.deviceId
      ) {
        fail('许可证未正确持久化到 settings.json');
      }

      // 云 AI 额度记录与消费
      for (let i = 0; i < 5; i += 1) {
        license.recordCloudUsage();
      }
      const quotaAfterFive = license.getPublicStatus().quota;
      if (quotaAfterFive.used !== 5 || quotaAfterFive.remaining !== 195) {
        fail('Pro 月度额度记录错误');
      }
      const consumed = license.consumeCloudQuota();
      if (!consumed.ok || consumed.usage.used !== 6) {
        fail('consumeCloudQuota 消费失败');
      }

      // 过期处理：时间推进一年后降级为 free
      const expiredLicense = licenseModule.createLicenseManager({
        settings: licenseStore,
        baseDir: licenseCheckDir,
        now: () => fixedNow + 366 * 24 * 60 * 60 * 1000
      });
      const expired = expiredLicense.getPublicStatus();
      if (
        expired.status !== 'expired' ||
        expired.effectiveTier !== 'free' ||
        expired.entitlements.advancedNeuralVoices !== false
      ) {
        fail('订阅过期未降级为免费档');
      }

      // 永久买断激活（买断不含云额度，按免费档 10 次/日）
      license.deactivate();
      const lifetime = license.activate('PRO-LIFETIME-abcdefabcdef0123');
      if (
        !lifetime.ok ||
        lifetime.status.tier !== 'lifetime' ||
        lifetime.status.expiresAt !== 0 ||
        lifetime.status.quota.limit !== 10 ||
        lifetime.status.quota.period !== 'day'
      ) {
        fail('永久买断激活失败或云额度档位错误');
      }

      // mock 订单号校验
      license.deactivate();
      const orderYearly = license.activate('ORDER-202608110001');
      if (!orderYearly.ok || orderYearly.status.tier !== 'yearly') {
        fail('mock 订单号（年订阅）激活失败');
      }
      license.deactivate();
      const orderLifetime = license.activate('ORDER-202608110002');
      if (!orderLifetime.ok || orderLifetime.status.tier !== 'lifetime') {
        fail('mock 订单号（买断）激活失败');
      }
      license.deactivate();
      const unknownOrder = license.activate('ORDER-000000000000');
      if (unknownOrder.ok || unknownOrder.error !== 'license-order-not-found') {
        fail('未知订单号应返回 license-order-not-found');
      }

      // 吊销处理
      const revokedActivation = license.activate('PRO-YEARLY-0000000000000000');
      if (revokedActivation.ok || revokedActivation.error !== 'license-revoked') {
        fail('吊销激活码未被拒绝');
      }
      const invalidActivation = license.activate('BOGUS-CODE');
      if (invalidActivation.ok || invalidActivation.error !== 'license-invalid-code') {
        fail('非法激活码未被拒绝');
      }

      // 注销激活回免费
      const deactivated = license.deactivate();
      if (
        !deactivated.ok ||
        deactivated.status.tier !== 'free' ||
        deactivated.status.status !== 'inactive'
      ) {
        fail('注销激活失败');
      }

      // 支付回调桩（T-41 前仅 mock 订单号）
      const callbackOk = await license.handlePaymentCallback({
        orderId: 'ORDER-202608110001'
      });
      if (!callbackOk.ok || callbackOk.status.tier !== 'yearly') {
        fail('支付回调桩（mock 订单）激活失败');
      }
      const callbackEmpty = await license.handlePaymentCallback({});
      if (callbackEmpty.ok || callbackEmpty.error !== 'license-payment-not-implemented') {
        fail('空支付回调应返回 license-payment-not-implemented');
      }
    } finally {
      fs.rmSync(licenseCheckDir, { recursive: true, force: true });
    }

    // 设备绑定不一致：换设备后不应获得 Pro 权益
    const mismatchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-pet-license-dev-')
    );
    try {
      const mismatchStore = createStore(mismatchDir);
      const mismatchLicenseStore = {
        readSettings: () => mismatchStore.readSettings(),
        writeSettings: (patch) => mismatchStore.writeSettings(patch)
      };
      const mismatchLicense = licenseModule.createLicenseManager({
        settings: mismatchLicenseStore,
        baseDir: mismatchDir,
        now: () => fixedNow
      });
      mismatchLicense.activate('PRO-YEARLY-abcdefabcdef0123');
      const rawSettings = JSON.parse(
        fs.readFileSync(path.join(mismatchDir, 'settings.json'), 'utf8')
      );
      rawSettings.deviceId = 'dev-other-device';
      fs.writeFileSync(
        path.join(mismatchDir, 'settings.json'),
        JSON.stringify(rawSettings, null, 2),
        'utf8'
      );
      const otherDevice = licenseModule.createLicenseManager({
        settings: mismatchLicenseStore,
        baseDir: mismatchDir,
        now: () => fixedNow
      });
      const mismatched = otherDevice.getPublicStatus();
      if (
        mismatched.status !== 'device-mismatch' ||
        mismatched.effectiveTier !== 'free' ||
        mismatched.entitlements.advancedNeuralVoices !== false
      ) {
        fail('设备绑定不一致未被识别（Pro 权益不应生效）');
      }
    } finally {
      fs.rmSync(mismatchDir, { recursive: true, force: true });
    }
    pass('T-40 许可证状态机/三态切换/过期/吊销/设备绑定/额度/mock 回调通过');
  } catch (error) {
    fail(`T-40 许可证检查异常: ${error && error.message ? error.message : error}`);
  }
})();

// T-41：支付通道接入（沙箱/桩；凭证仅环境变量；幂等/验签/回调→升档/降级；禁真实网关）
const paymentModulePath = path.join(root, 'src', 'main', 'payment.js');
if (!fs.existsSync(paymentModulePath)) {
  fail('缺少 src/main/payment.js（T-41 支付沙箱/桩）');
}
const paymentModule = require(paymentModulePath);
const paymentSource = fs.readFileSync(paymentModulePath, 'utf8');
if (
  typeof paymentModule.createPaymentManager !== 'function' ||
  typeof paymentModule.verifyCallbackSignature !== 'function' ||
  typeof paymentModule.signCallbackPayload !== 'function'
) {
  fail('payment.js 缺少 createPaymentManager/verifyCallbackSignature/signCallbackPayload');
}
if (
  !paymentModule.PLANS ||
  paymentModule.PLANS.yearly.amountMinor !== 12800 ||
  paymentModule.PLANS.lifetime.amountMinor !== 6800
) {
  fail('payment.js 定价档位错误（应 yearly ¥128、lifetime ¥68）');
}
if (
  !paymentModule.CHANNELS ||
  !paymentModule.EVENT_ACTIONS ||
  !paymentModule.EVENT_ACTIONS.alipay ||
  !paymentModule.EVENT_ACTIONS.paddle ||
  !paymentModule.EVENT_ACTIONS.stripe
) {
  fail('payment.js 缺少国内/海外通道结构映射');
}
pass('payment.js 模块结构、定价与双通道映射存在');

// 凭证仅环境变量：读取真实 process.env 且引用 AI_PET_PAYMENT_*，无硬编码值
if (!paymentSource.includes('process.env')) {
  fail('payment.js 未通过 process.env 读取凭证');
}
const paymentEnvRefs = paymentSource.match(/AI_PET_PAYMENT_[A-Z0-9_]+/g) || [];
if (paymentEnvRefs.length < 2) {
  fail('payment.js 未引用 AI_PET_PAYMENT_* 环境变量');
}
if (/AI_PET_PAYMENT_[A-Z0-9_]+\s*=\s*['"][^'"]+['"]/.test(paymentSource)) {
  fail('payment.js 出现硬编码 AI_PET_PAYMENT_* 值（凭证必须来自环境变量）');
}
// 禁止真实网关地址/网络端点
if (/https?:\/\//.test(paymentSource)) {
  fail('payment.js 出现真实网关/网络地址（本卡禁止任何真实网关）');
}
pass('payment.js 凭证仅环境变量读取、零硬编码密钥、无真实网关地址');

// IPC/preload 通道接线
for (const token of [
  "paymentCreateOrder: 'payment:create-order'",
  "paymentMockCallback: 'payment:mock-callback'",
  'ipcMain.handle(CHANNELS.paymentCreateOrder',
  'ipcMain.handle(CHANNELS.paymentMockCallback',
  "require('./payment')",
  'getPaymentManager'
]) {
  if (!ipcSource.includes(token)) {
    fail(`ipc.js 缺少支付接线：${token}`);
  }
}
for (const token of [
  "paymentCreateOrder: 'payment:create-order'",
  "paymentMockCallback: 'payment:mock-callback'",
  'payment: {',
  'createOrder: (payload)',
  'mockCallback: (payload)'
]) {
  if (!preloadSource.includes(token)) {
    fail(`preload.js 缺少支付暴露：${token}`);
  }
}
pass('payment:create-order / payment:mock-callback IPC 与 preload 接线存在');

// license.js 回调联动（支付→升档/降级）
const licenseSourceForPayment = fs.readFileSync(licenseModulePath, 'utf8');
for (const token of ['activateByPayment', 'downgradeByPayment', 'PAY-${']) {
  if (!licenseSourceForPayment.includes(token)) {
    fail(`license.js 缺少支付回调联动：${token}`);
  }
}
pass('license.js 已提供支付升档/降级联动');

// T-54：生产 UI 防回归——渲染层不得再暴露沙箱支付/mock 激活流程
for (const token of [
  'payment.createOrder',
  'payment.mockCallback',
  'payment.activated',
  'sandboxPurchase',
  'showPaymentMessage',
  'showLicenseMessage'
]) {
  if (rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 仍残留开发测试桩流程：${token}`);
  }
}
if (!rendererIndexSource.includes('id="pro-coming-soon"')) {
  fail('renderer/index.html 缺少 Pro 即将上线占位（pro-coming-soon）');
}
if (!rendererChatCssSource.includes('.pro-coming-soon')) {
  fail('chat.css 缺少 Pro 即将上线占位样式');
}
if (zhLocales.payment || enLocales.payment) {
  fail('locales 仍包含 payment.* 死文案');
}
pass('T-54 沙箱支付/mock 激活 UI 已从生产界面移除');

// T-48：设置页三段式布局（顶部账号卡片 + 分组列表 + 版本页脚）
const t48RequiredIds = [
  'id="settings-groups"',
  'id="settings-group-appearance"',
  'id="settings-group-conversation"',
  'id="settings-group-companion"',
  'id="settings-group-privacy"',
  'id="settings-version"',
  'id="account-section"',
  'id="license-tier"',
  'id="license-status"',
  'id="license-expiry"',
  'id="license-quota"',
  'id="pro-coming-soon"',
  'id="review-onboarding-btn"',
  'id="api-key"',
  'id="model"',
  'id="language"',
  'id="theme"',
  'id="reduce-motion"',
  'id="idle-enabled"',
  'id="weather-enabled"',
  'id="weather-city"',
  'id="water-enabled"',
  'id="water-interval"',
  'id="telemetry-enabled"',
  'id="telemetry-clear"',
  'id="pet-name"',
  'id="persona-template-list"',
  'id="persona-traits"',
  'id="persona-tone"',
  'id="persona-backstory"',
  'id="tts-voice-pack-enabled"',
  'id="tts-voice-pack-id"',
  'id="memory-manage-btn"',
  'id="skin-manage-btn"',
  'id="settings-save"',
  'id="settings-status"',
  'id="clear-scope"',
  'id="clear-data"',
  'id="clear-status"',
  'id="settings-group-toggle-account"',
  'id="settings-group-panel-account"'
];
for (const token of t48RequiredIds) {
  if (!rendererIndexSource.includes(token)) {
    fail(`renderer/index.html 缺少 T-48 保留元素：${token}`);
  }
}
for (const token of [
  'settings-group-toggle',
  'aria-controls="settings-group-panel-appearance"',
  'aria-controls="settings-group-panel-account"',
  'aria-expanded="false"'
]) {
  if (!rendererIndexSource.includes(token)) {
    fail(`renderer/index.html 缺少 T-48 分组行结构：${token}`);
  }
}
for (const token of [
  'toggleSettingsGroup',
  'refreshSettingsGroupTitles',
  'bindSettingsGroups',
  'settingsVersion',
  'window.petAPI.version',
  'reviewOnboardingBtn'
]) {
  if (!rendererChatSource.includes(token)) {
    fail(`renderer/chat.js 缺少 T-48 逻辑：${token}`);
  }
}
for (const token of [
  '.pro-coming-soon',
  '.settings-groups',
  '.settings-group-toggle',
  '.settings-group-panel',
  '.settings-save-bar',
  '.settings-footer'
]) {
  if (!rendererChatCssSource.includes(token)) {
    fail(`chat.css 缺少 T-48 三段式样式：${token}`);
  }
}
const t48RequiredLocaleKeys = [
  'reviewOnboarding',
  'groupAppearance',
  'groupConversation',
  'groupCompanion',
  'groupPrivacy',
  'groupExpandHint',
  'groupCollapseHint',
  'footerPoweredBy'
];
for (const locale of [zhLocales, enLocales]) {
  for (const key of t48RequiredLocaleKeys) {
    if (
      !locale.settings ||
      typeof locale.settings[key] !== 'string' ||
      !locale.settings[key]
    ) {
      fail(`locales 缺少 settings.${key} 文案`);
    }
  }
}
pass('T-48 设置页三段式布局、既有元素 id 与双语文案断言通过');

(async () => {
  try {
    const fixedNow = Date.UTC(2026, 7, 11, 8, 0, 0);
    const paymentCheckDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-pet-payment-')
    );
    try {
      const paymentStoreInstance = createStore(paymentCheckDir);
      const paymentLicenseStore = {
        readSettings: () => paymentStoreInstance.readSettings(),
        writeSettings: (patch) => paymentStoreInstance.writeSettings(patch)
      };
      const paymentLicense = licenseModule.createLicenseManager({
        settings: paymentLicenseStore,
        baseDir: paymentCheckDir,
        now: () => fixedNow
      });
      const pay = paymentModule.createPaymentManager({
        baseDir: paymentCheckDir,
        license: paymentLicense,
        now: () => fixedNow,
        env: {}
      });

      // 沙箱下单（yearly：¥128；状态 pending；订单号 SB- 前缀）
      const created = pay.createOrder({ tier: 'yearly', channel: 'alipay' });
      if (
        !created.ok ||
        created.order.tier !== 'yearly' ||
        created.order.amountMinor !== 12800 ||
        created.order.status !== 'pending' ||
        !/^SB-/.test(created.order.orderId)
      ) {
        fail(`沙箱下单异常: ${JSON.stringify(created)}`);
      }
      const invalidTier = pay.createOrder({ tier: 'free' });
      if (invalidTier.ok || invalidTier.error !== 'payment-invalid-tier') {
        fail('非法档位下单未被拒绝');
      }
      pass('T-41 沙箱下单（yearly/lifetime 定价、待支付状态）通过');

      // 模拟支付成功回调 → 许可证升档
      const success = pay.mockCallback({
        orderId: created.order.orderId,
        channel: 'alipay'
      });
      if (
        !success.ok ||
        success.duplicate !== false ||
        success.order.status !== 'paid' ||
        !success.licenseStatus ||
        success.licenseStatus.tier !== 'yearly' ||
        success.licenseStatus.effectiveTier !== 'yearly'
      ) {
        fail(`支付成功回调未升档: ${JSON.stringify(success)}`);
      }

      // 幂等：重复回调不重复升档
      const duplicate = pay.mockCallback({
        orderId: created.order.orderId,
        channel: 'alipay'
      });
      if (!duplicate.ok || duplicate.duplicate !== true) {
        fail(`重复回调未识别为幂等: ${JSON.stringify(duplicate)}`);
      }
      if (
        !duplicate.licenseStatus ||
        duplicate.licenseStatus.tier !== 'yearly'
      ) {
        fail('重复回调导致许可证状态异常');
      }

      // 验签失败拒绝：无 sandbox 标记且无签名
      const unsigned = pay.processCallback({
        channel: 'alipay',
        eventType: 'payment.success',
        eventId: 'evt-unsigned',
        orderId: created.order.orderId,
        amount: 12800
      });
      if (unsigned.ok || unsigned.error !== 'payment-signature-required') {
        fail(`无签名回调未被拒绝: ${JSON.stringify(unsigned)}`);
      }

      // 金额不匹配拒绝（失败回滚：订单/许可证保持原状）
      const amountBad = pay.processCallback({
        channel: 'alipay',
        eventType: 'payment.success',
        eventId: 'evt-amount-bad',
        orderId: created.order.orderId,
        amount: 1,
        sandbox: true
      });
      if (amountBad.ok || amountBad.error !== 'payment-amount-mismatch') {
        fail(`金额不匹配未被拒绝: ${JSON.stringify(amountBad)}`);
      }
      const afterAmountBad = pay.getOrder(created.order.orderId);
      if (afterAmountBad.status !== 'paid') {
        fail('金额校验失败后订单状态被改动（应保持 paid）');
      }

      // 退款回调 → 降级（海外通道结构兼容）
      const refund = pay.mockCallback({
        orderId: created.order.orderId,
        channel: 'paddle',
        eventType: 'payment_refunded'
      });
      if (
        !refund.ok ||
        refund.order.status !== 'refunded' ||
        !refund.licenseStatus ||
        refund.licenseStatus.tier !== 'free' ||
        refund.licenseStatus.status !== 'inactive'
      ) {
        fail(`退款回调未降级: ${JSON.stringify(refund)}`);
      }
      const refundDuplicate = pay.mockCallback({
        orderId: created.order.orderId,
        channel: 'paddle',
        eventType: 'payment_refunded'
      });
      if (!refundDuplicate.ok || refundDuplicate.duplicate !== true) {
        fail('退款重复回调未幂等');
      }
      pass('T-41 成功升档/重复幂等/验签拒绝/退款降级通过');

      // 海外通道（stripe）成功与取消
      const lifetime = pay.createOrder({ tier: 'lifetime', channel: 'stripe' });
      const lifetimeSuccess = pay.mockCallback({
        orderId: lifetime.order.orderId,
        channel: 'stripe'
      });
      if (
        !lifetimeSuccess.ok ||
        !lifetimeSuccess.licenseStatus ||
        lifetimeSuccess.licenseStatus.tier !== 'lifetime'
      ) {
        fail(`海外 stripe 成功回调未升档: ${JSON.stringify(lifetimeSuccess)}`);
      }
      const lifetimeCancel = pay.mockCallback({
        orderId: lifetime.order.orderId,
        channel: 'stripe',
        eventType: 'customer.subscription.deleted'
      });
      if (
        !lifetimeCancel.ok ||
        !lifetimeCancel.licenseStatus ||
        lifetimeCancel.licenseStatus.tier !== 'free'
      ) {
        fail(`海外 stripe 取消回调未降级: ${JSON.stringify(lifetimeCancel)}`);
      }

      // 未知订单 / 未知事件拒绝
      const unknownOrder = pay.processCallback({
        channel: 'paddle',
        eventType: 'subscription_activated',
        eventId: 'evt-unknown-order',
        orderId: 'SB-NOPE',
        amount: 6800,
        sandbox: true
      });
      if (unknownOrder.ok || unknownOrder.error !== 'payment-order-not-found') {
        fail('未知订单未被拒绝');
      }
      const unknownEvent = pay.processCallback({
        channel: 'stripe',
        eventType: 'charge.succeeded',
        eventId: 'evt-unknown-event',
        orderId: lifetime.order.orderId,
        amount: 6800,
        sandbox: true
      });
      if (unknownEvent.ok || unknownEvent.error !== 'payment-unsupported-event') {
        fail('未知事件未被拒绝');
      }

      // 环境变量密钥 + HMAC 验签（真实 webhook 形态，无 sandbox 标记）
      const secretPay = paymentModule.createPaymentManager({
        baseDir: paymentCheckDir,
        license: paymentLicense,
        now: () => fixedNow,
        env: { AI_PET_PAYMENT_WEBHOOK_SECRET: 'test-secret' }
      });
      const secretOrder = secretPay.createOrder({
        tier: 'yearly',
        channel: 'stripe'
      });
      const signedEvent = {
        channel: 'stripe',
        eventType: 'checkout.session.completed',
        eventId: 'evt-hmac-1',
        orderId: secretOrder.order.orderId,
        amount: 12800,
        currency: 'CNY',
        tier: 'yearly',
        timestamp: fixedNow
      };
      signedEvent.signature = paymentModule.signCallbackPayload(
        signedEvent,
        'test-secret'
      );
      const signedOk = secretPay.processCallback(signedEvent);
      if (
        !signedOk.ok ||
        !signedOk.licenseStatus ||
        signedOk.licenseStatus.tier !== 'yearly'
      ) {
        fail(`HMAC 验签成功回调未升档: ${JSON.stringify(signedOk)}`);
      }
      const wrongSignature = secretPay.processCallback({
        ...signedEvent,
        signature: 'deadbeef'
      });
      if (
        wrongSignature.ok ||
        wrongSignature.error !== 'payment-signature-invalid'
      ) {
        fail('错误 HMAC 签名未被拒绝');
      }
      pass('T-41 海外通道/未知拒绝/环境变量 HMAC 验签通过');

      // 非沙箱模式拒绝一切操作（防误配触碰真实网关）
      const livePay = paymentModule.createPaymentManager({
        baseDir: paymentCheckDir,
        license: paymentLicense,
        now: () => fixedNow,
        env: { AI_PET_PAYMENT_MODE: 'live' }
      });
      const liveOrder = livePay.createOrder({ tier: 'yearly' });
      if (liveOrder.ok || liveOrder.error !== 'payment-sandbox-only') {
        fail('非 sandbox 模式未被拒绝');
      }
      pass('T-41 非 sandbox 模式拒绝操作通过');
    } finally {
      fs.rmSync(paymentCheckDir, { recursive: true, force: true });
    }
    pass('T-41 支付沙箱全链路/幂等/验签/升档/降级/海外通道/环境变量密钥通过');
  } catch (error) {
    fail(`T-41 支付检查异常: ${error && error.message ? error.message : error}`);
  }
})();

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

    // T-42：遥测运行时验证（默认关闭/开关持久化/脱敏/断网缓存/本地端点批量上报/清除）
    const telemetryCheckDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-pet-telemetry-check-')
    );
    let telemetryServer = null;
    try {
      if (DEFAULT_SETTINGS.telemetryEnabled !== false) {
        fail('DEFAULT_SETTINGS.telemetryEnabled 应为 false（默认关闭）');
      }
      const telemetryStore = createStore(telemetryCheckDir);
      const enabledWrite = telemetryStore.writeSettings({
        telemetryEnabled: true
      });
      if (
        enabledWrite.telemetryEnabled !== true ||
        telemetryStore.readSettings().telemetryEnabled !== true
      ) {
        fail('store telemetryEnabled 开启后写入/读取不一致');
      }
      const invalidTelemetryWrite = telemetryStore.writeSettings({
        telemetryEnabled: 'yes'
      });
      if (invalidTelemetryWrite.telemetryEnabled !== true) {
        fail('store telemetryEnabled 非布尔值应丢弃（保留当前值）');
      }
      telemetryStore.writeSettings({ telemetryEnabled: false });
      pass('T-42 store telemetryEnabled 默认关闭/读写/清洗通过');

      // 脱敏与字段白名单
      const telemetry = telemetryModule.createTelemetry({
        baseDir: path.join(telemetryCheckDir, 't1'),
        endpoint: '',
        enabled: true,
        appName: 'check',
        version: '0.0.0-test',
        logger: { warn: () => {}, error: () => {} }
      });
      const firstRun = telemetry.trackInstallIfFirstRun();
      if (!firstRun.isNew) {
        fail('首次运行应创建新设备标识（app_install 判定）');
      }
      const status0 = telemetry.getStatus();
      if (status0.endpointConfigured !== false) {
        fail('端点默认空时 endpointConfigured 应为 false');
      }
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          status0.deviceId || ''
        )
      ) {
        fail(`deviceId 应为 UUID v4（实际 ${status0.deviceId}）`);
      }
      telemetry.track('chat_sent', {
        chars: 12,
        stream: 1,
        text: '这条消息正文绝不能进队列',
        apiKey: 'sk-secret',
        content: '同样敏感',
        path: 'C:\\Users\\someone\\secret',
        message: 'nope'
      });
      telemetry.track('app_start', {
        sessionId: 'abc',
        version: '0.0.0',
        locale: 'zh-CN'
      });
      telemetry.track('license_state_change', { state: 'active', tier: 'pro' });
      telemetry.track('unknown_event', { anything: 1 });

      const deviceRaw = JSON.parse(
        fs.readFileSync(path.join(telemetryCheckDir, 't1', 'device.json'), 'utf8')
      );
      if (Object.keys(deviceRaw).some((key) => /license|key|user|path/i.test(key))) {
        fail('device.json 不应包含许可证/用户/路径字段（与许可证解耦）');
      }
      const queuedRaw = JSON.parse(
        fs.readFileSync(path.join(telemetryCheckDir, 't1', 'queue.json'), 'utf8')
      );
      const queuedEvents = Array.isArray(queuedRaw.events) ? queuedRaw.events : [];
      if (queuedEvents.length !== 4) {
        fail(`脱敏后队列事件数应为 4（实际 ${queuedEvents.length}，未知事件应丢弃）`);
      }
      const serialized = JSON.stringify(queuedRaw);
      for (const needle of [
        '消息正文',
        'sk-secret',
        'C:\\Users',
        'nope',
        '同样敏感'
      ]) {
        if (serialized.includes(needle)) {
          fail(`遥测队列出现敏感数据: ${needle}`);
        }
      }
      const chatSentEvent = queuedEvents.find((event) => event.name === 'chat_sent');
      const licenseEvent = queuedEvents.find(
        (event) => event.name === 'license_state_change'
      );
      if (
        !chatSentEvent ||
        chatSentEvent.fields.chars !== 12 ||
        chatSentEvent.fields.stream !== 1 ||
        !licenseEvent ||
        licenseEvent.fields.state !== 'active' ||
        licenseEvent.fields.tier !== 'pro'
      ) {
        fail('遥测白名单字段缺失');
      }
      if (!telemetryModule.EVENT_NAMES.includes('license_state_change')) {
        fail('事件白名单缺少 license_state_change');
      }
      pass('T-42 遥测脱敏与字段白名单通过');

      // 断网缓存：指向未监听端口，失败后队列保留
      const offline = telemetryModule.createTelemetry({
        baseDir: path.join(telemetryCheckDir, 't2'),
        endpoint: 'http://127.0.0.1:1/telemetry',
        enabled: true,
        appName: 'check',
        version: '0.0.0-test',
        logger: { warn: () => {}, error: () => {} }
      });
      offline.track('weather_refresh', { ok: 0, latencyMs: 5 });
      const offlineFlush = await offline.flush();
      if (offlineFlush.ok !== false) {
        fail('断网上报应失败（ok=false）');
      }
      if (offline.getStatus().queuedCount !== 1) {
        fail('断网失败后本地队列应保留');
      }
      pass('T-42 断网缓存（失败保留队列）通过');

      // 本地端点批量上报
      const received = [];
      telemetryServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          received.push({ url: req.url, body: JSON.parse(body) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
      });
      await new Promise((resolve) =>
        telemetryServer.listen(0, '127.0.0.1', resolve)
      );
      const port = telemetryServer.address().port;
      const online = telemetryModule.createTelemetry({
        baseDir: path.join(telemetryCheckDir, 't3'),
        endpoint: `http://127.0.0.1:${port}/telemetry`,
        enabled: true,
        appName: 'check',
        version: '0.0.0-test',
        logger: { warn: () => {}, error: () => {} }
      });
      online.track('chat_reply', { ok: 1, replyChars: 42, latencyMs: 321 });
      const onlineFlush = await online.flush();
      if (!onlineFlush.ok || onlineFlush.sent !== 1) {
        fail(`本地端点批量上报失败: ${JSON.stringify(onlineFlush)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (received.length !== 1) {
        fail(`本地端点应收到 1 批（实际 ${received.length}）`);
      }
      const batch = received[0].body;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          batch.deviceId || ''
        )
      ) {
        fail(`上报 batch.deviceId 应为 UUID（实际 ${JSON.stringify(batch)}）`);
      }
      if (!Array.isArray(batch.events) || batch.events.length !== 1) {
        fail('上报 batch.events 数量应为 1');
      }
      const allowedFieldKeys = new Set([
        'ok',
        'replyChars',
        'latencyMs',
        'state',
        'tier',
        'chars',
        'stream',
        'sessionId',
        'version',
        'locale',
        'durationSec'
      ]);
      for (const event of batch.events) {
        for (const key of Object.keys(event.fields || {})) {
          if (!allowedFieldKeys.has(key)) {
            fail(`上报字段超出白名单: ${key}`);
          }
        }
      }
      if (online.getStatus().queuedCount !== 0) {
        fail('上报成功后队列未清空');
      }
      pass('T-42 本地端点批量上报（字段白名单/队列清空）通过');

      // 一键关闭并清除
      online.track('app_start', {
        sessionId: 'x',
        version: '0.0.0',
        locale: 'en'
      });
      const cleared = online.clear();
      if (cleared.clearedEvents !== 1 || cleared.deviceReset !== true) {
        fail(`清除结果异常: ${JSON.stringify(cleared)}`);
      }
      const clearedStatus = online.getStatus();
      if (clearedStatus.queuedCount !== 0 || clearedStatus.deviceId !== null) {
        fail('清除后队列/deviceId 应清空');
      }
      if (fs.existsSync(path.join(telemetryCheckDir, 't3', 'device.json'))) {
        fail('清除后 device.json 应已删除');
      }
      pass('T-42 一键关闭并清除本地数据通过');
    } finally {
      if (telemetryServer) {
        try {
          telemetryServer.close();
        } catch (_error) {
          // 测试服务器关闭失败不影响断言
        }
      }
      fs.rmSync(telemetryCheckDir, { recursive: true, force: true });
    }
  } catch (error) {
    fail(`chat 服务功能检查异常: ${error && error.message ? error.message : error}`);
  }

  // T-45：应用内分享 + 官网落地页 + 社媒素材
  const websiteIndexSource = fs.readFileSync(
    path.join(root, 'website', 'index.html'),
    'utf8'
  );
  const websiteCssSource = fs.readFileSync(
    path.join(root, 'website', 'style.css'),
    'utf8'
  );
  for (const file of [
    'website/index.html',
    'website/style.css',
    'website/README.md'
  ]) {
    if (!fs.existsSync(path.join(root, file))) {
      fail(`缺少 T-45 官网文件: ${file}`);
    }
  }
  for (const id of [
    'download',
    'pricing',
    'privacy',
    'features',
    'faq',
    'skin-market'
  ]) {
    if (!websiteIndexSource.includes(`id="${id}"`)) {
      fail(`website/index.html 缺少 ${id} 区块`);
    }
  }
  if (
    !websiteIndexSource.includes('免费') ||
    !websiteIndexSource.includes('Pro') ||
    !websiteIndexSource.includes('永久买断') ||
    !websiteIndexSource.includes('皮肤')
  ) {
    fail('website/index.html 定价区缺少 免费/Pro/永久/皮肤市场 信息');
  }
  if (
    websiteIndexSource.includes('src="http') ||
    websiteIndexSource.includes("src='http")
  ) {
    fail('website/index.html 引入了外部脚本/资源（违反无外部依赖）');
  }
  if (!websiteIndexSource.includes('stylesheet')) {
    fail('website/index.html 未引用本地样式');
  }
  if (/url\(\s*['"]?https?:/.test(websiteCssSource)) {
    fail('website/style.css 引用了外部资源（违反无外部依赖）');
  }
  pass('T-45 官网落地页齐全（下载/定价/隐私/亮点/皮肤预览/FAQ，无外部依赖）');

  const socialCopySource = fs.readFileSync(
    path.join(root, 'docs', 'marketing', 'social-copy.md'),
    'utf8'
  );
  for (const keyword of ['小红书', 'B 站', '抖音', '封面尺寸', '投放建议']) {
    if (!socialCopySource.includes(keyword)) {
      fail(`docs/marketing/social-copy.md 缺少 ${keyword}`);
    }
  }
  const templateCount = (socialCopySource.match(/模板/g) || []).length;
  if (templateCount < 6) {
    fail(
      `docs/marketing/social-copy.md 文案模板不足（要求每平台 2 组以上，至少 6 个，实际 ${templateCount}）`
    );
  }
  pass('T-45 社媒素材齐全（3 平台 × 2 组文案 + 封面尺寸 + 投放建议）');

  for (const channel of [
    "shareSaveCard: 'share:save-card'",
    "shareCopyCard: 'share:copy-card'"
  ]) {
    if (!ipcSource.includes(channel) || !preloadSource.includes(channel)) {
      fail(`ipc.js/preload.js 缺少 T-45 分享通道: ${channel}`);
    }
  }
  for (const handler of ['shareSaveCard', 'shareCopyCard']) {
    if (!ipcSource.includes(`ipcMain.handle(CHANNELS.${handler}`)) {
      fail(`ipc.js 未注册 ${handler} 处理器`);
    }
  }
  if (!preloadSource.includes('share: {')) {
    fail('preload.js 缺少 petAPI.share 命名空间');
  }
  for (const token of [
    'share.saveCard',
    'share.copyCard',
    'generateShareCard',
    'sanitizeShareText',
    'attachMessageShareGesture'
  ]) {
    if (!rendererChatSource.includes(token)) {
      fail(`renderer/chat.js 缺少 T-45 分享逻辑: ${token}`);
    }
  }
  for (const id of ['share-btn', 'share-menu', 'share-save', 'share-copy']) {
    if (!rendererIndexSource.includes(`id="${id}"`)) {
      fail(`renderer/index.html 缺少分享控件: ${id}`);
    }
  }
  for (const token of [
    'sk-[A-Za-z0-9_-]{8,}',
    'api[_-]?key',
    '[A-Za-z]:\\\\',
    'maskedText',
    'maskedPath'
  ]) {
    if (!rendererChatSource.includes(token)) {
      fail(`renderer/chat.js 脱敏逻辑缺少: ${token}`);
    }
  }
  pass('T-45 分享通道 IPC/preload/渲染层接线与脱敏字段齐全');

  const shareLocaleKeys = [
    'title',
    'saveCard',
    'copyCard',
    'generating',
    'saved',
    'copied',
    'error',
    'noMessages',
    'unmasked',
    'saveDialogTitle',
    'saveDialogDefaultName',
    'cardFooter',
    'maskedText',
    'maskedPath'
  ];
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of shareLocaleKeys) {
      if (
        !locale.share ||
        typeof locale.share[key] !== 'string' ||
        !locale.share[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 share.${key} 文案`);
      }
    }
  }
  pass('T-45 分享双语文案齐全（zh-CN/en）');

  try {
    const ipcModule = require(path.join(root, 'src', 'main', 'ipc.js'));
    if (typeof ipcModule.decodeSharePng !== 'function') {
      fail('ipc.js 未导出 decodeSharePng');
    }
    // 1×1 透明 PNG，验证合法输入可解码且魔数校验通过
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const decoded = ipcModule.decodeSharePng(
      `data:image/png;base64,${tinyPng.toString('base64')}`
    );
    if (!Buffer.isBuffer(decoded) || decoded.length !== tinyPng.length) {
      fail('decodeSharePng 解码结果异常');
    }
    for (const bad of [
      'data:text/html;base64,xxx',
      'data:image/png;base64,AAAA',
      'sk-1234567890',
      ''
    ]) {
      let rejected = false;
      try {
        ipcModule.decodeSharePng(bad);
      } catch (_error) {
        rejected = true;
      }
      if (!rejected) {
        fail(`decodeSharePng 未拒绝非法输入: ${bad}`);
      }
    }
    if (ipcModule.sanitizeShareFileName('a/b*c?.png', 'fallback') !== 'a-b-c-.png') {
      fail('sanitizeShareFileName 清洗结果异常');
    }
    if (ipcModule.sanitizeShareFileName('', 'fallback') !== 'fallback') {
      fail('sanitizeShareFileName 空值未回退默认名');
    }
    pass('T-45 分享 PNG 校验与文件名清洗运行时断言通过');
  } catch (error) {
    fail(`T-45 分享校验检查异常: ${error && error.message ? error.message : error}`);
  }

  // T-55：宠物浮窗（Codex Pets 式独立悬浮宠物 + 宠物包导入，ADR-044）
  const petOverlaySource = fs.readFileSync(
    path.join(root, 'src', 'main', 'pet-overlay.js'),
    'utf8'
  );
  const overlayHtmlSource = fs.readFileSync(
    path.join(root, 'src', 'renderer', 'overlay.html'),
    'utf8'
  );
  const overlayJsSource = fs.readFileSync(
    path.join(root, 'src', 'renderer', 'overlay.js'),
    'utf8'
  );
  const overlayCssSource = fs.readFileSync(
    path.join(root, 'src', 'renderer', 'overlay.css'),
    'utf8'
  );
  const traySource = fs.readFileSync(
    path.join(root, 'src', 'main', 'tray.js'),
    'utf8'
  );
  const skinStoreSource = fs.readFileSync(
    path.join(root, 'src', 'main', 'skin-store.js'),
    'utf8'
  );
  const storeSource = fs.readFileSync(
    path.join(root, 'src', 'storage', 'store.js'),
    'utf8'
  );

  for (const token of [
    'pet:get-status',
    'pet:set-status',
    'pet:get-skin',
    'pet:toggle-overlay',
    'pet:set-enabled',
    'pet:tuck-away',
    'pet:refresh-skin',
    'pet:skin-updated'
  ]) {
    if (!preloadSource.includes(token)) {
      fail(`preload.js 缺少宠物浮窗通道 ${token}`);
    }
  }
  if (!preloadSource.includes('petOverlay')) {
    fail('preload.js 缺少 petAPI.petOverlay 暴露');
  }
  if (!mainSource.includes("require('./pet-overlay')")) {
    fail('main.js 未接入 pet-overlay 模块');
  }
  if (!mainSource.includes('petOverlayEnabled === true')) {
    fail('main.js 未按设置自动显示宠物浮窗');
  }
  if (!traySource.includes('togglePetOverlay')) {
    fail('tray.js 未接入宠物浮窗切换');
  }
  if (!rendererIndexSource.includes('id="pet-overlay-enabled"')) {
    fail('index.html 缺少宠物浮窗开关');
  }
  if (!rendererIndexSource.includes('id="pet-overlay-toggle-btn"')) {
    fail('index.html 缺少显示/隐藏宠物入口');
  }
  if (!rendererChatSource.includes('reportPetStatus')) {
    fail('chat.js 缺少宠物浮窗状态上报');
  }
  if (!rendererChatSource.includes('\\/pet\\b')) {
    fail('chat.js 缺少 /pet 命令');
  }
  if (!overlayJsSource.includes('getStatus') || !overlayJsSource.includes('getSkin')) {
    fail('overlay.js 缺少状态/皮肤读取');
  }
  if (!overlayJsSource.includes('tuckAway')) {
    fail('overlay.js 缺少收起草宠交互');
  }
  if (!overlayCssSource.includes('pet-row-working')) {
    fail('overlay.css 缺少工作状态动画');
  }
  if (
    !overlayHtmlSource.includes('id="overlay-bubble"') ||
    !overlayHtmlSource.includes('id="overlay-pet"')
  ) {
    fail('overlay.html 缺少浮窗结构');
  }
  if (
    !skinStoreSource.includes('PET_MANIFEST_NAME') ||
    !skinStoreSource.includes('parsePetManifest')
  ) {
    fail('skin-store.js 未支持 Codex 宠物包（pet.json）');
  }
  if (!skinStoreSource.includes("'.webp'")) {
    fail('skin-store.js 未允许 .webp 资源');
  }
  if (!storeSource.includes('petOverlayEnabled')) {
    fail('store.js 缺少 petOverlayEnabled 设置字段');
  }

  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of [
      'tuckAway',
      'statusIdle',
      'statusWorking',
      'statusReady',
      'statusFailed'
    ]) {
      if (
        !locale.overlay ||
        typeof locale.overlay[key] !== 'string' ||
        !locale.overlay[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 overlay.${key} 文案`);
      }
    }
    for (const key of ['petOverlay', 'petOverlayHint', 'petOverlayToggle']) {
      if (
        !locale.settings ||
        typeof locale.settings[key] !== 'string' ||
        !locale.settings[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 settings.${key} 文案`);
      }
    }
    if (
      !locale.skin ||
      typeof locale.skin.animated !== 'string' ||
      !locale.skin.animated.trim()
    ) {
      fail(`${localeFile}.json 缺少 skin.animated 文案`);
    }
    if (
      !locale.tray ||
      typeof locale.tray.showPet !== 'string' ||
      typeof locale.tray.hidePet !== 'string'
    ) {
      fail(`${localeFile}.json 缺少 tray.showPet/hidePet 文案`);
    }
  }
  pass('T-55 宠物浮窗静态断言通过');

  // T-55 运行时：WebP 尺寸解析 + Codex 宠物包导入/非法图集拒绝
  try {
    const skinStoreModule = require(path.join(root, 'src', 'main', 'skin-store.js'));
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.writeUInt32LE(22, 4);
    webp.write('WEBP', 8, 'ascii');
    webp.write('VP8X', 12, 'ascii');
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(1535, 24, 3);
    webp.writeUIntLE(1871, 27, 3);
    const dims = skinStoreModule.parseWebpSize(webp);
    if (!dims || dims.width !== 1536 || dims.height !== 1872) {
      fail(`parseWebpSize 解析异常: ${JSON.stringify(dims)}`);
    }
    const petTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-check-'));
    const petDir = path.join(petTmp, 'pkg');
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, 'pet.json'),
      JSON.stringify({
        id: 'check-pet',
        displayName: 'Check Pet',
        description: 'check',
        spritesheetPath: 'spritesheet.webp'
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(petDir, 'spritesheet.webp'), webp);
    const petStore = skinStoreModule.createSkinStore({
      baseDir: path.join(petTmp, 'skins'),
      defaultsDir: path.join(petTmp, 'defaults')
    });
    const imported = petStore.importPack(petDir);
    if (
      !imported ||
      imported.kind !== 'atlas' ||
      !imported.atlas ||
      imported.atlas.cols !== 8 ||
      imported.atlas.rows !== 9 ||
      !imported.spritesheetDataUrl.startsWith('data:image/webp;base64,')
    ) {
      fail('Codex 宠物包导入结果异常');
    }
    const badWebp = Buffer.from(webp);
    badWebp.writeUIntLE(191, 24, 3); // 宽 192 → 单元格 24px，低于下限
    const badDir = path.join(petTmp, 'bad');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(
      path.join(badDir, 'pet.json'),
      JSON.stringify({
        id: 'check-bad',
        displayName: 'Bad',
        description: '',
        spritesheetPath: 'spritesheet.webp'
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(badDir, 'spritesheet.webp'), badWebp);
    let rejected = false;
    try {
      petStore.importPack(badDir);
    } catch (_error) {
      rejected = true;
    }
    if (!rejected) {
      fail('非法图集未被拒绝');
    }
    fs.rmSync(petTmp, { recursive: true, force: true });
    pass('T-55 WebP 解析与 Codex 宠物包导入/拒绝运行时通过');
  } catch (error) {
    fail(`T-55 宠物包运行时检查异常: ${error && error.message ? error.message : error}`);
  }

  // T-58：情绪与动画联动（mood → waving/jumping + reduceMotion 同步 + waiting 行）
  for (const token of [
    'MOOD_POLL_MS',
    'mood.get',
    '__overlayTest',
    'reduceMotion'
  ]) {
    if (!overlayJsSource.includes(token)) {
      fail(`overlay.js 缺少 T-58 接线：${token}`);
    }
  }
  if (!/MOOD_POLL_MS\s*=\s*3000/.test(overlayJsSource)) {
    fail('overlay.js 情绪轮询间隔不是 3000ms');
  }
  for (const [token, label] of [
    [/waiting:\s*6/, 'waiting 行 6'],
    [/working:\s*7/, 'working 行 7'],
    [/ready:\s*8/, 'ready 行 8'],
    [/excited:\s*4/, 'excited 行 4'],
    [/happy:\s*3/, 'happy 行 3'],
    [/sad:\s*5/, 'sad 行 5']
  ]) {
    if (!token.test(overlayJsSource)) {
      fail(`overlay.js 行映射表缺少 ${label}`);
    }
  }
  for (const token of [
    'pet-row-waving',
    'pet-row-jumping',
    'pet-row-waiting',
    'pet-row-sad',
    'data-reduce-motion'
  ]) {
    if (!overlayCssSource.includes(token)) {
      fail(`overlay.css 缺少 T-58 动画/规则：${token}`);
    }
  }
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of ['moodExcited', 'statusWaiting']) {
      if (
        !locale.overlay ||
        typeof locale.overlay[key] !== 'string' ||
        !locale.overlay[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 overlay.${key} 文案`);
      }
    }
  }
  pass('T-58 情绪与动画联动静态断言通过');

  // T-57：状态机与气泡队列（speaking/attention + 队列 + 提醒透出，ADR-045）
  if (
    !petOverlaySource.includes("'speaking'") ||
    !petOverlaySource.includes("'attention'")
  ) {
    fail('pet-overlay.js 未扩展 speaking/attention 状态');
  }
  if (!petOverlaySource.includes('MAX_BUBBLE_QUEUE')) {
    fail('pet-overlay.js 缺少气泡队列上限');
  }
  if (!petOverlaySource.includes('pet:push-bubble')) {
    fail('pet-overlay.js 缺少 pet:push-bubble 通道');
  }
  if (
    !preloadSource.includes('pet:push-bubble') ||
    !preloadSource.includes('pushBubble')
  ) {
    fail('preload.js 缺少 pushBubble 暴露');
  }
  if (
    !overlayJsSource.includes('speaking: 3') ||
    !overlayJsSource.includes('attention: 6')
  ) {
    fail('overlay.js 缺少 speaking/attention 动画行映射');
  }
  if (!overlayJsSource.includes('bubbleEnabled')) {
    fail('overlay.js 未接入气泡显示开关');
  }
  if (!mainSource.includes('petOverlayApi.pushBubble')) {
    fail('main.js 未把空闲互动透出到浮窗');
  }
  if (
    !rendererChatSource.includes("reportPetStatus('speaking')") ||
    !rendererChatSource.includes("reportPetStatus('idle')")
  ) {
    fail('chat.js 缺少 TTS speaking/idle 状态上报');
  }
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of ['statusSpeaking', 'statusAttention']) {
      if (
        !locale.overlay ||
        typeof locale.overlay[key] !== 'string' ||
        !locale.overlay[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 overlay.${key} 文案`);
      }
    }
  }
  pass('T-57 状态机与气泡队列静态断言通过');

  // T-56：浮窗交互增强（showMain/右键菜单/Esc/贴边吸附，ADR-045）
  if (
    !preloadSource.includes('pet:show-main') ||
    !preloadSource.includes('pet:toggle-main')
  ) {
    fail('preload.js 缺少 pet:show-main / pet:toggle-main 通道');
  }
  if (
    !preloadSource.includes('showMain:') ||
    !preloadSource.includes('toggleMain:')
  ) {
    fail('preload.js 缺少 petAPI.petOverlay.showMain/toggleMain');
  }
  if (
    !petOverlaySource.includes('showContextMenu') ||
    !petOverlaySource.includes('OVERLAY_DOCK_MARGIN')
  ) {
    fail('pet-overlay.js 缺少右键菜单/贴边吸附实现');
  }
  if (
    !petOverlaySource.includes('showMainWindow') ||
    !petOverlaySource.includes('toggleMainWindow')
  ) {
    fail('pet-overlay.js 未注入主窗口回调');
  }
  if (!mainSource.includes('toggleMainWindow,')) {
    fail('main.js 未把 toggleMainWindow 传给浮窗');
  }
  if (!overlayJsSource.includes("'dblclick'") || !overlayJsSource.includes('Escape')) {
    fail('overlay.js 缺少双击唤起/Esc 收起');
  }
  if (
    !overlayJsSource.includes('moveBy') ||
    !overlayJsSource.includes('pointerdown')
  ) {
    fail('overlay.js 缺少手动拖拽（moveBy/pointerdown）');
  }
  if (overlayCssSource.includes('-webkit-app-region: drag')) {
    fail('overlay.css 仍在宠物区域使用拖拽区（会吞掉点击/双击）');
  }
  if (
    !preloadSource.includes('pet:move-window') ||
    !preloadSource.includes('moveBy:')
  ) {
    fail('preload.js 缺少 pet:move-window/moveBy');
  }
  if (!petOverlaySource.includes('pet:move-window')) {
    fail('pet-overlay.js 缺少 pet:move-window 处理器');
  }
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of ['menuShowMain', 'menuToggleBubble', 'menuTuckAway', 'menuQuit']) {
      if (
        !locale.overlay ||
        typeof locale.overlay[key] !== 'string' ||
        !locale.overlay[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 overlay.${key} 文案`);
      }
    }
  }
  pass('T-56 浮窗交互增强静态断言通过');


  // T-60：系统与性能（多显示器/事件推送/隐藏暂停，ADR-045）
  if (
    !petOverlaySource.includes('pet:status-updated') ||
    !petOverlaySource.includes('pet:get-overlay-state')
  ) {
    fail('pet-overlay.js 缺少状态事件/完整状态通道');
  }
  if (!petOverlaySource.includes('getAllDisplays')) {
    fail('pet-overlay.js 未做多显示器存在性校验');
  }
  if (!petOverlaySource.includes('notifyStatus')) {
    fail('pet-overlay.js 未实现状态变更推送');
  }
  if (
    !preloadSource.includes('pet:status-updated') ||
    !preloadSource.includes('pet:get-overlay-state') ||
    !preloadSource.includes('onStatusUpdated') ||
    !preloadSource.includes('getOverlayState')
  ) {
    fail('preload.js 缺少 T-60 事件/状态暴露');
  }
  if (
    !overlayJsSource.includes('STATUS_HEARTBEAT_MS = 5000') ||
    !overlayJsSource.includes('visibilitychange') ||
    !overlayJsSource.includes('is-paused') ||
    !overlayJsSource.includes('onStatusUpdated')
  ) {
    fail('overlay.js 缺少心跳/隐藏暂停/事件订阅');
  }
  if (!overlayCssSource.includes('is-paused')) {
    fail('overlay.css 缺少暂停动画样式');
  }
  pass('T-60 系统与性能静态断言通过');

  // T-61：设置与引导（浮窗设置块 + 首次开启引导气泡，ADR-045）
  if (
    !rendererIndexSource.includes('id="pet-overlay-bubble-enabled"') ||
    !rendererIndexSource.includes('id="pet-overlay-bubble-seconds"') ||
    !rendererIndexSource.includes('id="pet-overlay-reminders"')
  ) {
    fail('index.html 缺少浮窗设置控件');
  }
  if (
    !rendererChatSource.includes('persistPetOverlayConfig') ||
    !rendererChatSource.includes('maybeGuidePetOverlay') ||
    !rendererChatSource.includes('petOverlayGuided') ||
    !rendererChatSource.includes('petOverlayBubbleSeconds')
  ) {
    fail('chat.js 缺少浮窗配置保存/引导逻辑');
  }
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of [
      'petOverlayBubble',
      'petOverlayBubbleHint',
      'petOverlayBubbleSeconds',
      'petOverlayBubbleSecondsHint',
      'petOverlayReminders',
      'petOverlayRemindersHint'
    ]) {
      if (
        !locale.settings ||
        typeof locale.settings[key] !== 'string' ||
        !locale.settings[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 settings.${key} 文案`);
      }
    }
    if (
      !locale.overlay ||
      typeof locale.overlay.firstTimeHint !== 'string' ||
      !locale.overlay.firstTimeHint.trim()
    ) {
      fail(`${localeFile}.json 缺少 overlay.firstTimeHint 文案`);
    }
  }
  pass('T-61 设置与引导静态断言通过');



  // T-59：皮肤体验（Codex pets 目录扫描导入 + 9 行状态预览 + 错误可读化）
  if (
    !ipcSource.includes("skinImportCodexPets: 'skin:import-codepets'") ||
    !preloadSource.includes("skinImportCodexPets: 'skin:import-codepets'")
  ) {
    fail('ipc.js/preload.js 缺少 skin:import-codepets 通道定义');
  }
  if (!ipcSource.includes('ipcMain.handle(CHANNELS.skinImportCodexPets')) {
    fail('ipc.js 未注册 skinImportCodexPets 处理器');
  }
  if (!preloadSource.includes('importCodexPets:')) {
    fail('preload.js 缺少 petAPI.skin.importCodexPets 暴露');
  }
  for (const token of [
    'scanCodexPetsDir',
    'defaultCodexPetsDir',
    'CODEX_HOME',
    'node_modules'
  ]) {
    if (!skinStoreSource.includes(token)) {
      fail(`skin-store.js 缺少 T-59 目录扫描实现: ${token}`);
    }
  }
  for (const token of [
    'skin-codex-import-btn',
    'handleSkinCodexImport',
    'groupSkinImportFailures',
    'skin-preview-atlas-rows',
    'skin-preview-atlas-row'
  ]) {
    if (!rendererChatSource.includes(token)) {
      fail(`renderer/chat.js 缺少 T-59 接线: ${token}`);
    }
  }
  for (const token of ['.skin-preview-atlas-rows', '.skin-preview-atlas-row', 'pet-row-strip']) {
    if (!rendererChatCssSource.includes(token)) {
      fail(`renderer/chat.css 缺少 T-59 预览条样式: ${token}`);
    }
  }
  const skinT59LocaleKeys = [
    'scanCodexPets',
    'scanCodexPetsSuccess',
    'scanCodexPetsError',
    'scanCodexPetsNone',
    'previewRowIdle',
    'previewRowWaiting',
    'previewRowWorking',
    'previewRowReady',
    'previewRowFailed'
  ];
  for (const localeFile of ['zh-CN', 'en']) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(root, 'src', 'shared', 'locales', `${localeFile}.json`),
        'utf8'
      )
    );
    for (const key of skinT59LocaleKeys) {
      if (
        !locale.skin ||
        typeof locale.skin[key] !== 'string' ||
        !locale.skin[key].trim()
      ) {
        fail(`${localeFile}.json 缺少 skin.${key} 文案`);
      }
    }
  }
  pass('T-59 皮肤体验静态断言通过（通道/扫描/预览/错误分组/双语文案）');

  // T-59 运行时：Codex pets 目录扫描批量导入（成功/失败分组/node_modules 跳过）
  try {
    const skinStoreModule = require(path.join(root, 'src', 'main', 'skin-store.js'));
    const petsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-scan-check-'));
    try {
      function makePetPack(dir, id, name) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'pet.json'),
          JSON.stringify({
            id,
            displayName: name,
            description: 'check',
            spritesheetPath: 'spritesheet.webp'
          }),
          'utf8'
        );
        const webp = Buffer.alloc(30);
        webp.write('RIFF', 0, 'ascii');
        webp.writeUInt32LE(22, 4);
        webp.write('WEBP', 8, 'ascii');
        webp.write('VP8X', 12, 'ascii');
        webp.writeUInt32LE(10, 16);
        webp.writeUIntLE(1535, 24, 3);
        webp.writeUIntLE(1871, 27, 3);
        fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp);
      }
      const petsRoot = path.join(petsTmp, 'pets');
      makePetPack(path.join(petsRoot, 'alpha'), 'alpha-pet', 'Alpha');
      makePetPack(path.join(petsRoot, 'beta'), 'beta-pet', 'Beta');
      makePetPack(path.join(petsRoot, 'node_modules', 'evil'), 'evil-node', 'Evil');
      makePetPack(path.join(petsRoot, '.hidden', 'ghost'), 'ghost-pet', 'Ghost');
      const broken = path.join(petsRoot, 'broken');
      fs.mkdirSync(broken, { recursive: true });
      fs.writeFileSync(
        path.join(broken, 'pet.json'),
        JSON.stringify({
          id: 'broken-pet',
          displayName: 'Broken',
          description: '',
          spritesheetPath: 'missing.webp'
        }),
        'utf8'
      );
      const scanStore = skinStoreModule.createSkinStore({
        baseDir: path.join(petsTmp, 'skins'),
        defaultsDir: path.join(petsTmp, 'defaults')
      });
      const scan = scanStore.scanCodexPetsDir(petsRoot);
      const importedIds = scan.imported.map((item) => item.id);
      if (
        importedIds.length !== 2 ||
        !importedIds.includes('alpha-pet') ||
        !importedIds.includes('beta-pet')
      ) {
        fail(`扫描导入结果异常: ${JSON.stringify(importedIds)}`);
      }
      if (importedIds.includes('evil-node') || importedIds.includes('ghost-pet')) {
        fail('扫描不应导入 node_modules/隐藏目录中的宠物包');
      }
      if (
        scan.failed.length !== 1 ||
        scan.failed[0].name !== 'broken' ||
        !String(scan.failed[0].error).includes('spritesheet')
      ) {
        fail(`逐包失败分组异常: ${JSON.stringify(scan.failed)}`);
      }
      const savedCodexHome = process.env.CODEX_HOME;
      const savedHome = process.env.HOME;
      try {
        process.env.CODEX_HOME = path.join(petsTmp, 'codex-home');
        process.env.HOME = path.join(petsTmp, 'home');
        const defDir = skinStoreModule.defaultCodexPetsDir();
        if (defDir !== path.join(petsTmp, 'codex-home', 'pets')) {
          fail(`defaultCodexPetsDir 未优先 CODEX_HOME: ${defDir}`);
        }
        delete process.env.CODEX_HOME;
        if (
          skinStoreModule.defaultCodexPetsDir() !==
          path.join(petsTmp, 'home', '.codex', 'pets')
        ) {
          fail('defaultCodexPetsDir 未回退 HOME/.codex/pets');
        }
      } finally {
        if (savedCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = savedCodexHome;
        }
        if (savedHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = savedHome;
        }
      }
      let missingRejected = false;
      try {
        scanStore.scanCodexPetsDir(path.join(petsTmp, 'no-such-dir'));
      } catch (_error) {
        missingRejected = true;
      }
      if (!missingRejected) {
        fail('扫描不存在的目录未被拒绝');
      }
      pass('T-59 Codex 宠物目录扫描批量导入运行时通过（含失败分组/跳过 node_modules）');
    } finally {
      fs.rmSync(petsTmp, { recursive: true, force: true });
    }
  } catch (error) {
    fail(`T-59 目录扫描运行时检查异常: ${error && error.message ? error.message : error}`);
  }


  console.log('[check] 全部通过');
})();
