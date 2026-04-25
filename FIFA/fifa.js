/* ================================================
   FIFA DASHBOARD — Copa Psyzon
   Logic Controller (Firebase-Ready)
   ================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { initRankingSystem } from './ranking.js';

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

let db = null;
let analytics = null;
try {
    if (firebaseConfig.apiKey !== "SUA_API_KEY") {
        const app = initializeApp(firebaseConfig);
        analytics = getAnalytics(app);
        db = getDatabase(app);
        console.log("🔥 Firebase inicializado!");
    } else {
        console.warn("⚠️ Firebase: Configure sua API Key no fifa.js para ativar a nuvem.");
    }
} catch (e) {
    console.error("Erro ao inicializar Firebase", e);
}

document.addEventListener('DOMContentLoaded', async () => {

    // ========== ROLE DETECTION ==========
    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role') || 'visitante';
    const participantId = urlParams.get('id') || null;
    const participantName = urlParams.get('name') ? decodeURIComponent(urlParams.get('name')) : null;

    const badge = document.getElementById('user-role-badge');
    const organizerPanel = document.getElementById('organizer-panel');
    const btnExitTopbar = document.getElementById('btn-exit-topbar');
    const btnToggleOrganizer = document.getElementById('btn-toggle-organizer');

    if (role === 'organizador') {
        if (organizerPanel) organizerPanel.style.display = 'flex';
        if (btnExitTopbar) btnExitTopbar.style.display = 'none';
        if (btnToggleOrganizer) btnToggleOrganizer.style.display = 'flex';
    } else {
        if (organizerPanel) organizerPanel.style.display = 'none';
        if (btnExitTopbar) btnExitTopbar.style.display = 'flex';
        if (btnToggleOrganizer) btnToggleOrganizer.style.display = 'none';
    }

    if (role === 'participante' && participantName) {
        badge.textContent = participantName;
    } else {
        badge.textContent = role.toUpperCase();
    }

    // ========== MODAL CLOSE ON OUTSIDE CLICK ==========
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
            // Especial para o modal-perfil que usa style.display
            if (e.target.id === 'modal-perfil') {
                e.target.style.display = 'none';
            }
        }
    });

    const roleStyles = {
        organizador: { bg: 'rgba(250,204,21,0.2)', color: '#FACC15' },
        apostador:   { bg: 'rgba(59,130,246,0.2)', color: '#3B82F6' },
        visitante:   { bg: 'rgba(250,204,21,0.2)', color: '#FACC15' },
        participante:{ bg: 'rgba(34,197,94,0.15)', color: '#22C55E' },
    };

    const s = roleStyles[role] || roleStyles.visitante;
    badge.style.background = s.bg;
    badge.style.color = s.color;

    if (role === 'organizador') {
        organizerPanel.style.display = 'flex';
    }

    // Inicializa o módulo de Ranking
    initRankingSystem(db, role);

    // ========== TOURNAMENT STATE (Firebase-Ready) ==========
    let tournamentState = {
        name: '',
        participants: 8,
        format: 'grupos-mata-mata',
        homeAway: false,
        prize: '',
        status: 'aguardando', // aguardando | ativo | encerrado
        groups: [],
        codes: [],
        tournamentCode: null, // Ex: F1234
        top3: { first: '—', second: '—', third: '—' },
        createdAt: null,
    };

    let selectedGroupIndex = null;
    let selectedKnockoutMatch = null; // { type, rIdx, mIdx }

    const modalMataMata = document.getElementById('modal-jogos-mata-mata');
    const editP1Name = document.getElementById('edit-p1-name');
    const editP2Name = document.getElementById('edit-p2-name');
    const editS1 = document.getElementById('edit-s1');
    const editS2 = document.getElementById('edit-s2');
    const btnSaveKnockout = document.getElementById('btn-save-knockout');
    const SENSITIVE_PASSWORD = '153090';
    const SENSITIVE_IDS = new Set(['btn-encerrar', 'btn-resetar', 'btn-resetar-tudo', 'btn-apagar-cadastro', 'btn-resetar-codigos']);
    const modalSensitivePassword = document.getElementById('modal-sensitive-password');
    const sensitivePasswordInput = document.getElementById('sensitive-password-input');
    const sensitivePasswordError = document.getElementById('sensitive-password-error');
    const btnConfirmSensitivePassword = document.getElementById('btn-confirm-sensitive-password');
    const modalNextPhase = document.getElementById('modal-next-phase');
    const nextPhaseOrderInput = document.getElementById('next-phase-order-input');
    const nextPhasePreview = document.getElementById('next-phase-preview');
    const nextPhaseMatchEditor = document.getElementById('next-phase-match-editor');
    const ACTION_LABELS = {
        'btn-encerrar': 'Encerrar e salvar torneio',
        'btn-resetar': 'Resetar torneio (somente resultados)',
        'btn-resetar-tudo': 'Resetar tudo no torneio atual',
        'btn-apagar-cadastro': 'Apagar cadastro de participante',
        'btn-resetar-codigos': 'Resetar códigos de acesso'
    };
    let pendingSensitiveAction = null;
    let pendingNextPhaseQualified = [];
    let pendingNextPhaseMatches = [];
    let pendingNextPhaseSignature = '';
    let repechageModalShown = false;

    function isBye(value) {
        return typeof value === 'string' && value.trim().toUpperCase() === 'BYE';
    }

    function isWinnerPlaceholder(value) {
        return typeof value === 'string' && value.trim().toLowerCase().startsWith('vencedor');
    }

    function isRealPlayer(value) {
        return !!value && typeof value === 'string' && !isBye(value) && !isWinnerPlaceholder(value) && value.trim().toLowerCase() !== 'a definir' && !/^\dº grupo/i.test(value) && !/^classificado/i.test(value);
    }

    function isPlaceholder(name) {
        return !isRealPlayer(name);
    }

    function displayParticipantName(name) {
        if (!name || isWinnerPlaceholder(name)) return 'A definir';
        return name;
    }

    function getByeAutoWinner(match) {
        const p1Bye = isBye(match?.p1);
        const p2Bye = isBye(match?.p2);
        if (p1Bye && !p2Bye && isRealPlayer(match?.p2)) return match.p2;
        if (p2Bye && !p1Bye && isRealPlayer(match?.p1)) return match.p1;
        return null;
    }

    function isDoubleByeMatch(match) {
        return isBye(match?.p1) && isBye(match?.p2);
    }

    function resolveByeMatchOutcome(match) {
        if (!match) return { resolved: false, winner: null };
        const byeWinner = getByeAutoWinner(match);
        if (byeWinner) {
            match.winner = byeWinner;
            match.completed = true;
            match.walkover = true;
            match.status = 'walkover';
            match.s1 = match.p1 === byeWinner ? '1' : '0';
            match.s2 = match.p2 === byeWinner ? '1' : '0';
            return { resolved: true, winner: byeWinner };
        }
        if (isDoubleByeMatch(match)) {
            match.winner = null;
            match.completed = true;
            match.walkover = false;
            match.status = 'void';
            match.s1 = '';
            match.s2 = '';
            return { resolved: true, winner: null };
        }
        return { resolved: false, winner: null };
    }

    function clearMatchResultFields(match) {
        if (!match) return;
        ['s1', 's2', 'pen', 'pen1', 'pen2', 'winner', 'status', 'finished', 'completed', 'walkover', 'autoAdvance', 'idaS1', 'idaS2', 'voltaS1', 'voltaS2'].forEach(key => {
            delete match[key];
        });
        match.s1 = '';
        match.s2 = '';
        match.pen1 = '';
        match.pen2 = '';
        match.winner = null;
        match.status = 'pending';
        match.completed = false;
        match.walkover = false;
    }

    function createMatchData(p1, p2, winnerToken, extra = {}) {
        return {
            p1,
            p2,
            p1Source: p1,
            p2Source: p2,
            winnerToken,
            s1: '',
            s2: '',
            pen1: '',
            pen2: '',
            winner: null,
            status: 'pending',
            completed: false,
            walkover: false,
            ...extra
        };
    }

    function getGroupLeaders(position = 0) {
        const leaders = [];
        (tournamentState.groups || []).forEach(g => {
            const sorted = [...(g.players || [])].sort((a, b) => {
                if ((b.pts || 0) !== (a.pts || 0)) return (b.pts || 0) - (a.pts || 0);
                if ((b.sg || 0) !== (a.sg || 0)) return (b.sg || 0) - (a.sg || 0);
                return (b.gp || 0) - (a.gp || 0);
            });
            if (sorted[position] && !isPlaceholder(sorted[position].name)) leaders.push(sorted[position].name);
        });
        return leaders;
    }

    function getKnockoutMatchWinner(match) {
        if (!match) return null;
        if (isRealPlayer(match.winner)) return match.winner;
        const byeWinner = getByeAutoWinner(match);
        if (byeWinner) return byeWinner;
        const hasResult = match.s1 !== '' && match.s2 !== '' && match.s1 != null && match.s2 != null;
        if (!hasResult) return null;
        const s1 = parseInt(match.s1);
        const s2 = parseInt(match.s2);
        if (Number.isNaN(s1) || Number.isNaN(s2)) return null;
        if (s1 > s2) return match.p1;
        if (s2 > s1) return match.p2;
        if (match.pen1 != null && match.pen2 != null && match.pen1 !== '' && match.pen2 !== '') {
            return parseInt(match.pen1) > parseInt(match.pen2) ? match.p1 : match.p2;
        }
        return null;
    }

    function recalculateGeneralStats() {
        const stats = {};
        const ensure = (name) => {
            if (!name || isPlaceholder(name)) return null;
            if (!stats[name]) stats[name] = { name, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, avancos: 0 };
            return stats[name];
        };
        const apply = (home, away, gh, ga, knockout = false) => {
            const pHome = ensure(home);
            const pAway = ensure(away);
            if (!pHome || !pAway) return;
            pHome.j++; pAway.j++;
            pHome.gp += gh; pHome.gc += ga;
            pAway.gp += ga; pAway.gc += gh;
            if (gh > ga) {
                pHome.v++; pAway.d++;
                pHome.pts += knockout ? 3 : 3;
            } else if (ga > gh) {
                pAway.v++; pHome.d++;
                pAway.pts += knockout ? 3 : 3;
            } else {
                pHome.e++; pAway.e++;
                pHome.pts += knockout ? 1 : 1;
                pAway.pts += knockout ? 1 : 1;
            }
        };

        (tournamentState.groups || []).forEach(group => {
            (group.matches || []).forEach(m => {
                if (m.gHome === '' || m.gAway === '') return;
                const gh = parseInt(m.gHome);
                const ga = parseInt(m.gAway);
                if (!Number.isNaN(gh) && !Number.isNaN(ga)) apply(m.home, m.away, gh, ga, false);
            });
        });

        if (tournamentState.knockout) {
            const allRounds = [
                ...(tournamentState.knockout.repechage || []).map(m => ({ ...m, roundName: 'Repescagem' })),
                ...((tournamentState.knockout.rounds || []).flatMap(r => (r.matches || []).map(m => ({ ...m, roundName: r.name }))))
            ];
            allRounds.forEach(m => {
                if (m.s1 === '' || m.s2 === '') return;
                const s1 = parseInt(m.s1);
                const s2 = parseInt(m.s2);
                if (!Number.isNaN(s1) && !Number.isNaN(s2)) apply(m.p1, m.p2, s1, s2, true);
                const winner = getKnockoutMatchWinner(m);
                const pWinner = ensure(winner);
                if (pWinner) pWinner.avancos += 1;
            });
        }

        Object.values(stats).forEach(p => p.sg = p.gp - p.gc);
        tournamentState.generalStats = stats;
        return stats;
    }

    function isMatchResolvedForProgression(match) {
        return !!getKnockoutMatchWinner(match) || isDoubleByeMatch(match);
    }

    function isTournamentFullyCompleted() {
        const groupsDone = (tournamentState.groups || []).every(group =>
            (group.matches || []).length > 0 &&
            group.matches.every(m => m.gHome !== '' && m.gAway !== '')
        );
        const knockoutMatches = [];
        if (tournamentState.knockout) {
            knockoutMatches.push(...(tournamentState.knockout.repechage || []));
            (tournamentState.knockout.rounds || []).forEach(r => knockoutMatches.push(...(r.matches || [])));
        }
        const knockoutDone = knockoutMatches.length === 0 || knockoutMatches.every(m => {
            if (isDoubleByeMatch(m)) return true;
            return m.s1 !== '' && m.s2 !== '' && getKnockoutMatchWinner(m);
        });
        return groupsDone && knockoutDone;
    }

    function persistCurrentTournament(extra = {}) {
        if (!db) return Promise.resolve();
        const updatedAt = new Date().toISOString();
        tournamentState.updatedAt = updatedAt;
        const payload = { ...tournamentState, ...extra, updatedAt };
        return Promise.all([
            set(ref(db, 'tournaments/current'), payload),
            tournamentState.tournamentCode ? set(ref(db, `tournaments/${tournamentState.tournamentCode}`), payload) : Promise.resolve()
        ]);
    }

    function openKnockoutEdit(type, rIdx, mIdx) {
        selectedKnockoutMatch = { type, rIdx, mIdx };
        let match;
        if (type === 'repechage') {
            match = tournamentState.knockout.repechage[mIdx];
            document.getElementById('modal-mata-mata-title').textContent = 'Resultado Repescagem';
            document.getElementById('modal-mata-mata-subtitle').textContent = 'Empate vai para pênaltis';
        } else {
            match = tournamentState.knockout.rounds[rIdx].matches[mIdx];
            document.getElementById('modal-mata-mata-title').textContent = 'Resultado ' + tournamentState.knockout.rounds[rIdx].name;
            document.getElementById('modal-mata-mata-subtitle').textContent = 'Insira o placar do confronto';
        }

        const isHomeAway = tournamentState.homeAway || false;
        const singleEl = document.getElementById('knockout-single-score');
        const legsEl = document.getElementById('knockout-legs-score');
        const penaltyEl = document.getElementById('knockout-penalty-section');

        // Reset penalty section
        penaltyEl.style.display = 'none';
        document.getElementById('edit-pen1').value = '';
        document.getElementById('edit-pen2').value = '';

        if (isHomeAway) {
            // Modo Ida e Volta
            singleEl.style.display = 'none';
            legsEl.style.display = 'block';

            document.getElementById('edit-legs-p1').textContent = formatName(displayParticipantName(match.p1));
            document.getElementById('edit-legs-p2').textContent = formatName(displayParticipantName(match.p2));

            document.getElementById('edit-ida-s1').value = match.idaS1 || '';
            document.getElementById('edit-ida-s2').value = match.idaS2 || '';
            document.getElementById('edit-volta-s1').value = match.voltaS1 || '';
            document.getElementById('edit-volta-s2').value = match.voltaS2 || '';

            // Aggregate calculator
            function updateAggregate() {
                const ida1 = parseInt(document.getElementById('edit-ida-s1').value) || 0;
                const ida2 = parseInt(document.getElementById('edit-ida-s2').value) || 0;
                const volta1 = parseInt(document.getElementById('edit-volta-s1').value) || 0;
                const volta2 = parseInt(document.getElementById('edit-volta-s2').value) || 0;
                document.getElementById('agg-p1').textContent = ida1 + volta1;
                document.getElementById('agg-p2').textContent = ida2 + volta2;

                // Check if repechage tie → show penalty
                const agg1 = ida1 + volta1;
                const agg2 = ida2 + volta2;
                if (type === 'repechage' && agg1 === agg2 && (document.getElementById('edit-ida-s1').value !== '' || document.getElementById('edit-volta-s1').value !== '')) {
                    penaltyEl.style.display = 'block';
                    document.getElementById('pen-p1-name').textContent = formatName(displayParticipantName(match.p1));
                    document.getElementById('pen-p2-name').textContent = formatName(displayParticipantName(match.p2));
                } else {
                    penaltyEl.style.display = 'none';
                }
            }

            ['edit-ida-s1', 'edit-ida-s2', 'edit-volta-s1', 'edit-volta-s2'].forEach(id => {
                const el = document.getElementById(id);
                el.removeEventListener('input', updateAggregate);
                el.addEventListener('input', updateAggregate);
            });
            updateAggregate();
        } else {
            // Modo Placar Único
            singleEl.style.display = 'flex';
            legsEl.style.display = 'none';

            if (editP1Name) editP1Name.textContent = displayParticipantName(match.p1);
            if (editP2Name) editP2Name.textContent = displayParticipantName(match.p2);
            if (editS1) editS1.value = match.s1 || '';
            if (editS2) editS2.value = match.s2 || '';

            // Listen for tie on repechage single mode
            function checkSinglePenalty() {
                const v1 = parseInt(editS1.value);
                const v2 = parseInt(editS2.value);
                if (type === 'repechage' && !isNaN(v1) && !isNaN(v2) && v1 === v2 && editS1.value !== '') {
                    penaltyEl.style.display = 'block';
                    document.getElementById('pen-p1-name').textContent = formatName(displayParticipantName(match.p1));
                    document.getElementById('pen-p2-name').textContent = formatName(displayParticipantName(match.p2));
                } else {
                    penaltyEl.style.display = 'none';
                }
            }

            editS1.removeEventListener('input', checkSinglePenalty);
            editS2.removeEventListener('input', checkSinglePenalty);
            editS1.addEventListener('input', checkSinglePenalty);
            editS2.addEventListener('input', checkSinglePenalty);
            checkSinglePenalty();
        }

        if (modalMataMata) modalMataMata.classList.add('active');
    }

    function renderNextPhasePreview(lines) {
        if (!nextPhasePreview) return;
        const pairs = [];
        for (let i = 0; i < lines.length; i += 2) {
            const p1 = lines[i] || 'BYE';
            const p2 = lines[i + 1] || 'BYE';
            pairs.push({ p1, p2 });
        }
        nextPhasePreview.innerHTML = pairs.map((m, idx) => `
            <div style="padding:8px 10px; margin-bottom:6px; border-radius:10px; background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.75);">
                <strong>Jogo ${idx + 1}:</strong> ${formatName(m.p1)} <span style="opacity:0.6;">vs</span> ${formatName(m.p2)}
            </div>
        `).join('');
    }

    function buildMatchesFromNames(names, emptySlots = false) {
        const matches = [];
        for (let i = 0; i < names.length; i += 2) {
            matches.push({
                p1: emptySlots ? '' : (names[i] || 'BYE'),
                p2: emptySlots ? '' : (names[i + 1] || 'BYE')
            });
        }
        return matches;
    }

    function getDuplicatePlayersFromMatches(matches) {
        const counts = new Map();
        matches.forEach(m => {
            [m.p1, m.p2].forEach(name => {
                if (!isRealPlayer(name)) return;
                counts.set(name, (counts.get(name) || 0) + 1);
            });
        });
        return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    }

    function initializeNextPhaseMatchEditor(qualifiedNames, mode = 'empty') {
        const normalized = [...new Set((qualifiedNames || []).map(n => (n || '').trim()).filter(isRealPlayer))];
        pendingNextPhaseQualified = normalized;
        const count = Math.max(1, Math.ceil(normalized.length / 2));
        if (mode === 'shuffle') {
            pendingNextPhaseMatches = buildMatchesFromNames(shuffleArray(normalized));
        } else if (mode === 'autofill') {
            pendingNextPhaseMatches = buildMatchesFromNames(normalized);
        } else {
            pendingNextPhaseMatches = Array.from({ length: count }, () => ({ p1: '', p2: '' }));
        }
        pendingNextPhaseSignature = normalized.join('|');
    }

    function updatePendingNextPhaseMatch(matchIndex, side, value) {
        if (!pendingNextPhaseMatches[matchIndex]) return;
        pendingNextPhaseMatches[matchIndex] = {
            ...pendingNextPhaseMatches[matchIndex],
            [side]: value
        };
    }

    function renderNextPhaseMatchEditor() {
        if (!nextPhaseMatchEditor) return;
        if (!pendingNextPhaseMatches.length) {
            nextPhaseMatchEditor.innerHTML = '';
            return;
        }

        const allSelectedPlayers = pendingNextPhaseMatches.flatMap(m => [m.p1, m.p2]).filter(isRealPlayer);
        const duplicates = getDuplicatePlayersFromMatches(pendingNextPhaseMatches);
        const totalSlots = pendingNextPhaseMatches.length * 2;
        const requiredByeSlots = Math.max(0, totalSlots - pendingNextPhaseQualified.length);
        const selectedByeCount = pendingNextPhaseMatches.flatMap(m => [m.p1, m.p2]).filter(isBye).length;

        nextPhaseMatchEditor.innerHTML = `
            ${pendingNextPhaseMatches.map((match, idx) => `
                <div class="next-phase-match-card">
                    <select class="form-control next-phase-select-a" data-match-index="${idx}">
                        <option value="">Selecionar jogador</option>
                    </select>
                    <span class="next-phase-match-vs">Jogo ${idx + 1} • VS</span>
                    <select class="form-control next-phase-select-b" data-match-index="${idx}">
                        <option value="">Selecionar jogador</option>
                    </select>
                </div>
            `).join('')}
            ${duplicates.length ? `<div class="next-phase-alert">⚠️ Jogadores repetidos detectados: ${duplicates.map(formatName).join(', ')}</div>` : ''}
        `;

        function populateSelect(select, currentValue) {
            const canUseBye = currentValue === 'BYE' || selectedByeCount < requiredByeSlots;
            if (canUseBye) {
                const byeOpt = document.createElement('option');
                byeOpt.value = 'BYE';
                byeOpt.textContent = 'BYE';
                select.appendChild(byeOpt);
            }
            const available = pendingNextPhaseQualified.filter(name => name === currentValue || !allSelectedPlayers.includes(name));
            available.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = formatName(name);
                select.appendChild(opt);
            });
            select.value = currentValue || '';
        }

        nextPhaseMatchEditor.querySelectorAll('.next-phase-select-a').forEach(select => {
            const idx = Number(select.dataset.matchIndex);
            populateSelect(select, pendingNextPhaseMatches[idx].p1 || '');
            select.addEventListener('change', () => {
                updatePendingNextPhaseMatch(idx, 'p1', select.value);
                renderNextPhaseMatchEditor();
            });
        });

        nextPhaseMatchEditor.querySelectorAll('.next-phase-select-b').forEach(select => {
            const idx = Number(select.dataset.matchIndex);
            populateSelect(select, pendingNextPhaseMatches[idx].p2 || '');
            select.addEventListener('change', () => {
                updatePendingNextPhaseMatch(idx, 'p2', select.value);
                renderNextPhaseMatchEditor();
            });
        });
    }

    function getNextPhaseQualifiersFromBracket(tournament) {
        const qualifiers = [];
        const pushIfReal = (name) => {
            if (!isRealPlayer(name)) return;
            if (!qualifiers.includes(name)) qualifiers.push(name);
        };

        const rep = tournament?.knockout?.repechage || [];
        const repTokenWinner = new Map();
        rep.forEach((match, idx) => {
            const winner = match?.winner || getKnockoutMatchWinner(match) || getByeAutoWinner(match);
            if (isRealPlayer(winner)) repTokenWinner.set(`Vencedor Rep. ${idx + 1}`, winner);
        });

        const firstRound = tournament?.knockout?.rounds?.[0];
        if (firstRound?.matches?.length) {
            firstRound.matches.forEach(match => {
                [match.p1, match.p2].forEach(slot => {
                    if (repTokenWinner.has(slot)) pushIfReal(repTokenWinner.get(slot));
                    else pushIfReal(slot);
                });
            });
        } else {
            getGroupLeaders(0).forEach(pushIfReal);
            repTokenWinner.forEach(v => pushIfReal(v));
        }
        return qualifiers;
    }

    function checkAndOpenNextPhaseModal() {
        if (role !== 'organizador' || !tournamentState.knockout || repechageModalShown) return;
        const rep = tournamentState.knockout.repechage || [];
        if (!rep.length) return;
        const done = rep.every(m => isMatchResolvedForProgression(m));
        if (!done) return;
        const qualified = getNextPhaseQualifiersFromBracket(tournamentState);
        if (!qualified.length) return;
        const signature = qualified.join('|');
        if (signature !== pendingNextPhaseSignature || !pendingNextPhaseMatches.length) {
            initializeNextPhaseMatchEditor(qualified, 'empty');
        }
        if (nextPhaseOrderInput) nextPhaseOrderInput.value = qualified.join('\n');
        renderNextPhasePreview(qualified);
        renderNextPhaseMatchEditor();
        modalNextPhase?.classList.add('active');
        repechageModalShown = true;
    }

    function propagateWinnerToNextRound(knockout, winnerToken, winnerName, fromRoundIdx = -1) {
        if (!winnerToken || !winnerName || !knockout?.rounds?.length) return;
        for (let r = fromRoundIdx + 1; r < knockout.rounds.length; r++) {
            (knockout.rounds[r].matches || []).forEach(nextMatch => {
                if (nextMatch.p1 === winnerToken) nextMatch.p1 = winnerName;
                if (nextMatch.p2 === winnerToken) nextMatch.p2 = winnerName;
            });
        }
    }

    if (btnSaveKnockout) {
        btnSaveKnockout.addEventListener('click', async () => {
            if (!selectedKnockoutMatch) return;
            const { type, rIdx, mIdx } = selectedKnockoutMatch;
            const isHomeAway = tournamentState.homeAway || false;

            let match;
            if (type === 'repechage') {
                match = tournamentState.knockout.repechage[mIdx];
            } else {
                match = tournamentState.knockout.rounds[rIdx].matches[mIdx];
            }

            let winner = null;
            let totalS1 = 0, totalS2 = 0;
            const byeResolution = resolveByeMatchOutcome(match);
            if (byeResolution.resolved) {
                winner = byeResolution.winner;
            }

            if (!winner && isHomeAway) {
                // Ida e Volta
                const ida1 = document.getElementById('edit-ida-s1').value;
                const ida2 = document.getElementById('edit-ida-s2').value;
                const volta1 = document.getElementById('edit-volta-s1').value;
                const volta2 = document.getElementById('edit-volta-s2').value;

                if (ida1 === '' || ida2 === '' || volta1 === '' || volta2 === '') {
                    alert('Preencha todos os placares (ida e volta).');
                    return;
                }

                match.idaS1 = ida1;
                match.idaS2 = ida2;
                match.voltaS1 = volta1;
                match.voltaS2 = volta2;

                totalS1 = parseInt(ida1) + parseInt(volta1);
                totalS2 = parseInt(ida2) + parseInt(volta2);
                match.s1 = String(totalS1);
                match.s2 = String(totalS2);

            } else if (!winner) {
                // Placar único
                const s1Val = editS1.value;
                const s2Val = editS2.value;
                if (s1Val === '' || s2Val === '') {
                    alert('Preencha os dois placares.');
                    return;
                }
                totalS1 = parseInt(s1Val);
                totalS2 = parseInt(s2Val);
                match.s1 = s1Val;
                match.s2 = s2Val;
            }

            // Determine winner
            if (totalS1 > totalS2) {
                winner = match.p1;
            } else if (totalS2 > totalS1) {
                winner = match.p2;
            } else {
                // EMPATE
                if (type === 'repechage') {
                    // Repescagem: empate vai pra pênaltis
                    const pen1 = document.getElementById('edit-pen1').value;
                    const pen2 = document.getElementById('edit-pen2').value;
                    if (pen1 === '' || pen2 === '') {
                        alert('Empate na repescagem! Preencha os pênaltis.');
                        return;
                    }
                    const p1Pen = parseInt(pen1);
                    const p2Pen = parseInt(pen2);
                    if (p1Pen === p2Pen) {
                        alert('Pênaltis não podem empatar. Insira um vencedor.');
                        return;
                    }
                    match.pen1 = pen1;
                    match.pen2 = pen2;
                    winner = p1Pen > p2Pen ? match.p1 : match.p2;
                } else {
                    // Mata-mata normal: não pode empatar
                    alert('Mata-mata não pode terminar em empate. Defina um vencedor.');
                    return;
                }
            }

            // Advance winner
            match.winner = winner;
            match.completed = true;
            match.status = 'completed';
            if (type === 'repechage') {
                const firstRound = tournamentState.knockout.rounds[0];
                const placeholder = `Vencedor Rep. ${mIdx + 1}`;
                firstRound.matches.forEach(m => {
                    if (m.p1 === placeholder) m.p1 = winner;
                    if (m.p2 === placeholder) m.p2 = winner;
                });
            } else if (rIdx < tournamentState.knockout.rounds.length - 1) {
                const winnerToken = match.winnerToken || `Vencedor ${tournamentState.knockout.rounds[rIdx].name} ${mIdx + 1}`;
                match.winnerToken = winnerToken;
                propagateWinnerToNextRound(tournamentState.knockout, winnerToken, winner, rIdx);
            } else {
                tournamentState.top3.first = winner;
                tournamentState.top3.second = (winner === match.p1) ? match.p2 : match.p1;
            }

            try {
                recalculateGeneralStats();
                await persistCurrentTournament({ knockout: tournamentState.knockout, top3: tournamentState.top3, generalStats: tournamentState.generalStats });
                renderTournamentFromState();
                modalMataMata.classList.remove('active');
                if (type === 'repechage') alert(`${winner} venceu e avança!`);
                else alert('Placar salvo e vencedor avançado!');
            } catch (e) {
                console.error('Erro ao salvar mata-mata:', e);
                alert('Erro ao salvar mata-mata no Firebase.');
            }
        });
    }

    // ROUND ROBIN MATCH GENERATION
    function generateRoundRobin(playersNames, idaVolta = false) {
        const matches = [];
        const n = playersNames.length;
        if (n < 2) return [];

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                matches.push({
                    id: `m_${Date.now()}_${i}_${j}`,
                    home: playersNames[i],
                    away: playersNames[j],
                    gHome: "",
                    gAway: ""
                });
            }
        }

        if (idaVolta) {
            const returnMatches = matches.map(m => ({
                id: m.id + '_r',
                home: m.away,
                away: m.home,
                gHome: "",
                gAway: ""
            }));
            return [...matches, ...returnMatches];
        }
        return matches;
    }

    function openGroupMatches(index) {
        selectedGroupIndex = index;
        const group = tournamentState.groups[index];
        document.getElementById('modal-group-title').textContent = `Jogos: ${group.name}`;
        
        // Initialize matches if not exist
        if (!group.matches || group.matches.length === 0) {
            const names = group.players.map(p => p.name);
            group.matches = generateRoundRobin(names, false);
            document.getElementById('chk-ida-volta').checked = false;
        } else {
            // Detect if idaVolta is active based on match count
            const n = group.players.length;
            const expectedSingle = (n * (n - 1)) / 2;
            document.getElementById('chk-ida-volta').checked = group.matches.length > expectedSingle;
        }

        renderGroupMatchesList();
        document.getElementById('modal-jogos-grupo').classList.add('active');
    }

    function renderGroupMatchesList() {
        const group = tournamentState.groups[selectedGroupIndex];
        const container = document.getElementById('group-matches-list');
        const countEl = document.getElementById('total-matches-count');
        
        if (!group.matches || group.matches.length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhum jogo disponível</div>';
            countEl.textContent = "0";
            return;
        }

        countEl.textContent = group.matches.length;
        container.innerHTML = group.matches.map((m, i) => `
            <div class="match-card">
                <div class="match-team home">
                    <span>${formatName(m.home)}</span>
                </div>
                <input type="number" min="0" class="match-score-input" value="${m.gHome}" data-idx="${i}" data-side="home" placeholder="0">
                <span class="match-vs">VS</span>
                <input type="number" min="0" class="match-score-input" value="${m.gAway}" data-idx="${i}" data-side="away" placeholder="0">
                <div class="match-team away">
                    <span>${formatName(m.away)}</span>
                </div>
            </div>
        `).join('');

        // Add listeners to inputs to update the local state
        container.querySelectorAll('.match-score-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const idx = e.target.dataset.idx;
                const side = e.target.dataset.side;
                const val = e.target.value;
                if (side === 'home') group.matches[idx].gHome = val;
                else group.matches[idx].gAway = val;
            });
        });
    }

    function updateGroupStats(groupIndex) {
        const group = tournamentState.groups[groupIndex];
        // Reset stats
        group.players.forEach(p => {
            p.j = 0; p.v = 0; p.e = 0; p.d = 0; p.gp = 0; p.gc = 0; p.sg = 0; p.pts = 0;
        });

        // Recalculate
        (group.matches || []).forEach(m => {
            const h = m.gHome;
            const a = m.gAway;
            
            // Check if both are numbers or non-empty strings
            if (h !== "" && h !== null && a !== "" && a !== null) {
                const gh = parseInt(h);
                const ga = parseInt(a);
                
                if (!isNaN(gh) && !isNaN(ga)) {
                    const pHome = group.players.find(p => p.name === m.home);
                    const pAway = group.players.find(p => p.name === m.away);

                    if (pHome && pAway) {
                        pHome.j++; pAway.j++;
                        pHome.gp += gh; pHome.gc += ga;
                        pAway.gp += ga; pAway.gc += gh;

                        if (gh > ga) { pHome.v++; pAway.d++; pHome.pts += 3; }
                        else if (gh < ga) { pAway.v++; pHome.d++; pAway.pts += 3; }
                        else { pHome.e++; pAway.e++; pHome.pts += 1; pAway.pts += 1; }
                    }
                }
            }
        });
        
        group.players.forEach(p => p.sg = p.gp - p.gc);
    }

    // ========== RENDER CODES (reusable) ==========
    function renderCodes(codesArray) {
        const codesList = document.getElementById('codes-list');
        if (!codesList) return;
        codesList.innerHTML = '';

        if (!codesArray || codesArray.length === 0) return;

        codesArray.forEach((c, idx) => {
            const item = document.createElement('div');
            item.className = 'code-item';
            item.innerHTML = `
                <span class="code-value">${c.code}</span>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="${c.used ? 'code-used' : 'code-available'}">${c.used ? 'Utilizado' : 'Disponível'}</span>
                    ${!c.used ? `<button class="code-copy-btn" data-code="${c.code}" title="Copiar" style="background:none; border:1px solid rgba(22,163,74,0.2); border-radius:6px; padding:3px 6px; cursor:pointer; color:#16A34A; font-size:0.8rem; display:flex; align-items:center; transition:all 0.2s;"><i class="ph ph-copy"></i></button>` : `<button class="code-reset-btn" data-idx="${idx}" title="Resetar código" style="background:none; border:1px solid rgba(239,68,68,0.2); border-radius:6px; padding:3px 6px; cursor:pointer; color:#ef4444; font-size:0.8rem; display:flex; align-items:center; transition:all 0.2s;"><i class="ph ph-trash"></i></button>`}
                </div>
            `;
            
            // Copiar
            const copyBtn = item.querySelector('.code-copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(c.code).then(() => {
                        copyBtn.innerHTML = '<i class="ph-fill ph-check"></i>';
                        copyBtn.style.color = '#fff';
                        copyBtn.style.background = '#16A34A';
                        setTimeout(() => {
                            copyBtn.innerHTML = '<i class="ph ph-copy"></i>';
                            copyBtn.style.color = '#16A34A';
                            copyBtn.style.background = 'none';
                        }, 1500);
                    });
                });
            }

            // Reset Individual
            const resetBtn = item.querySelector('.code-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', async () => {
                    askSensitivePassword(async () => {
                        const cpfToRemove = c.usedBy;
                        if (confirm(`Deseja liberar o código ${c.code} e APAGAR o cadastro do jogador associado?`)) {
                            if (!db) return;
                            try {
                                const newCodes = [...codesArray];
                                newCodes[idx] = { ...newCodes[idx], used: false, usedBy: null };
                                await set(ref(db, 'codes/pool'), { codes: newCodes });

                                if (cpfToRemove) {
                                    await remove(ref(db, 'participants/' + cpfToRemove));
                                    if (tournamentState && tournamentState.registeredPlayers) {
                                        const filtered = tournamentState.registeredPlayers.filter(p => p.id !== cpfToRemove);
                                        if (filtered.length !== tournamentState.registeredPlayers.length) {
                                            await update(ref(db, 'tournaments/current'), { registeredPlayers: filtered });
                                        }
                                    }
                                }
                                alert('Código liberado e cadastro removido!');
                            } catch (e) {
                                console.error('Erro ao resetar código e apagar cadastro:', e);
                                alert('Erro ao processar remoção completa.');
                            }
                        }
                    });
                });
            }

            codesList.appendChild(item);
        });

        const availCount = codesArray.filter(c => !c.used).length;
        const usedCount = codesArray.filter(c => c.used).length;
        const elAvail = document.querySelector('.status-available');
        const elUsed = document.querySelector('.status-used');
        if (elAvail) elAvail.textContent = `${availCount} disponíveis`;
        if (elUsed) elUsed.textContent = `${usedCount} utilizados`;
    }

    // ========== DOM REFERENCES ==========
    const participantsInput = document.getElementById('tourney-participants');
    const phasesInfo = document.getElementById('phases-info');
    const statusBadge = document.getElementById('status-badge');
    const groupsContainer = document.getElementById('groups-container');
    const prizeBanner = document.getElementById('prize-banner');
    const prizeTitle = document.getElementById('prize-title');
    const top3Container = document.getElementById('top3-container');

    // ========== PREVIEW UPDATE ==========
    const formatSelect = document.getElementById('tourney-format');
    
    function updatePreview() {
        if (tournamentState.status !== 'aguardando') return;
        let n = parseInt(participantsInput.value) || 0;

        const format = formatSelect ? formatSelect.value : 'grupos-mata-mata';
        
        if (n >= 2) {
            const totalPhases = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
            phasesInfo.textContent = `${totalPhases} fases`;
            
            // Verifica os participantes reais que já entraram
            let realParticipants = tournamentState.registeredPlayers || [];
            
            // Monta a array final mesclando reais + placeholders
            let mockParticipants = [];
            for (let i = 0; i < n; i++) {
                if (realParticipants[i]) {
                    mockParticipants.push({ name: realParticipants[i].name });
                } else {
                    mockParticipants.push({ name: `A definir (Slot ${i+1})` });
                }
            }
            
            buildTournamentState(mockParticipants, format);
            renderTournamentFromState(true);
        } else {
            phasesInfo.textContent = '—';
            groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Configure e gere o chaveamento para começar.</p></div>`;
            const tabMata = document.getElementById('tab-mata-mata');
            if(tabMata) tabMata.innerHTML = `<div class="empty-state"><i class="ph ph-tree-structure"></i><h3>Mata-Mata</h3><p>Fase eliminatória pendente.</p></div>`;
        }
    }

    if (participantsInput) participantsInput.addEventListener('input', updatePreview);
    if (formatSelect) formatSelect.addEventListener('change', updatePreview);

    const homeAwayInput = document.getElementById('tourney-home-away');
    if (homeAwayInput) {
        homeAwayInput.addEventListener('change', () => {
            if (homeAwayInput.checked && formatSelect) {
                formatSelect.value = 'grupos-mata-mata';
            }
            updatePreview();
        });
    }

    // ========== CONFIG UPDATE BUTTON ==========
    const btnUpdateConfig = document.getElementById('btn-update-config');
    if (btnUpdateConfig) {
        btnUpdateConfig.addEventListener('click', async () => {
            const newName = document.getElementById('tourney-name').value.trim();
            let newParticipants = parseInt(participantsInput.value);
            const newFormat = formatSelect.value;
            const newHomeAway = document.getElementById('tourney-home-away').checked;

            if (!newName) { alert('Informe o nome do torneio.'); return; }
            if (!Number.isInteger(newParticipants) || newParticipants < 2) {
                alert('Número de participantes inválido. Informe pelo menos 2 participantes.');
                return;
            }

            const btn = btnUpdateConfig;
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Atualizando...';

            try {
                // Update local state
                tournamentState.name = newName;
                tournamentState.participants = newParticipants;
                tournamentState.format = newFormat;
                tournamentState.homeAway = newHomeAway;
                tournamentState.updatedAt = new Date().toISOString();

                // Re-build state preserving real players
                const realPlayers = tournamentState.registeredPlayers || [];
                const finalPlayers = [];
                for (let i = 0; i < newParticipants; i++) {
                    if (realPlayers[i]) finalPlayers.push({ name: realPlayers[i].name });
                    else finalPlayers.push({ name: `A definir (Slot ${i+1})` });
                }

                buildTournamentState(finalPlayers, newFormat);
                
                if (db) {
                    await set(ref(db, 'tournaments/current'), tournamentState);
                    if (tournamentState.tournamentCode) {
                        await set(ref(db, 'tournaments/' + tournamentState.tournamentCode), tournamentState);
                    }
                }

                renderTournamentFromState();
                alert('Configurações atualizadas com sucesso!');
            } catch (e) {
                console.error('Erro ao atualizar config:', e);
                alert('Erro ao salvar no Firebase.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    }

    // ========== REAL-TIME SYNC (Firebase) ==========
    if (db) {
        // --- Sync Tournament ---
        onValue(ref(db, 'tournaments/current'), (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const isNew = !tournamentState.tournamentCode;
                tournamentState = { ...tournamentState, ...data };
                if (!(tournamentState.knockout?.repechage || []).length) repechageModalShown = false;
                
                // If it's the first load, populate inputs
                if (isNew || document.activeElement.tagName !== 'INPUT') {
                    if (document.getElementById('tourney-name')) document.getElementById('tourney-name').value = tournamentState.name || '';
                    if (participantsInput) participantsInput.value = tournamentState.participants || 8;
                    if (formatSelect) formatSelect.value = tournamentState.format || 'grupos-mata-mata';
                    if (document.getElementById('tourney-home-away')) document.getElementById('tourney-home-away').checked = !!tournamentState.homeAway;
                    
                    const n = tournamentState.participants || 8;
                    if (phasesInfo) phasesInfo.textContent = `${Math.max(1, Math.ceil(Math.log2(Math.max(2, n))))} fases`;
                }

                // If not in preview or if visitor, render real data
                if (tournamentState.status !== 'aguardando' || role !== 'organizador') {
                    renderTournamentFromState(false);
                    updateStatus(tournamentState.status);
                    
                    // Hide/Show Group Tab based on format
                    const tabBtnGrupos = document.querySelector('.tab[data-tab="grupos"]');
                    if (tabBtnGrupos) {
                        const isKnockoutOnly = tournamentState.format === 'eliminatoria';
                        tabBtnGrupos.style.display = isKnockoutOnly ? 'none' : 'flex';
                        
                        // If it's knockout only and we were in groups, switch to mata-mata
                        if (isKnockoutOnly && tabBtnGrupos.classList.contains('active')) {
                            document.querySelector('.tab[data-tab="mata-mata"]')?.click();
                        }
                    }

                    if (prizeTitle) prizeTitle.textContent = tournamentState.prize || 'A definir';
                    if (prizeBanner) prizeBanner.style.display = tournamentState.prize ? 'flex' : 'none';
                } else if (role === 'organizador') {
                    updatePreview();
                }
            } else if (role !== 'organizador') {
                groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Aguarde o organizador iniciar a partida.</p></div>`;
                updateStatus('aguardando');
                if (prizeBanner) prizeBanner.style.display = 'none';
            }
        });

        // --- Sync Codes ---
        onValue(ref(db, 'codes/pool'), (snapshot) => {
            const data = snapshot.val();
            if (data && data.codes) {
                tournamentState.codes = data.codes;
                renderCodes(data.codes);
            }
        });
    } else {
        // Fallback local
        if (role === 'organizador') updatePreview();
    }

    function buildTournamentState(participantsArray, format) {
        repechageModalShown = false;
        const N = participantsArray.length || 8;
        let G = N <= 5 ? 1 : Math.ceil(N / 4);
        
        const showGroups = format === 'grupos' || format === 'grupos-mata-mata';
        const showMataMata = format === 'mata-mata' || format === 'grupos-mata-mata' || format === 'eliminatoria';

        tournamentState.groups = [];
        tournamentState.knockout = null;

        if (showGroups) {
            for (let g = 0; g < G; g++) {
                const letter = String.fromCharCode(65 + g);
                let players = [];
                const groupPlayers = participantsArray.filter((_, i) => i % G === g);
                const count = groupPlayers.length || Math.min(4, N - g * 4);
                
                for (let p = 0; p < count; p++) {
                    const playerName = groupPlayers[p] ? groupPlayers[p].name : `A definir (Slot ${p + 1})`;
                    players.push({ name: playerName, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0 });
                }
                tournamentState.groups.push({ name: `Grupo ${letter}`, players });
            }
        }

        if (showMataMata) {
            let K;
            if (G === 1) K = 2;
            else if (G === 2) K = 4;
            else {
                K = Math.pow(2, Math.ceil(Math.log2(G)));
                if (K === G) K = G * 2; 
            }

            const W = K - G;
            const M = G - W; 
            
            let repechagePlayers = Array.from({length: G}, (_, i) => `2º Grupo ${String.fromCharCode(65 + i)}`);
            repechagePlayers.reverse();

            let repechageRound = [];
            if (M > 0 && showGroups) {
                for(let i=0; i < M; i++) {
                    let p1 = repechagePlayers.shift();
                    let p2 = repechagePlayers.shift();
                    repechageRound.push(createMatchData(p1, p2, `Vencedor Rep. ${i + 1}`));
                    repechagePlayers.push(`Vencedor Rep. ${i+1}`);
                }
            }

            let knockoutPlayers = [];
            if (showGroups) {
                for (let i=0; i<G; i++) knockoutPlayers.push(`1º Grupo ${String.fromCharCode(65 + i)}`);
                knockoutPlayers = knockoutPlayers.concat(repechagePlayers);
            } else {
                // Mata-mata apenas: Usar jogadores reais da lista
                for (let i = 0; i < K; i++) {
                    const pName = participantsArray[i] ? participantsArray[i].name : `A definir (Slot ${i+1})`;
                    knockoutPlayers.push(pName);
                }
            }

            let rounds = [];
            let currentRoundPlayers = [...knockoutPlayers];

            while(currentRoundPlayers.length > 1) {
                let matchesInRound = currentRoundPlayers.length / 2;
                let roundName = matchesInRound === 1 ? 'Final' : (matchesInRound === 2 ? 'Semifinal' : (matchesInRound === 4 ? 'Quartas de Final' : `Fase de ${matchesInRound*2}`));
                
                let roundMatches = [];
                let nextRoundPlayers = [];
                for(let m=0; m < currentRoundPlayers.length; m+=2) {
                    let p1 = currentRoundPlayers[m] || 'A definir';
                    let p2 = currentRoundPlayers[m+1] || 'A definir';
                    const winnerToken = `Vencedor ${roundName} ${m / 2 + 1}`;
                    roundMatches.push(createMatchData(p1, p2, winnerToken));
                    nextRoundPlayers.push(winnerToken);
                }
                rounds.push({ name: roundName, matches: roundMatches });
                currentRoundPlayers = nextRoundPlayers;
            }

            tournamentState.knockout = { repechage: repechageRound, rounds };
        }
    }

    function formatName(fullName) {
        if (!fullName) return '';
        const parts = fullName.trim().split(/\s+/);
        if (parts.length <= 1) return fullName;
        return `${parts[0]} ${parts[parts.length - 1]}`;
    }

    function resetKnockoutResults(knockout) {
        if (!knockout) return;
        (knockout.repechage || []).forEach(match => {
            match.p1 = match.p1Source || match.p1;
            match.p2 = match.p2Source || match.p2;
            clearMatchResultFields(match);
        });
        (knockout.rounds || []).forEach((round, idx) => {
            (round.matches || []).forEach(match => {
                if (idx > 0) {
                    match.p1 = match.p1Source || match.p1;
                    match.p2 = match.p2Source || match.p2;
                }
                clearMatchResultFields(match);
                if (idx === 0) {
                    resolveByeMatchOutcome(match);
                }
            });
        });
    }

    function renderTournamentFromState(isPreview = false) {
        // Groups
        groupsContainer.innerHTML = '';
        if (tournamentState.groups && tournamentState.groups.length > 0) {
            tournamentState.groups.forEach((group, index) => {
                let rows = '';
                
                // Sort players by pts, then sg, then gp
                const sortedPlayers = [...group.players].sort((a, b) => {
                    if (b.pts !== a.pts) return b.pts - a.pts;
                    if (b.sg !== a.sg) return b.sg - a.sg;
                    return b.gp - a.gp;
                });

                // Calculate if group is finished
                const totalJ = Math.floor(group.players.reduce((acc, p) => acc + p.j, 0) / 2);
                const numPlayers = group.players.length;
                const totalPlanned = (numPlayers * (numPlayers - 1)) / 2;
                const isGroupFinished = totalJ >= totalPlanned || tournamentState.status === 'encerrado';

                sortedPlayers.forEach((player, i) => {
                    // Get extra data from registeredPlayers
                    const regP = (tournamentState.registeredPlayers || []).find(p => p.name === player.name);
                    const photo = regP ? regP.photo : null;
                    const countryCode = regP ? regP.countryCode : 'br';
                    
                    const statusLabel = i === 0 ? 'CLASSIFICADO' : (i === 1 ? 'REPESCAGEM' : (i === 2 ? 'POSSÍVEL 3º' : ''));
                    const statusClass = i === 0 ? 'status-classified' : (i === 1 ? 'status-playoff' : (i === 2 ? 'status-possible' : ''));
                    const leftBorderClass = isGroupFinished ? (i === 0 ? 'border-green' : (i === 1 ? 'border-gold' : (i === 2 ? 'border-orange' : ''))) : '';

                    const isMe = participantName && player.name === participantName;
                    const nameStyle = isMe ? 'color: #16A34A; font-weight: 800;' : 'color: #042D15; font-weight: 600;';
                    
                    rows += `
                        <tr class="${leftBorderClass}">
                            <td class="rank-col">${i + 1}º</td>
                            <td class="player-col">
                                <div class="player-info-cell">
                                    <div class="player-avatar">
                                        ${photo ? `<img src="${photo}" alt="">` : `<img src="https://flagcdn.com/w80/${countryCode || 'br'}.png" alt="" class="flag-avatar">`}
                                    </div>
                                    <span style="${nameStyle}" class="player-name-clickable" onclick="openPlayerProfile('${player.name}')">${formatName(player.name)}</span>
                                    ${(isGroupFinished && statusLabel) ? `<span class="player-status-badge ${statusClass}">${statusLabel}</span>` : ''}
                                </div>
                            </td>
                            <td class="stat-col">${player.j}</td>
                            <td class="stat-col">${player.v}</td>
                            <td class="stat-col">${player.e}</td>
                            <td class="stat-col">${player.d}</td>
                            <td class="stat-col">${player.gp}</td>
                            <td class="stat-col">${player.gc}</td>
                            <td class="stat-col sg-col">${player.sg > 0 ? '+' + player.sg : player.sg}</td>
                            <td class="pts-col">${player.pts}</td>
                        </tr>`;
                });

                const card = document.createElement('div');
                card.className = 'group-card-modern' + (isPreview ? ' preview-mode' : '');
                card.innerHTML = `
                    <div class="group-header">
                        <div class="group-header-left">
                            <h3 class="group-title">${group.name}</h3>
                            <span class="group-status-tag" style="${isGroupFinished ? 'background: rgba(34, 197, 94, 0.15); color: #22C55E;' : 'background: rgba(59, 130, 246, 0.15); color: #3B82F6;'}">
                                <i class="${isGroupFinished ? 'ph-fill ph-check-circle' : 'ph-fill ph-clock'}"></i> 
                                ${isGroupFinished ? 'Finalizado' : 'Em andamento'}
                            </span>
                        </div>
                        <div class="group-header-right">
                            <span class="games-count">${totalJ}/${totalPlanned} jogos</span>
                        </div>
                    </div>
                    <div class="table-container">
                        <table class="modern-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th style="text-align:left;">JOGADOR</th>
                                    <th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>PTS</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                    <div class="group-footer">
                        <button class="btn-group-games" data-index="${index}">Ver jogos do grupo <i class="ph ph-caret-right"></i></button>
                    </div>`;
                
                card.querySelector('.btn-group-games').addEventListener('click', () => openGroupMatches(index));
                groupsContainer.appendChild(card);
            });
        } else {
            groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Fase de Grupos desativada</h3><p>O formato atual não inclui grupos.</p></div>`;
        }

        // Mata-mata
        const mataMataContainer = document.getElementById('tab-mata-mata');
        if (mataMataContainer) {
            if (tournamentState.knockout) {
                let bracketHTML = `<div class="mata-mata-tab"><div class="bracket-scroll-area"><div class="bracket-scroll-shell"><div class="bracket-container${isPreview ? ' preview-mode' : ''}">
                                    ${isPreview ? '<div class="preview-badge">PREVIEW</div>' : ''}`;
                
                // Helper: render a single bracket match card
                function renderBracketMatch(match, type, rIdx, mIdx) {
                    const showBtn = role === 'organizador' && !isPreview;
                    const hasResult = (match.s1 !== '' && match.s2 !== '' && match.s1 != null && match.s2 != null) || !!match.completed;
                    const winner = getKnockoutMatchWinner(match);

                    const p1Win = winner === match.p1;
                    const p2Win = winner === match.p2;
                    const p1Class = p1Win ? 'bracket-slot winner' : (p2Win ? 'bracket-slot loser' : 'bracket-slot');
                    const p2Class = p2Win ? 'bracket-slot winner' : (p1Win ? 'bracket-slot loser' : 'bracket-slot');

                    // Score display
                    let score1 = match.s1 || '—';
                    let score2 = match.s2 || '—';
                    if (match.walkover && winner) {
                        score1 = match.p1 === winner ? 'WO' : '—';
                        score2 = match.p2 === winner ? 'WO' : '—';
                    }
                    
                    // Penalty indicator
                    let penaltyBadge = '';
                    if (match.pen1 && match.pen2) {
                        penaltyBadge = `<div class="penalty-badge"><i class="ph-fill ph-soccer-ball"></i> Pên: ${match.pen1} x ${match.pen2}</div>`;
                    }
                    const statusText = match.walkover ? 'walkover' : (winner ? 'concluído' : (match.status === 'in-progress' ? 'em andamento' : 'pendente'));

                    return `
                        <div class="bracket-match ${hasResult ? 'has-result' : ''}">
                            <span class="bracket-status">${statusText}</span>
                            <div class="${p1Class}">
                                <span class="player-name-clickable" onclick="openPlayerProfile('${match.p1}')">${formatName(displayParticipantName(match.p1))}</span>
                                <span class="slot-score">${score1}</span>
                            </div>
                            <div class="${p2Class}">
                                <span class="player-name-clickable" onclick="openPlayerProfile('${match.p2}')">${formatName(displayParticipantName(match.p2))}</span>
                                <span class="slot-score">${score2}</span>
                            </div>
                            ${penaltyBadge}
                            ${showBtn ? `<button class="btn-edit-knockout" data-type="${type}" data-r="${rIdx}" data-m="${mIdx}" title="Editar Resultado"><i class="ph ph-pencil-simple"></i></button>` : ''}
                        </div>`;
                }

                if (tournamentState.knockout.repechage && tournamentState.knockout.repechage.length > 0) {
                    bracketHTML += `<div class="bracket-round"><div class="bracket-round-title">Repescagem</div>`;
                    tournamentState.knockout.repechage.forEach((match, mIdx) => {
                        bracketHTML += renderBracketMatch(match, 'repechage', 0, mIdx);
                    });
                    bracketHTML += `</div>`;
                }

                if (tournamentState.knockout.rounds) {
                    tournamentState.knockout.rounds.forEach((round, rIdx) => {
                        bracketHTML += `<div class="bracket-round"><div class="bracket-round-title">${round.name}</div>`;
                        round.matches.forEach((match, mIdx) => {
                            bracketHTML += renderBracketMatch(match, 'round', rIdx, mIdx);
                        });
                        bracketHTML += `</div>`;
                    });
                }
                
                bracketHTML += `</div></div></div></div>`;
                mataMataContainer.innerHTML = bracketHTML;

                // Add Listeners
                mataMataContainer.querySelectorAll('.btn-edit-knockout').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const type = btn.dataset.type;
                        const rIdx = parseInt(btn.dataset.r || 0);
                        const mIdx = parseInt(btn.dataset.m || 0);
                        openKnockoutEdit(type, rIdx, mIdx);
                    });
                });
            } else {
                mataMataContainer.innerHTML = `<div class="mata-mata-tab"><div class="bracket-scroll-area"><div class="empty-state"><i class="ph ph-tree-structure"></i><h3>Mata-Mata desativado</h3><p>O formato atual não inclui eliminatórias.</p></div></div></div>`;
            }
            checkAndOpenNextPhaseModal();
        }
    }

    // ========== TABS NAVIGATION ==========
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active class on tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
            });
            
            // Show the selected tab content
            const tabId = tab.getAttribute('data-tab');
            const targetContent = document.getElementById('tab-' + tabId);
            if (targetContent) {
                targetContent.style.display = 'block';
            }
        });
    });

    // ========== GENERATE TOURNAMENT CODE ==========
    async function generateTournamentCode(type = 'fifa') {
        const prefixMap = { fifa: 'F', sinuca: 'S', cs: 'C' };
        const prefix = prefixMap[type] || 'F';
        let code = '';
        let exists = true;
        let attempts = 0;

        while (exists && attempts < 20) {
            const num = String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos
            code = prefix + num;
            if (db) {
                const snap = await get(ref(db, 'tournaments/' + code));
                exists = snap.exists();
            } else {
                exists = false;
            }
            attempts++;
        }
        return code;
    }

    // ========== GENERATE BRACKET ==========
    const btnGerar = document.getElementById('btn-gerar-chaveamento');
    if (btnGerar) {
        btnGerar.addEventListener('click', async () => {
            const name = document.getElementById('tourney-name').value || 'Copa Psyzon FIFA';
            const participants = parseInt(participantsInput.value) || 8;
            const format = document.getElementById('tourney-format').value;
            const homeAway = document.getElementById('tourney-home-away').checked;

            // Gera código único do torneio
            const tourneyCode = await generateTournamentCode('fifa');

            tournamentState.name = name;
            tournamentState.participants = participants;
            tournamentState.format = format;
            tournamentState.homeAway = homeAway;
            tournamentState.status = 'ativo';
            tournamentState.tournamentCode = tourneyCode;
            tournamentState.createdAt = new Date().toISOString();
            tournamentState.updatedAt = new Date().toISOString();

            // Ao iniciar, gera com participantes mockados (ou reais caso venha do DB)
            const mockParticipants = Array(participants).fill(null).map((_, i) => ({ name: `Jogador #${i+1}` }));
            buildTournamentState(mockParticipants, format);
            renderTournamentFromState(false);

            updateStatus('ativo');

            // Sincronizar com Firebase
            if (db) {
                try {
                    // Salva como torneio atual
                    await set(ref(db, 'tournaments/current'), tournamentState);
                    // Salva também indexado pelo código
                    await set(ref(db, 'tournaments/' + tourneyCode), tournamentState);
                    console.log(`✅ Torneio ${tourneyCode} salvo no Firebase!`);
                } catch(e) {
                    console.error("Erro ao salvar:", e);
                    alert('Erro ao salvar o torneio no Firebase.');
                }
            } else {
                console.log('[Local] Tournament Data:', tournamentState);
            }
        });
    }

    // ========== STATUS UPDATE ==========
    function updateStatus(status) {
        statusBadge.textContent = status === 'ativo' ? 'EM ANDAMENTO' : status === 'encerrado' ? 'FINALIZADO' : 'AGUARDANDO';
        statusBadge.className = 'live-badge' + (status === 'ativo' ? ' live' : '');
    }

    // ========== SAVE PRIZE ==========
    const btnSalvarPremio = document.getElementById('btn-salvar-premio');
    if (btnSalvarPremio) {
        btnSalvarPremio.addEventListener('click', () => {
            const text = document.getElementById('premio-text').value;
            if (!text.trim()) return;

            tournamentState.prize = text;
            prizeTitle.textContent = text;
            prizeBanner.style.display = 'flex';

            // Firebase Update
            if (db) {
                update(ref(db, 'tournaments/current'), { prize: text })
                    .catch(e => console.error("Erro Prêmio:", e));
            }
        });
    }

    // ========== GENERATE CODES ==========
    const btnGerarCodigos = document.getElementById('btn-gerar-codigos');

    if (btnGerarCodigos) {
        btnGerarCodigos.addEventListener('click', async () => {
            // ===== 1. ATIVAR TORNEIO AUTOMATICAMENTE =====
            const name = document.getElementById('tourney-name').value || 'Copa Psyzon FIFA';
            const participants = parseInt(participantsInput.value) || 8;
            const format = formatSelect ? formatSelect.value : 'grupos-mata-mata';
            const homeAway = document.getElementById('tourney-home-away').checked;

            // Gera código único do torneio
            const tourneyCode = await generateTournamentCode('fifa');

            tournamentState.name = name;
            tournamentState.participants = participants;
            tournamentState.format = format;
            tournamentState.homeAway = homeAway;
            tournamentState.status = 'ativo';
            tournamentState.tournamentCode = tourneyCode;
            tournamentState.createdAt = new Date().toISOString();
            tournamentState.updatedAt = new Date().toISOString();
            tournamentState.registeredPlayers = [];

            // Monta chaveamento com slots "A definir"
            const mockParticipants = Array(participants).fill(null).map((_, i) => ({ name: `A definir (Slot ${i+1})` }));
            buildTournamentState(mockParticipants, format);
            renderTournamentFromState(false);
            updateStatus('ativo');

            // ===== 2. GERAR CÓDIGOS (PRESERVANDO EXISTENTES) =====
            if (db) {
                try {
                    const codesRef = ref(db, 'codes/pool');
                    const snap = await get(codesRef);
                    let existingCodes = [];
                    if (snap.exists() && snap.val().codes) {
                        existingCodes = snap.val().codes;
                    }

                    const usedCodes = existingCodes.filter(c => c.used);
                    const unusedCodes = existingCodes.filter(c => !c.used);
                    
                    const needed = participants - usedCodes.length;
                    
                    let finalCodes = [...usedCodes];
                    
                    if (needed > 0) {
                        const existingSet = new Set(existingCodes.map(c => c.code));
                        
                        // Manter os não usados que já existem até completar o necessário
                        unusedCodes.forEach(c => {
                            if (finalCodes.length < participants) {
                                finalCodes.push(c);
                            }
                        });

                        // Gerar novos se ainda faltar para atingir o total de participantes
                        while (finalCodes.length < participants) {
                            let code;
                            do {
                                const num = String(Math.floor(1000 + Math.random() * 9000));
                                code = 'F' + num;
                            } while (existingSet.has(code));
                            
                            existingSet.add(code);
                            finalCodes.push({ code, used: false, usedBy: null });
                        }
                    }

                    // Sincronizar Tudo no Firebase
                    await set(codesRef, { codes: finalCodes });
                    await set(ref(db, 'tournaments/current'), tournamentState);
                    await set(ref(db, 'tournaments/' + tourneyCode), tournamentState);
                    
                    console.log(`✅ Pool de códigos atualizada para ${finalCodes.length} (Preservados ${usedCodes.length} usados)`);
                    alert('Torneio iniciado e códigos atualizados preservando os inscritos!');
                } catch (e) {
                    console.error("Erro na geração de códigos:", e);
                    alert('Erro ao processar códigos no Firebase.');
                }
            }
        });
    }

    // ========== PLAYER PROFILE MODAL ==========
    const modalPerfil = document.getElementById('modal-perfil');
    const perfilTarget = document.getElementById('perfil-card-target');
    const closePerfil = document.getElementById('close-perfil');

    if (closePerfil) closePerfil.addEventListener('click', () => modalPerfil.style.display = 'none');

    async function openPlayerProfile(playerName) {
        if (!playerName || playerName.startsWith('A definir') || playerName.startsWith('1º ') || playerName.startsWith('2º ') || playerName.startsWith('Vencedor ') || playerName.startsWith('Classificado')) return;

        // Mostrar loading no modal
        perfilTarget.innerHTML = '<div style="padding: 40px; text-align: center;"><i class="ph ph-circle-notch animate-spin" style="font-size: 40px; color: #16A34A;"></i><p style="margin-top: 10px; color: #51715C;">Buscando perfil...</p></div>';
        modalPerfil.style.display = 'flex';

        try {
            // 1. Buscar dados do participante no Firebase
            const participantsRef = ref(db, 'participants');
            const pSnap = await get(participantsRef);
            let pData = null;

            if (pSnap.exists()) {
                pSnap.forEach(child => {
                    if (child.val().nome === playerName) {
                        pData = child.val();
                    }
                });
            }

            if (!pData) {
                // Tenta buscar no registeredPlayers do tournamentState como fallback
                const regP = (tournamentState.registeredPlayers || []).find(p => p.name === playerName);
                if (regP) pData = { nome: regP.name, nick: regP.nick, photo: regP.photo, countryCode: regP.countryCode };
            }

            // 2. Calcular estatísticas REAIS
            const stats = {
                nome: pData ? pData.nome : playerName,
                username: pData ? `@${pData.nick || pData.nome.split(' ')[0].toLowerCase()}` : '@atleta',
                foto: pData && pData.photo ? pData.photo : `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerName}`,
                trofeus: 0, finals: 0, semis: 0,
                jogos: 0, vitorias: 0, empates: 0, derrotas: 0, gols: 0, golsSofridos: 0
            };

            // Loop nos grupos para somar stats da fase de grupos
            (tournamentState.groups || []).forEach(group => {
                const p = group.players.find(p => p.name === playerName);
                if (p) {
                    stats.jogos += (p.j || 0);
                    stats.vitorias += (p.v || 0);
                    stats.empates += (p.e || 0);
                    stats.derrotas += (p.d || 0);
                    stats.gols += (p.gp || 0);
                    stats.golsSofridos += (p.gc || 0);
                }
            });

            // Loop no mata-mata (EXCLUINDO repescagem — sem impacto nas estatísticas gerais)
            if (tournamentState.knockout) {
                const allKMatches = [];
                // NÃO incluir repechage — stats de repescagem não contam
                (tournamentState.knockout.rounds || []).forEach(r => allKMatches.push(...r.matches));

                allKMatches.forEach(m => {
                    if ((m.p1 === playerName || m.p2 === playerName) && m.s1 !== "" && m.s2 !== "") {
                        stats.jogos++;
                        const sMe = m.p1 === playerName ? parseInt(m.s1) : parseInt(m.s2);
                        const sOpp = m.p1 === playerName ? parseInt(m.s2) : parseInt(m.s1);
                        stats.gols += sMe;
                        stats.golsSofridos += sOpp;
                        if (sMe > sOpp) stats.vitorias++;
                        else if (sMe < sOpp) stats.derrotas++;
                    }
                });

                // Detectar Finais e Semis para os badges
                const rounds = tournamentState.knockout.rounds || [];
                rounds.forEach(r => {
                    r.matches.forEach(m => {
                        if (m.p1 === playerName || m.p2 === playerName) {
                            if (r.name === 'Final') stats.finals = 1;
                            if (r.name === 'Semifinal') stats.semis = 1;
                        }
                    });
                });

                if (tournamentState.top3 && tournamentState.top3.first === playerName) stats.trofeus = 1;
            }

            // 3. Renderizar o card
            const saldo = stats.gols - stats.golsSofridos;
            let saldoClass = saldo > 0 ? 'saldo-pos' : (saldo < 0 ? 'saldo-neg' : 'saldo-neu');

            perfilTarget.innerHTML = `
                <div class="profile-card">
                    <div class="profile-header">
                        <div class="avatar-wrapper">
                            <img src="${stats.foto}" alt="">
                        </div>
                        <div class="profile-info" style="flex: 1; min-width: 0;">
                            <h1 style="word-break: break-word; line-height: 1.1;">${stats.nome}</h1>
                            <span class="username">${stats.username}</span>
                        </div>
                    </div>
                    <div class="main-badges">
                        <div class="badge-item">
                            <i class="ph-fill ph-trophy badge-icon"></i>
                            <span class="badge-value">${stats.trofeus}</span>
                            <span class="badge-label">Troféus</span>
                        </div>
                        <div class="badge-item">
                            <i class="ph-fill ph-medal badge-icon" style="color: #cbd5e1;"></i>
                            <span class="badge-value">${stats.finals}</span>
                            <span class="badge-label">Finais</span>
                        </div>
                        <div class="badge-item">
                            <i class="ph-fill ph-target badge-icon" style="color: #94a3b8;"></i>
                            <span class="badge-value">${stats.semis}</span>
                            <span class="badge-label">Semis</span>
                        </div>
                    </div>
                    <div class="general-stats">
                        <div class="stats-grid">
                            <div class="stat-box"><span class="stat-box-value">${stats.jogos}</span><span class="stat-box-label">Jogos</span></div>
                            <div class="stat-box"><span class="stat-box-value">${stats.vitorias}</span><span class="stat-box-label">Vitórias</span></div>
                            <div class="stat-box"><span class="stat-box-value">${stats.empates}</span><span class="stat-box-label">Empates</span></div>
                            <div class="stat-box"><span class="stat-box-value">${stats.derrotas}</span><span class="stat-box-label">Derrotas</span></div>
                            <div class="stat-box"><span class="stat-box-value">${stats.gols}</span><span class="stat-box-label">Gols</span></div>
                            <div class="stat-box"><span class="stat-box-value">${stats.golsSofridos}</span><span class="stat-box-label">Sofridos</span></div>
                            <div class="stat-box highlight ${saldoClass}">
                                <span class="stat-box-label">Saldo de Gols</span>
                                <span class="stat-box-value" style="font-size: 1.2rem; font-weight: 800;">${saldo > 0 ? '+' : ''}${saldo}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error('Erro ao carregar perfil:', e);
            perfilTarget.innerHTML = '<p style="padding: 20px; color: #ef4444; text-align: center;">Erro ao carregar os dados do atleta.</p>';
        }
    }
    window.openPlayerProfile = openPlayerProfile; // Torna global para o onclick

    function askSensitivePassword(actionFn) {
        if (role !== 'organizador') return;
        pendingSensitiveAction = actionFn;
        const titleEl = document.querySelector('#modal-sensitive-password .modal-header h2');
        const textEl = document.querySelector('#modal-sensitive-password .modal-header p');
        const actionLabel = ACTION_LABELS[actionFn?.actionId] || 'Ação administrativa';
        if (titleEl) titleEl.textContent = 'Confirmar ação administrativa';
        if (textEl) textEl.textContent = `Essa ação é sensível e precisa da senha do organizador (${actionLabel}).`;
        if (sensitivePasswordInput) sensitivePasswordInput.value = '';
        if (sensitivePasswordError) sensitivePasswordError.style.display = 'none';
        modalSensitivePassword?.classList.add('active');
        setTimeout(() => sensitivePasswordInput?.focus(), 30);
    }

    btnConfirmSensitivePassword?.addEventListener('click', async () => {
        if (!pendingSensitiveAction) {
            modalSensitivePassword?.classList.remove('active');
            return;
        }
        if ((sensitivePasswordInput?.value || '').trim() !== SENSITIVE_PASSWORD) {
            if (sensitivePasswordError) sensitivePasswordError.style.display = 'block';
            return;
        }
        modalSensitivePassword?.classList.remove('active');
        const action = pendingSensitiveAction;
        pendingSensitiveAction = null;
        await action();
    });

    document.getElementById('btn-close-sensitive-password')?.addEventListener('click', () => modalSensitivePassword?.classList.remove('active'));

    function shuffleArray(arr) {
        const c = [...arr];
        for (let i = c.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [c[i], c[j]] = [c[j], c[i]];
        }
        return c;
    }

    document.getElementById('btn-shuffle-next-phase')?.addEventListener('click', () => {
        initializeNextPhaseMatchEditor(pendingNextPhaseQualified, 'shuffle');
        renderNextPhasePreview(pendingNextPhaseQualified);
        renderNextPhaseMatchEditor();
    });

    document.getElementById('btn-clear-next-phase')?.addEventListener('click', () => {
        initializeNextPhaseMatchEditor(pendingNextPhaseQualified, 'empty');
        renderNextPhaseMatchEditor();
    });

    document.getElementById('btn-fill-next-phase')?.addEventListener('click', () => {
        initializeNextPhaseMatchEditor(pendingNextPhaseQualified, 'autofill');
        renderNextPhaseMatchEditor();
    });

    document.getElementById('btn-confirm-next-phase')?.addEventListener('click', async () => {
        const matchesFromEditor = pendingNextPhaseMatches.length ? pendingNextPhaseMatches : [];
        if (!pendingNextPhaseQualified.length || !matchesFromEditor.length) {
            alert('Informe ao menos um classificado.');
            return;
        }
        if (!tournamentState.knockout?.rounds?.length) return;
        const hasEmpty = matchesFromEditor.some(m => !m.p1 || !m.p2);
        if (hasEmpty) {
            alert('Ainda existem confrontos vazios.');
            return;
        }
        const duplicates = getDuplicatePlayersFromMatches(matchesFromEditor);
        if (duplicates.length) {
            alert('Este jogador já foi selecionado em outro jogo.');
            return;
        }
        const hasSameMatchPlayer = matchesFromEditor.some(m => isRealPlayer(m.p1) && isRealPlayer(m.p2) && m.p1 === m.p2);
        if (hasSameMatchPlayer) {
            alert('Não é permitido o mesmo jogador contra ele mesmo.');
            return;
        }
        const selectedPlayers = matchesFromEditor.flatMap(m => [m.p1, m.p2]).filter(isRealPlayer);
        const missingPlayers = pendingNextPhaseQualified.filter(name => !selectedPlayers.includes(name));
        if (missingPlayers.length) {
            alert('Distribuição inválida de classificados.');
            return;
        }

        const firstRound = tournamentState.knockout.rounds[0];
        const matches = [];
        for (let i = 0; i < matchesFromEditor.length; i++) {
            const p1 = matchesFromEditor[i].p1 || 'BYE';
            const p2 = matchesFromEditor[i].p2 || 'BYE';
            const winnerToken = firstRound.matches?.[i]?.winnerToken || `Vencedor ${firstRound.name} ${i + 1}`;
            const newMatch = createMatchData(p1, p2, winnerToken);
            resolveByeMatchOutcome(newMatch);
            matches.push(newMatch);
        }
        firstRound.matches = matches;

        matches.forEach(m => {
            if (m.walkover && m.winner) {
                propagateWinnerToNextRound(tournamentState.knockout, m.winnerToken, m.winner, 0);
            }
        });

        recalculateGeneralStats();
        await persistCurrentTournament();
        renderTournamentFromState();
        modalNextPhase?.classList.remove('active');
        alert('Próxima fase definida com sucesso.');
    });

    document.getElementById('btn-close-next-phase')?.addEventListener('click', () => {
        pendingNextPhaseMatches = [];
        pendingNextPhaseSignature = '';
        modalNextPhase?.classList.remove('active');
    });

    document.getElementById('btn-logout-organizer')?.addEventListener('click', () => {
        ['organizerAuth', 'organizerRole', 'copaAuth', 'adminSession'].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
        window.location.href = '../index.html';
    });

    // ========== ACTION BUTTONS ==========
    const actions = {
        'btn-embaralhar': () => {
            if (!tournamentState.groups || tournamentState.groups.length === 0) return;
            let allPlayers = [];
            tournamentState.groups.forEach(g => {
                g.players.forEach(p => allPlayers.push({ name: p.name }));
            });
            for (let i = allPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
            }
            buildTournamentState(allPlayers, tournamentState.format);
            renderTournamentFromState(false);
            persistCurrentTournament({ groups: tournamentState.groups, knockout: tournamentState.knockout })
                .catch(e => console.error('Erro ao embaralhar:', e));
        },
        'btn-atualizar': async () => {
            if (!tournamentState.groups || tournamentState.groups.length === 0) {
                alert('Nenhum grupo ativo para atualizar.');
                return;
            }

            console.log('[Action] Resolving Knockout names from Groups...');
            
            // 1. Get Top Players from each group
            const groupLeaders = {}; // { 'Grupo A': [p1, p2, p3], ... }
            
            tournamentState.groups.forEach(g => {
                const sorted = [...g.players].sort((a, b) => {
                    if (b.pts !== a.pts) return b.pts - a.pts;
                    if (b.sg !== a.sg) return b.sg - a.sg;
                    return b.gp - a.gp;
                });
                groupLeaders[g.name] = sorted;
            });

            // 2. Helper to replace placeholders
            const resolveName = (str) => {
                if (!str) return 'A definir';
                // Pattern: "1º Grupo A" or "2º Grupo B"
                const match = str.match(/(\d)º (Grupo [A-Z])/);
                if (match) {
                    const pos = parseInt(match[1]) - 1;
                    const gName = match[2];
                    if (groupLeaders[gName] && groupLeaders[gName][pos]) {
                        return groupLeaders[gName][pos].name;
                    }
                }
                return str;
            };

            // 3. Update Knockout Rounds
            if (tournamentState.knockout) {
                // Repechage
                if (tournamentState.knockout.repechage) {
                    tournamentState.knockout.repechage.forEach(m => {
                        m.p1 = resolveName(m.p1);
                        m.p2 = resolveName(m.p2);
                    });
                }
                // Regular Rounds
                if (tournamentState.knockout.rounds) {
                    tournamentState.knockout.rounds.forEach(round => {
                        round.matches.forEach(m => {
                            m.p1 = resolveName(m.p1);
                            m.p2 = resolveName(m.p2);
                        });
                    });
                }
            }

            // 4. Save to Firebase
            try {
                await persistCurrentTournament({ knockout: tournamentState.knockout });
                renderTournamentFromState();
                alert('Chaveamento atualizado com os classificados dos grupos!');
            } catch (e) {
                console.error('Erro ao atualizar chaveamento:', e);
                alert('Erro ao salvar no Firebase.');
            }
        },
        'btn-encerrar': async () => {
            if (!isTournamentFullyCompleted()) {
                alert('Não é possível encerrar. Existem jogos pendentes.');
                return;
            }
            recalculateGeneralStats();
            const finishedAt = new Date().toISOString();
            tournamentState.status = 'encerrado';
            tournamentState.finishedAt = finishedAt;
            tournamentState.updatedAt = finishedAt;
            updateStatus('encerrado');
            top3Container.style.display = 'flex';

            const rankingFinal = Object.values(tournamentState.generalStats || {}).sort((a, b) => {
                if (b.pts !== a.pts) return b.pts - a.pts;
                if (b.v !== a.v) return b.v - a.v;
                if (b.sg !== a.sg) return b.sg - a.sg;
                if (b.gp !== a.gp) return b.gp - a.gp;
                if (a.gc !== b.gc) return a.gc - b.gc;
                return (a.name || '').localeCompare(b.name || '', 'pt-BR');
            });
            const historyPayload = {
                id: `hist_${Date.now()}`,
                type: 'tournament-history',
                status: 'finalizado',
                name: tournamentState.name || 'Torneio sem nome',
                tournamentType: 'fifa',
                modality: 'fifa',
                code: tournamentState.tournamentCode || null,
                createdAt: tournamentState.createdAt || new Date().toISOString(),
                finishedAt,
                participants: tournamentState.registeredPlayers || [],
                groups: tournamentState.groups || [],
                repechage: tournamentState.knockout?.repechage || [],
                knockout: tournamentState.knockout || null,
                champion: tournamentState.top3?.first || '—',
                vice: tournamentState.top3?.second || '—',
                generalStats: tournamentState.generalStats || {},
                rankingFinal,
                results: {
                    groups: (tournamentState.groups || []).flatMap(g => g.matches || []),
                    knockout: tournamentState.knockout || null
                },
                importedAt: finishedAt
            };

            try {
                await persistCurrentTournament({ status: 'encerrado', generalStats: tournamentState.generalStats, finishedAt });
                if (db) await set(ref(db, `imports/${historyPayload.id}`), historyPayload);
                alert('Torneio encerrado e salvo no histórico.');
            } catch (e) {
                console.error('Erro ao encerrar torneio:', e);
                alert('Erro ao encerrar e salvar o torneio.');
            }
        },
        'btn-resetar': async () => {
            if (!confirm('Resetar apenas os resultados do torneio atual?')) return;
            (tournamentState.groups || []).forEach(g => {
                (g.matches || []).forEach(m => {
                    m.gHome = '';
                    m.gAway = '';
                });
                g.players.forEach(p => { p.j = 0; p.v = 0; p.e = 0; p.d = 0; p.gp = 0; p.gc = 0; p.sg = 0; p.pts = 0; });
            });
            if (tournamentState.knockout) {
                resetKnockoutResults(tournamentState.knockout);
            }
            tournamentState.top3 = { first: '—', second: '—', third: '—' };
            tournamentState.status = 'ativo';
            tournamentState.generalStats = {};
            repechageModalShown = false;
            try {
                await persistCurrentTournament();
                renderTournamentFromState();
                alert('Resultados do torneio resetados com sucesso.');
            } catch (e) {
                console.error('Erro ao resetar torneio:', e);
                alert('Erro ao resetar torneio.');
            }
        },
        'btn-resetar-tudo': async () => {
            if (!confirm('Tem certeza que deseja resetar tudo? Essa ação apagará todos os dados do torneio atual.')) return;
            try {
                if (db) await remove(ref(db, 'tournaments/current'));
                tournamentState = {
                    name: '',
                    participants: 8,
                    format: 'grupos-mata-mata',
                    homeAway: false,
                    prize: '',
                    status: 'aguardando',
                    groups: [],
                    codes: tournamentState.codes || [],
                    tournamentCode: null,
                    top3: { first: '—', second: '—', third: '—' },
                    createdAt: null,
                    generalStats: {}
                };
                repechageModalShown = false;
                renderTournamentFromState();
                updateStatus('aguardando');
                alert('Torneio resetado completamente.');
            } catch (e) {
                console.error('Erro no reset completo:', e);
                alert('Erro ao resetar completamente.');
            }
        },
        'btn-resetar-codigos': async () => {
            if (confirm('Deseja resetar todos os códigos? Todos voltarão a ficar disponíveis.')) {
                if (!db) return;
                try {
                    const docRef = ref(db, 'codes/pool');
                    const snap = await get(docRef);
                    if (snap.exists()) {
                        const data = snap.val();
                        const resetCodes = (data.codes || []).map(c => ({ ...c, used: false, usedBy: null }));
                        await update(docRef, { codes: resetCodes });
                        alert('Códigos resetados com sucesso!');
                    }
                } catch (e) {
                    console.error('Erro ao resetar códigos:', e);
                    alert('Erro ao resetar códigos no Firebase.');
                }
            }
        },
        'btn-apagar-cadastro': async () => {
            const cpf = prompt('Informe o CPF do participante que deseja apagar (somente números):');
            if (!cpf) return;

            const cpfRaw = cpf.replace(/\D/g, '');
            if (cpfRaw.length !== 11) {
                alert('CPF inválido. Deve conter 11 dígitos.');
                return;
            }

            if (confirm(`Tem certeza que deseja apagar o cadastro do CPF ${cpfRaw}?`)) {
                if (!db) return;
                try {
                    // 1. Remover da lista de participantes geral
                    await remove(ref(db, 'participants/' + cpfRaw));

                    // 2. Remover do torneio atual (se estiver lá)
                    const tRef = ref(db, 'tournaments/current');
                    const tSnap = await get(tRef);
                    if (tSnap.exists()) {
                        const tData = tSnap.val();
                        const regPlayers = tData.registeredPlayers || [];
                        const filteredPlayers = regPlayers.filter(p => p.id !== cpfRaw);
                        
                        if (regPlayers.length !== filteredPlayers.length) {
                            await update(tRef, { registeredPlayers: filteredPlayers });
                        }
                    }

                    // 3. Marcar código como disponível novamente (se houver um código associado)
                    const cRef = ref(db, 'codes/pool');
                    const cSnap = await get(cRef);
                    if (cSnap.exists()) {
                        const cData = cSnap.val();
                        const codesArray = cData.codes || [];
                        const updatedCodes = codesArray.map(c => {
                            if (c.usedBy === cpfRaw) {
                                return { ...c, used: false, usedBy: null };
                            }
                            return c;
                        });
                        await update(cRef, { codes: updatedCodes });
                    }

                    alert('Cadastro removido com sucesso!');
                } catch (e) {
                    console.error('Erro ao apagar cadastro:', e);
                    alert('Erro ao apagar cadastro no Firebase.');
                }
            }
        },
    };

    Object.entries(actions).forEach(([id, fn]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (SENSITIVE_IDS.has(id)) {
                fn.actionId = id;
                askSensitivePassword(fn);
            } else {
                fn();
            }
        });
    });

    // ========== MOBILE SIDEBAR TOGGLE ==========
    if (btnToggleOrganizer && organizerPanel) {
        btnToggleOrganizer.addEventListener('click', () => {
            organizerPanel.classList.toggle('active');
        });
        
        // Fechar ao clicar fora no mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1100 && organizerPanel.classList.contains('active')) {
                if (!organizerPanel.contains(e.target) && !btnToggleOrganizer.contains(e.target)) {
                    organizerPanel.classList.remove('active');
                }
            }
        });
    }

    // ========== FAB SHARE ==========
    const fabShare = document.getElementById('fab-share');
    if (fabShare) {
        fabShare.addEventListener('click', () => {
            if (navigator.share) {
                navigator.share({ title: 'Copa Psyzon', text: 'Acompanhe o torneio!', url: window.location.href });
            } else {
                navigator.clipboard.writeText(window.location.href);
                alert('Link copiado!');
            }
        });
    }

    // Removido bloco duplicado do Mobile Sidebar Toggle
    // ========== VER CLIENTES ==========
    const btnClientes = document.getElementById('btn-ver-clientes');
    if (btnClientes) {
        btnClientes.addEventListener('click', () => {
            window.location.href = '../ficha.html';
        });
    }

    // ========== EXPORT JSON ==========
    const btnExportJson = document.getElementById('btn-export-json');
    if (btnExportJson) {
        btnExportJson.addEventListener('click', () => {
            if (!tournamentState || (!tournamentState.groups && !tournamentState.name)) {
                alert("Nenhum torneio válido para exportar.");
                return;
            }
            
            // Format for compatibility with the old system (if it's active) or just dump state
            let exportData = {
                tournamentName: tournamentState.name || 'Torneio_Exportado',
                tournamentFormat: tournamentState.format,
                status: tournamentState.status,
                registeredPlayers: tournamentState.registeredPlayers || [],
                groups: tournamentState.groups || [],
                knockout: tournamentState.knockout || null
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `backup_${exportData.tournamentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });
    }

    // ========== IMPORT BACKUP (COMPLETO) ==========
    let pendingImportData = null;

    const btnPreviewImport = document.getElementById('btn-preview-import');
    const btnConfirmImport = document.getElementById('btn-confirm-import');
    const importPreviewArea = document.getElementById('import-preview-area');
    const importFileInput = document.getElementById('import-file');

    if (btnPreviewImport) {
        btnPreviewImport.addEventListener('click', () => {
            const file = importFileInput ? importFileInput.files[0] : null;
            if (!file) { alert('Selecione um arquivo JSON de backup.'); return; }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    pendingImportData = data;

                    // Build preview
                    const groups = data.groups || [];
                    const players = data.players || [];
                    const totalMatches = groups.reduce((acc, g) => acc + (g.matches || []).length, 0);
                    const totalTeams = groups.reduce((acc, g) => acc + (g.teams || []).length, 0);

                    let html = `<h4 style="margin:0 0 8px; color:#16A34A;">📦 Resumo do Backup</h4>`;
                    html += `<p><b>Torneio:</b> ${data.tournamentName || 'N/A'}</p>`;
                    html += `<p><b>Formato:</b> ${data.tournamentFormat || 'N/A'} | <b>Ida/Volta:</b> ${data.twoLegged ? 'Sim' : 'Não'}</p>`;
                    html += `<p><b>Grupos:</b> ${groups.length} | <b>Times:</b> ${totalTeams} | <b>Jogos:</b> ${totalMatches}</p>`;
                    html += `<p><b>Jogadores cadastrados:</b> ${players.length}</p>`;
                    html += `<hr style="border-color:rgba(255,255,255,0.1);margin:8px 0;">`;

                    groups.forEach(g => {
                        html += `<p style="margin:4px 0;"><b>${g.name || g.id}</b> — ${(g.teams || []).length} times, ${(g.matches || []).length} jogos</p>`;
                    });

                    if (data.groupDirectQualified) html += `<p><b>Classificados diretos:</b> ${data.groupDirectQualified.length}</p>`;
                    if (data.groupRepechage) html += `<p><b>Repescagem:</b> ${data.groupRepechage.length} jogos</p>`;

                    html += `<p style="margin-top:10px; color:#facc15;">⚠️ Clique em "IMPORTAR BACKUP" para restaurar o torneio.</p>`;

                    importPreviewArea.innerHTML = html;
                    importPreviewArea.style.display = 'block';
                    if (btnConfirmImport) btnConfirmImport.style.display = 'block';
                } catch (err) {
                    alert('Erro ao ler o arquivo JSON. Verifique se é válido.');
                    console.error(err);
                }
            };
            reader.readAsText(file);
        });
    }

    if (btnConfirmImport) {
        btnConfirmImport.addEventListener('click', async () => {
            if (!pendingImportData) { alert('Nenhum backup pré-visualizado.'); return; }
            if (!db) { alert('Firebase não conectado.'); return; }

            const data = pendingImportData;
            btnConfirmImport.disabled = true;
            btnConfirmImport.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Importando...';

            try {
                // ======= 1. CRIAR JOGADORES (participants) =======
                const playersFromBackup = data.players || [];
                for (const p of playersFromBackup) {
                    const key = p.cpf || p.id;
                    if (!key) continue;
                    await set(ref(db, 'participants/' + key), {
                        nome: p.name || p.playerName || '',
                        nick: p.nick || p.teamName || '',
                        instagram: p.instagram || '',
                        whatsapp: p.whatsapp || '',
                        cpf: p.cpf || '',
                        photo: p.photo || '',
                        flagId: p.flagId || 'br',
                        code: p.code || '',
                        registeredAt: p.registeredAt || new Date().toISOString(),
                        id: p.id || key
                    });
                }
                console.log(`✅ ${playersFromBackup.length} jogadores importados para Firebase.`);

                // ======= 2. CONSTRUIR TOURNAMENT STATE =======
                const groups = (data.groups || []).map((g, gIdx) => {
                    const groupName = g.name || `Grupo ${String.fromCharCode(65 + gIdx)}`;
                    
                    // Build players from standings (mais confiável que teams para stats)
                    const standings = g.standings || [];
                    const players = standings.map(s => ({
                        name: s.playerName || s.teamName || 'Sem nome',
                        j: s.played || 0,
                        v: s.wins || 0,
                        e: s.draws || 0,
                        d: s.losses || 0,
                        gp: s.goalsFor || 0,
                        gc: s.goalsAgainst || 0,
                        sg: s.goalDiff || (s.goalsFor || 0) - (s.goalsAgainst || 0),
                        pts: s.points || 0
                    }));

                    // Garantir que os jogadores do teams[] que não estão no standings[] sejam adicionados
                    if (players.length === 0 && g.teams) {
                        g.teams.forEach(t => {
                            players.push({
                                name: t.playerName || t.teamName || 'Sem nome',
                                j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0
                            });
                        });
                    }

                    // Build matches
                    const matches = (g.matches || []).map(m => {
                        const homeName = m.team1 ? (m.team1.playerName || m.team1.teamName) : '?';
                        const awayName = m.team2 ? (m.team2.playerName || m.team2.teamName) : '?';
                        
                        if ((m.twoLegged || data.twoLegged) && m.ida && m.volta) {
                            return {
                                home: homeName,
                                away: awayName,
                                idaVolta: true,
                                gHomeIda: m.ida.score1 != null ? String(m.ida.score1) : '',
                                gAwayIda: m.ida.score2 != null ? String(m.ida.score2) : '',
                                gHomeVolta: m.volta.score1 != null ? String(m.volta.score1) : '',
                                gAwayVolta: m.volta.score2 != null ? String(m.volta.score2) : '',
                                gHome: m.team1 ? String(m.team1.score || '') : '',
                                gAway: m.team2 ? String(m.team2.score || '') : '',
                                status: m.status || 'pending'
                            };
                        }

                        return {
                            home: homeName,
                            away: awayName,
                            idaVolta: false,
                            gHome: m.team1 ? String(m.team1.score || '') : '',
                            gAway: m.team2 ? String(m.team2.score || '') : '',
                            status: m.status || 'pending'
                        };
                    });

                    return { name: groupName, players, matches };
                });

                // ======= 3. CONSTRUIR REGISTERED PLAYERS =======
                const registeredPlayers = [];
                const allTeamsFromGroups = [];
                (data.groups || []).forEach(g => {
                    (g.teams || []).forEach(t => {
                        allTeamsFromGroups.push(t);
                        const playerData = playersFromBackup.find(p => p.id === t.id) || {};
                        registeredPlayers.push({
                            name: t.playerName || '',
                            nick: t.teamName || '',
                            photo: playerData.photo || '',
                            flagId: t.flagId || 'br',
                            countryCode: t.flagId || 'br',
                            id: t.id || ''
                        });
                    });
                });

                // ======= 4. CONSTRUIR KNOCKOUT =======
                let knockout = null;
                const hasKnockout = data.groupDirectQualified || data.groupRepechage;
                
                if (hasKnockout) {
                    knockout = { rounds: [] };

                    // Repechage round
                    if (data.groupRepechage && data.groupRepechage.length > 0) {
                        knockout.repechage = data.groupRepechage.map(m => ({
                            p1: m.team1 ? (m.team1.playerName || m.team1.teamName) : 'A definir',
                            p2: m.team2 ? (m.team2.playerName || m.team2.teamName) : 'A definir',
                            s1: m.team1 ? (m.team1.score || '') : '',
                            s2: m.team2 ? (m.team2.score || '') : '',
                            status: m.status || 'pending',
                            winner: m.winner || 0
                        }));
                    }

                    // Direct qualified → 1st round of knockout
                    if (data.groupDirectQualified && data.groupDirectQualified.length > 0) {
                        const qualified = data.groupDirectQualified;
                        const firstRoundMatches = [];
                        for (let i = 0; i < qualified.length; i += 2) {
                            const p1 = qualified[i] ? (qualified[i].playerName || qualified[i].teamName) : 'A definir';
                            const p2 = qualified[i + 1] ? (qualified[i + 1].playerName || qualified[i + 1].teamName) : 'A definir';
                            firstRoundMatches.push({ p1, p2, s1: '', s2: '' });
                        }
                        knockout.rounds.push({ name: 'Quartas de Final', matches: firstRoundMatches });
                    }
                }

                // ======= 5. MONTAR TOURNAMENT STATE FINAL =======
                const format = data.tournamentFormat === 'groups' ? 'grupos-mata-mata' : (data.tournamentFormat || 'grupos-mata-mata');
                
                const newState = {
                    name: data.tournamentName || 'Torneio Importado',
                    participants: allTeamsFromGroups.length,
                    format: format,
                    homeAway: data.twoLegged || false,
                    status: 'ativo',
                    tournamentCode: tournamentState.tournamentCode || 'IMP' + Date.now().toString(36).toUpperCase(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    registeredPlayers: registeredPlayers,
                    groups: groups,
                    knockout: knockout
                };

                // ======= 6. SALVAR NO FIREBASE =======
                await set(ref(db, 'tournaments/current'), newState);
                console.log('✅ Torneio importado e salvo no Firebase!');

                // ======= 7. ATUALIZAR UI =======
                Object.assign(tournamentState, newState);
                renderTournamentFromState(false);
                updateStatus('ativo');

                // Atualizar campos de config
                const nameInput = document.getElementById('tourney-name');
                if (nameInput) nameInput.value = newState.name;
                if (participantsInput) participantsInput.value = newState.participants;
                const homeAwayInput = document.getElementById('tourney-home-away');
                if (homeAwayInput) homeAwayInput.checked = newState.homeAway;
                if (formatSelect) formatSelect.value = newState.format;
                updatePreview();
                if (formatSelect) formatSelect.value = newState.format;


                // Esconder preview
                if (importPreviewArea) importPreviewArea.style.display = 'none';
                btnConfirmImport.style.display = 'none';

                alert('✅ Backup restaurado com sucesso!\n\n' +
                    `• ${groups.length} grupos criados\n` +
                    `• ${registeredPlayers.length} jogadores vinculados\n` +
                    `• ${playersFromBackup.length} cadastros no Firebase\n` +
                    `• Classificação e jogos restaurados`);

                pendingImportData = null;

            } catch (err) {
                console.error('❌ Erro na importação:', err);
                alert('Erro ao importar backup: ' + err.message);
            } finally {
                btnConfirmImport.disabled = false;
                btnConfirmImport.innerHTML = '<i class="ph-bold ph-upload-simple"></i> IMPORTAR BACKUP';
            }
        });
    }

    // ========== GROUP MATCHES MODAL LISTENERS ==========
    const chkIdaVolta = document.getElementById('chk-ida-volta');
    if (chkIdaVolta) {
        chkIdaVolta.addEventListener('change', (e) => {
            if (selectedGroupIndex === null) return;
            const group = tournamentState.groups[selectedGroupIndex];
            const hasScores = (group.matches || []).some(m => m.gHome !== "" || m.gAway !== "");
            
            if (hasScores && !confirm('Isso vai resetar os placares atuais. Continuar?')) {
                e.target.checked = !e.target.checked;
                return;
            }

            const names = group.players.map(p => p.name);
            group.matches = generateRoundRobin(names, e.target.checked);
            renderGroupMatchesList();
        });
    }

    const btnSalvarJogos = document.getElementById('btn-salvar-jogos-grupo');
    if (btnSalvarJogos) {
        btnSalvarJogos.addEventListener('click', async () => {
            if (selectedGroupIndex === null) return;
            
            const btn = btnSalvarJogos;
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Salvando...';

            try {
                // Update stats
                updateGroupStats(selectedGroupIndex);
                recalculateGeneralStats();
                
                // Persist
                await persistCurrentTournament({ generalStats: tournamentState.generalStats });

                renderTournamentFromState();
                document.getElementById('modal-jogos-grupo').classList.remove('active');
                alert('Placares salvos com sucesso!');
            } catch (e) {
                console.error('Erro ao salvar jogos:', e);
                alert('Erro ao salvar no Firebase.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }

    // Modal Close
    document.querySelectorAll('.btn-close-modal, #btn-cancelar-jogos').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        });
    });

});
