'use strict';

/**
 * T-55：宠物浮窗渲染层（Codex Pets 式）。
 * - 轮询主进程状态（idle/working/ready/failed）并显示气泡；
 * - 当前皮肤为 Codex 宠物包（spritesheet.webp）时按状态切换动画行；
 * - 普通皮肤显示静态角色图；
 * - ready/failed 气泡 6 秒后自动回到 idle。
 */
(async function initOverlay() {
  await window.PetLocales.ready;

  const bubble = document.getElementById('overlay-bubble');
  const pet = document.getElementById('overlay-pet');
  const tuckBtn = document.getElementById('overlay-tuck');

  const STATE_ROWS = { idle: 0, working: 7, ready: 8, failed: 5 };
  let currentLocale = window.PetLocales.DEFAULT_LOCALE;
  let skin = null;
  let skinAtlas = null;
  let currentState = 'idle';
  let localText = '';
  let revertTimer = null;

  function t(key, params) {
    return window.PetLocales.createTranslator(currentLocale)(key, params);
  }

  async function loadLocale() {
    try {
      const settings = await window.petAPI.settings.get();
      const language =
        settings && typeof settings.language === 'string'
          ? settings.language
          : 'system';
      currentLocale =
        language === 'system'
          ? window.PetLocales.resolveLocale(navigator.language || '')
          : window.PetLocales.resolveLocale(language);
    } catch (_error) {
      currentLocale = window.PetLocales.resolveLocale(navigator.language || '');
    }
    document.documentElement.lang = currentLocale;
    tuckBtn.setAttribute('aria-label', t('overlay.tuckAway'));
  }

  function applySkin(next) {
    skin = next || null;
    if (!skin) {
      pet.style.backgroundImage = '';
      pet.classList.remove('is-atlas');
      pet.dataset.atlas = '';
      skinAtlas = null;
      return;
    }
    if (skin.spritesheetDataUrl && skin.atlas) {
      skinAtlas = skin.atlas;
      pet.classList.add('is-atlas');
      pet.style.backgroundImage = `url("${skin.spritesheetDataUrl}")`;
      pet.style.backgroundSize = `${skin.atlas.cols * 100}% ${skin.atlas.rows * 100}%`;
      pet.style.backgroundRepeat = 'no-repeat';
      pet.dataset.atlas = '1';
    } else {
      skinAtlas = null;
      pet.classList.remove('is-atlas');
      pet.dataset.atlas = '';
      pet.style.backgroundImage =
        skin.roleAssets && skin.roleAssets.idle
          ? `url("${skin.roleAssets.idle}")`
          : '';
      pet.style.backgroundSize = 'contain';
      pet.style.backgroundRepeat = 'no-repeat';
    }
    applyState(currentState, localText, true);
  }

  function statusKey(state) {
    return `overlay.status${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  }

  function applyState(state, text, force) {
    const nextState = typeof state === 'string' ? state : 'idle';
    currentState = nextState;
    localText = typeof text === 'string' ? text : '';
    if (skinAtlas) {
      pet.dataset.row = String(STATE_ROWS[nextState] ?? 0);
    }
    pet.dataset.state = nextState;
    const message = localText || t(statusKey(nextState));
    bubble.textContent = message;
    bubble.hidden = !message;
    clearTimeout(revertTimer);
    if (nextState === 'ready' || nextState === 'failed') {
      revertTimer = setTimeout(() => {
        applyState('idle', '', true);
      }, 6000);
    }
  }

  async function pollStatus() {
    try {
      const status = await window.petAPI.petOverlay.getStatus();
      if (status && typeof status.state === 'string') {
        applyState(status.state, status.text || '');
      }
    } catch (_error) {
      // 主进程未就绪时保持当前状态
    }
  }

  async function loadSkin() {
    try {
      const result = await window.petAPI.petOverlay.getSkin();
      if (result && result.ok) {
        applySkin(result.skin);
      }
    } catch (_error) {
      // 皮肤读取失败时浮窗保持透明，不崩溃
    }
  }

  tuckBtn.addEventListener('click', () => {
    void window.petAPI.petOverlay.tuckAway();
  });

  window.petAPI.petOverlay.onSkinUpdated(() => {
    void loadSkin();
  });

  await loadLocale();
  await loadSkin();
  await pollStatus();
  setInterval(pollStatus, 800);
})();
