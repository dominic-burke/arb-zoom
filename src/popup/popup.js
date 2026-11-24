(function initPopup(root) {
  'use strict';

  const { API, CONSTANTS, Math: ZMath } = root.ArbZoom;
  const { MSG, STORAGE_KEYS, DEFAULT_SETTINGS } = CONSTANTS;

  const els = {
    app: document.getElementById('app'),
    siteHost: document.getElementById('siteHost'),
    hyperBadge: document.getElementById('hyperBadge'),
    restrictedBanner: document.getElementById('restrictedBanner'),
    zoomControls: document.getElementById('zoomControls'),
    btnReset: document.getElementById('btnReset'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    zoomInput: document.getElementById('zoomInput'),
    zoomBreakdown: document.getElementById('zoomBreakdown'),
    zoomSlider: document.getElementById('zoomSlider'),
    presets: document.getElementById('presets'),
    modeGroup: document.getElementById('modeGroup'),
    modeOptical: document.getElementById('modeOptical'),
    modeHybrid: document.getElementById('modeHybrid'),
    togglePan: document.getElementById('togglePan'),
    togglePixelated: document.getElementById('togglePixelated'),
    toggleHud: document.getElementById('toggleHud'),
    toggleRemember: document.getElementById('toggleRemember'),
    selectWheelTrigger: document.getElementById('selectWheelTrigger'),
    selectStepFactor: document.getElementById('selectStepFactor'),
    checkMagneticSnap: document.getElementById('checkMagneticSnap'),
    checkOverrideCtrl: document.getElementById('checkOverrideCtrl'),
  };

  let activeTabId = null;
  let contentAvailable = false;
  let currentState = {
    totalScale: 1,
    nativeZoom: 1,
    cssScale: 1,
    panMode: false,
    mode: 'optical',
  };
  let settings = { ...DEFAULT_SETTINGS };
  let isEditingInput = false;
  let isSliding = false;
  let sliderMoved = false;
  let sliderRafId = null;
  let tabRequestSeq = 0;
  let settingsWriteQueue = Promise.resolve();

  async function loadSettings() {
    if (!API.isExtensionContext) return;
    try {
      const stored = await API.storage.get(STORAGE_KEYS.SETTINGS);
      settings = { ...DEFAULT_SETTINGS, ...(stored?.[STORAGE_KEYS.SETTINGS] || {}) };
    } catch (_) {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettingsPatch(patch) {
    const modeChanged = 'mode' in patch && patch.mode !== settings.mode;
    settings = { ...settings, ...patch };
    renderSettings();

    if (!API.isExtensionContext) {
      if (modeChanged) {
        const split = ZMath.splitHybridZoom(currentState.totalScale, settings.mode);
        currentState.nativeZoom = split.nativeZoom;
        currentState.cssScale = split.cssScale;
        currentState.mode = settings.mode;
      }
      renderState();
      return Promise.resolve();
    }

    settingsWriteQueue = settingsWriteQueue
      .catch(() => {})
      .then(async () => {
        const stored = await API.storage.get(STORAGE_KEYS.SETTINGS);
        const merged = {
          ...DEFAULT_SETTINGS,
          ...(stored?.[STORAGE_KEYS.SETTINGS] || {}),
          ...patch,
        };
        settings = merged;
        await API.storage.set({ [STORAGE_KEYS.SETTINGS]: merged });
      })
      .catch(() => {});

    if (modeChanged && contentAvailable) {
      return settingsWriteQueue.then(() =>
        sendToTab({ type: MSG.UPDATE_SETTINGS, settings })
      );
    }

    if (modeChanged) {
      renderState();
    }
    return settingsWriteQueue;
  }

  async function sendToTab(message) {
    if (!API.isExtensionContext || typeof activeTabId !== 'number') return null;
    const seq = ++tabRequestSeq;
    try {
      const res = await API.tabs.sendMessage(activeTabId, message);
      if (res?.state && seq === tabRequestSeq) {
        currentState = res.state;
        renderState();
      }
      return res;
    } catch (_) {
      return null;
    }
  }

  function renderSettings() {
    const isOptical = settings.mode !== 'hybrid';
    els.modeOptical.classList.toggle('active', isOptical);
    els.modeOptical.setAttribute('aria-checked', String(isOptical));
    els.modeOptical.setAttribute('tabindex', isOptical ? '0' : '-1');
    els.modeHybrid.classList.toggle('active', !isOptical);
    els.modeHybrid.setAttribute('aria-checked', String(!isOptical));
    els.modeHybrid.setAttribute('tabindex', !isOptical ? '0' : '-1');

    const hudOn = Boolean(settings.showHud);
    els.toggleHud.classList.toggle('active', hudOn);
    els.toggleHud.setAttribute('aria-pressed', String(hudOn));

    const remOn = Boolean(settings.rememberPerSite);
    els.toggleRemember.classList.toggle('active', remOn);
    els.toggleRemember.setAttribute('aria-pressed', String(remOn));

    const pixOn = Boolean(settings.pixelated);
    els.togglePixelated.classList.toggle('active', pixOn);
    els.togglePixelated.setAttribute('aria-pressed', String(pixOn));

    els.selectWheelTrigger.value = settings.wheelTrigger || 'both';
    els.selectStepFactor.value = String(settings.stepFactor || 1.25);
    els.checkMagneticSnap.checked = Boolean(settings.magneticSnap);
    els.checkOverrideCtrl.checked = Boolean(settings.overrideCtrlKeys);
  }

  function renderState() {
    const scale = currentState.totalScale || 1;
    const isHyper = scale > 5.001;
    const formatted = ZMath.formatPercent(scale);

    els.app.classList.toggle('is-hyper', isHyper);
    els.hyperBadge.hidden = !isHyper;

    if (!isEditingInput) {
      els.zoomInput.value = formatted;
    }

    const outOfRange = scale > CONSTANTS.SLIDER_MAX_SCALE + 1e-4 || scale < CONSTANTS.SLIDER_MIN_SCALE - 1e-4;
    els.zoomSlider.classList.toggle('out-of-range', outOfRange);
    els.zoomSlider.setAttribute('aria-valuetext', formatted);
    if (!isSliding) {
      els.zoomSlider.value = String(ZMath.scaleToSlider(scale));
      sliderMoved = false;
    }

    if (settings.mode === 'hybrid') {
      const n = (currentState.nativeZoom || 1).toFixed(2);
      const c = (currentState.cssScale || 1).toFixed(2);
      els.zoomBreakdown.textContent = `Hybrid: Native ${n}× · Optical ${c}×`;
    } else {
      const mult = scale >= 100 ? Math.round(scale).toLocaleString('en-US') : scale.toFixed(2);
      els.zoomBreakdown.textContent = outOfRange
        ? `Optical ${mult}× · Beyond slider range`
        : `Optical ${mult}× · Type any %`;
    }

    const panOn = Boolean(currentState.panMode);
    els.togglePan.classList.toggle('active', panOn);
    els.togglePan.setAttribute('aria-pressed', String(panOn));

    const chips = els.presets.querySelectorAll('.preset-chip');
    chips.forEach((chip) => {
      const chipScale = parseFloat(chip.dataset.scale);
      const match = Math.abs(chipScale - scale) / Math.max(1, chipScale) < 0.015;
      chip.classList.toggle('active', match);
      chip.setAttribute('aria-pressed', String(match));
    });
  }

  function setRestrictedMode(isRestricted) {
    contentAvailable = !isRestricted;
    els.restrictedBanner.hidden = !isRestricted;
    els.zoomControls.classList.toggle('disabled', isRestricted);
    els.zoomControls.inert = isRestricted;
    els.zoomControls.querySelectorAll('button, input').forEach((ctrl) => {
      ctrl.disabled = isRestricted;
    });
    els.togglePan.disabled = isRestricted;
    els.btnReset.disabled = isRestricted;
    renderState();
  }

  async function init() {
    await loadSettings();
    renderSettings();

    if (API.storage.onChanged) {
      API.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[STORAGE_KEYS.SETTINGS]?.newValue) {
          settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEYS.SETTINGS].newValue };
          renderSettings();
          renderState();
        }
      });
    }

    if (!API.isExtensionContext) {
      // Standalone preview mode (e.g., opened directly in browser for UI inspection)
      els.siteHost.textContent = 'preview.local';
      setRestrictedMode(false);
      return;
    }

    try {
      const tabs = await API.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      if (!tab || typeof tab.id !== 'number') {
        setRestrictedMode(true);
        return;
      }

      activeTabId = tab.id;
      if (tab.url) {
        try {
          const parsed = new URL(tab.url);
          els.siteHost.textContent = parsed.hostname || parsed.protocol.replace(':', '');
        } catch (_) {
          els.siteHost.textContent = 'Active tab';
        }
      }

      // Note: Do NOT clobber settings loaded from storage.local with res.state.settings
      const res = await sendToTab({ type: MSG.GET_STATE });
      if (res && res.ok && res.state) {
        setRestrictedMode(false);
      } else {
        setRestrictedMode(true);
      }
    } catch (_) {
      setRestrictedMode(true);
    }
  }

  // Event bindings
  els.btnZoomIn.addEventListener('click', () => {
    if (!contentAvailable) return;
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.STEP_ZOOM, direction: 1 });
    } else {
      currentState.totalScale = ZMath.clampScale(currentState.totalScale * (settings.stepFactor || 1.25));
      const split = ZMath.splitHybridZoom(currentState.totalScale, settings.mode);
      currentState.nativeZoom = split.nativeZoom;
      currentState.cssScale = split.cssScale;
      renderState();
    }
  });

  els.btnZoomOut.addEventListener('click', () => {
    if (!contentAvailable) return;
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.STEP_ZOOM, direction: -1 });
    } else {
      currentState.totalScale = ZMath.clampScale(currentState.totalScale / (settings.stepFactor || 1.25));
      const split = ZMath.splitHybridZoom(currentState.totalScale, settings.mode);
      currentState.nativeZoom = split.nativeZoom;
      currentState.cssScale = split.cssScale;
      renderState();
    }
  });

  els.btnReset.addEventListener('click', () => {
    if (!contentAvailable) return;
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.RESET_ZOOM });
    } else {
      currentState.totalScale = 1;
      currentState.cssScale = 1;
      currentState.nativeZoom = 1;
      currentState.panMode = false;
      renderState();
    }
  });

  els.zoomSlider.addEventListener('pointerdown', () => {
    isSliding = true;
    sliderMoved = false;
  });

  const endSlide = () => {
    isSliding = false;
  };
  els.zoomSlider.addEventListener('pointerup', endSlide);
  els.zoomSlider.addEventListener('pointercancel', endSlide);
  els.zoomSlider.addEventListener('blur', endSlide);

  els.zoomSlider.addEventListener('input', () => {
    if (!contentAvailable) return;
    sliderMoved = true;
    const scale = ZMath.sliderToScale(Number(els.zoomSlider.value));
    els.zoomSlider.setAttribute('aria-valuetext', ZMath.formatPercent(scale));
    if (!isEditingInput) {
      els.zoomInput.value = ZMath.formatPercent(scale);
    }

    if (!API.isExtensionContext) {
      currentState.totalScale = scale;
      const split = ZMath.splitHybridZoom(scale, settings.mode);
      currentState.nativeZoom = split.nativeZoom;
      currentState.cssScale = split.cssScale;
      renderState();
      return;
    }

    if (sliderRafId) return;
    sliderRafId = requestAnimationFrame(() => {
      sliderRafId = null;
      const latestScale = ZMath.sliderToScale(Number(els.zoomSlider.value));
      sendToTab({ type: MSG.SET_ZOOM, scale: latestScale, snap: false, immediateNative: false });
    });
  });

  els.zoomSlider.addEventListener('change', () => {
    isSliding = false;
    if (!contentAvailable || !sliderMoved) return;
    sliderMoved = false;
    if (sliderRafId) {
      cancelAnimationFrame(sliderRafId);
      sliderRafId = null;
    }
    const scale = ZMath.sliderToScale(Number(els.zoomSlider.value));
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.SET_ZOOM, scale, snap: false, immediateNative: true });
    }
  });

  els.zoomInput.addEventListener('focus', () => {
    isEditingInput = true;
    els.zoomInput.classList.remove('invalid');
    els.zoomInput.removeAttribute('aria-invalid');
    els.zoomInput.select();
    els.zoomInput.addEventListener('mouseup', (e) => e.preventDefault(), { once: true });
  });

  els.zoomInput.addEventListener('input', () => {
    els.zoomInput.classList.remove('invalid');
    els.zoomInput.removeAttribute('aria-invalid');
  });

  els.zoomInput.addEventListener('blur', () => {
    isEditingInput = false;
    els.zoomInput.classList.remove('invalid');
    els.zoomInput.removeAttribute('aria-invalid');
    renderState();
  });

  els.zoomInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const parsed = ZMath.parseZoomInput(els.zoomInput.value);
      if (parsed === null) {
        els.zoomInput.classList.add('invalid');
        els.zoomInput.setAttribute('aria-invalid', 'true');
        return;
      }
      els.zoomInput.classList.remove('invalid');
      els.zoomInput.removeAttribute('aria-invalid');

      if (contentAvailable) {
        if (API.isExtensionContext) {
          await sendToTab({ type: MSG.SET_ZOOM, scale: parsed, snap: false, immediateNative: true });
        } else {
          currentState.totalScale = parsed;
          const split = ZMath.splitHybridZoom(parsed, settings.mode);
          currentState.nativeZoom = split.nativeZoom;
          currentState.cssScale = split.cssScale;
          renderState();
        }
      }
      els.zoomInput.blur();
    } else if (e.key === 'Escape') {
      // Prevent Escape from closing the entire browser extension popup
      e.preventDefault();
      els.zoomInput.blur();
    }
  });

  els.presets.addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip || chip.disabled || !contentAvailable) return;
    const scale = parseFloat(chip.dataset.scale);
    if (!Number.isFinite(scale)) return;
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.SET_ZOOM, scale, snap: false, immediateNative: true });
    } else {
      currentState.totalScale = scale;
      const split = ZMath.splitHybridZoom(scale, settings.mode);
      currentState.nativeZoom = split.nativeZoom;
      currentState.cssScale = split.cssScale;
      renderState();
    }
  });

  [els.modeOptical, els.modeHybrid].forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSettingsPatch({ mode: btn.dataset.mode });
    });
  });

  // WAI-ARIA radiogroup arrow-key navigation
  els.modeGroup?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextMode = settings.mode === 'hybrid' ? 'optical' : 'hybrid';
      saveSettingsPatch({ mode: nextMode });
      const targetBtn = nextMode === 'hybrid' ? els.modeHybrid : els.modeOptical;
      targetBtn.focus();
    }
  });

  els.togglePan.addEventListener('click', () => {
    if (!contentAvailable) return;
    const next = !currentState.panMode;
    if (API.isExtensionContext) {
      sendToTab({ type: MSG.SET_PAN_MODE, enabled: next });
    } else {
      currentState.panMode = next;
      renderState();
    }
  });

  els.togglePixelated.addEventListener('click', () => {
    saveSettingsPatch({ pixelated: !settings.pixelated });
  });

  els.toggleHud.addEventListener('click', () => {
    saveSettingsPatch({ showHud: !settings.showHud });
  });

  els.toggleRemember.addEventListener('click', () => {
    saveSettingsPatch({ rememberPerSite: !settings.rememberPerSite });
  });

  els.selectWheelTrigger.addEventListener('change', () => {
    saveSettingsPatch({ wheelTrigger: els.selectWheelTrigger.value });
  });

  els.selectStepFactor.addEventListener('change', () => {
    saveSettingsPatch({ stepFactor: parseFloat(els.selectStepFactor.value) || 1.25 });
  });

  els.checkMagneticSnap.addEventListener('change', () => {
    saveSettingsPatch({ magneticSnap: els.checkMagneticSnap.checked });
  });

  els.checkOverrideCtrl.addEventListener('change', () => {
    saveSettingsPatch({ overrideCtrlKeys: els.checkOverrideCtrl.checked });
  });

  init();
})(typeof globalThis !== 'undefined' ? globalThis : self);
