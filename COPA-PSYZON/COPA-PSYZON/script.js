/**
 * COPA PSYZON â€” Tournament Management Platform
 * Complete IIFE-wrapped application for managing elimination-style tournaments.
 */
(function () {
  'use strict';

  /* ==========================================================
     1. FIREBASE INITIALIZATION
     ========================================================== */
  const firebaseConfig = {
    apiKey: "AIzaSyDPH-ltsHg4nYeoZpDPq_80sfvcMaS-oXs",
    authDomain: "copa-psyzon.firebaseapp.com",
    projectId: "copa-psyzon",
    storageBucket: "copa-psyzon.firebasestorage.app",
    messagingSenderId: "74729053927",
    appId: "1:74729053927:web:ec295dcc38c640256d8c42",
    measurementId: "G-KH01335LK1"
  };

  /** @type {boolean} Whether Firebase is available */
  let firebaseAvailable = false;
  /** @type {object|null} Firebase auth instance */
  let auth = null;
  /** @type {object|null} Firebase firestore instance */
  let db = null;

  // Fallback credentials for when Firebase is not available.
  // Password is stored as a SHA-256 hash to avoid exposing plaintext in source.
  const FALLBACK_EMAIL = 'copa-psyzon@email.com';
  const EXPECTED_HASH = '4c5c37fa864741cb705483c370095dbf5d14fa0ffa76de4b5f11a8f897160fb2';

  /**
   * Compute SHA-256 hash of a string using the Web Crypto API.
   * @param {string} str
   * @returns {Promise<string>} hex-encoded hash
   */
  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      if (firebase.analytics) {
        firebase.analytics();
      }
      firebaseAvailable = true;
    }
  } catch (_) {
    firebaseAvailable = false;
  }

  /* ==========================================================
     2. STATE MANAGEMENT
     ========================================================== */
  const REMEMBER_KEY = 'copaPsyzonRemember'; // UI state only, NOT main data

  let isAdmin = false;
  let currentUser = null;
  let isParticipant = false;
  let currentParticipantCode = null;
  let currentViewingBracketId = null;

  /** @type {{ tournamentName: string, teamCount: number, teams: Array<{id:string, teamName:string, playerName:string}>, prize: string, bracket: null|{rounds: Array}, champion: null|{teamName:string, playerName:string} }} */
  let state = defaultState();

  /** Returns a fresh default state object */
  function defaultState() {
    return {
      tournamentName: '',
      teamCount: 8,
      twoLegged: false,
      tournamentFormat: 'knockout',
      groupCount: 5,
      groups: null,
      teams: [],
      prize: '',
      bracket: null,
      champion: null,
      playerStats: {},
      codes: [],
      participants: []
    };
  }

  /** Helper to get team photo safely to avoid duplicating base64 data in state */
  function getTeamPhoto(team) {
    if (!team || !team.id) return null;
    let photo = null;
    let flagId = null;

    if (state.teams) {
      const full = state.teams.find(t => t.id === team.id);
      if (full) {
        photo = full.photo;
        flagId = full.flagId;
      }
    }

    if (!photo && state.participants) {
      const p = state.participants.find(p => p.id === team.id);
      if (p) {
        photo = photo || p.photo;
        flagId = flagId || p.flagId || p.flag;
      }
    }

    if (!photo && !flagId) {
      photo = team.photo;
      flagId = team.flagId || team.flag;
    }

    if (photo) return photo;
    if (flagId) return `https://flagcdn.com/${flagId}.svg`;

    return null;
  }

  /** Strip photos from everywhere EXCEPT state.teams/participants to save space */
  function cleanStateBloat() {
    if (state.bracket && state.bracket.rounds) {
      state.bracket.rounds.forEach(r => {
        if (r.matches) r.matches.forEach(m => {
          if (m.team1) delete m.team1.photo;
          if (m.team2) delete m.team2.photo;
        });
      });
    }
    if (state.groups) {
      state.groups.forEach(g => {
        if (g.teams) g.teams.forEach(t => delete t.photo);
        if (g.matches) g.matches.forEach(m => {
          if (m.team1) delete m.team1.photo;
          if (m.team2) delete m.team2.photo;
        });
        if (g.standings) g.standings.forEach(s => delete s.photo);
      });
    }
    if (state.groupRepechage) {
      state.groupRepechage.forEach(m => {
        if (m.team1) delete m.team1.photo;
        if (m.team2) delete m.team2.photo;
      });
    }
    if (state.groupDirectQualified) {
      state.groupDirectQualified.forEach(t => delete t.photo);
    }
    if (state.bracket && state.bracket._lastRepescagemResult) {
      delete state.bracket._lastRepescagemResult; // Recalculate it
    }
  }


  /** Persist current state to Firestore AND offline-first persistence layer */
  function saveState() {
    cleanStateBloat();
    // --- Offline-first persistence (localStorage modular + Firebase estado/principal) ---
    if (typeof window.Persistence !== 'undefined') {
      try {
        window.Persistence.persistState(state);
      } catch (e) {
        console.error('[saveState] Erro na persistência offline-first:', e);
      }
    }

    // --- Original Firestore persistence (tournaments/main) with MERGE ---
    if (firebaseAvailable && db) {
      const cleanState = JSON.parse(JSON.stringify(state, (k, v) => v === undefined ? null : v));
      // merge:true → never wipes existing fields if incoming data is partial/empty
      db.collection('tournaments').doc('main').set(cleanState, { merge: true }).catch((err) => {
        console.error('Erro ao salvar no Firestore:', err);
        showToast('Erro ao salvar no banco. Verifique as Regras do Firestore!', 'error');
      });
    }
  }

  /** Subscribe to real-time state from Firestore, with offline-first recovery fallback */
  function subscribeToState(callback) {
    if (firebaseAvailable && db) {
      let firstLoad = true;
      db.collection('tournaments').doc('main').onSnapshot((doc) => {
        if (doc.exists) {
          const incoming = doc.data();
          // Use incoming snapshot as the single source of truth.
          // Using mergeStates here caused deleted fields (like groupRepechage=null) 
          // to be resurrected if another client still had them in local state.
          if (incoming && typeof incoming === 'object') {
            state = Object.assign(defaultState(), incoming);
          } else {
            state = Object.assign(defaultState(), incoming);
          }
        } else {
          state = defaultState();
          cleanStateBloat();
          saveState(); // Initialize document with default state
        }

        cleanStateBloat();

        // Auto-generate bracket if it doesn't exist
        ensureBracketExists();

        // Re-render UI immediately if we are in the main app
        const mainApp = $('#main-app');
        if (mainApp && mainApp.style.display !== 'none') {
          populateFormFromState();
          renderTeamList();
          renderPrize();
          renderTournamentTitle();
          renderBracket();
          renderTop3();
          if (isAdmin) {
            populateClientSelect();
            renderCodesList();
          }
        }

        if (firstLoad) {
          firstLoad = false;
          if (typeof callback === 'function') callback();
        }
      }, (error) => {
        console.error('Erro no onSnapshot', error);
        // Try offline-first recovery before showing error
        _recoverFromPersistence(function () {
          showToast('Modo offline — dados recuperados localmente.', 'info');
          if (typeof callback === 'function') callback();
        }, function () {
          showToast('Você não tem permissão de leitura no BD. Aplique as novas Regras do Firestore.', 'error');
          if (typeof callback === 'function') callback();
        });
      });
    } else {
      // No Firebase available — try offline-first recovery
      _recoverFromPersistence(function () {
        showToast('Modo offline — dados recuperados localmente.', 'info');
        if (typeof callback === 'function') callback();
      }, function () {
        if (typeof callback === 'function') callback();
      });
    }
  }

  /**
   * Internal helper: attempt to recover state from offline-first persistence.
   * @param {function} onSuccess - called if state was recovered
   * @param {function} onFail - called if no state could be recovered
   */
  function _recoverFromPersistence(onSuccess, onFail) {
    if (typeof window.Persistence === 'undefined') {
      if (onFail) onFail();
      return;
    }
    window.Persistence.recoverState().then(function (recoveredData) {
      if (recoveredData && typeof recoveredData === 'object') {
        state = Object.assign(defaultState(), recoveredData);
        ensureBracketExists();

        // Re-render UI
        const mainApp = document.querySelector('#main-app');
        if (mainApp && mainApp.style.display !== 'none') {
          populateFormFromState();
          renderTeamList();
          renderPrize();
          renderTournamentTitle();
          renderBracket();
          renderTop3();
          if (isAdmin) {
            populateClientSelect();
            renderCodesList();
          }
        }

        if (onSuccess) onSuccess();
      } else {
        if (onFail) onFail();
      }
    }).catch(function () {
      if (onFail) onFail();
    });
  }

  /**
   * Ensure a bracket always exists. If not, auto-create one with empty slots.
   */
  function ensureBracketExists() {
    if (state.bracket && state.bracket.rounds && state.bracket.rounds.length > 0) {
      // Ensure repescagem pools exist for legacy brackets
      if (!state.bracket.repescagemPool) state.bracket.repescagemPool = [];
      if (!state.bracket.thirdChancePool) state.bracket.thirdChancePool = [];
      return;
    }

    // Don't auto-build bracket when groups format is active — use placeholder instead
    if (state.tournamentFormat === 'groups' && state.groups && state.groups.length > 0) {
      return;
    }

    const count = state.teamCount || 8;
    const existingTeams = [...(state.teams || [])].filter(t => t != null);

    state.bracket = buildBracketStructure(existingTeams, count);
    state.champion = null;
    saveState();
  }

  /* ==========================================================
     3. DOM REFERENCES (cached for performance)
     ========================================================== */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* ==========================================================
     4. UTILITY FUNCTIONS
     ========================================================== */

  /**
   * Fisher-Yates shuffle (in-place, returns same array).
   * @param {Array} arr
   * @returns {Array}
   */
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Generate a unique id string */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * Sanitize a string for safe HTML insertion (prevent XSS).
   * @param {string} str
   * @returns {string}
   */
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Get initials (up to 2 chars) from a name for avatar placeholder */
  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  /** Format name to show only First and Last name */
  function formatShortName(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + ' ' + parts[parts.length - 1];
  }

  /**
   * Validate a Brazilian CPF number.
   * @param {string} cpf - raw or formatted CPF
   * @returns {boolean}
   */
  function isValidCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11) return false;
    if (/^(\d)\1+$/.test(cpf)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i), 10) * (10 - i);
    let check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    if (parseInt(cpf.charAt(9), 10) !== check) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i), 10) * (11 - i);
    check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    if (parseInt(cpf.charAt(10), 10) !== check) return false;
    return true;
  }

  /** Format CPF as 000.000.000-00 */
  function formatCPF(value) {
    value = value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    if (value.length > 9) return value.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    if (value.length > 6) return value.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (value.length > 3) return value.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return value;
  }

  /** Format phone as (00) 00000-0000 */
  function formatPhone(value) {
    value = value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    if (value.length > 10) return value.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (value.length > 6) return value.replace(/(\d{2})(\d{4,5})(\d{0,4})/, '($1) $2-$3');
    if (value.length > 2) return value.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    return value;
  }


  /* ==========================================================
     4b. SVG ICON CONSTANTS
     ========================================================== */
  const SVG = {
    soccer: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>',
    trophy: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    pencil: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    checkCircle: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    success: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    error: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    info: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow, #ffcc00)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    clock: '<svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    clipboard: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
    refresh: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>',
    swords: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4"/><path d="M7 17l-3 3"/></svg>',
    crown: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-9-4 9-6-7z"/><path d="M5 16h14v4H5z"/></svg>',
    check: '<svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    chevronRight: '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
  };


  /* ==========================================================
     4c. RANDOM TEAM NAME GENERATOR
     ========================================================== */
  const RANDOM_TEAM_NAMES = [
    'Trovões FC', 'Ãguias Douradas', 'Fúria Negra', 'Dragões de Fogo',
    'Lobos Selvagens', 'Falcões de Aço', 'Leões do Norte', 'Tubarões Azuis',
    'Panteras Negras', 'Fênix Renascida', 'Relâmpago FC', 'Guerreiros de Ferro',
    'Cobras Venenosas', 'Titãs do Sul', 'Cavaleiros da Lua', 'Vulcões FC',
    'Estrelas Cadentes', 'Tempestade FC', 'Raposas Douradas', 'Condores Reais',
    'Spartanos FC', 'Vikings do Gelo', 'Samurais FC', 'Gladiadores FC',
    'Cometas FC', 'Furacão Vermelho', 'Bravos de Elite', 'Supremos FC',
    'Raios de Sol', 'Predadores FC', 'Corsários FC', 'Piratas do Mar',
    'Tigres de Bengal', 'Escorpiões FC', 'Minotauros FC', 'Pegasus FC',
    'Netuno FC', 'Hércules FC', 'Atenas FC', 'Apolo FC',
    'Centauros FC', 'Avalanche FC'
  ];

  /** Generate a random team name not already in use */
  function generateRandomTeamName() {
    const usedNames = state.teams.map(t => t.teamName.toLowerCase());
    const available = RANDOM_TEAM_NAMES.filter(n => !usedNames.includes(n.toLowerCase()));
    if (available.length === 0) {
      showToast('Todos os nomes aleatórios já foram usados.', 'info');
      return '';
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  /* ==========================================================
     4d. PHOTO RESIZE HELPER
     ========================================================== */

  /**
   * Resize an image file to max 80x80 and return as base64 data URL.
   * @param {File} file
   * @returns {Promise<string>}
   */
  function resizeImageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          const maxSize = 80;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
          } else {
            if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ==========================================================
     5. TOAST NOTIFICATIONS
     ========================================================== */

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} type
   */
  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    if (!container) return;

    const icons = { success: SVG.success, error: SVG.error, info: SVG.info };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${sanitize(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3500);
  }

  /* ==========================================================
     6. AUTH MANAGEMENT
     ========================================================== */

  /** Show login screen, hide main app */
  function showLoginScreen() {
    const loginScreen = $('#login-screen');
    const mainApp = $('#main-app');
    const gameScreen = $('#game-selection-screen');
    if (loginScreen) loginScreen.style.display = '';
    if (mainApp) mainApp.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'none';
    const codeScreen = $('#participant-code-screen');
    const formScreen = $('#participant-form-screen');
    if (codeScreen) codeScreen.style.display = 'none';
    if (formScreen) formScreen.style.display = 'none';
    // Reset login form
    const loginForm = $('#login-form');
    if (loginForm) loginForm.style.display = 'none';
    const loginError = $('#login-error');
    if (loginError) loginError.textContent = '';
  }

  /**
   * Show main app with role-based UI.
   * @param {boolean} admin
   */
  function showMainApp(admin) {
    isAdmin = admin;
    const loginScreen = $('#login-screen');
    const mainApp = $('#main-app');
    const gameScreen = $('#game-selection-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainApp) mainApp.style.display = '';
    if (gameScreen) gameScreen.style.display = 'none';
    const codeScreen = $('#participant-code-screen');
    const formScreen = $('#participant-form-screen');
    if (codeScreen) codeScreen.style.display = 'none';
    if (formScreen) formScreen.style.display = 'none';

    // Show main tabs
    const mainTabs = $('#main-tabs');
    if (mainTabs) mainTabs.style.display = 'flex';

    // Role badge
    const badge = $('#role-badge');
    if (badge) {
      if (admin) {
        badge.textContent = 'DONO';
        badge.style.background = 'rgba(0,122,255,0.12)';
        badge.style.color = '#007aff';
      } else if (isParticipant) {
        badge.textContent = 'PARTICIPANTE';
        badge.style.background = 'rgba(52,199,89,0.12)';
        badge.style.color = '#34c759';
      } else {
        badge.textContent = 'VISITANTE';
        badge.style.background = '';
        badge.style.color = '';
      }
    }

    // Toggle admin-only elements
    $$('.admin-only').forEach((el) => {
      el.style.display = admin ? '' : 'none';
    });

    // Render current state into the UI
    populateFormFromState();
    renderTeamList();
    renderPrize();
    renderTournamentTitle();
    renderBracket();
    renderTop3();
    // Tab visibility management based on tournament state
    const bracketTabBtn = $('#bracket-tab-btn');
    const groupsTabBtn = $('#groups-tab-btn');
    
    const hasBracket = state.bracket && state.bracket.rounds && state.bracket.rounds.length > 0;
    const hasGroups = state.groups && state.groups.length > 0;

    if (bracketTabBtn) {
      bracketTabBtn.style.display = (hasBracket || hasGroups) ? '' : 'none';
    }

    if (hasGroups) {
      renderGroupsTab();
      if (groupsTabBtn) {
        groupsTabBtn.style.display = '';

        // Auto-generate repechage if all groups finished but not yet generated
        if (!state.groupRepechage && areAllGroupMatchesFinished()) {
          generateBracketFromGroups();
        }
        
        // Decide initial tab:
        if (state.bracketFromGroups || state.groupRepechage) {
          if (bracketTabBtn) bracketTabBtn.click();
        } else {
          groupsTabBtn.click();
        }
      }
    } else {
      if (groupsTabBtn) groupsTabBtn.style.display = 'none';
      if (hasBracket) {
        if (bracketTabBtn) bracketTabBtn.click();
      }
    }
    if (admin) {
      populateClientSelect();
      renderCodesList();
    }
  }

  /** Translate Firebase auth errors to Portuguese messages */
  function authErrorMessage(code) {
    const map = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/user-disabled': 'Esta conta foi desativada.',
      'auth/user-not-found': 'Usuário não encontrado.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
      'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
      'auth/invalid-credential': 'Credenciais inválidas. Verifique e-mail e senha.',
      'auth/invalid-login-credentials': 'Credenciais inválidas. Verifique e-mail e senha.'
    };
    return map[code] || 'Erro ao fazer login. Tente novamente.';
  }

  /** Handle login form submission */
  function handleLogin(e) {
    e.preventDefault();
    const email = ($('#login-email') || {}).value || '';
    const password = ($('#login-password') || {}).value || '';
    const errorEl = $('#login-error');
    if (errorEl) errorEl.textContent = '';

    if (!email.trim() || !password.trim()) {
      if (errorEl) errorEl.textContent = 'Preencha todos os campos.';
      return;
    }

    // Disable submit button to prevent double-submission
    const submitBtn = $('#login-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    if (firebaseAvailable && auth) {
      // Firebase authentication
      auth.signInWithEmailAndPassword(email, password)
        .then(() => {
          // onAuthStateChanged will handle the rest
        })
        .catch((err) => {
          if (errorEl) errorEl.textContent = authErrorMessage(err.code);
        })
        .finally(() => {
          if (submitBtn) submitBtn.disabled = false;
        });
    } else {
      // Fallback authentication (local credential check with hashed password)
      sha256(password).then((hash) => {
        if (email.trim() === FALLBACK_EMAIL && hash === EXPECTED_HASH) {
          isAdmin = true;
          currentUser = { email: FALLBACK_EMAIL };
          showMainApp(true);
        } else {
          if (errorEl) errorEl.textContent = 'Credenciais inválidas. Verifique e-mail e senha.';
        }
        if (submitBtn) submitBtn.disabled = false;
      }).catch(() => {
        if (errorEl) errorEl.textContent = 'Erro ao verificar credenciais.';
        if (submitBtn) submitBtn.disabled = false;
      });
    }
  }

  /** Handle visitor button - show game selection screen */
  function handleVisitor() {
    isAdmin = false;
    currentUser = null;

    // Save remember choice (UI state only)
    const rememberCheck = $('#remember-choice');
    if (rememberCheck && rememberCheck.checked) {
      try { localStorage.setItem(REMEMBER_KEY, 'visitor'); } catch (_) { /* ignore */ }
    } else {
      try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
    }

    showGameSelection();
  }

  /** Show game selection screen */
  function showGameSelection() {
    const loginScreen = $('#login-screen');
    const mainApp = $('#main-app');
    const gameScreen = $('#game-selection-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    if (mainApp) mainApp.style.display = 'none';
    if (gameScreen) gameScreen.style.display = '';
    const codeScreen = $('#participant-code-screen');
    const formScreen = $('#participant-form-screen');
    if (codeScreen) codeScreen.style.display = 'none';
    if (formScreen) formScreen.style.display = 'none';
  }

  /** Handle FIFA game selection */
  function handleGameFifa() {
    showMainApp(false);
  }

  /** Handle back from game selection */
  function handleGameBack() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
    showLoginScreen();
  }

  /** Handle logout */
  function handleLogout() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
    isParticipant = false;
    currentParticipantCode = null;
    if (firebaseAvailable && auth) {
      auth.signOut().then(() => {
        isAdmin = false;
        currentUser = null;
        showLoginScreen();
      }).catch(() => {
        isAdmin = false;
        currentUser = null;
        showLoginScreen();
      });
    } else {
      isAdmin = false;
      currentUser = null;
      showLoginScreen();
    }
  }

  /* ==========================================================
     7. LOGIN FORM TOGGLE
     ========================================================== */

  /** Toggle login form visibility with slide animation */
  function toggleLoginForm() {
    const rememberCheck = $('#remember-choice');
    if (rememberCheck && rememberCheck.checked) {
      try { localStorage.setItem(REMEMBER_KEY, 'admin_form'); } catch (_) { /* ignore */ }
    } else {
      try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
    }

    const form = $('#login-form');
    if (!form) return;
    if (form.style.display === 'none' || !form.style.display) {
      form.style.display = 'block';
      form.style.animation = 'slideUp 0.3s ease';
      // Focus first input
      const emailInput = $('#login-email');
      if (emailInput) emailInput.focus();
    } else {
      form.style.display = 'none';
    }
  }

  /* ==========================================================
     8. FORM STATE SYNC
     ========================================================== */

  /** Populate sidebar form fields from current state */
  function populateFormFromState() {
    const nameInput = $('#tournament-name');
    if (nameInput) nameInput.value = state.tournamentName || '';

    const countInput = $('#team-count');
    if (countInput) countInput.value = String(state.teamCount || 8);

    const prizeInput = $('#prize-description');
    if (prizeInput) prizeInput.value = state.prize || '';

    const twoLeggedCheck = $('#two-legged-tournament');
    if (twoLeggedCheck) twoLeggedCheck.checked = !!state.twoLegged;

    const formatSelect = $('#tournament-format');
    if (formatSelect) {
      formatSelect.value = state.tournamentFormat || 'knockout';
      toggleGroupsConfig();
    }

    const groupCountInput = $('#group-count');
    if (groupCountInput) groupCountInput.value = String(state.groupCount || 5);

    updateTeamCountInfo();
  }

  /** Save tournament name when it changes */
  function syncTournamentName() {
    const nameInput = $('#tournament-name');
    if (nameInput) {
      state.tournamentName = nameInput.value.trim();
      saveState();
      renderTournamentTitle();
    }
  }

  /** Render tournament title display */
  function renderTournamentTitle() {
    const display = $('#tournament-title-display');
    if (!display) return;
    if (state.tournamentName) {
      display.textContent = state.tournamentName;
      display.style.display = '';
    } else {
      display.textContent = '';
      display.style.display = 'none';
    }
  }

  /* ==========================================================
     9. PRIZE MANAGEMENT
     ========================================================== */

  /** Save prize from textarea */
  function handleSavePrize() {
    const prizeInput = $('#prize-description');
    if (!prizeInput) return;
    state.prize = prizeInput.value.trim();
    saveState();
    renderPrize();
    showToast('Premiação salva com sucesso!', 'success');
  }

  /** Render prize display banner */
  function renderPrize() {
    const display = $('#prize-display');
    const valueEl = $('#prize-value');
    if (!display || !valueEl) return;

    if (state.prize) {
      valueEl.textContent = state.prize;
      display.style.display = 'flex';
    } else {
      display.style.display = 'none';
    }
  }

  /* ==========================================================
     REGRAS GERAIS DO TORNEIO
     ========================================================== */

  const DEFAULT_RULES = `1. DISPOSIÇÕES GERAIS

A Copa PSYZON é um torneio presencial de FC 26, realizado sob organização da PSYZON.

Ao participar do campeonato, o jogador declara estar de acordo com todas as regras deste regulamento.

A organização tem autoridade para interpretar, aplicar, adaptar e decidir qualquer situação não prevista neste documento, sempre buscando o bom andamento do evento, a justiça competitiva e o respeito entre todos os presentes.

2. HORÁRIO, CHAMADA E PRESENÇA

Os jogos terão início a partir das 14:00.
Cada partida terá tolerância máxima de 15 minutos após o horário do chamado.
O jogador que não comparecer dentro desse prazo sofrerá W.O. automático.
É obrigação do jogador ficar atento aos chamados da organização.
A organização não é obrigada a ficar procurando participantes pelo local.
O atraso em uma partida pode comprometer o cronograma geral do torneio, portanto a pontualidade é obrigatória.

3. FORMATO DO TORNEIO

3.1 Modelo principal
O torneio será disputado em formato de eliminatória simples (mata-mata).
Haverá também uma repescagem, funcionando como segunda chance para parte dos jogadores derrotados na fase inicial.

3.2 Repescagem
A repescagem será válida somente para jogadores derrotados na primeira fase, conforme definição da organização.
Entre os derrotados dessa fase, irão para a repescagem aqueles que tiverem o melhor desempenho entre os eliminados.
Para definir esse melhor desempenho, a organização poderá usar, nesta ordem:
• Menor saldo de gols sofrido na derrota
• Maior número de gols marcados
• Sorteio, caso continue empatado
Quem perder na repescagem estará eliminado definitivamente do torneio.

3.3 Penalidades esportivas para jogadores vindos da repescagem
O jogador que avançar pela repescagem:
• terá um desconto de 10% sobre eventual premiação em dinheiro;
• esse valor será destinado ao jogador que o derrotou na primeira fase;
• carregará durante o campeonato um selo de repescagem, definido pela organização;
• não poderá disputar a premiação de artilheiro.

4. FORMATO DOS CONFRONTOS

4.1 Duas gerações
Cada confronto será disputado em duas gerações do jogo, para manter equilíbrio competitivo:
• 1 partida na geração antiga
• 1 partida na geração nova

4.2 Critério de desempate
Caso cada jogador vença uma partida, ou caso a organização entenda que o confronto terminou tecnicamente empatado, haverá uma partida desempate, chamada de "nega".
Regras da nega:
• Duração: 3 minutos cada tempo
• Em caso de empate: haverá prorrogação com gol de ouro
• Persistindo o empate, a decisão será nos pênaltis

4.3 Prioridade de mando
Na partida de desempate, a prioridade de escolha de mando será do jogador que tiver sido mandante na partida de volta.

4.4 Vantagens do jogador mandante
O jogador que atuar como mandante poderá definir: câmera, estádio/campo e clima.

5. CONFIGURAÇÕES OFICIAIS DO JOGO

Todas as partidas deverão seguir o padrão abaixo:
• Jogo: FC 26
• Tempo de partida: 6 minutos por tempo
• Dificuldade: Lendário
• Velocidade: Normal
• Câmera: Livre
• Radar: Permitido
• Handicap: Desligado

6. ESCOLHA DE TIMES

Será permitido usar times repetidos, inclusive na mesma partida.
Será permitido usar seleções.
Será proibido utilizar times ALL-STAR, ICONS ou qualquer equipe considerada apelona ou fora do padrão competitivo do torneio.

7. CONDUTA DOS JOGADORES

7.1 É permitido: comemorar gols, interagir de forma saudável, fazer ajustes rápidos de tática, vibrar e entrar no clima competitivo.

7.2 É proibido: tocar no adversário de forma indevida, empurrar, provocar de forma ofensiva, praticar desrespeito, intimidação ou ameaça, usar falas preconceituosas ou discriminatórias, pausar sem obedecer às regras, prender a bola de forma antidesportiva.

7.3 Penalidades: advertência, perda da partida, eliminação do torneio, retirada do local.

7.4 Preconceito e discriminação: Não será tolerado nenhum tipo. Quem praticar será imediatamente retirado do local.

8. REGRAS DE PAUSA

Só será permitido pausar com a bola fora de jogo.
Pausas no meio da jogada não são permitidas.
Caso um jogador pause no meio de um lance de ataque, a posse será entregue ao adversário.
Pausas sem motivo relevante poderão gerar advertência.

9. PROBLEMAS TÉCNICOS

9.1 Queda ou interrupção: antes dos 10 min → reinício do zero; depois dos 10 min → mantém placar e disputa tempo restante.

9.2 Responsabilidade por danos: o responsável arca com 80% do prejuízo, a organização com 20%. Aplica-se a janelas, mesas, televisores, consoles, controles e estrutura do local.

10. RESET DE PARTIDA

Partidas só poderão ser resetadas com autorização da organização.
Reset sem motivo válido poderá resultar em derrota automática.

11. AMBIENTE, ALIMENTAÇÃO E CIRCULAÇÃO

Bebidas alcoólicas são proibidas no recinto do evento.
Circulação restrita ao salão, banheiro e bebedouro.

12. W.O., ABANDONO E DESCLASSIFICAÇÃO

W.O. quando: não comparecer dentro dos 15 min, abandonar sem justificativa, recusar-se a jogar, provocar atraso proposital.

13. PREMIAÇÃO

1º lugar: R$500
2º lugar: R$200
3º lugar: R$100
Artilheiro: R$50

14. CRITÉRIO DE ARTILHARIA

Conta gols de todo o torneio. Jogadores da repescagem não disputam artilheiro. Empate desempatado por sorteio.

15. REGRA DE OURO

A decisão final será sempre da organização PSYZON. Qualquer situação não prevista será resolvida pela organização.

16. PARTIDAS ONLINE

Transmissão obrigatória via Discord com câmera mostrando rosto, mãos e controle.
Microfone aberto durante toda a partida.
Queda de chamada: pausar imediatamente e restabelecer.
Descumprimento: desclassificação imediata.`;

  function getRulesText() {
    return state.tournamentRules || DEFAULT_RULES;
  }

  function formatRulesHtml(text, searchTerm) {
    const lines = text.split('\n');
    const escaped = searchTerm ? searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    const regex = escaped ? new RegExp(escaped, 'gi') : null;
    let matchCount = 0;
    let currentSection = '';

    // First pass: group lines into sections
    const sections = [];
    let currentSec = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      const isMainHeader = trimmed && /^\d+\.\s/.test(trimmed) && !/^\d+\.\d+/.test(trimmed);

      if (isMainHeader) {
        if (currentSec) sections.push(currentSec);
        currentSec = { header: trimmed, lines: [] };
      } else {
        if (!currentSec) currentSec = { header: '', lines: [] };
        currentSec.lines.push(trimmed);
      }
    });
    if (currentSec) sections.push(currentSec);

    // Second pass: build HTML with collapsible sections
    let html = '';
    sections.forEach((sec, secIdx) => {
      const sectionLines = [];
      let sectionHasMatch = false;

      // Process header
      if (sec.header) {
        currentSection = sec.header;
        let headerContent = sanitize(sec.header);
        if (regex) {
          const hm = regex.test(sec.header);
          regex.lastIndex = 0;
          if (hm) {
            sectionHasMatch = true;
            let m;
            const countRegex = new RegExp(escaped, 'gi');
            while ((m = countRegex.exec(sec.header)) !== null) matchCount++;
            let idx = matchCount - (sec.header.match(new RegExp(escaped, 'gi')) || []).length;
            headerContent = headerContent.replace(new RegExp('(' + escaped + ')', 'gi'), (match) => {
              idx++;
              return `<mark class="rules-highlight" data-match-idx="${idx}" data-section="${sanitize(currentSection)}">${match}</mark>`;
            });
          }
        }

        // Process body lines
        sec.lines.forEach(trimmed => {
          if (!trimmed) { sectionLines.push('<div class="rules-spacer"></div>'); return; }
          let content = sanitize(trimmed);
          const isSubHeader = /^\d+\.\d+\s/.test(trimmed);
          let lineMatches = false;

          if (regex) {
            lineMatches = regex.test(trimmed);
            regex.lastIndex = 0;
            if (lineMatches) {
              sectionHasMatch = true;
              let m;
              const countRegex = new RegExp(escaped, 'gi');
              while ((m = countRegex.exec(trimmed)) !== null) matchCount++;
              let idx = matchCount - (trimmed.match(new RegExp(escaped, 'gi')) || []).length;
              content = content.replace(new RegExp('(' + escaped + ')', 'gi'), (match) => {
                idx++;
                return `<mark class="rules-highlight" data-match-idx="${idx}" data-section="${sanitize(currentSection)}">${match}</mark>`;
              });
            }
          }

          const matchClass = lineMatches ? 'rules-match-line' : '';
          if (isSubHeader) {
            sectionLines.push(`<div class="rules-heading-sub ${matchClass}">${content}</div>`);
          } else if (trimmed.startsWith('\u2022')) {
            sectionLines.push(`<div class="rules-bullet ${matchClass}">${content}</div>`);
          } else {
            sectionLines.push(`<div class="rules-line ${matchClass}">${content}</div>`);
          }
        });

        const isOpen = searchTerm ? sectionHasMatch : false;
        const matchBadge = searchTerm && sectionHasMatch ? `<span class="rules-section-match-badge">contém resultado</span>` : '';
        html += `<div class="rules-section${isOpen ? ' rules-section-open' : ''}" data-sec-idx="${secIdx}">
          <div class="rules-section-header" onclick="this.parentElement.classList.toggle('rules-section-open')">
            <svg class="rules-section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            <span class="rules-heading-main">${headerContent}</span>
            ${matchBadge}
          </div>
          <div class="rules-section-body">${sectionLines.join('')}</div>
        </div>`;
      } else {
        // Lines before first section (no header)
        sec.lines.forEach(trimmed => {
          if (!trimmed) { html += '<div class="rules-spacer"></div>'; return; }
          let content = sanitize(trimmed);
          let lineMatches = false;
          if (regex) {
            lineMatches = regex.test(trimmed);
            regex.lastIndex = 0;
            if (lineMatches) {
              let m;
              const countRegex = new RegExp(escaped, 'gi');
              while ((m = countRegex.exec(trimmed)) !== null) matchCount++;
              let idx = matchCount - (trimmed.match(new RegExp(escaped, 'gi')) || []).length;
              content = content.replace(new RegExp('(' + escaped + ')', 'gi'), (match) => {
                idx++;
                return `<mark class="rules-highlight" data-match-idx="${idx}" data-section="">${match}</mark>`;
              });
            }
          }
          const matchClass = lineMatches ? 'rules-match-line' : '';
          html += `<div class="rules-line ${matchClass}">${content}</div>`;
        });
      }
    });

    return { html, hasMatch: searchTerm ? matchCount > 0 : true, matchCount };
  }

  // ── Search state ──
  let rulesSearchState = { total: 0, current: 0 };
  let rulesSuggestionsCache = null;
  let rulesSearchHistory = [];
  let rulesSuggestionIdx = -1;

  function extractRulesKeywords() {
    const text = getRulesText();
    const lines = text.split('\n');
    const suggestions = [];
    const seenWords = new Set();
    const stopWords = new Set(['para', 'como', 'cada', 'será', 'caso', 'pode', 'pela', 'pelo', 'este', 'esta', 'esse', 'essa', 'todo', 'toda', 'mais', 'menos', 'entre', 'após', 'antes', 'sobre', 'numa', 'neste', 'desta', 'deste', 'mesmo', 'quem', 'onde', 'qual', 'seus', 'suas', 'tipo', 'forma', 'modo', 'terá', 'será', 'podem', 'poderá', 'deverão', 'qualquer', 'durante', 'sempre', 'também', 'dentro', 'quanto', 'desde', 'outro', 'outra', 'outros']);

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const isMainHeader = /^\d+\.\s/.test(trimmed) && !/^\d+\.\d+/.test(trimmed);
      const isSubHeader = /^\d+\.\d+\s/.test(trimmed);
      if (isMainHeader || isSubHeader) {
        suggestions.push({
          text: trimmed,
          searchTerm: trimmed.replace(/^\d+\.?\d*\s*/, '').trim(),
          type: isMainHeader ? 'section' : 'subsection',
          priority: isMainHeader ? 10 : 8
        });
      }
      const words = trimmed.replace(/[^\wÀ-ú]/g, ' ').split(/\s+/);
      words.forEach(w => {
        const lower = w.toLowerCase();
        if (w.length >= 4 && !stopWords.has(lower) && !seenWords.has(lower) && !/^\d+$/.test(w)) {
          seenWords.add(lower);
          suggestions.push({ text: w, searchTerm: w, type: 'keyword', priority: 1 });
        }
      });
    });
    return suggestions;
  }

  function getRulesSuggestions() {
    if (!rulesSuggestionsCache) rulesSuggestionsCache = extractRulesKeywords();
    return rulesSuggestionsCache;
  }

  function renderRulesSuggestions(query) {
    const container = $('#rules-suggestions');
    if (!container) return;
    if (!query || query.length < 2) {
      // Show recent searches when focused and empty or short query
      if (rulesSearchHistory.length > 0 && query.length === 0) {
        showRecentSearches();
        return;
      }
      container.style.display = 'none';
      return;
    }
    const suggestions = getRulesSuggestions();
    const lower = query.toLowerCase();
    const matches = suggestions
      .filter(s => s.searchTerm.toLowerCase().includes(lower) || s.text.toLowerCase().includes(lower))
      .sort((a, b) => {
        const aStarts = a.searchTerm.toLowerCase().startsWith(lower) || a.text.toLowerCase().startsWith(lower);
        const bStarts = b.searchTerm.toLowerCase().startsWith(lower) || b.text.toLowerCase().startsWith(lower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return b.priority - a.priority;
      })
      .slice(0, 8);
    if (matches.length === 0) { container.style.display = 'none'; return; }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    container.innerHTML = matches.map((m, i) => {
      const icon = m.type === 'section' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h7"/></svg>'
        : m.type === 'subsection' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      const badge = m.type === 'section' ? 'Seção' : m.type === 'subsection' ? 'Subseção' : '';
      const highlighted = sanitize(m.text).replace(new RegExp('(' + escaped + ')', 'gi'), '<strong>$1</strong>');
      return `<div class="rules-suggestion-item${i === 0 ? ' rules-suggestion-active' : ''}" data-idx="${i}" data-search="${sanitize(m.searchTerm)}">
        <span class="rules-suggestion-icon">${icon}</span>
        <span class="rules-suggestion-text">${highlighted}</span>
        ${badge ? `<span class="rules-suggestion-badge">${badge}</span>` : ''}
      </div>`;
    }).join('');
    rulesSuggestionIdx = 0;
    container.style.display = '';
  }

  function showRecentSearches() {
    const container = $('#rules-suggestions');
    if (!container || rulesSearchHistory.length === 0) { if (container) container.style.display = 'none'; return; }
    container.innerHTML = '<div class="rules-suggestions-label">Pesquisas recentes</div>' +
      rulesSearchHistory.map((term, i) => {
        return `<div class="rules-suggestion-item rules-suggestion-recent" data-idx="${i}" data-search="${sanitize(term)}">
          <span class="rules-suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></span>
          <span class="rules-suggestion-text">${sanitize(term)}</span>
        </div>`;
      }).join('');
    rulesSuggestionIdx = -1;
    container.style.display = '';
  }

  function addToSearchHistory(term) {
    if (!term || term.length < 2) return;
    rulesSearchHistory = rulesSearchHistory.filter(t => t.toLowerCase() !== term.toLowerCase());
    rulesSearchHistory.unshift(term);
    if (rulesSearchHistory.length > 5) rulesSearchHistory.pop();
  }

  function navigateRulesSuggestions(dir) {
    const container = $('#rules-suggestions');
    if (!container || container.style.display === 'none') return false;
    const items = container.querySelectorAll('.rules-suggestion-item');
    if (items.length === 0) return false;
    if (rulesSuggestionIdx >= 0) items[rulesSuggestionIdx]?.classList.remove('rules-suggestion-active');
    rulesSuggestionIdx = (rulesSuggestionIdx + dir + items.length) % items.length;
    items[rulesSuggestionIdx]?.classList.add('rules-suggestion-active');
    items[rulesSuggestionIdx]?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function selectRulesSuggestion() {
    const container = $('#rules-suggestions');
    if (!container || container.style.display === 'none') return false;
    const active = container.querySelector('.rules-suggestion-active');
    if (!active) return false;
    const searchTerm = active.dataset.search;
    const searchInput = $('#rules-search-input');
    if (searchInput) searchInput.value = searchTerm;
    container.style.display = 'none';
    addToSearchHistory(searchTerm);
    showRulesContent(searchTerm);
    return true;
  }

  function hideRulesSuggestions() {
    const container = $('#rules-suggestions');
    if (container) container.style.display = 'none';
  }

  function openRulesModal() {
    const modal = $('#rules-general-modal');
    if (!modal) return;

    const editBtn = modal.querySelector('#rules-edit-btn');
    if (editBtn) editBtn.style.display = isAdmin ? '' : 'none';

    const searchInput = modal.querySelector('#rules-search-input');
    if (searchInput) searchInput.value = '';

    rulesSearchState = { total: 0, current: 0 };
    updateRulesSearchUI();
    showRulesContent();
    modal.querySelector('#rules-edit-area').style.display = 'none';
    modal.querySelector('#rules-content-display').style.display = '';
    modal.querySelector('#rules-no-results').style.display = 'none';
    modal.style.display = 'flex';

    // Focus search input
    setTimeout(() => { if (searchInput) searchInput.focus(); }, 100);
  }

  function showRulesContent(searchTerm) {
    const display = $('#rules-content-display');
    const noResults = $('#rules-no-results');
    if (!display) return;

    const { html, hasMatch, matchCount } = formatRulesHtml(getRulesText(), searchTerm);
    display.innerHTML = html;

    rulesSearchState.total = matchCount;
    rulesSearchState.current = matchCount > 0 ? 1 : 0;

    if (searchTerm && !hasMatch) {
      display.style.display = 'none';
      if (noResults) noResults.style.display = '';
    } else {
      display.style.display = '';
      if (noResults) noResults.style.display = 'none';
    }

    updateRulesSearchUI();

    // Scroll to first match
    if (matchCount > 0) {
      navigateToRulesMatch(1);
    }
  }

  function updateRulesSearchUI() {
    const statusEl = $('#rules-search-status');
    const countEl = $('#rules-search-count');
    const clearBtn = $('#rules-search-clear');
    const searchInput = $('#rules-search-input');
    const hasSearch = searchInput && searchInput.value.trim().length > 0;

    if (clearBtn) clearBtn.style.display = hasSearch ? '' : 'none';

    if (statusEl && countEl) {
      if (rulesSearchState.total > 0) {
        statusEl.style.display = '';
        countEl.textContent = `${rulesSearchState.current} de ${rulesSearchState.total}`;
        countEl.classList.remove('rules-search-no-match');
      } else if (hasSearch) {
        statusEl.style.display = '';
        countEl.textContent = 'Sem resultados';
        countEl.classList.add('rules-search-no-match');
      } else {
        statusEl.style.display = 'none';
      }
    }
  }

  function navigateToRulesMatch(idx) {
    const display = $('#rules-content-display');
    if (!display || rulesSearchState.total === 0) return;

    // Wrap around
    if (idx < 1) idx = rulesSearchState.total;
    if (idx > rulesSearchState.total) idx = 1;
    rulesSearchState.current = idx;
    updateRulesSearchUI();

    // Remove previous active
    display.querySelectorAll('.rules-highlight-active').forEach(el => {
      el.classList.remove('rules-highlight-active');
    });

    // Activate current
    const target = display.querySelector(`[data-match-idx="${idx}"]`);
    if (target) {
      // Auto-open parent section if collapsed
      const parentSection = target.closest('.rules-section');
      if (parentSection && !parentSection.classList.contains('rules-section-open')) {
        parentSection.classList.add('rules-section-open');
      }
      target.classList.add('rules-highlight-active');
      // Scroll into view
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function initRulesBindings() {
    const btnOpen = $('#btn-open-rules');
    if (btnOpen) btnOpen.addEventListener('click', openRulesModal);

    const modal = $('#rules-general-modal');
    if (!modal) return;

    // Close
    const closeBtn = modal.querySelector('#rules-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => { modal.style.display = 'none'; });

    // Toggle all sections
    const toggleAllBtn = modal.querySelector('#rules-toggle-all');
    if (toggleAllBtn) toggleAllBtn.addEventListener('click', () => {
      const display = modal.querySelector('#rules-content-display');
      if (!display) return;
      const allSections = display.querySelectorAll('.rules-section');
      const allOpen = [...allSections].every(s => s.classList.contains('rules-section-open'));
      allSections.forEach(s => {
        if (allOpen) s.classList.remove('rules-section-open');
        else s.classList.add('rules-section-open');
      });
    });

    // Search
    const searchInput = modal.querySelector('#rules-search-input');
    const clearBtn = modal.querySelector('#rules-search-clear');
    const prevBtn = modal.querySelector('#rules-search-prev');
    const nextBtn = modal.querySelector('#rules-search-next');

    if (searchInput) {
      let debounce = null;
      let suggestDebounce = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        clearTimeout(suggestDebounce);
        const val = searchInput.value.trim();
        // Show suggestions quickly
        suggestDebounce = setTimeout(() => renderRulesSuggestions(val), 100);
        // Perform actual search with slightly longer debounce
        debounce = setTimeout(() => {
          showRulesContent(val);
          if (val.length >= 2) addToSearchHistory(val);
        }, 350);
      });

      searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim()) showRecentSearches();
      });

      // Keyboard navigation
      searchInput.addEventListener('keydown', (e) => {
        const sugContainer = $('#rules-suggestions');
        const sugVisible = sugContainer && sugContainer.style.display !== 'none';

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (sugVisible) navigateRulesSuggestions(1);
          else renderRulesSuggestions(searchInput.value.trim());
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (sugVisible) navigateRulesSuggestions(-1);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (sugVisible && rulesSuggestionIdx >= 0) {
            selectRulesSuggestion();
          } else if (e.shiftKey) {
            navigateToRulesMatch(rulesSearchState.current - 1);
          } else {
            navigateToRulesMatch(rulesSearchState.current + 1);
          }
          return;
        }
        if (e.key === 'Escape') {
          if (sugVisible) { hideRulesSuggestions(); return; }
          searchInput.value = '';
          showRulesContent();
        }
        if (e.key === 'Tab' && sugVisible) {
          e.preventDefault();
          selectRulesSuggestion();
        }
      });

      // Close suggestions on click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.rules-search-wrapper')) hideRulesSuggestions();
      });
    }

    // Suggestion item clicks (delegated)
    const suggestionsContainer = modal.querySelector('#rules-suggestions');
    if (suggestionsContainer) {
      suggestionsContainer.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.rules-suggestion-item');
        if (!item) return;
        e.preventDefault();
        const searchTerm = item.dataset.search;
        if (searchInput) searchInput.value = searchTerm;
        hideRulesSuggestions();
        addToSearchHistory(searchTerm);
        showRulesContent(searchTerm);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        hideRulesSuggestions();
        showRulesContent();
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => navigateToRulesMatch(rulesSearchState.current - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateToRulesMatch(rulesSearchState.current + 1));

    // Edit
    const editBtn = modal.querySelector('#rules-edit-btn');
    const editArea = modal.querySelector('#rules-edit-area');
    const contentDisplay = modal.querySelector('#rules-content-display');
    const textarea = modal.querySelector('#rules-textarea');
    const saveBtn = modal.querySelector('#rules-save-btn');
    const cancelBtn = modal.querySelector('#rules-cancel-btn');
    const searchWrapper = modal.querySelector('.rules-search-wrapper');

    if (editBtn) editBtn.addEventListener('click', () => {
      textarea.value = getRulesText();
      editArea.style.display = '';
      contentDisplay.style.display = 'none';
      editBtn.style.display = 'none';
      if (searchWrapper) searchWrapper.style.display = 'none';
    });

    if (saveBtn) saveBtn.addEventListener('click', () => {
      state.tournamentRules = textarea.value;
      rulesSuggestionsCache = null;
      saveState();
      editArea.style.display = 'none';
      contentDisplay.style.display = '';
      if (editBtn) editBtn.style.display = '';
      if (searchWrapper) searchWrapper.style.display = '';
      if (searchInput) { searchInput.value = ''; }
      showRulesContent();
      showToast('Regras salvas com sucesso!', 'success');
    });

    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      editArea.style.display = 'none';
      contentDisplay.style.display = '';
      if (editBtn) editBtn.style.display = '';
      if (searchWrapper) searchWrapper.style.display = '';
    });
  }

  /* ==========================================================
     10. TEAM / PLAYER CRUD
     ========================================================== */

  /** Add a team+player to state */
  function handleAddTeam() {
    const teamInput = $('#team-name-input');
    const playerInput = $('#player-name-input');
    if (!teamInput || !playerInput) return;

    const teamName = teamInput.value.trim();
    const playerName = playerInput.value.trim();

    if (!teamName || !playerName) {
      showToast('Preencha o nome do time e do jogador.', 'error');
      return;
    }

    // Duplicate check (case-insensitive)
    const duplicate = state.teams.some(
      (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
    );
    if (duplicate) {
      showToast('Já existe um time com esse nome.', 'error');
      return;
    }

    // Max count check
    const maxTeams = parseInt($('#team-count').value, 10) || state.teamCount;
    if (state.teams.length >= maxTeams) {
      showToast(`Limite de ${maxTeams} times atingido.`, 'error');
      return;
    }

    const photoInput = $('#player-photo-input');
    const photoFile = photoInput && photoInput.files && photoInput.files[0];

    function finishAddTeam(photoData) {
      let assignedFlagId = null;
      let finalPhoto = photoData;

      const flagInput = $('#player-flag-input');
      const selectedFlag = flagInput ? flagInput.value : '';

      if (selectedFlag) {
        assignedFlagId = selectedFlag;
        if (!finalPhoto) finalPhoto = `https://flagcdn.com/${assignedFlagId}.svg`;
      } else if (!finalPhoto) {
        const takenFlags = state.teams.map(t => t.flagId).filter(f => f);
        const availableFlags = WORLD_FLAGS.filter(f => !takenFlags.includes(f.id));
        if (availableFlags.length > 0) {
          assignedFlagId = availableFlags[Math.floor(Math.random() * availableFlags.length)].id;
          finalPhoto = `https://flagcdn.com/${assignedFlagId}.svg`;
        }
      }

      const team = {
        id: generateId(),
        teamName,
        playerName,
        flagId: assignedFlagId,
        photo: finalPhoto
      };

      state.teams.push(team);
      saveState();

      // Clear inputs
      teamInput.value = '';
      playerInput.value = '';
      if (photoInput) photoInput.value = '';
      teamInput.focus();

      renderTeamList();
      showToast(`Time "${teamName}" adicionado!`, 'success');
    }

    if (photoFile) {
      resizeImageToBase64(photoFile).then(finishAddTeam).catch(() => finishAddTeam(null));
      return;
    }
    finishAddTeam(null);
  }

  /**
   * Remove team by id.
   * @param {string} id
   */
  function removeTeam(id) {
    const team = state.teams.find((t) => t.id === id);
    if (!team) return;

    // Remover do state.teams
    state.teams = state.teams.filter((t) => t.id !== id);

    // Se estiver no bracket, remover de lá também
    if (state.bracket && state.bracket.rounds) {
      state.bracket.rounds.forEach(r => {
        r.matches.forEach(m => {
          if (m.team1 && m.team1.playerName === team.playerName) m.team1 = null;
          if (m.team2 && m.team2.playerName === team.playerName) m.team2 = null;
        });
      });
    }

    // Gerar um novo código no lugar se o time for associado a um código usado
    if (state.codes) {
      const codeIndex = state.codes.findIndex(c => c.participantId === id);
      if (codeIndex !== -1) {
        // Gerar um código novo que não existe ainda
        let newCode;
        do {
          newCode = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        } while (state.codes.some(c => c.code === newCode));

        state.codes[codeIndex] = {
          code: newCode,
          status: 'available',
          participantId: null
        };
      }
    }

    saveState();
    renderTeamList();
    if (state.bracket) renderBracket();
    if (isAdmin) renderCodesList();
    showToast(`Time "${team.teamName}" removido. Código novo gerado (se era participante).`, 'info');
  }

  /** Render the team list in sidebar */
  function renderTeamList() {
    const container = $('#team-list');
    if (!container) return;

    const maxTeams = parseInt(($('#team-count') || {}).value, 10) || state.teamCount;

    if (state.teams.length === 0) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:12px 0;">Nenhum time cadastrado</p>`;
      return;
    }

    let html = `<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;font-weight:600;">${state.teams.length}/${maxTeams} times cadastrados</p>`;

    state.teams.forEach((team) => {
      // Get the full name from participants state if available
      const p = state.participants ? state.participants.find(part => part.id === team.id) : null;
      const fullName = p ? p.name : team.playerName;

      html += `
        <div class="team-item clickable-team" data-id="${sanitize(team.id)}">
          <div class="team-item-info">
            <div class="team-avatar">${team.photo ? '<img src="' + sanitize(team.photo) + '" alt="">' : '<span class="av-placeholder">' + sanitize(initials(team.playerName)) + '</span>'}</div>
            <div>
              <div style="font-size:13px;font-weight:700;color:#ffffff;">${sanitize(team.teamName)}</div>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">${sanitize(fullName)}</div>
            </div>
          </div>
          <button type="button" class="btn-remove-team icon-btn" data-team-id="${sanitize(team.id)}" title="Remover time" aria-label="Remover time"><svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>`;
    });

    container.innerHTML = html;

    // Attach click handlers for opening profile
    container.querySelectorAll('.clickable-team').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-team')) return;
        openPlayerProfile(el.dataset.id);
      });
    });

    // Attach remove handlers
    container.querySelectorAll('.btn-remove-team').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeTeam(btn.dataset.teamId);
      });
    });

    // Update client select if admin
    if (isAdmin) {
      populateClientSelect();
    }
  }

  /* ==========================================================
     11. TOURNAMENT GENERATION
     ========================================================== */

  /** Build a team slot data object from a team record */
  function makeTeamSlotData(t) {
    if (!t) return { id: null, teamName: 'TBD', playerName: 'TBD', score: null };
    const slot = { id: t.id, teamName: t.teamName, playerName: t.playerName, score: null };
    return slot;
  }

  /**
   * Return the next power of 2 >= n.
   * @param {number} n
   * @returns {number}
   */
  function nextPowerOf2(n) {
    if (n <= 1) return 2;
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /**
   * Check if a team slot is a BYE.
   * @param {object|null} team
   * @returns {boolean}
   */
  function isByeTeam(team) {
    return team && team.isBye === true;
  }

  /**
   * Determine round names based on total number of bracket slots (power of 2).
   * Accepts any participant count — will calculate from the next power of 2.
   * @param {number} teamCount
   * @returns {string[]}
   */
  function getRoundNames(teamCount) {
    const totalSlots = nextPowerOf2(teamCount);
    const numRounds = Math.round(Math.log2(totalSlots));
    if (numRounds <= 0) return ['Final'];

    const names = [];
    for (let i = 0; i < numRounds; i++) {
      const matchesInRound = totalSlots / Math.pow(2, i + 1);
      if (matchesInRound === 1) names.push('Final');
      else if (matchesInRound === 2) names.push('Semifinal');
      else if (matchesInRound === 4) names.push('Quartas de Final');
      else if (matchesInRound === 8) names.push('Oitavas de Final');
      else if (matchesInRound === 16) names.push('Dezesseis Avos');
      else names.push(`Fase ${i + 1} (${matchesInRound * 2} participantes)`);
    }
    return names;
  }

  /**
   * Create an empty match object.
   */
  function createEmptyMatch(rIdx, m) {
    return {
      id: `r${rIdx}m${m}`,
      team1: null,
      team2: null,
      winner: null,
      penalties: null,
      dateTime: null,
      status: 'not_started',
      liveEvents: [],
      liveStartedAt: null,
      liveElapsed: 0
    };
  }

  /**
   * Create a BYE team slot.
   */
  function makeBye() {
    return { id: 'bye', teamName: 'BYE', playerName: 'BYE', score: null, isBye: true };
  }

  /**
   * Build the bracket rounds with BYE support for any participant count.
   * @param {Array} shuffledTeams - pre-shuffled team list
   * @param {number} requestedCount - total participants (can be non-power-of-2)
   * @returns {{ rounds: Array }}
   */
  function buildBracketStructure(shuffledTeams, requestedCount) {
    const totalSlots = nextPowerOf2(requestedCount);
    const numByes = totalSlots - requestedCount;
    const numFirstRoundMatches = totalSlots / 2;
    const roundNames = getRoundNames(requestedCount);

    // Distribute byes evenly between top/bottom halves
    const byeMatchIndices = new Set();
    let top = numFirstRoundMatches - 1;
    let bottom = 0;
    for (let i = 0; i < numByes; i++) {
      if (i % 2 === 0) {
        byeMatchIndices.add(top--);
      } else {
        byeMatchIndices.add(bottom++);
      }
    }

    let matchesInRound = numFirstRoundMatches;
    const rounds = [];
    let teamIdx = 0;

    roundNames.forEach((name, rIdx) => {
      const matches = [];
      for (let m = 0; m < matchesInRound; m++) {
        const match = createEmptyMatch(rIdx, m);

        if (rIdx === 0) {
          if (byeMatchIndices.has(m)) {
            // BYE match: 1 real team auto-advances
            if (teamIdx < shuffledTeams.length) {
              match.team1 = makeTeamSlotData(shuffledTeams[teamIdx++]);
            }
            match.team2 = makeBye();
            match.winner = 1;
            match.status = 'finished';
          } else {
            // Real match
            if (teamIdx < shuffledTeams.length) {
              match.team1 = makeTeamSlotData(shuffledTeams[teamIdx++]);
            }
            if (teamIdx < shuffledTeams.length) {
              match.team2 = makeTeamSlotData(shuffledTeams[teamIdx++]);
            }
          }
        }

        matches.push(match);
      }
      rounds.push({ name, matches });
      matchesInRound = Math.floor(matchesInRound / 2);
    });

    // Auto-advance BYE winners to next round
    if (rounds.length > 1) {
      const firstRound = rounds[0];
      const secondRound = rounds[1];
      firstRound.matches.forEach((match, mIdx) => {
        if (match.winner && isByeTeam(match.team2)) {
          const nextMatchIdx = Math.floor(mIdx / 2);
          const nextMatch = secondRound.matches[nextMatchIdx];
          if (nextMatch) {
            const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
            nextMatch[slot] = makeTeamSlotData(match.team1);
          }
        }
      });
    }

    const bracketObj = { rounds, repescagemPool: [], thirdChancePool: [] };
    if (requestedCount >= 4) {
      bracketObj.thirdPlaceMatch = createEmptyMatch(-1, 0);
    }
    
    return bracketObj;
  }

  /* ==========================================================
     11b. REPESCAGEM (LOSERS BRACKET) SYSTEM
     Fully recalculated from current match results every time.
     No persistent pool — if a match is reset, the loser is gone.
     ========================================================== */

  /** Password required to reset a match */
  const RESET_PASSWORD = '153090';

  /**
   * Sort repescagem candidates by ranking criteria:
   * 1. Fewer goals conceded (ASC)
   * 2. More goals scored (DESC)
   * 3. Better goal difference (DESC)
   * 4. Smaller loss margin (ASC)
   * 5. Shorter match time (ASC)
   */
  function rankRepescagemCandidates(candidates) {
    return [...candidates].sort((a, b) => {
      if (a.goalsConceded !== b.goalsConceded) return a.goalsConceded - b.goalsConceded;
      if (a.goalsScored !== b.goalsScored) return b.goalsScored - a.goalsScored;
      if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (a.lossMargin !== b.lossMargin) return a.lossMargin - b.lossMargin;
      return a.matchElapsed - b.matchElapsed;
    });
  }

  /**
   * Check if a team slot was placed via repescagem.
   */
  function isRepescagemTeam(teamSlot) {
    return teamSlot && teamSlot.isRepescagem === true;
  }

  /**
   * Check if a team is a third-chance team.
   */
  function isThirdChanceTeam(teamSlot) {
    return teamSlot && teamSlot.isThirdChance === true;
  }

  /**
   * Check if a slot in a given round/match is a STRUCTURAL void:
   * the feeder match doesn't exist, has no real teams, or is finished
   * without producing a result for this slot.
   * A slot WAITING for an unfinished match is NOT a void.
   */
  function isStructuralVoid(bracket, rIdx, mIdx, slot) {
    if (rIdx <= 0) return false;
    const prevRound = bracket.rounds[rIdx - 1];
    if (!prevRound) return true;

    const feederIdx = slot === 'team1' ? mIdx * 2 : mIdx * 2 + 1;
    const feederMatch = prevRound.matches[feederIdx];

    if (!feederMatch) return true;

    const t1Real = feederMatch.team1 && !isByeTeam(feederMatch.team1);
    const t2Real = feederMatch.team2 && !isByeTeam(feederMatch.team2);
    if (!t1Real && !t2Real) return true;

    if (feederMatch.status === 'finished' && !feederMatch.winner) return true;
    if (feederMatch.winner) return true;

    return false;
  }

  /**
   * CORE: Rebuild repescagem state entirely from current match results.
   * Scans ALL finished matches, collects losers, ranks them, and
   * places them into empty slots in the SAME round they lost in.
   * Losers do NOT advance to higher rounds — they fill the next
   * available empty slot "below" in the same phase.
   * Returns { pool, thirdChancePool, placements } for rendering.
   */
  function recalcRepescagem() {
    const bracket = getCurrentBracket();
    if (!bracket || !bracket.rounds) return { pool: [], thirdChancePool: [], placements: [] };

    // --- Pre-scan: track teams that were placed via repescagem / thirdChance
    //     and whether they WON or LOST that match.  This prevents:
    //     1) Re-placing a team that already won its repescagem match (duplication bug)
    //     2) Treating a repescagem loser as a fresh candidate instead of 3rd-chance
    const repWinners = new Set();   // team IDs that WON their repescagem match
    const repLosers = new Set();   // team IDs that LOST their repescagem match
    const thirdWinners = new Set();
    const thirdLosers = new Set();

    bracket.rounds.forEach((round) => {
      round.matches.forEach((match) => {
        if (!match.winner) return;
        for (const slotName of ['team1', 'team2']) {
          const t = match[slotName];
          if (!t) continue;
          const isWinner = (slotName === 'team1' && match.winner === 1) ||
            (slotName === 'team2' && match.winner === 2);
          if (t.isThirdChance) {
            (isWinner ? thirdWinners : thirdLosers).add(t.id);
          } else if (t.isRepescagem) {
            (isWinner ? repWinners : repLosers).add(t.id);
          }
        }
      });
    });

    // Collect ALL losers from finished matches with their stats
    const losers = [];
    const loserIds = new Set();

    bracket.rounds.forEach((round, rIdx) => {
      round.matches.forEach((match, mIdx) => {
        if (!match.winner) return;
        if (isByeTeam(match.team1) || isByeTeam(match.team2)) return;

        const loserNum = match.winner === 1 ? 2 : 1;
        const loserTeam = loserNum === 1 ? match.team1 : match.team2;
        if (!loserTeam || isByeTeam(loserTeam)) return;
        if (loserIds.has(loserTeam.id)) return;

        // Skip teams that already WON their repescagem/thirdChance match
        // (they advanced normally — no need to re-place them)
        if (repWinners.has(loserTeam.id)) return;
        if (thirdWinners.has(loserTeam.id)) return;

        // Determine wasRepescagem / wasThirdChance:
        // The loserIds dedup means we may be seeing the ORIGINAL loss, but the
        // team already played (and lost) a repescagem match recorded elsewhere.
        const wasRepescagem = !!loserTeam.isRepescagem || repLosers.has(loserTeam.id);
        const wasThirdChance = !!loserTeam.isThirdChance || thirdLosers.has(loserTeam.id);

        const goalsScored = loserTeam.score || 0;
        const goalsConceded = loserNum === 1 ? (match.team2 ? match.team2.score || 0 : 0)
          : (match.team1 ? match.team1.score || 0 : 0);
        const goalDiff = goalsScored - goalsConceded;

        losers.push({
          team: { id: loserTeam.id, teamName: loserTeam.teamName, playerName: loserTeam.playerName },
          goalsScored,
          goalsConceded,
          goalDiff,
          lossMargin: Math.abs(goalDiff),
          matchElapsed: match.liveElapsed || 0,
          roundIdx: rIdx,
          matchIdx: mIdx,
          wasRepescagem,
          wasThirdChance
        });
        loserIds.add(loserTeam.id);
      });
    });

    // Separate: regular losers → repescagem pool, repescagem losers → 3rd chance
    const repescagemPool = losers.filter(e => !e.wasRepescagem);
    const thirdChancePool = losers.filter(e => e.wasRepescagem && !e.wasThirdChance);

    // Group ALL candidates by the round they lost in
    const candidatesByRound = {};
    for (const entry of repescagemPool) {
      if (!candidatesByRound[entry.roundIdx]) candidatesByRound[entry.roundIdx] = [];
      candidatesByRound[entry.roundIdx].push({ ...entry, type: 'repescagem' });
    }
    for (const entry of thirdChancePool) {
      if (!candidatesByRound[entry.roundIdx]) candidatesByRound[entry.roundIdx] = [];
      candidatesByRound[entry.roundIdx].push({ ...entry, type: 'thirdChance' });
    }

    // For each round, rank the candidates and fill empty slots in THAT round
    const placements = [];
    let usedFromPool = 0;
    let usedFromThird = 0;

    for (const rIdxStr of Object.keys(candidatesByRound).sort((a, b) => +a - +b)) {
      const rIdx = parseInt(rIdxStr, 10);
      const round = bracket.rounds[rIdx];
      if (!round) continue;

      // Rank: repescagem first, then thirdChance (they're mixed, so separate, rank, then concatenate)
      const repCandidates = rankRepescagemCandidates(candidatesByRound[rIdx].filter(e => e.type === 'repescagem'));
      const thirdCandidates = rankRepescagemCandidates(candidatesByRound[rIdx].filter(e => e.type === 'thirdChance'));
      const ranked = [...repCandidates, ...thirdCandidates];

      let candidateIdx = 0;

      // Scan matches in this round for empty slots
      for (let mIdx = 0; mIdx < round.matches.length && candidateIdx < ranked.length; mIdx++) {
        const match = round.matches[mIdx];
        if (match.winner) continue; // Match already finished
        if (isByeTeam(match.team1) || isByeTeam(match.team2)) continue;

        for (const slotName of ['team1', 'team2']) {
          if (candidateIdx >= ranked.length) break;
          if (match[slotName]) continue; // Slot already occupied

          // For round 0: any empty slot is valid
          // For round 1+: only structural voids (not slots waiting for a winner)
          if (rIdx > 0 && !isStructuralVoid(bracket, rIdx, mIdx, slotName)) continue;

          const entry = ranked[candidateIdx];
          placements.push({ rIdx, mIdx, slot: slotName, entry, type: entry.type });
          if (entry.type === 'repescagem') usedFromPool++;
          else usedFromThird++;
          candidateIdx++;
        }
      }
    }

    return {
      pool: rankRepescagemCandidates(repescagemPool),
      thirdChancePool: rankRepescagemCandidates(thirdChancePool),
      placements,
      usedFromPool,
      usedFromThird
    };
  }

  /**
   * Apply repescagem placements to the bracket.
   * Called after any result change (confirm score, finalize live, reset).
   */
  function applyRepescagem() {
    const bracket = getCurrentBracket();
    if (!bracket || !bracket.rounds) return;

    // Strip all existing repescagem placements from matches without winner
    // (they'll be recalculated from scratch)
    for (let rIdx = 0; rIdx < bracket.rounds.length; rIdx++) {
      const round = bracket.rounds[rIdx];
      for (let mIdx = 0; mIdx < round.matches.length; mIdx++) {
        const match = round.matches[mIdx];
        if (match.winner) continue; // Don't touch finished matches

        for (const slotName of ['team1', 'team2']) {
          const t = match[slotName];
          if (t && isRepescagemTeam(t)) {
            // This was a repescagem placement — clear it for recalculation
            match[slotName] = null;
          }
        }
      }
    }

    // Recalculate from scratch
    const result = recalcRepescagem();

    // Apply placements
    result.placements.forEach(p => {
      const match = bracket.rounds[p.rIdx].matches[p.mIdx];
      if (!match) return;
      const teamData = makeTeamSlotData(p.entry.team);
      teamData.isRepescagem = true;
      if (p.type === 'thirdChance') {
        teamData.isThirdChance = true;
      }
      match[p.slot] = teamData;
    });

    // Store result for panel rendering
    bracket._lastRepescagemResult = result;
  }

  /**
   * Render the repescagem pool panel.
   */
  function renderRepescagemPanel() {
    let panel = $('#repescagem-panel');
    if (!panel) return;

    const bracket = getCurrentBracket();
    if (!bracket) { panel.innerHTML = ''; panel.style.display = 'none'; return; }

    const result = bracket._lastRepescagemResult || recalcRepescagem();

    if (result.pool.length === 0 && result.thirdChancePool.length === 0) {
      panel.innerHTML = '';
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';

    const usedFromPool = result.usedFromPool || 0;
    const availablePool = result.pool.slice(usedFromPool);
    const usedPool = result.pool.slice(0, usedFromPool);
    const usedFromThird = result.usedFromThird || 0;
    const availableThird = result.thirdChancePool.slice(usedFromThird);
    const usedThird = result.thirdChancePool.slice(0, usedFromThird);

    let html = `
      <div class="repescagem-header">
        <span class="repescagem-icon">&#128260;</span>
        <h3>Repescagem</h3>
        <span class="repescagem-count">${availablePool.length} disponível(eis)</span>
      </div>
    `;

    if (availablePool.length > 0) {
      html += '<div class="repescagem-list">';
      availablePool.forEach((entry, i) => {
        const t = entry.team;
        const ini = initials(t.playerName || t.teamName);
        const tPhoto = getTeamPhoto(t);
        const avatar = tPhoto
          ? `<img src="${sanitize(tPhoto)}" alt="" class="repescagem-avatar">`
          : `<span class="repescagem-avatar-placeholder">${sanitize(ini)}</span>`;
        html += `
          <div class="repescagem-item">
            <span class="repescagem-rank">#${i + 1}</span>
            ${avatar}
            <div class="repescagem-info">
              <span class="repescagem-name">${sanitize(t.teamName || t.playerName)}</span>
              <span class="repescagem-stats">GS: ${entry.goalsScored} | GC: ${entry.goalsConceded} | Saldo: ${entry.goalDiff}</span>
            </div>
          </div>`;
      });
      html += '</div>';
    }

    if (usedPool.length > 0) {
      html += `<div class="repescagem-used-label">Recolocados (${usedPool.length})</div>`;
      html += '<div class="repescagem-list repescagem-used">';
      usedPool.forEach(entry => {
        const t = entry.team;
        html += `<div class="repescagem-item used"><span class="repescagem-name">${sanitize(t.teamName || t.playerName)}</span> <span class="repescagem-badge-orange">REPESCAGEM</span></div>`;
      });
      html += '</div>';
    }

    if (availableThird.length > 0 || usedThird.length > 0) {
      html += `<div class="repescagem-third-label">3ª Chance (${availableThird.length} disponível)</div>`;
      const allThird = [...usedThird, ...availableThird];
      html += '<div class="repescagem-list repescagem-third">';
      allThird.forEach(entry => {
        const t = entry.team;
        const isUsed = usedThird.includes(entry);
        const badge = isUsed ? '<span class="repescagem-badge-third">3ª CHANCE</span>' : '';
        html += `<div class="repescagem-item third"><span class="repescagem-name">${sanitize(t.teamName || t.playerName)}</span> ${badge}</div>`;
      });
      html += '</div>';
    }

    panel.innerHTML = html;
  }

  /**
   * Update the bracket info display next to the team count input.
   */
  function updateTeamCountInfo() {
    const infoEl = $('#team-count-info');
    if (!infoEl) return;
    const countInput = $('#team-count');
    const count = parseInt(countInput ? countInput.value : state.teamCount, 10);
    if (isNaN(count) || count < 2) {
      infoEl.textContent = 'Mínimo: 2 participantes';
      infoEl.style.color = 'var(--error)';
      return;
    }
    const totalSlots = nextPowerOf2(count);
    const numByes = totalSlots - count;
    const numRounds = Math.round(Math.log2(totalSlots));
    let info = `${numRounds} fase${numRounds > 1 ? 's' : ''}`;
    if (numByes > 0) {
      info += ` • ${numByes} bye${numByes > 1 ? 's' : ''} (classificação automática)`;
    }
    infoEl.textContent = info;
    infoEl.style.color = 'var(--on-surface-variant)';
  }

  /** Toggle group config visibility and update UI labels based on format selection */
  function toggleGroupsConfig() {
    const formatSelect = $('#tournament-format');
    const groupsConfig = $('#groups-config');
    const groupsTabBtn = $('#groups-tab-btn');
    const bracketTabBtn = $('#bracket-tab-btn');
    const shuffleLabel = $('#btn-shuffle-label');
    const generateLabel = $('#btn-generate-label');
    const refreshLabel = $('#btn-refresh-label');
    const teamCountGroup = $('#team-count-group');
    if (!formatSelect) return;
    const isGroups = formatSelect.value === 'groups';
    if (teamCountGroup) teamCountGroup.style.display = isGroups ? 'none' : '';
    if (groupsConfig) groupsConfig.style.display = isGroups ? '' : 'none';
    if (groupsTabBtn) groupsTabBtn.style.display = (isGroups && state.groups) ? '' : 'none';
    if (bracketTabBtn) bracketTabBtn.textContent = isGroups ? 'Mata-Mata' : 'Chaveamento';
    if (shuffleLabel) shuffleLabel.textContent = isGroups ? 'Embaralhar Grupos' : 'Embaralhar Chaveamento';
    if (generateLabel) generateLabel.textContent = isGroups ? 'Gerar Fase de Grupos' : 'Gerar Chaveamento';
    if (refreshLabel) refreshLabel.textContent = isGroups ? 'Atualizar Grupos' : 'Atualizar Chaveamento';
  }

  /* ==========================================================
     11c. GROUP STAGE SYSTEM
     ========================================================== */

  /**
   * Build group stage structure.
   * Distributes teams across N groups in snake-draft order.
   */
  function buildGroupStage(teams, numGroups) {
    const shuffled = shuffleArray([...teams]);
    const groups = [];
    for (let g = 0; g < numGroups; g++) {
      groups.push({
        id: `group-${g}`,
        name: `Grupo ${String.fromCharCode(65 + g)}`,
        teams: [],
        matches: [],
        standings: []
      });
    }
    // Snake-draft distribution
    shuffled.forEach((team, i) => {
      const cycle = Math.floor(i / numGroups);
      const pos = i % numGroups;
      const gIdx = cycle % 2 === 0 ? pos : numGroups - 1 - pos;
      groups[gIdx].teams.push({ ...team });
    });
    // Generate round-robin matches for each group
    groups.forEach(group => {
      group.matches = generateRoundRobin(group.teams);
      group.standings = calcGroupStandings(group);
    });
    return groups;
  }

  /**
   * Generate round-robin matches for a list of teams.
   * If twoLegged is enabled, each match has ida/volta scores.
   * Returns array of match objects.
   */
  function generateRoundRobin(teams) {
    const matches = [];
    const useTwoLegged = !!state.twoLegged;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const m = {
          id: generateId(),
          team1: { id: teams[i].id, teamName: teams[i].teamName, playerName: teams[i].playerName, score: null },
          team2: { id: teams[j].id, teamName: teams[j].teamName, playerName: teams[j].playerName, score: null },
          winner: null,
          status: 'not_started',
          penalties: null,
          dateTime: null,
          twoLegged: useTwoLegged
        };
        if (useTwoLegged) {
          m.ida = { score1: null, score2: null };
          m.volta = { score1: null, score2: null };
        }
        matches.push(m);
      }
    }
    return matches;
  }

  /**
   * Calculate standings for a group from its match results.
   * Criteria: Points > Goal Diff > Goals Scored > Head-to-head
   */
  function calcGroupStandings(group) {
    const stats = {};
    group.teams.forEach(t => {
      stats[t.id] = {
        id: t.id, teamName: t.teamName, playerName: t.playerName,
        played: 0, wins: 0, draws: 0, losses: 0,
        goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0
      };
    });
    group.matches.forEach(m => {
      // For single leg, skip if no score. For two legs, allow partial processing
      if (!m.twoLegged && (m.team1.score == null || m.team2.score == null)) return;
      const t1 = stats[m.team1.id], t2 = stats[m.team2.id];
      if (!t1 || !t2) return;

      if (m.twoLegged && m.ida && m.volta) {
        // Count each leg as a separate game
        // Ida
        if (m.ida.score1 != null && m.ida.score2 != null) {
          t1.played++; t2.played++;
          t1.goalsFor += m.ida.score1; t1.goalsAgainst += m.ida.score2;
          t2.goalsFor += m.ida.score2; t2.goalsAgainst += m.ida.score1;
          if (m.ida.score1 > m.ida.score2) { t1.wins++; t2.losses++; t1.points += 3; }
          else if (m.ida.score2 > m.ida.score1) { t2.wins++; t1.losses++; t2.points += 3; }
          else { t1.draws++; t2.draws++; t1.points += 1; t2.points += 1; }
        }
        // Volta
        if (m.volta.score1 != null && m.volta.score2 != null) {
          t1.played++; t2.played++;
          t1.goalsFor += m.volta.score1; t1.goalsAgainst += m.volta.score2;
          t2.goalsFor += m.volta.score2; t2.goalsAgainst += m.volta.score1;
          if (m.volta.score1 > m.volta.score2) { t1.wins++; t2.losses++; t1.points += 3; }
          else if (m.volta.score2 > m.volta.score1) { t2.wins++; t1.losses++; t2.points += 3; }
          else { t1.draws++; t2.draws++; t1.points += 1; t2.points += 1; }
        }
      } else {
        // Single match
        const s1 = m.team1.score, s2 = m.team2.score;
        t1.played++; t2.played++;
        t1.goalsFor += s1; t1.goalsAgainst += s2;
        t2.goalsFor += s2; t2.goalsAgainst += s1;
        if (s1 > s2) { t1.wins++; t2.losses++; t1.points += 3; }
        else if (s2 > s1) { t2.wins++; t1.losses++; t2.points += 3; }
        else { t1.draws++; t2.draws++; t1.points += 1; t2.points += 1; }
      }
      t1.goalDiff = t1.goalsFor - t1.goalsAgainst;
      t2.goalDiff = t2.goalsFor - t2.goalsAgainst;
    });
    const arr = Object.values(stats);
    arr.sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      return 0;
    });
    return arr;
  }

  /**
   * Recalculate all group standings from current match results.
   */
  function recalcAllGroupStandings() {
    const groups = getCurrentGroups();
    if (!groups) return;
    groups.forEach(group => {
      group.standings = calcGroupStandings(group);
    });
  }

  /**
   * Get classification result from group stage.
   * Returns { directQualified, repechagePlayers, bestThird }
   */
  function getGroupClassification() {
    if (!state.groups) return { directQualified: [], repechagePlayers: [], bestThird: null };

    recalcAllGroupStandings();

    const directQualified = [];
    const secondPlaced = [];
    const thirdPlaced = [];

    state.groups.forEach(group => {
      const s = group.standings;
      if (s.length >= 1) directQualified.push({ ...s[0], groupName: group.name });
      if (s.length >= 2) secondPlaced.push({ ...s[1], groupName: group.name });
      if (s.length >= 3) thirdPlaced.push({ ...s[2], groupName: group.name });
    });

    // Rank 3rd-placed teams to find the best one
    thirdPlaced.sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      return 0;
    });

    const bestThird = thirdPlaced.length > 0 ? thirdPlaced[0] : null;

    // Repechage: all 2nd place + best 3rd
    const repechagePlayers = [...secondPlaced];
    if (bestThird) repechagePlayers.push(bestThird);

    // Rank repechage players for seeding
    repechagePlayers.sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      return 0;
    });

    return { directQualified, repechagePlayers, bestThird };
  }

  /**
   * Check if all group stage matches are finished.
   */
  function areAllGroupMatchesFinished() {
    if (!state.groups) return false;
    return state.groups.every(g => g.matches.every(m => m.team1.score != null && m.team2.score != null));
  }

  /**
   * Generate bracket from group stage results.
   * 5 direct qualifiers + 3 repechage winners = 8 in quarterfinals.
   * This creates a repechage mini-bracket, then the main bracket.
   */
  function generateBracketFromGroups(isUpdate = false) {
    if (isUpdate instanceof Event) isUpdate = false;

    if (!areAllGroupMatchesFinished()) {
      showToast('Todos os jogos dos grupos precisam ter resultado antes de gerar o mata-mata.', 'error');
      return;
    }

    const { directQualified, repechagePlayers } = getGroupClassification();

    // Build repechage bracket: 6 players → 3 matches → 3 winners
    // Best 2nd vs Best 3rd, 2nd vs 5th, 3rd vs 4th (seeded)
    const repechageMatches = [];
    if (repechagePlayers.length >= 6) {
      // 1st seed (best 2nd) vs 6th seed (best 3rd) 
      repechageMatches.push({ a: repechagePlayers[0], b: repechagePlayers[5] });
      // 2nd seed vs 5th seed
      repechageMatches.push({ a: repechagePlayers[1], b: repechagePlayers[4] });
      // 3rd seed vs 4th seed
      repechageMatches.push({ a: repechagePlayers[2], b: repechagePlayers[3] });
    } else {
      // Fallback: pair them sequentially
      for (let i = 0; i < repechagePlayers.length; i += 2) {
        if (repechagePlayers[i + 1]) {
          repechageMatches.push({ a: repechagePlayers[i], b: repechagePlayers[i + 1] });
        } else {
          directQualified.push(repechagePlayers[i]); // odd one out goes direct
        }
      }
    }

    // Store repechage matches in state
    state.groupRepechage = repechageMatches.map(pair => ({
      id: generateId(),
      team1: { id: pair.a.id, teamName: pair.a.teamName, playerName: pair.a.playerName, score: null },
      team2: { id: pair.b.id, teamName: pair.b.teamName, playerName: pair.b.playerName, score: null },
      winner: null, status: 'not_started', penalties: null, dateTime: null
    }));
    state.groupDirectQualified = directQualified;

    saveState();

    if (!isUpdate) {
      // Switch to bracket tab to show repechage matches
      const bracketTabBtn = document.querySelector('[data-tab="bracket-tab"]');
      if (bracketTabBtn) bracketTabBtn.click();
      else renderBracket();

      showToast('Fase de grupos encerrada! Defina os resultados da repescagem.', 'success');
    } else {
      showToast('Repescagem atualizada em tempo real.', 'info');
    }
  }

  /**
   * Finalize repechage: collect winners + direct qualified → build knockout bracket.
   */
  function finalizeGroupRepechage() {
    if (!state.groupRepechage) return;

    const allDone = state.groupRepechage.every(m => m.winner);
    if (!allDone) {
      showToast('Todas as partidas da repescagem precisam ter resultado.', 'error');
      return;
    }

    const qualified = [...(state.groupDirectQualified || [])];
    state.groupRepechage.forEach(m => {
      const winner = m.winner === 1 ? m.team1 : m.team2;
      qualified.push(winner);
    });

    const teamsForBracket = qualified.map(t => ({
      id: t.id, teamName: t.teamName, playerName: t.playerName
    }));

    openManualDrawModal(teamsForBracket);
  }

  function executeFinalizeBracket(sortedTeams) {
    state.teamCount = sortedTeams.length;
    state.bracket = buildBracketStructure(sortedTeams, sortedTeams.length);
    state.bracketFromGroups = true;
    state.champion = null;
    saveState();

    // Switch to bracket tab
    const bracketTabBtn = document.querySelector('[data-tab="bracket-tab"]');
    if (bracketTabBtn) bracketTabBtn.click();

    renderBracket();
    showToast(`Mata-mata gerado com ${sortedTeams.length} classificados!`, 'success');
  }

  function openManualDrawModal(teams) {
    let modal = document.getElementById('manual-draw-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'manual-draw-modal';
      modal.className = 'modal-overlay';
      modal.style.zIndex = '10000';
      document.body.appendChild(modal);
    }

    const matchCount = Math.floor(teams.length / 2);
    let html = `
      <div class="modal-content" style="max-width: 500px; max-height: 90vh; overflow-y: auto;">
        <h2 class="modal-title">Sorteio Manual (Mata-Mata)</h2>
        <p class="modal-subtitle">Defina os confrontos escolhendo os times para cada partida:</p>
        <div class="manual-draw-form">
    `;

    for (let i = 0; i < matchCount; i++) {
      html += `
        <div class="manual-match-group" style="margin-bottom:15px; padding:15px; background:var(--surface-bg, #222); border-radius:8px; border:1px solid var(--border-color, #444);">
          <div style="font-weight:600; margin-bottom:10px; color:var(--text-color, #fff); text-align:center;">Partida ${i + 1}</div>
          <select class="draw-select" style="width:100%; margin-bottom:10px; padding:10px; border-radius:6px; border:1px solid var(--border-color, #444); background:var(--bg-color, #111); color:var(--text-color, #fff); font-size:14px;">
            <option value="">-- Selecione o Time 1 --</option>
            ${teams.map((t, idx) => `<option value="${idx}">${sanitize(t.playerName || t.teamName)}</option>`).join('')}
          </select>
          <div style="text-align:center; font-size:12px; color:var(--text-muted, #aaa); margin-bottom:10px; font-weight:bold;">VS</div>
          <select class="draw-select" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border-color, #444); background:var(--bg-color, #111); color:var(--text-color, #fff); font-size:14px;">
            <option value="">-- Selecione o Time 2 --</option>
            ${teams.map((t, idx) => `<option value="${idx}">${sanitize(t.playerName || t.teamName)}</option>`).join('')}
          </select>
        </div>
      `;
    }

    html += `
        </div>
        <div class="modal-actions" style="margin-top:20px; display:flex; gap:10px;">
          <button type="button" class="btn btn-outline" id="btn-cancel-draw" style="flex:1;">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-random-draw" style="flex:1;" title="Sortear Aleatoriamente">Aleatório</button>
          <button type="button" class="btn btn-primary" id="btn-confirm-draw" style="flex:1; background-color:var(--accent-green, #28a745); border-color:var(--accent-green, #28a745);">Confirmar</button>
        </div>
      </div>
    `;

    modal.innerHTML = html;
    modal.style.display = 'flex';

    const selects = modal.querySelectorAll('.draw-select');

    const updateSelectOptions = () => {
      const selectedValues = new Set();
      selects.forEach(s => {
        if (s.value !== "") selectedValues.add(s.value);
      });

      selects.forEach(s => {
        const currentValue = s.value;
        Array.from(s.options).forEach(opt => {
          if (opt.value === "") return;
          if (selectedValues.has(opt.value) && opt.value !== currentValue) {
            opt.style.display = 'none';
            opt.disabled = true;
          } else {
            opt.style.display = '';
            opt.disabled = false;
          }
        });
      });
    };

    selects.forEach(s => s.addEventListener('change', updateSelectOptions));

    modal.querySelector('#btn-cancel-draw').onclick = () => {
      modal.style.display = 'none';
    };

    modal.querySelector('#btn-random-draw').onclick = () => {
      let indices = teams.map((_, i) => i);
      indices = shuffleArray(indices);
      selects.forEach((s, i) => {
        if (indices[i] !== undefined) s.value = indices[i];
      });
      updateSelectOptions();
    };

    modal.querySelector('#btn-confirm-draw').onclick = () => {
      const selects = modal.querySelectorAll('.draw-select');
      const selectedIndices = [];
      let valid = true;

      selects.forEach(s => {
        if (s.value === "") valid = false;
        else selectedIndices.push(parseInt(s.value, 10));
      });

      if (!valid) {
        showToast('Por favor, preencha todas as vagas.', 'error');
        return;
      }

      const uniqueSet = new Set(selectedIndices);
      if (uniqueSet.size !== selects.length) {
        showToast('Existem jogadores repetidos. Cada jogador deve ocupar apenas uma vaga.', 'error');
        return;
      }

      const sortedTeams = selectedIndices.map(idx => teams[idx]);
      modal.style.display = 'none';
      executeFinalizeBracket(sortedTeams);
    };
  }

  /**
   * Open score modal for a group match.
   * @param {number} groupIdx
   * @param {number} matchIdx
   * @param {string} leg - 'single', 'ida', or 'volta'
   */
  function openGroupScoreModal(groupIdx, matchIdx, leg) {
    const group = state.groups[groupIdx];
    if (!group) return;
    const match = group.matches[matchIdx];
    if (!match) return;

    const modal = $('#group-score-modal');
    if (!modal) return;

    modal.dataset.groupIdx = groupIdx;
    modal.dataset.matchIdx = matchIdx;
    modal.dataset.leg = leg || 'single';

    const t1Name = modal.querySelector('#gm-team1-name');
    const t2Name = modal.querySelector('#gm-team2-name');
    const s1Input = modal.querySelector('#gm-team1-score');
    const s2Input = modal.querySelector('#gm-team2-score');
    const titleEl = modal.querySelector('#gm-modal-title');

    const name1 = formatShortName(match.team1.playerName || match.team1.teamName);
    const name2 = formatShortName(match.team2.playerName || match.team2.teamName);
    if (t1Name) t1Name.textContent = name1;
    if (t2Name) t2Name.textContent = name2;

    // Set title based on leg
    if (titleEl) {
      if (leg === 'ida') titleEl.textContent = 'Resultado - Ida';
      else if (leg === 'volta') titleEl.textContent = 'Resultado - Volta';
      else titleEl.textContent = 'Resultado do Jogo';
    }

    // Pre-fill scores based on leg
    if (leg === 'ida' && match.ida) {
      if (s1Input) s1Input.value = match.ida.score1 != null ? match.ida.score1 : '';
      if (s2Input) s2Input.value = match.ida.score2 != null ? match.ida.score2 : '';
    } else if (leg === 'volta' && match.volta) {
      if (s1Input) s1Input.value = match.volta.score1 != null ? match.volta.score1 : '';
      if (s2Input) s2Input.value = match.volta.score2 != null ? match.volta.score2 : '';
    } else {
      if (s1Input) s1Input.value = match.team1.score != null ? match.team1.score : '';
      if (s2Input) s2Input.value = match.team2.score != null ? match.team2.score : '';
    }

    modal.style.display = 'flex';
  }

  /**
   * Confirm group match score.
   * Handles single match and two-legged (ida/volta) modes.
   */
  function confirmGroupScore() {
    const modal = $('#group-score-modal');
    if (!modal) return;

    const groupIdx = parseInt(modal.dataset.groupIdx, 10);
    const matchIdx = parseInt(modal.dataset.matchIdx, 10);
    const leg = modal.dataset.leg || 'single';
    const group = state.groups[groupIdx];
    if (!group) return;
    const match = group.matches[matchIdx];
    if (!match) return;

    const s1 = parseInt(modal.querySelector('#gm-team1-score').value, 10);
    const s2 = parseInt(modal.querySelector('#gm-team2-score').value, 10);

    if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
      showToast('Insira placares válidos.', 'error');
      return;
    }

    if (match.twoLegged) {
      // Two-legged mode
      if (!match.ida) match.ida = { score1: null, score2: null };
      if (!match.volta) match.volta = { score1: null, score2: null };

      if (leg === 'ida') {
        match.ida.score1 = s1;
        match.ida.score2 = s2;
      } else if (leg === 'volta') {
        match.volta.score1 = s1;
        match.volta.score2 = s2;
      }

      // Compute aggregate if both legs are done
      const idaDone = match.ida.score1 !== null && match.ida.score2 !== null;
      const voltaDone = match.volta.score1 !== null && match.volta.score2 !== null;

      if (idaDone && voltaDone) {
        const agg1 = match.ida.score1 + match.volta.score1;
        const agg2 = match.ida.score2 + match.volta.score2;
        match.team1.score = agg1;
        match.team2.score = agg2;
        if (agg1 > agg2) match.winner = 1;
        else if (agg2 > agg1) match.winner = 2;
        else match.winner = 0; // draw on aggregate
        match.status = 'finished';
      } else {
        // Keep partial - don't finalize yet
        match.status = 'in_progress';
      }
    } else {
      // Single match mode
      match.team1.score = s1;
      match.team2.score = s2;
      if (s1 > s2) match.winner = 1;
      else if (s2 > s1) match.winner = 2;
      else match.winner = 0;
      match.status = 'finished';
    }

    group.standings = calcGroupStandings(group);
    saveState();
    modal.style.display = 'none';

    // Auto-generate or update repechage when all group matches are finished
    const allFinished = areAllGroupMatchesFinished();
    if (allFinished && !state.bracketFromGroups) {
      const isUpdate = !!state.groupRepechage;
      generateBracketFromGroups(isUpdate);
      if (!isUpdate) return;
    } else if (!allFinished && state.groupRepechage && !state.bracketFromGroups) {
      state.groupRepechage = null;
      saveState();
    }

    renderGroupsTab();
    // Re-open the group detail modal to show updated results
    openGroupDetailModal(groupIdx);
  }

  /**
   * Open score modal for a repechage match.
   */
  function openRepechageScoreModal(matchIdx) {
    if (!state.groupRepechage) return;
    const match = state.groupRepechage[matchIdx];
    if (!match) return;

    const modal = $('#group-score-modal');
    if (!modal) return;

    modal.dataset.groupIdx = '-1'; // special marker for repechage
    modal.dataset.matchIdx = matchIdx;

    const t1Name = modal.querySelector('#gm-team1-name');
    const t2Name = modal.querySelector('#gm-team2-name');
    const s1Input = modal.querySelector('#gm-team1-score');
    const s2Input = modal.querySelector('#gm-team2-score');

    if (t1Name) t1Name.textContent = formatShortName(match.team1.playerName || match.team1.teamName);
    if (t2Name) t2Name.textContent = formatShortName(match.team2.playerName || match.team2.teamName);
    if (s1Input) s1Input.value = match.team1.score != null ? match.team1.score : '';
    if (s2Input) s2Input.value = match.team2.score != null ? match.team2.score : '';

    modal.style.display = 'flex';
  }

  /**
   * Confirm repechage match score.
   */
  function confirmRepechageScore() {
    const modal = $('#group-score-modal');
    if (!modal) return;

    const matchIdx = parseInt(modal.dataset.matchIdx, 10);
    if (!state.groupRepechage || !state.groupRepechage[matchIdx]) return;
    const match = state.groupRepechage[matchIdx];

    const s1 = parseInt(modal.querySelector('#gm-team1-score').value, 10);
    const s2 = parseInt(modal.querySelector('#gm-team2-score').value, 10);

    if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
      showToast('Insira placares válidos.', 'error');
      return;
    }

    if (s1 === s2) {
      showToast('Empate não é permitido na repescagem. Defina um vencedor.', 'error');
      return;
    }

    match.team1.score = s1;
    match.team2.score = s2;
    match.winner = s1 > s2 ? 1 : 2;
    match.status = 'finished';

    saveState();
    modal.style.display = 'none';

    // Auto-finalize when all repechage matches are done
    const allRepDone = state.groupRepechage.every(m => m.winner);
    if (allRepDone) {
      finalizeGroupRepechage();
      return;
    }

    renderBracket();
  }

  /** Move sponsors showcase to the groups tab slot */
  function moveSponsorsToGroupsTab() {
    const sponsors = $('#bracket-sponsors-showcase');
    const slot = $('#groups-sponsors-slot');
    if (sponsors && slot && !slot.contains(sponsors)) {
      slot.appendChild(sponsors);
    }
  }

  /** Move sponsors showcase back to the bracket tab */
  function moveSponsorsToBracketTab() {
    const sponsors = $('#bracket-sponsors-showcase');
    const bracketTab = $('#bracket-tab');
    if (sponsors && bracketTab && !bracketTab.contains(sponsors)) {
      bracketTab.appendChild(sponsors);
    }
  }

  /**
   * Render the entire Groups tab content.
   * Group cards show standings only. Click header/empty area → group detail modal.
   * Click player row → player profile.
   */
  function renderGroupsTab() {
    const container = $('#groups-container');
    if (!container) return;
    const groups = getCurrentGroups();
    if (!groups || groups.length === 0) {
      container.innerHTML = '<div class="empty-state"><p class="empty-title">Nenhuma fase de grupo gerada</p><p class="empty-subtitle">Gere o chaveamento para criar os grupos.</p></div>';
      return;
    }

    recalcAllGroupStandings();
    let html = '';

    // Classification info buttons block (above groups)
    html += `<div class="classification-info-block">
      <h4 class="classification-info-title">${SVG.info} Informações da Classificação</h4>
      <div class="classification-info-buttons">
        <button type="button" class="btn btn-outline classification-info-btn" id="btn-show-rules">
          ${SVG.clipboard} Regras Classificatórias
        </button>
        <button type="button" class="btn btn-outline classification-info-btn" id="btn-show-qualifying">
          ${SVG.check} Quem está se classificando
        </button>
      </div>
    </div>`;

    // Check for new players not yet assigned to any group
    const allGroupTeamIds = new Set();
    groups.forEach(g => g.teams.forEach(t => allGroupTeamIds.add(t.id)));
    
    // Only show pending players if it's the current tournament
    const pendingPlayers = currentViewingBracketId ? [] : state.teams.filter(t => !allGroupTeamIds.has(t.id));

    if (isAdmin && pendingPlayers.length > 0) {
      const lastPlayer = pendingPlayers[pendingPlayers.length - 1];
      const playerLabel = sanitize(lastPlayer.teamName || lastPlayer.playerName || 'Último jogador');
      html += `<div class="group-actions" style="margin-bottom: 16px;">
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; text-align: center;">
          ${SVG.info} <strong>${pendingPlayers.length}</strong> jogador(es) ainda não está(ão) em nenhum grupo.
        </p>
        <button type="button" class="btn btn-info btn-block" id="btn-randomize-last-player">
          <svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg> Sortear "${playerLabel}" em um grupo
        </button>
      </div>`;
    }

    // Render each group card (compact - standings only)
    state.groups.forEach((group, gIdx) => {
      const hasTwoLegged = group.matches.some(m => m.twoLegged);
      const totalMatches = hasTwoLegged ? group.matches.length * 2 : group.matches.length;
      const finishedMatches = hasTwoLegged
        ? group.matches.reduce((count, m) => {
          if (m.ida && m.ida.score1 != null) count++;
          if (m.volta && m.volta.score1 != null) count++;
          return count;
        }, 0)
        : group.matches.filter(m => m.team1.score != null).length;

      const groupFinished = group.matches.every(m => m.team1.score != null && m.team2.score != null);

      html += `<div class="group-card ${groupFinished ? 'group-card-finished' : ''}" data-group-idx="${gIdx}">`;
      html += `<div class="group-header clickable-area" data-action="open-group" data-gidx="${gIdx}">
        <h3>${sanitize(group.name)} ${groupFinished ? '<span class="group-done-badge">' + SVG.checkCircle + ' Finalizado</span>' : ''}</h3>
        <span class="group-progress">${finishedMatches}/${totalMatches} jogos</span>
      </div>`;

      // Standings table
      html += `<div class="group-table-wrapper"><table class="group-table">
        <thead><tr>
          <th class="gt-pos">#</th>
          <th class="gt-team">Jogador</th>
          <th class="gt-stat">J</th>
          <th class="gt-stat">V</th>
          <th class="gt-stat">E</th>
          <th class="gt-stat">D</th>
          <th class="gt-stat">GP</th>
          <th class="gt-stat">GC</th>
          <th class="gt-stat">SG</th>
          <th class="gt-stat gt-pts">PTS</th>
        </tr></thead><tbody>`;

      group.standings.forEach((s, pos) => {
        let rowClass = '';
        let badge = '';
        if (pos === 0) {
          rowClass = 'group-qualified';
          if (groupFinished) badge = '<span class="gt-badge gt-badge-qualified">Classificado</span>';
        } else if (pos === 1) {
          rowClass = 'group-repechage';
          if (groupFinished) badge = '<span class="gt-badge gt-badge-repechage">Repescagem</span>';
        } else if (pos === 2) {
          rowClass = 'group-third';
          if (groupFinished) badge = '<span class="gt-badge gt-badge-third">Possível 3º</span>';
        }

        const ini = initials(s.playerName || s.teamName);
        const sPhoto = getTeamPhoto(s);
        const avatar = sPhoto
          ? `<img src="${sanitize(sPhoto)}" alt="" class="gt-avatar">`
          : `<span class="gt-avatar-placeholder">${sanitize(ini)}</span>`;

        const isPresent = state.attendance && state.attendance[s.id];
        const nameColor = isPresent ? 'color: var(--accent-green);' : '';
        html += `<tr class="${rowClass} gt-player-row" data-team-id="${sanitize(s.id)}" title="Ver perfil">
          <td class="gt-pos">${pos + 1}º</td>
          <td class="gt-team">${avatar} <span class="gt-player-name" style="${nameColor}">${sanitize(formatShortName(s.playerName || s.teamName))}</span>${badge}</td>
          <td class="gt-stat">${s.played}</td>
          <td class="gt-stat">${s.wins}</td>
          <td class="gt-stat">${s.draws}</td>
          <td class="gt-stat">${s.losses}</td>
          <td class="gt-stat">${s.goalsFor}</td>
          <td class="gt-stat">${s.goalsAgainst}</td>
          <td class="gt-stat">${s.goalDiff > 0 ? '+' : ''}${s.goalDiff}</td>
          <td class="gt-stat gt-pts">${s.points}</td>
        </tr>`;
      });

      html += `</tbody></table></div>`;

      // Clickable footer to view matches
      html += `<div class="group-card-footer clickable-area" data-action="open-group" data-gidx="${gIdx}">
        <span>${SVG.clipboard} Ver jogos do grupo</span>
        <span class="arrow-icon">${SVG.chevronRight}</span>
      </div>`;

      html += `</div>`;
    });

    // Legend
    html += `<div class="group-legend">
      <span class="legend-item"><span class="legend-dot qualified"></span> 1º - Classificado direto</span>
      <span class="legend-item"><span class="legend-dot repechage"></span> 2º - Repescagem</span>
      <span class="legend-item"><span class="legend-dot third"></span> 3º - Melhor 3º</span>
    </div>`;

    // "Generate Repechage" button (admin only, when all matches done)
    if (isAdmin && areAllGroupMatchesFinished() && !state.groupRepechage) {
      html += `<div class="group-actions">
        <button type="button" class="btn btn-primary btn-block" id="btn-generate-repechage">${SVG.swords} Gerar Repescagem dos Grupos</button>
      </div>`;
    }

    // Repechage section


    // (Removido: cards de classificados diretos e repescagem)

    // Só mostra os confrontos da repescagem se já tiver sido gerada
    if (state.groupRepechage) {
      html += `<div class="repechage-section">
        <h3 class="repechage-title">${SVG.refresh} Repescagem</h3>
        <div class="repechage-matches">`;

      state.groupRepechage.forEach((m, mIdx) => {
        const t1 = formatShortName(m.team1.playerName || m.team1.teamName);
        const t2 = formatShortName(m.team2.playerName || m.team2.teamName);
        const s1 = m.team1.score != null ? m.team1.score : '-';
        const s2 = m.team2.score != null ? m.team2.score : '-';
        const finished = m.winner;
        html += `<div class="group-match repechage-match ${finished ? 'gm-finished' : ''}" data-repechage="${mIdx}">
          <span class="gm-team gm-team1 ${m.winner === 1 ? 'gm-winner' : ''}">${sanitize(t1)}</span>
          <span class="gm-score">${s1} × ${s2}</span>
          <span class="gm-team gm-team2 ${m.winner === 2 ? 'gm-winner' : ''}">${sanitize(t2)}</span>
          ${isAdmin && !finished ? `<button type="button" class="btn btn-xs btn-outline gm-edit-btn" onclick="window._openRepechageScore(${mIdx})">${SVG.pencil}</button>` : ''}
        </div>`;
      });

      html += `</div>`;

      // "Generate Bracket" button
      const allRepDone = state.groupRepechage.every(m => m.winner);
      if (isAdmin && allRepDone) {
        html += `<div class="group-actions">
          <button type="button" class="btn btn-primary btn-block" id="btn-finalize-groups">${SVG.crown} Gerar Mata-Mata com Classificados</button>
        </div>`;
      }

      html += `</div>`;
    }

    container.innerHTML = html;

    // Bind classification info buttons
    const btnRules = container.querySelector('#btn-show-rules');
    if (btnRules) btnRules.addEventListener('click', showClassificationRulesModal);

    const btnQualifying = container.querySelector('#btn-show-qualifying');
    if (btnQualifying) btnQualifying.addEventListener('click', showQualifyingPlayersModal);

    // Bind buttons
    const btnRep = container.querySelector('#btn-generate-repechage');
    if (btnRep) btnRep.addEventListener('click', generateBracketFromGroups);

    const btnFinal = container.querySelector('#btn-finalize-groups');
    if (btnFinal) btnFinal.addEventListener('click', finalizeGroupRepechage);

    // Bind "Sortear último jogador" button
    const btnRandomize = container.querySelector('#btn-randomize-last-player');
    if (btnRandomize) btnRandomize.addEventListener('click', randomizeLastPlayerIntoGroup);

    // Bind clickable areas → open group detail modal
    container.querySelectorAll('[data-action="open-group"]').forEach(el => {
      el.addEventListener('click', (e) => {
        const gIdx = parseInt(el.dataset.gidx, 10);
        openGroupDetailModal(gIdx);
      });
    });

    // Bind player rows → open player profile
    container.querySelectorAll('.gt-player-row').forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const teamId = row.dataset.teamId;
        if (teamId) openPlayerProfile(teamId);
      });
    });
  }

  /**
   * Show a modal with classification rules for the group stage.
   */
  function showClassificationRulesModal() {
    const groupCount = state.groups ? state.groups.length : 5;
    let modal = document.getElementById('classification-rules-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'classification-rules-modal';
      modal.className = 'generic-modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="generic-modal-card">
      <div class="gd-header">
        <h2>${SVG.clipboard} Regras Classificatórias</h2>
        <button type="button" class="gd-close-btn" id="rules-close-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="generic-modal-body">
        <div class="rules-section">
          <h3 class="rules-subtitle">${SVG.crown} Formato do Torneio</h3>
          <p>Fase de Grupos + Mata-Mata (Quartas de Final em diante)</p>
        </div>

        <div class="rules-section">
          <h3 class="rules-subtitle">${SVG.soccer} Fase de Grupos</h3>
          <ul class="rules-list">
            <li><strong>${groupCount} grupos</strong> com jogadores disputando todos contra todos dentro do grupo</li>
            <li>Vitória = <strong>3 pontos</strong> | Empate = <strong>1 ponto</strong> | Derrota = <strong>0 pontos</strong></li>
            <li>Critérios de desempate: <strong>Pontos → Saldo de Gols → Gols Pró</strong></li>
          </ul>
        </div>

        <div class="rules-section">
          <h3 class="rules-subtitle">${SVG.check} Classificação Direta</h3>
          <div class="rules-highlight direct">
            <span class="rules-dot qualified"></span>
            <strong>1º colocado de cada grupo</strong> → Vai direto para as Quartas de Final
          </div>
          <p class="rules-detail">${groupCount} vagas diretas</p>
        </div>

        <div class="rules-section">
          <h3 class="rules-subtitle">${SVG.refresh} Repescagem</h3>
          <div class="rules-highlight repechage">
            <span class="rules-dot repechage-dot"></span>
            <strong>2º colocado de cada grupo</strong> + <strong>Melhor 3º colocado</strong> → Disputam 3 vagas na repescagem
          </div>
          <ul class="rules-list">
            <li>6 jogadores disputam 3 partidas eliminatórias</li>
            <li>Confrontos por chave: 1º seed vs 6º, 2º vs 5º, 3º vs 4º</li>
            <li>Os 3 vencedores avançam para as Quartas de Final</li>
          </ul>
        </div>

        <div class="rules-section">
          <h3 class="rules-subtitle">${SVG.trophy} Mata-Mata</h3>
          <ul class="rules-list">
            <li><strong>8 classificados</strong> (${groupCount} diretos + 3 repescagem) disputam as Quartas de Final</li>
            <li>Quartas → Semifinal → <strong>Final</strong></li>
            <li>Eliminação direta (quem perde está fora)</li>
          </ul>
        </div>

        <div class="rules-section">
          <h3 class="rules-subtitle">Legenda das Cores</h3>
          <div class="rules-colors">
            <span class="rules-color-item"><span class="legend-dot qualified"></span> 1º - Classificado direto</span>
            <span class="rules-color-item"><span class="legend-dot repechage"></span> 2º - Repescagem</span>
            <span class="rules-color-item"><span class="legend-dot third"></span> 3º - Melhor 3º (disputando vaga)</span>
          </div>
        </div>
      </div>
    </div>`;

    modal.style.display = 'flex';
    modal.querySelector('#rules-close-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  }

  /**
   * Show a modal with current qualifying players based on live standings.
   */
  function showQualifyingPlayersModal() {
    if (!state.groups || state.groups.length === 0) return;

    const { directQualified, repechagePlayers, bestThird } = getGroupClassification();

    let modal = document.getElementById('qualifying-players-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'qualifying-players-modal';
      modal.className = 'generic-modal-overlay';
      document.body.appendChild(modal);
    }

    let html = `<div class="generic-modal-card">
      <div class="gd-header">
        <h2>${SVG.check} Quem está se classificando</h2>
        <button type="button" class="gd-close-btn" id="qualifying-close-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="generic-modal-body">`;

    // Direct qualified
    html += `<div class="qualifying-section">
      <h3 class="qualifying-subtitle"><span class="legend-dot qualified"></span> Classificados Diretos (Quartas de Final)</h3>
      <div class="qualifying-players-list">`;

    directQualified.forEach(p => {
      const ini = initials(p.playerName || p.teamName);
      const pPhoto = getTeamPhoto(p);
      const avatar = pPhoto
        ? `<img src="${sanitize(pPhoto)}" alt="" class="qualifying-avatar">`
        : `<span class="qualifying-avatar-placeholder">${sanitize(ini)}</span>`;
      html += `<div class="qualifying-player direct">
        ${avatar}
        <div class="qualifying-player-info">
          <strong>${sanitize(formatShortName(p.playerName || p.teamName))}</strong>
          <small>1º de ${sanitize(p.groupName || '')}</small>
        </div>
        <span class="qualifying-pts">${p.points} pts</span>
      </div>`;
    });

    html += `</div></div>`;

    // Repechage players
    html += `<div class="qualifying-section">
      <h3 class="qualifying-subtitle"><span class="legend-dot repechage-dot"></span> Indo para a Repescagem</h3>
      <div class="qualifying-players-list">`;

    repechagePlayers.forEach((p, i) => {
      const ini = initials(p.playerName || p.teamName);
      const pPhoto = getTeamPhoto(p);
      const avatar = pPhoto
        ? `<img src="${sanitize(pPhoto)}" alt="" class="qualifying-avatar">`
        : `<span class="qualifying-avatar-placeholder">${sanitize(ini)}</span>`;
      const isBestThird = bestThird && p.id === bestThird.id;
      const posLabel = isBestThird ? `Melhor 3º (${sanitize(p.groupName || '')})` : `2º de ${sanitize(p.groupName || '')}`;
      html += `<div class="qualifying-player repechage ${isBestThird ? 'best-third' : ''}">
        ${avatar}
        <div class="qualifying-player-info">
          <strong>${sanitize(formatShortName(p.playerName || p.teamName))}</strong>
          <small>${posLabel}</small>
        </div>
        <span class="qualifying-pts">${p.points} pts</span>
        <span class="qualifying-seed">Seed ${i + 1}</span>
      </div>`;
    });

    html += `</div></div>`;

    // Eliminated (remaining 3rd placed who aren't the best + 4th+ placed)
    const eliminatedPlayers = [];
    state.groups.forEach(group => {
      const s = group.standings;
      s.forEach((p, pos) => {
        if (pos === 0) return; // 1st — direct
        if (pos === 1) return; // 2nd — repechage
        if (pos === 2 && bestThird && p.id === bestThird.id) return; // best 3rd — repechage
        eliminatedPlayers.push({ ...p, groupName: group.name, position: pos + 1 });
      });
    });

    if (eliminatedPlayers.length > 0) {
      html += `<div class="qualifying-section">
        <h3 class="qualifying-subtitle"><span class="legend-dot eliminated-dot"></span> Eliminados</h3>
        <div class="qualifying-players-list">`;

      eliminatedPlayers.forEach(p => {
        const ini = initials(p.playerName || p.teamName);
        const pPhoto = getTeamPhoto(p);
        const avatar = pPhoto
          ? `<img src="${sanitize(pPhoto)}" alt="" class="qualifying-avatar">`
          : `<span class="qualifying-avatar-placeholder">${sanitize(ini)}</span>`;
        html += `<div class="qualifying-player eliminated">
          ${avatar}
          <div class="qualifying-player-info">
            <strong>${sanitize(formatShortName(p.playerName || p.teamName))}</strong>
            <small>${p.position}º de ${sanitize(p.groupName || '')}</small>
          </div>
          <span class="qualifying-pts">${p.points} pts</span>
        </div>`;
      });

      html += `</div></div>`;
    }

    html += `<p class="qualifying-note">${SVG.info} A classificação é calculada em tempo real com base nos resultados atuais dos jogos dos grupos.</p>`;
    html += `</div></div>`;

    modal.innerHTML = html;
    modal.style.display = 'flex';
    modal.querySelector('#qualifying-close-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  }

  /**
   * Open the group detail modal showing all matches for a specific group.
   * Admin can edit scores; visitor sees results read-only.
   */
  /**
   * Simulate all pending matches in a group with random scores (admin testing).
   */
  function simulateGroupMatches(gIdx) {
    const group = state.groups[gIdx];
    if (!group) return;

    group.matches.forEach(m => {
      if (m.twoLegged) {
        // Simulate ida if not done
        if (!m.ida) m.ida = { score1: null, score2: null };
        if (!m.volta) m.volta = { score1: null, score2: null };
        if (m.ida.score1 == null) {
          m.ida.score1 = Math.floor(Math.random() * 6);
          m.ida.score2 = Math.floor(Math.random() * 6);
        }
        if (m.volta.score1 == null) {
          m.volta.score1 = Math.floor(Math.random() * 6);
          m.volta.score2 = Math.floor(Math.random() * 6);
        }
        // Compute aggregate
        const agg1 = m.ida.score1 + m.volta.score1;
        const agg2 = m.ida.score2 + m.volta.score2;
        m.team1.score = agg1;
        m.team2.score = agg2;
        if (agg1 > agg2) m.winner = 1;
        else if (agg2 > agg1) m.winner = 2;
        else m.winner = 0;
        m.status = 'finished';
      } else {
        if (m.team1.score != null) return; // already finished
        const s1 = Math.floor(Math.random() * 6);
        const s2 = Math.floor(Math.random() * 6);
        m.team1.score = s1;
        m.team2.score = s2;
        if (s1 > s2) m.winner = 1;
        else if (s2 > s1) m.winner = 2;
        else m.winner = 0;
        m.status = 'finished';
      }
    });

    group.standings = calcGroupStandings(group);
    saveState();

    // Check if all groups are now finished → auto-generate repechage
    const allFinished = areAllGroupMatchesFinished();
    if (allFinished && !state.bracketFromGroups) {
      const isUpdate = !!state.groupRepechage;
      const modal = $('#group-detail-modal');
      if (modal && !isUpdate) modal.style.display = 'none';
      generateBracketFromGroups(isUpdate);
      if (!isUpdate) return;
    } else if (!allFinished && state.groupRepechage && !state.bracketFromGroups) {
      state.groupRepechage = null;
    }

    renderGroupsTab();
    openGroupDetailModal(gIdx);
    showToast(`Jogos do ${group.name} simulados!`, 'success');
  }

  /**
   * Reset all match results in a group (undo simulation).
   */
  function resetGroupMatches(gIdx) {
    const group = state.groups[gIdx];
    if (!group) return;

    group.matches.forEach(m => {
      m.team1.score = null;
      m.team2.score = null;
      m.winner = null;
      m.status = 'not_started';
      if (m.twoLegged) {
        m.ida = { score1: null, score2: null };
        m.volta = { score1: null, score2: null };
      }
    });

    group.standings = calcGroupStandings(group);

    // Clear repechage, direct qualified, and bracket generated from groups
    // since they depend on all group results being complete
    if (state.groupRepechage) {
      // Revert bracket match stats before clearing
      if (state.bracket && state.bracket.rounds) {
        state.bracket.rounds.forEach(round => {
          round.matches.forEach(m => {
            if (m.statsApplied && typeof revertMatchStats === 'function') {
              revertMatchStats(m);
            }
          });
        });
      }
      state.groupRepechage = null;
      state.groupDirectQualified = null;
      state.bracket = null;
      state.bracketFromGroups = false;
      state.champion = null;
    }

    saveState();
    renderGroupsTab();
    openGroupDetailModal(gIdx);
    showToast(`Resultados do ${group.name} resetados.`, 'success');
  }

  function openGroupDetailModal(gIdx) {
    const group = state.groups[gIdx];
    if (!group) return;

    let modal = $('#group-detail-modal');
    if (!modal) return;

    recalcAllGroupStandings();

    const hasUnfinished = group.matches.some(m => m.team1.score == null);
    const hasFinished = group.matches.some(m => m.team1.score != null);

    let html = `<div class="gd-header">
      <h2>${sanitize(group.name)}</h2>
      <div class="gd-header-actions">
        ${isAdmin && hasFinished ? `<button type="button" class="btn btn-xs btn-outline gd-reset-btn" id="gd-reset-btn" data-gidx="${gIdx}" title="Resetar todos os resultados">✕ Resetar</button>` : ''}
        ${isAdmin && hasUnfinished ? `<button type="button" class="btn btn-xs btn-outline gd-simulate-btn" id="gd-simulate-btn" data-gidx="${gIdx}" title="Simular todos os jogos pendentes">${SVG.refresh} Simular Todos</button>` : ''}
        <button type="button" class="gd-close-btn" id="gd-close-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
    </div>`;

    // Matches list
    html += `<div class="gd-matches-list">`;
    group.matches.forEach((m, mIdx) => {
      const t1 = formatShortName(m.team1.playerName || m.team1.teamName);
      const t2 = formatShortName(m.team2.playerName || m.team2.teamName);
      const isTwoLeg = !!m.twoLegged;
      const finished = m.team1.score != null;

      html += `<div class="gd-match-card ${finished ? 'gd-finished' : ''}">`;
      html += `<div class="gd-match-teams">
        <span class="gd-team gd-team1 ${m.winner === 1 ? 'gd-winner' : ''}">${sanitize(t1)}</span>
        <span class="gd-vs">VS</span>
        <span class="gd-team gd-team2 ${m.winner === 2 ? 'gd-winner' : ''}">${sanitize(t2)}</span>
      </div>`;

      if (isTwoLeg) {
        const ida = m.ida || { score1: null, score2: null };
        const volta = m.volta || { score1: null, score2: null };
        const idaFinished = ida.score1 != null;
        const voltaFinished = volta.score1 != null;

        html += `<div class="gd-legs">`;
        // Ida
        html += `<div class="gd-leg">
          <span class="gd-leg-label">Ida</span>
          <span class="gd-leg-score">${idaFinished ? `${ida.score1} × ${ida.score2}` : '- × -'}</span>
          ${isAdmin ? `<button type="button" class="btn btn-xs btn-outline gm-edit-btn" data-leg="ida" data-gidx="${gIdx}" data-midx="${mIdx}">${SVG.pencil}</button>` : ''}
        </div>`;
        // Volta
        html += `<div class="gd-leg">
          <span class="gd-leg-label">Volta</span>
          <span class="gd-leg-score">${voltaFinished ? `${volta.score1} × ${volta.score2}` : '- × -'}</span>
          ${isAdmin ? `<button type="button" class="btn btn-xs btn-outline gm-edit-btn" data-leg="volta" data-gidx="${gIdx}" data-midx="${mIdx}">${SVG.pencil}</button>` : ''}
        </div>`;
        // Aggregate
        if (idaFinished && voltaFinished) {
          const agg1 = ida.score1 + volta.score1;
          const agg2 = ida.score2 + volta.score2;
          html += `<div class="gd-aggregate">
            <span class="gd-leg-label">Agregado</span>
            <span class="gd-agg-score">${agg1} × ${agg2}</span>
          </div>`;
        }
        html += `</div>`;
      } else {
        // Single match
        const s1 = m.team1.score != null ? m.team1.score : '-';
        const s2 = m.team2.score != null ? m.team2.score : '-';
        html += `<div class="gd-single-score">
          <span class="gd-score-display">${s1} × ${s2}</span>
          ${isAdmin ? `<button type="button" class="btn btn-xs btn-outline gm-edit-btn" data-leg="single" data-gidx="${gIdx}" data-midx="${mIdx}">${SVG.pencil}</button>` : ''}
        </div>`;
      }

      html += `</div>`;
    });
    html += `</div>`;

    const content = modal.querySelector('.gd-content');
    if (content) content.innerHTML = html;

    modal.style.display = 'flex';

    // Bind close
    const closeBtn = modal.querySelector('#gd-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });

    // Bind simulate button
    const simBtn = modal.querySelector('#gd-simulate-btn');
    if (simBtn) {
      simBtn.addEventListener('click', () => {
        const gi = parseInt(simBtn.dataset.gidx, 10);
        simulateGroupMatches(gi);
      });
    }

    // Bind reset button
    const resetBtn = modal.querySelector('#gd-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const gi = parseInt(resetBtn.dataset.gidx, 10);
        resetGroupMatches(gi);
      });
    }

    // Bind edit buttons
    modal.querySelectorAll('.gm-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const leg = btn.dataset.leg;
        const gi = parseInt(btn.dataset.gidx, 10);
        const mi = parseInt(btn.dataset.midx, 10);
        openGroupScoreModal(gi, mi, leg);
      });
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    }, { once: true });
  }

  // Global handlers for inline onclick
  window._openGroupScore = function (gIdx, mIdx) { openGroupScoreModal(gIdx, mIdx, 'single'); };
  window._openRepechageScore = function (mIdx) { openRepechageScoreModal(mIdx); };

  /** Generate bracket from registered teams */
  function handleGenerate() {
    // Check tournament format
    const formatSelect = $('#tournament-format');
    state.tournamentFormat = formatSelect ? formatSelect.value : 'knockout';

    if (state.tournamentFormat === 'groups') {
      // In group mode, team count is automatic based on registered players
      const requiredCount = state.teams.length;
      if (requiredCount < 2) {
        showToast('Quantidade inválida. Mínimo de 2 participantes.', 'error');
        return;
      }
      state.teamCount = requiredCount;
      const countInput = $('#team-count');
      if (countInput) countInput.value = requiredCount;
      syncTournamentName();

      const gcInput = $('#group-count');
      const numGroups = parseInt(gcInput ? gcInput.value : state.groupCount, 10) || 5;
      state.groupCount = numGroups;

      if (state.teams.length < numGroups * 2) {
        showToast(`Precisa de pelo menos ${numGroups * 2} times para ${numGroups} grupos.`, 'error');
        return;
      }

      state.groups = buildGroupStage(state.teams, numGroups);
      state.groupRepechage = null;
      state.groupDirectQualified = null;
      state.bracket = null;
      state.bracketFromGroups = false;
      state.champion = null;
      saveState();

      // Update UI labels and show groups tab
      toggleGroupsConfig();
      updateTeamCountInfo();
      const groupsTabBtn = $('#groups-tab-btn');
      if (groupsTabBtn) {
        groupsTabBtn.style.display = '';
        groupsTabBtn.click();
      }
      renderGroupsTab();
      showToast(`Fase de grupos gerada! ${numGroups} grupos criados.`, 'success');
      return;
    }

    // Standard knockout
    const countInput = $('#team-count');
    const requiredCount = parseInt(countInput ? countInput.value : state.teamCount, 10);

    if (isNaN(requiredCount) || requiredCount < 2) {
      showToast('Quantidade inválida. Mínimo de 2 participantes.', 'error');
      return;
    }
    if (requiredCount > 128) {
      showToast('Quantidade máxima: 128 participantes.', 'error');
      return;
    }

    state.teamCount = requiredCount;
    syncTournamentName();

    const shuffled = shuffleArray([...state.teams]);

    state.groups = null;
    state.groupRepechage = null;
    state.groupDirectQualified = null;
    state.bracket = buildBracketStructure(shuffled, requiredCount);
    state.champion = null;
    saveState();

    renderBracket();
    updateTeamCountInfo();

    const totalSlots = nextPowerOf2(requiredCount);
    const numByes = totalSlots - requiredCount;
    const remaining = requiredCount - shuffled.length;
    if (numByes > 0 && remaining <= 0) {
      showToast(`Chaveamento gerado! ${numByes} bye(s) aplicado(s) automaticamente.`, 'success');
    } else if (remaining > 0) {
      showToast(`Chaveamento gerado! Aguardando ${remaining} participante(s).`, 'success');
    } else {
      showToast('Chaveamento gerado com todos os times!', 'success');
    }
  }

  /**
   * Place a team into the next available slot in round 0 of the bracket.
   * @param {object} team - team object with teamName, playerName, photo
   * @returns {boolean} true if placed successfully
   */
  function autoPlaceInBracket(team) {
    if (!state.bracket || !state.bracket.rounds || state.bracket.rounds.length === 0) return false;

    const firstRound = state.bracket.rounds[0];
    for (let m = 0; m < firstRound.matches.length; m++) {
      const match = firstRound.matches[m];
      // Skip BYE matches (already auto-advanced)
      if (isByeTeam(match.team1) || isByeTeam(match.team2)) continue;
      if (!match.team1) {
        match.team1 = makeTeamSlotData(team);
        return true;
      }
      if (!match.team2) {
        match.team2 = makeTeamSlotData(team);
        return true;
      }
    }
    return false; // bracket is full
  }

  /* ==========================================================
     12. BRACKET RENDERING & TIME MACHINE
     ========================================================== */

  /** Retorna a chave atualmente sendo visualizada (Atual ou do Histórico) */
  function getCurrentBracket() {
    let b;
    if (currentViewingBracketId) {
      const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
      b = hist ? hist.bracket : null;
    } else {
      b = state.bracket;
    }

    // Auto-heal third place match if bracket has semifinals
    if (b && b.rounds && b.rounds.length > 1) {
      if (!b.thirdPlaceMatch) {
         b.thirdPlaceMatch = createEmptyMatch(-1, 0);
      }
      
      // Auto-populate third place match from semifinals if they are finished
      const totalRounds = b.rounds.length;
      const semiRound = b.rounds[totalRounds - 2];
      
      if (semiRound && semiRound.matches.length >= 2) {
         const m1 = semiRound.matches[0];
         const m2 = semiRound.matches[1];
         
         if (m1 && m1.winner && !b.thirdPlaceMatch.team1) {
             const loser1 = m1.winner === 1 ? m1.team2 : m1.team1;
             b.thirdPlaceMatch.team1 = makeTeamSlotData(loser1);
         }
         
         if (m2 && m2.winner && !b.thirdPlaceMatch.team2) {
             const loser2 = m2.winner === 1 ? m2.team2 : m2.team1;
             b.thirdPlaceMatch.team2 = makeTeamSlotData(loser2);
         }
      }
    }

    return b;
  }

  /**
   * Helper seguro para obter um objeto de partida (match) dados rIdx e mIdx.
   * Trata o caso rIdx = -2 como sendo a disputa de terceiro lugar.
   */
  function getMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return null;
    if (rIdx === -2) return bracket.thirdPlaceMatch;
    if (rIdx < 0 || !bracket.rounds || !bracket.rounds[rIdx]) return null;
    return bracket.rounds[rIdx].matches[mIdx];
  }

  /** Retorna o nome do torneio que está sendo visualizado */
  function getCurrentBracketName() {
    if (currentViewingBracketId) {
      const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
      return hist ? hist.name : 'Torneio Passado';
    }
    return state.tournamentName || 'COPA PSYZON';
  }

  function getCurrentGroups() {
    if (currentViewingBracketId) {
      const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
      return hist ? hist.groups : null;
    }
    return state.groups;
  }

  /**
   * Render a placeholder bracket showing where each group qualifier will go.
   * No real player names - only structural labels like "1º Grupo A", "Venc. Repescagem 1", etc.
   */
  function renderPlaceholderBracket(container) {
    const groupCount = state.groups ? state.groups.length : 5;
    const groupNames = state.groups ? state.groups.map(g => g.name) : [];

    // Since matchups are manually drawn now, just use generic Sorteio placeholders
    const sorteioLabel = { label: 'Sorteio', type: 'tbd' };
    const qfMatchups = [
      { team1: sorteioLabel, team2: sorteioLabel },
      { team1: sorteioLabel, team2: sorteioLabel },
      { team1: sorteioLabel, team2: sorteioLabel },
      { team1: sorteioLabel, team2: sorteioLabel }
    ];

    // Repechage matchups
    const repMatchLabels = [];
    for (let i = 0; i < groupCount; i++) {
      repMatchLabels.push(`2º ${groupNames[i] || ('Grupo ' + String.fromCharCode(65 + i))}`);
    }
    repMatchLabels.push('Melhor 3º');

    const repMatchups = [
      { team1: repMatchLabels[0], team2: repMatchLabels[5] || 'Melhor 3º' },
      { team1: repMatchLabels[1], team2: repMatchLabels[4] || '5º Melhor 2º' },
      { team1: repMatchLabels[2], team2: repMatchLabels[3] || '4º Melhor 2º' }
    ];

    // Helper to render a placeholder team slot
    function teamSlotHTML(label, typeClass) {
      const dotClass = typeClass === 'direct' ? 'ph-dot-direct' : typeClass === 'repechage' ? 'ph-dot-rep' : 'ph-dot-tbd';
      return `<div class="match-team ph-team-slot ${typeClass}">
        <div class="team-avatar ph-avatar"><span class="ph-dot ${dotClass}"></span></div>
        <div class="ph-team-info">
          <span class="team-name-bracket">${sanitize(label)}</span>
        </div>
        <span class="score-display ph-score">–</span>
      </div>`;
    }

    let html = '';

    // ── Repechage Section ──
    if (state.groupRepechage) {
      // REAL repechage matches with editable scores
      html += `<div class="ph-repechage-section">
        <div class="ph-section-header">
          <h3 class="round-title">${SVG.refresh} Repescagem</h3>
          <span class="ph-section-desc">Insira os resultados das partidas</span>
        </div>`;

      // Direct qualified chips (auto-scrolling carousel)
      if (state.groupDirectQualified && state.groupDirectQualified.length > 0) {
        const qualChips = state.groupDirectQualified.map(t =>
          `<span class="qualified-chip">${sanitize(t.teamName || t.playerName)}</span>`
        ).join('');
        html += `<div class="ph-qualified-chips"><span class="ph-qualified-label">${SVG.checkCircle} Classificados diretos:</span><div class="qualified-carousel"><div class="qualified-carousel-track">${qualChips}${qualChips}</div></div></div>`;
      }

      html += `<div class="ph-repechage-grid">`;
      state.groupRepechage.forEach((m, mIdx) => {
        const t1Name = formatShortName(m.team1.playerName || m.team1.teamName);
        const t2Name = formatShortName(m.team2.playerName || m.team2.teamName);
        const t1Photo = getTeamPhoto(m.team1);
        const t2Photo = getTeamPhoto(m.team2);
        const s1 = m.team1.score != null ? m.team1.score : '–';
        const s2 = m.team2.score != null ? m.team2.score : '–';
        const finished = !!m.winner;

        const t1Avatar = t1Photo
          ? `<img src="${sanitize(t1Photo)}" alt="">`
          : `<span class="ph-dot ph-dot-rep"></span>`;
        const t2Avatar = t2Photo
          ? `<img src="${sanitize(t2Photo)}" alt="">`
          : `<span class="ph-dot ph-dot-rep"></span>`;

        html += `<div class="match-card-wrapper">
          <div class="match-card ph-match-card ph-match-rep ${finished ? 'ph-match-done' : ''}">
            <div class="match-header"><span>Repescagem ${mIdx + 1}</span></div>
            <div class="match-team ph-team-slot ${m.winner === 1 ? 'ph-winner' : ''}">
              <div class="team-avatar ph-avatar">${t1Avatar}</div>
              <div class="ph-team-info"><span class="team-name-bracket">${sanitize(t1Name)}</span></div>
              <span class="score-display ${finished ? '' : 'ph-score'}">${s1}</span>
            </div>
            <div class="ph-vs-divider"><span>VS</span></div>
            <div class="match-team ph-team-slot ${m.winner === 2 ? 'ph-winner' : ''}">
              <div class="team-avatar ph-avatar">${t2Avatar}</div>
              <div class="ph-team-info"><span class="team-name-bracket">${sanitize(t2Name)}</span></div>
              <span class="score-display ${finished ? '' : 'ph-score'}">${s2}</span>
            </div>
            ${isAdmin ? `<button type="button" class="btn btn-xs btn-outline ph-edit-btn" data-repechage-idx="${mIdx}">${SVG.pencil} ${finished ? 'Editar' : 'Definir Placar'}</button>` : ''}
          </div>
        </div>`;
      });
      html += `</div></div>`;

    } else {
      // PLACEHOLDER repechage (before groups finish)
      html += `<div class="ph-repechage-section">
        <div class="ph-section-header">
          <h3 class="round-title">${SVG.refresh} Repescagem</h3>
          <span class="ph-section-desc">2º colocados + melhor 3º colocado</span>
        </div>
        <div class="ph-repechage-grid">`;

      repMatchups.forEach((m, i) => {
        html += `<div class="match-card-wrapper">
          <div class="match-card ph-match-card ph-match-rep">
            <div class="match-header"><span>Repescagem ${i + 1}</span></div>
            ${teamSlotHTML(m.team1, 'repechage')}
            <div class="ph-vs-divider"><span>VS</span></div>
            ${teamSlotHTML(m.team2, 'repechage')}
            <div class="ph-winner-arrow">
              <span class="ph-arrow-icon">${SVG.chevronRight}</span>
              <span class="ph-winner-text">Venc. Repescagem ${i + 1}</span>
            </div>
          </div>
        </div>`;
      });

      html += `</div></div>`;
    }

    // ── Bracket Tree (Quartas → Semi → Final) ──
    html += `<div class="bracket ph-bracket-tree">`;

    // Quartas de Final
    html += `<div class="round ph-round">
      <div class="round-title">${SVG.soccer} Quartas de Final</div>
      <div class="round-matches">`;
    qfMatchups.forEach((m, i) => {
      const t1Type = m.team1 && m.team1.type === 'repechage' ? 'repechage' : 'direct';
      const t2Type = m.team2 && m.team2.type === 'repechage' ? 'repechage' : 'direct';
      const t1Label = m.team1 ? m.team1.label : 'A definir';
      const t2Label = m.team2 ? m.team2.label : 'A definir';
      html += `<div class="match-card-wrapper">
        <div class="match-card ph-match-card">
          <div class="match-header"><span>QF ${i + 1}</span></div>
          ${teamSlotHTML(t1Label, t1Type)}
          ${teamSlotHTML(t2Label, t2Type)}
        </div>
      </div>`;
    });
    html += `</div></div>`;

    // Connector
    html += `<div class="round connector-col ph-connector"><div class="round-title" style="visibility:hidden">.</div></div>`;

    // Semifinais
    html += `<div class="round ph-round">
      <div class="round-title">${SVG.soccer} Semifinal</div>
      <div class="round-matches">`;
    for (let i = 0; i < 2; i++) {
      html += `<div class="match-card-wrapper">
        <div class="match-card ph-match-card ph-match-future">
          <div class="match-header"><span>SF ${i + 1}</span></div>
          ${teamSlotHTML(`Vencedor QF ${i * 2 + 1}`, 'tbd')}
          ${teamSlotHTML(`Vencedor QF ${i * 2 + 2}`, 'tbd')}
        </div>
      </div>`;
    }
    html += `</div></div>`;

    // Connector
    html += `<div class="round connector-col ph-connector"><div class="round-title" style="visibility:hidden">.</div></div>`;

    // Final
    html += `<div class="round ph-round">
      <div class="round-title">${SVG.trophy} Final</div>
      <div class="round-matches">
        <div class="match-card-wrapper">
          <div class="match-card ph-match-card ph-match-future">
            <div class="match-header"><span>FINAL</span></div>
            ${teamSlotHTML('Vencedor SF 1', 'tbd')}
            ${teamSlotHTML('Vencedor SF 2', 'tbd')}
          </div>
        </div>
      </div>
    </div>`;

    html += `</div>`;

    container.innerHTML = html;

    // Bind repechage edit buttons (real matches)
    if (state.groupRepechage) {
      container.querySelectorAll('.ph-edit-btn[data-repechage-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mIdx = parseInt(btn.dataset.repechageIdx, 10);
          openRepechageScoreModal(mIdx);
        });
      });
    }
  }

  /** Main bracket render function */
  function renderBracket() {
    const container = $('#bracket-container');
    const emptyState = $('#empty-state');
    if (!container) return;

    // Clear live timers
    Object.keys(liveTimers).forEach(k => { clearInterval(liveTimers[k]); delete liveTimers[k]; });

    // Clear
    container.innerHTML = '';

    // If groups format is active but bracket hasn't been finalized from groups,
    // show a placeholder bracket with labels instead of real player names
    if (state.tournamentFormat === 'groups' && state.groups && state.groups.length > 0 && !state.bracketFromGroups) {
      if (emptyState) emptyState.style.display = 'none';
      if ($('#btn-finish-tournament')) $('#btn-finish-tournament').style.display = 'none';
      if ($('#bracket-display-mode-selector')) $('#bracket-display-mode-selector').style.display = 'none';
      if ($('#list-container')) $('#list-container').innerHTML = '';
      renderPlaceholderBracket(container);
      return;
    }

    const bracket = getCurrentBracket();

    const hasBracket = bracket && bracket.rounds && bracket.rounds.length > 0;
    const bracketTabBtn = $('#bracket-tab-btn');
    const hasGroups = state.groups && state.groups.length > 0;

    if (bracketTabBtn) {
      bracketTabBtn.style.display = (hasBracket || hasGroups) ? '' : 'none';
    }

    if (!hasBracket) {
      if (emptyState) emptyState.style.display = 'flex';
      if ($('#btn-finish-tournament')) $('#btn-finish-tournament').style.display = 'none';
      if ($('#bracket-display-mode-selector')) $('#bracket-display-mode-selector').style.display = 'none';
      if ($('#list-container')) $('#list-container').innerHTML = '';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if ($('#btn-finish-tournament')) {
      // Só mostra o botão de finalizar se for o torneio atual
      $('#btn-finish-tournament').style.display = currentViewingBracketId ? 'none' : '';
    }
    if ($('#bracket-display-mode-selector')) {
      $('#bracket-display-mode-selector').style.display = 'flex';
    }

    const bracketEl = document.createElement('div');
    bracketEl.className = 'bracket';

    // Se for modo máquina do tempo, avisa no topo do chaveamento
    if (currentViewingBracketId) {
      const timeMachineBar = document.createElement('div');
      timeMachineBar.style.background = 'rgba(255, 149, 0, 0.15)';
      timeMachineBar.style.border = '1px solid var(--accent-orange)';
      timeMachineBar.style.color = 'var(--text-primary)';
      timeMachineBar.style.padding = '12px 16px';
      timeMachineBar.style.borderRadius = 'var(--radius-md)';
      timeMachineBar.style.marginBottom = '20px';
      timeMachineBar.style.display = 'flex';
      timeMachineBar.style.justifyContent = 'space-between';
      timeMachineBar.style.alignItems = 'center';
      timeMachineBar.innerHTML = `
        <div>
          <strong style="color: var(--accent-orange);">Modo de Visualização/Edição do Histórico</strong><br>
          <span style="font-size: 13px;">Você está vendo o chaveamento de: <b>${sanitize(getCurrentBracketName())}</b></span>
        </div>
        <button type="button" class="btn btn-primary btn-sm btn-return-current">
          â† Voltar ao Atual
        </button>
      `;
      const btnReturn = timeMachineBar.querySelector('.btn-return-current');
      btnReturn.addEventListener('click', () => {
        currentViewingBracketId = null;
        renderBracket();
        renderTop3();
      });
      container.appendChild(timeMachineBar);
    }

    // Match filter bar - rendered OUTSIDE bracket scroll container (sticky)
    const counts = getMatchStatusCounts(bracket);
    if (counts.all > 0) {
      const filterBar = document.createElement('div');
      filterBar.className = 'match-filter-bar';
      filterBar.addEventListener('click', e => e.stopPropagation());

      const filters = [
        { key: 'all', label: 'Todas', count: counts.all },
        { key: 'live', label: 'Ao Vivo', count: counts.live },
        { key: 'scheduled', label: 'Agendadas', count: counts.scheduled },
        { key: 'finished', label: 'Finalizadas', count: counts.finished }
      ];

      filters.forEach(f => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'match-filter-btn' + (currentMatchFilter === f.key ? ' active' : '');
        btn.innerHTML = f.label + `<span class="filter-count">${f.count}</span>`;
        btn.addEventListener('click', () => {
          currentMatchFilter = f.key;
          renderBracket();
        });
        filterBar.appendChild(btn);
      });

      container.appendChild(filterBar);

      // Live Matches Area (shown when there are live matches)
      const liveMatches = [];
      bracket.rounds.forEach((round, rIdx) => {
        round.matches.forEach((match, mIdx) => {
          ensureLiveFields(match);
          if (match.status === 'live' || match.status === 'paused') {
            liveMatches.push({ match, rIdx, mIdx, roundName: round.name });
          }
        });
      });

      if (liveMatches.length > 0) {
        const liveArea = document.createElement('div');
        liveArea.className = 'live-matches-area';

        liveMatches.forEach(({ match, rIdx, mIdx, roundName }) => {
          const card = createLiveAreaCard(match, rIdx, mIdx, roundName);
          liveArea.appendChild(card);
        });

        container.appendChild(liveArea);
      }
    }

    bracket.rounds.forEach((round, rIdx) => {
      // Add connector column between rounds (except before the first)
      if (rIdx > 0) {
        const connCol = createConnectorColumn(bracket.rounds[rIdx - 1].matches.length, rIdx);
        bracketEl.appendChild(connCol);
      }

      const roundEl = document.createElement('div');
      roundEl.className = 'round';

      // Round header
      const roundIcon = rIdx === bracket.rounds.length - 1 ? SVG.trophy : SVG.soccer;
      const header = document.createElement('div');
      header.className = 'round-title';
      header.innerHTML = `<span class="icon">${roundIcon}</span> ${sanitize(round.name)}`;
      roundEl.appendChild(header);

      // Matches container
      const matchesEl = document.createElement('div');
      matchesEl.className = 'round-matches';

      round.matches.forEach((match, mIdx) => {
        const card = createMatchCard(match, rIdx, mIdx);
        // Apply filter visibility
        if (currentMatchFilter !== 'all' && !matchPassesFilter(match)) {
          card.style.opacity = '0.2';
          card.style.pointerEvents = 'none';
        }
        matchesEl.appendChild(card);
      });

      // Inject third place match in the final round
      if (rIdx === bracket.rounds.length - 1 && bracket.thirdPlaceMatch) {
         const thirdTitle = document.createElement('div');
         thirdTitle.className = 'round-title third-place-title';
         thirdTitle.style.marginTop = '4rem';
         thirdTitle.innerHTML = `<span class="icon">${SVG.swords}</span> Disputa de 3º Lugar`;
         matchesEl.appendChild(thirdTitle);

         const thirdCard = createMatchCard(bracket.thirdPlaceMatch, -2, 0);
         if (currentMatchFilter !== 'all' && !matchPassesFilter(bracket.thirdPlaceMatch)) {
           thirdCard.style.opacity = '0.2';
           thirdCard.style.pointerEvents = 'none';
         }
         matchesEl.appendChild(thirdCard);
      }

      roundEl.appendChild(matchesEl);
      bracketEl.appendChild(roundEl);
    });

    container.appendChild(bracketEl);

    if (typeof bracketResizeObserver !== 'undefined' && bracketResizeObserver) {
      bracketResizeObserver.disconnect();
      bracketResizeObserver.observe(container);
    }

    // Ensure connectors are redrawn after full layout settles
    scheduleRedrawConnectors();

    // Show champion if already determined
    if (state.champion) {
      renderChampionBannerIfNeeded();
    }

    // Render list view side-by-side
    renderListView();

    // Render repescagem panel
    renderRepescagemPanel();
  }

  /* ---------- 12b. LIST VIEW FEATURE ---------- */
  let currentListPhaseIndex = -1;
  let lastListBracketRef = null;

  function renderListView() {
    const listContainer = $('#list-container');
    if (!listContainer) return;

    const bracket = getCurrentBracket();
    if (!bracket || !bracket.rounds || bracket.rounds.length === 0) {
      listContainer.innerHTML = '';
      return;
    }

    if (lastListBracketRef !== bracket) {
      lastListBracketRef = bracket;
      currentListPhaseIndex = -1;
    }

    if (currentListPhaseIndex === -1) {
      let found = 0;
      for (let r = 0; r < bracket.rounds.length; r++) {
        if (bracket.rounds[r].matches.some(m => !m.winner)) {
          found = r;
          break;
        }
      }
      if (found === 0 && bracket.rounds.length > 0 && bracket.rounds[bracket.rounds.length - 1].matches.every(m => m.winner)) {
        found = bracket.rounds.length - 1;
      }
      currentListPhaseIndex = found;
    }

    if (currentListPhaseIndex >= bracket.rounds.length) {
      currentListPhaseIndex = bracket.rounds.length - 1;
    }
    if (currentListPhaseIndex < 0) currentListPhaseIndex = 0;

    listContainer.innerHTML = '';

    const round = bracket.rounds[currentListPhaseIndex];
    if (!round || !round.matches || round.matches.length === 0) return;

    // Build Navigation Header
    const headerRow = document.createElement('div');
    headerRow.className = 'list-phase-navigation';
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.marginTop = '16px';
    headerRow.style.marginBottom = '24px';
    headerRow.style.padding = '0 8px';

    const btnPrev = document.createElement('button');
    btnPrev.className = 'btn-icon-action list-nav-btn';
    btnPrev.innerHTML = '<svg class="svg-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    btnPrev.disabled = currentListPhaseIndex === 0;
    btnPrev.style.opacity = btnPrev.disabled ? '0.3' : '1';
    btnPrev.style.cursor = btnPrev.disabled ? 'default' : 'pointer';
    btnPrev.onclick = () => {
      if (currentListPhaseIndex > 0) {
        currentListPhaseIndex--;
        renderListView();
      }
    };

    const phaseTitle = document.createElement('div');
    phaseTitle.className = 'phase-list-title';
    phaseTitle.style.marginBottom = '0';
    phaseTitle.textContent = round.name;

    const btnNext = document.createElement('button');
    btnNext.className = 'btn-icon-action list-nav-btn';
    btnNext.innerHTML = '<svg class="svg-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    btnNext.disabled = currentListPhaseIndex === bracket.rounds.length - 1;
    btnNext.style.opacity = btnNext.disabled ? '0.3' : '1';
    btnNext.style.cursor = btnNext.disabled ? 'default' : 'pointer';
    btnNext.onclick = () => {
      if (currentListPhaseIndex < bracket.rounds.length - 1) {
        currentListPhaseIndex++;
        renderListView();
      }
    };

    headerRow.appendChild(btnPrev);
    headerRow.appendChild(phaseTitle);
    headerRow.appendChild(btnNext);
    listContainer.appendChild(headerRow);

    const phaseSection = document.createElement('div');
    phaseSection.className = 'phase-list-section';
    phaseSection.style.animation = 'fadeIn 0.3s ease forwards';

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'match-list-cards';

    const allMatchesToRender = [...round.matches];
    const hasThirdPlace = currentListPhaseIndex === bracket.rounds.length - 1 && bracket.thirdPlaceMatch;
    if (hasThirdPlace) {
       allMatchesToRender.push(bracket.thirdPlaceMatch);
    }

    allMatchesToRender.forEach((match, mIdx) => {
      const isThirdPlaceMatch = hasThirdPlace && mIdx === round.matches.length;

      if (isThirdPlaceMatch) {
         const sep = document.createElement('div');
         sep.className = 'phase-list-title';
         sep.style.marginTop = '2rem';
         sep.innerHTML = `<span class="icon">${SVG.swords}</span> Disputa de 3º Lugar`;
         cardsContainer.appendChild(sep);
      }

      const card = document.createElement('div');
      card.className = 'match-list-card';

      const bothTeams = match.team1 && match.team2;
      const canEdit = isAdmin && bothTeams;

      // Header
      const header = document.createElement('div');
      header.className = 'match-list-header';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';

      const badge = document.createElement('span');
      badge.className = 'match-list-badge';
      if (isThirdPlaceMatch) {
        badge.textContent = '3º Lugar';
      } else {
        badge.textContent = `${round.name.split(' ')[0]} ${mIdx + 1}`;
      }
      header.appendChild(badge);

      if (canEdit && !match.winner) {
        const dtBar = document.createElement('div');
        dtBar.className = 'list-mode-dtbar';
        dtBar.style.display = 'flex';
        dtBar.style.alignItems = 'center';
        dtBar.style.gap = '8px';
        dtBar.style.background = 'rgba(255, 255, 255, 0.1)';
        dtBar.style.borderRadius = '6px';
        dtBar.style.padding = '4px 8px';
        // Prevent click bubbling so it doesn't trigger the score modal
        dtBar.addEventListener('click', e => e.stopPropagation());

        const inptStyle = 'background: transparent; border: none; color: #ccc; font-size: 11px; font-weight: 700; font-family: inherit; outline: none; cursor: pointer; padding: 0; max-width: 90px;';

        const dateInp = document.createElement('input');
        dateInp.type = 'date';
        dateInp.style.cssText = inptStyle;

        const divi = document.createElement('div');
        divi.style.width = '1px';
        divi.style.height = '12px';
        divi.style.backgroundColor = 'rgba(255,255,255,0.2)';

        const timeInp = document.createElement('input');
        timeInp.type = 'time';
        timeInp.style.cssText = inptStyle;

        if (match.dateTime) {
          const parts = match.dateTime.split('T');
          if (parts[0] && parts[0] !== 'HOJE') dateInp.value = parts[0];
          if (parts[1]) timeInp.value = parts[1];
        }

        const saveDateTime = () => {
          const dVal = dateInp.value || 'HOJE';
          const tVal = timeInp.value;
          if (dateInp.value || timeInp.value) {
            match.dateTime = dVal + (tVal ? 'T' + tVal : '');
          } else {
            match.dateTime = null;
          }
          saveState();
        };

        dateInp.addEventListener('change', saveDateTime);
        timeInp.addEventListener('change', () => {
          if (!dateInp.value) dateInp.value = new Date().toISOString().split('T')[0];
          saveDateTime();
        });

        dtBar.appendChild(dateInp);
        dtBar.appendChild(divi);
        dtBar.appendChild(timeInp);
        header.appendChild(dtBar);
      } else {
        const dtSpan = document.createElement('span');
        dtSpan.className = 'match-list-datetime';
        if (match.dateTime) {
          const parts = match.dateTime.split('T');
          let text = '';
          if (parts[0] && parts[0] !== 'HOJE') {
            const dp = parts[0].split('-');
            text = dp.length === 3 ? `${dp[2]}/${dp[1]}` : parts[0];
          } else if (parts[0] === 'HOJE') {
            text = 'Hoje';
          }
          if (parts[1]) {
            text += (text ? ' às ' : '') + parts[1];
          }
          dtSpan.innerHTML = `<svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${text}`;
        } else {
          dtSpan.innerHTML = `<svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> A definir`;
        }
        header.appendChild(dtSpan);
      }
      card.appendChild(header);

      // Versus section
      const versusWrap = document.createElement('div');
      versusWrap.className = 'match-list-versus';

      // Helper function for building a team side
      function buildTeamSide(teamData) {
        const t = document.createElement('div');
        t.className = 'match-list-team';

        let imgHtml = '<span class="av-placeholder" style="font-size:16px;">?</span>';
        let nameHtml = 'A definir';

        if (teamData && isByeTeam(teamData)) {
          t.classList.add('bye-slot');
          imgHtml = '';
          nameHtml = '<span style="font-size:11px; font-weight:600; color:var(--text-tertiary); font-style:italic; letter-spacing:0.1em;">BYE</span>';
          t.innerHTML = `<div class="match-list-name">${nameHtml}</div>`;
          return t;
        }

        if (teamData) {
          const initialsText = initials(teamData.playerName || teamData.teamName);
          const tPhoto = getTeamPhoto(teamData);
          imgHtml = tPhoto ? `<img src="${sanitize(tPhoto)}" alt="">` : `<span class="av-placeholder">${sanitize(initialsText)}</span>`;

          // Get full name from participants
          const p = state.participants ? state.participants.find(part => part.id === teamData.id) : null;
          const fullName = p ? p.name : (teamData.playerName !== teamData.teamName ? teamData.playerName : '');

          nameHtml = `
              <div style="display:flex; flex-direction:column; align-items: center; line-height: 1.1; text-align: center;">
                <span class="nickname-bold" style="font-weight:700; font-size:14px; color:#ffffff;">${sanitize(formatShortName(teamData.playerName || teamData.teamName))}</span>
                <span class="fullname-small" style="font-size:9px; color:rgba(255, 255, 255, 0.6); margin-top:2px;">${sanitize(teamData.teamName)}</span>
              </div>
            `;

          // Open profile on click
          t.classList.add('clickable');
          const teamRecord = state.teams.find(tr => tr.id === teamData.id) || state.teams.find(tr => tr.playerName === teamData.playerName && tr.teamName === teamData.teamName);
          if (teamRecord) {
            t.addEventListener('click', (e) => {
              e.stopPropagation();
              openPlayerProfile(teamRecord.id);
            });
          }
        }

        t.innerHTML = `<div class="match-list-avatar">${imgHtml}</div><div class="match-list-name">${nameHtml}</div>`;

        // Repescagem / Third Chance visual in list view
        if (teamData && isThirdChanceTeam(teamData)) {
          t.classList.add('team-third-chance');
          t.classList.add('team-repescagem');
        } else if (teamData && isRepescagemTeam(teamData)) {
          t.classList.add('team-repescagem');
        }

        return t;
      }

      const t1 = buildTeamSide(match.team1);
      const t2 = buildTeamSide(match.team2);

      // Center X
      const cCenter = document.createElement('div');
      cCenter.className = 'match-list-score-container';

      const s1 = document.createElement('div');
      s1.className = 'match-list-score';
      if (state.twoLegged && match.scoreIda1 != null) {
        const sc1 = (match.team1 && match.team1.score != null) ? match.team1.score : 0;
        const ida1 = match.scoreIda1 ?? 0;
        const volta1 = match.scoreVolta1 ?? 0;
        s1.innerHTML = `${sc1} <small style="font-size:9px; opacity:0.6; display:block; line-height:1; font-weight:400;">(${ida1}-${volta1})</small>`;
      } else {
        s1.textContent = (match.team1 && match.team1.score != null) ? match.team1.score : '';
      }

      const sx = document.createElement('div');
      sx.className = 'match-list-x';
      sx.textContent = 'X';

      const s2 = document.createElement('div');
      s2.className = 'match-list-score';
      if (state.twoLegged && match.scoreIda1 != null) {
        const sc2 = (match.team2 && match.team2.score != null) ? match.team2.score : 0;
        const ida2 = match.scoreIda2 ?? 0;
        const volta2 = match.scoreVolta2 ?? 0;
        s2.innerHTML = `${sc2} <small style="font-size:9px; opacity:0.6; display:block; line-height:1; font-weight:400;">(${ida2}-${volta2})</small>`;
      } else {
        s2.textContent = (match.team2 && match.team2.score != null) ? match.team2.score : '';
      }

      cCenter.appendChild(s1);
      cCenter.appendChild(sx);
      cCenter.appendChild(s2);

      versusWrap.appendChild(t1);
      versusWrap.appendChild(cCenter);
      versusWrap.appendChild(t2);

      card.appendChild(versusWrap);

      // Penalties if they exist
      if (match.penalties) {
        const pen = document.createElement('div');
        pen.style.textAlign = 'center';
        pen.style.fontSize = '12px';
        pen.style.color = '#aaa';
        pen.style.marginTop = '12px';
        pen.innerHTML = `Pênaltis: ${match.penalties.team1} x ${match.penalties.team2}`;
        card.appendChild(pen);
      }

      // Edit hook for Admin
      if (isAdmin && match.team1 && match.team2) {
        card.style.cursor = 'pointer';
        card.title = "Clique para registrar/editar resultado";
        card.addEventListener('click', () => {
          if (isThirdPlaceMatch) openScoreModal(-2, 0);
          else openScoreModal(currentListPhaseIndex, mIdx);
        });
      }

      cardsContainer.appendChild(card);
    });

    phaseSection.appendChild(cardsContainer);
    listContainer.appendChild(phaseSection);
  }

  // Bracket Display Mode Toggle Logic
  document.addEventListener('DOMContentLoaded', () => {
    function toggleMode() {
      const listRadio = document.getElementById('mode-list');
      const bContainer = document.getElementById('bracket-container');
      const lContainer = document.getElementById('list-container');

      if (bContainer && lContainer && listRadio) {
        const hintWrapper = document.querySelector('#bracket-tab .scroll-hint-wrapper');
        if (listRadio.checked) {
          bContainer.style.display = 'none';
          lContainer.style.display = 'block';
          if (hintWrapper) hintWrapper.style.display = 'none';
        } else {
          bContainer.style.display = 'block';
          lContainer.style.display = 'none';
          if (hintWrapper) hintWrapper.style.display = 'flex';
        }
      }
    }

    const listRadio = document.getElementById('mode-list');
    const treeRadio = document.getElementById('mode-tree');
    if (listRadio) listRadio.addEventListener('change', toggleMode);
    if (treeRadio) treeRadio.addEventListener('change', toggleMode);
  });

  /**
   * Create a connector column (SVG lines) between two rounds.
   * @param {number} prevMatchCount â€“ number of matches in the previous round
   * @param {number} roundIndex
   * @returns {HTMLElement}
   */
  function createConnectorColumn(prevMatchCount, roundIndex) {
    const col = document.createElement('div');
    col.className = 'round connector-col';

    // We add a title placeholder to align with the round headers
    const titlePlaceholder = document.createElement('div');
    titlePlaceholder.className = 'round-title';
    titlePlaceholder.innerHTML = '&nbsp;';
    col.appendChild(titlePlaceholder);

    const svgWrap = document.createElement('div');
    svgWrap.style.flex = '1';
    svgWrap.style.position = 'relative';
    svgWrap.style.width = '100%';
    col.appendChild(svgWrap);

    // Use double requestAnimationFrame to ensure layout is fully settled
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawConnectors(svgWrap, col, prevMatchCount, roundIndex);
      });
    });

    return col;
  }

  let connectorRedrawTimeout = null;
  function scheduleRedrawConnectors() {
    if (connectorRedrawTimeout) clearTimeout(connectorRedrawTimeout);

    const redraw = () => {
      const container = document.getElementById('bracket-container');
      if (!container || container.style.display === 'none') return;
      const bracketEl = container.querySelector('.bracket');
      if (!bracketEl) return;

      // Adjust card positions for perfect bracket alignment before drawing connectors
      adjustBracketAlignment();

      const children = Array.from(bracketEl.children);
      children.forEach((col, idx) => {
        if (col.classList.contains('connector-col')) {
          const svgWrap = col.querySelector('div:last-child');
          if (svgWrap) {
            const roundIndex = (idx + 1) / 2;
            drawConnectors(svgWrap, col, 0, roundIndex);
          }
        }
      });
    };

    // Double RAF for immediate redraw after layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(redraw);
    });
    // Backup redraw after a delay to handle late layout changes (fonts, images, etc.)
    connectorRedrawTimeout = setTimeout(redraw, 150);
  }

  let bracketResizeObserver = null;
  if (typeof window !== 'undefined' && window.ResizeObserver) {
    bracketResizeObserver = new ResizeObserver(() => {
      scheduleRedrawConnectors();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleRedrawConnectors);
  }

  /**
   * Adjust bracket card positions to ensure each card in rounds after the first
   * is perfectly centered between its two predecessor matches.
   * Uses position: relative + top to shift cards without affecting flexbox layout.
   */
  function adjustBracketAlignment() {
    const container = document.getElementById('bracket-container');
    if (!container || container.style.display === 'none') return;
    const bracket = container.querySelector('.bracket');
    if (!bracket) return;

    const rounds = bracket.querySelectorAll('.round:not(.connector-col)');
    if (rounds.length < 2) return;

    // Reset any previous adjustments before recalculating
    rounds.forEach(round => {
      round.querySelectorAll('.match-card-wrapper').forEach(wrapper => {
        wrapper.style.top = '';
        wrapper.style.marginTop = '';
      });
    });

    // Force layout recalc after reset
    bracket.offsetHeight;

    // Collect center Y of each card per round
    const roundCenters = [];
    rounds.forEach(round => {
      const wrappers = round.querySelectorAll('.match-card-wrapper');
      const centers = [];
      wrappers.forEach(wrapper => {
        const card = wrapper.querySelector('.match-card');
        if (!card) return;
        const teams = card.querySelectorAll('.match-team');
        let centerY;
        if (teams.length >= 2) {
          const t1 = teams[0].getBoundingClientRect();
          const t2 = teams[1].getBoundingClientRect();
          centerY = (t1.bottom + t2.top) / 2;
        } else {
          const rect = card.getBoundingClientRect();
          centerY = rect.top + rect.height / 2;
        }
        centers.push(centerY);
      });
      roundCenters.push(centers);
    });

    // Adjust subsequent rounds so each card is centered between its two predecessors
    for (let r = 1; r < rounds.length; r++) {
      const prevCenters = roundCenters[r - 1];
      const wrappers = rounds[r].querySelectorAll('.match-card-wrapper');

      for (let m = 0; m < wrappers.length; m++) {
        const p1 = m * 2;
        const p2 = m * 2 + 1;
        
        if (p1 >= prevCenters.length || p2 >= prevCenters.length) continue;

        const idealCenter = (prevCenters[p1] + prevCenters[p2]) / 2;
        const actualCenter = roundCenters[r][m];
        const offset = idealCenter - actualCenter;

        if (Math.abs(offset) > 0.5) {
          if (r === rounds.length - 1) {
            // In the final round, use margin-top so it expands container height
            // and naturally pushes the 3rd place match down without cutting it off.
            wrappers[m].style.marginTop = offset + 'px';
          } else {
            // Use relative positioning to shift without affecting flex siblings
            wrappers[m].style.position = 'relative';
            wrappers[m].style.top = offset + 'px';
          }
          // Update center for cascading adjustments to later rounds
          roundCenters[r][m] = idealCenter;
        }
      }
    }
  }

  /**
   * Draw SVG connector lines inside the connector column.
   * Lines connect pairs of matches from the previous round to match slots in the next round.
   */
  function drawConnectors(svgWrap, col, prevMatchCount, roundIndex) {
    const bracket = col.closest('.bracket');
    if (!bracket) return;

    const rounds = bracket.querySelectorAll('.round:not(.connector-col)');
    const prevRound = rounds[roundIndex - 1];
    const nextRound = rounds[roundIndex];
    if (!prevRound || !nextRound) return;

    const prevCards = prevRound.querySelectorAll('.match-card');
    const nextCards = nextRound.querySelectorAll('.match-card');
    if (prevCards.length === 0 || nextCards.length === 0) return;

    svgWrap.innerHTML = '';
    const svgWrapRect = svgWrap.getBoundingClientRect();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bracket-svg');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = svgWrap.offsetHeight + 'px';
    svg.style.overflow = 'visible';

    const colWidth = svgWrap.offsetWidth;

    for (let i = 0; i < prevCards.length; i += 2) {
      const nextIdx = Math.floor(i / 2);
      if (nextIdx >= nextCards.length) break;

      const card1 = prevCards[i];
      const card2 = prevCards[i + 1];
      const target = nextCards[nextIdx];

      if (!card1 || !card2 || !target) continue;

      const r1 = card1.getBoundingClientRect();
      const r2 = card2.getBoundingClientRect();
      const rt = target.getBoundingClientRect();

      const getCenterY = (cardRect, card) => {
        const teams = card.querySelectorAll('.match-team');
        if (teams.length >= 2) {
          const t1Rect = teams[0].getBoundingClientRect();
          const t2Rect = teams[1].getBoundingClientRect();
          return (t1Rect.bottom + t2Rect.top) / 2 - svgWrapRect.top;
        }
        return cardRect.top + cardRect.height / 2 - svgWrapRect.top;
      };

      // Y positions relative to the svg container
      const y1 = getCenterY(r1, card1);
      const y2 = getCenterY(r2, card2);
      const yt = getCenterY(rt, target);

      const midX = colWidth / 2;

      // Line from card1 right edge to midpoint
      addLine(svg, 0, y1, midX, y1);
      // Line from card2 right edge to midpoint
      addLine(svg, 0, y2, midX, y2);
      // Vertical line connecting all three points
      const minY = Math.min(y1, y2, yt);
      const maxY = Math.max(y1, y2, yt);
      addLine(svg, midX, minY, midX, maxY);
      // Horizontal line from midpoint to next round
      addLine(svg, midX, yt, colWidth, yt);
    }

    svgWrap.appendChild(svg);
  }

  /** Helper to add an SVG line */
  function addLine(svg, x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(173, 199, 255, 0.15)');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }

  /**
   * Create a single match card element.
   * @param {object} match
   * @param {number} rIdx â€“ round index
   * @param {number} mIdx â€“ match index
   * @returns {HTMLElement}
   */
  function createMatchCard(match, rIdx, mIdx) {
    ensureLiveFields(match);

    const wrapper = document.createElement('div');
    wrapper.className = 'match-card-wrapper';

    const isByeMatch = isByeTeam(match.team1) || isByeTeam(match.team2);

    const card = document.createElement('div');
    card.className = 'match-card' + (isByeMatch ? ' match-bye' : '');
    card.dataset.matchId = match.id;

    const isLive = match.status === 'live';
    const isPaused = match.status === 'paused';
    const isFinished = match.status === 'finished';
    const isScheduled = match.status === 'scheduled';

    if (isLive) card.classList.add('match-live');
    if (isPaused) card.classList.add('match-paused');

    // Header
    const header = document.createElement('div');
    header.className = 'match-header';

    const matchLabel = document.createElement('span');
    matchLabel.className = 'match-id';
    if (isByeMatch) {
      matchLabel.textContent = 'BYE';
    } else {
      // Use short round name prefix instead of "Jogo"
      let roundPrefix = 'Jogo';
      try {
        const rName = state.bracket.rounds[rIdx].name || '';
        if (/oitavas/i.test(rName)) roundPrefix = 'Oitavas';
        else if (/quartas/i.test(rName)) roundPrefix = 'Quartas';
        else if (/semi/i.test(rName)) roundPrefix = 'Semi';
        else if (/final/i.test(rName) && !/semi/i.test(rName)) roundPrefix = 'Final';
        else if (/dezesseis/i.test(rName)) roundPrefix = '16 Avos';
        else if (/fase/i.test(rName)) roundPrefix = rName.replace(/\s*\(.*\)/, '');
      } catch (e) { }
      matchLabel.textContent = roundPrefix === 'Final' ? 'FINAL' : `${roundPrefix} ${mIdx + 1}`;
    }
    header.appendChild(matchLabel);

    const bothTeams = match.team1 && match.team2;
    const canEdit = isAdmin && bothTeams;

    // Edit button (admin only) — show "Resultado" only when not live/paused
    if (canEdit && !isLive && !isPaused) {
      const editBtn = document.createElement('button');
      editBtn.className = 'match-schedule icon-btn';
      editBtn.type = 'button';
      editBtn.innerHTML = SVG.pencil + (match.winner ? ' Editar' : ' Resultado');
      editBtn.addEventListener('click', () => openScoreModal(rIdx, mIdx));
      header.appendChild(editBtn);
    } else if (isFinished && !isAdmin) {
      const doneSpan = document.createElement('span');
      doneSpan.style.cssText = 'font-size:11px;color:var(--accent-green);font-weight:600;';
      doneSpan.innerHTML = SVG.checkCircle + ' Finalizado';
      header.appendChild(doneSpan);
    }

    card.appendChild(header);

    // LIVE BADGE BAR
    if (isLive || isPaused) {
      const liveBadge = document.createElement('div');
      liveBadge.className = 'live-badge-bar';

      const dot = document.createElement('span');
      dot.className = 'live-dot';
      liveBadge.appendChild(dot);

      const txt = document.createElement('span');
      txt.className = isLive ? 'live-text' : 'paused-text';
      txt.textContent = isLive ? 'AO VIVO' : 'PAUSADO';
      liveBadge.appendChild(txt);

      // Ida/Volta leg indicator
      if (state.twoLegged && match.currentLeg) {
        const legBadge = document.createElement('span');
        legBadge.className = 'live-leg-badge';
        legBadge.textContent = match.currentLeg === 'ida' ? 'Ida' : 'Volta';
        liveBadge.appendChild(legBadge);
      }

      // Timer display
      const timerEl = document.createElement('span');
      timerEl.className = 'live-timer';
      timerEl.textContent = formatElapsed(getMatchElapsedSeconds(match));
      liveBadge.appendChild(timerEl);

      card.appendChild(liveBadge);

      // Start updating the timer if live
      if (isLive) {
        setTimeout(() => startLiveTimerDisplay(match.id, timerEl, match), 0);
      }
    }

    // SCHEDULED BADGE
    if (isScheduled && !isLive && !isPaused) {
      const schedBadge = document.createElement('div');
      schedBadge.className = 'scheduled-badge-bar';
      schedBadge.innerHTML = SVG.clock + ' <span class="scheduled-text">Agendada</span>';
      card.appendChild(schedBadge);
    }

    // Team 1 slot
    card.appendChild(createTeamSlot(match.team1, match, 1));

    // Team 2 slot
    card.appendChild(createTeamSlot(match.team2, match, 2));

    // Aggregate score display for two-legged matches (live or finished)
    if (shouldShowAggregate(match)) {
      const s1 = match.team1 ? (match.team1.score ?? 0) : 0;
      const s2 = match.team2 ? (match.team2.score ?? 0) : 0;
      const ida1 = match.scoreIda1 ?? 0;
      const ida2 = match.scoreIda2 ?? 0;

      let agg1, agg2, legLabel;
      if (match.currentLeg === 'volta') {
        agg1 = ida1 + s1;
        agg2 = ida2 + s2;
        legLabel = `Ida: ${ida1}×${ida2} | Volta: ${s1}×${s2}`;
      } else {
        agg1 = s1;
        agg2 = s2;
        legLabel = `Ida: ${s1}×${s2}`;
      }

      const aggBar = document.createElement('div');
      aggBar.className = 'match-aggregate-bar';
      aggBar.innerHTML = `${sanitize(legLabel)} — Agregado: <strong>${agg1} × ${agg2}</strong>`;
      card.appendChild(aggBar);
    }

    // Penalty info
    if (match.penalties) {
      const penDiv = document.createElement('div');
      penDiv.className = 'match-penalty-info';
      penDiv.innerHTML = `Pênaltis: ${match.penalties.team1} <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;"><path d="M18 6 6 18M6 6l12 12"/></svg> ${match.penalties.team2}`;
      card.appendChild(penDiv);
    }

    // LIVE SCORE CONTROLS (admin only, during live/paused)
    if (isAdmin && (isLive || isPaused) && match.team1 && match.team2) {
      const scoreControls = document.createElement('div');
      scoreControls.className = 'live-score-controls';
      scoreControls.addEventListener('click', e => e.stopPropagation());

      const t1Name = formatShortName(match.team1.playerName || match.team1.teamName).substring(0, 10);
      const t2Name = formatShortName(match.team2.playerName || match.team2.teamName).substring(0, 10);

      scoreControls.innerHTML = `
        <div class="live-score-team">
          <button type="button" class="live-score-btn btn-minus-t1" title="−1 ${sanitize(t1Name)}">−</button>
          <span class="live-score-value" data-team="1">${match.team1.score || 0}</span>
          <button type="button" class="live-score-btn btn-plus-t1" title="+1 ${sanitize(t1Name)}">+</button>
        </div>
        <span class="live-score-vs">×</span>
        <div class="live-score-team">
          <button type="button" class="live-score-btn btn-minus-t2" title="−1 ${sanitize(t2Name)}">−</button>
          <span class="live-score-value" data-team="2">${match.team2.score || 0}</span>
          <button type="button" class="live-score-btn btn-plus-t2" title="+1 ${sanitize(t2Name)}">+</button>
        </div>
      `;

      scoreControls.querySelector('.btn-plus-t1').addEventListener('click', () => updateLiveScore(rIdx, mIdx, 1, 1));
      scoreControls.querySelector('.btn-minus-t1').addEventListener('click', () => updateLiveScore(rIdx, mIdx, 1, -1));
      scoreControls.querySelector('.btn-plus-t2').addEventListener('click', () => updateLiveScore(rIdx, mIdx, 2, 1));
      scoreControls.querySelector('.btn-minus-t2').addEventListener('click', () => updateLiveScore(rIdx, mIdx, 2, -1));

      card.appendChild(scoreControls);
    }

    // ADMIN LIVE CONTROL BUTTONS
    if (isAdmin && bothTeams && !isFinished) {
      const controls = document.createElement('div');
      controls.className = 'live-admin-controls';
      controls.addEventListener('click', e => e.stopPropagation());

      const isTwoLegged = !!state.twoLegged;

      if (!isLive && !isPaused) {
        // Show "Iniciar ao vivo" button
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'live-ctrl-btn btn-start-live';
        startBtn.innerHTML = '<span class="live-dot" style="width:6px;height:6px;animation:livePulse 1.2s ease-in-out infinite;"></span> Iniciar ao vivo';
        startBtn.addEventListener('click', () => startLiveMatch(rIdx, mIdx));
        controls.appendChild(startBtn);

        // Ida/Volta selector for two-legged tournaments
        if (isTwoLegged) {
          const legSelect = document.createElement('select');
          legSelect.className = 'live-ctrl-btn';
          legSelect.style.cssText = 'padding: 3px 6px; font-size: 9px; background: rgba(255,255,255,0.06); color: var(--on-surface); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer;';
          legSelect.innerHTML = `
            <option value="ida" ${match.currentLeg === 'volta' ? '' : 'selected'}>Jogo de Ida</option>
            <option value="volta" ${match.currentLeg === 'volta' ? 'selected' : ''}>Jogo de Volta</option>
          `;
          legSelect.addEventListener('change', () => {
            const bracket = getCurrentBracket();
            if (!bracket) return;
            const m = getMatch(rIdx, mIdx);
            if (m) { m.currentLeg = legSelect.value; saveState(); }
          });
          controls.appendChild(legSelect);
        }
      }

      if (isLive) {
        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button';
        pauseBtn.className = 'live-ctrl-btn btn-pause-live';
        pauseBtn.textContent = '⏸ Pausar';
        pauseBtn.addEventListener('click', () => pauseLiveMatch(rIdx, mIdx));
        controls.appendChild(pauseBtn);

        if (isTwoLegged && match.currentLeg === 'ida') {
          const endIdaBtn = document.createElement('button');
          endIdaBtn.type = 'button';
          endIdaBtn.className = 'live-ctrl-btn btn-end-ida';
          endIdaBtn.textContent = '✓ Encerrar Ida';
          endIdaBtn.addEventListener('click', () => finalizeIdaLeg(rIdx, mIdx));
          controls.appendChild(endIdaBtn);
        } else {
          const endBtn = document.createElement('button');
          endBtn.type = 'button';
          endBtn.className = 'live-ctrl-btn btn-end-live';
          endBtn.textContent = '✓ Encerrar partida';
          endBtn.addEventListener('click', () => showFinalizeConfirm(rIdx, mIdx));
          controls.appendChild(endBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'live-ctrl-btn btn-cancel-live';
        cancelBtn.textContent = '✕ Cancelar ao vivo';
        cancelBtn.addEventListener('click', () => cancelLiveMatch(rIdx, mIdx));
        controls.appendChild(cancelBtn);
      }

      if (isPaused) {
        const resumeBtn = document.createElement('button');
        resumeBtn.type = 'button';
        resumeBtn.className = 'live-ctrl-btn btn-start-live';
        resumeBtn.textContent = '▶ Retomar';
        resumeBtn.addEventListener('click', () => resumeLiveMatch(rIdx, mIdx));
        controls.appendChild(resumeBtn);

        if (isTwoLegged && match.currentLeg === 'ida') {
          const endIdaBtn = document.createElement('button');
          endIdaBtn.type = 'button';
          endIdaBtn.className = 'live-ctrl-btn btn-end-ida';
          endIdaBtn.textContent = '✓ Encerrar Ida';
          endIdaBtn.addEventListener('click', () => finalizeIdaLeg(rIdx, mIdx));
          controls.appendChild(endIdaBtn);
        } else {
          const endBtn = document.createElement('button');
          endBtn.type = 'button';
          endBtn.className = 'live-ctrl-btn btn-end-live';
          endBtn.textContent = '✓ Encerrar partida';
          endBtn.addEventListener('click', () => showFinalizeConfirm(rIdx, mIdx));
          controls.appendChild(endBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'live-ctrl-btn btn-cancel-live';
        cancelBtn.textContent = '✕ Cancelar ao vivo';
        cancelBtn.addEventListener('click', () => cancelLiveMatch(rIdx, mIdx));
        controls.appendChild(cancelBtn);
      }

      card.appendChild(controls);
    }

    // LIVE EVENTS LOG (show recent events for live/paused matches)
    if ((isLive || isPaused) && match.liveEvents && match.liveEvents.length > 0) {
      const logDiv = document.createElement('div');
      logDiv.className = 'live-events-log';

      // Show most recent events (up to 5)
      const recentEvents = match.liveEvents.slice(-5);
      recentEvents.forEach(evt => {
        const item = document.createElement('div');
        item.className = 'live-event-item';
        item.innerHTML = `
          <span class="event-time">${sanitize(evt.time)}</span>
          <span class="event-desc">${sanitize(evt.desc)}</span>
        `;
        logDiv.appendChild(item);
      });

      card.appendChild(logDiv);
    }

    // Add card to wrapper
    wrapper.appendChild(card);

    // DATE/TIME BAR OUTSIDE CARD — visible on the bracket, below the card
    if (canEdit && !match.winner && !isLive && !isPaused) {
      const dtBar = document.createElement('div');
      dtBar.className = 'match-dt-footer';
      dtBar.addEventListener('click', e => e.stopPropagation());

      const inptStyle = 'background: transparent; border: none; color: #ccc; font-size: 11px; font-weight: 700; font-family: inherit; outline: none; cursor: pointer; padding: 0; text-align: center; max-width: 90px;';

      const dateInp = document.createElement('input');
      dateInp.type = 'date';
      dateInp.style.cssText = inptStyle;

      const divi = document.createElement('div');
      divi.style.width = '1px';
      divi.style.height = '12px';
      divi.style.backgroundColor = 'rgba(255,255,255,0.2)';

      const timeInp = document.createElement('input');
      timeInp.type = 'time';
      timeInp.style.cssText = inptStyle;

      if (match.dateTime) {
        const parts = match.dateTime.split('T');
        if (parts[0] && parts[0] !== 'HOJE') dateInp.value = parts[0];
        if (parts[1]) timeInp.value = parts[1];
      }

      const saveDateTime = () => {
        const dVal = dateInp.value || 'HOJE';
        const tVal = timeInp.value;
        if (dateInp.value || timeInp.value) {
          match.dateTime = dVal + (tVal ? 'T' + tVal : '');
          if (match.status === 'not_started') {
            match.status = 'scheduled';
          }
        } else {
          match.dateTime = null;
          if (match.status === 'scheduled') {
            match.status = 'not_started';
          }
        }
        saveState();
        renderBracket();
      };

      dateInp.addEventListener('change', saveDateTime);
      timeInp.addEventListener('change', () => {
        if (!dateInp.value) dateInp.value = new Date().toISOString().split('T')[0];
        saveDateTime();
      });

      dtBar.appendChild(dateInp);
      dtBar.appendChild(divi);
      dtBar.appendChild(timeInp);
      wrapper.appendChild(dtBar);
    } else if (match.dateTime && !isLive && !isPaused) {
      const dtBar = document.createElement('div');
      dtBar.className = 'match-dt-footer readonly';

      try {
        const [datePart, timePart] = match.dateTime.split('T');
        let formatted = '';
        if (datePart && datePart !== 'HOJE') {
          const parts = datePart.split('-');
          formatted = parts.length === 3 ? `${parts[2]}/${parts[1]}` : datePart;
        } else if (datePart === 'HOJE') {
          formatted = 'Hoje';
        }
        if (timePart) {
          formatted += (formatted ? ' às ' : '') + timePart;
        }
        dtBar.innerHTML = `<span style="font-size:11px;font-weight:700;color:inherit;display:flex;align-items:center;gap:4px;"><svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${formatted}</span>`;
      } catch (_) {
        dtBar.textContent = match.dateTime;
      }
      wrapper.appendChild(dtBar);
    }

    return wrapper;
  }

  /**
   * Create a live area card for the top live matches strip.
   */
  function createLiveAreaCard(match, rIdx, mIdx, roundName) {
    const card = document.createElement('div');
    card.className = 'live-area-card';

    const isLive = match.status === 'live';
    const isPaused = match.status === 'paused';
    const isTwoLegged = !!state.twoLegged;

    // Header
    const header = document.createElement('div');
    header.className = 'live-area-header';

    const dot = document.createElement('span');
    dot.className = 'live-dot';
    header.appendChild(dot);

    const txt = document.createElement('span');
    txt.className = isLive ? 'live-text' : 'paused-text';
    txt.textContent = isLive ? 'AO VIVO' : 'PAUSADO';
    header.appendChild(txt);

    // Ida/Volta indicator
    if (isTwoLegged && match.currentLeg) {
      const legBadge = document.createElement('span');
      legBadge.className = 'live-leg-indicator';
      legBadge.textContent = match.currentLeg === 'ida' ? 'Jogo de Ida' : 'Jogo de Volta';
      header.appendChild(legBadge);
    }

    const timerEl = document.createElement('span');
    timerEl.className = 'live-timer';
    timerEl.textContent = formatElapsed(getMatchElapsedSeconds(match));
    header.appendChild(timerEl);

    if (isLive) {
      setTimeout(() => startLiveTimerDisplay(match.id + '-area', timerEl, match), 0);
    }

    card.appendChild(header);

    // Body - teams and scores
    const body = document.createElement('div');
    body.className = 'live-area-body';

    const t1 = match.team1;
    const t2 = match.team2;
    const t1Name = t1 ? formatShortName(t1.playerName || t1.teamName || '?') : 'A definir';
    const t2Name = t2 ? formatShortName(t2.playerName || t2.teamName || '?') : 'A definir';
    const s1 = t1 ? (t1.score || 0) : 0;
    const s2 = t2 ? (t2.score || 0) : 0;

    body.innerHTML = `
      <div class="live-area-team">
        <span class="live-area-team-name">${sanitize(t1Name)}</span>
        <span class="live-area-score">${s1}</span>
      </div>
      <div class="live-area-vs">×</div>
      <div class="live-area-team">
        <span class="live-area-team-name">${sanitize(t2Name)}</span>
        <span class="live-area-score">${s2}</span>
      </div>
    `;

    card.appendChild(body);

    // Aggregate display for two-legged
    if (isTwoLegged && match.scoreIda1 !== undefined) {
      const ida1 = match.scoreIda1 || 0;
      const ida2 = match.scoreIda2 || 0;
      const volta1 = match.scoreVolta1 || 0;
      const volta2 = match.scoreVolta2 || 0;

      let agg1, agg2;
      if (match.currentLeg === 'volta') {
        // During volta: current scores are volta scores, ida already recorded
        agg1 = ida1 + s1;
        agg2 = ida2 + s2;
      } else {
        // During ida: current scores ARE the ida scores, no volta yet
        agg1 = s1;
        agg2 = s2;
      }

      const aggDiv = document.createElement('div');
      aggDiv.className = 'live-area-aggregate';
      aggDiv.innerHTML = `Agregado: <strong>${agg1} × ${agg2}</strong>`;
      card.appendChild(aggDiv);
    }

    return card;
  }

  let activeTouchData = null;

  function createTeamSlot(team, match, teamNum) {
    const slot = document.createElement('div');
    slot.className = 'match-team';
    slot.dataset.matchId = match.id;
    slot.dataset.teamNum = teamNum;

    // Configurações de Drag and Drop se for organizador e partida SEM resultado
    if (isAdmin && !match.winner) {
      slot.classList.add('droppable-slot');

      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', (e) => {
        slot.classList.remove('drag-over');
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const draggedDataStr = e.dataTransfer.getData('application/json');
        if (!draggedDataStr) return;

        try {
          const draggedInfo = JSON.parse(draggedDataStr);
          swapTeamsInBracket(draggedInfo, { matchId: match.id, teamNum });
        } catch (err) {
          console.error(err);
        }
      });
    }

    if (!team) {
      // TBD slot
      const nameSpan = document.createElement('span');
      nameSpan.className = 'team-name-bracket tbd';
      nameSpan.textContent = 'A definir';
      slot.appendChild(nameSpan);
      return slot;
    }

    // BYE slot
    if (isByeTeam(team)) {
      slot.classList.add('bye-slot');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'team-name-bracket bye-label';
      nameSpan.textContent = 'BYE';
      slot.appendChild(nameSpan);
      slot.draggable = false;
      return slot;
    }

    if (isAdmin && !match.winner) {
      // PC: Mouse Drag Drop — only if match has no result yet
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        const dragData = { matchId: match.id, teamNum };
        e.dataTransfer.setData('application/json', JSON.stringify(dragData));
        setTimeout(() => slot.classList.add('dragging'), 0);
      });
      slot.addEventListener('dragend', () => {
        slot.classList.remove('dragging');
      });

      // MOBILE: Touch Drag Drop
      let touchTimeout = null;
      let startTouchPos = null;

      slot.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1 || activeTouchGhost) return; // Ignore multi-touch ou arrastar duplo

        const touch = e.touches[0];
        startTouchPos = { x: touch.clientX, y: touch.clientY };

        touchTimeout = setTimeout(() => {
          // 3 seconds passed without significant movement
          if (navigator.vibrate) navigator.vibrate(100); // Vibrate!

          activeTouchData = { matchId: match.id, teamNum };

          activeTouchGhost = slot.cloneNode(true);
          activeTouchGhost.style.position = 'fixed';
          activeTouchGhost.style.opacity = '0.8';
          activeTouchGhost.style.pointerEvents = 'none';
          activeTouchGhost.style.zIndex = '99999';
          activeTouchGhost.style.transform = 'scale(1.05)';
          activeTouchGhost.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';

          activeTouchGhost.style.left = (startTouchPos.x - (slot.offsetWidth / 2)) + 'px';
          activeTouchGhost.style.top = (startTouchPos.y - (slot.offsetHeight / 2)) + 'px';

          document.body.appendChild(activeTouchGhost);
          slot.classList.add('dragging');

          // Disable scroll behavior temporary for better drag
          document.body.style.overflow = 'hidden';
        }, 3000); // 3 SEGUNDOS como solicitado
      }, { passive: false });

      slot.addEventListener('touchmove', (e) => {
        if (!activeTouchGhost) {
          // Not dragging yet, still measuring for timeout
          if (touchTimeout && startTouchPos) {
            const touch = e.touches[0];
            const dx = touch.clientX - startTouchPos.x;
            const dy = touch.clientY - startTouchPos.y;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
              clearTimeout(touchTimeout);
              touchTimeout = null;
              startTouchPos = null;
            }
          }
          return;
        }

        e.preventDefault(); // Stop scrolling while dragging

        const touch = e.touches[0];
        activeTouchGhost.style.left = (touch.clientX - (slot.offsetWidth / 2)) + 'px';
        activeTouchGhost.style.top = (touch.clientY - (slot.offsetHeight / 2)) + 'px';

        // Find which slot we are hovering
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        const targetSlot = elem && elem.closest('.match-team.droppable-slot');
        if (targetSlot && targetSlot !== slot) {
          targetSlot.classList.add('drag-over');
        }
      }, { passive: false });

      const handleTouchEndOrCancel = (e) => {
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          touchTimeout = null;
        }
        startTouchPos = null;

        document.body.style.overflow = ''; // Restore smooth scrolling

        if (!activeTouchGhost) return;

        slot.classList.remove('dragging');

        if (e.type === 'touchend' && e.changedTouches && e.changedTouches.length > 0) {
          const touch = e.changedTouches[0];
          const elem = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetSlot = elem && elem.closest('.match-team.droppable-slot');

          if (targetSlot && targetSlot !== slot) {
            const targetMatchId = targetSlot.dataset.matchId;
            const targetTeamNum = parseInt(targetSlot.dataset.teamNum);
            if (targetMatchId && targetTeamNum) {
              swapTeamsInBracket(activeTouchData, { matchId: targetMatchId, teamNum: targetTeamNum });
            }
          }
        }

        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (activeTouchGhost) {
          activeTouchGhost.remove();
          activeTouchGhost = null;
        }
        activeTouchData = null;
      };

      slot.addEventListener('touchend', handleTouchEndOrCancel);
      slot.addEventListener('touchcancel', handleTouchEndOrCancel);
    }

    // Winner/loser styling
    if (match.winner === teamNum) {
      slot.classList.add('winner');
    } else if (match.winner && match.winner !== teamNum) {
      slot.classList.add('loser');
    }

    // Repescagem / Third Chance visual indicators
    if (isThirdChanceTeam(team)) {
      slot.classList.add('team-third-chance');
      slot.classList.add('team-repescagem');
    } else if (isRepescagemTeam(team)) {
      slot.classList.add('team-repescagem');
    }

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'team-avatar';
    const tPhoto = getTeamPhoto(team);
    if (tPhoto) {
      const avImg = document.createElement('img');
      avImg.src = tPhoto;
      avImg.alt = '';
      avatar.appendChild(avImg);
    } else {
      const avPlaceholder = document.createElement('span');
      avPlaceholder.className = 'av-placeholder';
      avPlaceholder.textContent = initials(team.playerName);
      avatar.appendChild(avPlaceholder);
    }
    slot.appendChild(avatar);

    // Player name (primary display in bracket)
    const nameWrapper = document.createElement('div');
    nameWrapper.style.display = 'flex';
    nameWrapper.style.flexDirection = 'column';
    nameWrapper.style.overflow = 'hidden';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'team-name-bracket';
    nameSpan.style.fontWeight = '700'; // Nickname in BOLD
    nameSpan.style.color = '#ffffff'; // White color for nickname
    nameSpan.textContent = formatShortName(team.playerName || team.teamName);
    nameSpan.title = `${team.playerName} — ${team.teamName}`;
    nameWrapper.appendChild(nameSpan);

    // Nick in small text
    const fullNameSpan = document.createElement('span');
    fullNameSpan.style.fontSize = '9px';
    fullNameSpan.style.color = 'var(--text-tertiary)';
    fullNameSpan.style.marginTop = '-2px';
    fullNameSpan.style.whiteSpace = 'nowrap';
    fullNameSpan.style.overflow = 'hidden';
    fullNameSpan.style.textOverflow = 'ellipsis';
    fullNameSpan.textContent = team.teamName || '';
    nameWrapper.appendChild(fullNameSpan);

    // Make player name clickable to show profile
    const teamRecord = state.teams.find(t => t.id === team.id) || state.teams.find(t => t.playerName === team.playerName && t.teamName === team.teamName);
    if (teamRecord) {
      slot.classList.add('clickable');
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayerProfile(teamRecord.id);
      });
    }

    slot.appendChild(nameWrapper);

    // Repescagem / Third Chance badge
    if (isThirdChanceTeam(team)) {
      const badge = document.createElement('span');
      badge.className = 'repescagem-slot-badge third-chance-badge';
      badge.textContent = '3ª';
      badge.title = '3ª Chance Extraordinária — Compensação estrutural';
      slot.appendChild(badge);
    } else if (isRepescagemTeam(team)) {
      const badge = document.createElement('span');
      badge.className = 'repescagem-slot-badge';
      badge.textContent = 'R';
      badge.title = 'Repescagem';
      slot.appendChild(badge);
    }

    // Score
    if (team.score != null) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score-display';

      if (state.twoLegged && match.scoreIda1 != null) {
        const ida = (teamNum === 1 ? match.scoreIda1 : match.scoreIda2) ?? 0;
        const volta = (teamNum === 1 ? match.scoreVolta1 : match.scoreVolta2) ?? 0;
        scoreSpan.innerHTML = `<span>${team.score}</span><span class="score-detail-small">(${ida}-${volta})</span>`;
      } else {
        scoreSpan.textContent = String(team.score);
      }
      slot.appendChild(scoreSpan);
    }

    return slot;
  }
  /* ==========================================================
     12c. LIVE MATCH SYSTEM
     ========================================================== */

  /** Active live timer intervals keyed by match id */
  const liveTimers = {};

  /** Current match filter state */
  let currentMatchFilter = 'all';

  /**
   * Check if aggregate score bar should be displayed for a match.
   */
  function shouldShowAggregate(match) {
    return !!state.twoLegged && match.scoreIda1 !== undefined &&
      (match.status === 'live' || match.status === 'paused') && !!match.currentLeg;
  }

  /**
   * Ensure a match has the live system fields (backward compat for old data).
   */
  function ensureLiveFields(match) {
    if (!match) return;
    if (!match.status) {
      match.status = match.winner ? 'finished' : (match.dateTime ? 'scheduled' : 'not_started');
    }
    if (!match.liveEvents) match.liveEvents = [];
    if (typeof match.liveElapsed !== 'number') match.liveElapsed = 0;
  }

  /**
   * Start a match in live mode.
   */
  function startLiveMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match || !match.team1 || !match.team2) return;

    ensureLiveFields(match);

    match.status = 'live';
    match.liveStartedAt = Date.now();
    if (!match.team1.score && match.team1.score !== 0) match.team1.score = 0;
    if (!match.team2.score && match.team2.score !== 0) match.team2.score = 0;

    // Set default leg for two-legged tournaments
    if (state.twoLegged && !match.currentLeg) {
      match.currentLeg = 'ida';
    }

    addLiveEvent(match, 'start', 'Partida iniciada');
    saveState();
    renderBracket();
    showToast('Partida ao vivo!', 'success');
  }

  /**
   * Pause a live match.
   */
  function pauseLiveMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);

    // Accumulate elapsed time
    if (match.liveStartedAt) {
      match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
      match.liveStartedAt = null;
    }
    match.status = 'paused';

    addLiveEvent(match, 'pause', 'Partida pausada');
    saveState();
    renderBracket();
  }

  /**
   * Resume a paused match.
   */
  function resumeLiveMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);
    match.status = 'live';
    match.liveStartedAt = Date.now();

    addLiveEvent(match, 'resume', 'Partida retomada');
    saveState();
    renderBracket();
  }

  /**
   * Cancel live mode — revert to previous status without finalizing.
   */
  function cancelLiveMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);

    // Accumulate elapsed time before canceling
    if (match.liveStartedAt) {
      match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
      match.liveStartedAt = null;
    }

    // Revert to appropriate previous status
    if (match.dateTime) {
      match.status = 'scheduled';
    } else {
      match.status = 'not_started';
    }

    addLiveEvent(match, 'cancel', 'Ao vivo cancelado');
    saveState();
    renderBracket();
    showToast('Ao vivo cancelado. A partida não foi finalizada.', 'info');
  }

  /**
   * Update live score for a team.
   */
  function updateLiveScore(rIdx, mIdx, teamNum, delta) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);

    const team = teamNum === 1 ? match.team1 : match.team2;
    if (!team) return;

    const oldScore = team.score || 0;
    const newScore = Math.max(0, oldScore + delta);
    team.score = newScore;

    // Update ida/volta leg scores for two-legged mode
    if (state.twoLegged && match.currentLeg) {
      if (match.currentLeg === 'ida') {
        if (teamNum === 1) match.scoreIda1 = newScore;
        else match.scoreIda2 = newScore;
      } else if (match.currentLeg === 'volta') {
        if (teamNum === 1) match.scoreVolta1 = newScore;
        else match.scoreVolta2 = newScore;
      }
    }

    if (delta > 0) {
      const teamName = team.teamName || team.playerName;
      addLiveEvent(match, 'goal', `⚽ Gol! ${teamName} (${newScore})`);
    }

    saveState();
    // Update score display without full re-render for responsiveness
    renderBracket();
  }

  /**
   * Add an event to the match log.
   */
  function addLiveEvent(match, type, description) {
    if (!match.liveEvents) match.liveEvents = [];
    const elapsed = getMatchElapsedSeconds(match);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    match.liveEvents.push({
      type: type,
      desc: description,
      time: timeStr,
      timestamp: Date.now()
    });
  }

  /**
   * Get elapsed seconds for a match.
   */
  function getMatchElapsedSeconds(match) {
    let elapsed = match.liveElapsed || 0;
    if (match.liveStartedAt && match.status === 'live') {
      elapsed += Date.now() - match.liveStartedAt;
    }
    return Math.floor(elapsed / 1000);
  }

  /**
   * Format elapsed seconds as MM:SS.
   */
  function formatElapsed(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Finalize the ida (first) leg of a two-legged match.
   * Saves ida scores, resets for volta, and transitions the match.
   */
  function finalizeIdaLeg(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);

    // Accumulate elapsed time
    if (match.liveStartedAt) {
      match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
      match.liveStartedAt = null;
    }

    // Save ida scores
    const s1 = match.team1 ? (match.team1.score || 0) : 0;
    const s2 = match.team2 ? (match.team2.score || 0) : 0;
    match.scoreIda1 = s1;
    match.scoreIda2 = s2;

    addLiveEvent(match, 'leg_end', `Jogo de Ida finalizado (${s1}×${s2})`);

    // Transition to volta leg
    match.currentLeg = 'volta';
    match.status = match.dateTime ? 'scheduled' : 'not_started';
    match.liveElapsed = 0;
    match.liveStartedAt = null;

    // Reset current scores for volta leg
    if (match.team1) match.team1.score = 0;
    if (match.team2) match.team2.score = 0;

    saveState();
    renderBracket();
    showToast('Jogo de Ida finalizado! Prepare o Jogo de Volta.', 'success');
  }

  /**
   * Show finalization confirmation dialog before ending a match.
   */
  function showFinalizeConfirm(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    ensureLiveFields(match);

    let s1 = match.team1 ? (match.team1.score || 0) : 0;
    let s2 = match.team2 ? (match.team2.score || 0) : 0;
    const t1Name = match.team1 ? (match.team1.teamName || match.team1.playerName) : '?';
    const t2Name = match.team2 ? (match.team2.teamName || match.team2.playerName) : '?';

    // Two-legged: use aggregate (ida + volta) instead of just volta scores
    if (state.twoLegged && match.scoreIda1 != null && match.currentLeg === 'volta') {
      s1 = (match.scoreIda1 || 0) + s1;
      s2 = (match.scoreIda2 || 0) + s2;
    }

    // If tied, open score modal for penalties
    if (s1 === s2) {
      showToast('Empate! Use o modal de resultado para definir pênaltis.', 'info');
      // Accumulate time first
      if (match.liveStartedAt) {
        match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
        match.liveStartedAt = null;
      }
      match.status = 'paused';
      saveState();
      openScoreModal(rIdx, mIdx);
      return;
    }

    const winnerName = s1 > s2 ? t1Name : t2Name;

    const overlay = document.createElement('div');
    overlay.className = 'finalize-confirm-overlay';
    overlay.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="finalize-confirm-card">
        <h3>Finalizar Partida?</h3>
        <p>
          <strong>${sanitize(t1Name)} ${s1} × ${s2} ${sanitize(t2Name)}</strong><br>
          O vencedor será <strong>${sanitize(winnerName)}</strong> e avançará no chaveamento.
        </p>
        <div class="finalize-confirm-actions">
          <button type="button" class="btn btn-outline btn-sm btn-cancel-finalize">Cancelar</button>
          <button type="button" class="btn btn-primary btn-sm btn-confirm-finalize">Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.btn-cancel-finalize').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelector('.modal-backdrop').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelector('.btn-confirm-finalize').addEventListener('click', () => {
      overlay.remove();
      finalizeLiveMatch(rIdx, mIdx);
    });
  }

  /**
   * Finalize a live match — set winner and advance.
   */
  function finalizeLiveMatch(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;
    const match = getMatch(rIdx, mIdx);
    if (!match || !match.team1 || !match.team2) return;

    ensureLiveFields(match);

    // Accumulate final time
    if (match.liveStartedAt) {
      match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
      match.liveStartedAt = null;
    }

    let s1 = match.team1.score || 0;
    let s2 = match.team2.score || 0;

    // Two-legged: compute aggregate (ida + volta) for winner determination
    if (state.twoLegged && match.scoreIda1 != null && match.currentLeg === 'volta') {
      // Save volta scores before overwriting with aggregate
      match.scoreVolta1 = s1;
      match.scoreVolta2 = s2;
      s1 = (match.scoreIda1 || 0) + s1;
      s2 = (match.scoreIda2 || 0) + s2;
    }

    if (s1 === s2) {
      showToast('Empate! Defina pênaltis pelo modal de resultado.', 'error');
      return;
    }

    // Store aggregate scores on the team slots
    match.team1.score = s1;
    match.team2.score = s2;

    // Clear old statsApplied flag (recalc will rebuild from scratch)
    if (match.statsApplied) {
      match.statsApplied = null;
    }

    const winnerNum = s1 > s2 ? 1 : 2;
    match.winner = winnerNum;
    match.status = 'finished';
    match.penalties = null;

    addLiveEvent(match, 'end', 'Partida finalizada');

    const totalRounds = bracket.rounds.length;
    const isFinal = rIdx === totalRounds - 1;
    const isSemi = rIdx === totalRounds - 2;

    // Recalculate ALL player stats from scratch
    recalcAllPlayerStats();

    // Advance winner to next round
    const winnerTeam = winnerNum === 1 ? match.team1 : match.team2;

    if (rIdx < totalRounds - 1) {
      const nextRound = bracket.rounds[rIdx + 1];
      const nextMatchIdx = Math.floor(mIdx / 2);
      const nextMatch = nextRound.matches[nextMatchIdx];
      if (nextMatch) {
        const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
        nextMatch[slot] = makeTeamSlotData(winnerTeam);
      }
    }

    if (isFinal) {
      const champData = {
        teamName: winnerTeam.teamName,
        playerName: winnerTeam.playerName
      };
      if (currentViewingBracketId) {
        const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
        if (hist) hist.champion = champData;
      } else {
        state.champion = champData;
      }
      showChampionCelebration();
    } else {
      showToast('Partida finalizada! Vencedor avança.', 'success');
    }

    // Recalculate repescagem from all results
    applyRepescagem();

    saveState();
    renderBracket();
  }

  /**
   * Start a live timer for visual countdown in a match card.
   */
  function startLiveTimerDisplay(matchId, timerEl, match) {
    // Clear existing timer if any
    if (liveTimers[matchId]) {
      clearInterval(liveTimers[matchId]);
    }

    const update = () => {
      if (timerEl && timerEl.isConnected) {
        const secs = getMatchElapsedSeconds(match);
        timerEl.textContent = formatElapsed(secs);
      } else {
        clearInterval(liveTimers[matchId]);
        delete liveTimers[matchId];
      }
    };

    update();
    liveTimers[matchId] = setInterval(update, 1000);
  }

  /**
   * Get match status counts for filter display.
   */
  function getMatchStatusCounts(bracket) {
    const counts = { all: 0, scheduled: 0, live: 0, finished: 0 };
    if (!bracket || !bracket.rounds) return counts;

    bracket.rounds.forEach(round => {
      round.matches.forEach(match => {
        if (!match.team1 && !match.team2) return;
        ensureLiveFields(match);
        counts.all++;
        if (match.status === 'live' || match.status === 'paused') counts.live++;
        else if (match.status === 'finished') counts.finished++;
        else if (match.status === 'scheduled') counts.scheduled++;
      });
    });
    return counts;
  }

  /**
   * Check if a match should be visible based on current filter.
   */
  function matchPassesFilter(match) {
    if (currentMatchFilter === 'all') return true;
    ensureLiveFields(match);
    if (currentMatchFilter === 'live') return match.status === 'live' || match.status === 'paused';
    if (currentMatchFilter === 'finished') return match.status === 'finished';
    if (currentMatchFilter === 'scheduled') return match.status === 'scheduled';
    return true;
  }


  /* ==========================================================
     13. SCORE MODAL
     ========================================================== */

  /** Currently open match info for the modal */
  let modalMatch = { roundIdx: -1, matchIdx: -1 };

  /**
   * Open the score modal for a specific match.
   * @param {number} rIdx
   * @param {number} mIdx
   */
  function openScoreModal(rIdx, mIdx) {
    const bracket = getCurrentBracket();
    if (!bracket) return;

    const match = getMatch(rIdx, mIdx);
    if (!match || !match.team1 || !match.team2) return;

    modalMatch = { roundIdx: rIdx, matchIdx: mIdx };

    const modal = $('#score-modal');
    if (!modal) return;

    const isTwoLegged = !!state.twoLegged;

    // Toggle visibility of rows
    $$('.single-leg-only').forEach(el => el.style.display = isTwoLegged ? 'none' : '');
    $$('.two-leg-only').forEach(el => el.style.display = isTwoLegged ? 'flex' : 'none');

    // Populate team names
    const t1Name = $('#modal-team1-name');
    const t2Name = $('#modal-team2-name');
    if (t1Name) t1Name.textContent = match.team1.playerName;
    if (t2Name) t2Name.textContent = match.team2.playerName;

    // Scores
    if (isTwoLegged) {
      const s1Ida = $('#modal-team1-score-ida');
      const s2Ida = $('#modal-team2-score-ida');
      const s1Volta = $('#modal-team1-score-volta');
      const s2Volta = $('#modal-team2-score-volta');
      if (s1Ida) s1Ida.value = match.scoreIda1 !== undefined ? match.scoreIda1 : 0;
      if (s2Ida) s2Ida.value = match.scoreIda2 !== undefined ? match.scoreIda2 : 0;
      if (s1Volta) s1Volta.value = match.scoreVolta1 !== undefined ? match.scoreVolta1 : 0;
      if (s2Volta) s2Volta.value = match.scoreVolta2 !== undefined ? match.scoreVolta2 : 0;
    } else {
      const s1 = $('#modal-team1-score');
      const s2 = $('#modal-team2-score');
      if (s1) s1.value = match.team1.score !== null ? match.team1.score : 0;
      if (s2) s2.value = match.team2.score !== null ? match.team2.score : 0;
    }

    // Penalty team names
    const pt1 = $('#penalty-team1-name');
    const pt2 = $('#penalty-team2-name');
    if (pt1) pt1.textContent = match.team1.playerName;
    if (pt2) pt2.textContent = match.team2.playerName;

    // Reset penalties section
    const penSection = $('#penalties-section');
    const penCheck = $('#penalties-check');
    const penInputs = $('#penalties-inputs');
    if (penSection) penSection.style.display = '';

    const isTie = isTwoLegged
      ? ((parseInt(($('#modal-team1-score-ida') || {}).value) + parseInt(($('#modal-team1-score-volta') || {}).value)) === (parseInt(($('#modal-team2-score-ida') || {}).value) + parseInt(($('#modal-team2-score-volta') || {}).value)))
      : (match.team1.score === match.team2.score && match.team1.score !== null);

    if (penCheck) penCheck.checked = match.penalties ? true : false;
    if (penInputs) penInputs.style.display = (match.penalties || (penCheck && penCheck.checked)) ? '' : 'none';

    const ps1 = $('#penalty-team1-score');
    const ps2 = $('#penalty-team2-score');
    if (ps1) ps1.value = match.penalties ? match.penalties.team1 : 0;
    if (ps2) ps2.value = match.penalties ? match.penalties.team2 : 0;

    // Date/time fields
    const dateInput = $('#modal-match-date');
    const timeInput = $('#modal-match-time');
    if (match.dateTime) {
      const parts = match.dateTime.split('T');
      if (dateInput) dateInput.value = (parts[0] === 'HOJE') ? '' : (parts[0] || '');
      if (timeInput) timeInput.value = parts[1] || '';
    } else {
      if (dateInput) dateInput.value = '';
      if (timeInput) timeInput.value = '';
    }

    // Modal title
    const title = $('#modal-title');
    if (title) title.textContent = 'Registrar Resultado';

    modal.style.display = 'flex';
  }

  /** Close the score modal */
  function closeScoreModal() {
    const modal = $('#score-modal');
    if (modal) modal.style.display = 'none';
    modalMatch = { roundIdx: -1, matchIdx: -1 };
  }

  /** Handle penalty checkbox toggle */
  function handlePenaltyToggle() {
    const penCheck = $('#penalties-check');
    const penInputs = $('#penalties-inputs');
    if (!penCheck || !penInputs) return;
    penInputs.style.display = penCheck.checked ? '' : 'none';
  }

  /** Auto-show penalties when scores are equal */
  function handleScoreChange() {
    const isTwoLegged = !!state.twoLegged;
    let s1, s2;

    if (isTwoLegged) {
      s1 = (parseInt($('#modal-team1-score-ida').value, 10) || 0) + (parseInt($('#modal-team1-score-volta').value, 10) || 0);
      s2 = (parseInt($('#modal-team2-score-ida').value, 10) || 0) + (parseInt($('#modal-team2-score-volta').value, 10) || 0);
    } else {
      s1 = parseInt(($('#modal-team1-score') || {}).value, 10);
      s2 = parseInt(($('#modal-team2-score') || {}).value, 10);
    }

    if (!isNaN(s1) && !isNaN(s2) && s1 === s2) {
      const penSection = $('#penalties-section');
      const penCheck = $('#penalties-check');
      const penInputs = $('#penalties-inputs');
      if (penSection) penSection.style.display = '';
      if (penCheck) penCheck.checked = true;
      if (penInputs) penInputs.style.display = '';
    }
  }

  /** Confirm score and determine winner */
  function handleConfirmScore() {
    const rIdx = modalMatch.roundIdx;
    const mIdx = modalMatch.matchIdx;
    if (rIdx < -2 || mIdx < 0) return;

    const bracket = getCurrentBracket();
    if (!bracket) return;

    let match = getMatch(rIdx, mIdx);
    
    if (!match) return;

    const isTwoLegged = !!state.twoLegged;
    let score1, score2;
    let sIda1, sIda2, sVolta1, sVolta2;

    if (isTwoLegged) {
      sIda1 = parseInt($('#modal-team1-score-ida').value, 10) || 0;
      sIda2 = parseInt($('#modal-team2-score-ida').value, 10) || 0;
      sVolta1 = parseInt($('#modal-team1-score-volta').value, 10) || 0;
      sVolta2 = parseInt($('#modal-team2-score-volta').value, 10) || 0;

      score1 = sIda1 + sVolta1;
      score2 = sIda2 + sVolta2;

      // Validation for 2 legs (only if used)
      if (isNaN(score1) || isNaN(score2)) {
        showToast('Insira placares válidos.', 'error');
        return;
      }
    } else {
      score1 = parseInt(($('#modal-team1-score') || {}).value, 10);
      score2 = parseInt(($('#modal-team2-score') || {}).value, 10);

      if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
        showToast('Insira placares válidos (números >= 0).', 'error');
        return;
      }
    }

    let winnerNum = null;
    let penalties = null;

    if (score1 !== score2) {
      // Clear winner from regular score
      winnerNum = score1 > score2 ? 1 : 2;
    } else {
      // Draw: must have penalties
      const penCheck = $('#penalties-check');
      if (!penCheck || !penCheck.checked) {
        showToast('Empate! Marque os pênaltis para decidir o vencedor.', 'error');
        return;
      }

      const pen1 = parseInt(($('#penalty-team1-score') || {}).value, 10);
      const pen2 = parseInt(($('#penalty-team2-score') || {}).value, 10);

      if (isNaN(pen1) || isNaN(pen2) || pen1 < 0 || pen2 < 0) {
        showToast('Insira placares de pênaltis válidos.', 'error');
        return;
      }

      if (pen1 === pen2) {
        showToast('Pênaltis não podem terminar empatados.', 'error');
        return;
      }

      penalties = { team1: pen1, team2: pen2 };
      winnerNum = pen1 > pen2 ? 1 : 2;
    }

    // Save date/time
    const matchDateVal = ($('#modal-match-date') || {}).value || '';
    const matchTimeVal = ($('#modal-match-time') || {}).value || '';
    if (matchDateVal || matchTimeVal) {
      match.dateTime = (matchDateVal || 'HOJE') + (matchTimeVal ? 'T' + matchTimeVal : '');
    } else {
      match.dateTime = null;
    }

    // --- Clear old statsApplied (recalc rebuilds from scratch) ---
    if (match.statsApplied) {
      match.statsApplied = null;
    }

    // --- UPDATE MATCH ---
    match.team1.score = score1;
    match.team2.score = score2;
    match.winner = winnerNum;
    match.penalties = penalties;
    match.status = 'finished';
    // Clear live timer state
    if (match.liveStartedAt) {
      match.liveElapsed = (match.liveElapsed || 0) + (Date.now() - match.liveStartedAt);
      match.liveStartedAt = null;
    }

    if (isTwoLegged) {
      match.scoreIda1 = sIda1;
      match.scoreIda2 = sIda2;
      match.scoreVolta1 = sVolta1;
      match.scoreVolta2 = sVolta2;
    } else {
      // Clear 2-leg fields if switching back
      delete match.scoreIda1;
      delete match.scoreIda2;
      delete match.scoreVolta1;
      delete match.scoreVolta2;
    }

    const totalRounds = bracket.rounds.length;

    // --- RECALCULATE ALL STATS FROM SCRATCH ---
    const isFinal = rIdx === totalRounds - 1;
    const isSemi = rIdx === totalRounds - 2;
    recalcAllPlayerStats();

    // Advance winner to next round
    const winnerTeam = winnerNum === 1 ? match.team1 : match.team2;
    const loserTeam = winnerNum === 1 ? match.team2 : match.team1;

    if (rIdx >= 0 && rIdx < totalRounds - 1) {
      // Determine slot in next round
      const nextRound = bracket.rounds[rIdx + 1];
      const nextMatchIdx = Math.floor(mIdx / 2);
      const nextMatch = nextRound.matches[nextMatchIdx];

      if (nextMatch) {
        const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
        nextMatch[slot] = makeTeamSlotData(winnerTeam);
      }
    }

    if (isSemi && bracket.thirdPlaceMatch) {
      const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
      bracket.thirdPlaceMatch[slot] = makeTeamSlotData(loserTeam);
    }

    if (isFinal) {
      const champData = {
        teamName: winnerTeam.teamName,
        playerName: winnerTeam.playerName
      };

      if (currentViewingBracketId) {
        const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
        if (hist) hist.champion = champData;
      } else {
        state.champion = champData;
      }

      showChampionCelebration();
    } else {
      showToast('Resultado registrado!', 'success');
    }

    // Recalculate repescagem from all results
    applyRepescagem();

    // Call saveState and renderBracket AFTER the champion state is set to properly persist it
    saveState();
    closeScoreModal();
    renderBracket();
  }

  /** Reset a match to unplayed state — requires password */
  function handleResetMatch() {
    const rIdx = modalMatch.roundIdx;
    const mIdx = modalMatch.matchIdx;
    const bracket = getCurrentBracket();
    if (!bracket) return;

    const match = getMatch(rIdx, mIdx);
    if (!match) return;

    // Only ask password/confirm if match has a result
    if (match.winner) {
      const pwd = prompt('Digite a senha para resetar esta partida:');
      if (pwd === null) return; // cancelled
      if (pwd !== RESET_PASSWORD) {
        showToast('Senha incorreta. Reset cancelado.', 'error');
        return;
      }
    } else {
      if (!confirm('Deseja resetar esta partida?')) return;
    }

    // Revert stats if they were applied
    if (match.statsApplied) {
      revertMatchStats(match);
    }

    // Reset scores and winner
    if (match.team1) match.team1.score = null;
    if (match.team2) match.team2.score = null;
    match.winner = null;
    match.penalties = null;

    // Reset live fields
    match.status = match.dateTime ? 'scheduled' : 'not_started';
    match.liveEvents = [];
    match.liveStartedAt = null;
    match.liveElapsed = 0;

    // Reset Ida/Volta if they exist
    delete match.scoreIda1;
    delete match.scoreIda2;
    delete match.scoreVolta1;
    delete match.scoreVolta2;

    const totalRounds = bracket.rounds.length;

    // If it's the final, clear champion
    if (rIdx === totalRounds - 1) {
      if (currentViewingBracketId) {
        const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
        if (hist) hist.champion = null;
      } else {
        state.champion = null;
      }
    }

    // Cascade: clear the winner's advancement in subsequent rounds
    cascadeClearAdvancement(bracket, rIdx, mIdx);

    // Recalculate ALL player stats from scratch to avoid stale data
    recalcAllPlayerStats();

    // Recalculate repescagem from scratch (losers from reset match are gone)
    applyRepescagem();

    saveState();
    closeScoreModal();
    renderBracket();
    showToast('Partida resetada. Repescagem recalculada.', 'info');
  }

  /**
   * Cascade clear: remove the winner from subsequent rounds.
   * If that winner had already won further matches, reset those too.
   */
  function cascadeClearAdvancement(bracket, rIdx, mIdx) {
    const totalRounds = bracket.rounds.length;
    if (rIdx < 0 || rIdx >= totalRounds - 1) return;

    const nextMatchIdx = Math.floor(mIdx / 2);
    const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
    const nextMatch = bracket.rounds[rIdx + 1].matches[nextMatchIdx];
    
    // Clear third place match slot if it's a semifinal
    if (rIdx === totalRounds - 2 && bracket.thirdPlaceMatch) {
      bracket.thirdPlaceMatch[slot] = null;
      if (bracket.thirdPlaceMatch.winner) {
         if (bracket.thirdPlaceMatch.statsApplied) revertMatchStats(bracket.thirdPlaceMatch);
         if (bracket.thirdPlaceMatch.team1) bracket.thirdPlaceMatch.team1.score = null;
         if (bracket.thirdPlaceMatch.team2) bracket.thirdPlaceMatch.team2.score = null;
         bracket.thirdPlaceMatch.winner = null;
         bracket.thirdPlaceMatch.penalties = null;
         bracket.thirdPlaceMatch.status = bracket.thirdPlaceMatch.dateTime ? 'scheduled' : 'not_started';
         bracket.thirdPlaceMatch.liveEvents = [];
         bracket.thirdPlaceMatch.liveStartedAt = null;
         bracket.thirdPlaceMatch.liveElapsed = 0;
      }
    }

    if (!nextMatch) return;

    const advancedTeam = nextMatch[slot];
    nextMatch[slot] = null;

    // If the next match had already been played with this team as winner, reset it too
    if (nextMatch.winner && advancedTeam) {
      const winnerTeam = nextMatch.winner === 1 ? nextMatch.team1 : nextMatch.team2;
      if (winnerTeam && winnerTeam.id === advancedTeam.id) {
        // Revert stats
        if (nextMatch.statsApplied) revertMatchStats(nextMatch);
        if (nextMatch.team1) nextMatch.team1.score = null;
        if (nextMatch.team2) nextMatch.team2.score = null;
        nextMatch.winner = null;
        nextMatch.penalties = null;
        nextMatch.status = nextMatch.dateTime ? 'scheduled' : 'not_started';
        nextMatch.liveEvents = [];
        nextMatch.liveStartedAt = null;
        nextMatch.liveElapsed = 0;
        // Recurse deeper
        cascadeClearAdvancement(bracket, rIdx + 1, nextMatchIdx);
      }
    }
  }

  /** Initialize missing stats for a team ID */
  function ensureStats(teamId) {
    if (!state.playerStats) state.playerStats = {};
    if (!state.playerStats[teamId]) {
      state.playerStats[teamId] = { trophies: 0, finals: 0, semifinals: 0, goals: 0, goalsTaken: 0, goalDiff: 0 };
    } else {
      if (typeof state.playerStats[teamId].goals === 'undefined') state.playerStats[teamId].goals = 0;
      if (typeof state.playerStats[teamId].goalsTaken === 'undefined') state.playerStats[teamId].goalsTaken = 0;
      if (typeof state.playerStats[teamId].goalDiff === 'undefined') state.playerStats[teamId].goalDiff = 0;
    }
  }

  /** Helper to get global team ID from match slot */
  function getTeamIdGlobal(matchTeam) {
    if (!matchTeam) return null;
    if (matchTeam.id) return matchTeam.id; // Retro compatibility for newly generated brackets
    const t = state.teams.find(x => x.playerName === matchTeam.playerName && x.teamName === matchTeam.teamName);
    if (t) return t.id;
    if (state.participants) {
      const p = state.participants.find(x => x.name === matchTeam.playerName && x.nick === matchTeam.teamName);
      if (p) return p.id;
    }
    return null; // Impossível rastrear se era antigo e não tinha ID
  }

  /** Revert applied match stats */
  function revertMatchStats(match) {
    const s = match.statsApplied;
    if (!s) return;

    const t1Id = getTeamIdGlobal(match.team1);
    const t2Id = getTeamIdGlobal(match.team2);

    if (t1Id) {
      ensureStats(t1Id);
      state.playerStats[t1Id].goals -= s.t1Score;
      state.playerStats[t1Id].goalsTaken -= s.t2Score;
      state.playerStats[t1Id].goalDiff = state.playerStats[t1Id].goals - state.playerStats[t1Id].goalsTaken;
      if (s.isSemi) state.playerStats[t1Id].semifinals = Math.max(0, state.playerStats[t1Id].semifinals - 1);
      if (s.isFinal) state.playerStats[t1Id].finals = Math.max(0, state.playerStats[t1Id].finals - 1);
      if (s.isFinal && s.winner === 1) state.playerStats[t1Id].trophies = Math.max(0, state.playerStats[t1Id].trophies - 1);
    }

    if (t2Id) {
      ensureStats(t2Id);
      state.playerStats[t2Id].goals -= s.t2Score;
      state.playerStats[t2Id].goalsTaken -= s.t1Score;
      state.playerStats[t2Id].goalDiff = state.playerStats[t2Id].goals - state.playerStats[t2Id].goalsTaken;
      if (s.isSemi) state.playerStats[t2Id].semifinals = Math.max(0, state.playerStats[t2Id].semifinals - 1);
      if (s.isFinal) state.playerStats[t2Id].finals = Math.max(0, state.playerStats[t2Id].finals - 1);
      if (s.isFinal && s.winner === 2) state.playerStats[t2Id].trophies = Math.max(0, state.playerStats[t2Id].trophies - 1);
    }

    match.statsApplied = null;
  }

  /** Apply match stats */
  function applyMatchStats(match, isSemi, isFinal) {
    const t1Id = getTeamIdGlobal(match.team1);
    const t2Id = getTeamIdGlobal(match.team2);

    match.statsApplied = {
      t1Score: match.team1.score,
      t2Score: match.team2.score,
      isSemi: isSemi,
      isFinal: isFinal,
      winner: match.winner
    };

    if (t1Id) {
      ensureStats(t1Id);
      state.playerStats[t1Id].goals += match.team1.score;
      state.playerStats[t1Id].goalsTaken += match.team2.score;
      state.playerStats[t1Id].goalDiff = state.playerStats[t1Id].goals - state.playerStats[t1Id].goalsTaken;
      if (isSemi) state.playerStats[t1Id].semifinals += 1;
      if (isFinal) state.playerStats[t1Id].finals += 1;
      if (isFinal && match.winner === 1) state.playerStats[t1Id].trophies += 1;
    }

    if (t2Id) {
      ensureStats(t2Id);
      state.playerStats[t2Id].goals += match.team2.score;
      state.playerStats[t2Id].goalsTaken += match.team1.score;
      state.playerStats[t2Id].goalDiff = state.playerStats[t2Id].goals - state.playerStats[t2Id].goalsTaken;
      if (isSemi) state.playerStats[t2Id].semifinals += 1;
      if (isFinal) state.playerStats[t2Id].finals += 1;
      if (isFinal && match.winner === 2) state.playerStats[t2Id].trophies += 1;
    }
  }

  /** Recalculate ALL player stats from scratch by iterating every match */
  function recalcAllPlayerStats() {
    // Reset all stats to zero
    state.playerStats = {};
    const allKnownTeams = [...(state.teams || []), ...(state.participants || [])];
    allKnownTeams.forEach(function (t) {
      if (!t.id) return;
      state.playerStats[t.id] = {
        trophies: 0, finals: 0, thirdPlace: 0, semifinals: 0,
        goals: 0, goalsTaken: 0, goalDiff: 0,
        played: 0, wins: 0, draws: 0, losses: 0, pts: 0
      };
    });

    function processMatch(match, isSemi, isFinal, isThirdPlace) {
      if (!match.winner) return;
      if (isByeTeam(match.team1) || isByeTeam(match.team2)) return;

      const t1Id = getTeamIdGlobal(match.team1);
      const t2Id = getTeamIdGlobal(match.team2);
      if (!t1Id && !t2Id) return;

      const s1 = match.team1 ? (match.team1.score ?? 0) : 0;
      const s2 = match.team2 ? (match.team2.score ?? 0) : 0;

      if (t1Id) {
        ensureStats(t1Id);
        const ps = state.playerStats[t1Id];
        ps.goals += s1;
        ps.goalsTaken += s2;
        if (isSemi) ps.semifinals++;
        if (isFinal) ps.finals++;
        if (isFinal && match.winner === 1) ps.trophies++;
        if (isThirdPlace && match.winner === 1) ps.thirdPlace++;
      }
      if (t2Id) {
        ensureStats(t2Id);
        const ps = state.playerStats[t2Id];
        ps.goals += s2;
        ps.goalsTaken += s1;
        if (isSemi) ps.semifinals++;
        if (isFinal) ps.finals++;
        if (isFinal && match.winner === 2) ps.trophies++;
        if (isThirdPlace && match.winner === 2) ps.thirdPlace++;
      }

      // Aggregated overall stats (PTS, J, V, E, D)
      if (match.twoLegged && match.ida && match.volta) {
        [match.ida, match.volta].forEach(leg => {
          if (leg.score1 == null || leg.score2 == null) return;
          if (t1Id) {
            const ps = state.playerStats[t1Id];
            ps.played++;
            if (leg.score1 > leg.score2) { ps.wins++; ps.pts += 3; }
            else if (leg.score1 < leg.score2) { ps.losses++; }
            else { ps.draws++; ps.pts += 1; }
          }
          if (t2Id) {
            const ps = state.playerStats[t2Id];
            ps.played++;
            if (leg.score2 > leg.score1) { ps.wins++; ps.pts += 3; }
            else if (leg.score2 < leg.score1) { ps.losses++; }
            else { ps.draws++; ps.pts += 1; }
          }
        });
      } else {
        // Single leg or aggregate winner
        if (t1Id) {
          const ps = state.playerStats[t1Id];
          ps.played++;
          if (match.winner === 1 && (!match.penalties || s1 > s2)) { ps.wins++; ps.pts += 3; }
          else if (match.winner === 2 && (!match.penalties || s2 > s1)) { ps.losses++; }
          else { ps.draws++; ps.pts += 1; }
        }
        if (t2Id) {
          const ps = state.playerStats[t2Id];
          ps.played++;
          if (match.winner === 2 && (!match.penalties || s2 > s1)) { ps.wins++; ps.pts += 3; }
          else if (match.winner === 1 && (!match.penalties || s1 > s2)) { ps.losses++; }
          else { ps.draws++; ps.pts += 1; }
        }
      }

      // Update goalDiff
      if (t1Id) state.playerStats[t1Id].goalDiff = state.playerStats[t1Id].goals - state.playerStats[t1Id].goalsTaken;
      if (t2Id) state.playerStats[t2Id].goalDiff = state.playerStats[t2Id].goals - state.playerStats[t2Id].goalsTaken;
    }

    // Process Current Bracket
    const bracket = getCurrentBracket();
    if (bracket && bracket.rounds) {
      const totalRounds = bracket.rounds.length;
      bracket.rounds.forEach((round, rIdx) => {
        const isFinal = rIdx === totalRounds - 1;
        const isSemi = rIdx === totalRounds - 2;
        round.matches.forEach(m => processMatch(m, isSemi, isFinal, false));
      });
      if (bracket.thirdPlaceMatch) processMatch(bracket.thirdPlaceMatch, false, false, true);
    }

    // Process Current Groups
    if (state.groups) {
      state.groups.forEach(group => {
        group.matches.forEach(m => processMatch(m, false, false, false));
      });
    }

    // Process History
    if (state.tournamentsHistory) {
      state.tournamentsHistory.forEach(hist => {
        if (hist.bracket && hist.bracket.rounds) {
          const hTotalR = hist.bracket.rounds.length;
          hist.bracket.rounds.forEach((round, rIdx) => {
            const hIsFinal = rIdx === hTotalR - 1;
            const hIsSemi = rIdx === hTotalR - 2;
            round.matches.forEach(m => processMatch(m, hIsSemi, hIsFinal, false));
          });
          if (hist.bracket.thirdPlaceMatch) processMatch(hist.bracket.thirdPlaceMatch, false, false, true);
        }
        if (hist.groups) {
          hist.groups.forEach(group => {
            group.matches.forEach(m => processMatch(m, false, false, false));
          });
        }
      });
    }
  }

  /** Troca dois times de posição no chaveamento (Drag and Drop) */
  function swapTeamsInBracket(source, target) {
    if (!state.bracket || !state.bracket.rounds) return;

    let sourceMatch = null;
    let targetMatch = null;
    let sRIdx = -1, tRIdx = -1;

    state.bracket.rounds.forEach((r, rIdx) => {
      r.matches.forEach(m => {
        if (m.id === source.matchId) {
          sourceMatch = m;
          sRIdx = rIdx;
        }
        if (m.id === target.matchId) {
          targetMatch = m;
          tRIdx = rIdx;
        }
      });
    });

    if (!sourceMatch || !targetMatch) return;

    // Block swap if either match has a result
    if (sourceMatch.winner || targetMatch.winner) {
      showToast('Não é possível mover times de partidas com resultado. Resete a partida primeiro.', 'error');
      return;
    }

    // --- CASO 1: TROCA DENTRO DA MESMA PARTIDA (INVERTER LADOS) ---
    if (sourceMatch === targetMatch) {
      if (source.teamNum === target.teamNum) return; // Mesmo slot

      // Inverter times
      const tempTeam = sourceMatch.team1;
      sourceMatch.team1 = sourceMatch.team2;
      sourceMatch.team2 = tempTeam;

      // Inverter placares se existirem para manter a lógica do resultado no slot correto
      if (sourceMatch.winner) {
        if (sourceMatch.winner === 1) sourceMatch.winner = 2;
        else if (sourceMatch.winner === 2) sourceMatch.winner = 1;

        if (sourceMatch.penalties) {
          const p1 = sourceMatch.penalties.team1;
          sourceMatch.penalties.team1 = sourceMatch.penalties.team2;
          sourceMatch.penalties.team2 = p1;
        }

        // Ida / Volta
        const ida1 = sourceMatch.scoreIda1;
        sourceMatch.scoreIda1 = sourceMatch.scoreIda2;
        sourceMatch.scoreIda2 = ida1;

        const v1 = sourceMatch.scoreVolta1;
        sourceMatch.scoreVolta1 = sourceMatch.scoreVolta2;
        sourceMatch.scoreVolta2 = v1;
      }

      saveState();
      renderBracket();
      showToast('Posições invertidas.', 'info');
      return;
    }

    // --- CASO 2: MOVER PARA OUTRA PARTIDA (RESETAR RESULTADO) ---
    // Reverter estatísticas antes de resetar os placares para null
    if (sourceMatch.statsApplied) revertMatchStats(sourceMatch);
    if (targetMatch.statsApplied) revertMatchStats(targetMatch);

    const teamA = source.teamNum === 1 ? sourceMatch.team1 : sourceMatch.team2;
    const teamB = target.teamNum === 1 ? targetMatch.team1 : targetMatch.team2;

    // Efetuar a troca dos objetos de time
    if (source.teamNum === 1) sourceMatch.team1 = teamB;
    else sourceMatch.team2 = teamB;

    if (target.teamNum === 1) targetMatch.team1 = teamA;
    else targetMatch.team2 = teamA;

    // Resetar resultados já que os oponentes mudaram
    const resetMatch = (m, rIdx, mIdx) => {
      m.winner = null;
      m.penalties = null;
      if (m.team1) m.team1.score = null;
      if (m.team2) m.team2.score = null;
      delete m.scoreIda1; delete m.scoreIda2;
      delete m.scoreVolta1; delete m.scoreVolta2;

      // Limpar progresso na próxima fase
      const totalRounds = state.bracket.rounds.length;
      if (rIdx < totalRounds - 1) {
        const nextMatchIdx = Math.floor(mIdx / 2);
        const slot = mIdx % 2 === 0 ? 'team1' : 'team2';
        const nextMatch = state.bracket.rounds[rIdx + 1].matches[nextMatchIdx];
        if (nextMatch) nextMatch[slot] = null;
      }
    };

    // Encontrar os índices reais para o reset progressivo
    const sMIdx = state.bracket.rounds[sRIdx].matches.indexOf(sourceMatch);
    const tMIdx = state.bracket.rounds[tRIdx].matches.indexOf(targetMatch);

    resetMatch(sourceMatch, sRIdx, sMIdx);
    resetMatch(targetMatch, tRIdx, tMIdx);

    saveState();
    renderBracket();
    showToast('Jogadores movidos. Resultados resetados.', 'info');
  }

  /* ==========================================================
     14. CHAMPION CELEBRATION
     ========================================================== */

  let confettiAnimationId = null;

  /** Trigger the champion celebration */
  function showChampionCelebration() {
    if (!state.champion) return;

    const banner = $('#champion-banner');
    const nameEl = $('#champion-team-name');
    if (banner) {
      banner.style.display = 'flex';
    }
    if (nameEl) {
      nameEl.textContent = state.champion.playerName;
    }

    startConfetti();
    showToast(`Campeão: ${state.champion.playerName}!`, 'success');
  }

  /** Show champion banner if champion exists (on page load) */
  function renderChampionBannerIfNeeded() {
    /* Don't auto-show banner on reload; user can see it in bracket */
  }

  /** Close champion banner */
  function closeChampionBanner() {
    const banner = $('#champion-banner');
    if (banner) banner.style.display = 'none';
    stopConfetti();
  }

  /* ==========================================================
     15. CONFETTI ANIMATION
     ========================================================== */

  /** Start confetti particle animation */
  function startConfetti() {
    const canvas = $('#confetti-canvas');
    if (!canvas) return;

    canvas.style.display = 'block';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext('2d');
    const colors = ['#FFD700', '#34c759', '#007aff', '#ff3b30', '#ffffff', '#ff9500', '#af8a2e'];
    const particles = [];
    const PARTICLE_COUNT = 200;
    const DURATION = 5000;
    const startTime = Date.now();

    // Create particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 8 + 4,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 4 + 2,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
        shape: Math.random() > 0.5 ? 'rect' : 'circle'
      });
    }

    function animate() {
      const elapsed = Date.now() - startTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fade out in the last second
      const opacity = elapsed > DURATION - 1000
        ? Math.max(0, 1 - (elapsed - (DURATION - 1000)) / 1000)
        : 1;

      ctx.globalAlpha = opacity;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        // Wrap horizontally
        if (p.x > canvas.width + 20) p.x = -20;
        if (p.x < -20) p.x = canvas.width + 20;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      ctx.globalAlpha = 1;

      if (elapsed < DURATION) {
        confettiAnimationId = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        confettiAnimationId = null;
      }
    }

    confettiAnimationId = requestAnimationFrame(animate);
  }

  /** Stop confetti animation */
  function stopConfetti() {
    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }
    const canvas = $('#confetti-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }

  /* ==========================================================
     16. TOURNAMENT RESET
     ========================================================== */

  /** Reset tournament (bracket + champion only, keep teams) */
  function handleReset() {
    const pwd = prompt('Para DESCARTAR/CANCELAR este torneio atual, digite a senha:');
    if (pwd !== '451021') {
      if (pwd !== null) showToast('Senha incorreta. Procedimento de exclusão cancelado.', 'error');
      return;
    }

    if (!confirm('Tem certeza que deseja DELETAR o torneio? O chaveamento e resultados ativos vão sumir!')) {
      return;
    }

    state.bracket = null;
    state.champion = null;
    state.groupRepechage = null;
    state.groupDirectQualified = null;
    state.bracketFromGroups = false;

    // Reset all group match results if groups exist
    if (state.groups) {
      state.groups.forEach(group => {
        group.matches.forEach(m => {
          m.team1.score = null;
          m.team2.score = null;
          m.winner = null;
          m.status = 'not_started';
          if (m.twoLegged) {
            m.ida = { score1: null, score2: null };
            m.volta = { score1: null, score2: null };
          }
        });
        group.standings = calcGroupStandings(group);
      });
    }

    saveState();

    closeChampionBanner();
    renderBracket();
    renderGroupsTab();
    renderTeamList();
    showToast('Torneio resetado com sucesso.', 'info');
  }

  /* ==========================================================
     16b. MOBILE SIDEBAR
     ========================================================== */

  /** Toggle mobile sidebar */
  function toggleMobileSidebar() {
    const sidebar = $('#admin-sidebar');
    const overlay = $('#sidebar-overlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('sidebar-open');
    if (isOpen) {
      sidebar.classList.remove('sidebar-open');
      if (overlay) overlay.classList.remove('active');
      document.body.classList.remove('sidebar-is-open');
    } else {
      sidebar.classList.add('sidebar-open');
      if (overlay) overlay.classList.add('active');
      document.body.classList.add('sidebar-is-open');
    }
  }

  /** Close mobile sidebar */
  function closeMobileSidebar() {
    const sidebar = $('#admin-sidebar');
    const overlay = $('#sidebar-overlay');
    if (sidebar) sidebar.classList.remove('sidebar-open');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('sidebar-is-open');
  }

  /* ==========================================================
     16c. CLIENT / PLAYER STATS MANAGEMENT
     ========================================================== */

  /** Populate the client select dropdown with team players */
  function populateClientSelect() {
    const select = $('#client-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Selecione --</option>';

    state.teams.forEach((team) => {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = team.playerName + ' (' + team.teamName + ')';
      select.appendChild(option);
    });

    // Populate flag select for clients as well
    const flagSel = $('#client-flag');
    if (flagSel) {
      flagSel.innerHTML = '<option value="">-- Escolher Aleatória --</option>';
      const currentFlagVal = flagSel.value;
      const takenFlags = state.teams.map(t => t.flagId).filter(f => f);

      WORLD_FLAGS.forEach(flag => {
        const isCurrentSelection = (state.teams.find(t => t.id === currentVal) || {}).flagId === flag.id;
        // Permite mostrar a bandeira se ela estiver disponível ou se for a que o jogador já está usando
        if (!takenFlags.includes(flag.id) || isCurrentSelection) {
          const opt = document.createElement('option');
          opt.value = flag.id;
          opt.textContent = flag.name;
          flagSel.appendChild(opt);
        }
      });
    }

    // Restore previous selection if still valid
    if (currentVal && state.teams.some(t => t.id === currentVal)) {
      select.value = currentVal;
    }
  }

  /** Handle client select change */
  function handleClientSelect() {
    const select = $('#client-select');
    const fields = $('#client-fields');
    if (!select || !fields) return;

    const teamId = select.value;
    if (!teamId) {
      fields.style.display = 'none';
      return;
    }

    fields.style.display = '';

    // Repopulate flag options ensuring the current one is visible even if "taken"
    const flagSel = $('#client-flag');
    if (flagSel) {
      flagSel.innerHTML = '<option value="">-- Escolher Aleatória --</option>';
      const team = state.teams.find(t => t.id === teamId);
      const takenFlags = state.teams.map(t => t.flagId).filter(f => f);

      WORLD_FLAGS.forEach(flag => {
        const isCurrentSelection = team && team.flagId === flag.id;
        if (!takenFlags.includes(flag.id) || isCurrentSelection) {
          const opt = document.createElement('option');
          opt.value = flag.id;
          opt.textContent = flag.name;
          flagSel.appendChild(opt);
        }
      });
      if (team && team.flagId) {
        flagSel.value = team.flagId;
      }
      updateFlagPreview('client-flag', 'client-flag-preview');
    }

    // Load existing stats
    const stats = (state.playerStats && state.playerStats[teamId]) || {};
    const igInput = $('#client-instagram');
    const trInput = $('#client-trophies');
    const fiInput = $('#client-finals');
    const sfInput = $('#client-semifinals');
    const glInput = $('#client-goals');
    const gtInput = $('#client-goals-taken');
    const gdInput = $('#client-goal-diff');
    if (igInput) igInput.value = stats.instagram || '';
    if (trInput) trInput.value = stats.trophies || 0;
    if (fiInput) fiInput.value = stats.finals || 0;
    if (sfInput) sfInput.value = stats.semifinals || 0;
    if (glInput) glInput.value = stats.goals || 0;
    if (gtInput) gtInput.value = stats.goalsTaken || 0;
    if (gdInput) gdInput.value = stats.goalDiff || 0;
  }

  /** Save client stats */
  function handleSaveClient() {
    const select = $('#client-select');
    if (!select || !select.value) {
      showToast('Selecione um jogador primeiro.', 'error');
      return;
    }

    const teamId = select.value;
    if (!state.playerStats) state.playerStats = {};

    state.playerStats[teamId] = {
      instagram: ($('#client-instagram') || {}).value || '',
      trophies: parseInt(($('#client-trophies') || {}).value, 10) || 0,
      finals: parseInt(($('#client-finals') || {}).value, 10) || 0,
      semifinals: parseInt(($('#client-semifinals') || {}).value, 10) || 0,
      goals: parseInt(($('#client-goals') || {}).value, 10) || 0,
      goalsTaken: parseInt(($('#client-goals-taken') || {}).value, 10) || 0,
      goalDiff: parseInt(($('#client-goal-diff') || {}).value, 10) || 0
    };

    // Save Flag and update Photo if it was a flag-based photo
    const flagSel = $('#client-flag');
    if (flagSel) {
      const team = state.teams.find(t => t.id === teamId);
      const participant = (state.participants || []).find(p => p.id === teamId);
      const newFlagId = flagSel.value;

      if (team) {
        // Se a foto atual era a da bandeira antiga ou não tinha foto, atualiza para a nova bandeira
        const oldFlagUrl = team.flagId ? `https://flagcdn.com/${team.flagId}.svg` : null;
        const isUsingFlagAsPhoto = !team.photo || (oldFlagUrl && team.photo === oldFlagUrl) || (team.photo && team.photo.includes('flagcdn.com'));

        team.flagId = newFlagId;
        if (isUsingFlagAsPhoto && newFlagId) {
          team.photo = `https://flagcdn.com/${newFlagId}.svg`;
        }
      }

      if (participant) {
        const oldFlagUrl = participant.flagId ? `https://flagcdn.com/${participant.flagId}.svg` : null;
        const isUsingFlagAsPhoto = !participant.photo || (oldFlagUrl && participant.photo === oldFlagUrl) || (participant.photo && participant.photo.includes('flagcdn.com'));

        participant.flagId = newFlagId;
        if (isUsingFlagAsPhoto && newFlagId) {
          participant.photo = `https://flagcdn.com/${newFlagId}.svg`;
        }
      }
    }

    saveState();
    if ($('#ranking-tab').style.display !== 'none') {
      renderRankingTable();
    }
    renderTop3();
    renderTeamList();
    renderBracket();
    showToast('Dados do jogador salvos!', 'success');
  }

  /** Removes participant data completely from the system */
  function removeParticipantData(participantId) {
    if (!participantId) return;

    if (state.participants) {
      state.participants = state.participants.filter(p => p.id !== participantId);
    }
    if (state.teams) {
      state.teams = state.teams.filter(t => t.id !== participantId);
    }
    if (state.playerStats && state.playerStats[participantId]) {
      delete state.playerStats[participantId];
    }
    if (state.codes) {
      const codeEntry = state.codes.find(c => c.participantId === participantId);
      if (codeEntry) {
        codeEntry.status = 'available';
        codeEntry.participantId = null;
      }
    }
    if (state.bracket && state.bracket.rounds) {
      state.bracket.rounds.forEach(round => {
        round.matches.forEach(match => {
          if (match.team1 && match.team1.id === participantId) {
            match.team1 = null;
            match.score1 = null;
            if (match.penalties) delete match.penalties.score1;
          }
          if (match.team2 && match.team2.id === participantId) {
            match.team2 = null;
            match.score2 = null;
            if (match.penalties) delete match.penalties.score2;
          }
          if (match.winner && match.winner.id === participantId) {
            match.winner = null;
          }
        });
      });
    }

    saveState();

    // UI Updates
    renderTeamList();
    renderBracket();
    if (isAdmin) renderCodesList();

    const rankEl = $('#ranking-tab');
    if (rankEl && rankEl.style.display !== 'none') renderRankingTable();
    renderTop3();

    populateClientSelect();
    const fields = $('#client-fields');
    if (fields) fields.style.display = 'none';
  }

  function handleDeleteClient() {
    const select = $('#client-select');
    if (!select || !select.value) {
      showToast('Selecione um jogador primeiro.', 'error');
      return;
    }
    if (!confirm('ATENÇÃO: Deseja realmente APAGAR ESTE JOGADOR?\\nEle será removido da lista, do chaveamento e perderá o acesso do código associado.\\nAção irreversível!')) {
      return;
    }
    removeParticipantData(select.value);
    showToast('Jogador apagado com sucesso!', 'success');
  }

  /* ==========================================================
     16d. PLAYER PROFILE MODAL
     ========================================================== */

  /** Open player profile modal */
  function openPlayerProfile(teamId) {
    let team = state.teams.find(t => t.id === teamId);

    // Se o time não for do torneio atual, procura direto nos cadastros de usuários globais
    if (!team && state.participants) {
      const p = state.participants.find(p => p.id === teamId);
      if (p) team = { id: p.id, playerName: p.name, teamName: p.nick, photo: p.photo };
    }

    if (!team) return;

    const stats = (state.playerStats && state.playerStats[teamId]) || {};

    // Compute live group stage stats for this player
    let groupGoals = 0, groupGoalsTaken = 0, groupMatches = 0, groupWins = 0, groupDraws = 0, groupLosses = 0;
    if (state.groups) {
      state.groups.forEach(group => {
        group.matches.forEach(m => {
          if (m.team1.score == null || m.team2.score == null) return;
          if (m.team1.id === teamId) {
            groupMatches++;
            groupGoals += m.team1.score;
            groupGoalsTaken += m.team2.score;
            if (m.team1.score > m.team2.score) groupWins++;
            else if (m.team1.score < m.team2.score) groupLosses++;
            else groupDraws++;
          } else if (m.team2.id === teamId) {
            groupMatches++;
            groupGoals += m.team2.score;
            groupGoalsTaken += m.team1.score;
            if (m.team2.score > m.team1.score) groupWins++;
            else if (m.team2.score < m.team1.score) groupLosses++;
            else groupDraws++;
          }
        });
      });
    }

    const modal = $('#player-profile-modal');
    if (!modal) return;

    // Avatar
    const avatarEl = $('#profile-avatar');
    if (avatarEl) {
      if (team.photo) {
        avatarEl.innerHTML = '<img src="' + sanitize(team.photo) + '" alt="' + sanitize(team.playerName) + '">';
      } else {
        avatarEl.textContent = initials(team.playerName);
      }
    }

    // Names
    const playerNameEl = $('#profile-player-name');
    const teamNameEl = $('#profile-team-name');
    if (playerNameEl) playerNameEl.textContent = team.playerName;
    if (teamNameEl) teamNameEl.textContent = team.teamName;

    // Instagram
    const igLink = $('#profile-instagram');
    const igText = $('#profile-instagram-text');
    if (igLink && igText) {
      if (stats.instagram) {
        const handle = stats.instagram.replace(/^@/, '');
        igLink.href = 'https://instagram.com/' + encodeURIComponent(handle);
        igText.textContent = '@' + handle;
        igLink.style.display = '';
      } else {
        igLink.style.display = 'none';
      }
    }

    // Stats — use cumulative stats from state.playerStats
    const totalGoals = stats.goals || 0;
    const totalGoalsTaken = stats.goalsTaken || 0;
    const totalGoalDiff = stats.goalDiff || 0;

    const trEl = $('#profile-trophies');
    const fiEl = $('#profile-finals');
    const sfEl = $('#profile-semifinals');
    const glEl = $('#profile-goals');
    const gTakenEl = $('#profile-goals-taken');
    const gDiffEl = $('#profile-goal-diff');

    if (trEl) trEl.textContent = stats.trophies || 0;
    if (fiEl) fiEl.textContent = stats.finals || 0;
    if (sfEl) sfEl.textContent = stats.semifinals || 0;
    if (glEl) glEl.textContent = totalGoals;
    if (gTakenEl) gTakenEl.textContent = totalGoalsTaken;
    if (gDiffEl) gDiffEl.textContent = totalGoalDiff;

    // Group stage section
    let groupSection = modal.querySelector('.profile-group-stats');
    if (groupMatches > 0) {
      if (!groupSection) {
        groupSection = document.createElement('div');
        groupSection.className = 'profile-group-stats';
        const statsGrid = modal.querySelector('.profile-stats');
        if (statsGrid) statsGrid.parentNode.insertBefore(groupSection, statsGrid.nextSibling);
      }
      groupSection.innerHTML = `
        <h4 class="profile-section-title">Fase de Grupos</h4>
        <div class="profile-group-grid">
          <div class="pg-stat"><span class="pg-value">${groupMatches}</span><span class="pg-label">Jogos</span></div>
          <div class="pg-stat"><span class="pg-value">${groupWins}</span><span class="pg-label">Vitórias</span></div>
          <div class="pg-stat"><span class="pg-value">${groupDraws}</span><span class="pg-label">Empates</span></div>
          <div class="pg-stat"><span class="pg-value">${groupLosses}</span><span class="pg-label">Derrotas</span></div>
          <div class="pg-stat"><span class="pg-value">${groupGoals}</span><span class="pg-label">Gols</span></div>
          <div class="pg-stat"><span class="pg-value">${groupGoalsTaken}</span><span class="pg-label">Sofridos</span></div>
        </div>`;
      groupSection.style.display = '';
    } else if (groupSection) {
      groupSection.style.display = 'none';
    }

    modal.style.display = 'flex';
  }

  /** Close player profile modal */
  function closePlayerProfile() {
    const modal = $('#player-profile-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ==========================================================
     16e. TOP 3 RENDERING
     ========================================================== */

  /** Render the Top 3 players card */
  function renderTop3() {
    const card = $('#top3-card');
    const list = $('#top3-list');
    if (!card || !list) return;

    if (!state.playerStats || !state.teams || state.teams.length === 0) {
      card.style.display = 'none';
      return;
    }

    // Build ranked list by trophies, then finals, then semifinals
    const ranked = state.teams
      .map(t => {
        const stats = state.playerStats[t.id] || {};
        return {
          team: t,
          trophies: stats.trophies || 0,
          finals: stats.finals || 0,
          thirdPlace: stats.thirdPlace || 0,
          semifinals: stats.semifinals || 0
        };
      })
      .filter(r => r.trophies > 0 || r.finals > 0 || r.semifinals > 0)
      .sort((a, b) => {
        if (b.trophies !== a.trophies) return b.trophies - a.trophies;
        if (b.finals !== a.finals) return b.finals - a.finals;
        if (b.thirdPlace !== a.thirdPlace) return b.thirdPlace - a.thirdPlace;
        return b.semifinals - a.semifinals;
      })
      .slice(0, 3);

    if (ranked.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    const posColors = ['gold', 'silver', 'bronze'];
    const posLabels = ['1º', '2º', '3º'];

    let html = '';
    ranked.forEach((r, i) => {
      const rPhoto = getTeamPhoto(r.team);
      const avatar = rPhoto
        ? '<img src="' + sanitize(rPhoto) + '" alt="' + sanitize(r.team.playerName) + '">'
        : '<span class="av-placeholder top3-av-placeholder">' + sanitize(initials(r.team.playerName)) + '</span>';

      const championClass = i === 0 ? 'champion-glow-border' : '';

      html += `
        <li class="top3-item ${championClass}" data-team-id="${sanitize(r.team.id)}">
          <span class="top3-position ${posColors[i]}">${posLabels[i]}</span>
          <div class="top3-avatar">${avatar}</div>
          <span class="top3-name">${sanitize(r.team.playerName)}</span>
          <span class="top3-trophies">${r.trophies} troféu${r.trophies !== 1 ? 's' : ''}</span>
        </li>`;
    });

    list.innerHTML = html;

    // Click handlers for top 3 items
    list.querySelectorAll('.top3-item').forEach(item => {
      item.addEventListener('click', () => {
        openPlayerProfile(item.dataset.teamId);
      });
    });
  }

  /* ==========================================================
     16fb. TOURNAMENT HISTORY RENDERING & MANAGEMENT
     ========================================================== */

  function handleFinishTournament() {
    if (!state.bracket || !state.bracket.rounds || state.bracket.rounds.length === 0) return;

    const pwd = prompt('Para ENCERRAR E SALVAR o torneio no histórico, digite a senha:');
    if (pwd !== '451021') {
      if (pwd !== null) showToast('Senha incorreta. Não foi possível encerrar.', 'error');
      return;
    }

    if (!state.champion) {
      if (!confirm('Este torneio ainda NÃO tem um Campeão definido. Tem certeza que deseja encerrar de forma incompleta e salvar no histórico?')) return;
    } else {
      if (!confirm('Deseja oficializar o fim deste torneio e movê-lo para o seu Histórico? A seção de chaveamentos ficará livre para o próximo torneio.')) return;
    }

    if (!state.tournamentsHistory) state.tournamentsHistory = [];

    // Save snapshot
    const editionNumber = state.tournamentsHistory.length + 1;
    const defaultName = 'Torneio Edição ' + editionNumber;
    let tName = state.tournamentName && state.tournamentName.trim() !== '' ? state.tournamentName : defaultName;

    const record = {
      id: generateId(),
      name: tName,
      date: new Date().toISOString(),
      format: state.tournamentFormat || 'elimination',
      champion: state.champion ? JSON.parse(JSON.stringify(state.champion, (k, v) => v === undefined ? null : v)) : null,
      bracket: JSON.parse(JSON.stringify(state.bracket, (k, v) => v === undefined ? null : v)),
      groups: state.groups ? JSON.parse(JSON.stringify(state.groups, (k, v) => v === undefined ? null : v)) : null,
      teams: JSON.parse(JSON.stringify(state.teams, (k, v) => v === undefined ? null : v)),
      teamsCount: state.teamCount || (state.teams ? state.teams.length : 8)
    };

    state.tournamentsHistory.unshift(record);

    state.bracket = null;
    state.champion = null;
    state.teams = [];
    state.groups = null;
    state.groupRepechage = null;
    state.tournamentFormat = 'elimination';
    state.tournamentName = '';
    state.bracketFromGroups = false;

    // Reseta os códigos de participação apenas quando o torneio for ENCERRADO
    state.codes = [];

    state.tournamentName = ''; // reset name
    const tnInput = $('#tournament-name');
    if (tnInput) tnInput.value = '';

    saveState();

    // UI Resets
    renderBracket();
    renderTeamList();
    renderTop3();
    if (isAdmin) renderCodesList();
    const titleDisp = $('#tournament-title-display');
    if (titleDisp) titleDisp.style.display = 'none';
    const prizeDisp = $('#prize-display');
    if (prizeDisp) prizeDisp.style.display = 'none';

    showToast('Torneio salvo com sucesso no Histórico!', 'success');

    // Switch to history tab
    const historyBtn = document.querySelector('.tab-btn[data-tab="history-tab"]');
    if (historyBtn) historyBtn.click();
  }

  function renderHistory() {
    const container = $('#history-container');
    if (!container) return;

    if (!state.tournamentsHistory || state.tournamentsHistory.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon"><svg class="svg-icon svg-icon-empty" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/></svg></span><p class="empty-title">Nenhum torneio finalizado</p><p class="empty-subtitle">Encerre um torneio na aba Chaveamento para organizá-lo aqui.</p></div>';
      return;
    }

    let html = '';
    state.tournamentsHistory.forEach(record => {
      const dateStr = new Date(record.date).toLocaleDateString();
      let champHtml = '<span class="history-date">Sem campeão declarado</span>';

      if (record.champion) {
        const cNome = record.champion.playerName || record.champion.teamName;
        champHtml = '<div class="history-champ">' +
          '<svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>' +
          '<span class="history-champ-winner">' + sanitize(cNome) + '</span>' +
          '</div>';
      }

      html += '<div class="history-card" data-history-id="' + record.id + '" style="cursor:pointer;" title="Clique para Visualizar e Editar a Chave">' +
        '<div class="history-info">' +
        '<div class="history-title">' + sanitize(record.name) + ' (' + record.teamsCount + ' Times)</div>' +
        '<div class="history-date">Concluído em: ' + dateStr + '</div>' +
        champHtml +
        '</div>' +
        '<div class="history-actions" onclick="event.stopPropagation()">' + // prevent row click from triggering when deleting
        (isAdmin ? '<button type="button" class="btn btn-outline btn-sm btn-delete-history" data-history-id="' + record.id + '" style="color:var(--accent-red);border-color:var(--accent-red);"><svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> Deletar</button>' : '') +
        '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    // View/Edit historical bracket
    const historyCards = container.querySelectorAll('.history-card');
    historyCards.forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-history-id');
        currentViewingBracketId = id;

        // Switch to bracket tab
        const bracketBtn = document.querySelector('.tab-btn[data-tab="bracket-tab"]');
        if (bracketBtn) bracketBtn.click();
      });
    });

    // Delete history logic
    const deleteBtns = container.querySelectorAll('.btn-delete-history');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-history-id');
        deleteHistory(id);
      });
    });
  }

  function deleteHistory(id) {
    if (!isAdmin) return;
    if (!confirm('Você está prestes a DELETAR um torneio antigo. Todos os títulos, gols e finais que os jogadores ganharam nele serão descontados dos seus Rankings Globais! Tem certeza?')) return;

    const histIdx = state.tournamentsHistory.findIndex(h => h.id === id);
    if (histIdx === -1) return;
    const hist = state.tournamentsHistory[histIdx];

    // Revert all match stats to maintain accurate global ranking
    if (hist.bracket && hist.bracket.rounds) {
      hist.bracket.rounds.forEach(round => {
        round.matches.forEach(match => {
          revertMatchStats(match);
        });
      });
    }

    state.tournamentsHistory.splice(histIdx, 1);

    // Update active view if they were viewing this one
    if (currentViewingBracketId === id) {
      currentViewingBracketId = null;
      renderBracket();
    }

    saveState();
    renderHistory();
    showToast('Torneio e suas estatísticas foram deletados do Histórico.', 'success');
  }

  /* ==========================================================
     16fa. RANKING TABLE RENDERING
     ========================================================== */

  function renderRankingTable() {
    const tbody = $('#ranking-tbody');
    if (!tbody) return;

    // Recalculate stats (includes group goals now)
    recalcAllPlayerStats();

    const ranked = [];

    // Check if groups are active
    const hasGroups = state.tournamentFormat === 'groups' && state.groups && state.groups.length > 0;

    // Build group standings lookup
    const groupLookup = {};
    if (hasGroups) {
      state.groups.forEach(group => {
        group.teams.forEach(t => {
          groupLookup[t.id] = group.name;
        });
      });
    }

    // Participants from invitations
    if (state.participants) {
      state.participants.forEach(p => {
        const stats = state.playerStats[p.id] || {};
        ranked.push({
          id: p.id,
          name: p.name || 'Sem Nome',
          nick: p.nick || 'S/N',
          photo: p.photo,
          trophies: stats.trophies || 0,
          finals: stats.finals || 0,
          semifinals: stats.semifinals || 0,
          goals: stats.goals || 0,
          goalsTaken: stats.goalsTaken || 0,
          goalDiff: stats.goalDiff || 0,
          played: stats.played || 0,
          wins: stats.wins || 0,
          draws: stats.draws || 0,
          losses: stats.losses || 0,
          points: stats.pts || 0,
          groupName: groupLookup[p.id] || '-'
        });
      });
    }

    // Teams created manually
    if (state.teams) {
      state.teams.forEach(t => {
        if (!ranked.some(r => r.id === t.id)) {
          const stats = state.playerStats[t.id] || {};
          ranked.push({
            id: t.id,
            name: t.playerName || 'Sem Nome',
            nick: t.teamName || 'S/N',
            photo: t.photo,
            trophies: stats.trophies || 0,
            finals: stats.finals || 0,
            semifinals: stats.semifinals || 0,
            goals: stats.goals || 0,
            goalsTaken: stats.goalsTaken || 0,
            goalDiff: stats.goalDiff || 0,
            played: stats.played || 0,
            wins: stats.wins || 0,
            draws: stats.draws || 0,
            losses: stats.losses || 0,
            points: stats.pts || 0,
            groupName: groupLookup[t.id] || '-'
          });
        }
      });
    }

    // Update table header dynamically
    const thead = tbody.closest('table').querySelector('thead tr');
    if (thead) {
      if (hasGroups) {
        thead.innerHTML =
          '<th class="col-pos">POS</th>' +
          '<th class="col-player">JOGADOR</th>' +
          '<th class="col-stats rk-group-col" title="Grupo">GRP</th>' +
          '<th class="col-stats rk-group-col" title="Total de Jogos (Geral)">J</th>' +
          '<th class="col-stats rk-group-col" title="Total de Vitórias (Geral)">V</th>' +
          '<th class="col-stats rk-group-col" title="Total de Empates (Geral)">E</th>' +
          '<th class="col-stats rk-group-col" title="Total de Derrotas (Geral)">D</th>' +
          '<th class="col-stats rk-group-col rk-pts-col" title="Total de Pontos (Geral)">PTS</th>' +
          '<th class="col-stats" title="Gols Marcados (Total Geral)">GP</th>' +
          '<th class="col-stats" title="Saldo de Gols (Total Geral)">SG</th>';
      } else {
        thead.innerHTML =
          '<th class="col-pos">POS</th>' +
          '<th class="col-player">JOGADOR</th>' +
          '<th class="col-titulos" title="Títulos">TIT</th>' +
          '<th class="col-stats" title="Finais Alcançadas">FIN</th>' +
          '<th class="col-stats" title="Semifinais">SEM</th>' +
          '<th class="col-stats" title="Gols Marcados">GP</th>' +
          '<th class="col-stats" title="Saldo de Gols">SG</th>';
      }
    }

    const colCount = hasGroups ? 10 : 7;

    if (ranked.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:24px;text-align:center;color:var(--text-tertiary);">Nenhum jogador registrado ainda.</td></tr>';
      return;
    }

    // Sorting: groups mode → Points > GoalDiff > Goals; else → Trophies > Finals > etc.
    if (hasGroups) {
      ranked.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins; // Wins as first tie-breaker
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return String(a.name).localeCompare(String(b.name));
      });
    } else {
      ranked.sort((a, b) => {
        if (b.trophies !== a.trophies) return b.trophies - a.trophies;
        if (b.finals !== a.finals) return b.finals - a.finals;
        if (b.semifinals !== a.semifinals) return b.semifinals - a.semifinals;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return String(a.name).localeCompare(String(b.name));
      });
    }

    let html = '';
    ranked.forEach((r, i) => {
      const posClass = i < 3 ? 'pos-' + (i + 1) : '';
      const avatarHtml = r.photo
        ? '<img src="' + sanitize(r.photo) + '" alt="">'
        : '<span class="av-placeholder" style="font-size:12px;">' + sanitize(initials(r.name)) + '</span>';

      if (hasGroups) {
        const grpName = r.groupName ? sanitize(r.groupName).replace('Grupo ', '') : '–';
        html += '<tr class="' + posClass + '" data-team-id="' + sanitize(r.id) + '" style="cursor:pointer;">' +
          '<td class="col-pos">' + (i + 1) + 'º</td>' +
          '<td class="col-player">' +
          '<div class="ranking-avatar">' + avatarHtml + '</div>' +
          '<div><div class="player-name-val">' + sanitize(r.name) + '</div><div class="player-team-val">' + sanitize(r.nick) + '</div></div>' +
          '</td>' +
          '<td class="col-stats rk-group-col">' + grpName + '</td>' +
          '<td class="col-stats rk-group-col">' + r.played + '</td>' +
          '<td class="col-stats rk-group-col">' + r.wins + '</td>' +
          '<td class="col-stats rk-group-col">' + r.draws + '</td>' +
          '<td class="col-stats rk-group-col">' + r.losses + '</td>' +
          '<td class="col-stats rk-group-col rk-pts-col">' + r.points + '</td>' +
          '<td class="col-stats">' + r.goals + '</td>' +
          '<td class="col-stats">' + r.goalDiff + '</td>' +
          '</tr>';
      } else {
        html += '<tr class="' + posClass + '" data-team-id="' + sanitize(r.id) + '" style="cursor:pointer;">' +
          '<td class="col-pos">' + (i + 1) + 'º</td>' +
          '<td class="col-player">' +
          '<div class="ranking-avatar">' + avatarHtml + '</div>' +
          '<div><div class="player-name-val">' + sanitize(r.name) + '</div><div class="player-team-val">' + sanitize(r.nick) + '</div></div>' +
          '</td>' +
          '<td class="col-titulos">' + r.trophies + '</td>' +
          '<td class="col-stats">' + r.finals + '</td>' +
          '<td class="col-stats">' + r.semifinals + '</td>' +
          '<td class="col-stats">' + r.goals + '</td>' +
          '<td class="col-stats">' + r.goalDiff + '</td>' +
          '</tr>';
      }
    });

    tbody.innerHTML = html;

    // Vincula o evento localmente (pois métodos não estão no window/escopo global)
    const rows = tbody.querySelectorAll('tr[data-team-id]');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-team-id');
        openPlayerProfile(id);
      });
    });
  }

  /* ==========================================================
     16f. PARTICIPANT FLOW â€” CODE VALIDATION & REGISTRATION
     ========================================================== */

  /** Show participant code entry screen */
  function showParticipantCodeScreen() {
    const screens = ['login-screen', 'game-selection-screen', 'participant-form-screen'];
    screens.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const mainApp = $('#main-app');
    if (mainApp) mainApp.style.display = 'none';

    const codeScreen = $('#participant-code-screen');
    if (codeScreen) codeScreen.style.display = '';

    const codeInput = $('#participant-code');
    if (codeInput) { codeInput.value = ''; codeInput.focus(); }
    const errorEl = $('#code-error');
    if (errorEl) errorEl.textContent = '';
  }

  /** Show participant CPF check screen */
  function showParticipantCPFCheckScreen() {
    const screens = ['login-screen', 'game-selection-screen', 'participant-code-screen', 'participant-form-screen'];
    screens.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const mainApp = $('#main-app');
    if (mainApp) mainApp.style.display = 'none';

    const checkScreen = $('#participant-cpf-check-screen');
    if (checkScreen) checkScreen.style.display = '';

    const cpfSec = $('#returning-cpf-section');
    if (cpfSec) cpfSec.style.display = 'none';

    const cpfInput = $('#returning-cpf');
    if (cpfInput) { cpfInput.value = ''; }

    const errorEl = $('#returning-cpf-error');
    if (errorEl) errorEl.textContent = '';
  }

  const WORLD_FLAGS = [
    { id: 'br', name: 'Brasil' }, { id: 'ar', name: 'Argentina' },
    { id: 'fr', name: 'França' }, { id: 'de', name: 'Alemanha' },
    { id: 'es', name: 'Espanha' }, { id: 'it', name: 'Itália' },
    { id: 'gb-eng', name: 'Inglaterra' }, { id: 'pt', name: 'Portugal' },
    { id: 'uy', name: 'Uruguai' }, { id: 'nl', name: 'Holanda' },
    { id: 'be', name: 'Bélgica' }, { id: 'hr', name: 'Croácia' },
    { id: 'co', name: 'Colômbia' }, { id: 'mx', name: 'México' },
    { id: 'us', name: 'Estados Unidos' }, { id: 'jp', name: 'Japão' },
    { id: 'sn', name: 'Senegal' }, { id: 'ma', name: 'Marrocos' },
    { id: 'ch', name: 'Suíça' }, { id: 'dk', name: 'Dinamarca' },
    { id: 'kr', name: 'Coreia do Sul' }, { id: 'au', name: 'Austrália' },
    { id: 'pl', name: 'Polônia' }, { id: 'se', name: 'Suécia' },
    { id: 'cm', name: 'Camarões' }, { id: 'gh', name: 'Gana' },
    { id: 'ng', name: 'Nigéria' }, { id: 'ec', name: 'Equador' },
    { id: 'pe', name: 'Peru' }, { id: 'cl', name: 'Chile' },
    { id: 'ca', name: 'Canadá' }, { id: 'sa', name: 'Arábia Saudita' },
    { id: 'eg', name: 'Egito' }, { id: 'dz', name: 'Argélia' },
    { id: 'tn', name: 'Tunísia' }, { id: 'no', name: 'Noruega' },
    { id: 'fi', name: 'Finlândia' }, { id: 'at', name: 'Áustria' },
    { id: 'gr', name: 'Grécia' }, { id: 'tr', name: 'Turquia' },
    { id: 'ua', name: 'Ucrânia' }, { id: 'cz', name: 'República Tcheca' },
    { id: 'hu', name: 'Hungria' }, { id: 'ro', name: 'Romênia' },
    { id: 'py', name: 'Paraguai' }, { id: 've', name: 'Venezuela' },
    { id: 'bo', name: 'Bolívia' }, { id: 'cr', name: 'Costa Rica' },
    { id: 'pa', name: 'Panamá' }, { id: 'jm', name: 'Jamaica' },
    { id: 'za', name: 'África do Sul' }, { id: 'iv', name: 'Costa do Marfim' },
    { id: 'ir', name: 'Irã' }, { id: 'iq', name: 'Iraque' },
    { id: 'qa', name: 'Catar' }, { id: 'cn', name: 'China' },
    { id: 'nz', name: 'Nova Zelândia' }
  ];

  function updateFlagPreview(selectElId, previewImgId) {
    const select = $(`#${selectElId}`);
    const preview = $(`#${previewImgId}`);
    if (!select || !preview) return;

    const val = select.value;
    if (val) {
      preview.src = `https://flagcdn.com/${val}.svg`;
      preview.style.display = 'block';
    } else {
      preview.src = '';
      preview.style.display = 'none';
    }
  }

  function populateFlagSelect() {
    const flagSel = $('#participant-flag');
    if (!flagSel) return;
    flagSel.innerHTML = '<option value="">-- Escolher Aleatória --</option>';

    const takenFlags = state.teams.map(t => t.flagId).filter(f => f);
    WORLD_FLAGS.forEach(flag => {
      if (!takenFlags.includes(flag.id)) {
        const opt = document.createElement('option');
        opt.value = flag.id;
        opt.textContent = flag.name;
        flagSel.appendChild(opt);
      }
    });
  }

  /** Show participant registration form */
  function showParticipantFormScreen() {
    const screens = ['login-screen', 'game-selection-screen', 'participant-code-screen', 'participant-cpf-check-screen'];
    screens.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const mainApp = $('#main-app');
    if (mainApp) mainApp.style.display = 'none';

    const formScreen = $('#participant-form-screen');
    if (formScreen) formScreen.style.display = '';

    // Clear form
    const form = $('#participant-form');
    if (form) form.reset();
    const errorEl = $('#participant-form-error');
    if (errorEl) errorEl.textContent = '';

    populateFlagSelect();
    updateFlagPreview('participant-flag', 'participant-flag-preview');
  }

  /** Handle PARTICIPANTE button click on login screen */
  function handleParticipantButton() {
    const rememberCheck = $('#remember-choice');
    if (rememberCheck && rememberCheck.checked) {
      try { localStorage.setItem(REMEMBER_KEY, 'participant'); } catch (_) { /* ignore */ }
    } else {
      try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
    }

    // Load state to check for codes
    if (state.codes.length === 0) {
      showToast('Nenhum código disponível no momento. Aguarde o organizador.', 'info');
      return;
    }
    showParticipantCodeScreen();
  }

  /** Handle code form submission */
  function handleCodeValidation(e) {
    e.preventDefault();
    const codeInput = $('#participant-code');
    const errorEl = $('#code-error');
    if (!codeInput || !errorEl) return;

    const code = codeInput.value.trim();
    errorEl.textContent = '';

    if (!/^\d{4}$/.test(code)) {
      errorEl.textContent = 'O código deve ter exatamente 4 dígitos numéricos.';
      return;
    }

    const codeEntry = state.codes.find(c => c.code === code);
    if (!codeEntry) {
      errorEl.textContent = 'Código inválido. Verifique e tente novamente.';
      return;
    }

    if (codeEntry.status === 'used') {
      errorEl.textContent = 'Este código já foi utilizado.';
      return;
    }

    // Valid code â€” store and show CPF check
    currentParticipantCode = code;
    showParticipantCPFCheckScreen();
  }

  /** Handle Returning Participant Search */
  function handleReturningCpfSearch(e) {
    e.preventDefault();
    const input = $('#returning-cpf');
    const errorEl = $('#returning-cpf-error');
    if (!input || !errorEl) return;

    errorEl.textContent = '';
    const cpfRaw = input.value.trim();
    if (!cpfRaw) return;

    const cpf = cpfRaw.replace(/\D/g, '');
    if (!isValidCPF(cpf)) {
      errorEl.textContent = 'CPF inválido.';
      return;
    }

    if (!state.participants) state.participants = [];
    const existing = state.participants.find(p => p.cpf === cpf);
    if (!existing) {
      errorEl.textContent = 'Participante não encontrado com este CPF.';
      return;
    }

    // Verifica se já não tá no torneio
    if (state.teams.some(t => t.id === existing.id)) {
      errorEl.textContent = 'Este jogador já está registrado na etapa atual.';
      return;
    }

    // Verify code still valid
    const codeEntry = state.codes.find(c => c.code === currentParticipantCode);
    if (!codeEntry || codeEntry.status === 'used') {
      errorEl.textContent = 'Código expirado ou já utilizado.';
      return;
    }

    // Link the returning player as a team
    const newTeam = {
      id: existing.id,
      teamName: existing.nick,
      playerName: existing.name,
      photo: existing.photo || null
    };
    state.teams.push(newTeam);

    // Auto-place in bracket
    autoPlaceInBracket(newTeam);

    // Update code to used
    codeEntry.status = 'used';
    codeEntry.participantId = existing.id;

    saveState();
    renderTeamList();
    renderBracket();

    // Hide registration and show main screen in view mode
    const checkScreen = $('#participant-cpf-check-screen');
    if (checkScreen) checkScreen.style.display = 'none';

    isParticipant = true;
    showGameSelection();

    showToast(`Bem-vindo de volta, ${existing.name}!`, 'success');
  }

  /** Handle participant registration form submission */
  function handleParticipantFormSubmit(e) {
    e.preventDefault();
    const errorEl = $('#participant-form-error');
    if (errorEl) errorEl.textContent = '';

    const name = ($('#participant-name') || {}).value ? $('#participant-name').value.trim() : '';
    const cpfRaw = ($('#participant-cpf') || {}).value ? $('#participant-cpf').value.trim() : '';
    const instagram = ($('#participant-instagram') || {}).value ? $('#participant-instagram').value.trim() : '';
    const whatsapp = ($('#participant-whatsapp') || {}).value ? $('#participant-whatsapp').value.trim() : '';
    const nick = ($('#participant-nick') || {}).value ? $('#participant-nick').value.trim() : '';

    if (!name || !cpfRaw || !whatsapp || !nick) {
      if (errorEl) errorEl.textContent = 'Preencha todos os campos obrigatórios.';
      return;
    }

    const cpf = cpfRaw.replace(/\D/g, '');
    if (!isValidCPF(cpf)) {
      if (errorEl) errorEl.textContent = 'CPF inválido. Verifique e tente novamente.';
      return;
    }

    // Check duplicate CPF
    if (!state.participants) state.participants = [];
    const existingCPF = state.participants.find(p => p.cpf === cpf);
    if (existingCPF) {
      if (errorEl) errorEl.textContent = 'Este CPF já está cadastrado no torneio.';
      return;
    }

    // Check duplicate nick in teams
    const existingNick = state.teams.some(t => t.teamName.toLowerCase() === nick.toLowerCase());
    if (existingNick) {
      if (errorEl) errorEl.textContent = 'Este nick já está em uso. Escolha outro.';
      return;
    }

    // Verify the code is still valid
    const codeEntry = state.codes.find(c => c.code === currentParticipantCode);
    if (!codeEntry || codeEntry.status === 'used') {
      if (errorEl) errorEl.textContent = 'Código expirado ou já utilizado. Tente novamente.';
      currentParticipantCode = null;
      return;
    }

    const photoInput = $('#participant-photo');
    const photoFile = photoInput && photoInput.files && photoInput.files[0];

    // Disable submit to prevent double submission
    const submitBtn = $('#participant-form button[type=\"submit\"]');
    if (submitBtn) submitBtn.disabled = true;

    function finishRegistration(photoData) {
      const participantId = generateId();

      // FLAG LOGIC
      let selFlagId = $('#participant-flag') ? $('#participant-flag').value : null;
      let assignedFlagId = selFlagId;

      if (!assignedFlagId) {
        const takenFlags = state.teams.map(t => t.flagId).filter(f => f);
        const availableFlags = WORLD_FLAGS.filter(f => !takenFlags.includes(f.id));
        if (availableFlags.length > 0) {
          assignedFlagId = availableFlags[Math.floor(Math.random() * availableFlags.length)].id;
        }
      }

      const finalPhoto = photoData || (assignedFlagId ? `https://flagcdn.com/${assignedFlagId}.svg` : null);

      // Save participant record
      const participant = {
        id: participantId,
        code: currentParticipantCode,
        name: name,
        cpf: cpf,
        instagram: instagram,
        whatsapp: whatsapp,
        nick: nick,
        photo: finalPhoto,
        flagId: assignedFlagId,
        registeredAt: new Date().toISOString()
      };
      state.participants.push(participant);

      // Mark code as used
      codeEntry.status = 'used';
      codeEntry.participantId = participantId;

      // Auto-add to team list
      const team = {
        id: participantId,
        teamName: nick,
        playerName: name,
        photo: finalPhoto,
        flagId: assignedFlagId
      };
      state.teams.push(team);

      // Auto-save Instagram to playerStats
      if (!state.playerStats) state.playerStats = {};
      state.playerStats[participantId] = {
        instagram: instagram || '',
        trophies: 0,
        finals: 0,
        semifinals: 0
      };

      // Auto-place in bracket if bracket exists
      autoPlaceInBracket(team);

      // Save state
      saveState();
      currentParticipantCode = null;

      if (submitBtn) submitBtn.disabled = false;
      showToast('Cadastro realizado com sucesso! Bem-vindo ao torneio.', 'success');

      // Enter as participant (viewer mode)
      isParticipant = true;
      showGameSelection();
    }

    if (photoFile) {
      resizeImageToBase64(photoFile).then(finishRegistration).catch(() => finishRegistration(null));
    } else {
      finishRegistration(null);
    }
  }

  /* ==========================================================
     16g. CODE GENERATION & MANAGEMENT (ADMIN)
     ========================================================== */

  /** Generate 32 unique 4-digit codes */
  function handleGenerateCodes() {
    if (!state.codes) state.codes = [];

    if (state.codes.length > 0) {
      const usedCodes = state.codes.filter(c => c.status === 'used');
      if (usedCodes.length > 0) {
        showToast('Não é possível regerar. Existem ' + usedCodes.length + ' código(s) já utilizado(s).', 'error');
        return;
      }
      if (!confirm('Já existem códigos gerados. Deseja substituí-los por novos?')) {
        return;
      }
    }

    const codes = new Set();
    while (codes.size < 32) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      codes.add(code);
    }

    state.codes = Array.from(codes).map(code => ({
      code: code,
      status: 'available',
      participantId: null
    }));

    saveState();
    renderCodesList();
    showToast('32 códigos gerados com sucesso!', 'success');
  }

  /** Render the codes list in the admin sidebar */
  function renderCodesList() {
    const list = $('#codes-list');
    const summary = $('#codes-summary');
    if (!list) return;

    if (!state.codes || state.codes.length === 0) {
      list.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:12px 0;">Nenhum código gerado</p>';
      if (summary) summary.innerHTML = '';
      return;
    }

    const available = state.codes.filter(c => c.status === 'available').length;
    const used = state.codes.filter(c => c.status === 'used').length;

    if (summary) {
      summary.innerHTML = '<div class="codes-summary-row">' +
        '<span class="codes-stat available">' + available + ' disponíveis</span>' +
        '<span class="codes-stat used">' + used + ' utilizados</span>' +
        '</div>';
    }

    let html = '';
    state.codes.forEach(function (c) {
      const statusClass = c.status === 'used' ? 'code-used' : 'code-available';
      const statusText = c.status === 'used' ? 'Utilizado' : 'Disponível';
      const participant = c.participantId && state.participants
        ? state.participants.find(function (p) { return p.id === c.participantId; })
        : null;

      html += '<div class="code-item ' + statusClass + '">' +
        '<span class="code-value">' + sanitize(c.code) + '</span>' +
        '<span class="code-status">' + statusText + '</span>' +
        // removed
        (participant ? '<span class="code-participant" title="' + sanitize(participant.name) + '">' + sanitize(participant.nick) + '</span>' : '') +
        '<button type="button" class="btn-refresh-code" data-code="' + sanitize(c.code) + '" title="Atualizar e resetar acesso associado a este código" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:22px;margin-left:auto;padding:0 8px;font-weight:bold;">&#x21bb;</button>' +
        '</div>';
    });

    list.innerHTML = html;

    const refreshBtns = list.querySelectorAll('.btn-refresh-code');
    refreshBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const oldCode = btn.getAttribute('data-code');
        if (confirm('Deseja inutilizar o código ' + oldCode + ' e APAGAR O JOGADOR associado?\\nEle será excluído das chaves e do torneio. Além disso, um novo código numérico será gerado e ficará livre.')) {
          const idx = state.codes.findIndex(function (c) { return c.code === oldCode; });
          if (idx !== -1) {
            const oldParticipantId = state.codes[idx].participantId;
            if (oldParticipantId) removeParticipantData(oldParticipantId);

            let newCode;
            do {
              newCode = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            } while (state.codes.some(function (c) { return c.code === newCode; }));

            state.codes[idx] = { code: newCode, status: 'available', participantId: null };
            saveState();
            renderCodesList();
            showToast('Código revogado! Novo código disponível.', 'success');
          }
        }
      });
    });
  }

  /* ==========================================================
     16h. BRACKET DRAG & DROP AND SHUFFLE
     ========================================================== */

  /** Shuffle the teams and adjust bracket size if needed based on the selected count */
  function shuffleBracket() {
    if (currentViewingBracketId) {
      showToast('Não é possível embaralhar um torneio do histórico.', 'error');
      return;
    }

    // Sync format from selector
    const formatSelect = $('#tournament-format');
    const currentFormat = formatSelect ? formatSelect.value : (state.tournamentFormat || 'knockout');
    state.tournamentFormat = currentFormat;

    // --- GROUP FORMAT ---
    if (currentFormat === 'groups') {
      // In group mode, team count is automatic based on registered players
      const requiredCount = state.teams.length;
      if (requiredCount < 2) {
        showToast('Quantidade inválida. Mínimo de 2 participantes.', 'error');
        return;
      }
      state.teamCount = requiredCount;
      const countInput = $('#team-count');
      if (countInput) countInput.value = requiredCount;
      syncTournamentName();

      const gcInput = $('#group-count');
      const numGroups = parseInt(gcInput ? gcInput.value : state.groupCount, 10) || 5;
      state.groupCount = numGroups;

      if (state.teams.length < numGroups * 2) {
        showToast(`Precisa de pelo menos ${numGroups * 2} times para ${numGroups} grupos.`, 'error');
        return;
      }

      // If groups already exist, ask confirmation to reshuffle
      if (state.groups && state.groups.length > 0) {
        if (!confirm('Isso irá redistribuir os jogadores nos grupos e resetar todos os resultados. Deseja continuar?')) {
          return;
        }
      }

      state.groups = buildGroupStage(state.teams, numGroups);
      state.groupRepechage = null;
      state.groupDirectQualified = null;
      state.bracket = null;
      state.bracketFromGroups = false;
      state.champion = null;
      saveState();

      // Update UI and switch to groups tab
      toggleGroupsConfig();
      const groupsTabBtn = $('#groups-tab-btn');
      if (groupsTabBtn) {
        groupsTabBtn.style.display = '';
        groupsTabBtn.click();
      }
      renderGroupsTab();
      showToast(state.groups ? 'Grupos embaralhados!' : 'Fase de grupos gerada!', 'success');
      return;
    }

    // --- KNOCKOUT FORMAT ---
    if (state.bracket && state.bracket.rounds && state.bracket.rounds.length > 0) {
      if (!confirm('Este processo irá resetar partidas em andamento e recriar o chaveamento. Deseja continuar?')) {
        return;
      }

      // Revert all match stats to prevent leaking trophies or goals
      state.bracket.rounds.forEach(round => {
        round.matches.forEach(m => {
          if (m.statsApplied && typeof revertMatchStats === 'function') {
            revertMatchStats(m);
          }
        });
      });
    }

    // Sync team count from input
    const countInput = $('#team-count');
    const requiredCount = parseInt(countInput ? countInput.value : state.teamCount, 10);

    if (isNaN(requiredCount) || requiredCount < 2) {
      showToast('Quantidade inválida. Mínimo de 2 participantes.', 'error');
      return;
    }

    state.teamCount = requiredCount;

    // Sync tournament name
    if (typeof syncTournamentName === 'function') syncTournamentName();

    const roundNames = getRoundNames(requiredCount);
    if (roundNames.length === 0) {
      showToast('Quantidade de times inválida.', 'error');
      return;
    }

    // Shuffle all currently registered teams
    let shuffled = [];
    if (state.teams && state.teams.length > 0) {
      shuffled = shuffleArray([...state.teams]);
    }

    // Clear any group data when using knockout
    state.groups = null;
    state.groupRepechage = null;
    state.groupDirectQualified = null;

    state.bracket = buildBracketStructure(shuffled, requiredCount);
    state.champion = null;

    saveState();
    toggleGroupsConfig();
    renderBracket();
    updateTeamCountInfo();
    showToast('Chaveamento embaralhado!', 'success');
  }

  /**
   * Refresh/update the groups or bracket display without changing
   * how players are organized. Recalculates standings and re-renders.
   */
  function refreshBracket() {
    if (currentViewingBracketId) {
      showToast('Não é possível atualizar um torneio do histórico.', 'error');
      return;
    }

    const currentFormat = state.tournamentFormat || 'knockout';

    if (currentFormat === 'groups' && state.groups && state.groups.length > 0) {
      // Find players registered in state.teams but not in any group
      const allGroupTeamIds = new Set();
      state.groups.forEach(g => g.teams.forEach(t => allGroupTeamIds.add(t.id)));

      const newPlayers = state.teams.filter(t => !allGroupTeamIds.has(t.id));

      if (newPlayers.length > 0) {
        // Assign each new player to a random group
        const useTwoLegged = !!state.twoLegged;
        newPlayers.forEach(player => {
          // Pick a random group
          const randomGroupIdx = Math.floor(Math.random() * state.groups.length);
          const group = state.groups[randomGroupIdx];

          // Generate new round-robin matches between the new player and existing group members
          group.teams.forEach(existingTeam => {
            const m = {
              id: generateId(),
              team1: { id: existingTeam.id, teamName: existingTeam.teamName, playerName: existingTeam.playerName, score: null },
              team2: { id: player.id, teamName: player.teamName, playerName: player.playerName, score: null },
              winner: null,
              status: 'not_started',
              penalties: null,
              dateTime: null,
              twoLegged: useTwoLegged
            };
            if (useTwoLegged) {
              m.ida = { score1: null, score2: null };
              m.volta = { score1: null, score2: null };
            }
            group.matches.push(m);
          });

          // Add player to the group's team list
          group.teams.push({ ...player });
        });

        showToast(`${newPlayers.length} jogador(es) adicionado(s) aos grupos!`, 'success');
      }

      // Recalculate all group standings and re-render
      recalcAllGroupStandings();
      saveState();
      renderGroupsTab();
      if (newPlayers.length === 0) {
        showToast('Grupos atualizados com sucesso!', 'success');
      }
      return;
    }

    if (state.bracket && state.bracket.rounds && state.bracket.rounds.length > 0) {
      // Re-render bracket without changing anything
      saveState();
      renderBracket();
      updateTeamCountInfo();
      showToast('Chaveamento atualizado com sucesso!', 'success');
      return;
    }

    showToast('Nenhum chaveamento ou grupo para atualizar.', 'error');
  }

  /**
   * Randomly assign the last unassigned player into a random group.
   * Creates round-robin matches against all existing members of that group.
   */
  function randomizeLastPlayerIntoGroup() {
    if (!state.groups || state.groups.length === 0) {
      showToast('Nenhuma fase de grupos ativa.', 'error');
      return;
    }

    // Find players not in any group
    const allGroupTeamIds = new Set();
    state.groups.forEach(g => g.teams.forEach(t => allGroupTeamIds.add(t.id)));
    const pendingPlayers = state.teams.filter(t => !allGroupTeamIds.has(t.id));

    if (pendingPlayers.length === 0) {
      showToast('Todos os jogadores já estão em um grupo.', 'info');
      return;
    }

    // Take the last pending player
    const player = pendingPlayers[pendingPlayers.length - 1];

    // Pick a random group
    const randomGroupIdx = Math.floor(Math.random() * state.groups.length);
    const group = state.groups[randomGroupIdx];
    const useTwoLegged = !!state.twoLegged;

    // Generate round-robin matches against existing group members
    group.teams.forEach(existingTeam => {
      const m = {
        id: generateId(),
        team1: { id: existingTeam.id, teamName: existingTeam.teamName, playerName: existingTeam.playerName, score: null },
        team2: { id: player.id, teamName: player.teamName, playerName: player.playerName, score: null },
        winner: null,
        status: 'not_started',
        penalties: null,
        dateTime: null,
        twoLegged: useTwoLegged
      };
      if (useTwoLegged) {
        m.ida = { score1: null, score2: null };
        m.volta = { score1: null, score2: null };
      }
      group.matches.push(m);
    });

    // Add player to the group
    group.teams.push({ ...player });

    // Recalculate and re-render
    recalcAllGroupStandings();
    saveState();
    renderGroupsTab();

    const playerName = player.teamName || player.playerName;
    showToast(`"${playerName}" foi sorteado para o ${group.name}!`, 'success');
  }

  /** Swap two teams in the bracket */
  function swapTeamsInBracket(draggedInfo, dropInfo) {
    if (currentViewingBracketId) {
      showToast('Não é possível editar chaveamento do histórico.', 'error');
      return;
    }

    if (!state.bracket || !state.bracket.rounds || state.bracket.rounds.length === 0) return;

    const round0 = state.bracket.rounds[0];
    let sourceMatch = round0.matches.find(m => m.id === draggedInfo.matchId);
    let targetMatch = round0.matches.find(m => m.id === dropInfo.matchId);

    if (!sourceMatch || !targetMatch) {
      showToast('Apenas times da primeira rodada podem ser trocados.', 'warning');
      return;
    }

    // Block swap if either match has a result
    if (sourceMatch.winner || targetMatch.winner) {
      showToast('Não é possível mover times de partidas com resultado. Resete a partida primeiro.', 'error');
      return;
    }

    let sourceKey = 'team' + draggedInfo.teamNum;
    let targetKey = 'team' + dropInfo.teamNum;

    let temp = sourceMatch[sourceKey];
    sourceMatch[sourceKey] = targetMatch[targetKey];
    targetMatch[targetKey] = temp;

    [sourceMatch, targetMatch].forEach(m => {
      if (m.statsApplied) revertMatchStats(m);
      m.score1 = 0;
      m.score2 = 0;
      m.winner = null;
      m.penalties = null;
      m.dateTime = null;
      if (m.team1) m.team1.score = null;
      if (m.team2) m.team2.score = null;
    });

    for (let i = 1; i < state.bracket.rounds.length; i++) {
      state.bracket.rounds[i].matches.forEach(m => {
        if (m.statsApplied) revertMatchStats(m);
        m.team1 = null;
        m.team2 = null;
        m.score1 = 0;
        m.score2 = 0;
        m.winner = null;
        m.penalties = null;
        m.dateTime = null;
      });
    }
    state.champion = null;
    saveState();
    renderBracket();
  }

  /* ==========================================================
     17. BACKUP SYSTEM
     ========================================================== */

  /** Export state to a JSON file (full raw state) */
  function handleExportBackup() {
    console.log('Iniciando exportação de backup...');
    try {
      const cleanState = JSON.parse(JSON.stringify(state, (k, v) => v === undefined ? null : v));
      const dataStr = JSON.stringify(cleanState, null, 2);

      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];

      a.href = url;
      a.download = `backup_copa_psyzon_${date}.json`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      showToast('Backup exportado com sucesso!', 'success');
      console.log('Backup exportado com sucesso.');
    } catch (err) {
      console.error('Erro ao exportar backup:', err);
      showToast('Erro ao exportar backup. Veja o console.', 'error');
    }
  }

  /** Trigger file input for import */
  function handleImportClick() {
    const input = $('#input-import-backup');
    if (input) input.click();
  }

  /** Read and apply imported JSON backup */
  function handleImportBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('ATENÇÃO: Importar um backup irá SOBRESCREVER todos os dados atuais (times, chaveamento, histórico, etc). Deseja continuar?')) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      try {
        const rawJson = event.target.result;
        const importedState = JSON.parse(rawJson);

        // Try importing through persistence layer first
        if (typeof window.Persistence !== 'undefined') {
          const result = window.Persistence.importarBackup(rawJson);
          if (result.success) {
            // Apply recovered data to app state
            const recovered = window.Persistence.getData();
            if (recovered && typeof recovered === 'object') {
              state = Object.assign(defaultState(), recovered);
            } else {
              state = Object.assign(defaultState(), importedState.data || importedState);
            }
            saveState();
            showToast('Backup importado com sucesso! Recarregando...', 'success');
            e.target.value = '';
            setTimeout(() => window.location.reload(), 1500);
            return;
          } else {
            throw new Error(result.error || 'Erro na importação.');
          }
        }

        // Fallback: basic validation and direct import
        if (typeof importedState !== 'object' || !Array.isArray(importedState.teams)) {
          throw new Error('Formato de arquivo inválido.');
        }

        state = Object.assign(defaultState(), importedState);
        saveState();
        showToast('Backup importado com sucesso! Recarregando...', 'success');
        e.target.value = '';
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        console.error('Erro ao importar backup:', err);
        showToast('Erro ao importar backup: ' + err.message, 'error');
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  /* ==========================================================
     18. EVENT LISTENERS
     ========================================================== */

  /** Set up all event listeners */
  function setupEventListeners() {
    // Login form toggle
    const btnShowLogin = $('#btn-show-login');
    if (btnShowLogin) {
      btnShowLogin.addEventListener('click', toggleLoginForm);
    }

    // Login form submit
    const loginForm = $('#login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }

    // Shuffle bracket button
    const btnShuffleBracket = $('#btn-shuffle-bracket');
    if (btnShuffleBracket) {
      btnShuffleBracket.addEventListener('click', shuffleBracket);
    }

    // Refresh bracket button (update without changing player distribution)
    const btnRefreshBracket = $('#btn-refresh-bracket');
    if (btnRefreshBracket) {
      btnRefreshBracket.addEventListener('click', refreshBracket);
    }

    // Visitor button
    const btnVisitor = $('#btn-visitor');
    if (btnVisitor) {
      btnVisitor.addEventListener('click', handleVisitor);
    }

    // Logout button
    const btnLogout = $('#btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }

    // Add team button
    const btnAddTeam = $('#btn-add-team');
    if (btnAddTeam) {
      btnAddTeam.addEventListener('click', handleAddTeam);
    }

    // Enter key in team/player inputs
    const teamInput = $('#team-name-input');
    const playerInput = $('#player-name-input');
    [teamInput, playerInput].forEach((input) => {
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAddTeam();
          }
        });
      }
    });

    // Save prize
    const btnSavePrize = $('#btn-save-prize');
    if (btnSavePrize) {
      btnSavePrize.addEventListener('click', handleSavePrize);
    }

    // Rules modal bindings
    initRulesBindings();

    // Generate bracket
    const btnGenerate = $('#btn-generate');
    if (btnGenerate) {
      btnGenerate.addEventListener('click', handleGenerate);
    }

    // Finish tournament
    const btnFinishTournament = $('#btn-finish-tournament');
    if (btnFinishTournament) {
      btnFinishTournament.addEventListener('click', handleFinishTournament);
    }

    // Reset current tournament
    const btnReset = $('#btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', handleReset);
    }

    // Hard Reset All
    const btnResetAll = $('#btn-reset-all');
    if (btnResetAll) {
      btnResetAll.addEventListener('click', () => {
        const codePrompt = prompt('ALERTA MÃXIMO: Isto apagará todos os cadastros, históricos, times e stats do Database inteiro.\n\nDigite o código de segurança para confirmar:');
        if (codePrompt !== '153090') {
          if (codePrompt) showToast('Código incorreto. Reset cancelado.', 'error');
          return;
        }

        if (confirm('Tem CERTEZA MESMO? Isso apagará a Tabela inteira do Brasileirão e reseta o site pra fábrica.')) {
          state = defaultState();
          saveState();
          showToast('Site formatado com sucesso! Recarregando...', 'success');
          setTimeout(() => window.location.reload(), 1500);
        }
      });
    }

    // Score modal: confirm
    const btnConfirm = $('#btn-confirm-score');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', handleConfirmScore);
    }

    // Group score modal
    const gmBtnConfirm = $('#gm-btn-confirm');
    if (gmBtnConfirm) {
      gmBtnConfirm.addEventListener('click', () => {
        const modal = $('#group-score-modal');
        const gIdx = parseInt(modal.dataset.groupIdx, 10);
        if (gIdx === -1) confirmRepechageScore();
        else confirmGroupScore();
      });
    }
    const gmBtnCancel = $('#gm-btn-cancel');
    if (gmBtnCancel) {
      gmBtnCancel.addEventListener('click', () => {
        const modal = $('#group-score-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    // Score modal: cancel
    const btnCancel = $('#btn-cancel-modal');
    if (btnCancel) {
      btnCancel.addEventListener('click', closeScoreModal);
    }

    // Score modal: reset match
    const btnResetMatch = $('#btn-reset-match');
    if (btnResetMatch) {
      btnResetMatch.addEventListener('click', handleResetMatch);
    }

    // Score modal: backdrop click
    const backdrop = $('.modal-backdrop[data-dismiss="modal"]');
    if (backdrop) {
      backdrop.addEventListener('click', closeScoreModal);
    }

    // Penalties checkbox
    const penCheck = $('#penalties-check');
    if (penCheck) {
      penCheck.addEventListener('change', handlePenaltyToggle);
    }

    // Score inputs: auto-detect draw
    const s1Input = $('#modal-team1-score');
    const s2Input = $('#modal-team2-score');
    [s1Input, s2Input].forEach((input) => {
      if (input) {
        input.addEventListener('input', handleScoreChange);
      }
    });

    // Champion banner close
    const btnCloseChamp = $('#btn-close-champion');
    if (btnCloseChamp) {
      btnCloseChamp.addEventListener('click', closeChampionBanner);
    }

    // Tournament name: save on blur/change
    const tournamentNameInput = $('#tournament-name');
    if (tournamentNameInput) {
      tournamentNameInput.addEventListener('blur', syncTournamentName);
      tournamentNameInput.addEventListener('change', syncTournamentName);
    }

    // Team count input: save on change
    const teamCountInput = $('#team-count');
    if (teamCountInput) {
      teamCountInput.addEventListener('input', () => {
        const val = parseInt(teamCountInput.value, 10);
        if (!isNaN(val) && val >= 2 && val <= 128) {
          state.teamCount = val;
          saveState();
          renderTeamList();
        }
        updateTeamCountInfo();
      });
      // Initialize info display
      updateTeamCountInfo();
    }

    // Mobile menu toggle
    const btnMobileMenu = $('#btn-mobile-menu');
    if (btnMobileMenu) {
      btnMobileMenu.addEventListener('click', toggleMobileSidebar);
    }

    // Sidebar overlay click
    const sidebarOverlay = $('#sidebar-overlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }

    // Random team name generator
    const btnRandomName = $('#btn-random-name');
    if (btnRandomName) {
      btnRandomName.addEventListener('click', () => {
        const nameInput = $('#team-name-input');
        if (nameInput) {
          nameInput.value = generateRandomTeamName();
          nameInput.focus();
        }
      });
    }

    // Handle window resize for confetti canvas
    window.addEventListener('resize', () => {
      const canvas = $('#confetti-canvas');
      if (canvas && canvas.style.display !== 'none') {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    });

    // Game selection buttons
    const btnGameFifa = $('#btn-game-fifa');
    if (btnGameFifa) {
      btnGameFifa.addEventListener('click', handleGameFifa);
    }

    const btnGameBack = $('#btn-game-back');
    if (btnGameBack) {
      btnGameBack.addEventListener('click', handleGameBack);
    }

    // Client management
    const clientSelect = $('#client-select');
    if (clientSelect) {
      clientSelect.addEventListener('change', handleClientSelect);
    }

    const btnSaveClient = $('#btn-save-client');
    if (btnSaveClient) {
      btnSaveClient.addEventListener('click', handleSaveClient);
    }

    const btnDeleteClient = $('#btn-delete-client');
    if (btnDeleteClient) {
      btnDeleteClient.addEventListener('click', handleDeleteClient);
    }

    // Player profile modal close
    const btnCloseProfile = $('#btn-close-profile');
    if (btnCloseProfile) {
      btnCloseProfile.addEventListener('click', closePlayerProfile);
    }

    // Player profile modal backdrop
    const profileBackdrop = $('.modal-backdrop[data-dismiss="profile-modal"]');
    if (profileBackdrop) {
      profileBackdrop.addEventListener('click', closePlayerProfile);
    }

    // ---------- MAIN TABS NAVIGATION ----------
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        // Remover classe ativa de todos botões e abas
        tabBtns.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

        // Adicionar classe ativa
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const target = $('#' + targetId);
        if (target) target.style.display = 'block';

        // Renderizar dinamicamente se for para aba de Histórico/Ranking
        if (targetId === 'ranking-tab') {
          renderRankingTable();
          // Trigger scroll hint na tabela
          const tableWrap = target.querySelector('.table-responsive');
          const hintWrap = target.querySelector('.scroll-hint-wrapper');
          if (tableWrap) {
            tableWrap.classList.remove('scroll-hint-animation');
            void tableWrap.offsetWidth; // force reflow
            tableWrap.classList.add('scroll-hint-animation');
          }
          if (hintWrap) {
            hintWrap.classList.remove('scroll-hint-animation');
            void hintWrap.offsetWidth;
            hintWrap.classList.add('scroll-hint-animation');
          }
        } else if (targetId === 'history-tab') {
          renderHistory();
        } else if (targetId === 'bracket-tab') {
          renderBracket();
          // Move sponsors back to bracket tab
          moveSponsorsToBracketTab();
        } else if (targetId === 'groups-tab') {
          renderGroupsTab();
          // Move sponsors below groups
          moveSponsorsToGroupsTab();
          // Trigger scroll hint no chaveamento
          const bracketWrap = $('#bracket-container');
          const hintWrap = target.querySelector('.scroll-hint-wrapper');
          if (bracketWrap) {
            bracketWrap.classList.remove('scroll-hint-animation');
            void bracketWrap.offsetWidth; // force reflow
            bracketWrap.classList.add('scroll-hint-animation');
          }
          if (hintWrap) {
            hintWrap.classList.remove('scroll-hint-animation');
            void hintWrap.offsetWidth;
            hintWrap.classList.add('scroll-hint-animation');
          }
        }
      });
    });

    // ---------- PARTICIPANT FLOW ----------

    // Participant button on login screen
    const btnParticipant = $('#btn-participant');
    if (btnParticipant) {
      btnParticipant.addEventListener('click', handleParticipantButton);
    }

    // Code form submission
    const codeForm = $('#code-form');
    if (codeForm) {
      codeForm.addEventListener('submit', handleCodeValidation);
    }

    // Back button in Code Screen
    const btnCodeBack = $('#btn-code-back');
    if (btnCodeBack) {
      btnCodeBack.addEventListener('click', () => {
        try { localStorage.removeItem(REMEMBER_KEY); } catch (_) { /* ignore */ }
        currentParticipantCode = null;
        showLoginScreen();
      });
    }

    // Code input: only allow digits
    const codeInput = $('#participant-code');
    if (codeInput) {
      codeInput.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '');
      });
    }


    // Participant registration form
    const participantForm = $('#participant-form');
    if (participantForm) {
      participantForm.addEventListener('submit', handleParticipantFormSubmit);
    }

    // Form screen back button
    const btnFormBack = $('#btn-form-back');
    if (btnFormBack) {
      btnFormBack.addEventListener('click', function () {
        showParticipantCPFCheckScreen();
      });
    }

    // ---------- NOVO: PARTICIPANT CPF FLOW ----------
    const btnReturningPlayer = $('#btn-returning-player');
    if (btnReturningPlayer) {
      btnReturningPlayer.addEventListener('click', () => {
        const cpfSec = $('#returning-cpf-section');
        if (cpfSec) cpfSec.style.display = '';
        const rfInput = $('#returning-cpf');
        if (rfInput) rfInput.focus();
      });
    }

    const btnNewPlayer = $('#btn-new-player');
    if (btnNewPlayer) {
      btnNewPlayer.addEventListener('click', showParticipantFormScreen);
    }

    const btnCpfCheckBack = $('#btn-cpf-check-back');
    if (btnCpfCheckBack) {
      btnCpfCheckBack.addEventListener('click', () => {
        currentParticipantCode = null;
        showParticipantCodeScreen();
      });
    }

    const returningCpfForm = $('#returning-cpf-form');
    if (returningCpfForm) {
      returningCpfForm.addEventListener('submit', handleReturningCpfSearch);
    }

    const returningCpfInput = $('#returning-cpf');
    if (returningCpfInput) {
      returningCpfInput.addEventListener('input', function () {
        const pos = this.selectionStart;
        const oldLen = this.value.length;
        this.value = formatCPF(this.value);
        const newLen = this.value.length;
        this.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
      });
    }

    // CPF formatting (New Participant Form)
    const cpfInput = $('#participant-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', function () {
        const pos = this.selectionStart;
        const oldLen = this.value.length;
        this.value = formatCPF(this.value);
        const newLen = this.value.length;
        this.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
      });
    }

    // WhatsApp formatting
    const whatsappInput = $('#participant-whatsapp');
    if (whatsappInput) {
      whatsappInput.addEventListener('input', function () {
        const pos = this.selectionStart;
        const oldLen = this.value.length;
        this.value = formatPhone(this.value);
        const newLen = this.value.length;
        this.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
      });
    }

    // ---------- CODE MANAGEMENT (ADMIN) ----------

    // Generate codes button
    const btnGenerateCodes = $('#btn-generate-codes');
    if (btnGenerateCodes) {
      btnGenerateCodes.addEventListener('click', handleGenerateCodes);
    }

    // ---------- BACKUP MANAGEMENT ----------
    const btnExportBackup = $('#btn-export-backup');
    if (btnExportBackup) {
      btnExportBackup.addEventListener('click', handleExportBackup);
    }

    const btnImportBackup = $('#btn-import-backup');
    if (btnImportBackup) {
      btnImportBackup.addEventListener('click', handleImportClick);
    }

    const inputImportBackup = $('#input-import-backup');
    if (inputImportBackup) {
      inputImportBackup.addEventListener('change', handleImportBackup);
    }

    // ---------- TOURNAMENT CONFIG ----------
    const twoLeggedCheck = $('#two-legged-tournament');
    if (twoLeggedCheck) {
      twoLeggedCheck.addEventListener('change', () => {
        state.twoLegged = twoLeggedCheck.checked;
        saveState();
        showToast(`Sistema de ida/volta ${state.twoLegged ? 'ativado' : 'desativado'}`, 'info');
        renderBracket();
      });
    }

    const formatSelect = $('#tournament-format');
    if (formatSelect) {
      formatSelect.addEventListener('change', () => {
        state.tournamentFormat = formatSelect.value;
        toggleGroupsConfig();
        saveState();
      });
    }

    const groupCountInput = $('#group-count');
    if (groupCountInput) {
      groupCountInput.addEventListener('input', () => {
        const v = parseInt(groupCountInput.value, 10);
        if (!isNaN(v) && v >= 2 && v <= 16) {
          state.groupCount = v;
          saveState();
        }
      });
    }

    const s1Ida = $('#modal-team1-score-ida');
    const s2Ida = $('#modal-team2-score-ida');
    const s1Volta = $('#modal-team1-score-volta');
    const s2Volta = $('#modal-team2-score-volta');
    [s1Ida, s2Ida, s1Volta, s2Volta].forEach(inp => {
      if (inp) inp.addEventListener('input', handleScoreChange);
    });

    // Re-populate client select when teams change
    const teamCountInputForClients = $('#team-count');
    if (teamCountInputForClients) {
      teamCountInputForClients.addEventListener('input', () => {
        populateClientSelect();
      });
    }

    // Flag preview listeners
    const participantFlagSelect = $('#participant-flag');
    if (participantFlagSelect) {
      participantFlagSelect.addEventListener('change', () => updateFlagPreview('participant-flag', 'participant-flag-preview'));
    }

    const clientFlagSelect = $('#client-flag');
    if (clientFlagSelect) {
      clientFlagSelect.addEventListener('change', () => updateFlagPreview('client-flag', 'client-flag-preview'));
    }

    const playerFlagInput = $('#player-flag-input');
    if (playerFlagInput) {
      playerFlagInput.addEventListener('change', () => updateFlagPreview('player-flag-input', 'player-flag-preview'));
    }

    // Attendance buttons
    const btnAttendance = $('#btn-attendance');
    if (btnAttendance) btnAttendance.addEventListener('click', toggleAttendanceModal);

    const closeAttendance = $('#btn-close-attendance');
    if (closeAttendance) closeAttendance.addEventListener('click', toggleAttendanceModal);

    const attBackdrop = $('.modal-backdrop[data-dismiss="attendance-modal"]');
    if (attBackdrop) attBackdrop.addEventListener('click', toggleAttendanceModal);

    const clearAttBtn = $('#btn-clear-attendance');
    if (clearAttBtn) clearAttBtn.addEventListener('click', clearAttendance);
  }

  /* ==========================================================
     17.5. ATTENDANCE LIST (PRESENÇA)
     ========================================================== */
  function renderAttendanceList() {
    if (!state.attendance) state.attendance = {};
    const container = $('#attendance-list');
    const countEl = $('#attendance-count');
    const totalEl = $('#attendance-total');
    if (!container) return;

    let players = [];
    if (state.teams && state.teams.length > 0) {
      players = state.teams;
    } else if (state.participants && state.participants.length > 0) {
      players = state.participants.filter(p => p.verified);
    }

    totalEl.textContent = players.length;
    let presentCount = 0;
    let html = '';

    players.forEach(p => {
      const pid = p.id;
      const isPresent = !!state.attendance[pid];
      if (isPresent) presentCount++;
      const name = p.name || p.playerName;
      const nick = p.nick || p.teamName;
      const displayName = formatShortName(name || nick);

      html += `
        <div class="attendance-item ${isPresent ? 'present' : ''}" data-id="${pid}">
          <span class="attendance-name">${sanitize(displayName)}</span>
          <input type="checkbox" class="attendance-checkbox" ${isPresent ? 'checked' : ''}>
        </div>
      `;
    });

    if (players.length === 0) {
      html = '<div style="text-align:center; color:var(--text-tertiary); padding:20px;">Nenhum jogador encontrado.</div>';
    }

    container.innerHTML = html;
    countEl.textContent = presentCount;

    // Bind clicks
    container.querySelectorAll('.attendance-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const cb = item.querySelector('.attendance-checkbox');
        // Toggle only if we didn't click the checkbox directly
        if (e.target !== cb) {
          cb.checked = !cb.checked;
        }
        const pid = item.dataset.id;
        state.attendance[pid] = cb.checked;
        saveState();

        item.classList.toggle('present', cb.checked);
        const newCount = Object.values(state.attendance).filter(v => v).length;
        $('#attendance-count').textContent = newCount;

        // Dynamically update groups table if visible
        const rowNameSpan = document.querySelector(`.gt-player-row[data-team-id="${pid}"] .gt-player-name`);
        if (rowNameSpan) {
          rowNameSpan.style.color = cb.checked ? 'var(--accent-green)' : '';
        }
      });
    });
  }

  function toggleAttendanceModal() {
    const modal = $('#attendance-modal');
    if (modal.style.display === 'flex') {
      modal.style.display = 'none';
    } else {
      renderAttendanceList();
      modal.style.display = 'flex';
    }
  }

  function clearAttendance() {
    if (!confirm('Deseja desmarcar a presença de todos os jogadores?')) return;
    state.attendance = {};
    saveState();
    renderAttendanceList();
  }

  /* ==========================================================
     18. INITIALIZATION
     ========================================================== */

  /** Main initialization function */
  function init() {
    // 1. Set up event listeners (do this first so buttons work if needed)
    setupEventListeners();

    // 2. Subscribe to real-time state, then proceed with auth
    subscribeToState(() => {
      // 3. Listen for Firebase auth state changes (if available)
      if (firebaseAvailable && auth) {
        auth.onAuthStateChanged((user) => {
          currentUser = user;
          if (user) {
            // User is signed in: show as admin
            showMainApp(true);
          } else {
            // Not signed in: only show login if we haven't already entered as visitor
            const mainApp = document.getElementById('main-app');
            if (!mainApp || mainApp.style.display === 'none') {
              showLoginScreen();
            }
          }
        });
      }

      // 4. Check for remembered choice (UI state via localStorage)
      try {
        const remembered = localStorage.getItem(REMEMBER_KEY);
        if (remembered === 'visitor') {
          isAdmin = false;
          currentUser = null;
          showGameSelection();
          return;
        } else if (remembered === 'participant') {
          isAdmin = false;
          currentUser = null;
          showParticipantCodeScreen();
          return;
        } else if (remembered === 'admin_form') {
          isAdmin = false;
          currentUser = null;
          showLoginScreen();
          const form = $('#login-form');
          if (form) {
            form.style.display = 'block';
            form.style.animation = 'none';
          }
          return;
        }
      } catch (_) { /* ignore */ }

      // 5. Default: show login screen (auth callback above may override)
      showLoginScreen();
    });
  }

  // Run initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
