(function () {
    'use strict';

    const ORGANIZER_PASSWORD = 'guiro';
    const CRITICAL_ACTION_PASSWORD = '153090';
    const STORAGE_KEY = 'copaPsyzonFinanceiro';
    const FIREBASE_PATH = 'financeiro';
    const DEFAULT_EDITION_NAME = 'Edicao principal';
    const MONEY_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const NOTE_TABS = [
        { id: 'geral', label: 'Geral', icon: 'ph-notebook' },
        { id: 'gastos', label: 'Gastos', icon: 'ph-receipt' },
        { id: 'patrocinadores', label: 'Patrocinadores', icon: 'ph-handshake' },
        { id: 'participantes', label: 'Participantes', icon: 'ph-users-three' },
        { id: 'emprestimos', label: 'Emprestimos', icon: 'ph-bank' },
        { id: 'pendencias', label: 'Pendencias', icon: 'ph-warning-circle' },
        { id: 'ideias', label: 'Ideias', icon: 'ph-lightbulb' }
    ];
    const NOTE_STATUSES = ['Aberto', 'Em andamento', 'Resolvido', 'Pago', 'Pendente'];
    const NOTE_TAB_IDS = NOTE_TABS.map((tab) => tab.id);
    const FIREBASE_CONFIG = {
        apiKey: 'AIzaSyCL2u-oSlw8EWQ96atPI9Tc-0cIl2k9K6M',
        authDomain: 'copa-psyzon2.firebaseapp.com',
        projectId: 'copa-psyzon2',
        storageBucket: 'copa-psyzon2.firebasestorage.app',
        messagingSenderId: '934292793843',
        appId: '1:934292793843:web:2f67fc6d314e1185f6ca86',
        measurementId: 'G-G9Q14JE533',
        databaseURL: 'https://copa-psyzon2-default-rtdb.firebaseio.com'
    };

    let financeiroState = createDefaultFinanceiroData();
    let firebaseApi = null;
    let initialized = false;
    const ui = {
        activeTab: 'geral',
        selectedNoteId: null,
        view: 'active',
        search: '',
        filter: 'all',
        sort: 'recent',
        saveTimer: null,
        saveStatusTimer: null,
        isRenderingEditor: false
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function createId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function todayInputValue() {
        return new Date().toISOString().slice(0, 10);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#096;');
    }

    function normalizeText(value, fallback = '') {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function normalizeArray(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') return Object.values(value);
        return [];
    }

    function toNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.abs(number) : 0;
    }

    function parseCurrency(value) {
        if (typeof value === 'number') return Math.abs(value);
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const digits = raw.replace(/\D/g, '');
        if (!digits) return 0;
        return Number(digits) / 100;
    }

    function formatCurrencyBRL(value) {
        return MONEY_FORMATTER.format(Number(value) || 0);
    }

    function getFinanceNoteTab(tab) {
        return NOTE_TAB_IDS.includes(tab) ? tab : 'geral';
    }

    function financeNoteTabLabel(tab) {
        return NOTE_TABS.find((item) => item.id === tab)?.label || 'Geral';
    }

    function normalizeFinanceNoteStatus(status) {
        const text = normalizeText(status, 'Aberto');
        return NOTE_STATUSES.find((item) => item.toLowerCase() === text.toLowerCase()) || 'Aberto';
    }

    function financeNoteStatusSlug(status) {
        return normalizeText(status, 'Aberto')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function createDefaultFinanceNotes() {
        return {
            tabs: NOTE_TAB_IDS.reduce((acc, tab) => {
                acc[tab] = [];
                return acc;
            }, {}),
            version: 2,
            updatedAt: new Date().toISOString()
        };
    }

    function createDefaultEdition(name = DEFAULT_EDITION_NAME, raw = {}) {
        const now = new Date().toISOString();
        const editionId = raw.id || createId('ed');
        const notes = normalizeText(raw.notes || raw.notas, '');
        return {
            ...raw,
            id: editionId,
            name: normalizeText(raw.name || raw.nome, name),
            notes,
            financeNotes: normalizeFinanceNotes(raw.financeNotes || raw.notasFinanceiras, notes, editionId),
            movimentacoes: normalizeArray(raw.movimentacoes),
            patrocinadores: normalizeArray(raw.patrocinadores),
            participantesPagos: normalizeArray(raw.participantesPagos),
            emprestimos: normalizeArray(raw.emprestimos),
            createdAt: raw.createdAt || now,
            updatedAt: raw.updatedAt || now
        };
    }

    function createDefaultFinanceiroData() {
        const edition = createDefaultEdition(DEFAULT_EDITION_NAME);
        return {
            movimentacoes: edition.movimentacoes,
            patrocinadores: edition.patrocinadores,
            participantesPagos: edition.participantesPagos,
            emprestimos: edition.emprestimos,
            notas: edition.notes,
            financeNotes: edition.financeNotes,
            edicoes: [edition],
            activeEditionId: edition.id,
            historico: [],
            updatedAt: new Date().toISOString()
        };
    }

    function stableLegacyNoteId(sourceId = '') {
        const source = String(sourceId || 'edicao_principal')
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'edicao_principal';
        return `legacy_${source}`;
    }

    function sanitizeFinanceNoteContent(html) {
        const raw = String(html || '');
        if (!raw) return '';
        const template = document.createElement('template');
        template.innerHTML = raw;
        template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((node) => node.remove());

        const allowed = new Set(['DIV', 'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'SPAN', 'MARK', 'HR']);
        template.content.querySelectorAll('*').forEach((node) => {
            if (!allowed.has(node.tagName)) {
                const parent = node.parentNode;
                while (node.firstChild) parent.insertBefore(node.firstChild, node);
                node.remove();
                return;
            }

            const className = String(node.getAttribute('class') || '');
            const checked = node.getAttribute('data-checked') === 'true' ? 'true' : 'false';
            const checkId = node.getAttribute('data-check-id') || createId('chk');
            const align = ['left', 'center', 'right'].includes(node.style?.textAlign) ? node.style.textAlign : '';
            const highlighted = Boolean(node.style?.backgroundColor && node.style.backgroundColor !== 'transparent');
            const classes = className.split(/\s+/).filter(Boolean);
            const isCheck = classes.some((item) => ['note-check', 'finance-note-check'].includes(item));
            const isBox = classes.some((item) => ['note-check-box', 'finance-note-check-box'].includes(item));
            const isText = classes.some((item) => ['note-check-text', 'finance-note-check-text'].includes(item));
            const isPending = classes.some((item) => ['note-pending-line', 'finance-note-pending-line'].includes(item));

            Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));

            if (isCheck) {
                node.setAttribute('class', 'note-check');
                node.setAttribute('data-checked', checked);
                node.setAttribute('data-check-id', checkId);
            } else if (isBox) {
                node.setAttribute('class', 'note-check-box');
                node.setAttribute('contenteditable', 'false');
            } else if (isText) {
                node.setAttribute('class', 'note-check-text');
            } else if (isPending) {
                node.setAttribute('class', 'note-pending-line');
            } else if (node.tagName === 'MARK' || highlighted || className.includes('note-important') || className.includes('financeiro-note-important')) {
                node.setAttribute('class', 'note-important');
            }

            if (align && ['DIV', 'P', 'H2', 'H3'].includes(node.tagName)) {
                node.setAttribute('style', `text-align: ${align};`);
            }
        });

        return template.innerHTML.trim();
    }

    function htmlToPlainText(html) {
        const raw = String(html || '');
        if (!raw) return '';
        const container = document.createElement('div');
        container.innerHTML = sanitizeFinanceNoteContent(raw);
        $$('.note-check', container).forEach((item) => {
            const checked = item.dataset.checked === 'true' ? '[x]' : '[ ]';
            const text = item.querySelector('.note-check-text')?.textContent || item.textContent || '';
            item.replaceWith(document.createTextNode(`${checked} ${text.trim()}\n`));
        });
        container.querySelectorAll('hr').forEach((hr) => hr.replaceWith(document.createTextNode('\n---\n')));
        return (container.innerText || container.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    function extractChecklistFromContent(content) {
        const container = document.createElement('div');
        container.innerHTML = sanitizeFinanceNoteContent(content);
        return $$('.note-check', container).map((item) => ({
            id: item.dataset.checkId || createId('chk'),
            text: normalizeText(item.querySelector('.note-check-text')?.textContent || item.textContent, 'Tarefa'),
            checked: item.dataset.checked === 'true'
        }));
    }

    function normalizeFinanceNote(raw = {}, fallbackTab = 'geral') {
        const now = new Date().toISOString();
        const tab = getFinanceNoteTab(raw.tab || raw.category || raw.categoria || fallbackTab);
        const content = sanitizeFinanceNoteContent(raw.content || raw.conteudo || '');
        const checklist = content
            ? extractChecklistFromContent(content)
            : normalizeArray(raw.checklist).map((item) => ({
                id: item.id || createId('chk'),
                text: normalizeText(item.text || item.label || item.titulo, 'Tarefa'),
                checked: Boolean(item.checked || item.done || item.concluido)
            }));

        return {
            id: raw.id || createId('note'),
            title: normalizeText(raw.title || raw.titulo, 'Nova nota'),
            content,
            plainText: normalizeText(raw.plainText || raw.texto || htmlToPlainText(content), ''),
            tab,
            value: toNumber(raw.value ?? raw.valor),
            status: normalizeFinanceNoteStatus(raw.status),
            pinned: Boolean(raw.pinned || raw.fixada),
            favorite: Boolean(raw.favorite || raw.favorita),
            archived: Boolean(raw.archived || raw.arquivada),
            deleted: Boolean(raw.deleted || raw.excluida),
            checklist,
            createdAt: raw.createdAt || raw.criadaEm || now,
            updatedAt: raw.updatedAt || raw.editadaEm || raw.createdAt || now,
            deletedAt: raw.deletedAt || null
        };
    }

    function migrateOldFinanceNotes(legacyText = '', sourceId = '') {
        const text = normalizeText(legacyText, '');
        if (!text) return null;
        const now = new Date().toISOString();
        return normalizeFinanceNote({
            id: stableLegacyNoteId(sourceId),
            title: 'Anotacao antiga',
            content: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
            plainText: text,
            tab: 'geral',
            status: 'Aberto',
            createdAt: now,
            updatedAt: now
        }, 'geral');
    }

    function normalizeFinanceNotes(raw = {}, legacyText = '', sourceId = '') {
        const normalized = createDefaultFinanceNotes();
        const hasTabs = raw && typeof raw === 'object' && raw.tabs && typeof raw.tabs === 'object';
        const source = hasTabs ? raw.tabs : raw;
        let receivedAnyNote = false;

        if (Array.isArray(source)) {
            normalized.tabs.geral = source.map((note) => normalizeFinanceNote(note, 'geral'));
            receivedAnyNote = normalized.tabs.geral.length > 0;
        } else if (source && typeof source === 'object') {
            NOTE_TAB_IDS.forEach((tab) => {
                const notes = normalizeArray(source[tab]).map((note) => normalizeFinanceNote(note, tab));
                normalized.tabs[tab] = notes;
                if (notes.length) receivedAnyNote = true;
            });
        }

        if (!receivedAnyNote && !hasTabs) {
            const legacy = migrateOldFinanceNotes(legacyText, sourceId);
            if (legacy) normalized.tabs.geral = [legacy];
        }

        normalized.updatedAt = raw?.updatedAt || new Date().toISOString();
        normalized.version = raw?.version || 2;
        return normalized;
    }

    function getAllFinanceNotesFromData(data) {
        const notes = data?.tabs || {};
        return NOTE_TAB_IDS.flatMap((tab) => normalizeArray(notes[tab]).map((note) => normalizeFinanceNote(note, tab)));
    }

    function newestItem(a = {}, b = {}) {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime >= aTime ? b : a;
    }

    function mergeFinanceNotes(localNotes, remoteNotes) {
        const local = normalizeFinanceNotes(localNotes);
        const remote = normalizeFinanceNotes(remoteNotes);
        const map = new Map();

        [...getAllFinanceNotesFromData(local), ...getAllFinanceNotesFromData(remote)].forEach((note) => {
            const current = map.get(note.id);
            map.set(note.id, current ? newestItem(current, note) : note);
        });

        const merged = createDefaultFinanceNotes();
        Array.from(map.values()).forEach((note) => {
            const normalized = normalizeFinanceNote(note, note.tab);
            merged.tabs[normalized.tab].push(normalized);
        });
        merged.updatedAt = newestItem(local, remote).updatedAt || new Date().toISOString();
        return merged;
    }

    function normalizeFinanceiroData(raw = {}) {
        const base = createDefaultFinanceiroData();
        let edicoes = normalizeArray(raw.edicoes).map((edition) => createDefaultEdition(DEFAULT_EDITION_NAME, edition));

        if (!edicoes.length) {
            edicoes = [createDefaultEdition(DEFAULT_EDITION_NAME, {
                id: raw.activeEditionId || 'edicao_principal',
                name: raw.editionName || raw.edicaoNome || DEFAULT_EDITION_NAME,
                notes: raw.notas || raw.notes || '',
                financeNotes: raw.financeNotes || raw.notasFinanceiras,
                movimentacoes: raw.movimentacoes,
                patrocinadores: raw.patrocinadores,
                participantesPagos: raw.participantesPagos,
                emprestimos: raw.emprestimos,
                createdAt: raw.createdAt,
                updatedAt: raw.updatedAt
            })];
        }

        const requestedEditionId = raw.activeEditionId || edicoes[0]?.id;
        const activeEdition = edicoes.find((edition) => edition.id === requestedEditionId) || edicoes[0] || base.edicoes[0];
        return {
            ...raw,
            movimentacoes: activeEdition.movimentacoes || [],
            patrocinadores: activeEdition.patrocinadores || [],
            participantesPagos: activeEdition.participantesPagos || [],
            emprestimos: activeEdition.emprestimos || [],
            notas: activeEdition.notes || '',
            financeNotes: normalizeFinanceNotes(activeEdition.financeNotes, activeEdition.notes || '', activeEdition.id),
            edicoes,
            activeEditionId: activeEdition.id,
            historico: normalizeArray(raw.historico),
            updatedAt: raw.updatedAt || base.updatedAt
        };
    }

    function mergeFinanceiroData(localData, remoteData) {
        const local = normalizeFinanceiroData(localData);
        const remote = normalizeFinanceiroData(remoteData);
        const localTime = new Date(local.updatedAt || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || 0).getTime();
        const map = new Map();

        [...local.edicoes, ...remote.edicoes].forEach((edition) => {
            const current = map.get(edition.id);
            if (!current) {
                map.set(edition.id, edition);
                return;
            }
            const newest = newestItem(current, edition);
            map.set(edition.id, {
                ...current,
                ...edition,
                ...newest,
                financeNotes: mergeFinanceNotes(current.financeNotes, edition.financeNotes)
            });
        });

        return normalizeFinanceiroData({
            ...(remoteTime > localTime ? local : remote),
            ...(remoteTime > localTime ? remote : local),
            edicoes: Array.from(map.values()),
            activeEditionId: remoteTime > localTime ? remote.activeEditionId : local.activeEditionId,
            historico: remoteTime > localTime ? remote.historico : local.historico,
            updatedAt: new Date(Math.max(localTime, remoteTime, Date.now())).toISOString()
        });
    }

    function getActiveEdition() {
        if (!financeiroState.edicoes?.length) financeiroState = normalizeFinanceiroData(financeiroState);
        let edition = financeiroState.edicoes.find((item) => item.id === financeiroState.activeEditionId);
        if (!edition) {
            edition = financeiroState.edicoes[0] || createDefaultEdition(DEFAULT_EDITION_NAME);
            financeiroState.activeEditionId = edition.id;
            if (!financeiroState.edicoes.some((item) => item.id === edition.id)) financeiroState.edicoes.unshift(edition);
        }
        return edition;
    }

    function syncRootToActiveEdition() {
        const edition = getActiveEdition();
        edition.financeNotes = normalizeFinanceNotes(financeiroState.financeNotes, edition.notes || financeiroState.notas || '', edition.id);
        edition.updatedAt = new Date().toISOString();
        financeiroState.financeNotes = edition.financeNotes;
        financeiroState.notas = edition.notes || financeiroState.notas || '';
        financeiroState.movimentacoes = edition.movimentacoes || [];
        financeiroState.patrocinadores = edition.patrocinadores || [];
        financeiroState.participantesPagos = edition.participantesPagos || [];
        financeiroState.emprestimos = edition.emprestimos || [];
    }

    function loadActiveEditionToRoot() {
        const edition = getActiveEdition();
        financeiroState.movimentacoes = edition.movimentacoes || [];
        financeiroState.patrocinadores = edition.patrocinadores || [];
        financeiroState.participantesPagos = edition.participantesPagos || [];
        financeiroState.emprestimos = edition.emprestimos || [];
        financeiroState.notas = edition.notes || '';
        financeiroState.financeNotes = normalizeFinanceNotes(edition.financeNotes, edition.notes || '', edition.id);
    }

    function readLocalFinanceiroData() {
        try {
            return normalizeFinanceiroData(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
        } catch (error) {
            console.warn('Nao foi possivel ler o financeiro local:', error);
            return createDefaultFinanceiroData();
        }
    }

    function writeLocalFinanceiroData() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(financeiroState));
    }

    function setSyncStatus(text, mode = 'info') {
        const status = $('#notes-sync-status');
        if (!status) return;
        status.textContent = text;
        status.dataset.mode = mode;
    }

    async function initFirebaseConnection() {
        setSyncStatus('conectando Firebase...');
        try {
            const [appModule, databaseModule] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js')
            ]);
            const existing = appModule.getApps().find((app) => app.name === 'copaPsyzonFinanceiro');
            const app = existing || appModule.initializeApp(FIREBASE_CONFIG, 'copaPsyzonFinanceiro');
            const db = databaseModule.getDatabase(app);
            firebaseApi = {
                db,
                ref: databaseModule.ref,
                get: databaseModule.get,
                set: databaseModule.set
            };
            setSyncStatus('Firebase pronto', 'online');
            return true;
        } catch (error) {
            firebaseApi = null;
            setSyncStatus('Firebase offline', 'offline');
            console.warn('Firebase notas indisponivel:', error);
            return false;
        }
    }

    async function loadFinanceiroData() {
        const localData = readLocalFinanceiroData();
        financeiroState = normalizeFinanceiroData(localData);
        loadActiveEditionToRoot();
        renderFinanceNotes();

        if (!firebaseApi) return financeiroState;

        try {
            const snapshot = await firebaseApi.get(firebaseApi.ref(firebaseApi.db, FIREBASE_PATH));
            const remoteData = snapshot.exists() ? snapshot.val() : createDefaultFinanceiroData();
            financeiroState = mergeFinanceiroData(localData, remoteData);
            loadActiveEditionToRoot();
            writeLocalFinanceiroData();
            await saveFinanceiroData({ render: false, silent: true });
            setSyncStatus('sincronizado', 'online');
            renderFinanceNotes();
        } catch (error) {
            setSyncStatus('Firebase falhou, local preservado', 'offline');
            console.warn('Falha ao carregar notas no Firebase:', error);
        }
        return financeiroState;
    }

    async function saveFinanceiroData(options = {}) {
        const shouldRender = options.render !== false;
        syncRootToActiveEdition();
        financeiroState.updatedAt = new Date().toISOString();
        writeLocalFinanceiroData();
        if (shouldRender) renderFinanceNotes();

        if (!firebaseApi) {
            setSyncStatus('salvo no localStorage', 'offline');
            return true;
        }

        try {
            await firebaseApi.set(firebaseApi.ref(firebaseApi.db, FIREBASE_PATH), financeiroState);
            setSyncStatus('salvo no Firebase', 'online');
            return true;
        } catch (error) {
            setSyncStatus('Firebase falhou, local salvo', 'offline');
            console.warn('Falha ao salvar notas:', error);
            if (!options.silent) showToast('Dados preservados', 'O Firebase falhou, mas o backup local foi salvo.', 'warning');
            return false;
        }
    }

    function hasOrganizerAccess() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('role') === 'organizador') {
            sessionStorage.setItem('copaPsyzonOrganizer', 'true');
            localStorage.setItem('copaRole', 'organizador');
        }
        return sessionStorage.getItem('copaPsyzonOrganizer') === 'true' || localStorage.getItem('copaRole') === 'organizador';
    }

    function checkOrganizerAccess(options = {}) {
        if (hasOrganizerAccess()) return true;
        if (options.prompt === false) return false;
        const password = prompt('Digite a senha do organizador:');
        if (password === ORGANIZER_PASSWORD || password === CRITICAL_ACTION_PASSWORD) {
            sessionStorage.setItem('copaPsyzonOrganizer', 'true');
            localStorage.setItem('copaRole', 'organizador');
            return true;
        }
        if (password !== null) alert('Senha incorreta.');
        return false;
    }

    function showNotesApp() {
        const lock = $('#notes-access-lock');
        const app = $('#notes-app');
        if (lock) lock.hidden = true;
        if (app) app.hidden = false;
    }

    function showAccessLock() {
        const lock = $('#notes-access-lock');
        const app = $('#notes-app');
        if (lock) lock.hidden = false;
        if (app) app.hidden = true;
    }

    function showToast(title, message = '', type = 'success') {
        const stack = $('#notes-toast-stack');
        if (!stack) return;
        const toast = document.createElement('div');
        const icon = type === 'error' ? 'ph-warning-circle' : type === 'warning' ? 'ph-warning' : 'ph-check-circle';
        toast.className = `notes-toast ${type}`;
        toast.innerHTML = `
            <i class="ph ${icon}"></i>
            <div>
                <strong>${escapeHtml(title)}</strong>
                ${message ? `<span>${escapeHtml(message)}</span>` : ''}
            </div>
        `;
        stack.appendChild(toast);
        window.setTimeout(() => toast.remove(), 3600);
    }

    function setFinanceNoteSaveStatus(text, saving = false) {
        const status = $('#notes-save-status');
        if (!status) return;
        status.textContent = text;
        status.classList.toggle('saving', saving);
    }

    function loadFinanceNotes() {
        const edition = getActiveEdition();
        financeiroState.financeNotes = normalizeFinanceNotes(financeiroState.financeNotes || edition.financeNotes, edition.notes || financeiroState.notas || '', edition.id);
        edition.financeNotes = financeiroState.financeNotes;
        return financeiroState.financeNotes;
    }

    function touchFinanceNotes() {
        const data = loadFinanceNotes();
        data.updatedAt = new Date().toISOString();
        getActiveEdition().updatedAt = data.updatedAt;
    }

    function getAllFinanceNotes(options = {}) {
        const includeDeleted = options.includeDeleted !== false;
        const includeArchived = options.includeArchived !== false;
        const data = loadFinanceNotes();
        return NOTE_TAB_IDS.flatMap((tab) => normalizeArray(data.tabs[tab]).map((note) => normalizeFinanceNote(note, tab)))
            .filter((note) => includeDeleted || !note.deleted)
            .filter((note) => includeArchived || !note.archived);
    }

    function findFinanceNote(noteId) {
        if (!noteId) return null;
        const data = loadFinanceNotes();
        for (const tab of NOTE_TAB_IDS) {
            const notes = data.tabs[tab] || [];
            const index = notes.findIndex((note) => note.id === noteId);
            if (index >= 0) return { note: notes[index], tab, index };
        }
        return null;
    }

    function getCurrentFinanceNote() {
        return findFinanceNote(ui.selectedNoteId)?.note || null;
    }

    function isFinanceNotesMobile() {
        return window.matchMedia('(max-width: 860px)').matches;
    }

    function checklistProgress(note) {
        const checklist = normalizeArray(note?.checklist);
        return {
            done: checklist.filter((item) => item.checked).length,
            total: checklist.length
        };
    }

    function isFinanceNoteClosed(note) {
        return ['Pago', 'Resolvido'].includes(note?.status);
    }

    function calculateNotesSummary(tab = ui.activeTab) {
        const scoped = getAllFinanceNotes({ includeDeleted: false, includeArchived: false }).filter((note) => note.tab === tab);
        const openNotes = scoped.filter((note) => !isFinanceNoteClosed(note));
        const completedNotes = scoped.filter(isFinanceNoteClosed);
        const totalValue = scoped.reduce((sum, note) => sum + toNumber(note.value), 0);
        const openValue = openNotes.reduce((sum, note) => sum + toNumber(note.value), 0);
        const completedValue = completedNotes.reduce((sum, note) => sum + toNumber(note.value), 0);
        const latest = scoped.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
        return {
            total: scoped.length,
            pending: openNotes.length,
            paidResolved: completedNotes.length,
            totalValue,
            openValue,
            completedValue,
            lastEdit: latest?.updatedAt || null
        };
    }

    function getVisibleFinanceNotes() {
        const query = normalizeText(ui.search, '').toLowerCase();
        const source = query
            ? getAllFinanceNotes()
            : getAllFinanceNotes().filter((note) => note.tab === ui.activeTab);

        return source
            .filter((note) => {
                if (ui.view === 'trash') return note.deleted;
                if (ui.view === 'archived') return note.archived && !note.deleted;
                return !note.archived && !note.deleted;
            })
            .filter((note) => {
                const haystack = [
                    note.title,
                    note.plainText,
                    note.status,
                    note.value ? formatCurrencyBRL(note.value) : '',
                    financeNoteTabLabel(note.tab)
                ].join(' ').toLowerCase();
                return !query || haystack.includes(query);
            })
            .filter((note) => {
                if (ui.filter === 'pending') return ['Pendente', 'Aberto', 'Em andamento'].includes(note.status);
                if (ui.filter === 'paid') return note.status === 'Pago';
                if (ui.filter === 'resolved') return note.status === 'Resolvido';
                if (ui.filter === 'with-value') return toNumber(note.value) > 0;
                if (ui.filter === 'recent') {
                    const updated = new Date(note.updatedAt || 0).getTime();
                    return Date.now() - updated <= 1000 * 60 * 60 * 24 * 14;
                }
                return true;
            })
            .sort((a, b) => {
                if (ui.view === 'active' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                if (ui.sort === 'old') return String(a.updatedAt).localeCompare(String(b.updatedAt));
                if (ui.sort === 'value-desc') return toNumber(b.value) - toNumber(a.value);
                if (ui.sort === 'value-asc') return toNumber(a.value) - toNumber(b.value);
                if (ui.sort === 'az') return a.title.localeCompare(b.title, 'pt-BR');
                if (ui.sort === 'za') return b.title.localeCompare(a.title, 'pt-BR');
                return String(b.updatedAt).localeCompare(String(a.updatedAt));
            });
    }

    function renderEditionControls() {
        const select = $('#notes-edition-select');
        if (!select) return;
        const currentValue = select.value || financeiroState.activeEditionId;
        select.innerHTML = financeiroState.edicoes.map((edition) => `
            <option value="${escapeAttr(edition.id)}">${escapeHtml(edition.name)}</option>
        `).join('');
        select.value = financeiroState.edicoes.some((edition) => edition.id === currentValue)
            ? currentValue
            : financeiroState.activeEditionId;
    }

    function renderFinanceNotesSummary() {
        const container = $('#notes-summary');
        if (!container) return;
        const summary = calculateNotesSummary(ui.activeTab);
        const lastEdit = summary.lastEdit ? new Date(summary.lastEdit).toLocaleString('pt-BR') : 'Sem edicoes';
        const cards = [
            ['Total de notas', String(summary.total)],
            ['Em aberto', `${summary.pending} - ${formatCurrencyBRL(summary.openValue)}`],
            ['Pago/resolvido', `${summary.paidResolved} - ${formatCurrencyBRL(summary.completedValue)}`],
            ['Total anotado', formatCurrencyBRL(summary.totalValue)],
            ['Ultima edicao', lastEdit]
        ];
        container.innerHTML = cards.map(([label, value]) => `
            <article class="notes-metric">
                <small>${escapeHtml(label)}</small>
                <strong>${escapeHtml(value)}</strong>
            </article>
        `).join('');
    }

    function renderFinanceNoteTabs() {
        const tabs = $('#note-tabs');
        if (!tabs) return;
        const notes = getAllFinanceNotes({ includeDeleted: false, includeArchived: false });
        tabs.innerHTML = NOTE_TABS.map((tab) => {
            const count = notes.filter((note) => note.tab === tab.id).length;
            return `
                <button type="button" class="${tab.id === ui.activeTab ? 'active' : ''}" data-note-tab="${escapeAttr(tab.id)}">
                    <i class="ph ${escapeAttr(tab.icon)}"></i>
                    ${escapeHtml(tab.label)}
                    <span>${count}</span>
                </button>
            `;
        }).join('');
    }

    function renderFinanceNoteList() {
        const list = $('#note-list');
        const title = $('#notes-list-title');
        const count = $('#notes-list-count');
        if (!list) return;

        const notes = getVisibleFinanceNotes();
        const selectedExists = ui.selectedNoteId && findFinanceNote(ui.selectedNoteId);
        if (!selectedExists) ui.selectedNoteId = null;
        if (!ui.selectedNoteId && notes.length && !isFinanceNotesMobile()) ui.selectedNoteId = notes[0].id;

        const viewTitle = ui.view === 'trash'
            ? 'Lixeira'
            : ui.view === 'archived'
                ? 'Arquivadas'
                : financeNoteTabLabel(ui.activeTab);
        if (title) title.textContent = viewTitle;
        if (count) count.textContent = `${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}`;

        $('#btn-note-archived')?.classList.toggle('active', ui.view === 'archived');
        $('#btn-note-trash')?.classList.toggle('active', ui.view === 'trash');

        if (!notes.length) {
            list.innerHTML = `
                <div class="notes-empty-list">
                    <i class="ph ph-note-blank"></i>
                    <strong>Nenhuma nota encontrada</strong>
                    <span>Crie uma nota nova ou ajuste a busca e os filtros.</span>
                </div>
            `;
            return;
        }

        list.innerHTML = notes.map((note) => {
            const progress = checklistProgress(note);
            const updated = new Date(note.updatedAt || note.createdAt).toLocaleDateString('pt-BR');
            return `
                <button type="button" class="note-item ${note.id === ui.selectedNoteId ? 'active' : ''}" data-note-id="${escapeAttr(note.id)}">
                    <div class="note-item-top">
                        <h3>${escapeHtml(note.title)}</h3>
                        <span class="note-icons">
                            ${note.pinned ? '<i class="ph ph-push-pin"></i>' : ''}
                            ${note.favorite ? '<i class="ph ph-star"></i>' : ''}
                        </span>
                    </div>
                    <p>${escapeHtml(note.plainText || 'Sem conteudo')}</p>
                    <div class="note-item-meta">
                        <span class="note-chip status-${financeNoteStatusSlug(note.status)}">${escapeHtml(note.status)}</span>
                        ${note.value ? `<span class="note-chip">${formatCurrencyBRL(note.value)}</span>` : ''}
                        ${progress.total ? `<span class="note-chip">${progress.done}/${progress.total}</span>` : ''}
                        <span class="note-chip">${escapeHtml(financeNoteTabLabel(note.tab))}</span>
                        <span class="note-chip">${updated}</span>
                    </div>
                </button>
            `;
        }).join('');

        window.requestAnimationFrame(() => {
            list.querySelector('.note-item.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    function updateEditorMetaProgress(note = getCurrentFinanceNote()) {
        const meta = $('#note-meta');
        if (meta && note) {
            meta.textContent = `Criada ${new Date(note.createdAt).toLocaleString('pt-BR')} | Editada ${new Date(note.updatedAt).toLocaleString('pt-BR')} | ${financeNoteTabLabel(note.tab)}`;
        }
        const progress = checklistProgress(note);
        const progressEl = $('#note-check-progress');
        if (progressEl) progressEl.textContent = `${progress.done} de ${progress.total} concluidos`;
    }

    function renderFinanceNoteEditor() {
        const empty = $('#note-empty-editor');
        const panel = $('#note-editor-panel');
        const shell = $('#notes-shell');
        const note = getCurrentFinanceNote();
        if (!empty || !panel) return;

        if (!note) {
            shell?.classList.remove('is-editor-open');
            empty.hidden = false;
            panel.hidden = true;
            return;
        }

        ui.isRenderingEditor = true;
        empty.hidden = true;
        panel.hidden = false;
        if (isFinanceNotesMobile()) shell?.classList.add('is-editor-open');

        $('#note-title').value = note.title;
        $('#note-status').value = note.status;
        $('#note-value').value = note.value ? formatCurrencyBRL(note.value) : '';
        $('#note-editor').innerHTML = note.content || '';
        updateEditorMetaProgress(note);

        $$('[data-note-action]').forEach((button) => {
            const action = button.dataset.noteAction;
            button.classList.toggle('is-active', (action === 'pin' && note.pinned) || (action === 'favorite' && note.favorite));
            if (action === 'archive') {
                button.title = note.archived || note.deleted ? 'Restaurar nota' : 'Arquivar';
                button.innerHTML = note.archived || note.deleted ? '<i class="ph ph-arrow-counter-clockwise"></i>' : '<i class="ph ph-archive"></i>';
            }
            if (action === 'delete') button.title = note.deleted ? 'Apagar definitivamente' : 'Excluir';
        });

        window.setTimeout(() => {
            ui.isRenderingEditor = false;
        }, 0);
    }

    function renderFinanceNotes() {
        loadFinanceNotes();
        renderEditionControls();
        renderFinanceNoteTabs();
        renderFinanceNotesSummary();
        renderFinanceNoteList();
        renderFinanceNoteEditor();
    }

    function syncCurrentFinanceNoteFromEditor() {
        if (ui.isRenderingEditor) return null;
        const found = findFinanceNote(ui.selectedNoteId);
        if (!found) return null;

        const title = normalizeText($('#note-title')?.value, 'Nova nota');
        const editor = $('#note-editor');
        const content = sanitizeFinanceNoteContent(editor?.innerHTML || '');
        const now = new Date().toISOString();

        found.note.title = title;
        found.note.content = content;
        found.note.plainText = htmlToPlainText(content);
        found.note.value = parseCurrency($('#note-value')?.value || '');
        found.note.status = normalizeFinanceNoteStatus($('#note-status')?.value || found.note.status);
        found.note.checklist = extractChecklistFromContent(content);
        found.note.updatedAt = now;
        touchFinanceNotes();
        return found.note;
    }

    function scheduleFinanceNotesAutoSave() {
        if (ui.isRenderingEditor) return;
        window.clearTimeout(ui.saveTimer);
        setFinanceNoteSaveStatus('Salvando...', true);
        const note = syncCurrentFinanceNoteFromEditor();
        updateEditorMetaProgress(note);
        ui.saveTimer = window.setTimeout(() => {
            saveFinanceNotes({ render: false, silent: true });
        }, 700);
    }

    async function saveFinanceNotes(options = {}) {
        if (options.syncEditor !== false) syncCurrentFinanceNoteFromEditor();
        touchFinanceNotes();
        financeiroState.financeNotes = normalizeFinanceNotes(financeiroState.financeNotes);

        try {
            await saveFinanceiroData({ render: false, silent: true });
            setFinanceNoteSaveStatus('Salvo automaticamente');
            window.clearTimeout(ui.saveStatusTimer);
            ui.saveStatusTimer = window.setTimeout(() => setFinanceNoteSaveStatus('Salvo automaticamente'), 900);

            if (options.render !== false) {
                renderFinanceNotes();
            } else {
                renderFinanceNoteTabs();
                renderFinanceNotesSummary();
                renderFinanceNoteList();
                updateEditorMetaProgress();
            }
            if (options.toast) showToast(options.toast, options.toastDetail || '');
            return true;
        } catch (error) {
            setFinanceNoteSaveStatus('Falha ao salvar');
            console.warn('Falha ao salvar notas:', error);
            if (!options.silent) showToast('Falha ao salvar notas', 'Os dados locais foram preservados.', 'warning');
            return false;
        }
    }

    async function createFinanceNote(tab = ui.activeTab) {
        syncCurrentFinanceNoteFromEditor();
        const data = loadFinanceNotes();
        const now = new Date().toISOString();
        const note = normalizeFinanceNote({
            id: createId('note'),
            title: 'Nova nota',
            content: '',
            tab: getFinanceNoteTab(tab),
            status: tab === 'pendencias' ? 'Pendente' : 'Aberto',
            createdAt: now,
            updatedAt: now
        }, tab);

        ui.view = 'active';
        ui.activeTab = note.tab;
        ui.selectedNoteId = note.id;
        data.tabs[note.tab].unshift(note);
        touchFinanceNotes();
        renderFinanceNotes();
        window.setTimeout(() => $('#note-title')?.focus(), 80);
        await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nova nota criada' });
    }

    async function updateFinanceNote(noteId, patch = {}, options = {}) {
        const found = findFinanceNote(noteId);
        if (!found) return null;
        const updated = normalizeFinanceNote({
            ...found.note,
            ...patch,
            id: found.note.id,
            tab: patch.tab || found.note.tab,
            createdAt: found.note.createdAt,
            updatedAt: new Date().toISOString()
        }, found.note.tab);
        loadFinanceNotes().tabs[found.tab][found.index] = updated;
        ui.selectedNoteId = updated.id;
        touchFinanceNotes();
        if (options.render !== false) renderFinanceNotes();
        if (options.save !== false) await saveFinanceNotes({ syncEditor: false, render: false, toast: options.toast });
        return updated;
    }

    async function duplicateFinanceNote(noteId = ui.selectedNoteId) {
        const found = findFinanceNote(noteId);
        if (!found) return;
        const now = new Date().toISOString();
        const duplicate = normalizeFinanceNote({
            ...found.note,
            id: createId('note'),
            title: `Copia de ${found.note.title}`,
            pinned: false,
            archived: false,
            deleted: false,
            createdAt: now,
            updatedAt: now
        }, found.note.tab);
        loadFinanceNotes().tabs[found.tab].splice(found.index + 1, 0, duplicate);
        ui.view = 'active';
        ui.selectedNoteId = duplicate.id;
        touchFinanceNotes();
        renderFinanceNotes();
        await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nota duplicada' });
    }

    async function restoreFinanceNote(noteId = ui.selectedNoteId) {
        const found = findFinanceNote(noteId);
        if (!found) return;
        found.note.archived = false;
        found.note.deleted = false;
        found.note.deletedAt = null;
        found.note.updatedAt = new Date().toISOString();
        ui.view = 'active';
        ui.activeTab = found.note.tab;
        ui.selectedNoteId = found.note.id;
        touchFinanceNotes();
        renderFinanceNotes();
        await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nota restaurada' });
    }

    async function archiveFinanceNote(noteId = ui.selectedNoteId) {
        const found = findFinanceNote(noteId);
        if (!found) return;
        if (found.note.deleted || found.note.archived) return restoreFinanceNote(noteId);
        found.note.archived = true;
        found.note.updatedAt = new Date().toISOString();
        touchFinanceNotes();
        if (ui.view === 'active') ui.selectedNoteId = null;
        renderFinanceNotes();
        await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nota arquivada' });
    }

    function confirmCriticalAction(message) {
        if (!confirm(message)) return false;
        const password = prompt('Digite a senha do organizador para confirmar:');
        if (password === CRITICAL_ACTION_PASSWORD || password === ORGANIZER_PASSWORD) return true;
        if (password !== null) alert('Senha incorreta.');
        return false;
    }

    async function deleteFinanceNote(noteId = ui.selectedNoteId) {
        const found = findFinanceNote(noteId);
        if (!found) return;
        if (found.note.deleted) {
            if (!confirmCriticalAction('Apagar definitivamente esta nota da lixeira?')) return;
            loadFinanceNotes().tabs[found.tab].splice(found.index, 1);
            ui.selectedNoteId = null;
            touchFinanceNotes();
            renderFinanceNotes();
            await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nota apagada definitivamente' });
            return;
        }

        if (!confirmCriticalAction('Mover esta nota para a lixeira?')) return;
        found.note.deleted = true;
        found.note.archived = false;
        found.note.deletedAt = new Date().toISOString();
        found.note.updatedAt = found.note.deletedAt;
        ui.selectedNoteId = null;
        touchFinanceNotes();
        renderFinanceNotes();
        await saveFinanceNotes({ syncEditor: false, render: false, toast: 'Nota enviada para a lixeira' });
    }

    async function clearFinanceNoteContent() {
        const note = getCurrentFinanceNote();
        if (!note) return;
        if (!confirmCriticalAction('Limpar todo o conteudo desta nota?')) return;
        await updateFinanceNote(note.id, { content: '', plainText: '', checklist: [] }, { toast: 'Conteudo limpo' });
    }

    function financeNoteText(note) {
        const progress = checklistProgress(note);
        return [
            `Titulo: ${note.title}`,
            `Categoria: ${financeNoteTabLabel(note.tab)}`,
            `Status: ${note.status}`,
            `Valor: ${note.value ? formatCurrencyBRL(note.value) : '-'}`,
            `Criada em: ${new Date(note.createdAt).toLocaleString('pt-BR')}`,
            `Ultima edicao: ${new Date(note.updatedAt).toLocaleString('pt-BR')}`,
            progress.total ? `Checklist: ${progress.done} de ${progress.total} concluidos` : '',
            '',
            note.plainText || 'Sem conteudo'
        ].filter((line) => line !== '').join('\n');
    }

    function financeNotesForScope(scope = 'current') {
        if (scope === 'current') {
            const note = getCurrentFinanceNote();
            return note ? [note] : [];
        }
        if (scope === 'tab') {
            return getAllFinanceNotes({ includeDeleted: false })
                .filter((note) => note.tab === ui.activeTab);
        }
        return getAllFinanceNotes({ includeDeleted: false });
    }

    function buildFinanceNotesText(scope = 'current') {
        const edition = getActiveEdition();
        const notes = financeNotesForScope(scope);
        return [
            'COPA PSYZON - NOTAS FINANCEIRAS',
            `Edicao: ${edition.name}`,
            `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
            '',
            ...notes.map((note, index) => [
                `--- NOTA ${index + 1} ---`,
                financeNoteText(note)
            ].join('\n'))
        ].join('\n');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function asciiPdfText(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7E]/g, '');
    }

    function escapePdfText(text) {
        return asciiPdfText(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function wrapPdfLines(text, width = 88) {
        const lines = [];
        String(text || '').split('\n').forEach((line) => {
            const words = asciiPdfText(line).split(/\s+/).filter(Boolean);
            if (!words.length) {
                lines.push('');
                return;
            }
            let current = '';
            words.forEach((word) => {
                if ((current + ' ' + word).trim().length > width) {
                    lines.push(current);
                    current = word;
                    return;
                }
                current = `${current} ${word}`.trim();
            });
            if (current) lines.push(current);
        });
        return lines;
    }

    function buildFinanceNotesPdf(lines) {
        const pageLines = [];
        const wrapped = wrapPdfLines(lines.join('\n'));
        for (let i = 0; i < wrapped.length; i += 40) pageLines.push(wrapped.slice(i, i + 40));
        if (!pageLines.length) pageLines.push(['Sem notas para exportar.']);

        const objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
        objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

        const kids = [];
        let objectNumber = 5;
        pageLines.forEach((page, index) => {
            const contentId = objectNumber++;
            const pageId = objectNumber++;
            kids.push(`${pageId} 0 R`);
            const textLines = page.map((line, lineIndex) => {
                const y = 724 - (lineIndex * 15);
                return `1 0 0 1 48 ${y} Tm (${escapePdfText(line)}) Tj`;
            });
            const content = [
                '0.03 0.33 0.22 rg',
                '0 792 595 50 re f',
                '0.98 0.80 0.08 rg',
                '0 786 595 6 re f',
                'BT',
                '1 1 1 rg',
                '/F2 18 Tf',
                '1 0 0 1 48 810 Tm (COPA PSYZON - Notas Financeiras) Tj',
                '/F1 9 Tf',
                `1 0 0 1 48 796 Tm (Pagina ${index + 1} de ${pageLines.length}) Tj`,
                '0.05 0.09 0.16 rg',
                '/F1 10 Tf',
                ...textLines,
                'ET'
            ].join('\n');
            objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
            objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
        });
        objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        for (let i = 1; i < objects.length; i++) {
            offsets[i] = pdf.length;
            pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
        }
        const xref = pdf.length;
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let i = 1; i < objects.length; i++) {
            pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        return new Blob([pdf], { type: 'application/pdf' });
    }

    async function exportFinanceNotes(scope = $('#note-export-scope')?.value || 'current', format = 'txt') {
        await saveFinanceNotes({ render: false, silent: true });
        const date = todayInputValue();
        const notes = financeNotesForScope(scope);
        if (!notes.length && format !== 'json') {
            showToast('Nada para exportar', 'Crie ou selecione uma nota primeiro.', 'warning');
            return;
        }

        if (format === 'json') {
            const payload = {
                app: 'copa-psyzon-financeiro-notas',
                exportedAt: new Date().toISOString(),
                edition: { id: getActiveEdition().id, name: getActiveEdition().name },
                scope,
                financeNotes: loadFinanceNotes()
            };
            downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), `copa-psyzon-financeiro-backup-${date}.json`);
            showToast('Backup JSON exportado');
            return;
        }

        const text = buildFinanceNotesText(scope);
        if (format === 'copy') {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                showToast('Nota copiada', 'Conteudo enviado para a area de transferencia.');
            } else {
                showToast('Copia indisponivel', 'O navegador bloqueou a area de transferencia.', 'warning');
            }
            return;
        }

        if (format === 'pdf') {
            downloadBlob(buildFinanceNotesPdf(text.split('\n')), `copa-psyzon-financeiro-notas-${date}.pdf`);
            showToast('PDF exportado');
            return;
        }

        downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `copa-psyzon-financeiro-notas-${date}.txt`);
        showToast('TXT exportado');
    }

    function extractImportedFinanceNotes(parsed) {
        if (parsed?.financeNotes || parsed?.notasFinanceiras) return parsed.financeNotes || parsed.notasFinanceiras;
        if (parsed?.tabs) return parsed;
        if (Array.isArray(parsed?.edicoes)) {
            const targetId = parsed.activeEditionId || parsed.edicoes[0]?.id;
            const edition = parsed.edicoes.find((item) => item.id === targetId) || parsed.edicoes[0];
            return edition?.financeNotes || edition?.notasFinanceiras || {};
        }
        return parsed;
    }

    async function importFinanceNotes(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const imported = normalizeFinanceNotes(extractImportedFinanceNotes(parsed));
            const choice = normalizeText(prompt('Importar backup: digite "substituir", "mesclar" ou "cancelar".'), '').toLowerCase();
            if (!choice || choice === 'cancelar') return;
            if (!['substituir', 'mesclar'].includes(choice)) {
                showToast('Importacao cancelada', 'Opcao invalida.', 'warning');
                return;
            }
            if (choice === 'substituir' && !confirmCriticalAction('Substituir todas as notas atuais por este backup?')) return;

            financeiroState.financeNotes = choice === 'substituir'
                ? imported
                : mergeFinanceNotes(loadFinanceNotes(), imported);
            ui.view = 'active';
            ui.selectedNoteId = null;
            renderFinanceNotes();
            await saveFinanceNotes({ syncEditor: false, render: false, toast: choice === 'substituir' ? 'Backup importado' : 'Backup mesclado' });
        } catch (error) {
            console.warn('Falha ao importar notas:', error);
            showToast('Backup invalido', 'Confira se o arquivo JSON foi exportado pelo Notas.', 'error');
        } finally {
            if (event?.target) event.target.value = '';
        }
    }

    function insertHtmlAtFinanceEditor(html) {
        const editor = $('#note-editor');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, html);
        scheduleFinanceNotesAutoSave();
    }

    function insertChecklistItem() {
        const id = createId('chk');
        insertHtmlAtFinanceEditor(`<div class="note-check" data-checked="false" data-check-id="${id}"><span class="note-check-box" contenteditable="false"></span><span class="note-check-text">Nova tarefa</span></div>`);
    }

    function handleFinanceNoteToolbar(event) {
        const button = event.target.closest('button');
        if (!button) return;
        const command = button.dataset.noteCommand;
        const format = button.dataset.noteFormat;
        const insert = button.dataset.noteInsert;
        const editor = $('#note-editor');
        if (!editor || editor.hidden) return;
        editor.focus();

        if (command) {
            document.execCommand(command, false, null);
            scheduleFinanceNotesAutoSave();
            updateToolbarState();
            return;
        }

        if (format) {
            document.execCommand('formatBlock', false, format);
            scheduleFinanceNotesAutoSave();
            return;
        }

        if (insert === 'checklist') return insertChecklistItem();
        if (insert === 'hr') return insertHtmlAtFinanceEditor('<hr><p><br></p>');
        if (insert === 'date') return insertHtmlAtFinanceEditor(new Date().toLocaleDateString('pt-BR'));
        if (insert === 'time') return insertHtmlAtFinanceEditor(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        if (insert === 'highlight') {
            document.execCommand('hiliteColor', false, '#fef08a');
            scheduleFinanceNotesAutoSave();
            return;
        }
        if (insert === 'money') {
            const raw = prompt('Valor em R$:');
            const value = parseCurrency(raw);
            if (!value) return;
            const formatted = formatCurrencyBRL(value);
            const input = $('#note-value');
            if (input) input.value = formatted;
            insertHtmlAtFinanceEditor(formatted);
            return;
        }
        if (insert === 'pending') {
            const selection = window.getSelection()?.toString() || 'Pendencia';
            const note = getCurrentFinanceNote();
            if (note) {
                note.status = 'Pendente';
                const status = $('#note-status');
                if (status) status.value = 'Pendente';
            }
            insertHtmlAtFinanceEditor(`<div class="note-pending-line">Pendencia: ${escapeHtml(selection)}</div>`);
        }
    }

    function handleFinanceNoteEditorClick(event) {
        const checkbox = event.target.closest('.note-check-box');
        if (!checkbox) return;
        const item = checkbox.closest('.note-check');
        if (!item) return;
        item.dataset.checked = item.dataset.checked === 'true' ? 'false' : 'true';
        scheduleFinanceNotesAutoSave();
    }

    function handleFinanceNotePaste(event) {
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
        scheduleFinanceNotesAutoSave();
    }

    function handleCurrencyInput(event) {
        const input = event.currentTarget;
        const digits = input.value.replace(/\D/g, '');
        input.value = digits ? formatCurrencyBRL(Number(digits) / 100) : '';
    }

    function preventNegativeValue(event) {
        if (event.key === '-' || event.key === '+') event.preventDefault();
    }

    function selectFinanceNote(noteId) {
        syncCurrentFinanceNoteFromEditor();
        const found = findFinanceNote(noteId);
        if (!found) return;
        ui.selectedNoteId = noteId;
        ui.activeTab = found.note.tab;
        renderFinanceNotes();
    }

    async function handleFinanceNoteAction(event) {
        const button = event.target.closest('[data-note-action]');
        if (!button) return;
        const note = getCurrentFinanceNote();
        if (!note) return;
        const action = button.dataset.noteAction;
        if (action === 'pin') return updateFinanceNote(note.id, { pinned: !note.pinned }, { toast: note.pinned ? 'Nota desafixada' : 'Nota fixada' });
        if (action === 'favorite') return updateFinanceNote(note.id, { favorite: !note.favorite }, { toast: note.favorite ? 'Favorito removido' : 'Nota favoritada' });
        if (action === 'duplicate') return duplicateFinanceNote(note.id);
        if (action === 'archive') return archiveFinanceNote(note.id);
        if (action === 'delete') return deleteFinanceNote(note.id);
        if (action === 'copy') return exportFinanceNotes('current', 'copy');
        if (action === 'exportCurrent') return exportFinanceNotes('current', 'txt');
        if (action === 'clearContent') return clearFinanceNoteContent();
    }

    async function switchEdition(editionId) {
        if (!editionId || editionId === financeiroState.activeEditionId) return;
        await saveFinanceNotes({ render: false, silent: true });
        financeiroState.activeEditionId = editionId;
        loadActiveEditionToRoot();
        ui.activeTab = 'geral';
        ui.selectedNoteId = null;
        ui.view = 'active';
        renderFinanceNotes();
        await saveFinanceiroData({ render: false, silent: true });
    }

    function updateToolbarState() {
        const commands = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight'];
        $$('[data-note-command]').forEach((button) => {
            const command = button.dataset.noteCommand;
            if (!commands.includes(command)) return;
            let active = false;
            try {
                active = document.queryCommandState(command);
            } catch (error) {
                active = false;
            }
            button.classList.toggle('is-active', active);
        });
    }

    function initFinanceNotes() {
        if (initialized) return;
        initialized = true;
        $('#btn-note-new')?.addEventListener('click', () => createFinanceNote());
        $('#btn-note-import')?.addEventListener('click', () => $('#note-import-file')?.click());
        $('#note-import-file')?.addEventListener('change', importFinanceNotes);
        $('#btn-note-export')?.addEventListener('click', (event) => {
            event.stopPropagation();
            const popover = $('#note-export-popover');
            if (popover) popover.hidden = !popover.hidden;
        });
        $('#note-export-popover')?.addEventListener('click', (event) => {
            event.stopPropagation();
            const button = event.target.closest('[data-note-export-format]');
            if (!button) return;
            exportFinanceNotes($('#note-export-scope')?.value || 'current', button.dataset.noteExportFormat);
            $('#note-export-popover').hidden = true;
        });
        document.addEventListener('click', () => {
            const popover = $('#note-export-popover');
            if (popover) popover.hidden = true;
        });
        $('#btn-note-archived')?.addEventListener('click', () => {
            ui.view = ui.view === 'archived' ? 'active' : 'archived';
            ui.selectedNoteId = null;
            renderFinanceNotes();
        });
        $('#btn-note-trash')?.addEventListener('click', () => {
            ui.view = ui.view === 'trash' ? 'active' : 'trash';
            ui.selectedNoteId = null;
            renderFinanceNotes();
        });
        $('#note-search')?.addEventListener('input', (event) => {
            ui.search = event.target.value;
            renderFinanceNoteList();
            renderFinanceNoteEditor();
        });
        $('#note-filter')?.addEventListener('change', (event) => {
            ui.filter = event.target.value;
            renderFinanceNoteList();
            renderFinanceNoteEditor();
        });
        $('#note-sort')?.addEventListener('change', (event) => {
            ui.sort = event.target.value;
            renderFinanceNoteList();
        });
        $('#note-tabs')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-note-tab]');
            if (!button) return;
            syncCurrentFinanceNoteFromEditor();
            ui.activeTab = button.dataset.noteTab;
            ui.view = 'active';
            ui.selectedNoteId = null;
            renderFinanceNotes();
        });
        $('#note-list')?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-note-id]');
            if (item) selectFinanceNote(item.dataset.noteId);
        });
        $('#note-title')?.addEventListener('input', scheduleFinanceNotesAutoSave);
        $('#note-status')?.addEventListener('change', scheduleFinanceNotesAutoSave);
        $('#note-value')?.addEventListener('input', (event) => {
            handleCurrencyInput(event);
            scheduleFinanceNotesAutoSave();
        });
        $('#note-value')?.addEventListener('keydown', preventNegativeValue);
        $('#note-editor')?.addEventListener('input', scheduleFinanceNotesAutoSave);
        $('#note-editor')?.addEventListener('click', handleFinanceNoteEditorClick);
        $('#note-editor')?.addEventListener('paste', handleFinanceNotePaste);
        $('#note-editor')?.addEventListener('keyup', updateToolbarState);
        $('#note-editor')?.addEventListener('mouseup', updateToolbarState);
        $('#note-toolbar')?.addEventListener('click', handleFinanceNoteToolbar);
        $('#note-editor-actions')?.addEventListener('click', handleFinanceNoteAction);
        $('#btn-note-back')?.addEventListener('click', () => $('#notes-shell')?.classList.remove('is-editor-open'));
        $('#notes-edition-select')?.addEventListener('change', (event) => switchEdition(event.target.value));
        $('#btn-notes-logout')?.addEventListener('click', () => {
            sessionStorage.removeItem('copaPsyzonOrganizer');
            localStorage.setItem('copaRole', 'visitante');
            window.location.href = './financeiro.html';
        });
        document.addEventListener('selectionchange', () => {
            if (document.activeElement === $('#note-editor')) updateToolbarState();
        });
    }

    async function bootstrapNotes() {
        showNotesApp();
        initFinanceNotes();
        financeiroState = readLocalFinanceiroData();
        loadActiveEditionToRoot();
        renderFinanceNotes();
        await initFirebaseConnection();
        await loadFinanceiroData();
        renderFinanceNotes();
    }

    function initNotesPage() {
        $('#btn-notes-unlock')?.addEventListener('click', () => {
            if (checkOrganizerAccess({ prompt: true })) bootstrapNotes();
        });

        if (!checkOrganizerAccess({ prompt: false })) {
            showAccessLock();
            return;
        }

        bootstrapNotes();
    }

    document.addEventListener('DOMContentLoaded', initNotesPage);

    Object.assign(window, {
        initFinanceNotes,
        renderFinanceNotes,
        renderFinanceNoteTabs,
        renderFinanceNoteList,
        renderFinanceNoteEditor,
        createFinanceNote,
        updateFinanceNote,
        deleteFinanceNote,
        duplicateFinanceNote,
        archiveFinanceNote,
        restoreFinanceNote,
        exportFinanceNotes,
        importFinanceNotes,
        saveFinanceNotes,
        loadFinanceNotes,
        migrateOldFinanceNotes,
        formatCurrencyBRL,
        insertChecklistItem,
        calculateNotesSummary
    });
})();
