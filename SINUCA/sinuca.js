import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'copaPsyzon_sinuca_tournamentState';
    const HISTORY_KEY = 'copaPsyzon_sinuca_history';
    const RANKING_KEY = 'copaPsyzon_sinuca_ranking';
    const FIREBASE_TOURNAMENT_PATH = 'tournaments/sinuca/current';
    const RESET_CODE_PASSWORD = '153090';
    const VALID_SIZES = [2, 4, 8, 16, 32, 64];

    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || localStorage.getItem('copaRole') || 'visitante';
    const isOrganizer = role === 'organizador';

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
        updatedAt: null
    };

    let state = loadState();
    let selectedHistoryId = null;

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

    function persist() {
        state.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function publicTournamentState() {
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
                persist();
            }
            await syncLocalCodesFromPool();
        } catch (error) {
            console.warn('Nao foi possivel carregar a Sinuca do Firebase:', error);
        }
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
        localStorage.setItem(RANKING_KEY, JSON.stringify(ranking));
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
        const ranking = cloneData(baseRanking) || {};
        const ensure = (name) => {
            if (!isRealPlayer(name)) return null;
            if (!ranking[name]) {
                ranking[name] = { name, jogos: 0, vitorias: 0, derrotas: 0, titulos: 0, finais: 0, semifinais: 0, pts: 0 };
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
                    w.pts += 3;
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
        if (!state.champion) {
            alert('Defina o campeão antes de encerrar.');
            return;
        }

        if (state.finishedHistoryId && !confirm('Este torneio ja foi salvo no historico. Deseja salvar uma nova copia?')) {
            return;
        }

        updateRankingFromCurrentTournament();
        const tournamentRanking = Object.values(calculateCurrentTournamentRanking({})).sort((a, b) =>
            (b.titulos || 0) - (a.titulos || 0) ||
            (b.pts || 0) - (a.pts || 0) ||
            (b.vitorias || 0) - (a.vitorias || 0) ||
            a.name.localeCompare(b.name, 'pt-BR')
        );
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
            state.participants = (state.participants || []).filter(removeOwner);
            state.registeredPlayers = (state.registeredPlayers || []).filter(removeOwner);
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
        if (state.participants.length && !confirm('Substituir os participantes atuais por jogadores de teste?')) return;
        const names = [
            'Lucas Falcao', 'Rafael Costa', 'Bruno Lima', 'Marcos Vieira',
            'Thiago Rocha', 'Pedro Nunes', 'Andre Martins', 'Felipe Souza',
            'Diego Alves', 'Victor Hugo', 'Caio Ribeiro', 'Renan Lopes',
            'Gustavo Melo', 'Joao Pedro', 'Daniel Torres', 'Matheus Reis'
        ];
        const amount = Math.min(Number(state.participantLimit) || 16, names.length);
        state.participants = names.slice(0, amount).map((name, index) => ({
            id: `test-${Date.now()}-${index}`,
            name
        }));
        state.registeredPlayers = state.participants;
        state.bracket = null;
        state.champion = null;
        state.finishedHistoryId = null;
        state.status = 'teste';
        persist();
        syncTournamentToFirebase();
        renderAll();
        alert(`${amount} jogadores de teste gerados.`);
    }

    function generateTestResults() {
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

    function removeParticipant(id) {
        if (state.bracket?.rounds?.length && !confirm('Remover participante pode invalidar o mata-mata atual. Continuar?')) return;
        state.participants = state.participants.filter(p => p.id !== id);
        state.registeredPlayers = state.participants;
        persist();
        syncTournamentToFirebase();
        renderAll();
    }

    function renderParticipants() {
        $('#participant-count').textContent = `${state.participants.length} inscritos`;
        const list = $('#participants-list');
        if (!state.participants.length) {
            list.innerHTML = `<div class="empty-state">Nenhum participante cadastrado ainda.</div>`;
            return;
        }
        list.innerHTML = state.participants.map((p, idx) => `
            <div class="participant-item">
                <span class="participant-avatar">${initials(p.name)}</span>
                <span class="participant-name">${idx + 1}. ${escapeHtml(p.name)}</span>
                ${isOrganizer ? `<button class="remove-participant" data-remove-id="${escapeHtml(p.id)}" title="Remover"><i class="ph ph-trash"></i></button>` : ''}
                </div>
                <div class="code-actions">
                    <button type="button" class="code-action" data-copy-code="${escapeHtml(item.code)}" title="Copiar codigo"><i class="ph ph-copy"></i></button>
                    ${unavailable && isOrganizer ? `<button type="button" class="code-action danger" data-reset-code="${escapeHtml(item.code)}" title="Resetar codigo"><i class="ph ph-arrow-counter-clockwise"></i></button>` : ''}
                </div>
            </div>
        </div>`;
        }).join('');
    }

    function renderCodes() {
        const list = $('#codes-list');
        if (!state.codes?.length) {
            list.innerHTML = `<div class="empty-state">Nenhum código gerado.</div>`;
            return;
        }
        list.innerHTML = state.codes.map(item => {
            const unavailable = item.used || item.status === 'used';
            item.used = unavailable;
            return `
            <div class="code-chip ${unavailable ? 'is-unavailable' : ''}">
                <div class="code-main">
                    <strong>${escapeHtml(item.code)}</strong>
                <span>${item.used ? 'Usado' : 'Disponível'}</span>
            </div>
        `).join('');
    }

    function matchStatus(match) {
        if (match.status === 'void') return { label: 'BYE', cls: 'done' };
        if (match.walkover && match.winner) return { label: 'BYE', cls: 'done' };
        if (match.winner) return { label: 'Finalizado', cls: 'done' };
        if (!isRealPlayer(match.p1) || !isRealPlayer(match.p2)) return { label: 'Aguardando', cls: 'waiting' };
        return { label: 'Pendente', cls: 'pending' };
    }

    function renderPlayerRow(match, player, side, rIdx, mIdx) {
        const winner = getWinner(match);
        const isWinnerRow = winner === player;
        const rowClass = isWinnerRow ? 'winner match-team-winner' : (winner && isRealPlayer(player) ? 'loser match-team-loser' : '');
        const canWin = isOrganizer && !winner && isRealPlayer(player) && isRealPlayer(match.p1) && isRealPlayer(match.p2);
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
        normalizeAutoAdvances();
        const container = $('#bracket-container');
        const alerts = $('#knockout-alerts');

        if (!state.bracket?.rounds?.length) {
            alerts.innerHTML = `<div class="alert"><i class="ph ph-info"></i> Cadastre participantes e gere o mata-mata.</div>`;
            container.innerHTML = `<div class="empty-state">Mata-mata ainda não gerado.</div>`;
            updateBadges([]);
            return;
        }

        const allMatches = state.bracket.rounds.flatMap(round => round.matches);
        updateBadges(allMatches);
        alerts.innerHTML = state.champion
            ? `<div class="alert"><i class="ph ph-crown-simple"></i> Campeão definido: ${escapeHtml(state.champion)}.</div>`
            : '';

        const connectorColumn = () => `<div class="bracket-connector-column" aria-hidden="true"><span class="bracket-connector top"></span><span class="bracket-connector join"></span><span class="bracket-connector bottom"></span></div>`;
        container.innerHTML = `<div class="bracket-tree">
            ${state.bracket.rounds.map((round, rIdx) => `
                <section class="phase-column bracket-round">
                    <div class="phase-title bracket-round-title">
                        <span><i class="ph ${rIdx === state.bracket.rounds.length - 1 ? 'ph-trophy' : 'ph-billiards'}"></i> ${escapeHtml(round.name)}</span>
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
                                ${renderPlayerRow(match, match.p1, 'p1', rIdx, mIdx)}
                                ${renderPlayerRow(match, match.p2, 'p2', rIdx, mIdx)}
                                <div class="match-footer">
                                    <span>${winner ? `Vencedor: ${escapeHtml(winner)}` : 'Definir vencedor'}</span>
                                </div>
                            </article>
                        `;
                    }).join('')}
                    </div>
                </section>
                ${rIdx < state.bracket.rounds.length - 1 ? connectorColumn() : ''}
            `).join('')}
            ${state.champion ? `
                <section class="phase-column bracket-round champion-column">
                    <div class="phase-title"><span><i class="ph-fill ph-crown-simple"></i> Campeão</span></div>
                    <div class="champion-card">
                        <i class="ph-fill ph-trophy"></i>
                        <strong>${escapeHtml(state.champion)}</strong>
                        <span>Título confirmado</span>
                    </div>
                </section>
            ` : ''}
        </div>`;
    }

    function updateBadges(matches) {
        const finalized = matches.filter(match => isResolved(match)).length;
        const pending = Math.max(0, matches.length - finalized);
        const currentRound = state.bracket?.rounds?.find(round => round.matches.some(match => !isResolved(match)));
        $('#badge-finalized').innerHTML = `<i class="ph ph-check-circle"></i> Finalizadas: ${finalized}`;
        $('#badge-pending').innerHTML = `<i class="ph ph-clock"></i> Pendentes: ${pending}`;
        $('#badge-phase').innerHTML = `<i class="ph ph-flag"></i> Fase atual: ${state.champion ? 'Finalizado' : (currentRound?.name || 'Aguardando')}`;
    }

    function renderRanking() {
        const ranking = Object.values(getRanking()).sort((a, b) =>
            (b.titulos || 0) - (a.titulos || 0) ||
            (b.pts || 0) - (a.pts || 0) ||
            (b.vitorias || 0) - (a.vitorias || 0) ||
            a.name.localeCompare(b.name, 'pt-BR')
        );
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
                <td>${row.titulos || 0}</td>
                <td>${row.finais || 0}</td>
                <td>${row.semifinais || 0}</td>
                <td>${row.pts || 0}</td>
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
                        <small>${row.pts || 0} pts - ${row.vitorias || 0}V - ${row.derrotas || 0}D</small>
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

    function renderParticipants() {
        $('#participant-count').textContent = `${state.participants.length} inscritos`;
        const list = $('#participants-list');
        if (!state.participants.length) {
            list.innerHTML = `<div class="empty-state">Nenhum participante cadastrado ainda.</div>`;
            return;
        }
        list.innerHTML = state.participants.map((p, idx) => `
            <div class="participant-item">
                <span class="participant-avatar">${initials(p.name)}</span>
                <span class="participant-name">${idx + 1}. ${escapeHtml(p.name)}</span>
                ${isOrganizer ? `<button class="remove-participant" data-remove-id="${escapeHtml(p.id)}" title="Remover"><i class="ph ph-trash"></i></button>` : ''}
            </div>
        `).join('');
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
        $('#organizer-panel').style.display = isOrganizer ? 'flex' : 'none';
        $('#btn-toggle-organizer').style.display = isOrganizer ? '' : 'none';
        $('#participant-form').style.display = isOrganizer ? 'grid' : 'none';
        $('#tourney-name').value = state.name;
        $('#participant-limit').value = state.participantLimit;
    }

    function renderAll() {
        renderRole();
        renderParticipants();
        renderCodes();
        renderBracket();
        renderRanking();
        renderHistory();
    }

    function switchTab(tabName) {
        $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        $$('.tab-content').forEach(content => content.classList.toggle('active', content.id === `tab-${tabName}`));
    }

    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    $('#btn-toggle-organizer').addEventListener('click', (event) => {
        event.stopPropagation();
        $('#organizer-panel').classList.toggle('active');
    });

    $('#participant-form').addEventListener('submit', event => {
        event.preventDefault();
        addParticipant($('#participant-name').value);
        $('#participant-name').value = '';
    });

    document.addEventListener('click', event => {
        if (window.innerWidth <= 900 && $('#organizer-panel').classList.contains('active')) {
            const panel = $('#organizer-panel');
            const toggle = $('#btn-toggle-organizer');
            if (!panel.contains(event.target) && !toggle.contains(event.target)) {
                panel.classList.remove('active');
            }
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
    $('#btn-test-results').addEventListener('click', generateTestResults);
    $('#btn-reset-results').addEventListener('click', () => {
        if (confirm('Resetar resultados do mata-mata da Sinuca?')) resetResults();
    });
    $('#btn-finish-tournament').addEventListener('click', finishTournament);
    $('#btn-reset-tournament').addEventListener('click', () => {
        if (!confirm('Resetar todo o torneio de Sinuca atual?')) return;
        state = { ...defaultState };
        persist();
        syncTournamentToFirebase();
        renderAll();
    });

    setInterval(async () => {
        await syncLocalCodesFromPool();
        renderCodes();
    }, 10000);

    loadTournamentFromFirebase().finally(renderAll);
});
