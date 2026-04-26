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
      teams: [],
      prize: '',
      bracket: null,
      champion: null,
      playerStats: {},
      codes: [],
      participants: []
    };
  }

  /** Persist current state to Firestore */
  function saveState() {
    if (firebaseAvailable && db) {
      // Remover valores undefined para evitar erros no Firestore
      const cleanState = JSON.parse(JSON.stringify(state));
      db.collection('tournaments').doc('main').set(cleanState).catch((err) => {
        console.error('Erro ao salvar no Firestore:', err);
        showToast('Erro ao salvar no banco. Verifique as Regras do Firestore!', 'error');
      });
    }
  }

  /** Subscribe to real-time state from Firestore */
  function subscribeToState(callback) {
    if (firebaseAvailable && db) {
      let firstLoad = true;
      db.collection('tournaments').doc('main').onSnapshot((doc) => {
        if (doc.exists) {
          state = Object.assign(defaultState(), doc.data());
        } else {
          state = defaultState();
          saveState(); // Initialize document with default state
        }

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
        showToast('Você não tem permissão de leitura no BD. Aplique as novas Regras do Firestore.', 'error');
        if (typeof callback === 'function') callback();
      });
    } else {
      if (typeof callback === 'function') callback();
    }
  }

  /**
   * Ensure a bracket always exists. If not, auto-create one with empty slots.
   */
  function ensureBracketExists() {
    if (state.bracket && state.bracket.rounds && state.bracket.rounds.length > 0) return;

    const count = state.teamCount || 8;
    const roundNames = getRoundNames(count);
    if (roundNames.length === 0) return;

    let matchesInRound = count / 2;
    const rounds = [];
    const existingTeams = [...(state.teams || [])];

    roundNames.forEach((name, rIdx) => {
      const matches = [];
      for (let m = 0; m < matchesInRound; m++) {
        const match = {
          id: `r${rIdx}m${m}`,
          team1: null,
          team2: null,
          winner: null,
          penalties: null,
          dateTime: null
        };
        // Fill first round with existing teams in order
        if (rIdx === 0) {
          const idx1 = m * 2;
          const idx2 = m * 2 + 1;
          if (idx1 < existingTeams.length) match.team1 = makeTeamSlotData(existingTeams[idx1]);
          if (idx2 < existingTeams.length) match.team2 = makeTeamSlotData(existingTeams[idx2]);
        }
        matches.push(match);
      }
      rounds.push({ name, matches });
      matchesInRound = Math.floor(matchesInRound / 2);
    });

    state.bracket = { rounds };
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
    info: '<svg class="svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow, #ffcc00)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
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

    const countSelect = $('#team-count');
    if (countSelect) countSelect.value = String(state.teamCount || 8);

    const prizeInput = $('#prize-description');
    if (prizeInput) prizeInput.value = state.prize || '';
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
    const text = $('#prize-text');
    if (!display || !text) return;

    if (state.prize) {
      text.textContent = state.prize;
      display.style.display = '';
    } else {
      display.style.display = 'none';
    }
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
      const team = {
        id: generateId(),
        teamName,
        playerName
      };
      if (photoData) team.photo = photoData;
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
      // Sempre pode deletar agora
      html += `
        <div class="team-item" data-id="${sanitize(team.id)}">
          <div class="team-item-info">
            <div class="team-avatar">${team.photo ? '<img src="' + sanitize(team.photo) + '" alt="">' : '<span class="av-placeholder">' + sanitize(initials(team.playerName)) + '</span>'}</div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${sanitize(team.teamName)}</div>
              <div style="font-size:12px;color:var(--text-secondary);">${sanitize(team.playerName)}</div>
            </div>
          </div>
          <button type="button" class="btn-remove-team icon-btn" data-team-id="${sanitize(team.id)}" title="Remover time" aria-label="Remover time"><svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>`;
    });

    container.innerHTML = html;

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
    const slot = { id: t.id, teamName: t.teamName, playerName: t.playerName, score: null };
    if (t.photo) slot.photo = t.photo;
    return slot;
  }

  /**
   * Determine round names based on total number of teams.
   * @param {number} teamCount
   * @returns {string[]}
   */
  function getRoundNames(teamCount) {
    switch (teamCount) {
      case 32:
        return ['Primeira Fase', 'Oitavas de Final', 'Quartas de Final', 'Semifinal', 'Final'];
      case 16:
        return ['Oitavas de Final', 'Quartas de Final', 'Semifinal', 'Final'];
      case 8:
        return ['Quartas de Final', 'Semifinal', 'Final'];
      case 4:
        return ['Semifinal', 'Final'];
      default:
        return ['Final'];
    }
  }

  /** Generate bracket from registered teams */
  function handleGenerate() {
    // Sync team count from select
    const countSelect = $('#team-count');
    const requiredCount = parseInt(countSelect ? countSelect.value : state.teamCount, 10);
    state.teamCount = requiredCount;

    // Sync tournament name
    syncTournamentName();

    const roundNames = getRoundNames(requiredCount);
    if (roundNames.length === 0) {
      showToast('Quantidade de times inválida. Escolha 4, 8, 16 ou 32.', 'error');
      return;
    }

    // Shuffle already registered teams
    const shuffled = shuffleArray([...state.teams]);

    let matchesInRound = requiredCount / 2;
    const rounds = [];

    roundNames.forEach((name, rIdx) => {
      const matches = [];
      for (let m = 0; m < matchesInRound; m++) {
        const match = {
          id: `r${rIdx}m${m}`,
          team1: null,
          team2: null,
          winner: null,
          penalties: null,
          dateTime: null
        };

        // First round: fill with already registered teams (remaining slots stay null/TBD)
        if (rIdx === 0) {
          const idx1 = m * 2;
          const idx2 = m * 2 + 1;
          if (idx1 < shuffled.length) {
            match.team1 = makeTeamSlotData(shuffled[idx1]);
          }
          if (idx2 < shuffled.length) {
            match.team2 = makeTeamSlotData(shuffled[idx2]);
          }
        }

        matches.push(match);
      }
      rounds.push({ name, matches });
      matchesInRound = Math.floor(matchesInRound / 2);
    });

    state.bracket = { rounds };
    state.champion = null;
    saveState();

    renderBracket();

    const remaining = requiredCount - shuffled.length;
    if (remaining > 0) {
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
    if (currentViewingBracketId) {
      const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
      return hist ? hist.bracket : null;
    }
    return state.bracket;
  }

  /** Retorna o nome do torneio que está sendo visualizado */
  function getCurrentBracketName() {
    if (currentViewingBracketId) {
      const hist = state.tournamentsHistory.find(h => h.id === currentViewingBracketId);
      return hist ? hist.name : 'Torneio Passado';
    }
    return state.tournamentName || 'COPA PSYZON';
  }

  /** Main bracket render function */
  function renderBracket() {
    const container = $('#bracket-container');
    const emptyState = $('#empty-state');
    if (!container) return;

    // Clear
    container.innerHTML = '';

    const bracket = getCurrentBracket();

    if (!bracket || !bracket.rounds || bracket.rounds.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if ($('#btn-finish-tournament')) $('#btn-finish-tournament').style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if ($('#btn-finish-tournament')) {
      // Só mostra o botão de finalizar se for o torneio atual
      $('#btn-finish-tournament').style.display = currentViewingBracketId ? 'none' : '';
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
        matchesEl.appendChild(card);
      });

      roundEl.appendChild(matchesEl);
      bracketEl.appendChild(roundEl);
    });

    container.appendChild(bracketEl);

    // Show champion if already determined
    if (state.champion) {
      renderChampionBannerIfNeeded();
    }
  }

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

    // Defer SVG drawing until after layout
    requestAnimationFrame(() => {
      drawConnectors(svgWrap, col, prevMatchCount, roundIndex);
    });

    return col;
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

      // Y positions relative to the svg container
      const y1 = r1.top + r1.height / 2 - svgWrapRect.top;
      const y2 = r2.top + r2.height / 2 - svgWrapRect.top;
      const yt = rt.top + rt.height / 2 - svgWrapRect.top;

      const midX = colWidth / 2;

      // Line from card1 right edge to midpoint
      addLine(svg, 0, y1, midX, y1);
      // Line from card2 right edge to midpoint
      addLine(svg, 0, y2, midX, y2);
      // Vertical line connecting the two
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
    const card = document.createElement('div');
    card.className = 'match-card';
    card.dataset.matchId = match.id;

    // Header
    const header = document.createElement('div');
    header.className = 'match-header';

    const matchLabel = document.createElement('span');
    matchLabel.className = 'match-id';
    matchLabel.textContent = `Jogo ${mIdx + 1}`;
    header.appendChild(matchLabel);

    const bothTeams = match.team1 && match.team2;
    const canEdit = isAdmin && bothTeams;

    // Edit button (admin only, even if there's a winner)
    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'match-schedule icon-btn';
      editBtn.type = 'button';
      editBtn.innerHTML = SVG.pencil + (match.winner ? ' Editar' : ' Resultado');
      editBtn.addEventListener('click', () => openScoreModal(rIdx, mIdx));
      header.appendChild(editBtn);
    } else if (match.winner && !isAdmin) {
      const doneSpan = document.createElement('span');
      doneSpan.style.cssText = 'font-size:11px;color:var(--accent-green);font-weight:600;';
      doneSpan.innerHTML = SVG.checkCircle + ' Finalizado';
      header.appendChild(doneSpan);
    }

    card.appendChild(header);

    // DATE/TIME BAR DIRECTLY INTO CARD
    if (canEdit && !match.winner) {
      const dtBar = document.createElement('div');
      dtBar.className = 'match-datetime-bar';

      const dateInp = document.createElement('input');
      dateInp.type = 'date';
      dateInp.className = 'card-date-input';

      const timeInp = document.createElement('input');
      timeInp.type = 'time';
      timeInp.className = 'card-time-input';

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
      // Fallback para preencher data caso digite apenas o tempo primeiro
      timeInp.addEventListener('change', () => {
        if (!dateInp.value) dateInp.value = new Date().toISOString().split('T')[0];
        saveDateTime();
      });

      dtBar.appendChild(dateInp);
      dtBar.appendChild(timeInp);
      card.appendChild(dtBar);
    } else if (match.dateTime) {
      const dtBar = document.createElement('div');
      dtBar.className = 'match-datetime-bar readonly';

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
      card.appendChild(dtBar);
    }

    // Team 1 slot
    card.appendChild(createTeamSlot(match.team1, match, 1));

    // Team 2 slot
    card.appendChild(createTeamSlot(match.team2, match, 2));
    // Penalty info
    if (match.penalties) {
      const penDiv = document.createElement('div');
      penDiv.className = 'match-penalty-info';
      penDiv.innerHTML = `Pênaltis: ${match.penalties.team1} <svg class="svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;"><path d="M18 6 6 18M6 6l12 12"/></svg> ${match.penalties.team2}`;
      card.appendChild(penDiv);
    }

    return card;
  }

  let activeTouchGhost = null;
  let activeTouchData = null;

  function createTeamSlot(team, match, teamNum) {
    const slot = document.createElement('div');
    slot.className = 'match-team';
    slot.dataset.matchId = match.id;
    slot.dataset.teamNum = teamNum;

    // Configurações de Drag and Drop se for organizador e não tiver vencedor ainda
    if (isAdmin) {
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
          // Efetuar a troca de times
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

    if (isAdmin) {
      // PC: Mouse Drag Drop
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

        if (!activeTouchGhost) return;

        slot.classList.remove('dragging');
        document.body.style.overflow = ''; // Restore smooth scrolling

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

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'team-avatar';
    if (team.photo) {
      const avImg = document.createElement('img');
      avImg.src = team.photo;
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
    const nameSpan = document.createElement('span');
    nameSpan.className = 'team-name-bracket';
    nameSpan.textContent = team.playerName || team.teamName;
    nameSpan.title = `${team.teamName} â€” ${team.playerName}`;

    // Make player name clickable to show profile
    const teamRecord = state.teams.find(t => t.playerName === team.playerName && t.teamName === team.teamName);
    if (teamRecord) {
      nameSpan.classList.add('clickable');
      nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayerProfile(teamRecord.id);
      });
    }

    slot.appendChild(nameSpan);

    // Score
    if (team.score !== null && team.score !== undefined) {
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score-display';
      scoreSpan.textContent = String(team.score);
      slot.appendChild(scoreSpan);
    }

    return slot;
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

    const match = bracket.rounds[rIdx].matches[mIdx];
    if (!match || !match.team1 || !match.team2) return;

    modalMatch = { roundIdx: rIdx, matchIdx: mIdx };

    const modal = $('#score-modal');
    if (!modal) return;

    // Populate team names
    const t1Name = $('#modal-team1-name');
    const t2Name = $('#modal-team2-name');
    if (t1Name) t1Name.textContent = match.team1.playerName;
    if (t2Name) t2Name.textContent = match.team2.playerName;

    // Scores
    const s1 = $('#modal-team1-score');
    const s2 = $('#modal-team2-score');
    if (s1) s1.value = match.team1.score !== null ? match.team1.score : 0;
    if (s2) s2.value = match.team2.score !== null ? match.team2.score : 0;

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
    const s1 = parseInt(($('#modal-team1-score') || {}).value, 10);
    const s2 = parseInt(($('#modal-team2-score') || {}).value, 10);

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
    if (rIdx < 0 || mIdx < 0) return;

    const bracket = getCurrentBracket();
    if (!bracket) return;

    const match = bracket.rounds[rIdx].matches[mIdx];
    if (!match) return;

    const score1 = parseInt(($('#modal-team1-score') || {}).value, 10);
    const score2 = parseInt(($('#modal-team2-score') || {}).value, 10);

    if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
      showToast('Insira placares válidos (números >= 0).', 'error');
      return;
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

    // --- REVERT OLD STATS IF EDITING ---
    if (match.statsApplied) {
      revertMatchStats(match);
    }

    // --- UPDATE MATCH ---
    match.team1.score = score1;
    match.team2.score = score2;
    match.winner = winnerNum;
    match.penalties = penalties;

    const totalRounds = bracket.rounds.length;

    // --- APPLY NEW STATS ---
    const isFinal = rIdx === totalRounds - 1;
    const isSemi = rIdx === totalRounds - 2;
    applyMatchStats(match, isSemi, isFinal);

    // Advance winner to next round
    const winnerTeam = winnerNum === 1 ? match.team1 : match.team2;

    if (rIdx < totalRounds - 1) {
      // Determine slot in next round
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
      showToast('Resultado registrado!', 'success');
    }

    // Call saveState and renderBracket AFTER the champion state is set to properly persist it
    saveState();
    closeScoreModal();
    renderBracket();
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

  /** Troca dois times de posição no chaveamento (Drag and Drop) */
  function swapTeamsInBracket(source, target) {
    if (!state.bracket || !state.bracket.rounds) return;

    let sourceMatch = null;
    let targetMatch = null;

    state.bracket.rounds.forEach(r => {
      r.matches.forEach(m => {
        if (m.id === source.matchId) sourceMatch = m;
        if (m.id === target.matchId) targetMatch = m;
      });
    });

    if (!sourceMatch || !targetMatch) return;

    // Obter referências aos times
    const teamA = source.teamNum === 1 ? sourceMatch.team1 : sourceMatch.team2;
    const teamB = target.teamNum === 1 ? targetMatch.team1 : targetMatch.team2;

    // Realizar a troca
    if (source.teamNum === 1) sourceMatch.team1 = teamB;
    else sourceMatch.team2 = teamB;

    if (target.teamNum === 1) targetMatch.team1 = teamA;
    else targetMatch.team2 = teamA;

    // Resetar os resultados se alguém foi movido (opcional)
    sourceMatch.winner = null;
    sourceMatch.penalties = null;
    if (sourceMatch.team1) sourceMatch.team1.score = null;
    if (sourceMatch.team2) sourceMatch.team2.score = null;

    if (sourceMatch !== targetMatch) {
      targetMatch.winner = null;
      targetMatch.penalties = null;
      if (targetMatch.team1) targetMatch.team1.score = null;
      if (targetMatch.team2) targetMatch.team2.score = null;
    }

    saveState();
    renderBracket();
    showToast('Times trocados com sucesso!', 'info');
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
    saveState();

    closeChampionBanner();
    renderBracket();
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

    saveState();
    if ($('#ranking-tab').style.display !== 'none') {
      renderRankingTable();
    }
    renderTop3();
    showToast('Dados do jogador salvos!', 'success');
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

    // Stats
    const trEl = $('#profile-trophies');
    const fiEl = $('#profile-finals');
    const sfEl = $('#profile-semifinals');
    const glEl = $('#profile-goals');
    const gTakenEl = $('#profile-goals-taken');
    const gDiffEl = $('#profile-goal-diff');

    if (trEl) trEl.textContent = stats.trophies || 0;
    if (fiEl) fiEl.textContent = stats.finals || 0;
    if (sfEl) sfEl.textContent = stats.semifinals || 0;
    if (glEl) glEl.textContent = stats.goals || 0;
    if (gTakenEl) gTakenEl.textContent = stats.goalsTaken || 0;
    if (gDiffEl) gDiffEl.textContent = stats.goalDiff || 0;

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
          semifinals: stats.semifinals || 0
        };
      })
      .filter(r => r.trophies > 0 || r.finals > 0 || r.semifinals > 0)
      .sort((a, b) => {
        if (b.trophies !== a.trophies) return b.trophies - a.trophies;
        if (b.finals !== a.finals) return b.finals - a.finals;
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
      const avatar = r.team.photo
        ? '<img src="' + sanitize(r.team.photo) + '" alt="' + sanitize(r.team.playerName) + '">'
        : '<span class="av-placeholder top3-av-placeholder">' + sanitize(initials(r.team.playerName)) + '</span>';

      html += `
        <li class="top3-item" data-team-id="${sanitize(r.team.id)}">
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
      champion: state.champion ? JSON.parse(JSON.stringify(state.champion)) : null,
      bracket: JSON.parse(JSON.stringify(state.bracket)),
      teamsCount: state.teamCount || 8
    };

    state.tournamentsHistory.unshift(record);

    state.bracket = null;
    state.champion = null;
    state.teams = [];

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

    if (!state.playerStats) state.playerStats = {};
    const ranked = [];

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
          goalDiff: stats.goalDiff || 0
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
            goalDiff: stats.goalDiff || 0
          });
        }
      });
    }

    if (ranked.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-tertiary);">Nenhum jogador registrado ainda.</td></tr>';
      return;
    }

    // Sorting algorithm: Trophies > Finals > Semifinals > GoalDiff > Goals > Alphabetic
    ranked.sort((a, b) => {
      if (b.trophies !== a.trophies) return b.trophies - a.trophies;
      if (b.finals !== a.finals) return b.finals - a.finals;
      if (b.semifinals !== a.semifinals) return b.semifinals - a.semifinals;
      if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
      if (b.goals !== a.goals) return b.goals - a.goals;
      return String(a.name).localeCompare(String(b.name));
    });

    let html = '';
    ranked.forEach((r, i) => {
      const posClass = i < 3 ? 'pos-' + (i + 1) : '';
      const avatarHtml = r.photo
        ? '<img src="' + sanitize(r.photo) + '" alt="">'
        : '<span class="av-placeholder" style="font-size:12px;">' + sanitize(initials(r.name)) + '</span>';

      html += '<tr class="' + posClass + '" data-team-id="' + sanitize(r.id) + '" style="cursor:pointer;">' +
        '<td class="col-pos">' + (i + 1) + 'Âº</td>' +
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

      // Save participant record
      const participant = {
        id: participantId,
        code: currentParticipantCode,
        name: name,
        cpf: cpf,
        instagram: instagram,
        whatsapp: whatsapp,
        nick: nick,
        photo: photoData || null,
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
        playerName: name
      };
      if (photoData) team.photo = photoData;
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
        if (confirm('Deseja inutilizar o código ' + oldCode + ' e gerar N° novo no lugar?\nO cliente que já usou este código perderá o acesso e você poderá passar o novo código para outra pessoa.')) {
          const idx = state.codes.findIndex(function (c) { return c.code === oldCode; });
          if (idx !== -1) {
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

  /** Shuffle the first round of the bracket */
  function shuffleBracket() {
    if (!state.bracket || !state.bracket.rounds || state.bracket.rounds.length === 0) {
      showToast('Gere o chaveamento primeiro.', 'info');
      return;
    }

    if (currentViewingBracketId) {
      showToast('Não é possível embaralhar um torneio do histórico.', 'error');
      return;
    }

    const round0 = state.bracket.rounds[0];
    let slots = [];
    round0.matches.forEach(m => {
      if (m.team1) slots.push(m.team1);
      if (m.team2) slots.push(m.team2);
    });

    if (slots.length === 0) return;

    slots = shuffleArray(slots);

    let pointer = 0;
    round0.matches.forEach(m => {
      if (m.statsApplied) revertMatchStats(m);
      m.team1 = slots[pointer++] || null;
      m.team2 = slots[pointer++] || null;
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
    showToast('Chaveamento embaralhado com sucesso!', 'success');
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

  /** Export state to a JSON file */
  function handleExportBackup() {
    console.log('Iniciando exportação de backup...');
    try {
      // Garantir que temos os dados mais recentes e limpos (sem referências circulares ou DOM)
      const cleanState = JSON.parse(JSON.stringify(state));
      const dataStr = JSON.stringify(cleanState, null, 2);
      
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];
      
      a.href = url;
      a.download = `backup_copa_psyzon_${date}.json`;
      document.body.appendChild(a);
      a.click();
      
      // Pequeno delay antes de remover para garantir que o browser processe o download em alguns sistemas
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
    reader.onload = function(event) {
      try {
        const importedState = JSON.parse(event.target.result);
        
        // Basic validation
        if (typeof importedState !== 'object' || !Array.isArray(importedState.teams)) {
          throw new Error('Formato de arquivo inválido.');
        }

        // Merge imported state into current state
        state = Object.assign(defaultState(), importedState);
        
        saveState();
        showToast('Backup importado com sucesso! Recarregando...', 'success');
        
        // Clear input
        e.target.value = '';
        
        // Reload to ensure all UI components sync with new state
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

    // Score modal: cancel
    const btnCancel = $('#btn-cancel-modal');
    if (btnCancel) {
      btnCancel.addEventListener('click', closeScoreModal);
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

    // Team count select: save on change
    const teamCountSelect = $('#team-count');
    if (teamCountSelect) {
      teamCountSelect.addEventListener('change', () => {
        state.teamCount = parseInt(teamCountSelect.value, 10);
        saveState();
        renderTeamList();
      });
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
        } else if (targetId === 'history-tab') {
          renderHistory();
        } else if (targetId === 'bracket-tab') {
          renderBracket();
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

    // Re-populate client select when teams change
    const teamCountSelectForClients = $('#team-count');
    if (teamCountSelectForClients) {
      teamCountSelectForClients.addEventListener('change', () => {
        populateClientSelect();
      });
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
