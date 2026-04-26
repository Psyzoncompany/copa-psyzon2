/**
 * COPA PSYZON — Robust Offline-First Persistence v2
 *
 * MODULAR: saves each data module independently in localStorage
 * PROTECTED: never overwrites valid data with empty/null data
 * RECOVERABLE: assembles state from best available modules
 * VERSIONED: keeps emergency backup + version history (up to 10)
 * SYNCED: uses merge for Firebase (never full-replace)
 * VISUAL: real-time status indicator
 */
(function () {
  'use strict';

  /* ==========================================================
     CONSTANTS
     ========================================================== */
  var LS_FULL_KEY = 'appState_backup';
  var LS_EMERGENCY_KEY = 'copa_emergency';
  var LS_HISTORY_KEY = 'appState_history';
  var LS_MOD_PREFIX = 'copa_mod_';
  var HISTORY_MAX = 10;
  var DEBOUNCE_MS = 800;
  var FB_COLLECTION = 'estado';
  var FB_DOC = 'principal';

  /* ---------- module definitions ---------- */
  var MODULES = [
    { name: 'config',       fields: ['tournamentName', 'teamCount', 'twoLegged', 'prize', 'singleLegFinal', 'tournamentRules'] },
    { name: 'teams',        fields: ['teams'],         arrayField: 'teams' },
    { name: 'bracket',      fields: ['bracket', 'champion', 'tournamentFormat', 'bracketFromGroups'] },
    { name: 'groups',       fields: ['groups', 'groupRepechage', 'groupDirectQualified'], arrayField: 'groups' },
    { name: 'stats',        fields: ['playerStats'],   objectField: 'playerStats' },
    { name: 'codes',        fields: ['codes'],         arrayField: 'codes' },
    { name: 'participants', fields: ['participants'],  arrayField: 'participants' }
  ];

  /* ==========================================================
     STATUS INDICATOR
     ========================================================== */
  var STATUS = {
    SAVING:      'saving',
    SAVED_LOCAL: 'saved_local',
    SYNCED:      'synced',
    OFFLINE:     'offline',
    RECOVERED:   'recovered',
    ERROR:       'error'
  };
  var STATUS_LABELS = {
    saving:      'Salvando...',
    saved_local: 'Salvo localmente',
    synced:      'Sincronizado com servidor',
    offline:     'Modo offline',
    recovered:   'Recuperado automaticamente',
    error:       'Erro ao salvar'
  };
  var STATUS_ICONS = {
    saving:      '\u21BB',
    saved_local: '\uD83D\uDCBE',
    synced:      '\u2601',
    offline:     '\u26A1',
    recovered:   '\u267B',
    error:       '\u26A0'
  };

  var currentStatus = STATUS.SAVED_LOCAL;
  var statusTimeout = null;

  function setStatus(status) {
    currentStatus = status;
    var el = document.getElementById('persistence-status');
    if (!el) return;

    el.className = 'persistence-status persistence-status--' + status;
    var iconEl = el.querySelector('.persistence-status-icon');
    var textEl = el.querySelector('.persistence-status-text');
    if (iconEl) iconEl.textContent = STATUS_ICONS[status] || '';
    if (textEl) textEl.textContent = STATUS_LABELS[status] || '';

    el.classList.add('persistence-status--visible');
    clearTimeout(statusTimeout);

    if (status === STATUS.SYNCED || status === STATUS.SAVED_LOCAL) {
      statusTimeout = setTimeout(function () {
        el.classList.remove('persistence-status--visible');
      }, 3000);
    }
    if (status === STATUS.ERROR) {
      statusTimeout = setTimeout(function () {
        el.classList.remove('persistence-status--visible');
      }, 6000);
    }
  }

  /* ==========================================================
     HELPERS
     ========================================================== */
  function safeParse(str) {
    try {
      var p = JSON.parse(str);
      return (p && typeof p === 'object') ? p : null;
    } catch (_) { return null; }
  }

  function cleanForStorage(obj) {
    return JSON.parse(JSON.stringify(obj, function (_k, v) {
      return v === undefined ? null : v;
    }));
  }

  /** Strip base64 photos to reduce size for emergency/history backups */
  function stripPhotos(obj) {
    return JSON.parse(JSON.stringify(obj, function (k, v) {
      if (k === 'photo' && typeof v === 'string' && v.length > 500) return '[STRIPPED]';
      return v === undefined ? null : v;
    }));
  }

  /** Check if a value is "empty" (null, undefined, '', [], {}) */
  function isFieldEmpty(val) {
    if (val === null || val === undefined || val === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return true;
    return false;
  }

  /* ==========================================================
     VALIDATION
     ========================================================== */
  function isValidAppState(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.version !== 'number' || obj.version < 0) return false;
    if (typeof obj.updatedAt !== 'string' || !obj.updatedAt) return false;
    if (!obj.data || typeof obj.data !== 'object') return false;
    return true;
  }

  /** Raw state must have at least teams OR bracket OR stats to be considered valid */
  function isValidRawState(raw) {
    if (!raw || typeof raw !== 'object') return false;
    var hasTeams   = Array.isArray(raw.teams) && raw.teams.length > 0;
    var hasBracket = raw.bracket && typeof raw.bracket === 'object';
    var hasStats   = raw.playerStats && typeof raw.playerStats === 'object' && Object.keys(raw.playerStats).length > 0;
    return hasTeams || hasBracket || hasStats;
  }

  /** Check whether a module slice contains meaningful data */
  function hasModuleContent(modDef, data) {
    if (!data || typeof data !== 'object') return false;
    for (var i = 0; i < modDef.fields.length; i++) {
      var f = modDef.fields[i];
      var v = data[f];
      if (modDef.arrayField === f) {
        if (Array.isArray(v) && v.length > 0) return true;
      } else if (modDef.objectField === f) {
        if (v && typeof v === 'object' && Object.keys(v).length > 0) return true;
      } else if (v !== null && v !== undefined && v !== '') {
        return true;
      }
    }
    return false;
  }

  /* ==========================================================
     MODULAR LOCAL STORAGE
     ========================================================== */
  function extractModule(modDef, rawState) {
    var out = {};
    for (var i = 0; i < modDef.fields.length; i++) {
      out[modDef.fields[i]] = rawState[modDef.fields[i]];
    }
    return out;
  }

  /** Save one module. Returns true on success. */
  function saveModule(modDef, rawState) {
    try {
      var moduleData = extractModule(modDef, rawState);
      var key = LS_MOD_PREFIX + modDef.name;

      // Removed OVERWRITE PROTECTION because it prevented intentional deletions
      // (like setting state.groupRepechage = null) from being saved to localStorage,
      // causing the old data to resurrect on page reload.

      var payload = { updatedAt: new Date().toISOString(), fields: cleanForStorage(moduleData) };
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('[Persistence] Erro ao salvar modulo "' + modDef.name + '":', err);
      return false;
    }
  }

  /** Load one module from localStorage */
  function loadModule(modDef) {
    try {
      var raw = localStorage.getItem(LS_MOD_PREFIX + modDef.name);
      if (!raw) return null;
      var parsed = safeParse(raw);
      return parsed && parsed.fields ? parsed.fields : parsed;
    } catch (_) { return null; }
  }

  /** Save all modules, returns { moduleName: bool } */
  function saveAllModules(rawState) {
    var results = {};
    for (var i = 0; i < MODULES.length; i++) {
      results[MODULES[i].name] = saveModule(MODULES[i], rawState);
    }
    return results;
  }

  /** Assemble full state from individually saved modules */
  function assembleFromModules() {
    var assembled = {};
    var hasAny = false;
    for (var i = 0; i < MODULES.length; i++) {
      var modData = loadModule(MODULES[i]);
      if (modData) {
        hasAny = true;
        for (var j = 0; j < MODULES[i].fields.length; j++) {
          var f = MODULES[i].fields[j];
          if (modData[f] !== undefined) assembled[f] = modData[f];
        }
      }
    }
    return hasAny ? assembled : null;
  }

  /* ==========================================================
     EMERGENCY BACKUP
     ========================================================== */
  function saveEmergencyBackup(rawState) {
    try {
      var lite = stripPhotos(rawState);
      localStorage.setItem(LS_EMERGENCY_KEY, JSON.stringify({
        data: lite,
        savedAt: new Date().toISOString()
      }));
    } catch (err) {
      console.warn('[Persistence] Backup de emergencia falhou:', err);
    }
  }

  function loadEmergencyBackup() {
    try {
      var raw = localStorage.getItem(LS_EMERGENCY_KEY);
      if (!raw) return null;
      var parsed = safeParse(raw);
      return (parsed && parsed.data) ? parsed.data : null;
    } catch (_) { return null; }
  }

  /* ==========================================================
     FULL STATE LOCAL STORAGE (backward compat)
     ========================================================== */
  function saveToLocal(appState) {
    try {
      if (!isValidAppState(appState)) {
        console.warn('[Persistence] appState invalido - nao salvando.');
        return false;
      }
      // OVERWRITE PROTECTION
      if (!isValidRawState(appState.data)) {
        var existing = loadFromLocal();
        if (existing && isValidRawState(existing.data)) {
          console.warn('[Persistence] Estado novo vazio -> protegendo dados existentes.');
          return false;
        }
      }
      var serialized = JSON.stringify(cleanForStorage(appState));
      localStorage.setItem(LS_FULL_KEY, serialized);
      return true;
    } catch (err) {
      console.error('[Persistence] Erro ao salvar completo:', err);
      // Quota exceeded? Try without photos
      try {
        var lite = { version: appState.version, updatedAt: appState.updatedAt, data: stripPhotos(appState.data) };
        localStorage.setItem(LS_FULL_KEY, JSON.stringify(lite));
        console.warn('[Persistence] Salvo sem fotos (limite de espaco).');
        return true;
      } catch (_) {
        console.error('[Persistence] Falha total ao salvar localmente.');
        return false;
      }
    }
  }

  function loadFromLocal() {
    try {
      var raw = localStorage.getItem(LS_FULL_KEY);
      if (!raw) return null;
      var parsed = safeParse(raw);
      if (isValidAppState(parsed)) return parsed;
      console.warn('[Persistence] Dados corrompidos no localStorage.');
      return null;
    } catch (err) {
      console.error('[Persistence] Erro ao ler localStorage:', err);
      return null;
    }
  }

  /* ==========================================================
     HISTORY (FIFO, max 10 - stored without photos)
     ========================================================== */
  function pushToHistory(appState) {
    try {
      if (!isValidAppState(appState)) return;
      var history = loadHistory();
      var liteState = { version: appState.version, updatedAt: appState.updatedAt, data: stripPhotos(appState.data) };
      history.push(liteState);
      if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error('[Persistence] Erro ao salvar historico:', err);
      try {
        var h = loadHistory();
        if (h.length > 3) {
          localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(h.slice(-3)));
        }
      } catch (_) { /* give up */ }
    }
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_HISTORY_KEY);
      if (!raw) return [];
      var parsed = safeParse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidAppState);
      return [];
    } catch (_) { return []; }
  }

  function getLatestFromHistory() {
    var h = loadHistory();
    return h.length > 0 ? h[h.length - 1] : null;
  }

  /* ==========================================================
     FIREBASE OPERATIONS (MERGE MODE)
     ========================================================== */
  function getFirestore() {
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    } catch (_) { /* ignore */ }
    return null;
  }

  /** Save to Firebase using MERGE (never full replace) */
  function saveToFirebase(appState, onSuccess, onError) {
    var fs = getFirestore();
    if (!fs) { if (onError) onError(new Error('Firebase indisponivel')); return; }
    try {
      if (!isValidAppState(appState)) { if (onError) onError(new Error('appState invalido')); return; }

      var cleanData = cleanForStorage(appState);
      fs.collection(FB_COLLECTION).doc(FB_DOC)
        .set(cleanData, { merge: true })
        .then(function ()  { if (onSuccess) onSuccess(); })
        .catch(function (err) {
          console.error('[Persistence] Erro Firebase merge:', err);
          if (onError) onError(err);
        });
    } catch (err) {
      console.error('[Persistence] Excecao Firebase:', err);
      if (onError) onError(err);
    }
  }

  function loadFromFirebase() {
    return new Promise(function (resolve) {
      var fs = getFirestore();
      if (!fs) { resolve(null); return; }
      try {
        fs.collection(FB_COLLECTION).doc(FB_DOC)
          .get({ source: 'server' })
          .then(function (doc) {
            if (doc.exists) {
              var d = doc.data();
              if (isValidAppState(d)) { resolve(d); } else { resolve(null); }
            } else { resolve(null); }
          })
          .catch(function () { resolve(null); });
      } catch (_) { resolve(null); }
    });
  }

  /* ==========================================================
     MERGE HELPER
     ========================================================== */
  /** Merge two raw states: fill MISSING fields in primary with data from secondary */
  function mergeStates(primary, secondary) {
    if (!primary) return secondary;
    if (!secondary) return primary;
    var result = {};
    var allKeys = Object.keys(Object.assign({}, secondary, primary));
    for (var i = 0; i < allKeys.length; i++) {
      var k = allKeys[i];
      var pv = primary[k];
      var sv = secondary[k];
      
      // If primary explicitly has the key (even if it's null or an empty array),
      // we MUST respect it. Otherwise, intentional deletions get resurrected.
      if (pv !== undefined) {
        result[k] = pv;
      } else {
        result[k] = sv;
      }
    }
    return result;
  }

  /* ==========================================================
     DEBOUNCE
     ========================================================== */
  var _debounceTimer = null;
  function debounce(fn, delay) {
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  }

  /* ==========================================================
     CORE PERSISTENCE API
     ========================================================== */
  var _appState = { version: 0, updatedAt: new Date().toISOString(), data: {} };

  var _debouncedFirebaseSave = debounce(function (appState) {
    if (appState.version !== _appState.version) return;
    saveToFirebase(appState, function () {
      if (appState.version === _appState.version) setStatus(STATUS.SYNCED);
    }, function () {
      if (appState.version === _appState.version) setStatus(STATUS.OFFLINE);
    });
  }, DEBOUNCE_MS);

  /**
   * MAIN SAVE - called on every state change.
   * 1. Emergency backup of current state
   * 2. Save each module independently
   * 3. Save full state (backward compat)
   * 4. Push to history
   * 5. Debounced Firebase merge
   */
  function persistState(rawState) {
    if (!rawState || typeof rawState !== 'object') return;

    // Emergency backup of CURRENT valid state BEFORE overwriting
    if (isValidRawState(_appState.data)) {
      saveEmergencyBackup(_appState.data);
    }

    _appState = {
      version: _appState.version + 1,
      updatedAt: new Date().toISOString(),
      data: rawState
    };

    setStatus(STATUS.SAVING);

    // 1. Save each module independently
    var modResults = saveAllModules(rawState);

    // 2. Save full state
    var fullOk = saveToLocal(_appState);

    // 3. Push to history
    pushToHistory(_appState);

    // Check results
    var anyModFailed = false;
    for (var m in modResults) { if (!modResults[m]) { anyModFailed = true; break; } }

    if (fullOk || !anyModFailed) {
      setStatus(STATUS.SAVED_LOCAL);
    } else {
      setStatus(STATUS.ERROR);
    }

    // 4. Debounced Firebase merge
    _debouncedFirebaseSave(_appState);
  }

  /**
   * RECOVERY - called on app startup.
   * Gathers candidates from all sources, picks best, merges missing pieces.
   */
  function recoverState() {
    return new Promise(function (resolve) {
      var localState     = loadFromLocal();
      var moduleState    = assembleFromModules();
      var emergencyState = loadEmergencyBackup();

      loadFromFirebase().then(function (firebaseState) {
        _pickBestAndResolve(localState, firebaseState, moduleState, emergencyState, resolve);
      }).catch(function () {
        _pickBestAndResolve(localState, null, moduleState, emergencyState, resolve);
      });
    });
  }

  function _pickBestAndResolve(localState, firebaseState, moduleState, emergencyState, resolve) {
    var candidates = [];

    if (localState && isValidAppState(localState) && isValidRawState(localState.data)) {
      candidates.push({ src: 'local', data: localState.data, time: new Date(localState.updatedAt).getTime(), ver: localState.version });
    }
    if (firebaseState && isValidAppState(firebaseState) && isValidRawState(firebaseState.data)) {
      candidates.push({ src: 'firebase', data: firebaseState.data, time: new Date(firebaseState.updatedAt).getTime(), ver: firebaseState.version });
    }
    if (moduleState && isValidRawState(moduleState)) {
      candidates.push({ src: 'modules', data: moduleState, time: Date.now() - 1000, ver: 0 });
    }
    var histState = getLatestFromHistory();
    if (histState && isValidAppState(histState) && isValidRawState(histState.data)) {
      candidates.push({ src: 'history', data: histState.data, time: new Date(histState.updatedAt).getTime(), ver: histState.version });
    }
    if (emergencyState && isValidRawState(emergencyState)) {
      candidates.push({ src: 'emergency', data: emergencyState, time: 0, ver: 0 });
    }

    if (candidates.length === 0) {
      console.log('[Persistence] Nenhum estado salvo encontrado.');
      resolve(null);
      return;
    }

    // Sort by time descending, then version descending
    candidates.sort(function (a, b) { return (b.time - a.time) || (b.ver - a.ver); });
    var best = candidates[0];

    // Merge with module state to fill any gaps
    if (moduleState && best.src !== 'modules') {
      best.data = mergeStates(best.data, moduleState);
    }
    // Also merge with emergency if it has data the best doesn't
    if (emergencyState && best.src !== 'emergency') {
      best.data = mergeStates(best.data, emergencyState);
    }

    _appState = {
      version: best.ver || 1,
      updatedAt: new Date().toISOString(),
      data: best.data
    };

    // Cross-sync to all storage layers
    saveAllModules(best.data);
    saveToLocal(_appState);
    if (best.src !== 'firebase') saveToFirebase(_appState);

    console.log('[Persistence] Recuperado de: ' + best.src + ', versao: ' + (best.ver || '?'));

    if (best.src === 'firebase')                               setStatus(STATUS.SYNCED);
    else if (best.src === 'emergency' || best.src === 'history') setStatus(STATUS.RECOVERED);
    else                                                        setStatus(STATUS.SAVED_LOCAL);

    resolve(best.data);
  }

  /* ==========================================================
     EXPORT / IMPORT
     ========================================================== */
  function exportarBackup() {
    try {
      if (!isValidAppState(_appState)) { console.warn('[Persistence] Nada para exportar.'); return; }
      var dataStr = JSON.stringify(cleanForStorage(_appState.data), null, 2);
      var blob = new Blob([dataStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var date = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = 'backup_copa_psyzon_' + date + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (err) { console.error('[Persistence] Erro ao exportar:', err); }
  }

  function importarBackup(jsonString) {
    try {
      var parsed = safeParse(jsonString);
      if (!parsed) return { success: false, error: 'JSON invalido.' };

      var appState;
      if (isValidAppState(parsed)) {
        appState = { version: _appState.version + 1, updatedAt: new Date().toISOString(), data: parsed.data };
      } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        appState = { version: _appState.version + 1, updatedAt: new Date().toISOString(), data: parsed };
      } else {
        return { success: false, error: 'Formato nao reconhecido.' };
      }

      if (!isValidAppState(appState)) return { success: false, error: 'Estrutura invalida.' };

      // Emergency backup before import
      if (isValidRawState(_appState.data)) saveEmergencyBackup(_appState.data);

      _appState = appState;
      saveAllModules(appState.data);
      saveToLocal(appState);
      pushToHistory(appState);
      saveToFirebase(appState);
      setStatus(STATUS.SAVED_LOCAL);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ==========================================================
     GETTERS
     ========================================================== */
  function getAppState()  { return _appState; }
  function getVersion()   { return _appState.version; }
  function getData()      { return _appState.data; }
  function getHistory()   { return loadHistory(); }
  function getStatusVal() { return currentStatus; }

  /* ==========================================================
     PUBLIC API
     ========================================================== */
  window.Persistence = {
    persistState:    persistState,
    recoverState:    recoverState,

    getAppState:     getAppState,
    getVersion:      getVersion,
    getData:         getData,
    getHistory:      getHistory,
    getStatus:       getStatusVal,

    exportarBackup:  exportarBackup,
    importarBackup:  importarBackup,

    saveToLocal:     saveToLocal,
    loadFromLocal:   loadFromLocal,
    saveToFirebase:  saveToFirebase,
    loadFromFirebase: loadFromFirebase,
    isValidAppState: isValidAppState,
    isValidRawState: isValidRawState,
    isFieldEmpty:    isFieldEmpty,
    mergeStates:     mergeStates,
    setStatus:       setStatus,
    assembleFromModules: assembleFromModules,
    loadEmergencyBackup: loadEmergencyBackup,

    STATUS:        STATUS,
    STATUS_LABELS: STATUS_LABELS
  };

})();

