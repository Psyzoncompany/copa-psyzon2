import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCL2u-oSlw8EWQ96atPI9Tc-0cIl2k9K6M",
    authDomain: "copa-psyzon2.firebaseapp.com",
    projectId: "copa-psyzon2",
    storageBucket: "copa-psyzon2.firebasestorage.app",
    messagingSenderId: "934292793843",
    appId: "1:934292793843:web:2f67fc6d314e1185f6ca86",
    measurementId: "G-G9Q14JE533",
    databaseURL: "https://copa-psyzon2-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'copaPsyzon_sinuca_tournamentState';
    const HISTORY_KEY = 'copaPsyzon_sinuca_history';
    const RANKING_KEY = 'copaPsyzon_sinuca_ranking';
    const FIREBASE_TOURNAMENT_PATH = 'tournaments/sinuca/current';
    const RESET_CODE_PASSWORD = '153090';
    const RP_PRIVATE_PASSWORD = 'Ro153090';
    const VALID_SIZES = [2, 4, 8, 16, 32, 64];
    const KNOCKOUT_VIEW_STORAGE_KEY = 'copaPsyzon_knockoutViewMode';
    let knockoutViewMode = localStorage.getItem(KNOCKOUT_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'tree';

    function createDefaultLiveState() {
        return {
            enabled: false,
            youtubeUrl: "",
            currentPlayer1: "",
            currentPlayer2: "",
            currentMatchTitle: "",
            scorePlayer1: 0,
            scorePlayer2: 0,
            phaseName: "",
            tableName: "",
            commentsEnabled: true,
            pinnedMessage: "",
            comments: []
        };
    }

    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || localStorage.getItem('copaRole') || 'visitante';
    const isOrganizer = role === 'organizador';
    document.body.classList.toggle('is-organizer', isOrganizer);
    document.body.classList.toggle('is-visitor', !isOrganizer);

    document.querySelectorAll('[data-game-switch]').forEach(link => {
        const game = link.dataset.gameSwitch;
        const target = game === 'fifa' ? '../FIFA/Fifa.html' : 'sinuca.html';
        const nextParams = new URLSearchParams();
        nextParams.set('role', role);
        ['id', 'name'].forEach(key => {
            const value = params.get(key);
            if (value) nextParams.set(key, value);
        });
        link.href = `${target}?${nextParams.toString()}`;
    });

    const defaultState = {
        name: 'COPA PSYZON SINUCA',
        participantLimit: 16,
        participants: [],
        codes: [],
        registeredPlayers: [],
        tournamentCode: null,
        bracket: null,
        champion: null,
        status: 'aguardando',
        finishedHistoryId: null,
        updatedAt: null,
        live: createDefaultLiveState()
    };

    let state = loadState();
    let selectedHistoryId = null;
    let participantSearchTerm = '';
    let participantStatusFilter = 'todos';
    let liveUser = null;
    let livePlayerMuted = false;
    let livePlayerPlaying = false;
    let liveControlsHideTimer = null;

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return saved ? { ...defaultState, ...saved } : { ...defaultState };
        } catch (_) {
            return { ...defaultState };
        }
    }

    function storeStateSnapshot() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function persist() {
        state.updatedAt = new Date().toISOString();
        ensureLiveState();
        storeStateSnapshot();
    }

    function ensureLiveState() {
        const current = state.live && typeof state.live === 'object' ? state.live : {};
        const defaults = createDefaultLiveState();
        state.live = {
            ...defaults,
            ...current,
            enabled: current.enabled === true,
            commentsEnabled: current.commentsEnabled !== false,
            comments: Array.isArray(current.comments) ? current.comments.slice(0, 20) : []
        };
        return state.live;
    }

    function publicTournamentState() {
        ensureLiveState();
        return {
            ...state,
            modality: 'sinuca',
            type: 'sinuca',
            status: state.status || 'aguardando',
            updatedAt: new Date().toISOString()
        };
    }

    async function syncTournamentToFirebase() {
        try {
            await set(ref(db, FIREBASE_TOURNAMENT_PATH), publicTournamentState());
            if (state.tournamentCode) {
                await set(ref(db, `tournaments/${state.tournamentCode}`), publicTournamentState());
            }
        } catch (error) {
            console.warn('Nao foi possivel sincronizar a Sinuca no Firebase:', error);
        }
    }

    async function loadTournamentFromFirebase() {
        try {
            const snap = await get(ref(db, FIREBASE_TOURNAMENT_PATH));
            if (!snap.exists()) return;
            const remote = snap.val();
            const localTime = state.updatedAt ? Date.parse(state.updatedAt) : 0;
            const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
            if (remoteTime >= localTime) {
                state = { ...defaultState, ...remote };
                ensureLiveState();
                storeStateSnapshot();
            }
            await syncLocalCodesFromPool();
        } catch (error) {
            console.warn('Nao foi possivel carregar a Sinuca do Firebase:', error);
        }
    }

    function subscribeTournamentFromFirebase() {
        onValue(ref(db, FIREBASE_TOURNAMENT_PATH), (snap) => {
            if (!snap.exists()) return;
            const remote = snap.val();
            const localTime = state.updatedAt ? Date.parse(state.updatedAt) : 0;
            const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
            if (remoteTime < localTime) return;
            state = { ...defaultState, ...remote };
            ensureLiveState();
            storeStateSnapshot();
            renderAll();
        }, (error) => {
            console.warn('Nao foi possivel acompanhar a Sinuca em tempo real:', error);
        });
    }

    async function syncLocalCodesFromPool() {
        if (!state.codes?.length) return;
        try {
            const snap = await get(ref(db, 'codes/pool'));
            if (!snap.exists()) return;
            const poolCodes = snap.val().codes || [];
            const byCode = new Map(poolCodes.map(item => [item.code, item]));
            let changed = false;
            state.codes = state.codes.map(item => {
                const remote = byCode.get(item.code);
                if (!remote) return item;
                changed = true;
                return { ...item, ...remote, modality: 'sinuca' };
            });
            if (changed) persist();
        } catch (error) {
            console.warn('Nao foi possivel sincronizar os codigos da Sinuca:', error);
        }
    }

    function getHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        } catch (_) {
            return [];
        }
    }

    function setHistory(history) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    function getRanking() {
        try {
            return JSON.parse(localStorage.getItem(RANKING_KEY) || '{}');
        } catch (_) {
            return {};
        }
    }

    function setRanking(ranking) {
        localStorage.setItem(RANKING_KEY, JSON.stringify(normalizeSinucaRanking(ranking)));
    }

    function cloneData(value) {
        return JSON.parse(JSON.stringify(value ?? null));
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[char]);
    }

    function initials(name) {
        return String(name || '?')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0]?.toUpperCase() || '')
            .join('') || '?';
    }

    function isBye(value) {
        return String(value || '').trim().toUpperCase() === 'BYE';
    }

    function isPlaceholder(value) {
        return String(value || '').startsWith('Vencedor ');
    }

    function isRealPlayer(value) {
        return !!value && !isBye(value) && !isPlaceholder(value);
    }

    function normalizeName(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function activeParticipantNames() {
        return new Set((state.participants || []).map(player => normalizeName(player.name)).filter(Boolean));
    }

    function getSelectedParticipantLimit() {
        const value = Number($('#participant-limit')?.value || state.participantLimit || 16);
        return Math.min(64, Math.max(2, Number.isFinite(value) ? value : 16));
    }

    function isTestParticipant(player) {
        return !!player?.isTestMode || /^Participante Teste \d+$/i.test(String(player?.name || ''));
    }

    function normalizeSinucaRanking(ranking = {}) {
        return Object.fromEntries(Object.entries(ranking || {}).map(([key, row]) => {
            const cleanRow = { ...row };
            delete cleanRow.pts;
            delete cleanRow.pontos;
            return [key, cleanRow];
        }));
    }

    function purgeRankingForNames(namesToRemove) {
        const removeSet = new Set([...namesToRemove].map(normalizeName).filter(Boolean));
        if (!removeSet.size) return;
        const ranking = getRanking();
        Object.keys(ranking).forEach(key => {
            const row = ranking[key] || {};
            if (removeSet.has(normalizeName(row.name || key))) delete ranking[key];
        });
        setRanking(ranking);
    }

    function syncRankingWithActiveParticipants() {
        const activeNames = activeParticipantNames();
        if (!activeNames.size) {
            setRanking({});
            return;
        }

        const ranking = getRanking();
        Object.keys(ranking).forEach(key => {
            const row = ranking[key] || {};
            if (!activeNames.has(normalizeName(row.name || key))) delete ranking[key];
        });
        setRanking(ranking);
    }

    function winRate(row) {
        const jogos = Number(row?.jogos || 0);
        if (!jogos) return 0;
        return Number(row?.vitorias || 0) / jogos;
    }

    function sinucaRankingSort(a, b) {
        return (b.vitorias || 0) - (a.vitorias || 0) ||
            winRate(b) - winRate(a) ||
            (a.derrotas || 0) - (b.derrotas || 0) ||
            (b.titulos || 0) - (a.titulos || 0) ||
            (b.finais || 0) - (a.finais || 0) ||
            (b.semifinais || 0) - (a.semifinais || 0) ||
            String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    }

    function isDoubleBye(match) {
        return isBye(match?.p1) && isBye(match?.p2);
    }

    function isResolved(match) {
        return !!match?.winner || match?.completed || match?.status === 'void';
    }

    function roundName(size) {
        const map = {
            2: 'Final',
            4: 'Semifinal',
            8: 'Quartas de Final',
            16: 'Oitavas de Final',
            32: '16avos de Final',
            64: '32avos de Final'
        };
        return map[size] || `Fase de ${size}`;
    }

    function nextPowerOfTwo(count) {
        return VALID_SIZES.find(size => size >= count) || 64;
    }

    function shuffle(list) {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    function createMatch(p1, p2, roundNameValue, index) {
        return {
            id: `${roundNameValue}-${index + 1}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            p1,
            p2,
            p1Source: p1,
            p2Source: p2,
            winnerToken: `Vencedor ${roundNameValue} ${index + 1}`,
            winner: null,
            status: 'pending',
            completed: false,
            walkover: false
        };
    }

    function getByeWinner(match) {
        if (isBye(match?.p1) && isRealPlayer(match?.p2)) return match.p2;
        if (isBye(match?.p2) && isRealPlayer(match?.p1)) return match.p1;
        return null;
    }

    function getWinner(match) {
        return match?.winner || getByeWinner(match) || null;
    }

    function resolveBye(match) {
        if (isDoubleBye(match)) {
            match.winner = null;
            match.status = 'void';
            match.completed = true;
            match.walkover = true;
            return { type: 'void', winner: null };
        }

        const winner = getByeWinner(match);
        if (!winner) return { type: 'none', winner: null };
        match.winner = winner;
        match.status = 'bye';
        match.completed = true;
        match.walkover = true;
        return { type: 'winner', winner };
    }

    function buildBracket() {
        if (!isOrganizer) return;
        const names = state.participants.map(p => p.name).filter(Boolean);
        if (names.length < 2) {
            alert('Adicione pelo menos 2 participantes.');
            return;
        }

        const size = nextPowerOfTwo(names.length);
        const slots = [...shuffle(names), ...Array.from({ length: size - names.length }, () => 'BYE')];
        const rounds = [];
        let currentSlots = slots;

        while (currentSlots.length > 1) {
            const name = roundName(currentSlots.length);
            const matches = [];
            const nextSlots = [];

            for (let i = 0; i < currentSlots.length; i += 2) {
                const match = createMatch(currentSlots[i], currentSlots[i + 1], name, i / 2);
                matches.push(match);
                nextSlots.push(match.winnerToken);
            }

            rounds.push({ name, matches });
            currentSlots = nextSlots;
        }

        state.bracket = { rounds };
        state.champion = null;
        state.finishedHistoryId = null;
        state.status = 'em_andamento';
        normalizeAutoAdvances();
        persist();
        syncTournamentToFirebase();
        renderAll();
        switchTab('mata-mata');
    }

    function createBracketPreview() {
        const names = state.participants.map(p => p.name).filter(Boolean);
        const limit = getSelectedParticipantLimit();
        const baseNames = names.length
            ? names
            : Array.from({ length: limit }, (_, index) => `A definir ${String(index + 1).padStart(2, '0')}`);

        const size = nextPowerOfTwo(baseNames.length);
        const slots = [...baseNames, ...Array.from({ length: size - baseNames.length }, () => 'BYE')];
        const rounds = [];
        let currentSlots = slots;

        while (currentSlots.length > 1) {
            const name = roundName(currentSlots.length);
            const matches = [];
            const nextSlots = [];

            for (let i = 0; i < currentSlots.length; i += 2) {
                const match = createMatch(currentSlots[i], currentSlots[i + 1], name, i / 2);
                matches.push(match);
                nextSlots.push(match.winnerToken);
            }

            rounds.push({ name, matches });
            currentSlots = nextSlots;
        }

        return { rounds };
    }

    function propagateWinner(token, winner, fromRoundIndex) {
        if (!token || !winner || !state.bracket?.rounds) return;
        for (let r = fromRoundIndex + 1; r < state.bracket.rounds.length; r++) {
            state.bracket.rounds[r].matches.forEach(match => {
                if (match.p1 === token) match.p1 = winner;
                if (match.p2 === token) match.p2 = winner;
            });
        }
    }

    function propagateVoid(token, fromRoundIndex) {
        if (!token || !state.bracket?.rounds) return;
        for (let r = fromRoundIndex + 1; r < state.bracket.rounds.length; r++) {
            state.bracket.rounds[r].matches.forEach(match => {
                if (match.p1 === token) match.p1 = 'BYE';
                if (match.p2 === token) match.p2 = 'BYE';
            });
        }
    }

    function normalizeAutoAdvances() {
        if (!state.bracket?.rounds) return;
        let changed = true;
        while (changed) {
            changed = false;
            state.bracket.rounds.forEach((round, rIdx) => {
                round.matches.forEach((match) => {
                    if (isResolved(match)) return;
                    const outcome = resolveBye(match);
                    if (outcome.type === 'none') return;
                    changed = true;
                    if (outcome.type === 'void') {
                        propagateVoid(match.winnerToken, rIdx);
                        return;
                    }
                    const winner = outcome.winner;
                    if (rIdx < state.bracket.rounds.length - 1) {
                        propagateWinner(match.winnerToken, winner, rIdx);
                    } else {
                        state.champion = winner;
                        state.status = 'finalizado';
                    }
                });
            });
        }
    }

    function defineWinner(roundIndex, matchIndex, winner) {
        if (!isOrganizer) return;
        const match = state.bracket?.rounds?.[roundIndex]?.matches?.[matchIndex];
        if (!match || !isRealPlayer(winner)) return;

        match.winner = winner;
        match.completed = true;
        match.status = 'completed';

        if (roundIndex < state.bracket.rounds.length - 1) {
            propagateWinner(match.winnerToken, winner, roundIndex);
            normalizeAutoAdvances();
        } else {
            state.champion = winner;
            state.status = 'finalizado';
        }

        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function resetResults() {
        if (!isOrganizer) return;
        if (!state.bracket?.rounds) return;
        state.bracket.rounds.forEach((round, rIdx) => {
            round.matches.forEach((match) => {
                if (rIdx > 0) {
                    match.p1 = match.p1Source;
                    match.p2 = match.p2Source;
                }
                match.winner = null;
                match.status = 'pending';
                match.completed = false;
                match.walkover = false;
            });
        });
        state.champion = null;
        state.finishedHistoryId = null;
        state.status = 'em_andamento';
        normalizeAutoAdvances();
        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function calculateCurrentTournamentRanking(baseRanking = {}) {
        if (!state.bracket?.rounds?.length) return baseRanking;
        const ranking = normalizeSinucaRanking(cloneData(baseRanking) || {});
        const ensure = (name) => {
            if (!isRealPlayer(name)) return null;
            if (!ranking[name]) {
                ranking[name] = { name, jogos: 0, vitorias: 0, derrotas: 0, titulos: 0, finais: 0, semifinais: 0 };
            }
            return ranking[name];
        };

        state.participants.forEach(p => ensure(p.name));
        state.bracket.rounds.forEach((round, rIdx) => {
            round.matches.forEach(match => {
                const winner = getWinner(match);
                if (!winner || !isRealPlayer(match.p1) || !isRealPlayer(match.p2)) return;
                const loser = winner === match.p1 ? match.p2 : match.p1;
                const w = ensure(winner);
                const l = ensure(loser);
                if (w) {
                    w.jogos += 1;
                    w.vitorias += 1;
                    if (rIdx === state.bracket.rounds.length - 1) {
                        w.titulos += 1;
                        w.finais += 1;
                    } else if (round.name.toLowerCase().includes('semifinal')) {
                        w.semifinais += 1;
                    }
                }
                if (l) {
                    l.jogos += 1;
                    l.derrotas += 1;
                    if (rIdx === state.bracket.rounds.length - 1) l.finais += 1;
                    else if (round.name.toLowerCase().includes('semifinal')) l.semifinais += 1;
                }
            });
        });

        return ranking;
    }

    function updateRankingFromCurrentTournament() {
        setRanking(calculateCurrentTournamentRanking(getRanking()));
    }

    function finishTournament() {
        if (!isOrganizer) return;
        if (!state.champion) {
            alert('Defina o campeão antes de encerrar.');
            return;
        }

        if (state.finishedHistoryId && !confirm('Este torneio ja foi salvo no historico. Deseja salvar uma nova copia?')) {
            return;
        }

        updateRankingFromCurrentTournament();
        const tournamentRanking = Object.values(calculateCurrentTournamentRanking({})).sort(sinucaRankingSort);
        const history = getHistory();
        const item = {
            id: `sinuca-${Date.now()}`,
            name: state.name,
            champion: state.champion,
            participants: state.participants.length,
            participantsList: cloneData(state.participants),
            bracket: cloneData(state.bracket),
            rankingFinal: tournamentRanking,
            status: 'encerrado',
            finishedAt: new Date().toISOString()
        };
        history.unshift(item);
        setHistory(history.slice(0, 50));
        state.status = 'encerrado';
        state.finishedHistoryId = item.id;
        persist();
        syncTournamentToFirebase();
        renderAll();
        switchTab('historico');
        alert('Torneio de Sinuca salvo no histórico.');
    }

    async function generateCodes() {
        if (!isOrganizer) return;
        const amount = Math.max(2, Number(state.participantLimit) || 16);
        const existingSnap = await get(ref(db, 'codes/pool'));
        const existingCodes = existingSnap.exists() ? (existingSnap.val().codes || []) : [];
        const usedCodes = existingCodes.filter(code => code.used || code.status === 'used');
        const otherCodes = existingCodes.filter(code => String(code.code || '').charAt(0).toUpperCase() !== 'S');
        const reusableSinuca = existingCodes.filter(code =>
            String(code.code || '').charAt(0).toUpperCase() === 'S' &&
            !(code.used || code.status === 'used')
        );
        const finalSinucaCodes = [];
        const existingSet = new Set(existingCodes.map(item => item.code));

        reusableSinuca.forEach(item => {
            if (finalSinucaCodes.length < amount) {
                finalSinucaCodes.push({
                    ...item,
                    modality: 'sinuca',
                    status: 'available',
                    used: false,
                    participantId: item.participantId || null,
                    usedBy: item.usedBy || null
                });
            }
        });

        while (finalSinucaCodes.length < amount) {
            let code;
            do {
                code = `S${Math.floor(1000 + Math.random() * 9000)}`;
            } while (existingSet.has(code));
            existingSet.add(code);
            finalSinucaCodes.push({
                code,
                modality: 'sinuca',
                status: 'available',
                used: false,
                participantId: null,
                usedBy: null
            });
        }

        const preservedUsedSinuca = usedCodes.filter(code => String(code.code || '').charAt(0).toUpperCase() === 'S');
        const finalCodes = [...otherCodes, ...preservedUsedSinuca, ...finalSinucaCodes].filter((item, index, list) =>
            list.findIndex(candidate => candidate.code === item.code) === index
        );

        state.codes = [...preservedUsedSinuca, ...finalSinucaCodes].slice(0, amount).map(item => ({
            ...item,
            modality: 'sinuca'
        }));
        state.tournamentCode = state.tournamentCode || `S${Date.now().toString(36).toUpperCase()}`;
        state.status = 'ativo';
        persist();
        await set(ref(db, 'codes/pool'), { codes: finalCodes });
        await syncTournamentToFirebase();
        renderAll();
        alert('Códigos da Sinuca atualizados para cadastro dos participantes.');
    }

    async function copyCode(code) {
        try {
            await navigator.clipboard.writeText(code);
            alert(`Codigo ${code} copiado.`);
        } catch (_) {
            prompt('Copie o codigo:', code);
        }
    }

    async function resetCode(code) {
        if (!isOrganizer) return;
        const password = prompt('Digite a senha para resetar este codigo:');
        if (password !== RESET_CODE_PASSWORD) {
            alert('Senha incorreta.');
            return;
        }

        const poolSnap = await get(ref(db, 'codes/pool'));
        const poolCodes = poolSnap.exists() ? (poolSnap.val().codes || []) : [];
        const target = poolCodes.find(item => item.code === code);
        if (!target) {
            alert('Codigo nao encontrado.');
            return;
        }

        const tournamentSnap = await get(ref(db, FIREBASE_TOURNAMENT_PATH));
        if (tournamentSnap.exists()) {
            state = { ...defaultState, ...tournamentSnap.val(), codes: state.codes };
        }

        const ownerId = target.participantId || target.usedBy || null;
        const ownerName = target.usedByName || target.participantName || null;
        const updatedPoolCodes = poolCodes.map(item => item.code === code
            ? {
                ...item,
                status: 'available',
                used: false,
                participantId: null,
                usedBy: null,
                usedByName: null,
                participantName: null,
                resetAt: new Date().toISOString()
            }
            : item
        );

        const removeOwner = (player) => {
            const playerId = player.id || player.uid || player.participantId || player.cpf || null;
            return ownerId ? playerId !== ownerId : (ownerName ? player.name !== ownerName : true);
        };

        if (ownerId || ownerName) {
            const removedNames = [
                ...(state.participants || []),
                ...(state.registeredPlayers || [])
            ].filter(player => !removeOwner(player)).map(player => player.name);
            state.participants = (state.participants || []).filter(removeOwner);
            state.registeredPlayers = (state.registeredPlayers || []).filter(removeOwner);
            purgeRankingForNames(ownerName ? [ownerName, ...removedNames] : removedNames);
            if (state.bracket?.rounds?.length) {
                state.bracket = null;
                state.champion = null;
                state.status = 'ativo';
            }
        }

        state.codes = (state.codes || []).map(item => item.code === code
            ? {
                ...item,
                status: 'available',
                used: false,
                participantId: null,
                usedBy: null,
                usedByName: null,
                participantName: null
            }
            : item
        );

        persist();
        await set(ref(db, 'codes/pool'), { codes: updatedPoolCodes });
        await syncTournamentToFirebase();
        renderAll();
        alert('Codigo resetado e jogador removido do torneio.');
    }

    function addParticipant(name) {
        if (!isOrganizer) return;
        const clean = name.trim().replace(/\s+/g, ' ');
        if (!clean) return;
        if (state.participants.length >= Number(state.participantLimit || 16)) {
            alert('Limite de participantes atingido.');
            return;
        }
        if (state.participants.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
            alert('Este participante já foi cadastrado.');
            return;
        }
        state.participants.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: clean });
        state.registeredPlayers = state.participants;
        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function generateTestPlayers() {
        if (!isOrganizer) return;
        if (state.participants.length && !confirm('Substituir os participantes atuais por jogadores de teste?')) return;
        const amount = getSelectedParticipantLimit();
        state.participantLimit = amount;
        const removedNames = (state.participants || []).map(player => player.name);
        state.participants = Array.from({ length: amount }, (_, index) => ({
            id: `sinuca-test-${String(index + 1).padStart(2, '0')}`,
            name: `Participante Teste ${String(index + 1).padStart(2, '0')}`,
            isTestMode: true,
            modality: 'sinuca'
        }));
        state.registeredPlayers = cloneData(state.participants);
        state.bracket = null;
        state.champion = null;
        state.finishedHistoryId = null;
        state.status = 'teste';
        purgeRankingForNames(removedNames);
        persist();
        syncTournamentToFirebase();
        renderAll();
        alert(`${amount} participantes de teste gerados.`);
    }

    function generateTestResults() {
        if (!isOrganizer) return;
        if (!state.participants.length) generateTestPlayers();
        if (!state.bracket?.rounds?.length) buildBracket();
        if (!state.bracket?.rounds?.length) return;

        normalizeAutoAdvances();
        state.bracket.rounds.forEach((round, rIdx) => {
            round.matches.forEach((match) => {
                if (getWinner(match) || !isRealPlayer(match.p1) || !isRealPlayer(match.p2)) return;
                const winner = Math.random() > 0.5 ? match.p1 : match.p2;
                match.winner = winner;
                match.completed = true;
                match.status = 'completed';
                if (rIdx < state.bracket.rounds.length - 1) {
                    propagateWinner(match.winnerToken, winner, rIdx);
                    normalizeAutoAdvances();
                } else {
                    state.champion = winner;
                    state.status = 'finalizado';
                }
            });
        });

        normalizeAutoAdvances();
        persist();
        syncTournamentToFirebase();
        renderAll();
        switchTab('mata-mata');
        alert('Resultados de teste gerados. Agora voce pode clicar em Encerrar e salvar.');
    }

    function startTestBracket() {
        if (!isOrganizer) return;
        if (!state.participants.length) generateTestPlayers();
        if (!state.bracket?.rounds?.length) buildBracket();
        state.status = 'teste';
        persist();
        syncTournamentToFirebase();
        renderAll();
        switchTab('mata-mata');
    }

    function clearTestMode() {
        if (!isOrganizer) return;
        if (!confirm('Limpar participantes, resultados e chaveamento de teste da Sinuca?')) return;
        const removedNames = (state.participants || []).filter(isTestParticipant).map(player => player.name);
        state.participants = (state.participants || []).filter(player => !isTestParticipant(player));
        state.registeredPlayers = (state.registeredPlayers || []).filter(player => !isTestParticipant(player));
        state.bracket = null;
        state.champion = null;
        state.finishedHistoryId = null;
        state.status = 'aguardando';
        purgeRankingForNames(removedNames);
        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function removeParticipant(id) {
        if (!isOrganizer) return;
        if (state.bracket?.rounds?.length && !confirm('Remover participante pode invalidar o mata-mata atual. Continuar?')) return;
        const removed = (state.participants || []).find(p => String(p.id) === String(id));
        state.participants = (state.participants || []).filter(p => String(p.id) !== String(id));
        state.registeredPlayers = (state.registeredPlayers || []).filter(p => String(p.id) !== String(id) && normalizeName(p.name) !== normalizeName(removed?.name));
        if (removed?.name) purgeRankingForNames([removed.name]);
        if (state.bracket?.rounds?.length) {
            state.bracket = null;
            state.champion = null;
            state.finishedHistoryId = null;
            state.status = 'aguardando';
        }
        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function matchStatus(match) {
        if (match.status === 'void') return { label: 'BYE', cls: 'done' };
        if (match.walkover && match.winner) return { label: 'BYE', cls: 'done' };
        if (match.winner) return { label: 'Finalizado', cls: 'done' };
        if (!isRealPlayer(match.p1) || !isRealPlayer(match.p2)) return { label: 'Aguardando', cls: 'waiting' };
        return { label: 'Pendente', cls: 'pending' };
    }

    function renderPlayerRow(match, player, side, rIdx, mIdx, isPreview = false) {
        const winner = getWinner(match);
        const isWinnerRow = winner === player;
        const rowClass = isWinnerRow ? 'winner match-team-winner' : (winner && isRealPlayer(player) ? 'loser match-team-loser' : '');
        const canWin = !isPreview && isOrganizer && !winner && isRealPlayer(player) && isRealPlayer(match.p1) && isRealPlayer(match.p2);
        return `
            <div class="player-row match-team ${rowClass}">
                <span class="player-info player-line">
                    <span class="player-avatar team-avatar">${initials(player)}</span>
                    <span class="team-info">
                        <span class="player-name team-name-bracket">${escapeHtml(player || 'A definir')}</span>
                        <small class="team-subtitle">${isBye(player) ? 'Avanço automático' : (isRealPlayer(player) ? 'Atleta' : 'Aguardando')}</small>
                    </span>
                </span>
                <span class="score-display score-pill">${winner ? (isWinnerRow ? 'V' : '-') : '—'}</span>
                ${canWin ? `<button class="win-button" data-r="${rIdx}" data-m="${mIdx}" data-winner="${escapeHtml(player)}">Vitória</button>` : ''}
            </div>
        `;
    }

    function renderBracket() {
        const isPreview = !state.bracket?.rounds?.length;
        if (!isPreview) normalizeAutoAdvances();
        const container = $('#bracket-container');
        const alerts = $('#knockout-alerts');
        const panel = $('#tab-mata-mata .knockout-panel');
        if (panel) {
            panel.classList.toggle('knockout-view-tree', knockoutViewMode === 'tree');
            panel.classList.toggle('knockout-view-list', knockoutViewMode === 'list');
        }
        $$('[data-knockout-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.knockoutView === knockoutViewMode);
        });

        const activeBracket = isPreview ? createBracketPreview() : state.bracket;
        const activeChampion = isPreview ? null : state.champion;
        const allMatches = activeBracket.rounds.flatMap(round => round.matches);
        updateBadges(allMatches, activeBracket, activeChampion);
        alerts.innerHTML = isPreview
            ? `<div class="alert"><i class="ph ph-eye"></i> Pre-visualizacao do mata-mata: o chaveamento oficial ainda nao foi gerado.</div>`
            : (activeChampion ? `<div class="alert"><i class="ph ph-crown-simple"></i> Campeão definido: ${escapeHtml(activeChampion)}.</div>` : '');

        const slotBase = 154;
        const connectorColumn = (round, rIdx) => {
            const slot = slotBase * (2 ** rIdx);
            const pairs = Math.ceil(round.matches.length / 2);
            return `
                <div class="bracket-connector-column" style="--slot:${slot}px" aria-hidden="true">
                    ${Array.from({ length: pairs }, () => `<span class="bracket-connector-pair"><i></i></span>`).join('')}
                </div>
            `;
        };
        container.innerHTML = `<div class="bracket-tree${isPreview ? ' preview-mode' : ''}">
            ${activeBracket.rounds.map((round, rIdx) => `
                <section class="phase-column bracket-round" style="--slot:${slotBase * (2 ** rIdx)}px">
                    <div class="phase-title bracket-round-title">
                        <span><i class="ph ${rIdx === activeBracket.rounds.length - 1 ? 'ph-trophy' : 'ph-billiards'}"></i> ${escapeHtml(round.name)}</span>
                        <small>${round.matches.length} jogos</small>
                    </div>
                    <div class="bracket-round-matches">
                    ${round.matches.map((match, mIdx) => {
                        const status = matchStatus(match);
                        const winner = getWinner(match);
                        return `
                            <article class="match-card ${winner ? 'match-card-finished' : 'match-card-pending'}">
                                <div class="match-card-header match-header">
                                    <strong class="match-id">${escapeHtml(round.name)} ${mIdx + 1}</strong>
                                    <span class="match-status ${status.cls}">${status.label}</span>
                                </div>
                                ${renderPlayerRow(match, match.p1, 'p1', rIdx, mIdx, isPreview)}
                                ${renderPlayerRow(match, match.p2, 'p2', rIdx, mIdx, isPreview)}
                                <div class="match-footer">
                                    <span>${winner ? `Vencedor: ${escapeHtml(winner)}` : (isPreview ? 'Previa do confronto' : 'Definir vencedor')}</span>
                                </div>
                            </article>
                        `;
                    }).join('')}
                    </div>
                </section>
                ${rIdx < activeBracket.rounds.length - 1 ? connectorColumn(round, rIdx) : ''}
            `).join('')}
            ${activeChampion ? `
                <div class="bracket-connector-column champion-connector" style="--slot:${slotBase * (2 ** (activeBracket.rounds.length - 1))}px" aria-hidden="true">
                    <span class="bracket-champion-line"></span>
                </div>
                <section class="phase-column bracket-round champion-column" style="--slot:${slotBase * (2 ** (activeBracket.rounds.length - 1))}px">
                    <div class="phase-title"><span><i class="ph-fill ph-crown-simple"></i> Campeão</span></div>
                    <div class="bracket-round-matches">
                        <div class="champion-card">
                            <i class="ph-fill ph-trophy"></i>
                            <strong>${escapeHtml(activeChampion)}</strong>
                            <span>Título confirmado</span>
                        </div>
                    </div>
                </section>
            ` : ''}
        </div>`;
    }

    function updateBadges(matches, bracket = state.bracket, champion = state.champion) {
        const finalized = matches.filter(match => isResolved(match)).length;
        const pending = Math.max(0, matches.length - finalized);
        const currentRound = bracket?.rounds?.find(round => round.matches.some(match => !isResolved(match)));
        $('#badge-finalized').innerHTML = `<i class="ph ph-check-circle"></i> Finalizadas: ${finalized}`;
        $('#badge-pending').innerHTML = `<i class="ph ph-clock"></i> Pendentes: ${pending}`;
        $('#badge-phase').innerHTML = `<i class="ph ph-flag"></i> Fase atual: ${champion ? 'Finalizado' : (currentRound?.name || 'Aguardando')}`;
    }

    function renderRanking() {
        syncRankingWithActiveParticipants();
        const activeNames = activeParticipantNames();
        const ranking = Object.values(getRanking())
            .filter(row => activeNames.has(normalizeName(row.name)))
            .sort(sinucaRankingSort);
        const body = $('#ranking-body');
        if (!ranking.length) {
            body.innerHTML = `<tr><td colspan="9">Nenhum ranking salvo ainda.</td></tr>`;
            return;
        }
        body.innerHTML = ranking.map((row, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${escapeHtml(row.name)}</td>
                <td>${row.jogos || 0}</td>
                <td>${row.vitorias || 0}</td>
                <td>${row.derrotas || 0}</td>
                <td>${Math.round(winRate(row) * 100)}%</td>
                <td>${row.titulos || 0}</td>
                <td>${row.finais || 0}</td>
                <td>${row.semifinais || 0}</td>
            </tr>
        `).join('');
    }

    function renderHistory() {
        const list = $('#history-list');
        const detail = $('#history-detail');
        const history = getHistory();
        if (!history.length) {
            list.innerHTML = `<div class="empty-state">Nenhum torneio de Sinuca encerrado ainda.</div>`;
            detail.innerHTML = '';
            selectedHistoryId = null;
            return;
        }
        list.innerHTML = history.map(item => `
            <article class="history-card ${String(item.id) === String(selectedHistoryId) ? 'active' : ''}" data-history-open="${escapeHtml(item.id)}">
                <h3>${escapeHtml(item.name)}</h3>
                <p>Campeão: <strong>${escapeHtml(item.champion)}</strong></p>
                <p>${item.participants} participantes • ${new Date(item.finishedAt).toLocaleString('pt-BR')}</p>
                <div class="history-actions">
                    <button class="history-button" data-history-open="${escapeHtml(item.id)}"><i class="ph ph-eye"></i> Abrir</button>
                    ${isOrganizer ? `<button class="history-button danger" data-history-delete="${escapeHtml(item.id)}"><i class="ph ph-trash"></i> Deletar</button>` : ''}
                </div>
            </article>
        `).join('');
        const selected = history.find(item => String(item.id) === String(selectedHistoryId));
        detail.innerHTML = selected ? renderHistoryDetail(selected) : '';
    }

    function renderHistoryDetail(item) {
        return `
            <section class="history-detail-card">
                <div class="history-detail-header">
                    <div>
                        <span class="eyebrow">Torneio encerrado</span>
                        <h2>${escapeHtml(item.name)}</h2>
                        <p>CampeÃ£o: <strong>${escapeHtml(item.champion)}</strong> - ${new Date(item.finishedAt).toLocaleString('pt-BR')}</p>
                    </div>
                    <span class="glass-pill">${item.participants || item.participantsList?.length || 0} jogadores</span>
                </div>
                <div class="history-detail-grid">
                    ${item.groups?.length ? `
                    <div>
                        <h3>Grupos</h3>
                        ${renderHistoryGroups(item.groups)}
                    </div>
                    ` : ''}
                    <div>
                        <h3>Mata-mata</h3>
                        ${renderHistoryBracket(item.bracket)}
                    </div>
                    <div>
                        <h3>Ranking do torneio</h3>
                        ${renderHistoryRanking(item.rankingFinal)}
                    </div>
                </div>
            </section>
        `;
    }

    function renderHistoryGroups(groups) {
        return `
            <div class="history-ranking-list">
                ${groups.map(group => `
                    <div class="history-ranking-row">
                        <span>${escapeHtml(group.name || 'Grupo')}</span>
                        <strong>${(group.players || group.teams || []).map(player => escapeHtml(player.name || player)).join(', ') || 'Sem jogadores'}</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderHistoryBracket(bracket) {
        if (!bracket?.rounds?.length) return `<div class="empty-state">Mata-mata nao salvo neste historico.</div>`;
        return `
            <div class="history-bracket">
                ${bracket.rounds.map(round => `
                    <section class="history-round">
                        <h4>${escapeHtml(round.name)}</h4>
                        ${round.matches.map((match, index) => {
                            const winner = getWinner(match);
                            return `
                                <div class="history-match">
                                    <strong>Jogo ${index + 1}</strong>
                                    <span class="${winner === match.p1 ? 'winner-name' : ''}">${escapeHtml(match.p1 || 'A definir')}</span>
                                    <span class="${winner === match.p2 ? 'winner-name' : ''}">${escapeHtml(match.p2 || 'A definir')}</span>
                                    <small>${winner ? `Vencedor: ${escapeHtml(winner)}` : 'Sem vencedor'}</small>
                                </div>
                            `;
                        }).join('')}
                    </section>
                `).join('')}
            </div>
        `;
    }

    function renderHistoryRanking(ranking) {
        if (!ranking?.length) return `<div class="empty-state">Ranking nao salvo neste historico.</div>`;
        return `
            <div class="history-ranking-list">
                ${ranking.map((row, index) => `
                    <div class="history-ranking-row">
                        <span>#${index + 1}</span>
                        <strong>${escapeHtml(row.name)}</strong>
                        <small>${row.vitorias || 0}V - ${row.derrotas || 0}D - ${Math.round(winRate(row) * 100)}% aprov.</small>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function deleteHistoryItem(id) {
        if (!isOrganizer) return;
        const history = getHistory();
        const item = history.find(entry => String(entry.id) === String(id));
        if (!item) return;
        if (!confirm(`Deletar "${item.name}" do historico?`)) return;
        setHistory(history.filter(entry => String(entry.id) !== String(id)));
        if (String(selectedHistoryId) === String(id)) selectedHistoryId = null;
        renderHistory();
    }

    function getParticipantStatus(playerName) {
        const name = String(playerName || '');
        if (state.champion === name) {
            return { key: 'campeao', label: 'Campeao', detail: 'Titulo confirmado', cls: 'champion' };
        }

        if (!state.bracket?.rounds?.length) {
            return { key: 'aguardando', label: 'Aguardando', detail: 'Chaveamento pendente', cls: 'waiting' };
        }

        let lastAdvance = null;
        for (let rIdx = 0; rIdx < state.bracket.rounds.length; rIdx++) {
            const round = state.bracket.rounds[rIdx];
            for (const match of round.matches || []) {
                if (match.p1 !== name && match.p2 !== name) continue;
                const winner = getWinner(match);
                const opponent = match.p1 === name ? match.p2 : match.p1;

                if (winner && winner !== name && isRealPlayer(winner)) {
                    return { key: 'eliminado', label: 'Eliminado', detail: `Eliminado em ${round.name}`, cls: 'eliminated' };
                }

                if (!winner) {
                    return isRealPlayer(opponent)
                        ? { key: 'ativo', label: 'Em disputa', detail: `Jogando ${round.name}`, cls: 'active' }
                        : { key: 'classificado', label: 'Classificado', detail: `Aguardando adversario em ${round.name}`, cls: 'qualified' };
                }

                if (winner === name) {
                    const nextRound = state.bracket.rounds[rIdx + 1]?.name;
                    lastAdvance = {
                        key: nextRound ? 'classificado' : 'campeao',
                        label: nextRound ? 'Classificado' : 'Campeao',
                        detail: nextRound ? `Classificado para ${nextRound}` : 'Titulo confirmado',
                        cls: nextRound ? 'qualified' : 'champion'
                    };
                }
            }
        }

        return lastAdvance || { key: 'aguardando', label: 'Aguardando', detail: 'Aguardando partida', cls: 'waiting' };
    }

    function participantMatchesFilter(player) {
        const name = String(player?.name || '');
        const status = getParticipantStatus(name);
        const searchOk = !participantSearchTerm || normalizeName(name).includes(normalizeName(participantSearchTerm));
        const statusOk = participantStatusFilter === 'todos' || status.key === participantStatusFilter;
        return searchOk && statusOk;
    }

    function sanitizeLiveText(value, maxLength = 200) {
        return String(value ?? '')
            .replace(/<[^>]*>/g, '')
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength);
    }

    function extractYouTubeVideoId(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

        try {
            const parsed = new URL(raw);
            const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
            const pathParts = parsed.pathname.split('/').filter(Boolean);

            if (host === 'youtu.be' && pathParts[0]) return pathParts[0].slice(0, 11);
            if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
                const watchId = parsed.searchParams.get('v');
                if (watchId) return watchId.slice(0, 11);
                if (['embed', 'shorts', 'live'].includes(pathParts[0]) && pathParts[1]) return pathParts[1].slice(0, 11);
            }
        } catch (_) {
            const match = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
            if (match) return match[1];
        }

        return '';
    }

    function getYouTubeEmbedUrl(url) {
        const id = extractYouTubeVideoId(url);
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    }

    function getYouTubeWatchUrl(url) {
        const id = extractYouTubeVideoId(url);
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : '';
    }

    function setLiveText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function setLiveFeedback(message, isWarning = false) {
        const feedback = $('#liveSettingsFeedback');
        if (!feedback) return;
        feedback.textContent = message || '';
        feedback.classList.toggle('is-warning', !!isWarning);
    }

    async function withLivePassword(action) {
        if (!isOrganizer) return;
        const password = prompt('Digite a senha do organizador:');
        if (password !== RESET_CODE_PASSWORD) {
            alert('Senha incorreta.');
            return;
        }
        await action();
    }

    function ensureRodrigoPaulaModal() {
        let modal = document.getElementById('rpPrivateModal');
        if (modal) return modal;

        modal = document.createElement('section');
        modal.id = 'rpPrivateModal';
        modal.className = 'rp-private-modal';
        modal.hidden = true;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'rpPrivateTitle');
        modal.innerHTML = `
            <div class="rp-private-card">
                <span class="eyebrow">Area privada</span>
                <h2 id="rpPrivateTitle">Rodrigo & Paula</h2>
                <p>Digite a senha para entrar no cinema privado.</p>
                <form id="rpPrivateForm" class="rp-private-form">
                    <label class="field">
                        <span>Senha</span>
                        <input id="rpPrivatePassword" type="password" autocomplete="current-password" inputmode="text">
                    </label>
                    <div id="rpPrivateError" class="rp-private-error" role="alert"></div>
                    <div class="rp-private-actions">
                        <button class="btn primary" type="submit"><i class="ph ph-lock-key"></i> Entrar</button>
                        <button class="btn secondary" type="button" id="rpPrivateCancel">Cancelar</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => {
            modal.hidden = true;
            $('#rpPrivatePassword').value = '';
            $('#rpPrivateError').textContent = '';
        };

        $('#rpPrivateCancel')?.addEventListener('click', closeModal);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeModal();
        });
        $('#rpPrivateForm')?.addEventListener('submit', event => {
            event.preventDefault();
            const password = $('#rpPrivatePassword')?.value || '';
            if (password !== RP_PRIVATE_PASSWORD) {
                $('#rpPrivateError').textContent = 'Senha incorreta.';
                $('#rpPrivatePassword')?.focus();
                return;
            }
            window.location.href = new URL('../Rodrigo-Paula/index.html?host=rodrigo', window.location.href).toString();
        });

        return modal;
    }

    function openRodrigoPaulaGate() {
        const modal = ensureRodrigoPaulaModal();
        modal.hidden = false;
        setTimeout(() => $('#rpPrivatePassword')?.focus(), 60);
    }

    function renderLiveTabStatus() {
        const live = ensureLiveState();
        const tab = document.querySelector('.tab[data-tab="ao-vivo"]');
        if (tab) tab.classList.toggle('live-tab-active', !!live.enabled);
    }

    function postLivePlayerCommand(func, args = []) {
        const iframe = $('#liveYoutubeIframe');
        if (!iframe?.contentWindow || iframe.hidden) return;
        iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func,
            args
        }), '*');
    }

    function updateLivePlayerButtons() {
        const playIcon = $('#livePlayToggle i');
        const muteIcon = $('#liveMuteToggle i');
        if (playIcon) playIcon.className = livePlayerPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        if (muteIcon) muteIcon.className = livePlayerMuted ? 'ph-fill ph-speaker-slash' : 'ph-fill ph-speaker-high';
    }

    function updateLiveFullscreenButton() {
        const button = $('#liveFullscreenToggle');
        const icon = $('#liveFullscreenToggle i');
        const isFullscreen = document.fullscreenElement === $('#liveVideoWrapper');
        if (icon) icon.className = isFullscreen ? 'ph-fill ph-corners-in' : 'ph-fill ph-corners-out';
        if (button) button.title = isFullscreen ? 'Sair da tela cheia' : 'Tela cheia';
    }

    function getLiveShareUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set('role', 'visitante');
        url.searchParams.set('tab', 'ao-vivo');
        url.hash = 'ao-vivo';
        return url.toString();
    }

    async function shareLiveLink() {
        const url = getLiveShareUrl();
        if (navigator.share) {
            await navigator.share({ title: 'COPA PSYZON AO VIVO', text: 'Acompanhe a live da COPA PSYZON.', url });
            return;
        }
        await navigator.clipboard.writeText(url);
        alert('Link da live copiado!');
    }

    function updateLiveEmbed() {
        const live = ensureLiveState();
        const iframe = $('#liveYoutubeIframe');
        const emptyState = $('#liveEmptyState');
        const warning = $('#liveWarning');
        const embedUrl = getYouTubeEmbedUrl(live.youtubeUrl);
        const hasLink = !!sanitizeLiveText(live.youtubeUrl, 300);

        if (iframe) {
            if (embedUrl) {
                const origin = encodeURIComponent(window.location.origin);
                const playerUrl = `${embedUrl}?enablejsapi=1&origin=${origin}&rel=0&modestbranding=1&controls=0&playsinline=1&autoplay=1&mute=1`;
                if (iframe.src !== playerUrl) {
                    iframe.src = playerUrl;
                    livePlayerMuted = true;
                    livePlayerPlaying = true;
                }
                iframe.hidden = false;
            } else {
                if (iframe.src) iframe.src = '';
                iframe.hidden = true;
            }
        }

        $('#liveCustomControls')?.toggleAttribute('hidden', !embedUrl);
        $('#liveVideoWrapper')?.classList.toggle('has-live-video', !!embedUrl);
        if (embedUrl) showLiveControlsTemporarily();

        if (emptyState) {
            emptyState.hidden = !!embedUrl;
            emptyState.textContent = hasLink && !embedUrl
                ? 'Link do YouTube invalido.'
                : 'Nenhuma transmissao configurada no momento.';
        }

        if (warning) {
            const showWarning = live.enabled && !embedUrl;
            warning.hidden = !showWarning;
            warning.textContent = showWarning ? 'Adicione um link do YouTube para exibir a transmissao.' : '';
        }

        setLiveText('livePlayerStatus', live.enabled ? 'Transmissao ao vivo agora' : (embedUrl ? 'Transmissao configurada, offline' : 'Nenhuma live ativa no momento.'));
        const badge = $('#livePlayerBadge');
        if (badge) {
            badge.textContent = live.enabled ? 'AO VIVO' : 'OFFLINE';
            badge.classList.toggle('live-on', !!live.enabled);
        }
        $$('.live-status-dot').forEach(dot => dot.classList.toggle('is-live', !!live.enabled));
        updateLivePlayerButtons();
    }

    function showLiveControlsTemporarily() {
        const wrapper = $('#liveVideoWrapper');
        if (!wrapper?.classList.contains('has-live-video')) return;
        wrapper.classList.add('controls-visible');
        clearTimeout(liveControlsHideTimer);
        liveControlsHideTimer = setTimeout(() => {
            wrapper.classList.remove('controls-visible');
        }, 3000);
    }

    function renderLiveAuth() {
        const authBox = $('#liveAuthBox');
        const loginBtn = $('#liveGoogleLogin');
        const logoutBtn = $('#liveGoogleLogout');
        const userName = $('#liveAuthUserName');
        const userPhoto = $('#liveAuthUserPhoto');
        const textInput = $('#liveCommentText');
        const isLogged = !!liveUser;

        if (authBox) authBox.classList.toggle('is-logged', isLogged);
        if (loginBtn) loginBtn.hidden = isLogged;
        if (logoutBtn) logoutBtn.hidden = !isLogged;
        if (userName) userName.textContent = isLogged ? (liveUser.displayName || liveUser.email || 'Conta Google') : 'Fazer login para comentar';
        if (userPhoto) {
            userPhoto.src = isLogged && liveUser.photoURL ? liveUser.photoURL : '';
            userPhoto.hidden = !isLogged || !liveUser.photoURL;
        }
        if (textInput) {
            textInput.disabled = !isLogged;
            textInput.placeholder = isLogged ? 'Escreva um comentario...' : 'Faca login para comentar';
        }
    }

    function renderLiveCurrentMatch() {
        const live = ensureLiveState();
        setLiveText('liveCurrentMatchTitle', sanitizeLiveText(live.currentMatchTitle, 80) || 'Aguardando definicao da partida atual.');
        setLiveText('livePlayer1Name', sanitizeLiveText(live.currentPlayer1, 40) || 'Jogador 1');
        setLiveText('livePlayer2Name', sanitizeLiveText(live.currentPlayer2, 40) || 'Jogador 2');
        setLiveText('liveScore1', String(Math.max(0, Number(live.scorePlayer1) || 0)));
        setLiveText('liveScore2', String(Math.max(0, Number(live.scorePlayer2) || 0)));
        setLiveText('livePhaseName', sanitizeLiveText(live.phaseName, 50) || 'Fase nao definida');
        setLiveText('liveTableName', sanitizeLiveText(live.tableName, 50) || 'Mesa nao definida');

        const matchBadge = $('#liveMatchBadge');
        if (matchBadge) {
            matchBadge.textContent = live.enabled ? 'AO VIVO' : 'OFFLINE';
            matchBadge.classList.toggle('is-live', !!live.enabled);
        }
        $$('.live-mini-dot').forEach(dot => dot.classList.toggle('is-live', !!live.enabled));
    }

    function populateLivePlayerSelect(selectId, manualId, selectedName) {
        const select = document.getElementById(selectId);
        const manual = document.getElementById(manualId);
        if (!select) return;
        const selected = sanitizeLiveText(selectedName, 40);
        const names = (state.participants || []).map(player => player.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));

        select.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = names.length ? 'Selecionar participante' : 'Sem participantes cadastrados';
        select.appendChild(empty);

        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });

        if (selected && names.includes(selected)) {
            select.value = selected;
            if (manual) manual.value = '';
        } else {
            select.value = '';
            if (manual) manual.value = selected;
        }
    }

    function renderLiveAdminPanel() {
        const panel = $('#liveAdminPanel');
        if (!panel) return;
        panel.hidden = !isOrganizer;
        if (!isOrganizer) return;
        const form = $('#liveSettingsForm');
        if (form?.contains(document.activeElement)) return;

        const live = ensureLiveState();
        $('#liveYoutubeUrl').value = live.youtubeUrl || '';
        $('#liveEnabled').checked = !!live.enabled;
        $('#liveCurrentMatchInput').value = live.currentMatchTitle || '';
        $('#livePhaseNameInput').value = live.phaseName || '';
        $('#liveScore1Input').value = live.scorePlayer1 ?? 0;
        $('#liveScore2Input').value = live.scorePlayer2 ?? 0;
        $('#liveTableNameInput').value = live.tableName || '';
        $('#livePinnedMessageInput').value = live.pinnedMessage || '';
        populateLivePlayerSelect('livePlayer1Select', 'livePlayer1Manual', live.currentPlayer1);
        populateLivePlayerSelect('livePlayer2Select', 'livePlayer2Manual', live.currentPlayer2);

        const toggleComments = $('#btn-live-toggle-comments');
        if (toggleComments) {
            toggleComments.innerHTML = live.commentsEnabled
                ? '<i class="ph-fill ph-chat-circle"></i> Desativar comentarios'
                : '<i class="ph-fill ph-chat-circle"></i> Ativar comentarios';
        }
    }

    function renderLiveInfo() {
        const live = ensureLiveState();
        const embedUrl = getYouTubeEmbedUrl(live.youtubeUrl);
        const infoCard = $('.live-info-card');
        const playerHeader = $('.live-player-header');
        if (infoCard) infoCard.hidden = !isOrganizer;
        if (playerHeader) playerHeader.hidden = !isOrganizer;
        setLiveText('liveSectionStatus', live.enabled ? 'AO VIVO' : 'Offline');
        setLiveText('liveInfoStatus', live.enabled ? 'Ao vivo agora' : (embedUrl ? 'Offline' : 'Nao configurada'));
        setLiveText('liveInfoPlayer', embedUrl ? 'YouTube pronto' : 'Sem link');
        setLiveText('liveInfoComments', live.commentsEnabled ? 'Ativados' : 'Desativados');
        $('#liveSectionStatus')?.classList.toggle('is-live', !!live.enabled);
    }

    function renderLiveComments() {
        const live = ensureLiveState();
        const comments = [...live.comments]
            .filter(comment => comment && comment.text)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 20)
            .reverse();
        setLiveText('liveCommentCount', String(comments.length));

        const pinned = $('#livePinnedMessage');
        if (pinned) {
            const message = sanitizeLiveText(live.pinnedMessage, 160);
            pinned.hidden = !message;
            pinned.textContent = message ? `Mensagem fixada: ${message}` : '';
        }

        const disabled = $('#liveCommentsDisabled');
        const form = $('#liveCommentForm');
        if (disabled) disabled.hidden = live.commentsEnabled;
        if (form) form.hidden = !live.commentsEnabled;
        renderLiveAuth();

        const list = $('#liveCommentsList');
        if (!list) return;
        list.replaceChildren();
        if (!comments.length) {
            const empty = document.createElement('div');
            empty.className = 'live-comments-empty';
            empty.textContent = 'Seja o primeiro a comentar.';
            list.appendChild(empty);
            return;
        }

        comments.forEach(comment => {
            const item = document.createElement('article');
            item.className = 'live-comment-item';

            const meta = document.createElement('div');
            meta.className = 'live-comment-meta';

            const name = document.createElement('strong');
            name.textContent = sanitizeLiveText(comment.name, 40) || 'Visitante';
            if (comment.photoURL) {
                const avatar = document.createElement('img');
                avatar.className = 'live-comment-avatar';
                avatar.src = sanitizeLiveText(comment.photoURL, 300);
                avatar.alt = '';
                meta.appendChild(avatar);
            }

            const time = document.createElement('span');
            time.textContent = new Date(Number(comment.createdAt) || Date.now()).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            meta.append(name, time);

            const text = document.createElement('p');
            text.className = 'live-comment-text';
            text.textContent = sanitizeLiveText(comment.text, 200);
            item.append(meta, text);

            if (isOrganizer) {
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'live-comment-delete';
                deleteBtn.dataset.liveCommentDelete = String(comment.id || '');
                deleteBtn.textContent = 'Excluir';
                item.appendChild(deleteBtn);
            }

            list.appendChild(item);
        });
        list.scrollTop = list.scrollHeight;
    }

    function renderLiveSection() {
        ensureLiveState();
        updateLiveEmbed();
        renderLiveCurrentMatch();
        renderLiveInfo();
        renderLiveComments();
        renderLiveAdminPanel();
        renderLiveTabStatus();
    }

    function normalizeLiveScore(value) {
        const score = parseInt(value, 10);
        return Number.isFinite(score) && score > 0 ? Math.min(score, 999) : 0;
    }

    async function saveLiveSettings() {
        if (!isOrganizer) return;
        const youtubeUrl = sanitizeLiveText($('#liveYoutubeUrl')?.value, 300);
        if (youtubeUrl && !getYouTubeEmbedUrl(youtubeUrl)) {
            setLiveFeedback('Link do YouTube invalido. Use youtube.com/watch, youtu.be ou /embed/.', true);
            return;
        }

        const live = ensureLiveState();
        const p1Manual = sanitizeLiveText($('#livePlayer1Manual')?.value, 40);
        const p2Manual = sanitizeLiveText($('#livePlayer2Manual')?.value, 40);
        const p1Select = sanitizeLiveText($('#livePlayer1Select')?.value, 40);
        const p2Select = sanitizeLiveText($('#livePlayer2Select')?.value, 40);

        state.live = {
            ...live,
            enabled: $('#liveEnabled')?.checked === true,
            youtubeUrl,
            currentMatchTitle: sanitizeLiveText($('#liveCurrentMatchInput')?.value, 80),
            currentPlayer1: p1Manual || p1Select,
            currentPlayer2: p2Manual || p2Select,
            scorePlayer1: normalizeLiveScore($('#liveScore1Input')?.value),
            scorePlayer2: normalizeLiveScore($('#liveScore2Input')?.value),
            phaseName: sanitizeLiveText($('#livePhaseNameInput')?.value, 50),
            tableName: sanitizeLiveText($('#liveTableNameInput')?.value, 50),
            pinnedMessage: sanitizeLiveText($('#livePinnedMessageInput')?.value, 160)
        };
        persist();
        await syncTournamentToFirebase();
        renderLiveSection();
        setLiveFeedback('Transmissao atualizada com sucesso.');
    }

    async function addLiveComment(nameValue, textValue) {
        const live = ensureLiveState();
        if (!live.commentsEnabled) return;
        if (!liveUser) {
            await signInWithPopup(auth, googleProvider);
            if (!auth.currentUser) return;
        }
        const text = sanitizeLiveText(textValue, 200);
        if (!text) return;
        live.comments = [{
            id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uid: auth.currentUser?.uid || '',
            name: sanitizeLiveText(auth.currentUser?.displayName || nameValue, 40) || 'Conta Google',
            photoURL: sanitizeLiveText(auth.currentUser?.photoURL, 300),
            text,
            createdAt: Date.now(),
            approved: true
        }, ...(live.comments || [])].slice(0, 20);
        persist();
        await syncTournamentToFirebase();
        renderLiveComments();
    }

    async function clearLiveComments() {
        const live = ensureLiveState();
        if (!confirm('Limpar todos os comentarios da live?')) return;
        live.comments = [];
        persist();
        await syncTournamentToFirebase();
        renderLiveSection();
    }

    async function toggleLiveComments() {
        const live = ensureLiveState();
        live.commentsEnabled = !live.commentsEnabled;
        persist();
        await syncTournamentToFirebase();
        renderLiveSection();
    }

    async function deleteLiveComment(commentId) {
        const live = ensureLiveState();
        live.comments = (live.comments || []).filter(comment => String(comment.id) !== String(commentId));
        persist();
        await syncTournamentToFirebase();
        renderLiveSection();
    }

    function renderParticipants() {
        $('#participant-count').textContent = `${state.participants.length} inscritos`;
        const list = $('#participants-list');
        if (!state.participants.length) {
            list.innerHTML = `<div class="empty-state">Nenhum participante cadastrado ainda.</div>`;
            return;
        }
        const filtered = state.participants.filter(participantMatchesFilter);
        $('#participant-count').textContent = participantSearchTerm || participantStatusFilter !== 'todos'
            ? `${filtered.length}/${state.participants.length} exibidos`
            : `${state.participants.length} inscritos`;
        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">Nenhum participante encontrado com esses filtros.</div>`;
            return;
        }
        list.innerHTML = filtered.map((p, idx) => {
            const status = getParticipantStatus(p.name);
            return `
            <div class="participant-item">
                <span class="participant-avatar">${initials(p.name)}</span>
                <span class="participant-main">
                    <span class="participant-name">${idx + 1}. ${escapeHtml(p.name)}</span>
                    <small>${escapeHtml(status.detail)}</small>
                </span>
                <span class="participant-status ${status.cls}">${escapeHtml(status.label)}</span>
                ${isOrganizer ? `<button class="remove-participant" data-remove-id="${escapeHtml(p.id)}" title="Remover"><i class="ph ph-trash"></i></button>` : ''}
            </div>
        `}).join('');
    }

    function renderCodes() {
        const list = $('#codes-list');
        if (!state.codes?.length) {
            list.innerHTML = `<div class="empty-state">Nenhum codigo gerado.</div>`;
            return;
        }
        list.innerHTML = state.codes.map(item => {
            const unavailable = item.used || item.status === 'used';
            return `
                <div class="code-chip ${unavailable ? 'is-unavailable' : ''}">
                    <div class="code-main">
                        <strong>${escapeHtml(item.code)}</strong>
                        <span>${unavailable ? 'Indisponivel' : 'Disponivel'}</span>
                    </div>
                    <div class="code-actions">
                        <button type="button" class="code-action" data-copy-code="${escapeHtml(item.code)}" title="Copiar codigo"><i class="ph ph-copy"></i></button>
                        ${unavailable && isOrganizer ? `<button type="button" class="code-action danger" data-reset-code="${escapeHtml(item.code)}" title="Resetar codigo"><i class="ph ph-arrow-counter-clockwise"></i></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderRole() {
        $('#role-badge').textContent = role.toUpperCase();
        $('#organizer-panel').hidden = !isOrganizer;
        $('#btn-toggle-organizer').hidden = !isOrganizer;
        $('#participant-form').hidden = !isOrganizer;
        $('#organizer-panel').style.display = isOrganizer ? 'flex' : 'none';
        $('#btn-toggle-organizer').style.display = isOrganizer ? '' : 'none';
        $('#participant-form').style.display = isOrganizer ? 'grid' : 'none';
        $('#tourney-name').value = state.name;
        $('#participant-limit').value = state.participantLimit;
    }

    function renderTestPanel() {
        const statusEl = $('#test-status');
        const participantsEl = $('#test-participants');
        if (statusEl) statusEl.textContent = state.champion ? 'Finalizado' : (state.status || 'Aguardando');
        if (participantsEl) participantsEl.textContent = String(state.participants?.length || 0);
    }

    function renderAll() {
        ensureLiveState();
        renderRole();
        renderTestPanel();
        renderParticipants();
        renderCodes();
        renderBracket();
        renderRanking();
        renderHistory();
        renderLiveSection();
    }

    function switchTab(tabName) {
        $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        $$('.tab-content').forEach(content => content.classList.toggle('active', content.id === `tab-${tabName}`));
        if (tabName === 'ao-vivo') {
            renderLiveSection();
            setTimeout(() => postLivePlayerCommand('playVideo'), 350);
        }
    }

    function getInitialTab() {
        const requested = params.get('tab') || window.location.hash.replace('#', '');
        return requested === 'ao-vivo' ? 'ao-vivo' : (!isOrganizer ? 'mata-mata' : '');
    }

    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    $('#btn-toggle-organizer').addEventListener('click', (event) => {
        if (!isOrganizer) return;
        event.stopPropagation();
        $('#organizer-panel').classList.toggle('active');
    });

    $('#participant-form').addEventListener('submit', event => {
        event.preventDefault();
        if (!isOrganizer) return;
        addParticipant($('#participant-name').value);
        $('#participant-name').value = '';
    });

    $('#participant-search')?.addEventListener('input', event => {
        participantSearchTerm = event.target.value || '';
        renderParticipants();
    });

    $('#participant-status-filter')?.addEventListener('change', event => {
        participantStatusFilter = event.target.value || 'todos';
        renderParticipants();
    });

    $('#liveSettingsForm')?.addEventListener('submit', event => {
        event.preventDefault();
        withLivePassword(saveLiveSettings);
    });

    $('#liveCommentForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const textInput = $('#liveCommentText');
        const text = sanitizeLiveText(textInput?.value, 200);
        if (!text) {
            if (textInput) textInput.value = '';
            return;
        }
        await addLiveComment($('#liveCommentName')?.value, text);
        if (textInput) textInput.value = '';
    });
    $('#liveCommentText')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        $('#liveCommentForm')?.requestSubmit();
    });

    $('#liveGoogleLogin')?.addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            liveUser = result.user;
            renderLiveAuth();
        } catch {
            alert('Nao foi possivel entrar com Google.');
        }
    });
    $('#liveGoogleLogout')?.addEventListener('click', () => signOut(auth));
    $('#livePlayToggle')?.addEventListener('click', () => {
        livePlayerPlaying = !livePlayerPlaying;
        postLivePlayerCommand(livePlayerPlaying ? 'playVideo' : 'pauseVideo');
        updateLivePlayerButtons();
    });
    $('#liveMuteToggle')?.addEventListener('click', () => {
        livePlayerMuted = !livePlayerMuted;
        postLivePlayerCommand(livePlayerMuted ? 'mute' : 'unMute');
        updateLivePlayerButtons();
    });
    $('#liveFullscreenToggle')?.addEventListener('click', () => {
        const wrapper = $('#liveVideoWrapper');
        if (document.fullscreenElement === wrapper) {
            document.exitFullscreen?.();
        } else if (wrapper?.requestFullscreen) {
            wrapper.requestFullscreen();
        }
        document.activeElement?.blur?.();
        showLiveControlsTemporarily();
        updateLiveFullscreenButton();
    });
    $('#liveShareButton')?.addEventListener('click', () => shareLiveLink().catch(() => alert('Nao foi possivel compartilhar a live.')));
    document.addEventListener('fullscreenchange', updateLiveFullscreenButton);
    $('#liveVideoWrapper')?.addEventListener('pointermove', showLiveControlsTemporarily);
    document.addEventListener('mousemove', () => {
        const wrapper = $('#liveVideoWrapper');
        if (document.fullscreenElement === wrapper) showLiveControlsTemporarily();
    });
    $('#liveVideoWrapper')?.addEventListener('pointerleave', () => {
        clearTimeout(liveControlsHideTimer);
        liveControlsHideTimer = setTimeout(() => {
            $('#liveVideoWrapper')?.classList.remove('controls-visible');
        }, 3000);
    });

    $('#btn-live-clear-comments')?.addEventListener('click', () => withLivePassword(clearLiveComments));
    $('#btn-live-toggle-comments')?.addEventListener('click', () => withLivePassword(toggleLiveComments));
    $('#liveCommentsList')?.addEventListener('click', event => {
        const deleteButton = event.target.closest('[data-live-comment-delete]');
        if (!deleteButton) return;
        withLivePassword(() => deleteLiveComment(deleteButton.dataset.liveCommentDelete));
    });

    document.addEventListener('click', event => {
        if (window.innerWidth <= 900 && $('#organizer-panel').classList.contains('active')) {
            const panel = $('#organizer-panel');
            const toggle = $('#btn-toggle-organizer');
            if (!panel.contains(event.target) && !toggle.contains(event.target)) {
                panel.classList.remove('active');
            }
        }

        const privateEntry = event.target.closest('#rpSecretEntry');
        if (privateEntry) {
            event.preventDefault();
            event.stopPropagation();
            openRodrigoPaulaGate();
            return;
        }

        const removeButton = event.target.closest('[data-remove-id]');
        if (removeButton) removeParticipant(removeButton.dataset.removeId);

        const copyCodeButton = event.target.closest('[data-copy-code]');
        if (copyCodeButton) {
            copyCode(copyCodeButton.dataset.copyCode);
            return;
        }

        const resetCodeButton = event.target.closest('[data-reset-code]');
        if (resetCodeButton) {
            resetCode(resetCodeButton.dataset.resetCode);
            return;
        }

        const winButton = event.target.closest('[data-winner]');
        if (winButton) defineWinner(Number(winButton.dataset.r), Number(winButton.dataset.m), winButton.dataset.winner);

        const viewButton = event.target.closest('[data-knockout-view]');
        if (viewButton) {
            knockoutViewMode = viewButton.dataset.knockoutView === 'list' ? 'list' : 'tree';
            localStorage.setItem(KNOCKOUT_VIEW_STORAGE_KEY, knockoutViewMode);
            renderBracket();
            return;
        }

        const deleteHistoryButton = event.target.closest('[data-history-delete]');
        if (deleteHistoryButton) {
            event.stopPropagation();
            deleteHistoryItem(deleteHistoryButton.dataset.historyDelete);
            return;
        }

        const openHistoryButton = event.target.closest('[data-history-open]');
        if (openHistoryButton) {
            selectedHistoryId = openHistoryButton.dataset.historyOpen;
            renderHistory();
        }
    });

    $('#btn-save-config').addEventListener('click', () => {
        state.name = $('#tourney-name').value.trim() || defaultState.name;
        state.participantLimit = Math.min(64, Math.max(2, Number($('#participant-limit').value) || 16));
        persist();
        syncTournamentToFirebase();
        renderAll();
        alert('Configuração da Sinuca salva.');
    });

    $('#btn-generate-codes').addEventListener('click', generateCodes);
    $('#btn-generate-bracket').addEventListener('click', buildBracket);
    $('#btn-test-players').addEventListener('click', generateTestPlayers);
    $('#btn-start-test-bracket').addEventListener('click', startTestBracket);
    $('#btn-test-results').addEventListener('click', generateTestResults);
    $('#btn-clear-test').addEventListener('click', clearTestMode);
    $('#btn-reset-results').addEventListener('click', () => {
        if (confirm('Resetar resultados do mata-mata da Sinuca?')) resetResults();
    });
    $('#btn-finish-tournament').addEventListener('click', finishTournament);
    $('#btn-reset-tournament').addEventListener('click', () => {
        if (!confirm('Resetar todo o torneio de Sinuca atual?')) return;
        state = { ...defaultState, live: createDefaultLiveState() };
        persist();
        syncTournamentToFirebase();
        renderAll();
    });

    setInterval(async () => {
        await syncLocalCodesFromPool();
        renderCodes();
    }, 10000);

    loadTournamentFromFirebase().finally(() => {
        renderAll();
        const initialTab = getInitialTab();
        if (initialTab) switchTab(initialTab);
        subscribeTournamentFromFirebase();
    });

    onAuthStateChanged(auth, (user) => {
        liveUser = user;
        renderLiveAuth();
    });
});
