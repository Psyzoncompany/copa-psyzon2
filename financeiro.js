(function () {
    'use strict';

    const ORGANIZER_PASSWORD = 'guiro';
    const STORAGE_KEY = 'copaPsyzonFinanceiro';
    const FIREBASE_PATH = 'financeiro';
    const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const MONEY_FORMATTER = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });

    const MOVEMENT_TYPES = [
        'Receita',
        'Despesa',
        'Patrocínio recebido',
        'Pagamento de participante',
        'Dinheiro emprestado recebido',
        'Dinheiro emprestado para alguém',
        'Pagamento de dívida',
        'Reembolso recebido',
        'Reembolso pago',
        'Outro'
    ];

    const CATEGORIES = [
        'Alimentação',
        'Bebidas',
        'Premiação',
        'Estrutura',
        'Equipamentos',
        'Divulgação',
        'Design/Marketing',
        'Transporte',
        'Aluguel',
        'Patrocinador',
        'Inscrição de participante',
        'Empréstimo',
        'Outros'
    ];

    const PAYMENT_METHODS = ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'];
    const INCOME_TYPES = new Set([
        'Receita',
        'Patrocínio recebido',
        'Pagamento de participante',
        'Dinheiro emprestado recebido',
        'Reembolso recebido',
        'Outro'
    ]);
    const EXPENSE_TYPES = new Set([
        'Despesa',
        'Dinheiro emprestado para alguém',
        'Pagamento de dívida',
        'Reembolso pago'
    ]);
    const REAL_INCOME_EXCLUDED = new Set(['Dinheiro emprestado recebido']);
    const REAL_EXPENSE_EXCLUDED = new Set(['Dinheiro emprestado para alguém', 'Pagamento de dívida']);

    const firebaseConfig = {
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
    let financeiroInitialized = false;
    let latestTotals = calculateFinanceiroTotals();
    let participantOptions = [];

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function createDefaultFinanceiroData() {
        return {
            movimentacoes: [],
            patrocinadores: [],
            participantesPagos: [],
            emprestimos: [],
            updatedAt: new Date().toISOString()
        };
    }

    function createId(prefix) {
        const random = Math.random().toString(36).slice(2, 10);
        return `${prefix}_${Date.now().toString(36)}_${random}`;
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

    function toNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.abs(number) : 0;
    }

    function normalizeArray(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') return Object.values(value);
        return [];
    }

    function normalizeStatus(status) {
        const value = normalizeText(status, 'Pago');
        if (['Pago', 'Pendente', 'Cancelado'].includes(value)) return value;
        if (['Parcial', 'Aberto', 'Recebido'].includes(value)) return value;
        return 'Pago';
    }

    function normalizeMovement(raw = {}) {
        const createdAt = raw.createdAt || new Date().toISOString();
        return {
            id: raw.id || createId('mov'),
            type: MOVEMENT_TYPES.includes(raw.type) ? raw.type : normalizeText(raw.type, 'Receita'),
            category: CATEGORIES.includes(raw.category) ? raw.category : normalizeText(raw.category, 'Outros'),
            description: normalizeText(raw.description || raw.descricao, 'Movimentação'),
            value: toNumber(raw.value ?? raw.valor),
            date: raw.date || raw.data || todayInputValue(),
            paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : normalizeText(raw.paymentMethod || raw.formaPagamento, 'Pix'),
            status: normalizeStatus(raw.status),
            person: normalizeText(raw.person || raw.pessoa || raw.company, ''),
            notes: normalizeText(raw.notes || raw.observacoes, ''),
            source: raw.source || null,
            sourceId: raw.sourceId || null,
            createdAt,
            updatedAt: raw.updatedAt || createdAt
        };
    }

    function normalizeSponsor(raw = {}) {
        const createdAt = raw.createdAt || new Date().toISOString();
        return {
            id: raw.id || createId('pat'),
            name: normalizeText(raw.name || raw.nome, 'Patrocinador'),
            promisedValue: toNumber(raw.promisedValue ?? raw.valorPrometido),
            paidValue: toNumber(raw.paidValue ?? raw.valorPago),
            status: ['Pago', 'Parcial', 'Pendente'].includes(raw.status) ? raw.status : 'Pendente',
            paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : normalizeText(raw.paymentMethod || raw.formaPagamento, 'Pix'),
            date: raw.date || raw.data || todayInputValue(),
            observation: normalizeText(raw.observation || raw.observacao, ''),
            createdAt,
            updatedAt: raw.updatedAt || createdAt
        };
    }

    function normalizePaidParticipant(raw = {}) {
        const createdAt = raw.createdAt || new Date().toISOString();
        return {
            id: raw.id || createId('part'),
            name: normalizeText(raw.name || raw.nome, 'Participante'),
            game: normalizeText(raw.game || raw.jogo, 'FIFA'),
            value: toNumber(raw.value ?? raw.valorPago),
            date: raw.date || raw.data || todayInputValue(),
            status: ['Pago', 'Pendente'].includes(raw.status) ? raw.status : 'Pago',
            paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : normalizeText(raw.paymentMethod || raw.formaPagamento, 'Pix'),
            createdAt,
            updatedAt: raw.updatedAt || createdAt
        };
    }

    function normalizeLoan(raw = {}) {
        const createdAt = raw.createdAt || new Date().toISOString();
        const direction = raw.direction === 'concedido' ? 'concedido' : 'recebido';
        const fallbackStatus = direction === 'concedido' ? 'Aberto' : 'Aberto';
        return {
            id: raw.id || createId('emp'),
            direction,
            name: normalizeText(raw.name || raw.nome || raw.person, direction === 'recebido' ? 'Credor' : 'Pessoa'),
            value: toNumber(raw.value ?? raw.valor),
            date: raw.date || raw.data || todayInputValue(),
            status: normalizeText(raw.status, fallbackStatus),
            observation: normalizeText(raw.observation || raw.observacoes, ''),
            createdAt,
            updatedAt: raw.updatedAt || createdAt
        };
    }

    function normalizeFinanceiroData(raw = {}) {
        const base = createDefaultFinanceiroData();
        return {
            movimentacoes: normalizeArray(raw.movimentacoes).map(normalizeMovement),
            patrocinadores: normalizeArray(raw.patrocinadores).map(normalizeSponsor),
            participantesPagos: normalizeArray(raw.participantesPagos).map(normalizePaidParticipant),
            emprestimos: normalizeArray(raw.emprestimos).map(normalizeLoan),
            updatedAt: raw.updatedAt || base.updatedAt
        };
    }

    function newestItem(a, b) {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime >= aTime ? b : a;
    }

    function mergeArrayById(localItems, remoteItems, normalizer) {
        const map = new Map();
        localItems.map(normalizer).forEach((item) => map.set(item.id, item));
        remoteItems.map(normalizer).forEach((item) => {
            const current = map.get(item.id);
            map.set(item.id, current ? newestItem(current, item) : item);
        });
        return Array.from(map.values());
    }

    function mergeFinanceiroData(localData, remoteData) {
        const local = normalizeFinanceiroData(localData);
        const remote = normalizeFinanceiroData(remoteData);
        const localTime = new Date(local.updatedAt || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || 0).getTime();

        return {
            movimentacoes: mergeArrayById(local.movimentacoes, remote.movimentacoes, normalizeMovement),
            patrocinadores: mergeArrayById(local.patrocinadores, remote.patrocinadores, normalizeSponsor),
            participantesPagos: mergeArrayById(local.participantesPagos, remote.participantesPagos, normalizePaidParticipant),
            emprestimos: mergeArrayById(local.emprestimos, remote.emprestimos, normalizeLoan),
            updatedAt: new Date(Math.max(localTime, remoteTime, Date.now())).toISOString()
        };
    }

    function formatCurrency(value) {
        return MONEY_FORMATTER.format(Number(value) || 0);
    }

    function parseCurrency(value) {
        if (typeof value === 'number') return Math.abs(value);
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const digits = raw.replace(/\D/g, '');
        if (!digits) return 0;
        return Number(digits) / 100;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return '-';
        return DATE_FORMATTER.format(date);
    }

    function getMovementDirection(movement) {
        if (EXPENSE_TYPES.has(movement.type)) return 'expense';
        if (INCOME_TYPES.has(movement.type)) return 'income';
        return 'neutral';
    }

    function statusClass(status) {
        const normalized = String(status || '').toLowerCase();
        if (normalized === 'pago' || normalized === 'recebido') return 'financeiro-status-paid';
        if (normalized === 'pendente') return 'financeiro-status-pending';
        if (normalized === 'cancelado') return 'financeiro-status-canceled';
        if (normalized === 'parcial') return 'financeiro-status-partial';
        return 'financeiro-status-open';
    }

    function updateSyncStatus(text, mode = 'info') {
        const el = $('#financeiro-sync-status');
        if (!el) return;
        el.textContent = text;
        el.dataset.mode = mode;
    }

    function showToast(title, message = '', type = 'success') {
        const stack = $('#financeiro-toast-stack');
        if (!stack) return;
        const toast = document.createElement('div');
        const icon = type === 'error' ? 'ph-warning-circle' : type === 'warning' ? 'ph-warning' : 'ph-check-circle';
        toast.className = `financeiro-toast ${type}`;
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

    function checkOrganizerAccess(options = {}) {
        const promptForPassword = options.prompt !== false;
        const sessionAllowed = sessionStorage.getItem('copaPsyzonOrganizer') === 'true';
        if (sessionAllowed) return true;

        if (!promptForPassword) return false;

        const password = window.prompt('Digite a senha do financeiro/organizador:');
        if (password === ORGANIZER_PASSWORD) {
            sessionStorage.setItem('copaPsyzonOrganizer', 'true');
            localStorage.setItem('copaRole', 'organizador');
            return true;
        }

        if (password !== null) {
            alert('Senha incorreta.');
        }
        return false;
    }

    function showFinanceiroOnlyForOrganizer() {
        const allowed = sessionStorage.getItem('copaPsyzonOrganizer') === 'true' || localStorage.getItem('copaRole') === 'organizador';
        $$('[data-financeiro-restricted]').forEach((element) => {
            element.hidden = !allowed;
        });
        return allowed;
    }

    function showAccessLock() {
        const lock = $('#financeiro-access-lock');
        const app = $('#financeiro-app');
        if (lock) lock.hidden = false;
        if (app) app.hidden = true;
    }

    function showFinanceiroApp() {
        const lock = $('#financeiro-access-lock');
        const app = $('#financeiro-app');
        if (lock) lock.hidden = true;
        if (app) app.hidden = false;
    }

    function readLocalFinanceiroData() {
        try {
            return normalizeFinanceiroData(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
        } catch (error) {
            console.warn('Não foi possível ler o financeiro local:', error);
            return createDefaultFinanceiroData();
        }
    }

    function writeLocalFinanceiroData() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(financeiroState));
    }

    async function initFirebaseConnection() {
        updateSyncStatus('conectando Firebase...');
        try {
            const [appModule, databaseModule] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js')
            ]);
            const existing = appModule.getApps().find((app) => app.name === 'copaPsyzonFinanceiro');
            const app = existing || appModule.initializeApp(firebaseConfig, 'copaPsyzonFinanceiro');
            const db = databaseModule.getDatabase(app);
            firebaseApi = {
                db,
                ref: databaseModule.ref,
                get: databaseModule.get,
                set: databaseModule.set
            };
            updateSyncStatus('Firebase pronto', 'online');
            return true;
        } catch (error) {
            firebaseApi = null;
            updateSyncStatus('Firebase offline, usando localStorage', 'offline');
            console.warn('Firebase financeiro indisponível:', error);
            return false;
        }
    }

    async function loadFinanceiroData() {
        const localData = readLocalFinanceiroData();
        financeiroState = normalizeFinanceiroData(localData);
        renderAllFinanceiro();

        if (!firebaseApi) return financeiroState;

        try {
            const snapshot = await firebaseApi.get(firebaseApi.ref(firebaseApi.db, FIREBASE_PATH));
            const remoteData = snapshot.exists() ? snapshot.val() : createDefaultFinanceiroData();
            financeiroState = mergeFinanceiroData(localData, remoteData);
            writeLocalFinanceiroData();
            await saveFinanceiroData({ render: true, silent: true });
            updateSyncStatus('sincronizado com Firebase', 'online');
        } catch (error) {
            updateSyncStatus('Firebase falhou, dados locais preservados', 'offline');
            console.warn('Falha ao carregar financeiro no Firebase:', error);
        }

        return financeiroState;
    }

    async function saveFinanceiroData(options = {}) {
        const shouldRender = options.render !== false;
        financeiroState.updatedAt = new Date().toISOString();
        writeLocalFinanceiroData();

        if (shouldRender) renderAllFinanceiro();
        if (options.toast) showToast(options.toast, options.toastDetail || '');

        if (!firebaseApi) {
            updateSyncStatus('salvo no localStorage', 'offline');
            return;
        }

        try {
            await firebaseApi.set(firebaseApi.ref(firebaseApi.db, FIREBASE_PATH), financeiroState);
            updateSyncStatus('salvo no Firebase e localStorage', 'online');
        } catch (error) {
            updateSyncStatus('Firebase falhou, salvo localmente', 'offline');
            console.warn('Falha ao salvar financeiro no Firebase:', error);
            if (!options.silent) showToast('Dados preservados no navegador', 'O Firebase falhou, mas nada foi perdido.', 'warning');
        }
    }

    async function loadExistingParticipants() {
        if (!firebaseApi) return;
        try {
            const snapshot = await firebaseApi.get(firebaseApi.ref(firebaseApi.db, 'participants'));
            const names = [];
            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    const data = child.val() || {};
                    const name = normalizeText(data.name || data.nome, '');
                    if (name) names.push(name);
                });
            }
            participantOptions = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
            renderDatalists();
        } catch (error) {
            console.warn('Não foi possível integrar participantes existentes:', error);
        }
    }

    function renderDatalists() {
        const participantList = $('#financeiro-participantes-list');
        const peopleList = $('#financeiro-pessoas-list');
        const names = new Set(participantOptions);

        financeiroState.participantesPagos.forEach((item) => names.add(item.name));
        financeiroState.patrocinadores.forEach((item) => names.add(item.name));
        financeiroState.emprestimos.forEach((item) => names.add(item.name));
        financeiroState.movimentacoes.forEach((item) => {
            if (item.person) names.add(item.person);
        });

        const html = Array.from(names)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .map((name) => `<option value="${escapeAttr(name)}"></option>`)
            .join('');

        if (participantList) {
            participantList.innerHTML = participantOptions
                .map((name) => `<option value="${escapeAttr(name)}"></option>`)
                .join('');
        }
        if (peopleList) peopleList.innerHTML = html;
    }

    function calculateFinanceiroTotals() {
        const totals = {
            totalRecebido: 0,
            totalGasto: 0,
            saldoAtual: 0,
            lucroPrejuizo: 0,
            receitasReais: 0,
            despesasReais: 0,
            patrocinioRecebido: 0,
            participantesPagosValor: 0,
            participantesPagos: 0,
            emprestimosRecebidos: 0,
            emprestimosConcedidos: 0,
            pendenciasReceber: 0,
            pendenciasPagar: 0,
            saldoSemEmprestimos: 0
        };

        const paidParticipants = new Set();
        const hasSourceMovement = (source, sourceId) => financeiroState.movimentacoes
            .some((movement) => movement.source === source && movement.sourceId === sourceId);

        financeiroState.movimentacoes.map(normalizeMovement).forEach((movement) => {
            const direction = getMovementDirection(movement);
            const value = toNumber(movement.value);
            if (!value || movement.status === 'Cancelado' || direction === 'neutral') return;

            if (movement.status === 'Pendente') {
                if (direction === 'income') totals.pendenciasReceber += value;
                if (direction === 'expense') totals.pendenciasPagar += value;
                return;
            }

            if (movement.status !== 'Pago') return;

            if (direction === 'income') {
                totals.totalRecebido += value;
                if (!REAL_INCOME_EXCLUDED.has(movement.type)) totals.receitasReais += value;
            }

            if (direction === 'expense') {
                totals.totalGasto += value;
                if (!REAL_EXPENSE_EXCLUDED.has(movement.type)) totals.despesasReais += value;
            }

            if (movement.type === 'Patrocínio recebido') totals.patrocinioRecebido += value;
            if (movement.type === 'Pagamento de participante') {
                totals.participantesPagosValor += value;
                paidParticipants.add((movement.person || movement.description).toLowerCase());
            }
            if (movement.type === 'Dinheiro emprestado recebido') totals.emprestimosRecebidos += value;
            if (movement.type === 'Dinheiro emprestado para alguém') totals.emprestimosConcedidos += value;
        });

        financeiroState.patrocinadores.map(normalizeSponsor).forEach((sponsor) => {
            const pending = Math.max(toNumber(sponsor.promisedValue) - toNumber(sponsor.paidValue), 0);
            if (sponsor.status !== 'Pago') totals.pendenciasReceber += pending;
        });

        financeiroState.participantesPagos.map(normalizePaidParticipant).forEach((participant) => {
            if (participant.status === 'Pago') paidParticipants.add(participant.name.toLowerCase());
            if (participant.status === 'Pendente' && !hasSourceMovement('participantePago', participant.id)) {
                totals.pendenciasReceber += toNumber(participant.value);
            }
        });

        financeiroState.emprestimos.map(normalizeLoan).forEach((loan) => {
            const open = !['Pago', 'Recebido'].includes(loan.status);
            if (!open) return;
            if (loan.direction === 'recebido') totals.pendenciasPagar += toNumber(loan.value);
            if (loan.direction === 'concedido') totals.pendenciasReceber += toNumber(loan.value);
        });

        totals.participantesPagos = paidParticipants.size;
        totals.saldoAtual = totals.totalRecebido - totals.totalGasto;
        totals.lucroPrejuizo = totals.receitasReais - totals.despesasReais;
        totals.saldoSemEmprestimos = totals.saldoAtual - totals.emprestimosRecebidos + totals.emprestimosConcedidos;

        return totals;
    }

    function renderFinanceiroDashboard() {
        latestTotals = calculateFinanceiroTotals();
        const grid = $('#financeiro-summary-grid');
        const saldo = $('#financeiro-saldo-geral');
        const saldoReal = $('#financeiro-saldo-real');

        if (saldo) saldo.textContent = formatCurrency(latestTotals.saldoAtual);
        if (saldoReal) saldoReal.textContent = `Sem empréstimos: ${formatCurrency(latestTotals.saldoSemEmprestimos)}`;

        if (!grid) return;

        const cards = [
            ['ph-arrow-circle-down', latestTotals.totalRecebido, 'Total recebido', 'Entradas pagas no caixa', 'receita'],
            ['ph-arrow-circle-up', latestTotals.totalGasto, 'Total gasto', 'Saídas pagas do caixa', 'despesa'],
            ['ph-wallet', latestTotals.saldoAtual, 'Saldo atual', 'Recebido menos gasto', 'saldo'],
            ['ph-chart-line-up', latestTotals.lucroPrejuizo, 'Lucro ou prejuízo', 'Resultado real do evento', latestTotals.lucroPrejuizo < 0 ? 'despesa' : 'receita'],
            ['ph-handshake', latestTotals.patrocinioRecebido, 'Patrocínios recebidos', 'Aportes pagos por marcas', 'patrocinio'],
            ['ph-users-three', latestTotals.participantesPagosValor, 'Participantes pagos', `${latestTotals.participantesPagos} participantes confirmados`, 'receita'],
            ['ph-bank', latestTotals.emprestimosRecebidos, 'Empréstimos recebidos', 'Entradas que são dívida', 'saldo'],
            ['ph-hand-coins', latestTotals.emprestimosConcedidos, 'Empréstimos concedidos', 'Dinheiro que saiu para terceiros', 'despesa'],
            ['ph-clock-countdown', latestTotals.pendenciasReceber, 'Pendências a receber', 'Valores prometidos ou abertos', 'pendencia'],
            ['ph-warning-circle', latestTotals.pendenciasPagar, 'Pendências a pagar', 'Dívidas e saídas abertas', 'pendencia']
        ];

        grid.innerHTML = cards.map(([icon, value, label, description, tone]) => `
            <article class="financeiro-summary-card ${tone}">
                <div class="financeiro-summary-icon"><i class="ph ${icon}"></i></div>
                <strong>${formatCurrency(value)}</strong>
                <span>${escapeHtml(label)}</span>
                <small>${escapeHtml(description)}</small>
            </article>
        `).join('');
    }

    function getFilteredMovimentacoes() {
        const search = normalizeText($('#filter-search')?.value, '').toLowerCase();
        const type = $('#filter-type')?.value || '';
        const category = $('#filter-category')?.value || '';
        const status = $('#filter-status')?.value || '';
        const month = $('#filter-month')?.value || '';
        const payment = $('#filter-payment')?.value || '';

        return financeiroState.movimentacoes
            .map(normalizeMovement)
            .filter((movement) => {
                const haystack = [
                    movement.type,
                    movement.category,
                    movement.description,
                    movement.person,
                    movement.paymentMethod,
                    movement.status,
                    movement.notes
                ].join(' ').toLowerCase();
                if (search && !haystack.includes(search)) return false;
                if (type && movement.type !== type) return false;
                if (category && movement.category !== category) return false;
                if (status && movement.status !== status) return false;
                if (payment && movement.paymentMethod !== payment) return false;
                if (month && !String(movement.date || '').startsWith(month)) return false;
                return true;
            })
            .sort((a, b) => {
                const dateDiff = String(b.date).localeCompare(String(a.date));
                if (dateDiff) return dateDiff;
                return String(b.createdAt).localeCompare(String(a.createdAt));
            });
    }

    function movementActionsHtml(movement) {
        const paidButton = movement.status !== 'Pago'
            ? `<button class="financeiro-action-btn" title="Marcar como pago" data-movement-action="paid" data-id="${escapeAttr(movement.id)}"><i class="ph ph-check"></i></button>`
            : '';
        const pendingButton = movement.status !== 'Pendente'
            ? `<button class="financeiro-action-btn" title="Marcar como pendente" data-movement-action="pending" data-id="${escapeAttr(movement.id)}"><i class="ph ph-clock"></i></button>`
            : '';
        return `
            <div class="financeiro-actions">
                <button class="financeiro-action-btn" title="Editar" data-movement-action="edit" data-id="${escapeAttr(movement.id)}"><i class="ph ph-pencil-simple"></i></button>
                ${paidButton}
                ${pendingButton}
                <button class="financeiro-action-btn danger" title="Excluir" data-movement-action="delete" data-id="${escapeAttr(movement.id)}"><i class="ph ph-trash"></i></button>
            </div>
        `;
    }

    function renderMovimentacoes() {
        const tbody = $('#financeiro-movimentacoes-tbody');
        const mobile = $('#financeiro-movimentacoes-mobile');
        const empty = $('#financeiro-movimentacoes-empty');
        const movements = getFilteredMovimentacoes();

        if (empty) empty.hidden = movements.length > 0;

        if (tbody) {
            tbody.innerHTML = movements.map((movement) => {
                const direction = getMovementDirection(movement);
                const valueClass = direction === 'expense' ? 'expense' : 'income';
                const sign = direction === 'expense' ? '-' : '+';
                return `
                    <tr>
                        <td>${formatDate(movement.date)}</td>
                        <td>${escapeHtml(movement.type)}</td>
                        <td>${escapeHtml(movement.category)}</td>
                        <td>${escapeHtml(movement.description)}</td>
                        <td>${escapeHtml(movement.person || '-')}</td>
                        <td>${escapeHtml(movement.paymentMethod)}</td>
                        <td><span class="${statusClass(movement.status)}">${escapeHtml(movement.status)}</span></td>
                        <td class="financeiro-value ${valueClass}">${sign} ${formatCurrency(movement.value)}</td>
                        <td>${movementActionsHtml(movement)}</td>
                    </tr>
                `;
            }).join('');
        }

        if (mobile) {
            mobile.innerHTML = movements.map((movement) => {
                const direction = getMovementDirection(movement);
                const valueClass = direction === 'expense' ? 'expense' : 'income';
                const sign = direction === 'expense' ? '-' : '+';
                return `
                    <article class="financeiro-mobile-card">
                        <header>
                            <div>
                                <h3>${escapeHtml(movement.description)}</h3>
                                <p>${escapeHtml(movement.type)} • ${escapeHtml(movement.category)}</p>
                            </div>
                            <strong class="financeiro-value ${valueClass}">${sign} ${formatCurrency(movement.value)}</strong>
                        </header>
                        <div class="financeiro-mobile-meta">
                            <span>Data <b>${formatDate(movement.date)}</b></span>
                            <span>Status <b class="${statusClass(movement.status)}">${escapeHtml(movement.status)}</b></span>
                            <span>Pessoa <b>${escapeHtml(movement.person || '-')}</b></span>
                            <span>Pagamento <b>${escapeHtml(movement.paymentMethod)}</b></span>
                        </div>
                        ${movementActionsHtml(movement)}
                    </article>
                `;
            }).join('');
        }
    }

    function renderMiniCard(label, value) {
        return `
            <div class="financeiro-mini-card">
                <small>${escapeHtml(label)}</small>
                <strong>${typeof value === 'number' ? formatCurrency(value) : escapeHtml(value)}</strong>
            </div>
        `;
    }

    function sponsorFromMovement(movement) {
        return normalizeSponsor({
            id: `auto_${movement.id}`,
            name: movement.person || movement.description.replace(/^Patrocínio\s*-\s*/i, ''),
            promisedValue: movement.value,
            paidValue: movement.status === 'Pago' ? movement.value : 0,
            status: movement.status === 'Pago' ? 'Pago' : 'Pendente',
            paymentMethod: movement.paymentMethod,
            date: movement.date,
            observation: movement.notes,
            createdAt: movement.createdAt,
            updatedAt: movement.updatedAt
        });
    }

    function renderPatrocinadores() {
        const list = $('#patrocinadores-list');
        const summary = $('#patrocinadores-summary');
        if (!list || !summary) return;

        const manual = financeiroState.patrocinadores.map(normalizeSponsor);
        const automatic = financeiroState.movimentacoes
            .map(normalizeMovement)
            .filter((movement) => movement.type === 'Patrocínio recebido' && movement.source !== 'patrocinador')
            .map(sponsorFromMovement);
        const sponsors = [...manual, ...automatic];
        const promised = sponsors.reduce((sum, item) => sum + toNumber(item.promisedValue), 0);
        const paid = sponsors.reduce((sum, item) => sum + toNumber(item.paidValue), 0);
        const pending = Math.max(promised - paid, 0);

        summary.innerHTML = [
            renderMiniCard('Total de patrocinadores', String(sponsors.length)),
            renderMiniCard('Total prometido', promised),
            renderMiniCard('Total pago', paid),
            renderMiniCard('Total pendente', pending)
        ].join('');

        list.innerHTML = sponsors.length ? sponsors.map((item) => {
            const isAuto = String(item.id).startsWith('auto_');
            return `
                <article class="financeiro-item-card">
                    <div class="financeiro-item-top">
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <small>${isAuto ? 'Reconhecido por movimentação' : formatDate(item.date)}</small>
                        </div>
                        <span class="${statusClass(item.status)}">${escapeHtml(item.status)}</span>
                    </div>
                    <div class="financeiro-item-grid">
                        <span>Prometido <b>${formatCurrency(item.promisedValue)}</b></span>
                        <span>Pago <b>${formatCurrency(item.paidValue)}</b></span>
                        <span>Pagamento <b>${escapeHtml(item.paymentMethod)}</b></span>
                        <span>Observação <b>${escapeHtml(item.observation || '-')}</b></span>
                    </div>
                    ${isAuto ? '' : `
                        <div class="financeiro-actions">
                            <button class="financeiro-action-btn" title="Editar" data-sponsor-action="edit" data-id="${escapeAttr(item.id)}"><i class="ph ph-pencil-simple"></i></button>
                            <button class="financeiro-action-btn danger" title="Excluir" data-sponsor-action="delete" data-id="${escapeAttr(item.id)}"><i class="ph ph-trash"></i></button>
                        </div>
                    `}
                </article>
            `;
        }).join('') : `<div class="financeiro-empty"><i class="ph ph-handshake"></i><strong>Nenhum patrocinador</strong><span>Cadastre ou lance uma movimentação de patrocínio.</span></div>`;
    }

    function participantFromMovement(movement) {
        return normalizePaidParticipant({
            id: `auto_${movement.id}`,
            name: movement.person || movement.description.replace(/^Inscrição\s*-\s*/i, ''),
            game: movement.category === 'Inscrição de participante' ? 'FIFA' : 'Outro',
            value: movement.value,
            date: movement.date,
            status: movement.status === 'Pago' ? 'Pago' : 'Pendente',
            paymentMethod: movement.paymentMethod,
            createdAt: movement.createdAt,
            updatedAt: movement.updatedAt
        });
    }

    function renderParticipantesPagos() {
        const list = $('#participantes-pagos-list');
        const summary = $('#participantes-summary');
        if (!list || !summary) return;

        const manual = financeiroState.participantesPagos.map(normalizePaidParticipant);
        const automatic = financeiroState.movimentacoes
            .map(normalizeMovement)
            .filter((movement) => movement.type === 'Pagamento de participante' && movement.source !== 'participantePago')
            .map(participantFromMovement);
        const participants = [...manual, ...automatic];
        const paidList = participants.filter((item) => item.status === 'Pago');
        const paidValue = paidList.reduce((sum, item) => sum + toNumber(item.value), 0);
        const pending = participants.filter((item) => item.status === 'Pendente').length;

        summary.innerHTML = [
            renderMiniCard('Participantes pagos', String(paidList.length)),
            renderMiniCard('Total arrecadado', paidValue),
            renderMiniCard('Participantes pendentes', String(pending)),
            renderMiniCard('Modalidades', String(new Set(participants.map((item) => item.game)).size))
        ].join('');

        list.innerHTML = participants.length ? participants.map((item) => {
            const isAuto = String(item.id).startsWith('auto_');
            return `
                <article class="financeiro-item-card">
                    <div class="financeiro-item-top">
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <small>${escapeHtml(item.game)} • ${formatDate(item.date)}</small>
                        </div>
                        <span class="${statusClass(item.status)}">${escapeHtml(item.status)}</span>
                    </div>
                    <div class="financeiro-item-grid">
                        <span>Valor <b>${formatCurrency(item.value)}</b></span>
                        <span>Pagamento <b>${escapeHtml(item.paymentMethod)}</b></span>
                    </div>
                    ${isAuto ? '' : `
                        <div class="financeiro-actions">
                            <button class="financeiro-action-btn" title="Editar" data-participant-action="edit" data-id="${escapeAttr(item.id)}"><i class="ph ph-pencil-simple"></i></button>
                            <button class="financeiro-action-btn danger" title="Excluir" data-participant-action="delete" data-id="${escapeAttr(item.id)}"><i class="ph ph-trash"></i></button>
                        </div>
                    `}
                </article>
            `;
        }).join('') : `<div class="financeiro-empty"><i class="ph ph-users-three"></i><strong>Nenhum participante pago</strong><span>Cadastre pagamentos ou lance inscrições nas movimentações.</span></div>`;
    }

    function loanFromMovement(movement) {
        const direction = movement.type === 'Dinheiro emprestado para alguém' ? 'concedido' : 'recebido';
        return normalizeLoan({
            id: `auto_${movement.id}`,
            direction,
            name: movement.person || movement.description,
            value: movement.value,
            date: movement.date,
            status: direction === 'concedido' ? 'Aberto' : 'Aberto',
            observation: movement.notes,
            createdAt: movement.createdAt,
            updatedAt: movement.updatedAt
        });
    }

    function renderLoanList(selector, loans) {
        const list = $(selector);
        if (!list) return;
        list.innerHTML = loans.length ? loans.map((loan) => {
            const isAuto = String(loan.id).startsWith('auto_');
            return `
                <article class="financeiro-item-card">
                    <div class="financeiro-item-top">
                        <div>
                            <strong>${escapeHtml(loan.name)}</strong>
                            <small>${formatDate(loan.date)} ${isAuto ? '• Reconhecido por movimentação' : ''}</small>
                        </div>
                        <span class="${statusClass(loan.status)}">${escapeHtml(loan.status)}</span>
                    </div>
                    <div class="financeiro-item-grid">
                        <span>Valor <b>${formatCurrency(loan.value)}</b></span>
                        <span>Observações <b>${escapeHtml(loan.observation || '-')}</b></span>
                    </div>
                    ${isAuto ? '' : `
                        <div class="financeiro-actions">
                            <button class="financeiro-action-btn" title="Editar" data-loan-action="edit" data-id="${escapeAttr(loan.id)}"><i class="ph ph-pencil-simple"></i></button>
                            <button class="financeiro-action-btn danger" title="Excluir" data-loan-action="delete" data-id="${escapeAttr(loan.id)}"><i class="ph ph-trash"></i></button>
                        </div>
                    `}
                </article>
            `;
        }).join('') : `<div class="financeiro-empty"><i class="ph ph-bank"></i><strong>Nenhum registro</strong><span>Cadastre empréstimos ou lance movimentações relacionadas.</span></div>`;
    }

    function renderEmprestimos() {
        const manual = financeiroState.emprestimos.map(normalizeLoan);
        const automatic = financeiroState.movimentacoes
            .map(normalizeMovement)
            .filter((movement) => ['Dinheiro emprestado recebido', 'Dinheiro emprestado para alguém'].includes(movement.type) && movement.source !== 'emprestimo')
            .map(loanFromMovement);
        renderLoanList('#emprestimos-recebidos-list', [...manual, ...automatic].filter((loan) => loan.direction === 'recebido'));
        renderLoanList('#emprestimos-concedidos-list', [...manual, ...automatic].filter((loan) => loan.direction === 'concedido'));
    }

    function generateFinanceiroTextReport(copyToClipboard = false) {
        latestTotals = calculateFinanceiroTotals();
        const report = [
            'RELATÓRIO FINANCEIRO - COPA PSYZON',
            '',
            `Total recebido: ${formatCurrency(latestTotals.totalRecebido)}`,
            `Total gasto: ${formatCurrency(latestTotals.totalGasto)}`,
            `Saldo atual: ${formatCurrency(latestTotals.saldoAtual)}`,
            `Lucro/Prejuízo: ${formatCurrency(latestTotals.lucroPrejuizo)}`,
            `Saldo real sem empréstimos: ${formatCurrency(latestTotals.saldoSemEmprestimos)}`,
            `Patrocínios recebidos: ${formatCurrency(latestTotals.patrocinioRecebido)}`,
            `Participantes pagos: ${formatCurrency(latestTotals.participantesPagosValor)}`,
            `Empréstimos recebidos: ${formatCurrency(latestTotals.emprestimosRecebidos)}`,
            `Empréstimos concedidos: ${formatCurrency(latestTotals.emprestimosConcedidos)}`,
            `Pendências a receber: ${formatCurrency(latestTotals.pendenciasReceber)}`,
            `Pendências a pagar: ${formatCurrency(latestTotals.pendenciasPagar)}`,
            '',
            'Observações:',
            `${financeiroState.movimentacoes.length} movimentações registradas. Dados atualizados em ${new Date(financeiroState.updatedAt).toLocaleString('pt-BR')}.`
        ].join('\n');

        const textarea = $('#financeiro-report-text');
        if (textarea) textarea.value = report;

        if (copyToClipboard) {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(report)
                    .then(() => showToast('Resumo copiado', 'Relatório financeiro pronto para colar.'))
                    .catch(() => {
                        textarea?.select();
                        document.execCommand('copy');
                        showToast('Resumo selecionado', 'Use Ctrl+C se o navegador bloquear a cópia.', 'warning');
                    });
            } else {
                textarea?.select();
                document.execCommand('copy');
                showToast('Resumo selecionado', 'Use Ctrl+C para copiar.', 'warning');
            }
        }

        return report;
    }

    function renderRelatorio() {
        latestTotals = calculateFinanceiroTotals();
        const grid = $('#financeiro-report-grid');
        if (!grid) return;
        const cards = [
            ['Receita total', latestTotals.totalRecebido],
            ['Despesa total', latestTotals.totalGasto],
            ['Lucro/prejuízo', latestTotals.lucroPrejuizo],
            ['Saldo em caixa', latestTotals.saldoAtual],
            ['Patrocínio', latestTotals.patrocinioRecebido],
            ['Inscrições', latestTotals.participantesPagosValor],
            ['Empréstimos recebidos', latestTotals.emprestimosRecebidos],
            ['Emprestado a terceiros', latestTotals.emprestimosConcedidos],
            ['Pendências a receber', latestTotals.pendenciasReceber],
            ['Pendências a pagar', latestTotals.pendenciasPagar]
        ];
        grid.innerHTML = cards.map(([label, value]) => `
            <div class="financeiro-report-card">
                <small>${escapeHtml(label)}</small>
                <strong>${formatCurrency(value)}</strong>
            </div>
        `).join('');
        generateFinanceiroTextReport(false);
    }

    function renderAllFinanceiro() {
        renderDatalists();
        renderFinanceiroDashboard();
        renderMovimentacoes();
        renderPatrocinadores();
        renderParticipantesPagos();
        renderEmprestimos();
        renderRelatorio();
    }

    function collectMovementForm() {
        return {
            id: $('#movimentacao-id')?.value || '',
            type: normalizeText($('#movimentacao-tipo')?.value, ''),
            category: normalizeText($('#movimentacao-categoria')?.value, ''),
            description: normalizeText($('#movimentacao-descricao')?.value, ''),
            value: parseCurrency($('#movimentacao-valor')?.value),
            rawValue: $('#movimentacao-valor')?.value || '',
            date: $('#movimentacao-data')?.value || '',
            paymentMethod: $('#movimentacao-pagamento')?.value || 'Pix',
            status: $('#movimentacao-status')?.value || 'Pago',
            person: normalizeText($('#movimentacao-pessoa')?.value, ''),
            notes: normalizeText($('#movimentacao-observacoes')?.value, '')
        };
    }

    function validateMovementForm(data) {
        if (!data.type) return 'Selecione o tipo da movimentação.';
        if (!data.category) return 'Selecione a categoria.';
        if (!data.description) return 'Informe a descrição.';
        if (!data.date) return 'Selecione a data.';
        if (String(data.rawValue).includes('-')) return 'O valor não pode ser negativo.';
        if (!data.value) return 'Informe um valor maior que zero.';
        return '';
    }

    async function addMovimentacao(event) {
        if (event) event.preventDefault();
        const data = collectMovementForm();
        const error = validateMovementForm(data);
        if (error) {
            showToast('Revise o formulário', error, 'warning');
            return false;
        }

        const now = new Date().toISOString();
        const existing = financeiroState.movimentacoes.find((item) => item.id === data.id);
        const movement = normalizeMovement({
            ...existing,
            ...data,
            id: data.id || createId('mov'),
            createdAt: existing?.createdAt || now,
            updatedAt: now
        });

        if (existing) {
            financeiroState.movimentacoes = financeiroState.movimentacoes.map((item) => item.id === movement.id ? movement : item);
            syncSourceFromMovement(movement);
        } else {
            financeiroState.movimentacoes.unshift(movement);
        }

        resetMovementForm();
        await saveFinanceiroData({ toast: existing ? 'Movimentação atualizada' : 'Movimentação salva' });
        return true;
    }

    function editMovimentacao(id) {
        const movement = financeiroState.movimentacoes.find((item) => item.id === id);
        if (!movement) return;
        $('#movimentacao-id').value = movement.id;
        $('#movimentacao-tipo').value = movement.type;
        $('#movimentacao-categoria').value = movement.category;
        $('#movimentacao-descricao').value = movement.description;
        $('#movimentacao-valor').value = formatCurrency(movement.value);
        $('#movimentacao-data').value = movement.date;
        $('#movimentacao-pagamento').value = movement.paymentMethod;
        $('#movimentacao-status').value = movement.status;
        $('#movimentacao-pessoa').value = movement.person || '';
        $('#movimentacao-observacoes').value = movement.notes || '';
        $('#btn-save-movimentacao').innerHTML = '<i class="ph ph-floppy-disk"></i> Atualizar movimentação';
        $('#financeiro-movimentacao-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function deleteMovimentacao(id) {
        const movement = financeiroState.movimentacoes.find((item) => item.id === id);
        if (!movement) return;
        if (!confirm('Excluir esta movimentação?')) return;

        financeiroState.movimentacoes = financeiroState.movimentacoes.filter((item) => item.id !== id);

        if (movement.source === 'patrocinador') {
            financeiroState.patrocinadores = financeiroState.patrocinadores.filter((item) => item.id !== movement.sourceId);
        }
        if (movement.source === 'participantePago') {
            financeiroState.participantesPagos = financeiroState.participantesPagos.filter((item) => item.id !== movement.sourceId);
        }
        if (movement.source === 'emprestimo') {
            financeiroState.emprestimos = financeiroState.emprestimos.filter((item) => item.id !== movement.sourceId);
        }

        await saveFinanceiroData({ toast: 'Movimentação excluída' });
    }

    async function updateStatusMovimentacao(id, status) {
        let updated = null;
        financeiroState.movimentacoes = financeiroState.movimentacoes.map((item) => {
            if (item.id !== id) return item;
            updated = normalizeMovement({ ...item, status, updatedAt: new Date().toISOString() });
            return updated;
        });
        if (updated) syncSourceFromMovement(updated);
        await saveFinanceiroData({ toast: `Status alterado para ${status}` });
    }

    function filterMovimentacoes() {
        renderMovimentacoes();
    }

    function resetMovementForm() {
        const form = $('#financeiro-movimentacao-form');
        if (form) form.reset();
        $('#movimentacao-id').value = '';
        $('#movimentacao-data').value = todayInputValue();
        $('#movimentacao-pagamento').value = 'Pix';
        $('#movimentacao-status').value = 'Pago';
        $('#btn-save-movimentacao').innerHTML = '<i class="ph ph-floppy-disk"></i> Salvar movimentação';
    }

    function upsertAutoMovement(source, sourceId, payload) {
        const now = new Date().toISOString();
        const existing = financeiroState.movimentacoes.find((item) => item.source === source && item.sourceId === sourceId);
        const movement = normalizeMovement({
            ...existing,
            ...payload,
            id: existing?.id || `${source}_${sourceId}`,
            source,
            sourceId,
            createdAt: existing?.createdAt || now,
            updatedAt: now
        });

        if (existing) {
            financeiroState.movimentacoes = financeiroState.movimentacoes.map((item) => item.id === existing.id ? movement : item);
        } else {
            financeiroState.movimentacoes.unshift(movement);
        }
    }

    function removeAutoMovement(source, sourceId) {
        financeiroState.movimentacoes = financeiroState.movimentacoes.filter((item) => !(item.source === source && item.sourceId === sourceId));
    }

    function syncSourceFromMovement(movement) {
        if (movement.source === 'patrocinador') {
            financeiroState.patrocinadores = financeiroState.patrocinadores.map((item) => {
                if (item.id !== movement.sourceId) return item;
                return normalizeSponsor({
                    ...item,
                    name: movement.person || item.name,
                    paidValue: movement.value,
                    date: movement.date,
                    paymentMethod: movement.paymentMethod,
                    status: movement.status === 'Pago' ? (item.promisedValue > movement.value ? 'Parcial' : 'Pago') : 'Pendente',
                    observation: movement.notes,
                    updatedAt: movement.updatedAt
                });
            });
        }

        if (movement.source === 'participantePago') {
            financeiroState.participantesPagos = financeiroState.participantesPagos.map((item) => {
                if (item.id !== movement.sourceId) return item;
                return normalizePaidParticipant({
                    ...item,
                    name: movement.person || item.name,
                    value: movement.value,
                    date: movement.date,
                    paymentMethod: movement.paymentMethod,
                    status: movement.status === 'Pago' ? 'Pago' : 'Pendente',
                    updatedAt: movement.updatedAt
                });
            });
        }

        if (movement.source === 'emprestimo') {
            financeiroState.emprestimos = financeiroState.emprestimos.map((item) => {
                if (item.id !== movement.sourceId) return item;
                return normalizeLoan({
                    ...item,
                    name: movement.person || item.name,
                    value: movement.value,
                    date: movement.date,
                    observation: movement.notes,
                    updatedAt: movement.updatedAt
                });
            });
        }
    }

    function syncSponsorMovement(sponsor) {
        if (!sponsor.paidValue) {
            removeAutoMovement('patrocinador', sponsor.id);
            return;
        }
        upsertAutoMovement('patrocinador', sponsor.id, {
            type: 'Patrocínio recebido',
            category: 'Patrocinador',
            description: `Patrocínio - ${sponsor.name}`,
            value: sponsor.paidValue,
            date: sponsor.date,
            paymentMethod: sponsor.paymentMethod,
            status: sponsor.status === 'Pendente' ? 'Pendente' : 'Pago',
            person: sponsor.name,
            notes: sponsor.observation
        });
    }

    function syncParticipantMovement(participant) {
        if (!participant.value) {
            removeAutoMovement('participantePago', participant.id);
            return;
        }
        upsertAutoMovement('participantePago', participant.id, {
            type: 'Pagamento de participante',
            category: 'Inscrição de participante',
            description: `Inscrição - ${participant.name} (${participant.game})`,
            value: participant.value,
            date: participant.date,
            paymentMethod: participant.paymentMethod,
            status: participant.status,
            person: participant.name,
            notes: participant.game
        });
    }

    function syncLoanMovement(loan) {
        if (!loan.value) {
            removeAutoMovement('emprestimo', loan.id);
            return;
        }
        upsertAutoMovement('emprestimo', loan.id, {
            type: loan.direction === 'recebido' ? 'Dinheiro emprestado recebido' : 'Dinheiro emprestado para alguém',
            category: 'Empréstimo',
            description: loan.direction === 'recebido' ? `Empréstimo recebido - ${loan.name}` : `Empréstimo concedido - ${loan.name}`,
            value: loan.value,
            date: loan.date,
            paymentMethod: 'Transferência',
            status: 'Pago',
            person: loan.name,
            notes: loan.observation
        });
    }

    async function saveSponsor(event) {
        event.preventDefault();
        const id = $('#patrocinador-id').value || createId('pat');
        const existing = financeiroState.patrocinadores.find((item) => item.id === id);
        const paidValue = parseCurrency($('#patrocinador-pago').value);
        const promisedInput = parseCurrency($('#patrocinador-prometido').value);
        const sponsor = normalizeSponsor({
            ...existing,
            id,
            name: $('#patrocinador-nome').value,
            promisedValue: promisedInput || paidValue,
            paidValue,
            status: $('#patrocinador-status').value,
            paymentMethod: $('#patrocinador-pagamento').value,
            date: $('#patrocinador-data').value || todayInputValue(),
            observation: $('#patrocinador-observacao').value,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        if (!sponsor.name || (!sponsor.promisedValue && !sponsor.paidValue)) {
            showToast('Revise o patrocinador', 'Informe nome e valor.', 'warning');
            return;
        }

        financeiroState.patrocinadores = existing
            ? financeiroState.patrocinadores.map((item) => item.id === id ? sponsor : item)
            : [sponsor, ...financeiroState.patrocinadores];
        syncSponsorMovement(sponsor);
        $('#patrocinador-form').reset();
        $('#patrocinador-id').value = '';
        $('#patrocinador-data').value = todayInputValue();
        await saveFinanceiroData({ toast: 'Patrocinador salvo' });
    }

    async function savePaidParticipant(event) {
        event.preventDefault();
        const id = $('#participante-pago-id').value || createId('part');
        const existing = financeiroState.participantesPagos.find((item) => item.id === id);
        const participant = normalizePaidParticipant({
            ...existing,
            id,
            name: $('#participante-pago-nome').value,
            game: $('#participante-pago-jogo').value,
            value: parseCurrency($('#participante-pago-valor').value),
            date: $('#participante-pago-data').value || todayInputValue(),
            status: $('#participante-pago-status').value,
            paymentMethod: $('#participante-pago-pagamento').value,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        if (!participant.name || !participant.value) {
            showToast('Revise o participante', 'Informe nome e valor.', 'warning');
            return;
        }

        financeiroState.participantesPagos = existing
            ? financeiroState.participantesPagos.map((item) => item.id === id ? participant : item)
            : [participant, ...financeiroState.participantesPagos];
        syncParticipantMovement(participant);
        $('#participante-pago-form').reset();
        $('#participante-pago-id').value = '';
        $('#participante-pago-data').value = todayInputValue();
        await saveFinanceiroData({ toast: 'Participante salvo' });
    }

    async function saveLoan(direction, event) {
        event.preventDefault();
        const prefix = direction === 'recebido' ? 'emprestimo-recebido' : 'emprestimo-concedido';
        const id = $(`#${prefix}-id`).value || createId('emp');
        const existing = financeiroState.emprestimos.find((item) => item.id === id);
        const loan = normalizeLoan({
            ...existing,
            id,
            direction,
            name: $(`#${prefix}-nome`).value,
            value: parseCurrency($(`#${prefix}-valor`).value),
            date: $(`#${prefix}-data`).value || todayInputValue(),
            status: $(`#${prefix}-status`).value,
            observation: $(`#${prefix}-observacao`).value,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        if (!loan.name || !loan.value) {
            showToast('Revise o empréstimo', 'Informe nome e valor.', 'warning');
            return;
        }

        financeiroState.emprestimos = existing
            ? financeiroState.emprestimos.map((item) => item.id === id ? loan : item)
            : [loan, ...financeiroState.emprestimos];
        syncLoanMovement(loan);
        $(`#${prefix}-form`).reset();
        $(`#${prefix}-id`).value = '';
        $(`#${prefix}-data`).value = todayInputValue();
        await saveFinanceiroData({ toast: 'Empréstimo salvo' });
    }

    function editSponsor(id) {
        const item = financeiroState.patrocinadores.find((sponsor) => sponsor.id === id);
        if (!item) return;
        $('#patrocinador-id').value = item.id;
        $('#patrocinador-nome').value = item.name;
        $('#patrocinador-prometido').value = formatCurrency(item.promisedValue);
        $('#patrocinador-pago').value = formatCurrency(item.paidValue);
        $('#patrocinador-status').value = item.status;
        $('#patrocinador-pagamento').value = item.paymentMethod;
        $('#patrocinador-data').value = item.date;
        $('#patrocinador-observacao').value = item.observation;
        $('#patrocinador-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function deleteSponsor(id) {
        if (!confirm('Excluir este patrocinador?')) return;
        financeiroState.patrocinadores = financeiroState.patrocinadores.filter((item) => item.id !== id);
        removeAutoMovement('patrocinador', id);
        await saveFinanceiroData({ toast: 'Patrocinador excluído' });
    }

    function editPaidParticipant(id) {
        const item = financeiroState.participantesPagos.find((participant) => participant.id === id);
        if (!item) return;
        $('#participante-pago-id').value = item.id;
        $('#participante-pago-nome').value = item.name;
        $('#participante-pago-jogo').value = item.game;
        $('#participante-pago-valor').value = formatCurrency(item.value);
        $('#participante-pago-data').value = item.date;
        $('#participante-pago-status').value = item.status;
        $('#participante-pago-pagamento').value = item.paymentMethod;
        $('#participante-pago-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function deletePaidParticipant(id) {
        if (!confirm('Excluir este participante pago?')) return;
        financeiroState.participantesPagos = financeiroState.participantesPagos.filter((item) => item.id !== id);
        removeAutoMovement('participantePago', id);
        await saveFinanceiroData({ toast: 'Participante excluído' });
    }

    function editLoan(id) {
        const item = financeiroState.emprestimos.find((loan) => loan.id === id);
        if (!item) return;
        const prefix = item.direction === 'recebido' ? 'emprestimo-recebido' : 'emprestimo-concedido';
        $(`#${prefix}-id`).value = item.id;
        $(`#${prefix}-nome`).value = item.name;
        $(`#${prefix}-valor`).value = formatCurrency(item.value);
        $(`#${prefix}-data`).value = item.date;
        $(`#${prefix}-status`).value = item.status;
        $(`#${prefix}-observacao`).value = item.observation;
        $(`#${prefix}-form`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function deleteLoan(id) {
        if (!confirm('Excluir este empréstimo?')) return;
        financeiroState.emprestimos = financeiroState.emprestimos.filter((item) => item.id !== id);
        removeAutoMovement('emprestimo', id);
        await saveFinanceiroData({ toast: 'Empréstimo excluído' });
    }

    function toCsvValue(value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    }

    function exportFinanceiroCSV() {
        latestTotals = calculateFinanceiroTotals();
        const rows = [
            ['Relatório Financeiro - COPA PSYZON'],
            ['Atualizado em', new Date(financeiroState.updatedAt).toLocaleString('pt-BR')],
            [],
            ['Resumo', 'Valor'],
            ['Total recebido', latestTotals.totalRecebido],
            ['Total gasto', latestTotals.totalGasto],
            ['Saldo atual', latestTotals.saldoAtual],
            ['Lucro/Prejuízo', latestTotals.lucroPrejuizo],
            ['Saldo real sem empréstimos', latestTotals.saldoSemEmprestimos],
            ['Patrocínios recebidos', latestTotals.patrocinioRecebido],
            ['Participantes pagos', latestTotals.participantesPagosValor],
            ['Empréstimos recebidos', latestTotals.emprestimosRecebidos],
            ['Empréstimos concedidos', latestTotals.emprestimosConcedidos],
            ['Pendências a receber', latestTotals.pendenciasReceber],
            ['Pendências a pagar', latestTotals.pendenciasPagar],
            [],
            ['Data', 'Tipo', 'Categoria', 'Descrição', 'Pessoa/empresa', 'Forma de pagamento', 'Status', 'Valor', 'Observações'],
            ...financeiroState.movimentacoes.map((movement) => [
                formatDate(movement.date),
                movement.type,
                movement.category,
                movement.description,
                movement.person,
                movement.paymentMethod,
                movement.status,
                movement.value,
                movement.notes
            ])
        ];

        const csv = `sep=;\n${rows.map((row) => row.map(toCsvValue).join(';')).join('\n')}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `relatorio-financeiro-copa-psyzon-${todayInputValue()}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast('CSV exportado', 'Relatório financeiro baixado.');
    }

    function printFinanceiroReport() {
        renderRelatorio();
        window.print();
    }

    function handleCurrencyInput(event) {
        const input = event.currentTarget;
        const digits = input.value.replace(/\D/g, '');
        input.value = digits ? formatCurrency(Number(digits) / 100) : '';
    }

    function preventNegativeValue(event) {
        if (event.key === '-' || event.key === '+') {
            event.preventDefault();
        }
    }

    function fillFilterOptions() {
        const type = $('#filter-type');
        const category = $('#filter-category');
        if (type && type.options.length <= 1) {
            type.insertAdjacentHTML('beforeend', MOVEMENT_TYPES.map((item) => `<option>${escapeHtml(item)}</option>`).join(''));
        }
        if (category && category.options.length <= 1) {
            category.insertAdjacentHTML('beforeend', CATEGORIES.map((item) => `<option>${escapeHtml(item)}</option>`).join(''));
        }
    }

    function setDefaultDates() {
        $$('input[type="date"]').forEach((input) => {
            if (!input.value) input.value = todayInputValue();
        });
    }

    function clearFilters() {
        ['filter-search', 'filter-type', 'filter-category', 'filter-status', 'filter-month', 'filter-payment'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) input.value = '';
        });
        filterMovimentacoes();
    }

    function handleMovementAction(event) {
        const button = event.target.closest('[data-movement-action]');
        if (!button) return;
        const id = button.dataset.id;
        const action = button.dataset.movementAction;
        if (action === 'edit') editMovimentacao(id);
        if (action === 'delete') deleteMovimentacao(id);
        if (action === 'paid') updateStatusMovimentacao(id, 'Pago');
        if (action === 'pending') updateStatusMovimentacao(id, 'Pendente');
    }

    function handleSectionActions(event) {
        const sponsor = event.target.closest('[data-sponsor-action]');
        if (sponsor) {
            if (sponsor.dataset.sponsorAction === 'edit') editSponsor(sponsor.dataset.id);
            if (sponsor.dataset.sponsorAction === 'delete') deleteSponsor(sponsor.dataset.id);
            return;
        }

        const participant = event.target.closest('[data-participant-action]');
        if (participant) {
            if (participant.dataset.participantAction === 'edit') editPaidParticipant(participant.dataset.id);
            if (participant.dataset.participantAction === 'delete') deletePaidParticipant(participant.dataset.id);
            return;
        }

        const loan = event.target.closest('[data-loan-action]');
        if (loan) {
            if (loan.dataset.loanAction === 'edit') editLoan(loan.dataset.id);
            if (loan.dataset.loanAction === 'delete') deleteLoan(loan.dataset.id);
        }
    }

    function attachEvents() {
        $('#financeiro-movimentacao-form')?.addEventListener('submit', addMovimentacao);
        $('#btn-clear-movimentacao')?.addEventListener('click', resetMovementForm);
        $('#btn-clear-filters')?.addEventListener('click', clearFilters);
        $('#btn-export-csv')?.addEventListener('click', exportFinanceiroCSV);
        $('#btn-copy-report')?.addEventListener('click', () => generateFinanceiroTextReport(true));
        $('#btn-print-report')?.addEventListener('click', printFinanceiroReport);
        $('#btn-financeiro-logout')?.addEventListener('click', () => {
            sessionStorage.removeItem('copaPsyzonOrganizer');
            localStorage.setItem('copaRole', 'visitante');
            window.location.href = './escolhaojogo.html?role=visitante';
        });

        $('#patrocinador-form')?.addEventListener('submit', saveSponsor);
        $('#participante-pago-form')?.addEventListener('submit', savePaidParticipant);
        $('#emprestimo-recebido-form')?.addEventListener('submit', (event) => saveLoan('recebido', event));
        $('#emprestimo-concedido-form')?.addEventListener('submit', (event) => saveLoan('concedido', event));

        $$('.financeiro-money').forEach((input) => {
            input.addEventListener('input', handleCurrencyInput);
            input.addEventListener('keydown', preventNegativeValue);
        });

        ['filter-search', 'filter-type', 'filter-category', 'filter-status', 'filter-month', 'filter-payment'].forEach((id) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener(input.type === 'search' ? 'input' : 'change', filterMovimentacoes);
        });

        $('#financeiro-movimentacoes-tbody')?.addEventListener('click', handleMovementAction);
        $('#financeiro-movimentacoes-mobile')?.addEventListener('click', handleMovementAction);
        document.addEventListener('click', handleSectionActions);
    }

    async function bootstrapFinanceiro() {
        if (financeiroInitialized) return;
        financeiroInitialized = true;
        showFinanceiroApp();
        fillFilterOptions();
        setDefaultDates();
        attachEvents();
        financeiroState = readLocalFinanceiroData();
        renderAllFinanceiro();
        await initFirebaseConnection();
        await loadFinanceiroData();
        await loadExistingParticipants();
        renderAllFinanceiro();
    }

    function initFinanceiro() {
        const app = $('#financeiro-app');
        if (!app) return;

        $('#btn-financeiro-unlock')?.addEventListener('click', () => {
            if (checkOrganizerAccess({ prompt: true })) bootstrapFinanceiro();
        });

        showFinanceiroOnlyForOrganizer();
        if (!checkOrganizerAccess({ prompt: true })) {
            showAccessLock();
            return;
        }

        bootstrapFinanceiro();
    }

    document.addEventListener('DOMContentLoaded', initFinanceiro);

    Object.assign(window, {
        initFinanceiro,
        loadFinanceiroData,
        saveFinanceiroData,
        renderFinanceiroDashboard,
        renderMovimentacoes,
        renderPatrocinadores,
        renderParticipantesPagos,
        renderEmprestimos,
        renderRelatorio,
        addMovimentacao,
        editMovimentacao,
        deleteMovimentacao,
        updateStatusMovimentacao,
        filterMovimentacoes,
        calculateFinanceiroTotals,
        formatCurrency,
        parseCurrency,
        exportFinanceiroCSV,
        generateFinanceiroTextReport,
        printFinanceiroReport,
        checkOrganizerAccess,
        showFinanceiroOnlyForOrganizer
    });
})();
