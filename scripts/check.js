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
      const refMatch = line.match(/^\s*(?:url|path):\s*(.+?)\s*$/);
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
