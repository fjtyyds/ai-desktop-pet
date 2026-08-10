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
