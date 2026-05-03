/* ================================================
   FIFA DASHBOARD — Copa Psyzon
   Logic Controller (Firebase-Ready)
   ================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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
let auth = null;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
try {
    if (firebaseConfig.apiKey !== "SUA_API_KEY") {
        const app = initializeApp(firebaseConfig);
        analytics = getAnalytics(app);
        db = getDatabase(app);
        auth = getAuth(app);
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
    const requestedRole = urlParams.get('role') || 'visitante';
    let role = requestedRole;
    const participantId = urlParams.get('id') || null;
    const participantName = urlParams.get('name') ? decodeURIComponent(urlParams.get('name')) : null;
    let liveUser = null;
    let livePlayerMuted = false;
    let livePlayerPlaying = false;
    let liveControlsHideTimer = null;
    const KNOCKOUT_VIEW_STORAGE_KEY = 'copaPsyzon_knockoutViewMode';
    let knockoutViewMode = localStorage.getItem(KNOCKOUT_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'tree';

    document.querySelectorAll('[data-game-switch]').forEach(link => {
        const game = link.dataset.gameSwitch;
        const target = game === 'sinuca' ? '../SINUCA/sinuca.html' : 'Fifa.html';
        const params = new URLSearchParams();
        params.set('role', role);
        if (participantId) params.set('id', participantId);
        if (participantName) params.set('name', participantName);
        link.href = `${target}?${params.toString()}`;
    });

    const badge = document.getElementById('user-role-badge');
    const organizerPanel = document.getElementById('organizer-panel');
    const btnExitTopbar = document.getElementById('btn-exit-topbar');
    const btnToggleOrganizer = document.getElementById('btn-toggle-organizer');
    let isOrganizerAuthorized = false;

    if (requestedRole === 'organizador') {
        role = 'visitante';
    }

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

    const applyRoleUI = (nextRole) => {
        role = nextRole;
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
        const currentRoleStyle = roleStyles[role] || roleStyles.visitante;
        badge.style.background = currentRoleStyle.bg;
        badge.style.color = currentRoleStyle.color;
    };

    if (requestedRole === 'organizador' && auth) {
        onAuthStateChanged(auth, (user) => {
            if (!user) {
                isOrganizerAuthorized = false;
                window.location.href = '../index.html';
                return;
            }
            isOrganizerAuthorized = true;
            applyRoleUI('organizador');
            setTimeout(() => renderLiveSection(), 0);
        });
    }

    if (auth) {
        onAuthStateChanged(auth, (user) => {
            liveUser = user;
            renderLiveAuth();
        });
    }

    // Inicializa o módulo de Ranking
    initRankingSystem(db, role);
    document.getElementById('ranking-view-current')?.addEventListener('click', () => {
        rankingViewMode = 'current';
        document.getElementById('ranking-view-current')?.classList.add('active');
        document.getElementById('ranking-view-general')?.classList.remove('active');
        renderRanking();
    });
    document.getElementById('ranking-view-general')?.addEventListener('click', () => {
        rankingViewMode = 'general';
        document.getElementById('ranking-view-general')?.classList.add('active');
        document.getElementById('ranking-view-current')?.classList.remove('active');
        renderRanking();
    });
    document.getElementById('ranking-player-search')?.addEventListener('input', (e) => {
        rankingSearchTerm = e.target.value || '';
        renderRanking();
    });
    document.getElementById('ranking-modality-filter')?.addEventListener('change', () => {
        if (rankingViewMode === 'general') renderRanking();
    });

    // ========== TOURNAMENT STATE (Firebase-Ready) ==========
    const LIVE_LOCAL_STORAGE_KEY = 'copaPsyzon_fifa_liveState';

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
        live: createDefaultLiveState(),
    };

    let selectedGroupIndex = null;
    let selectedKnockoutMatch = null; // { type, rIdx, mIdx }

    async function sha256Hex(value) {
        const encoded = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest('SHA-256', encoded);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function getPlayerIdentityValues(player) {
        if (!player || typeof player !== 'object') return [];
        return [
            player.id,
            player.uid,
            player.participantId,
            player.playerId,
            player.cpf,
            player.cpfRaw,
            player.usedBy
        ].filter(Boolean).map(String);
    }

    function matchesRemovalTarget(player, target) {
        if (!player || !target) return false;
        const ids = target.ids || new Set();
        const values = getPlayerIdentityValues(player);
        if (values.some(value => ids.has(value))) return true;
        if (target.cpfRaw && values.includes(target.cpfRaw)) return true;
        if (target.cpfHash && player.cpfHash === target.cpfHash) return true;
        return false;
    }

    async function resolveParticipantRemovalTarget(identifier) {
        const raw = String(identifier || '').trim();
        const cpfRaw = raw.replace(/\D/g, '');
        const canUseCpf = cpfRaw.length === 11;
        let resolvedCpfRaw = canUseCpf ? cpfRaw : null;
        let resolvedCpfHash = canUseCpf ? await sha256Hex(cpfRaw) : null;
        const ids = new Set([raw]);
        if (canUseCpf) ids.add(cpfRaw);

        if (resolvedCpfHash) {
            const hashIdxSnap = await get(ref(db, 'participantsByCpfHash/' + resolvedCpfHash));
            if (hashIdxSnap.exists()) {
                const indexedValue = hashIdxSnap.val();
                if (typeof indexedValue === 'string') ids.add(indexedValue);
                if (indexedValue && typeof indexedValue === 'object') {
                    getPlayerIdentityValues(indexedValue).forEach(value => ids.add(value));
                }
            }
        }

        const participantsSnap = await get(ref(db, 'participants'));
        const names = new Set();
        if (participantsSnap.exists()) {
            participantsSnap.forEach(child => {
                const key = String(child.key);
                const data = child.val() || {};
                const keyMatches = ids.has(key);
                const dataMatches = matchesRemovalTarget(data, { ids, cpfRaw: resolvedCpfRaw, cpfHash: resolvedCpfHash });
                if (keyMatches || dataMatches) {
                    ids.add(key);
                    getPlayerIdentityValues(data).forEach(value => ids.add(value));
                    if (!resolvedCpfRaw && data.cpf) {
                        const participantCpf = String(data.cpf).replace(/\D/g, '');
                        if (participantCpf.length === 11) resolvedCpfRaw = participantCpf;
                    }
                    if (!resolvedCpfHash && data.cpfHash) {
                        resolvedCpfHash = data.cpfHash;
                    }
                    const displayName = data.name || data.nome || data.nick;
                    if (displayName) names.add(String(displayName));
                }
            });
        }

        if (!resolvedCpfHash && resolvedCpfRaw) {
            resolvedCpfHash = await sha256Hex(resolvedCpfRaw);
        }

        return {
            ids,
            names,
            cpfRaw: resolvedCpfRaw,
            cpfHash: resolvedCpfHash
        };
    }

    async function removeParticipantFromTournamentPath(path, target) {
        const tRef = ref(db, path);
        const tSnap = await get(tRef);
        if (!tSnap.exists()) return false;

        const tData = tSnap.val();
        const updates = {};
        let changed = false;
        ['registeredPlayers', 'participants', 'sinucaRanking', 'rankingFinal', 'ranking'].forEach(key => {
            if (!Array.isArray(tData[key])) return;
            const filtered = tData[key].filter(player => !matchesRemovalTarget(player, target));
            if (filtered.length !== tData[key].length) {
                updates[key] = filtered;
                changed = true;
            }
        });

        if (changed) {
            updates.updatedAt = new Date().toISOString();
            await update(tRef, updates);
        }

        return changed;
    }

    async function removeParticipantEverywhere(identifier) {
        if (!db) return false;

        const target = await resolveParticipantRemovalTarget(identifier);
        const ids = Array.from(target.ids).filter(Boolean);

        await Promise.all(ids.map(id => remove(ref(db, 'participants/' + id))));
        if (target.cpfHash) {
            await remove(ref(db, 'participantsByCpfHash/' + target.cpfHash));
        }

        const tournamentPaths = new Set(['tournaments/current', 'tournaments/sinuca/current']);
        const currentSnap = await get(ref(db, 'tournaments/current'));
        if (currentSnap.exists() && currentSnap.val()?.tournamentCode) {
            tournamentPaths.add('tournaments/' + currentSnap.val().tournamentCode);
        }
        const sinucaSnap = await get(ref(db, 'tournaments/sinuca/current'));
        if (sinucaSnap.exists() && sinucaSnap.val()?.tournamentCode) {
            tournamentPaths.add('tournaments/' + sinucaSnap.val().tournamentCode);
        }

        await Promise.all(Array.from(tournamentPaths).map(path => removeParticipantFromTournamentPath(path, target)));

        const cRef = ref(db, 'codes/pool');
        const cSnap = await get(cRef);
        if (cSnap.exists()) {
            const cData = cSnap.val();
            const codesArray = cData.codes || [];
            let changed = false;
            const updatedCodes = codesArray.map(code => {
                const ownerValues = getPlayerIdentityValues(code);
                const ownerMatches = ownerValues.some(value => target.ids.has(value)) ||
                    (target.cpfHash && code.cpfHash === target.cpfHash) ||
                    (target.cpfRaw && code.cpf === target.cpfRaw);

                if (!ownerMatches) return code;
                changed = true;
                return {
                    ...code,
                    status: 'available',
                    used: false,
                    participantId: null,
                    usedBy: null,
                    usedByName: null,
                    participantName: null,
                    usedAt: null,
                    cpf: null,
                    cpfHash: null
                };
            });

            if (changed) {
                await update(cRef, { codes: updatedCodes });
            }
        }

        if (tournamentState?.registeredPlayers) {
            tournamentState.registeredPlayers = tournamentState.registeredPlayers.filter(player => !matchesRemovalTarget(player, target));
        }

        return true;
    }

    const modalMataMata = document.getElementById('modal-jogos-mata-mata');
    const editP1Name = document.getElementById('edit-p1-name');
    const editP2Name = document.getElementById('edit-p2-name');
    const editS1 = document.getElementById('edit-s1');
    const editS2 = document.getElementById('edit-s2');
    const btnSaveKnockout = document.getElementById('btn-save-knockout');
    const SENSITIVE_PASSWORD = '153090';
    const SENSITIVE_IDS = new Set([
        'btn-encerrar', 'btn-resetar', 'btn-resetar-tudo', 'btn-apagar-cadastro', 'btn-resetar-codigos',
        'btn-toggle-test-mode', 'btn-test-exit-clear', 'btn-test-sim-full', 'btn-test-reset-all',
        'btn-test-save-firebase', 'btn-test-remove-firebase', 'btn-test-history-remove', 'btn-test-ranking-clear',
        'btn-save-live-settings', 'btn-live-clear-comments', 'btn-live-toggle-comments', 'btn-live-delete-comment'
    ]);
    const modalSensitivePassword = document.getElementById('modal-sensitive-password');
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
        'btn-resetar-codigos': 'Resetar códigos de acesso',
        'btn-toggle-test-mode': 'Alternar modo teste',
        'btn-test-sim-full': 'Simular torneio completo (teste)',
        'btn-test-reset-all': 'Resetar teste completo',
        'btn-test-exit-clear': 'Sair do modo teste limpando dados',
        'btn-test-save-firebase': 'Testar salvamento no Firebase',
        'btn-test-remove-firebase': 'Remover teste do Firebase',
        'btn-test-history-remove': 'Remover histórico de teste',
        'btn-test-ranking-clear': 'Limpar ranking de teste',
        'btn-save-live-settings': 'Salvar controle da live',
        'btn-live-clear-comments': 'Limpar comentarios da live',
        'btn-live-toggle-comments': 'Ativar/desativar comentarios da live',
        'btn-live-delete-comment': 'Excluir comentario da live'
    };
    let pendingSensitiveAction = null;
    let pendingNextPhaseQualified = [];
    let pendingNextPhaseMatches = [];
    let pendingNextPhaseSignature = '';
    let repechageModalShown = false;
    let testModeActive = false;
    let testModeBackupState = null;
    let testModeLogEntries = [];
    let rankingViewMode = 'current';
    let rankingSearchTerm = '';
    let generalRankingCache = [];

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

    const VALID_KNOCKOUT_SIZES = [2, 4, 8, 16, 32, 64];

    function getRoundNameBySize(size) {
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

    function getNearestValidKnockoutSize(totalPlayers) {
        const valid = VALID_KNOCKOUT_SIZES.filter(size => size <= totalPlayers);
        return valid.length ? valid[valid.length - 1] : 2;
    }

    function getSortedGroupPlayers(group) {
        return [...(group?.players || [])].sort((a, b) => {
            if ((b.pts || 0) !== (a.pts || 0)) return (b.pts || 0) - (a.pts || 0);
            if ((b.sg || 0) !== (a.sg || 0)) return (b.sg || 0) - (a.sg || 0);
            return (b.gp || 0) - (a.gp || 0);
        });
    }

    function getGroupQualifiedEntries() {
        const entries = [];
        (tournamentState.groups || []).forEach(group => {
            const sorted = getSortedGroupPlayers(group);
            sorted.slice(0, 2).forEach((player, idx) => {
                if (!isRealPlayer(player?.name)) return;
                entries.push({
                    name: player.name,
                    groupName: group.name,
                    position: idx + 1,
                    pts: player.pts || 0,
                    sg: player.sg || 0,
                    gp: player.gp || 0
                });
            });
        });
        return entries.sort((a, b) =>
            a.position - b.position ||
            b.pts - a.pts ||
            b.sg - a.sg ||
            b.gp - a.gp ||
            a.name.localeCompare(b.name, 'pt-BR')
        );
    }

    function createKnockoutRounds(initialSlots) {
        const rounds = [];
        let currentRoundPlayers = [...initialSlots];
        while (currentRoundPlayers.length > 1) {
            const roundSize = currentRoundPlayers.length;
            const roundName = getRoundNameBySize(roundSize);
            const roundMatches = [];
            const nextRoundPlayers = [];
            for (let m = 0; m < currentRoundPlayers.length; m += 2) {
                const p1 = currentRoundPlayers[m] || 'BYE';
                const p2 = currentRoundPlayers[m + 1] || 'BYE';
                const winnerToken = `Vencedor ${roundName} ${m / 2 + 1}`;
                const match = createMatchData(p1, p2, winnerToken);
                resolveByeMatchOutcome(match);
                roundMatches.push(match);
                nextRoundPlayers.push(winnerToken);
            }
            rounds.push({ name: roundName, matches: roundMatches });
            currentRoundPlayers = nextRoundPlayers;
        }
        return rounds;
    }

    function buildKnockoutBlueprintFromQualifiedNames(qualifiedNames) {
        const totalQualified = qualifiedNames.length;
        const isPerfectBracket = VALID_KNOCKOUT_SIZES.includes(totalQualified);
        const targetSize = isPerfectBracket ? totalQualified : getNearestValidKnockoutSize(totalQualified);
        let repechagePairs = [];
        let firstRoundSlots = [];

        if (isPerfectBracket) {
            firstRoundSlots = [...qualifiedNames];
        } else {
            const directSlots = targetSize - (totalQualified - targetSize);
            const directQualified = qualifiedNames.slice(0, Math.max(0, directSlots));
            const repechageQualified = qualifiedNames.slice(Math.max(0, directSlots));
            firstRoundSlots = [...directQualified];
            for (let i = 0; i < repechageQualified.length; i += 2) {
                const token = `Vencedor Rep. ${Math.floor(i / 2) + 1}`;
                repechagePairs.push({
                    p1: repechageQualified[i] || 'BYE',
                    p2: repechageQualified[i + 1] || 'BYE',
                    token
                });
                firstRoundSlots.push(token);
            }
        }
        return { repechagePairs, firstRoundSlots };
    }

    function getCurrentKnockoutQualifiersFromState() {
        const knockout = tournamentState.knockout;
        if (!knockout?.rounds?.length) return [];
        const qualifiers = [];
        const pushUnique = (name) => {
            if (!isRealPlayer(name)) return;
            if (!qualifiers.includes(name)) qualifiers.push(name);
        };
        const repSet = new Set();
        (knockout.repechage || []).forEach(match => {
            pushUnique(match.p1);
            pushUnique(match.p2);
            if (isRealPlayer(match.p1)) repSet.add(match.p1);
            if (isRealPlayer(match.p2)) repSet.add(match.p2);
        });
        const firstRound = knockout.rounds[0];
        (firstRound?.matches || []).forEach(match => {
            [match.p1, match.p2].forEach(slot => {
                if (typeof slot === 'string' && slot.startsWith('Vencedor Rep.')) return;
                if (repSet.has(slot)) return;
                pushUnique(slot);
            });
        });
        (knockout.repechage || []).forEach(match => {
            pushUnique(match.p1);
            pushUnique(match.p2);
        });
        return qualifiers;
    }

    function haveQualifiersChanged(oldQualifiers, newQualifiers) {
        if ((oldQualifiers || []).length !== (newQualifiers || []).length) return true;
        for (let i = 0; i < oldQualifiers.length; i++) {
            if ((oldQualifiers[i] || '').trim() !== (newQualifiers[i] || '').trim()) return true;
        }
        return false;
    }

    function hasManualKnockoutChanges(expectedQualifiedNames) {
        const knockout = tournamentState.knockout;
        if (!knockout?.rounds?.length) return false;
        const blueprint = buildKnockoutBlueprintFromQualifiedNames(expectedQualifiedNames);
        const currentRep = knockout.repechage || [];
        if (currentRep.length !== blueprint.repechagePairs.length) return true;
        for (let i = 0; i < currentRep.length; i++) {
            if (currentRep[i].p1 !== blueprint.repechagePairs[i].p1 || currentRep[i].p2 !== blueprint.repechagePairs[i].p2) return true;
        }
        const firstRoundMatches = knockout.rounds[0]?.matches || [];
        const expectedSlots = blueprint.firstRoundSlots;
        if (firstRoundMatches.length * 2 !== expectedSlots.length) return true;
        const currentSlots = firstRoundMatches.flatMap(match => [match.p1, match.p2]);
        for (let i = 0; i < expectedSlots.length; i++) {
            if ((currentSlots[i] || '') !== (expectedSlots[i] || '')) return true;
        }
        return false;
    }

    function hasKnockoutResults() {
        if (!tournamentState.knockout) return false;
        const allMatches = [
            ...(tournamentState.knockout.repechage || []),
            ...((tournamentState.knockout.rounds || []).flatMap(round => round.matches || []))
        ];
        return allMatches.some(match => {
            const hasScore = (match.s1 !== '' && match.s1 != null) || (match.s2 !== '' && match.s2 != null) ||
                (match.idaS1 !== '' && match.idaS1 != null) || (match.idaS2 !== '' && match.idaS2 != null) ||
                (match.voltaS1 !== '' && match.voltaS1 != null) || (match.voltaS2 !== '' && match.voltaS2 != null);
            const hasPenalty = (match.pen1 !== '' && match.pen1 != null) || (match.pen2 !== '' && match.pen2 != null);
            const hasWinner = isRealPlayer(match.winner) || !!getKnockoutMatchWinner(match);
            const hasFlowFlags = !!match.completed || !!match.walkover || match.status === 'completed' || match.status === 'walkover';
            return hasScore || hasPenalty || hasWinner || hasFlowFlags;
        });
    }

    function hasEliminationStarted(expectedQualifiedNames = []) {
        return hasKnockoutResults() || hasManualKnockoutChanges(expectedQualifiedNames);
    }

    async function rebuildKnockoutFromGroups() {
        const qualifiedEntries = getGroupQualifiedEntries();
        const totalQualified = qualifiedEntries.length;
        if (totalQualified < 2) return false;
        const qualifiedNames = qualifiedEntries.map(entry => entry.name);
        const blueprint = buildKnockoutBlueprintFromQualifiedNames(qualifiedNames);
        const repechage = blueprint.repechagePairs.map(pair => {
            const match = createMatchData(pair.p1, pair.p2, pair.token);
            resolveByeMatchOutcome(match);
            return match;
        });
        const firstRoundSlots = blueprint.firstRoundSlots;

        const rounds = createKnockoutRounds(firstRoundSlots);
        tournamentState.knockout = { repechage, rounds };

        if (!repechage.length) {
            const qualifiedForModal = [...qualifiedNames];
            initializeNextPhaseMatchEditor(qualifiedForModal, 'empty');
            if (nextPhaseOrderInput) nextPhaseOrderInput.value = qualifiedForModal.join('\n');
            renderNextPhasePreview(qualifiedForModal);
            renderNextPhaseMatchEditor();
            modalNextPhase?.classList.add('active');
            repechageModalShown = true;
        } else {
            repechageModalShown = false;
        }
        return true;
    }

    function getGroupLeaders(position = 0) {
        const leaders = [];
        (tournamentState.groups || []).forEach(g => {
            const sorted = getSortedGroupPlayers(g);
            if (sorted[position] && !isPlaceholder(sorted[position].name)) leaders.push(sorted[position].name);
        });
        return leaders;
    }

    function getKnockoutMatchWinner(match) {
        if (!match) return null;
        const byeWinner = getByeAutoWinner(match);
        if (byeWinner) return byeWinner;
        const hasHomeAway = tournamentState.homeAway &&
            match.idaS1 !== '' && match.idaS2 !== '' && match.voltaS1 !== '' && match.voltaS2 !== '' &&
            match.idaS1 != null && match.idaS2 != null && match.voltaS1 != null && match.voltaS2 != null;
        if (hasHomeAway) {
            const ida1 = parseInt(match.idaS1);
            const ida2 = parseInt(match.idaS2);
            const volta1 = parseInt(match.voltaS1);
            const volta2 = parseInt(match.voltaS2);
            if ([ida1, ida2, volta1, volta2].some(Number.isNaN)) return null;
            const agg1 = ida1 + volta1;
            const agg2 = ida2 + volta2;
            if (agg1 > agg2) return match.p1;
            if (agg2 > agg1) return match.p2;
            if (match.pen1 != null && match.pen2 != null && match.pen1 !== '' && match.pen2 !== '') {
                const pen1 = parseInt(match.pen1);
                const pen2 = parseInt(match.pen2);
                if (Number.isNaN(pen1) || Number.isNaN(pen2) || pen1 === pen2) return null;
                return pen1 > pen2 ? match.p1 : match.p2;
            }
            return null;
        }
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
        return isRealPlayer(match.winner) ? match.winner : null;
    }

    function recalculateCurrentCupRanking() {
        const stats = {};
        const ensure = (name) => {
            if (!name || isPlaceholder(name)) return null;
            if (!stats[name]) stats[name] = { name, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, avancos: 0, phaseScore: 0, phase: 'Fase de Grupos', status: 'Na fase de grupos' };
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
                if (tournamentState.homeAway && m.idaS1 != null && m.idaS2 != null && m.voltaS1 != null && m.voltaS2 != null && m.idaS1 !== '' && m.idaS2 !== '' && m.voltaS1 !== '' && m.voltaS2 !== '') {
                    const ida1 = parseInt(m.idaS1);
                    const ida2 = parseInt(m.idaS2);
                    const volta1 = parseInt(m.voltaS1);
                    const volta2 = parseInt(m.voltaS2);
                    if (!Number.isNaN(ida1) && !Number.isNaN(ida2)) apply(m.p1, m.p2, ida1, ida2, true);
                    if (!Number.isNaN(volta1) && !Number.isNaN(volta2)) apply(m.p2, m.p1, volta1, volta2, true);
                } else if (m.s1 !== '' && m.s2 !== '') {
                    const s1 = parseInt(m.s1);
                    const s2 = parseInt(m.s2);
                    if (!Number.isNaN(s1) && !Number.isNaN(s2)) apply(m.p1, m.p2, s1, s2, true);
                } else {
                    return;
                }
                const winner = getKnockoutMatchWinner(m);
                const pWinner = ensure(winner);
                if (pWinner) pWinner.avancos += 1;
            });
            (tournamentState.knockout.rounds || []).forEach((round, idx) => {
                const phasePoints = idx + 1;
                (round.matches || []).forEach((m) => {
                    const winner = getKnockoutMatchWinner(m);
                    if (isRealPlayer(winner)) {
                        const p = ensure(winner);
                        if (p && phasePoints >= p.phaseScore) {
                            p.phaseScore = phasePoints;
                            p.phase = round.name;
                        }
                    }
                });
            });
        }

        Object.values(stats).forEach(p => {
            p.sg = p.gp - p.gc;
            p.apr = p.j ? ((p.pts / (p.j * 3)) * 100) : 0;
            if (tournamentState.top3?.first === p.name) p.status = 'Campeão';
            else if (tournamentState.top3?.second === p.name) p.status = 'Finalista';
            else if ((p.phase || '').toLowerCase().includes('semifinal')) p.status = 'Semifinalista';
            else if (p.avancos > 0) p.status = 'Classificado';
            else p.status = 'Eliminado';
        });
        tournamentState.generalStats = stats;
        return stats;
    }

    function recalculateGeneralStats() {
        return recalculateCurrentCupRanking();
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
            if (tournamentState.homeAway) {
                const hasLegs = m.idaS1 !== '' && m.idaS2 !== '' && m.voltaS1 !== '' && m.voltaS2 !== '';
                return hasLegs && !!getKnockoutMatchWinner(m);
            }
            return m.s1 !== '' && m.s2 !== '' && !!getKnockoutMatchWinner(m);
        });
        return groupsDone && knockoutDone;
    }

    function persistCurrentTournament(extra = {}) {
        if (testModeActive && !extra.__allowPersistInTestMode) {
            return Promise.resolve();
        }
        if (extra && Object.prototype.hasOwnProperty.call(extra, '__allowPersistInTestMode')) {
            delete extra.__allowPersistInTestMode;
        }
        if (!db) return Promise.resolve();
        ensureLiveState();
        const updatedAt = new Date().toISOString();
        tournamentState.updatedAt = updatedAt;
        const payload = { ...tournamentState, ...extra, updatedAt };
        return Promise.all([
            set(ref(db, 'tournaments/current'), payload),
            tournamentState.tournamentCode ? set(ref(db, `tournaments/${tournamentState.tournamentCode}`), payload) : Promise.resolve()
        ]);
    }

    function ensureLiveState() {
        const current = tournamentState.live && typeof tournamentState.live === 'object' ? tournamentState.live : {};
        const defaults = createDefaultLiveState();
        tournamentState.live = {
            ...defaults,
            ...current,
            enabled: current.enabled === true,
            commentsEnabled: current.commentsEnabled !== false,
            comments: Array.isArray(current.comments) ? current.comments.slice(0, 20) : []
        };
        return tournamentState.live;
    }

    function saveLiveLocalState() {
        try {
            localStorage.setItem(LIVE_LOCAL_STORAGE_KEY, JSON.stringify(ensureLiveState()));
        } catch (error) {
            console.warn('Nao foi possivel salvar a live localmente:', error);
        }
    }

    function loadLiveStateFromLocalStorage() {
        if (db) return;
        try {
            const saved = JSON.parse(localStorage.getItem(LIVE_LOCAL_STORAGE_KEY) || 'null');
            if (saved && typeof saved === 'object') {
                tournamentState.live = { ...createDefaultLiveState(), ...saved };
            }
        } catch (error) {
            console.warn('Nao foi possivel carregar a live local:', error);
        }
        ensureLiveState();
    }

    async function persistLiveState() {
        ensureLiveState();
        if (db) {
            await persistCurrentTournament({ live: tournamentState.live });
        } else {
            saveLiveLocalState();
        }
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

            if (host === 'youtu.be' && pathParts[0]) {
                return pathParts[0].slice(0, 11);
            }

            if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
                const watchId = parsed.searchParams.get('v');
                if (watchId) return watchId.slice(0, 11);
                if (['embed', 'shorts', 'live'].includes(pathParts[0]) && pathParts[1]) {
                    return pathParts[1].slice(0, 11);
                }
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
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function setLiveFeedback(message, isWarning = false) {
        const feedback = document.getElementById('liveSettingsFeedback');
        if (!feedback) return;
        feedback.textContent = message || '';
        feedback.classList.toggle('is-warning', !!isWarning);
    }

    function getLiveParticipantNames() {
        const names = new Set();
        const pushName = (value) => {
            const name = sanitizeLiveText(value, 40);
            if (name && isRealPlayer(name)) names.add(name);
        };

        (tournamentState.registeredPlayers || []).forEach(player => {
            pushName(player?.name || player?.nome || player?.nick);
        });
        (tournamentState.groups || []).forEach(group => {
            (group.players || []).forEach(player => pushName(player?.name));
        });

        return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function populateLivePlayerSelect(selectId, manualId, selectedName) {
        const select = document.getElementById(selectId);
        const manual = document.getElementById(manualId);
        if (!select) return;

        const selected = sanitizeLiveText(selectedName, 40);
        const names = getLiveParticipantNames();
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

    function renderLiveTabStatus() {
        const live = ensureLiveState();
        const tab = document.querySelector('.tab[data-tab="ao-vivo"]');
        if (!tab) return;
        tab.classList.toggle('live-tab-active', !!live.enabled);
    }

    function postLivePlayerCommand(func, args = []) {
        const iframe = document.getElementById('liveYoutubeIframe');
        if (!iframe?.contentWindow || iframe.hidden) return;
        iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func,
            args
        }), '*');
    }

    function updateLivePlayerButtons() {
        const playIcon = document.querySelector('#livePlayToggle i');
        const muteIcon = document.querySelector('#liveMuteToggle i');
        if (playIcon) playIcon.className = livePlayerPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        if (muteIcon) muteIcon.className = livePlayerMuted ? 'ph-fill ph-speaker-slash' : 'ph-fill ph-speaker-high';
    }

    function updateLiveFullscreenButton() {
        const button = document.getElementById('liveFullscreenToggle');
        const icon = document.querySelector('#liveFullscreenToggle i');
        const isFullscreen = document.fullscreenElement === document.getElementById('liveVideoWrapper');
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
        const iframe = document.getElementById('liveYoutubeIframe');
        const emptyState = document.getElementById('liveEmptyState');
        const videoWrapper = document.getElementById('liveVideoWrapper');
        const warning = document.getElementById('liveWarning');
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

        document.getElementById('liveCustomControls')?.toggleAttribute('hidden', !embedUrl);

        if (emptyState) {
            emptyState.hidden = !!embedUrl;
            emptyState.textContent = hasLink && !embedUrl
                ? 'Link do YouTube invalido.'
                : 'Nenhuma transmissao configurada no momento.';
        }

        if (videoWrapper) videoWrapper.classList.toggle('has-live-video', !!embedUrl);
        if (embedUrl) showLiveControlsTemporarily();

        if (warning) {
            const showWarning = live.enabled && !embedUrl;
            warning.hidden = !showWarning;
            warning.textContent = showWarning ? 'Adicione um link do YouTube para exibir a transmissao.' : '';
        }

        const statusText = live.enabled ? 'Transmissao ao vivo agora' : (embedUrl ? 'Transmissao configurada, offline' : 'Nenhuma live ativa no momento.');
        setLiveText('livePlayerStatus', statusText);

        const badge = document.getElementById('livePlayerBadge');
        if (badge) {
            badge.textContent = live.enabled ? 'AO VIVO' : 'OFFLINE';
            badge.classList.toggle('live-on', !!live.enabled);
            badge.classList.toggle('offline', !live.enabled);
        }

        document.querySelectorAll('.live-status-dot').forEach(dot => dot.classList.toggle('is-live', !!live.enabled));
        updateLivePlayerButtons();
    }

    function showLiveControlsTemporarily() {
        const wrapper = document.getElementById('liveVideoWrapper');
        if (!wrapper?.classList.contains('has-live-video')) return;
        wrapper.classList.add('controls-visible');
        clearTimeout(liveControlsHideTimer);
        liveControlsHideTimer = setTimeout(() => {
            wrapper.classList.remove('controls-visible');
        }, 3000);
    }

    function renderLiveCurrentMatch() {
        const live = ensureLiveState();
        const title = sanitizeLiveText(live.currentMatchTitle, 80) || 'Aguardando definicao da partida atual.';
        const player1 = sanitizeLiveText(live.currentPlayer1, 40) || 'Jogador 1';
        const player2 = sanitizeLiveText(live.currentPlayer2, 40) || 'Jogador 2';
        const score1 = Number.isFinite(Number(live.scorePlayer1)) ? Number(live.scorePlayer1) : 0;
        const score2 = Number.isFinite(Number(live.scorePlayer2)) ? Number(live.scorePlayer2) : 0;

        setLiveText('liveCurrentMatchTitle', title);
        setLiveText('livePlayer1Name', player1);
        setLiveText('livePlayer2Name', player2);
        setLiveText('liveScore1', String(Math.max(0, score1)));
        setLiveText('liveScore2', String(Math.max(0, score2)));
        setLiveText('livePhaseName', sanitizeLiveText(live.phaseName, 50) || 'Fase nao definida');
        setLiveText('liveTableName', sanitizeLiveText(live.tableName, 50) || 'Mesa nao definida');

        const badge = document.getElementById('liveMatchBadge');
        if (badge) {
            badge.textContent = live.enabled ? 'AO VIVO' : 'OFFLINE';
            badge.classList.toggle('is-live', !!live.enabled);
        }
        document.querySelectorAll('.live-mini-dot').forEach(dot => dot.classList.toggle('is-live', !!live.enabled));
    }

    function renderLiveInfo() {
        const live = ensureLiveState();
        const embedUrl = getYouTubeEmbedUrl(live.youtubeUrl);
        const infoCard = document.querySelector('.live-info-card');
        const playerHeader = document.querySelector('.live-player-header');
        if (infoCard) infoCard.hidden = role !== 'organizador';
        if (playerHeader) playerHeader.hidden = role !== 'organizador';
        const status = live.enabled ? 'Ao vivo agora' : (embedUrl ? 'Offline' : 'Nao configurada');
        const player = embedUrl ? 'YouTube pronto' : 'Sem link';
        const comments = live.commentsEnabled ? 'Ativados' : 'Desativados';

        setLiveText('liveSectionStatus', live.enabled ? 'AO VIVO' : 'Offline');
        setLiveText('liveInfoStatus', status);
        setLiveText('liveInfoPlayer', player);
        setLiveText('liveInfoComments', comments);

        const sectionStatus = document.getElementById('liveSectionStatus');
        if (sectionStatus) sectionStatus.classList.toggle('is-live', !!live.enabled);
    }

    function renderLiveAdminPanel() {
        const panel = document.getElementById('liveAdminPanel');
        if (!panel) return;
        panel.hidden = role !== 'organizador';
        if (role !== 'organizador') return;

        const form = document.getElementById('liveSettingsForm');
        if (form?.contains(document.activeElement)) return;

        const live = ensureLiveState();
        const youtubeInput = document.getElementById('liveYoutubeUrl');
        const enabledInput = document.getElementById('liveEnabled');
        const matchInput = document.getElementById('liveCurrentMatchInput');
        const phaseInput = document.getElementById('livePhaseNameInput');
        const score1Input = document.getElementById('liveScore1Input');
        const score2Input = document.getElementById('liveScore2Input');
        const tableInput = document.getElementById('liveTableNameInput');
        const pinnedInput = document.getElementById('livePinnedMessageInput');
        const toggleCommentsBtn = document.getElementById('btn-live-toggle-comments');

        if (youtubeInput) youtubeInput.value = live.youtubeUrl || '';
        if (enabledInput) enabledInput.checked = !!live.enabled;
        if (matchInput) matchInput.value = live.currentMatchTitle || '';
        if (phaseInput) phaseInput.value = live.phaseName || '';
        if (score1Input) score1Input.value = live.scorePlayer1 ?? 0;
        if (score2Input) score2Input.value = live.scorePlayer2 ?? 0;
        if (tableInput) tableInput.value = live.tableName || '';
        if (pinnedInput) pinnedInput.value = live.pinnedMessage || '';

        populateLivePlayerSelect('livePlayer1Select', 'livePlayer1Manual', live.currentPlayer1);
        populateLivePlayerSelect('livePlayer2Select', 'livePlayer2Manual', live.currentPlayer2);

        if (toggleCommentsBtn) {
            toggleCommentsBtn.innerHTML = live.commentsEnabled
                ? '<i class="ph-fill ph-chat-circle"></i> Desativar comentarios'
                : '<i class="ph-fill ph-chat-circle"></i> Ativar comentarios';
        }
    }

    function renderLiveAuth() {
        const authBox = document.getElementById('liveAuthBox');
        const loginBtn = document.getElementById('liveGoogleLogin');
        const logoutBtn = document.getElementById('liveGoogleLogout');
        const userName = document.getElementById('liveAuthUserName');
        const userPhoto = document.getElementById('liveAuthUserPhoto');
        const textInput = document.getElementById('liveCommentText');
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

    function renderLiveComments() {
        const live = ensureLiveState();
        const count = document.getElementById('liveCommentCount');
        const pinned = document.getElementById('livePinnedMessage');
        const disabled = document.getElementById('liveCommentsDisabled');
        const form = document.getElementById('liveCommentForm');
        const list = document.getElementById('liveCommentsList');
        const comments = [...live.comments]
            .filter(comment => comment && comment.text)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 20)
            .reverse();

        if (count) count.textContent = String(comments.length);

        if (pinned) {
            const message = sanitizeLiveText(live.pinnedMessage, 160);
            pinned.hidden = !message;
            pinned.textContent = message ? `Mensagem fixada: ${message}` : '';
        }

        if (disabled) disabled.hidden = live.commentsEnabled;
        if (form) form.hidden = !live.commentsEnabled;
        renderLiveAuth();
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
            const createdAt = Number(comment.createdAt) || Date.now();
            time.textContent = new Date(createdAt).toLocaleString('pt-BR', {
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

            if (role === 'organizador') {
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
        if (!Number.isFinite(score) || score < 0) return 0;
        return Math.min(score, 999);
    }

    async function saveLiveSettings() {
        if (role !== 'organizador') return;
        const youtubeUrl = sanitizeLiveText(document.getElementById('liveYoutubeUrl')?.value, 300);
        const embedUrl = getYouTubeEmbedUrl(youtubeUrl);
        if (youtubeUrl && !embedUrl) {
            setLiveFeedback('Link do YouTube invalido. Use youtube.com/watch, youtu.be ou /embed/.', true);
            return;
        }

        const player1Select = sanitizeLiveText(document.getElementById('livePlayer1Select')?.value, 40);
        const player2Select = sanitizeLiveText(document.getElementById('livePlayer2Select')?.value, 40);
        const player1Manual = sanitizeLiveText(document.getElementById('livePlayer1Manual')?.value, 40);
        const player2Manual = sanitizeLiveText(document.getElementById('livePlayer2Manual')?.value, 40);
        const live = ensureLiveState();

        tournamentState.live = {
            ...live,
            enabled: document.getElementById('liveEnabled')?.checked === true,
            youtubeUrl,
            currentMatchTitle: sanitizeLiveText(document.getElementById('liveCurrentMatchInput')?.value, 80),
            currentPlayer1: player1Manual || player1Select,
            currentPlayer2: player2Manual || player2Select,
            scorePlayer1: normalizeLiveScore(document.getElementById('liveScore1Input')?.value),
            scorePlayer2: normalizeLiveScore(document.getElementById('liveScore2Input')?.value),
            phaseName: sanitizeLiveText(document.getElementById('livePhaseNameInput')?.value, 50),
            tableName: sanitizeLiveText(document.getElementById('liveTableNameInput')?.value, 50),
            pinnedMessage: sanitizeLiveText(document.getElementById('livePinnedMessageInput')?.value, 160)
        };

        await persistLiveState();
        renderLiveSection();
        setLiveFeedback(tournamentState.live.enabled && !getYouTubeEmbedUrl(tournamentState.live.youtubeUrl)
            ? 'Transmissao salva. Adicione um link do YouTube para exibir o player.'
            : 'Transmissao atualizada com sucesso.',
            tournamentState.live.enabled && !getYouTubeEmbedUrl(tournamentState.live.youtubeUrl)
        );
    }

    async function addLiveComment(nameValue, textValue) {
        const live = ensureLiveState();
        if (!live.commentsEnabled) return;
        if (!auth) return;
        if (!liveUser) {
            await signInWithPopup(auth, googleProvider);
            if (!auth.currentUser) return;
        }

        const text = sanitizeLiveText(textValue, 200);
        if (!text) return;

        const user = auth.currentUser;
        const name = sanitizeLiveText(user?.displayName || nameValue, 40) || 'Conta Google';
        const comment = {
            id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uid: user?.uid || '',
            name,
            photoURL: sanitizeLiveText(user?.photoURL, 300),
            text,
            createdAt: Date.now(),
            approved: true
        };

        live.comments = [comment, ...(live.comments || [])].slice(0, 20);
        await persistLiveState();
        renderLiveComments();
    }

    async function clearLiveComments() {
        if (role !== 'organizador') return;
        if (!confirm('Limpar todos os comentarios da live?')) return;
        const live = ensureLiveState();
        live.comments = [];
        await persistLiveState();
        renderLiveSection();
    }

    async function toggleLiveComments(enabled) {
        if (role !== 'organizador') return;
        const live = ensureLiveState();
        live.commentsEnabled = typeof enabled === 'boolean' ? enabled : !live.commentsEnabled;
        await persistLiveState();
        renderLiveSection();
    }

    async function deleteLiveComment(commentId) {
        if (role !== 'organizador' || !commentId) return;
        const live = ensureLiveState();
        live.comments = (live.comments || []).filter(comment => String(comment.id) !== String(commentId));
        await persistLiveState();
        renderLiveSection();
    }

    function bindLiveEvents() {
        document.getElementById('liveSettingsForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            withSensitiveGuard('btn-save-live-settings', saveLiveSettings);
        });

        document.getElementById('liveCommentForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const nameInput = document.getElementById('liveCommentName');
            const textInput = document.getElementById('liveCommentText');
            const text = sanitizeLiveText(textInput?.value, 200);
            if (!text) {
                if (textInput) textInput.value = '';
                return;
            }
            await addLiveComment(nameInput?.value, text);
            if (textInput) textInput.value = '';
        });
        document.getElementById('liveCommentText')?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            document.getElementById('liveCommentForm')?.requestSubmit();
        });

        document.getElementById('liveGoogleLogin')?.addEventListener('click', async () => {
            if (!auth) return;
            try {
                const result = await signInWithPopup(auth, googleProvider);
                liveUser = result.user;
                renderLiveAuth();
            } catch {
                alert('Nao foi possivel entrar com Google.');
            }
        });

        document.getElementById('liveGoogleLogout')?.addEventListener('click', () => {
            if (auth) signOut(auth);
        });

        document.getElementById('livePlayToggle')?.addEventListener('click', () => {
            livePlayerPlaying = !livePlayerPlaying;
            postLivePlayerCommand(livePlayerPlaying ? 'playVideo' : 'pauseVideo');
            updateLivePlayerButtons();
        });

        document.getElementById('liveMuteToggle')?.addEventListener('click', () => {
            livePlayerMuted = !livePlayerMuted;
            postLivePlayerCommand(livePlayerMuted ? 'mute' : 'unMute');
            updateLivePlayerButtons();
        });

        document.getElementById('liveFullscreenToggle')?.addEventListener('click', () => {
            const wrapper = document.getElementById('liveVideoWrapper');
            if (document.fullscreenElement === wrapper) {
                document.exitFullscreen?.();
            } else if (wrapper?.requestFullscreen) {
                wrapper.requestFullscreen();
            }
            document.activeElement?.blur?.();
            showLiveControlsTemporarily();
            updateLiveFullscreenButton();
        });

        document.getElementById('liveShareButton')?.addEventListener('click', () => {
            shareLiveLink().catch(() => alert('Nao foi possivel compartilhar a live.'));
        });
        document.addEventListener('fullscreenchange', updateLiveFullscreenButton);

        document.getElementById('liveVideoWrapper')?.addEventListener('pointermove', showLiveControlsTemporarily);
        document.addEventListener('mousemove', () => {
            const wrapper = document.getElementById('liveVideoWrapper');
            if (document.fullscreenElement === wrapper) showLiveControlsTemporarily();
        });
        document.getElementById('liveVideoWrapper')?.addEventListener('pointerleave', () => {
            clearTimeout(liveControlsHideTimer);
            liveControlsHideTimer = setTimeout(() => {
                document.getElementById('liveVideoWrapper')?.classList.remove('controls-visible');
            }, 3000);
        });

        document.getElementById('btn-live-clear-comments')?.addEventListener('click', () => {
            withSensitiveGuard('btn-live-clear-comments', clearLiveComments);
        });

        document.getElementById('btn-live-toggle-comments')?.addEventListener('click', () => {
            withSensitiveGuard('btn-live-toggle-comments', () => toggleLiveComments());
        });

        document.getElementById('liveCommentsList')?.addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('[data-live-comment-delete]');
            if (!deleteBtn) return;
            const id = deleteBtn.dataset.liveCommentDelete;
            withSensitiveGuard('btn-live-delete-comment', () => deleteLiveComment(id));
        });
    }

    async function recalculateGeneralRanking() {
        if (!db) {
            generalRankingCache = [];
            return generalRankingCache;
        }
        const snap = await get(ref(db, 'imports'));
        const stats = {};
        if (snap.exists()) {
            snap.forEach(child => {
                const item = child.val() || {};
                if (item?.isTestMode === true || item?.isTestData === true) return;
                if (item?.modality && rankingViewMode === 'general') {
                    const filter = document.getElementById('ranking-modality-filter')?.value || 'todos';
                    if (filter !== 'todos' && item.modality !== filter) return;
                }
                const ranking = item.rankingFinal || Object.values(item.generalStats || {});
                ranking.forEach((row, idx) => {
                    const name = row.name;
                    if (!isRealPlayer(name)) return;
                    if (!stats[name]) stats[name] = { name, titulos: 0, finais: 0, semifinais: 0, copas: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0, apr: 0 };
                    const s = stats[name];
                    s.copas += 1;
                    s.j += row.j || 0; s.v += row.v || 0; s.e += row.e || 0; s.d += row.d || 0;
                    s.gp += row.gp || 0; s.gc += row.gc || 0; s.pts += row.pts || 0;
                    if (idx === 0 || item.champion === name) s.titulos += 1;
                    if (idx <= 1 || item.vice === name) s.finais += 1;
                    if (idx <= 3) s.semifinais += 1;
                });
            });
        }
        generalRankingCache = Object.values(stats).map(s => ({ ...s, sg: s.gp - s.gc, apr: s.j ? (s.pts / (s.j * 3)) * 100 : 0 }))
            .sort((a, b) => b.titulos - a.titulos || b.finais - a.finais || b.semifinais - a.semifinais || b.pts - a.pts || b.v - a.v || b.sg - a.sg || b.gp - a.gp || a.name.localeCompare(b.name, 'pt-BR'));
        return generalRankingCache;
    }

    function setKnockoutModalReadOnly(isReadOnly) {
        const inputIds = [
            'edit-s1', 'edit-s2',
            'edit-ida-s1', 'edit-ida-s2', 'edit-volta-s1', 'edit-volta-s2',
            'edit-pen1', 'edit-pen2'
        ];
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = isReadOnly;
        });
        if (btnSaveKnockout) btnSaveKnockout.style.display = isReadOnly ? 'none' : 'inline-flex';
    }

    function openKnockoutEdit(type, rIdx, mIdx, readOnly = false) {
        selectedKnockoutMatch = { type, rIdx, mIdx };
        let match;
        if (type === 'repechage') {
            match = tournamentState.knockout.repechage[mIdx];
            document.getElementById('modal-mata-mata-title').textContent = 'Resultado Repescagem';
            document.getElementById('modal-mata-mata-subtitle').textContent = readOnly ? 'Visualização somente leitura' : 'Empate vai para pênaltis';
        } else {
            match = tournamentState.knockout.rounds[rIdx].matches[mIdx];
            document.getElementById('modal-mata-mata-title').textContent = 'Resultado ' + tournamentState.knockout.rounds[rIdx].name;
            document.getElementById('modal-mata-mata-subtitle').textContent = readOnly ? 'Visualização somente leitura' : 'Insira o placar do confronto';
        }
        setKnockoutModalReadOnly(readOnly);

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
            legsEl.style.display = 'grid';

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
                if (agg1 === agg2 && (document.getElementById('edit-ida-s1').value !== '' || document.getElementById('edit-volta-s1').value !== '')) {
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
            singleEl.style.display = 'grid';
            legsEl.style.display = 'none';

            if (editP1Name) editP1Name.textContent = displayParticipantName(match.p1);
            if (editP2Name) editP2Name.textContent = displayParticipantName(match.p2);
            if (editS1) editS1.value = match.s1 || '';
            if (editS2) editS2.value = match.s2 || '';

            // Listen for tie on repechage single mode
            function checkSinglePenalty() {
                const v1 = parseInt(editS1.value);
                const v2 = parseInt(editS2.value);
                if (!isNaN(v1) && !isNaN(v2) && v1 === v2 && editS1.value !== '') {
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

    function normalizeKnockoutAutoAdvances(knockout) {
        if (!knockout?.rounds?.length) return;

        (knockout.repechage || []).forEach((match, idx) => {
            const outcome = resolveByeMatchOutcome(match);
            if (!outcome.winner) return;
            const token = match.winnerToken || `Vencedor Rep. ${idx + 1}`;
            match.winnerToken = token;
            (knockout.rounds[0]?.matches || []).forEach(nextMatch => {
                if (nextMatch.p1 === token) nextMatch.p1 = outcome.winner;
                if (nextMatch.p2 === token) nextMatch.p2 = outcome.winner;
            });
        });

        (knockout.rounds || []).forEach((round, rIdx) => {
            (round.matches || []).forEach((match, mIdx) => {
                const outcome = resolveByeMatchOutcome(match);
                if (!outcome.winner || rIdx >= knockout.rounds.length - 1) return;
                const token = match.winnerToken || `Vencedor ${round.name} ${mIdx + 1}`;
                match.winnerToken = token;
                propagateWinnerToNextRound(knockout, token, outcome.winner, rIdx);
            });
        });
    }

    if (btnSaveKnockout) {
        btnSaveKnockout.addEventListener('click', async () => {
            if (role !== 'organizador') return;
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
            if (!winner && totalS1 > totalS2) {
                winner = match.p1;
            } else if (!winner && totalS2 > totalS1) {
                winner = match.p2;
            } else if (!winner) {
                // EMPATE
                if (type === 'repechage' || isHomeAway) {
                    // Repescagem: empate vai pra pênaltis
                    const pen1 = document.getElementById('edit-pen1').value;
                    const pen2 = document.getElementById('edit-pen2').value;
                    if (pen1 === '' || pen2 === '') {
                        alert('Empate no agregado! Preencha os pênaltis/desempate.');
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

    function hasAnyRecordedScores() {
        const groupsHasScores = (tournamentState.groups || []).some(g => (g.matches || []).some(m => m.gHome !== '' || m.gAway !== ''));
        const knockoutHasScores = (tournamentState.knockout?.repechage || []).some(m => m.s1 !== '' || m.s2 !== '' || m.idaS1 != null || m.voltaS1 != null)
            || (tournamentState.knockout?.rounds || []).some(r => (r.matches || []).some(m => m.s1 !== '' || m.s2 !== '' || m.idaS1 != null || m.voltaS1 != null));
        return groupsHasScores || knockoutHasScores;
    }

    function generateRoundRobinSchedule(playersNames) {
        const list = [...playersNames];
        if (list.length < 2) return [];
        const hasBye = list.length % 2 === 1;
        if (hasBye) list.push('BYE');
        const rounds = list.length - 1;
        const half = list.length / 2;
        const rotation = [...list];
        const schedule = [];

        for (let round = 0; round < rounds; round++) {
            const roundMatches = [];
            for (let i = 0; i < half; i++) {
                const a = rotation[i];
                const b = rotation[rotation.length - 1 - i];
                if (!isBye(a) && !isBye(b)) {
                    const swap = round % 2 === 1;
                    roundMatches.push({
                        id: `m_${Date.now()}_${round}_${i}`,
                        home: swap ? b : a,
                        away: swap ? a : b,
                        gHome: '',
                        gAway: '',
                        round: round + 1,
                        leg: 'ida',
                        isHomeAway: false
                    });
                }
            }
            schedule.push(...roundMatches);
            rotation.splice(1, 0, rotation.pop());
        }
        return schedule;
    }

    function generateDoubleRoundRobinSchedule(playersNames) {
        const firstLeg = generateRoundRobinSchedule(playersNames);
        const roundOffset = Math.max(...firstLeg.map(m => m.round || 1), 0);
        const secondLeg = firstLeg.map((m, idx) => ({
            ...m,
            id: `${m.id}_v`,
            home: m.away,
            away: m.home,
            gHome: '',
            gAway: '',
            round: (m.round || 1) + roundOffset,
            leg: 'volta',
            isHomeAway: true
        }));
        return [...firstLeg.map(m => ({ ...m, isHomeAway: true })), ...secondLeg];
    }

    function generateGroupMatchesHomeAway(playersNames, homeAwayEnabled) {
        return homeAwayEnabled ? generateDoubleRoundRobinSchedule(playersNames) : generateRoundRobinSchedule(playersNames);
    }

    function generateKnockoutMatchesHomeAway() {
        if (!tournamentState.knockout) return;
        (tournamentState.knockout.repechage || []).forEach(match => {
            clearMatchResultFields(match);
        });
        (tournamentState.knockout.rounds || []).forEach(round => {
            (round.matches || []).forEach(match => {
                clearMatchResultFields(match);
                resolveByeMatchOutcome(match);
            });
        });
    }

    async function toggleHomeAwayMode(enabled) {
        if (role !== 'organizador') return;
        const hasScores = hasAnyRecordedScores();
        if (hasScores) {
            const msg = enabled
                ? 'Ativar Casa e Fora vai recriar os jogos da fase atual. Resultados existentes podem ser apagados. Deseja continuar?'
                : 'Desativar Casa e Fora vai remover os jogos de volta. Deseja continuar?';
            if (!confirm(msg)) {
                const input = document.getElementById('tourney-home-away');
                if (input) input.checked = !enabled;
                return;
            }
        }
        tournamentState.homeAway = enabled;
        (tournamentState.groups || []).forEach(group => {
            const names = (group.players || []).map(p => p.name);
            group.matches = generateGroupMatchesHomeAway(names, enabled);
        });
        generateKnockoutMatchesHomeAway();
        recalculateCurrentCupRanking();
        await persistCurrentTournament({ homeAway: enabled, groups: tournamentState.groups, knockout: tournamentState.knockout, generalStats: tournamentState.generalStats });
        renderTournamentFromState();
    }

    function openGroupMatches(index) {
        selectedGroupIndex = index;
        const group = tournamentState.groups[index];
        const readOnlyViewer = role !== 'organizador';
        document.getElementById('modal-group-title').textContent = `Jogos: ${group.name}`;
        
        // Initialize matches if not exist
        if (!group.matches || group.matches.length === 0) {
            const names = group.players.map(p => p.name);
            group.matches = generateGroupMatchesHomeAway(names, !!tournamentState.homeAway);
            document.getElementById('chk-ida-volta').checked = !!tournamentState.homeAway;
        } else {
            document.getElementById('chk-ida-volta').checked = !!tournamentState.homeAway;
        }

        const homeAwayCheckbox = document.getElementById('chk-ida-volta');
        if (homeAwayCheckbox) homeAwayCheckbox.disabled = readOnlyViewer;

        const groupModalSubtitle = document.querySelector('#modal-jogos-grupo .modal-header .header-info p');
        if (groupModalSubtitle) {
            groupModalSubtitle.textContent = readOnlyViewer
                ? 'Visualização somente leitura'
                : 'Gerencie os placares e confrontos';
        }

        const btnSaveGroupMatches = document.getElementById('btn-salvar-jogos-grupo');
        if (btnSaveGroupMatches) btnSaveGroupMatches.style.display = readOnlyViewer ? 'none' : 'inline-flex';

        const controlsHost = document.getElementById('group-matches-stats');
        if (controlsHost && testModeActive && role === 'organizador') {
            controlsHost.innerHTML = `
                <p>Total de jogos: <strong id="total-matches-count">0</strong></p>
                <div class="context-test-buttons" style="justify-content:flex-end;">
                    <button class="btn-test-inline" id="btn-test-sim-group-current">Simular este grupo</button>
                    <button class="btn-test-inline danger" id="btn-test-clear-group-current">Limpar este grupo</button>
                    <button class="btn-test-inline" id="btn-test-recalc-group-current">Recalcular grupo</button>
                </div>
            `;
            document.getElementById('btn-test-sim-group-current')?.addEventListener('click', () => simulateGroupByIndexTest(index));
            document.getElementById('btn-test-clear-group-current')?.addEventListener('click', () => clearGroupResultsTest(index));
            document.getElementById('btn-test-recalc-group-current')?.addEventListener('click', () => recalculateGroupOnlyTest(index));
        } else if (controlsHost) {
            controlsHost.innerHTML = `<p>Total de jogos: <strong id="total-matches-count">0</strong></p>`;
        }

        renderGroupMatchesList();
        document.getElementById('modal-jogos-grupo').classList.add('active');
    }

    function renderGroupMatchesList() {
        const group = tournamentState.groups[selectedGroupIndex];
        const container = document.getElementById('group-matches-list');
        const countEl = document.getElementById('total-matches-count');
        const readOnlyViewer = role !== 'organizador';
        
        if (!group.matches || group.matches.length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhum jogo disponível</div>';
            countEl.textContent = "0";
            return;
        }

        countEl.textContent = group.matches.length;
        container.innerHTML = group.matches.map((m, i) => `
            <div class="match-card">
                <div class="match-meta">
                    <span class="match-round">Rodada ${m.round || 1}</span>
                    <span class="match-leg-badge ${m.leg === 'volta' ? 'volta' : 'ida'}">${m.leg === 'volta' ? 'VOLTA' : 'IDA'}</span>
                </div>
                <div class="match-team home">
                    <span>${formatName(m.home)} <small>(Casa)</small></span>
                </div>
                <input type="number" min="0" class="match-score-input" value="${m.gHome}" data-idx="${i}" data-side="home" placeholder="0" ${readOnlyViewer ? 'disabled' : ''}>
                <span class="match-vs">VS</span>
                <input type="number" min="0" class="match-score-input" value="${m.gAway}" data-idx="${i}" data-side="away" placeholder="0" ${readOnlyViewer ? 'disabled' : ''}>
                <div class="match-team away">
                    <span>${formatName(m.away)} <small>(Fora)</small></span>
                </div>
                ${(testModeActive && role === 'organizador') ? `<div class="test-game-action"><button class="btn-test-inline" data-test-action="group-match-sim" data-group-index="${selectedGroupIndex}" data-match-index="${i}">⚡ Simular jogo</button></div>` : ''}
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

        container.querySelectorAll('[data-test-action="group-match-sim"]').forEach(btn => {
            btn.addEventListener('click', () => simulateSingleGroupMatchTest(Number(btn.dataset.groupIndex), Number(btn.dataset.matchIndex)));
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
                        const cpfToRemove = c.participantId || c.usedBy;
                        if (confirm(`Deseja liberar o código ${c.code} e APAGAR o cadastro do jogador associado?`)) {
                            if (!db) return;
                            try {
                                const newCodes = [...codesArray];
                                newCodes[idx] = {
                                    ...newCodes[idx],
                                    status: 'available',
                                    used: false,
                                    participantId: null,
                                    usedBy: null,
                                    usedByName: null,
                                    participantName: null,
                                    usedAt: null,
                                    cpf: null,
                                    cpfHash: null
                                };
                                await set(ref(db, 'codes/pool'), { codes: newCodes });

                                if (cpfToRemove) {
                                    await removeParticipantEverywhere(cpfToRemove);
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
        homeAwayInput.addEventListener('change', async () => {
            if (homeAwayInput.checked && formatSelect) {
                formatSelect.value = 'grupos-mata-mata';
            }
            if ((tournamentState.groups || []).length || tournamentState.knockout) {
                await toggleHomeAwayMode(homeAwayInput.checked);
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
            if (testModeActive) return;
            const data = snapshot.val();
            if (data) {
                const isNew = !tournamentState.tournamentCode;
                tournamentState = { ...tournamentState, ...data };
                ensureLiveState();
                renderLiveSection();
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
                ensureLiveState();
                renderLiveSection();
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
                const matches = generateGroupMatchesHomeAway(players.map(p => p.name), !!tournamentState.homeAway);
                tournamentState.groups.push({ name: `Grupo ${letter}`, players, matches });
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
                let roundName = getRoundNameBySize(matchesInRound * 2);
                
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

    function createKnockoutPreviewData() {
        const format = tournamentState.format || formatSelect?.value || 'grupos-mata-mata';
        const showMataMata = format === 'mata-mata' || format === 'grupos-mata-mata' || format === 'eliminatoria';
        if (!showMataMata) return null;

        const registered = tournamentState.registeredPlayers || [];
        const total = registered.length || parseInt(participantsInput?.value || tournamentState.participants || 8, 10) || 8;
        const previewPlayers = registered.length
            ? registered
            : Array.from({ length: total }, (_, i) => ({ name: `A definir (Slot ${i + 1})` }));
        const showGroups = format === 'grupos' || format === 'grupos-mata-mata';
        const G = total <= 5 ? 1 : Math.ceil(total / 4);

        let K;
        if (G === 1) K = 2;
        else if (G === 2) K = 4;
        else {
            K = Math.pow(2, Math.ceil(Math.log2(G)));
            if (K === G) K = G * 2;
        }

        const W = K - G;
        const M = G - W;
        const repechagePlayers = Array.from({ length: G }, (_, i) => `2\u00ba Grupo ${String.fromCharCode(65 + i)}`).reverse();
        const repechageRound = [];

        if (M > 0 && showGroups) {
            for (let i = 0; i < M; i++) {
                const p1 = repechagePlayers.shift();
                const p2 = repechagePlayers.shift();
                repechageRound.push(createMatchData(p1, p2, `Vencedor Rep. ${i + 1}`));
                repechagePlayers.push(`Vencedor Rep. ${i + 1}`);
            }
        }

        let knockoutPlayers = [];
        if (showGroups) {
            for (let i = 0; i < G; i++) knockoutPlayers.push(`1\u00ba Grupo ${String.fromCharCode(65 + i)}`);
            knockoutPlayers = knockoutPlayers.concat(repechagePlayers);
        } else {
            for (let i = 0; i < K; i++) {
                knockoutPlayers.push(previewPlayers[i]?.name || previewPlayers[i]?.nome || `A definir (Slot ${i + 1})`);
            }
        }

        const rounds = [];
        let currentRoundPlayers = [...knockoutPlayers];
        while (currentRoundPlayers.length > 1) {
            const matchesInRound = currentRoundPlayers.length / 2;
            const roundName = getRoundNameBySize(matchesInRound * 2);
            const roundMatches = [];
            const nextRoundPlayers = [];
            for (let m = 0; m < currentRoundPlayers.length; m += 2) {
                const p1 = currentRoundPlayers[m] || 'A definir';
                const p2 = currentRoundPlayers[m + 1] || 'A definir';
                const winnerToken = `Vencedor ${roundName} ${m / 2 + 1}`;
                roundMatches.push(createMatchData(p1, p2, winnerToken));
                nextRoundPlayers.push(winnerToken);
            }
            rounds.push({ name: roundName, matches: roundMatches });
            currentRoundPlayers = nextRoundPlayers;
        }

        return { repechage: repechageRound, rounds };
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

    async function renderRanking() {
        const tbody = document.getElementById('ranking-tbody');
        const highlights = document.getElementById('ranking-highlights');
        const cards = document.getElementById('ranking-cards');
        const top3 = document.getElementById('ranking-top3');
        const headRow = document.getElementById('ranking-head-row');
        if (!tbody || !highlights || !cards || !headRow) return;

        const search = (rankingSearchTerm || '').toLowerCase();
        let rows = [];
        if (rankingViewMode === 'current') {
            const stats = Object.values(recalculateCurrentCupRanking() || {});
            rows = stats.sort((a, b) => b.pts - a.pts || b.v - a.v || b.sg - a.sg || b.gp - a.gp || a.gc - b.gc || (b.phaseScore || 0) - (a.phaseScore || 0) || a.name.localeCompare(b.name, 'pt-BR'));
            headRow.innerHTML = `<th>#</th><th style="text-align:left;">Jogador</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>PTS</th><th>APR</th><th>Fase</th><th>Status</th>`;
        } else {
            rows = await recalculateGeneralRanking();
            headRow.innerHTML = `<th>#</th><th style="text-align:left;">Jogador</th><th>🏆</th><th>Finais</th><th>Semis</th><th>Copas</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>PTS</th><th>APR</th>`;
        }
        if (search) rows = rows.filter(r => (r.name || '').toLowerCase().includes(search));

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;">Sem dados de ranking.</td></tr>';
            cards.innerHTML = '';
            top3.innerHTML = '';
            highlights.innerHTML = '';
            return;
        }
        tbody.innerHTML = rows.map((r, i) => rankingViewMode === 'current'
            ? `<tr><td>${i + 1}</td><td style="text-align:left;">${formatName(r.name)}</td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.gp}</td><td>${r.gc}</td><td>${r.sg > 0 ? '+' : ''}${r.sg}</td><td>${r.pts}</td><td>${(r.apr || 0).toFixed(1)}%</td><td>${r.phase || '—'}</td><td>${r.status || '—'}</td></tr>`
            : `<tr><td>${i + 1}</td><td style="text-align:left;">${formatName(r.name)}</td><td>${r.titulos}</td><td>${r.finais}</td><td>${r.semifinais}</td><td>${r.copas}</td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.gp}</td><td>${r.gc}</td><td>${r.sg > 0 ? '+' : ''}${r.sg}</td><td>${r.pts}</td><td>${(r.apr || 0).toFixed(1)}%</td></tr>`
        ).join('');
        cards.innerHTML = `<ul class="ranking-list-mobile">${rows.map((r, i) => `
            <li class="ranking-list-item">
                <div class="ranking-list-head">
                    <span class="ranking-list-pos">#${i + 1}</span>
                    <strong>${formatName(r.name)}</strong>
                </div>
                <div class="ranking-list-meta">
                    <span>PTS ${r.pts || 0}</span>
                    <span>J ${r.j || 0}</span>
                    <span>V ${r.v || 0}</span>
                    <span>SG ${(r.sg || 0) > 0 ? '+' : ''}${r.sg || 0}</span>
                </div>
            </li>
        `).join('')}</ul>`;
        top3.innerHTML = rows.slice(0, 3).map((r, i) => `<div class="ranking-top3-card pos-${i + 1}">${['🥇','🥈','🥉'][i]} ${formatName(r.name)}</div>`).join('');
        highlights.innerHTML = `<div class="ranking-highlight-card"><span>Jogadores</span><strong>${rows.length}</strong></div><div class="ranking-highlight-card"><span>Jogos</span><strong>${rows.reduce((n, r) => n + (r.j || 0), 0)}</strong></div><div class="ranking-highlight-card"><span>Gols</span><strong>${rows.reduce((n, r) => n + (r.gp || 0), 0)}</strong></div><div class="ranking-highlight-card"><span>Líder</span><strong>${formatName(rows[0].name)}</strong></div>`;
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
                    
                    const statusLabel = i === 0 ? 'CLASSIFICADO' : (i === 1 ? 'CLASSIFICADO' : '');
                    const statusClass = i <= 1 ? 'status-classified' : '';
                    const leftBorderClass = isGroupFinished ? (i === 0 ? 'border-green' : (i === 1 ? 'border-gold' : '')) : '';

                    const isMe = participantName && player.name === participantName;
                    const nameStyle = isMe ? 'color: #16A34A; font-weight: 800;' : 'color: #042D15; font-weight: 600;';
                    
                    rows += `
                        <tr class="${leftBorderClass}">
                            <td class="rank-col">${i + 1}º</td>
                            <td class="player-col">
                                <div class="player-info-cell">
                                    <div class="player-avatar">
                                        ${photo ? `<img src="${photo}" alt="">` : `<img src="../imgs/svg-bandeiras/${(countryCode || 'br').toLowerCase()}.svg" alt="" class="flag-avatar">`}
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
                    ${(testModeActive && role === 'organizador' && !isPreview) ? `
                    <div class="context-test-buttons" style="padding: 8px 0 0;">
                        <button class="btn-test-inline" data-test-action="group-sim" data-group-index="${index}">Simular este grupo</button>
                        <button class="btn-test-inline danger" data-test-action="group-clear" data-group-index="${index}">Limpar este grupo</button>
                        <button class="btn-test-inline" data-test-action="group-recalc" data-group-index="${index}">Recalcular grupo</button>
                    </div>` : ''}
                    <div class="group-footer">
                        <button class="btn-group-games" data-index="${index}">Ver jogos do grupo <i class="ph ph-caret-right"></i></button>
                    </div>`;
                
                card.querySelector('.btn-group-games').addEventListener('click', () => openGroupMatches(index));
                card.querySelectorAll('[data-test-action]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const groupIdx = Number(btn.dataset.groupIndex);
                        if (btn.dataset.testAction === 'group-sim') return simulateGroupByIndexTest(groupIdx);
                        if (btn.dataset.testAction === 'group-clear') return clearGroupResultsTest(groupIdx);
                        if (btn.dataset.testAction === 'group-recalc') return recalculateGroupOnlyTest(groupIdx);
                    });
                });
                groupsContainer.appendChild(card);
            });
        } else {
            groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Fase de Grupos desativada</h3><p>O formato atual não inclui grupos.</p></div>`;
        }

        // Mata-mata
        const mataMataContainer = document.getElementById('tab-mata-mata');
        if (mataMataContainer) {
            const groupsPending = (tournamentState.groups || []).some(group => (group.matches || []).some(m => m.gHome === '' || m.gAway === ''));
            const displayKnockout = tournamentState.knockout || createKnockoutPreviewData();
            const isKnockoutPreview = isPreview || !tournamentState.knockout;
            const repechagePending = (displayKnockout?.repechage || []).some(m => !isMatchResolvedForProgression(m));
            if (displayKnockout) {
                normalizeKnockoutAutoAdvances(displayKnockout);
                const allBracketMatches = [
                    ...(displayKnockout.repechage || []),
                    ...((displayKnockout.rounds || []).flatMap(round => round.matches || []))
                ];
                const finalizedCount = allBracketMatches.filter(match => isMatchResolvedForProgression(match)).length;
                const pendingCount = Math.max(0, allBracketMatches.length - finalizedCount);
                const firstPendingRound = (displayKnockout.rounds || []).find(round => (round.matches || []).some(match => !isMatchResolvedForProgression(match)));
                const currentPhase = isKnockoutPreview ? 'Pre-visualizacao' : (repechagePending ? 'Repescagem' : (firstPendingRound?.name || ((displayKnockout.rounds || []).length ? 'Finalizado' : 'Aguardando')));
                const finalRound = displayKnockout.rounds?.[displayKnockout.rounds.length - 1];
                const champion = finalRound?.matches?.[0] ? getKnockoutMatchWinner(finalRound.matches[0]) : null;
                let warningHTML = '';
                if (isKnockoutPreview) {
                    warningHTML += `<div class="knockout-warning-banner knockout-alert"><i class="ph ph-eye"></i><span>Pre-visualizacao do mata-mata: o chaveamento oficial ainda nao foi gerado.</span></div>`;
                }
                if ((tournamentState.groups || []).length && groupsPending) {
                    warningHTML += `<div class="knockout-warning-banner knockout-alert"><i class="ph ph-warning-circle"></i><span>Mata-mata em preparação: finalize todos os jogos da fase de grupos.</span></div>`;
                }
                if ((displayKnockout?.repechage || []).length && repechagePending && !isKnockoutPreview) {
                    warningHTML += `<div class="knockout-warning-banner knockout-alert"><i class="ph ph-warning-circle"></i><span>Repescagem pendente: edite os resultados para liberar a próxima fase.</span></div>`;
                }

                const viewToggleHTML = `<div class="knockout-view-toggle" role="group" aria-label="Formato do mata-mata">
                    <button type="button" class="${knockoutViewMode === 'tree' ? 'active' : ''}" data-knockout-view="tree"><i class="ph ph-tree-structure"></i> Arvore</button>
                    <button type="button" class="${knockoutViewMode === 'list' ? 'active' : ''}" data-knockout-view="list"><i class="ph ph-list-bullets"></i> Lista</button>
                </div>`;

                let bracketHTML = `<div class="mata-mata-tab knockout-panel bracket-stage fifa-bracket-stage knockout-view-${knockoutViewMode}">
                    <div class="bracket-overlay"></div>
                    <div class="knockout-header bracket-toolbar">
                        <div class="knockout-header-copy">
                            <span class="knockout-eyebrow">Fase eliminatória</span>
                            <h2>Chaveamento oficial</h2>
                        </div>
                        <div class="knockout-summary-pills knockout-status-badges">
                            <span class="knockout-pill glass-pill"><i class="ph ph-check-circle"></i> Finalizadas: ${finalizedCount}</span>
                            <span class="knockout-pill glass-pill"><i class="ph ph-clock"></i> Pendentes: ${pendingCount}</span>
                            <span class="knockout-pill glass-pill"><i class="ph ph-flag"></i> Fase atual: ${currentPhase}</span>
                            ${champion ? `<span class="knockout-pill glass-pill champion"><i class="ph-fill ph-trophy"></i> Campeão: ${formatName(champion)}</span>` : ''}
                        </div>
                        ${viewToggleHTML}
                    </div>
                    ${warningHTML}
                    <div class="knockout-scroll-indicator"><i class="ph ph-arrows-left-right"></i>${window.matchMedia('(max-width: 768px)').matches ? 'Fases eliminatórias' : 'Linha de fases do mata-mata'}</div>
                    <div class="knockout-scroll-frame bracket-scroll"><div class="knockout-scroll-container" tabindex="0" aria-label="Chaveamento mata-mata"><div class="bracket-container bracket-tree knockout-track${isKnockoutPreview ? ' preview-mode' : ''}">
                    `;

                function playerBadge(name) {
                    const cleaned = formatName(displayParticipantName(name || 'A definir'));
                    const initials = cleaned.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
                    const participant = (tournamentState.registeredPlayers || []).find(p => formatName(p.name || p.nome) === cleaned || p.name === name || p.nome === name);
                    const avatar = participant?.photo
                        ? `<img src="${participant.photo}" alt="">`
                        : `<img src="../imgs/svg-bandeiras/${(participant?.countryCode || 'br').toLowerCase()}.svg" alt="">`;
                    const subtitle = participant?.nick || participant?.teamName || participant?.flagId || (isRealPlayer(name) ? 'Atleta' : 'Aguardando');
                    const profileAttr = isRealPlayer(name) ? ` onclick="openPlayerProfile(decodeURIComponent('${encodeURIComponent(name)}'))"` : '';
                    return `<span class="knockout-avatar team-avatar">${avatar}<em>${initials}</em></span><span class="team-info"><span class="player-name-clickable team-name-bracket"${profileAttr}>${cleaned}</span><small class="team-subtitle">${formatName(subtitle)}</small></span>`;
                }

                function matchStatus(match, winner, isTwoLegged) {
                    if (match.walkover && winner) return 'Avançou por BYE';
                    if (!isRealPlayer(match.p1) || !isRealPlayer(match.p2)) return 'A definir';
                    if (winner) return 'Finalizado';
                    const singleFilled = match.s1 !== '' && match.s2 !== '' && match.s1 != null && match.s2 != null;
                    const legFilled = match.idaS1 !== '' && match.idaS2 !== '' && match.voltaS1 !== '' && match.voltaS2 !== '' && match.idaS1 != null && match.idaS2 != null && match.voltaS1 != null && match.voltaS2 != null;
                    if (isTwoLegged && legFilled && !winner) return 'Desempate necessário';
                    if (singleFilled || match.status === 'in-progress') return 'Em andamento';
                    if ((String(match.p1 || '') + String(match.p2 || '')).includes('Vencedor')) return 'Aguardando vencedor anterior';
                    return 'Pendente';
                }

                function getMatchStatusClass(statusText) {
                    const normalized = String(statusText || '').toLowerCase();
                    if (normalized.includes('finalizado') || normalized.includes('bye')) return 'is-finalized';
                    if (normalized.includes('andamento') || normalized.includes('desempate') || normalized.includes('pendente')) return 'is-pending';
                    return 'is-waiting';
                }

                const slotBase = 164;
                function connectorColumn(round, rIdx, mode = 'paired') {
                    const slot = slotBase * (2 ** Math.max(0, rIdx));
                    const matchCount = Math.max(1, (round?.matches || []).length || 1);
                    const pairs = mode === 'simple' ? matchCount : Math.max(1, Math.ceil(matchCount / 2));
                    return `<div class="bracket-connector-column ${mode === 'simple' ? 'simple-connector' : 'paired-connector'}" style="--slot:${slot}px" aria-hidden="true">
                        ${Array.from({ length: pairs }, () => mode === 'simple' ? `<span class="bracket-connector-line"></span>` : `<span class="bracket-connector-pair"><i></i></span>`).join('')}
                    </div>`;
                }

                function renderBracketMatch(match, type, rIdx, mIdx, label) {
                    const showBtn = role === 'organizador' && !isKnockoutPreview;
                    const winner = getKnockoutMatchWinner(match);
                    const isTwoLegged = !!tournamentState.homeAway && !match.walkover && !isBye(match.p1) && !isBye(match.p2);
                    const hasResult = (match.s1 !== '' && match.s2 !== '' && match.s1 != null && match.s2 != null) || !!match.completed || !!winner;
                    const statusText = matchStatus(match, winner, isTwoLegged);
                    const statusClass = getMatchStatusClass(statusText);
                    const p1Class = winner === match.p1 ? 'bracket-slot knockout-player-row winner' : (winner === match.p2 ? 'bracket-slot knockout-player-row loser' : 'bracket-slot knockout-player-row');
                    const p2Class = winner === match.p2 ? 'bracket-slot knockout-player-row winner' : (winner === match.p1 ? 'bracket-slot knockout-player-row loser' : 'bracket-slot knockout-player-row');
                    const agg1 = (parseInt(match.idaS1 || 0, 10) || 0) + (parseInt(match.voltaS1 || 0, 10) || 0);
                    const agg2 = (parseInt(match.idaS2 || 0, 10) || 0) + (parseInt(match.voltaS2 || 0, 10) || 0);
                    const score1 = match.walkover && winner ? (match.p1 === winner ? 'WO' : '—') : (hasResult ? (isTwoLegged ? String(agg1) : String(match.s1 ?? '—')) : '—');
                    const score2 = match.walkover && winner ? (match.p2 === winner ? 'WO' : '—') : (hasResult ? (isTwoLegged ? String(agg2) : String(match.s2 ?? '—')) : '—');
                    const idaScore = (match.idaS1 != null && match.idaS1 !== '' && match.idaS2 != null && match.idaS2 !== '') ? `${match.idaS1} x ${match.idaS2}` : '—';
                    const voltaScore = (match.voltaS1 != null && match.voltaS1 !== '' && match.voltaS2 != null && match.voltaS2 !== '') ? `${match.voltaS1} x ${match.voltaS2}` : '—';

                    const compactMeta = isTwoLegged && hasResult ? `(${idaScore}/${voltaScore})` : '';
                    const scorePill = (score, meta = compactMeta) => `<span class="slot-score knockout-score-pill score-display score-pill"><strong>${score}</strong>${meta ? `<small>${meta}</small>` : ''}</span>`;
                    const testSimBtn = (testModeActive && role === 'organizador' && !isKnockoutPreview)
                        ? `<button class="btn-test-inline" data-test-action="knockout-match-sim" data-type="${type}" data-r="${rIdx}" data-m="${mIdx}">Simular confronto</button>`
                        : '';
                    return `
                        <div class="bracket-match match-card knockout-match-card modern ${statusClass} ${hasResult ? 'has-result' : ''} ${winner ? 'finished match-card-finished' : 'match-card-pending'}" data-open-type="${type}" data-open-r="${rIdx}" data-open-m="${mIdx}">
                            <div class="bracket-match-head match-header">
                                <span class="match-title match-id">${label}</span>
                                ${showBtn ? `<button class="btn-edit-knockout glass-button compact-edit" data-type="${type}" data-r="${rIdx}" data-m="${mIdx}" title="Editar resultado"><i class="ph ph-pencil-simple"></i><span>Editar</span></button>` : ''}
                            </div>
                            <div class="${p1Class} match-team ${winner === match.p1 ? 'match-team-winner' : (winner === match.p2 ? 'match-team-loser' : '')}">
                                <span class="player-line">${playerBadge(match.p1)}</span>
                                ${scorePill(score1)}
                            </div>
                            <div class="${p2Class} match-team ${winner === match.p2 ? 'match-team-winner' : (winner === match.p1 ? 'match-team-loser' : '')}">
                                <span class="player-line">${playerBadge(match.p2)}</span>
                                ${scorePill(score2)}
                            </div>
                            ${isTwoLegged ? `<div class="knockout-legs-inline knockout-leg-summary">
                                <span class="knockout-leg-row"><strong>IDA</strong><em>${formatName(displayParticipantName(match.p1))} ${idaScore} ${formatName(displayParticipantName(match.p2))}</em></span>
                                <span class="knockout-leg-row"><strong>VOLTA</strong><em>${formatName(displayParticipantName(match.p2))} ${voltaScore} ${formatName(displayParticipantName(match.p1))}</em></span>
                                <span class="knockout-leg-row aggregate"><strong>AGREGADO</strong><em>${formatName(displayParticipantName(match.p1))} ${agg1} x ${agg2} ${formatName(displayParticipantName(match.p2))}</em></span>
                            </div>` : ''}
                            ${match.pen1 && match.pen2 ? `<div class="penalty-badge"><i class="ph-fill ph-soccer-ball"></i> Pênaltis: ${match.pen1} x ${match.pen2}</div>` : ''}
                            <div class="knockout-card-footer">
                                ${winner ? `<span class="winner-tag"><i class="ph-fill ph-seal-check"></i> Classificado: ${formatName(winner)}</span>` : ''}
                                ${showBtn ? `<button class="btn-edit-knockout glass-button" data-type="${type}" data-r="${rIdx}" data-m="${mIdx}" title="Editar resultado"><i class="ph ph-pencil-simple"></i><span>Editar</span></button>` : ''}
                            </div>
                            ${testSimBtn}
                        </div>`;
                }

                if (displayKnockout.repechage && displayKnockout.repechage.length > 0) {
                    bracketHTML += `<section class="bracket-round knockout-phase-column" style="--slot:${slotBase}px"><div class="bracket-round-title knockout-phase-header"><i class="ph ph-flag-checkered"></i><span>Repescagem</span></div><div class="bracket-round-matches">`;
                    displayKnockout.repechage.forEach((match, mIdx) => {
                        bracketHTML += renderBracketMatch(match, 'repechage', 0, mIdx, `Repescagem ${mIdx + 1}`);
                    });
                    bracketHTML += `</div></section>${connectorColumn({ matches: displayKnockout.repechage }, 0, 'simple')}`;
                }

                if (displayKnockout.rounds) {
                    displayKnockout.rounds.forEach((round, rIdx) => {
                        const totalMatches = (round.matches || []).length;
                        const isFinal = rIdx === displayKnockout.rounds.length - 1;
                        const visualIndex = rIdx;
                        bracketHTML += `<section class="bracket-round knockout-phase-column" style="--slot:${slotBase * (2 ** visualIndex)}px"><div class="bracket-round-title knockout-phase-header"><i class="ph ${isFinal ? 'ph-trophy' : 'ph-soccer-ball'}"></i><span>${round.name}</span><small>${totalMatches} jogos</small></div><div class="bracket-round-matches">`;
                        if (testModeActive && role === 'organizador' && !isKnockoutPreview) {
                            bracketHTML += `<div class="context-test-buttons" style="margin-bottom:8px;">
                                <button class="btn-test-inline" data-test-action="knockout-phase-sim" data-r="${rIdx}">Simular esta fase</button>
                                <button class="btn-test-inline danger" data-test-action="knockout-phase-clear" data-r="${rIdx}">Limpar esta fase</button>
                                <button class="btn-test-inline" data-test-action="knockout-phase-advance" data-r="${rIdx}">Avançar vencedores</button>
                            </div>`;
                        }
                        round.matches.forEach((match, mIdx) => {
                            bracketHTML += renderBracketMatch(match, 'round', rIdx, mIdx, `${round.name} ${mIdx + 1}`);
                        });
                        bracketHTML += `</div></section>${rIdx < displayKnockout.rounds.length - 1 ? connectorColumn(round, visualIndex) : ''}`;
                    });
                }

                if (champion) {
                    const championVisualIndex = Math.max(0, displayKnockout.rounds.length - 1);
                    bracketHTML += `<div class="bracket-connector-column champion-connector" style="--slot:${slotBase * (2 ** Math.max(0, championVisualIndex))}px" aria-hidden="true"><span class="bracket-champion-line"></span></div>
                    <section class="bracket-round knockout-phase-column champion-column" style="--slot:${slotBase * (2 ** Math.max(0, championVisualIndex))}px">
                        <div class="bracket-round-title knockout-phase-header champion-title"><i class="ph-fill ph-crown-simple"></i><span>Campeão</span></div>
                        <div class="champion-card">
                            <span class="champion-icon"><i class="ph-fill ph-trophy"></i></span>
                            <h4>${formatName(champion)}</h4>
                            <p>Título confirmado</p>
                        </div>
                    </section>`;
                }

                bracketHTML += `</div></div></div></div>`;
                mataMataContainer.innerHTML = bracketHTML;
                setupKnockoutScrollInteractions(mataMataContainer);
                mataMataContainer.querySelectorAll('[data-knockout-view]').forEach(button => {
                    button.addEventListener('click', () => {
                        const nextMode = button.dataset.knockoutView === 'list' ? 'list' : 'tree';
                        knockoutViewMode = nextMode;
                        localStorage.setItem(KNOCKOUT_VIEW_STORAGE_KEY, nextMode);
                        const panel = mataMataContainer.querySelector('.knockout-panel');
                        if (panel) {
                            panel.classList.toggle('knockout-view-tree', nextMode === 'tree');
                            panel.classList.toggle('knockout-view-list', nextMode === 'list');
                        }
                        mataMataContainer.querySelectorAll('[data-knockout-view]').forEach(viewButton => {
                            viewButton.classList.toggle('active', viewButton.dataset.knockoutView === nextMode);
                        });
                    });
                });

                // Add Listeners
                if (!isKnockoutPreview) {
                    mataMataContainer.querySelectorAll('.btn-edit-knockout').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const type = btn.dataset.type;
                            const rIdx = parseInt(btn.dataset.r || 0);
                            const mIdx = parseInt(btn.dataset.m || 0);
                            openKnockoutEdit(type, rIdx, mIdx);
                        });
                    });
                    mataMataContainer.querySelectorAll('.bracket-match').forEach(card => {
                        card.addEventListener('click', (event) => {
                            if (event.target.closest('button, a, input, select, textarea')) return;
                            const scroller = mataMataContainer.querySelector('.knockout-scroll-container');
                            if (scroller?.dataset.dragMoved === '1') {
                                scroller.dataset.dragMoved = '0';
                                return;
                            }
                            const type = card.dataset.openType;
                            const rIdx = parseInt(card.dataset.openR || 0, 10);
                            const mIdx = parseInt(card.dataset.openM || 0, 10);
                            openKnockoutEdit(type, rIdx, mIdx, role !== 'organizador');
                        });
                    });
                }
            } else {
                mataMataContainer.innerHTML = `<div class="mata-mata-tab"><div class="knockout-scroll-container"><div class="empty-state"><i class="ph ph-tree-structure"></i><h3>Mata-Mata desativado</h3><p>O formato atual não inclui eliminatórias.</p></div></div></div>`;
            }
            checkAndOpenNextPhaseModal();
        }
        renderRanking();
    }

    function setupKnockoutScrollInteractions(rootEl) {
        const scroller = rootEl?.querySelector('.knockout-scroll-container');
        if (!scroller || scroller.dataset.dragReady === '1') return;
        scroller.dataset.dragReady = '1';

        let dragging = false;
        let startX = 0;
        let startLeft = 0;
        let moved = false;
        const canScrollHorizontally = () => scroller.scrollWidth > scroller.clientWidth + 2;
        const isManualDragEnabled = () => window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 769px)').matches;

        scroller.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (!isManualDragEnabled()) return;
            if (!canScrollHorizontally()) return;
            dragging = true;
            moved = false;
            scroller.dataset.dragMoved = '0';
            startX = event.clientX;
            startLeft = scroller.scrollLeft;
            scroller.classList.add('dragging');
            try { scroller.setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
        });

        scroller.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            const deltaX = event.clientX - startX;
            if (Math.abs(deltaX) > 6) {
                moved = true;
                scroller.dataset.dragMoved = '1';
            }
            scroller.scrollLeft = startLeft - deltaX;
            event.preventDefault();
        }, { passive: false });

        const stopDrag = (event) => {
            if (!dragging) return;
            dragging = false;
            scroller.classList.remove('dragging');
            if (!moved) {
                scroller.dataset.dragMoved = '0';
            }
            try { scroller.releasePointerCapture(event.pointerId); } catch (_) { /* noop */ }
        };
        scroller.addEventListener('pointerup', stopDrag);
        scroller.addEventListener('pointercancel', stopDrag);
        scroller.addEventListener('pointerleave', stopDrag);

        scroller.addEventListener('wheel', (event) => {
            if (!isManualDragEnabled()) return;
            if (!canScrollHorizontally()) return;
            const wantsHorizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
            if (!wantsHorizontal) return;
            scroller.scrollLeft += event.shiftKey ? event.deltaY : event.deltaX;
            event.preventDefault();
        }, { passive: false });
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
            if (tabId === 'ao-vivo') {
                renderLiveSection();
                setTimeout(() => postLivePlayerCommand('playVideo'), 350);
            }
            renderContextualTestToolbars();
        });
    });
    bindLiveEvents();
    loadLiveStateFromLocalStorage();
    renderLiveSection();
    const requestedInitialTab = urlParams.get('tab') || window.location.hash.replace('#', '');
    if (requestedInitialTab === 'ao-vivo') {
        document.querySelector('.tab[data-tab="ao-vivo"]')?.click();
    }

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

    // ========== TEST MODE ==========
    const btnToggleTestMode = document.getElementById('btn-toggle-test-mode');
    const cardTestTools = document.getElementById('card-test-tools');
    const testModeIndicator = document.getElementById('test-mode-indicator');
    const testModeLog = document.getElementById('test-mode-log');
    const testToolbarGroups = document.getElementById('test-toolbar-grupos');
    const testToolbarKnockout = document.getElementById('test-toolbar-mata-mata');
    const testToolbarRanking = document.getElementById('test-toolbar-ranking');
    const testToolbarHistory = document.getElementById('test-toolbar-historico');
    const TEST_NAMES_POOL = ['Lucas', 'Mateus', 'Pedro', 'Rafael', 'João', 'Bruno', 'Caio', 'Felipe', 'Gustavo', 'André', 'Thiago', 'Vitor', 'Diego', 'Henrique', 'Daniel', 'Eduardo'];

    function addTestModeLog(message) {
        const stamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        testModeLogEntries.unshift(`[${stamp}] ${message}`);
        if (testModeLogEntries.length > 100) testModeLogEntries = testModeLogEntries.slice(0, 100);
        if (!testModeLog) return;
        testModeLog.innerHTML = testModeLogEntries.length
            ? testModeLogEntries.map(entry => `<p class="test-log-item">${entry}</p>`).join('')
            : '<p class="test-log-empty">Sem ações de teste ainda.</p>';
    }

    function renderTestModeUI() {
        if (role !== 'organizador') return;
        if (btnToggleTestMode) {
            btnToggleTestMode.innerHTML = testModeActive
                ? '<i class="ph-fill ph-flask"></i> Sair do modo teste'
                : '<i class="ph-fill ph-flask"></i> Entrar em modo teste';
        }
        if (cardTestTools) cardTestTools.style.display = testModeActive ? 'block' : 'none';
        if (testModeIndicator) testModeIndicator.style.display = testModeActive ? 'flex' : 'none';
        renderContextualTestToolbars();
    }

    function renderContextualTestToolbars() {
        const hideAll = () => [testToolbarGroups, testToolbarKnockout, testToolbarRanking, testToolbarHistory].forEach(el => {
            if (!el) return;
            el.style.display = 'none';
            el.innerHTML = '';
        });
        if (!(role === 'organizador' && testModeActive)) {
            hideAll();
            return;
        }
        if (testToolbarGroups) {
            testToolbarGroups.style.display = 'block';
            testToolbarGroups.innerHTML = `
                <details class="context-test-collapse" open>
                    <summary>Ferramentas de teste</summary>
                    <span class="context-test-title">Modo teste ativo — ações simuladas não afetam torneios reais.</span>
                    <div class="context-test-buttons">
                        <button class="btn-test-inline" data-test-action="groups-sim-all">Simular todos os grupos</button>
                        <button class="btn-test-inline danger" data-test-action="groups-clear-all">Limpar resultados dos grupos</button>
                        <button class="btn-test-inline" data-test-action="groups-recalc-all">Recalcular todos os grupos</button>
                        <button class="btn-test-inline" data-test-action="groups-classify">Classificar automaticamente</button>
                    </div>
                </details>
                <div class="test-mini-log">Última ação de teste: ${testModeLogEntries[0] || 'nenhuma ação ainda'}</div>
            `;
        }
        if (testToolbarKnockout) {
            testToolbarKnockout.style.display = 'block';
            testToolbarKnockout.innerHTML = `
                <details class="context-test-collapse" open>
                    <summary>Ferramentas de teste</summary>
                    <span class="context-test-title">Ferramentas de teste do mata-mata/repescagem</span>
                    <div class="context-test-buttons">
                        <button class="btn-test-inline" data-test-action="knockout-next-pending">Simular próximo jogo pendente</button>
                        <button class="btn-test-inline" data-test-action="knockout-phase-current">Simular fase atual</button>
                        <button class="btn-test-inline" data-test-action="knockout-sim-all">Simular mata-mata completo</button>
                        <button class="btn-test-inline danger" data-test-action="knockout-clear-all">Limpar mata-mata</button>
                        <button class="btn-test-inline" data-test-action="knockout-champion">Definir campeão teste</button>
                    </div>
                </details>
                <div class="test-mini-log">Última ação de teste: ${testModeLogEntries[0] || 'nenhuma ação ainda'}</div>
            `;
        }
        if (testToolbarRanking) {
            testToolbarRanking.style.display = 'block';
            testToolbarRanking.innerHTML = `
                <span class="context-test-title">Ferramentas de teste do ranking</span>
                <div class="context-test-buttons">
                    <button class="btn-test-inline" data-test-action="ranking-generate">Gerar ranking teste</button>
                    <button class="btn-test-inline" data-test-action="ranking-recalc">Recalcular ranking</button>
                    <button class="btn-test-inline danger" data-test-action="ranking-clear">Limpar ranking teste</button>
                    <button class="btn-test-inline" data-test-action="ranking-add-champion">Adicionar campeão teste</button>
                    <button class="btn-test-inline" data-test-action="ranking-add-finalist">Adicionar finalista teste</button>
                </div>
            `;
        }
        if (testToolbarHistory) {
            testToolbarHistory.style.display = 'block';
            testToolbarHistory.innerHTML = `
                <span class="context-test-title">Ferramentas de teste do histórico</span>
                <div class="context-test-buttons">
                    <button class="btn-test-inline" data-test-action="history-create">Criar histórico teste</button>
                    <button class="btn-test-inline danger" data-test-action="history-clear">Remover históricos teste</button>
                    <button class="btn-test-inline" data-test-action="history-open">Testar abrir histórico</button>
                </div>
            `;
        }
    }

    function randomScore(max = 5) {
        return Math.floor(Math.random() * (max + 1));
    }

    function randomWinnerScore() {
        let a = randomScore(5);
        let b = randomScore(5);
        while (a === b) {
            a = randomScore(5);
            b = randomScore(5);
        }
        return [a, b];
    }

    function makeRandomTestPlayers(count) {
        return Array.from({ length: count }, (_, i) => {
            const label = i + 1;
            return {
                id: `fifa-test-${String(label).padStart(2, '0')}`,
                name: `Participante Teste ${String(label).padStart(2, '0')}`,
                isTestMode: true,
                modality: 'fifa'
            };
        });
    }

    function getSelectedTestParticipantLimit() {
        const value = parseInt(participantsInput?.value, 10);
        return Math.min(64, Math.max(2, Number.isFinite(value) ? value : 16));
    }

    async function enterTestMode() {
        if (testModeActive) return;
        testModeBackupState = JSON.parse(JSON.stringify(tournamentState));
        testModeActive = true;
        testModeLogEntries = [];
        addTestModeLog('Modo teste ativado');
        renderTestModeUI();
        renderTournamentFromState();
    }

    async function exitTestMode(clearData = false) {
        if (!testModeActive) return;
        tournamentState.isTestMode = false;
        tournamentState.testPanelOpen = false;
        tournamentState.selectedTestAction = null;
        tournamentState.testToolbarVisible = false;
        tournamentState.testLogsCollapsed = false;
        tournamentState.currentTestOverlay = null;
        document.body.classList.remove('test-mode', 'test-mode-active');
        document.querySelectorAll('.test-mode-overlay, .test-warning-banner').forEach(el => el.remove());
        if (clearData && testModeBackupState) {
            tournamentState = JSON.parse(JSON.stringify(testModeBackupState));
            renderTournamentFromState();
            updateStatus(tournamentState.status || 'aguardando');
            addTestModeLog('Dados de teste removidos e estado real restaurado');
        } else {
            addTestModeLog('Modo teste desativado mantendo dados apenas localmente');
        }
        testModeActive = false;
        testModeBackupState = null;
        await persistCurrentTournament({ isTestMode: false, __allowPersistInTestMode: true });
        renderTestModeUI();
        renderTournamentFromState();
    }

    async function withSensitiveGuard(actionId, fn) {
        if (requestedRole === 'organizador' && !isOrganizerAuthorized) {
            window.location.href = '../index.html';
            return;
        }
        if (!SENSITIVE_IDS.has(actionId)) {
            await fn();
            return;
        }
        fn.actionId = actionId;
        askSensitivePassword(fn);
    }

    async function addRandomPlayersForTest(count = getSelectedTestParticipantLimit(), askConfirm = true) {
        if (!testModeActive) return;
        const amount = Math.min(64, Math.max(2, Number(count) || getSelectedTestParticipantLimit()));
        const existing = tournamentState.registeredPlayers || [];
        if (askConfirm && existing.length && !confirm('Já existem jogadores cadastrados. Deseja substituir pelos jogadores de teste?')) return;
        const players = makeRandomTestPlayers(amount);
        tournamentState.registeredPlayers = players;
        tournamentState.participants = amount;
        tournamentState.status = 'ativo';
        tournamentState.isTestMode = true;
        if (participantsInput) participantsInput.value = String(amount);
        buildTournamentState(players, tournamentState.format || 'grupos-mata-mata');
        renderTournamentFromState();
        updateStatus('ativo');
        addTestModeLog(`${amount} participantes adicionados para teste`);
    }

    async function simulateGroupPhaseTest() {
        if (!testModeActive || !tournamentState.groups?.length) return;
        tournamentState.groups.forEach((group, gIdx) => {
            (group.matches || []).forEach(match => {
                match.gHome = String(randomScore(5));
                match.gAway = String(randomScore(5));
                match.isTestData = true;
            });
            updateGroupStats(gIdx);
        });
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog('Fase de grupos simulada');
    }

    async function simulateSingleGroupMatchTest(groupIndex, matchIndex) {
        if (!testModeActive) return;
        const group = tournamentState.groups?.[groupIndex];
        const match = group?.matches?.[matchIndex];
        if (!group || !match) return;
        match.gHome = String(randomScore(5));
        match.gAway = String(randomScore(5));
        match.isTestData = true;
        updateGroupStats(groupIndex);
        recalculateGeneralStats();
        renderTournamentFromState();
        if (selectedGroupIndex === groupIndex) renderGroupMatchesList();
        addTestModeLog(`Jogo simulado (${group.name}): ${formatName(match.home)} ${match.gHome} x ${match.gAway} ${formatName(match.away)}`);
    }

    async function simulateGroupByIndexTest(groupIndex) {
        if (!testModeActive) return;
        const group = tournamentState.groups?.[groupIndex];
        if (!group) return;
        (group.matches || []).forEach(match => {
            match.gHome = String(randomScore(5));
            match.gAway = String(randomScore(5));
            match.isTestData = true;
        });
        updateGroupStats(groupIndex);
        recalculateGeneralStats();
        renderTournamentFromState();
        if (selectedGroupIndex === groupIndex) renderGroupMatchesList();
        addTestModeLog(`${group.name} simulado com sucesso`);
    }

    async function clearGroupResultsTest(groupIndex) {
        const group = tournamentState.groups?.[groupIndex];
        if (!group) return;
        (group.matches || []).forEach(match => {
            match.gHome = '';
            match.gAway = '';
            delete match.isTestData;
        });
        updateGroupStats(groupIndex);
        recalculateGeneralStats();
        renderTournamentFromState();
        if (selectedGroupIndex === groupIndex) renderGroupMatchesList();
        addTestModeLog(`Resultados limpos em ${group.name}`);
    }

    async function recalculateGroupOnlyTest(groupIndex) {
        const group = tournamentState.groups?.[groupIndex];
        if (!group) return;
        updateGroupStats(groupIndex);
        recalculateGeneralStats();
        renderTournamentFromState();
        if (selectedGroupIndex === groupIndex) renderGroupMatchesList();
        addTestModeLog(`Classificação recalculada em ${group.name}`);
    }

    async function clearAllGroupResultsTest() {
        (tournamentState.groups || []).forEach((group, idx) => {
            (group.matches || []).forEach(match => {
                match.gHome = '';
                match.gAway = '';
                delete match.isTestData;
            });
            updateGroupStats(idx);
        });
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog('Resultados de todos os grupos limpos');
    }

    async function recalculateAllGroupsTest() {
        (tournamentState.groups || []).forEach((_, idx) => updateGroupStats(idx));
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog('Todos os grupos recalculados');
    }

    async function classifyAutomaticallyFromGroupsTest() {
        const hasPending = (tournamentState.groups || []).some(g => (g.matches || []).some(m => m.gHome === '' || m.gAway === ''));
        if (hasPending) {
            alert('Existem jogos pendentes na fase de grupos.');
            return;
        }
        await rebuildKnockoutFromGroups();
        renderTournamentFromState();
        addTestModeLog('Classificação automática para repescagem e próxima fase aplicada');
    }

    function resolveGroupPlaceholderName(name, groupsTable) {
        const match = typeof name === 'string' ? name.match(/(\d)º (Grupo [A-Z])/i) : null;
        if (!match) return name;
        const pos = Number(match[1]) - 1;
        const groupName = match[2];
        return groupsTable[groupName]?.[pos]?.name || name;
    }

    async function seedKnockoutWithGroupResults() {
        if (!tournamentState.knockout) return;
        const groupsTable = {};
        (tournamentState.groups || []).forEach(group => {
            groupsTable[group.name] = getSortedGroupPlayers(group);
        });
        (tournamentState.knockout.repechage || []).forEach(match => {
            match.p1 = resolveGroupPlaceholderName(match.p1Source || match.p1, groupsTable);
            match.p2 = resolveGroupPlaceholderName(match.p2Source || match.p2, groupsTable);
            resolveByeMatchOutcome(match);
        });
        (tournamentState.knockout.rounds || []).forEach((round, idx) => {
            (round.matches || []).forEach(match => {
                if (idx === 0) {
                    match.p1 = resolveGroupPlaceholderName(match.p1Source || match.p1, groupsTable);
                    match.p2 = resolveGroupPlaceholderName(match.p2Source || match.p2, groupsTable);
                }
                resolveByeMatchOutcome(match);
            });
        });
    }

    async function simulateRepechageTest() {
        if (!testModeActive || !tournamentState.knockout) return;
        await seedKnockoutWithGroupResults();
        (tournamentState.knockout.repechage || []).forEach(match => {
            const bye = resolveByeMatchOutcome(match);
            if (bye.resolved) return;
            const [s1, s2] = randomWinnerScore();
            match.s1 = String(s1);
            match.s2 = String(s2);
            match.isTestData = true;
            match.winner = s1 > s2 ? match.p1 : match.p2;
            match.completed = true;
            match.status = 'completed';
            propagateWinnerToNextRound(tournamentState.knockout, match.winnerToken, match.winner, -1);
        });
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog('Repescagem simulada');
    }

    async function simulateKnockoutTest() {
        if (!testModeActive || !tournamentState.knockout) return;
        await seedKnockoutWithGroupResults();
        for (let r = 0; r < (tournamentState.knockout.rounds || []).length; r++) {
            const round = tournamentState.knockout.rounds[r];
            for (const match of (round.matches || [])) {
                const bye = resolveByeMatchOutcome(match);
                if (!bye.resolved) {
                    const [s1, s2] = randomWinnerScore();
                    match.s1 = String(s1);
                    match.s2 = String(s2);
                    match.isTestData = true;
                    match.winner = s1 > s2 ? match.p1 : match.p2;
                    match.completed = true;
                    match.status = 'completed';
                }
                if (match.winner) {
                    propagateWinnerToNextRound(tournamentState.knockout, match.winnerToken, match.winner, r);
                }
            }
        }
        recalculateGeneralStats();
        renderTournamentFromState();
        const finalRound = tournamentState.knockout.rounds?.[tournamentState.knockout.rounds.length - 1];
        const champion = finalRound?.matches?.[0]?.winner || 'A definir';
        tournamentState.top3 = { ...tournamentState.top3, first: champion };
        addTestModeLog(`Mata-mata simulado. Campeão: ${champion}`);
    }

    async function simulateKnockoutMatchTest(type, rIdx, mIdx) {
        if (!testModeActive || !tournamentState.knockout) return;
        const match = type === 'repechage'
            ? tournamentState.knockout.repechage?.[mIdx]
            : tournamentState.knockout.rounds?.[rIdx]?.matches?.[mIdx];
        if (!match) return;
        const bye = resolveByeMatchOutcome(match);
        if (!bye.resolved) {
            const [s1, s2] = randomWinnerScore();
            match.s1 = String(s1);
            match.s2 = String(s2);
            match.isTestData = true;
            match.winner = s1 > s2 ? match.p1 : match.p2;
            match.completed = true;
            match.status = 'completed';
        }
        if (match.winner) {
            propagateWinnerToNextRound(tournamentState.knockout, match.winnerToken, match.winner, type === 'repechage' ? -1 : rIdx);
        }
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog(`Confronto simulado: ${formatName(match.p1)} x ${formatName(match.p2)} (${match.winner || 'sem vencedor real'})`);
    }

    async function simulateKnockoutPhaseTest(rIdx) {
        if (!testModeActive || !tournamentState.knockout?.rounds?.[rIdx]) return;
        const round = tournamentState.knockout.rounds[rIdx];
        for (let mIdx = 0; mIdx < round.matches.length; mIdx++) {
            await simulateKnockoutMatchTest('round', rIdx, mIdx);
        }
        addTestModeLog(`Fase simulada: ${round.name}`);
    }

    async function clearKnockoutPhaseTest(rIdx) {
        const round = tournamentState.knockout?.rounds?.[rIdx];
        if (!round) return;
        round.matches.forEach(clearMatchResultFields);
        recalculateGeneralStats();
        renderTournamentFromState();
        addTestModeLog(`Resultados limpos da fase: ${round.name}`);
    }

    async function clearRepechageTest() {
        (tournamentState.knockout?.repechage || []).forEach(clearMatchResultFields);
        renderTournamentFromState();
        addTestModeLog('Repescagem limpa');
    }

    async function clearTestRanking() {
        if (!db) return alert('Firebase indisponível.');
        await remove(ref(db, 'ranking/test/fifa'));
        addTestModeLog('Ranking de teste removido');
        alert('Ranking de teste removido.');
    }

    async function addRankingBadgeTest(kind) {
        if (!db) return;
        const path = 'ranking/test/fifa';
        const snap = await get(ref(db, path));
        const data = snap.exists() ? snap.val() : { isTestMode: true, players: [] };
        if (!data.players.length) data.players = makeRandomTestPlayers(4).map(p => ({ name: p.name, titulos: 0, finais: 0 }));
        data.players[0][kind] = (data.players[0][kind] || 0) + 1;
        await set(ref(db, path), data);
        addTestModeLog(`${kind === 'titulos' ? 'Título' : 'Final'} de teste adicionado para ${data.players[0].name}`);
        alert('Ranking teste atualizado.');
    }

    async function removeTestHistory() {
        if (!db) return alert('Firebase indisponível.');
        const snap = await get(ref(db, 'imports'));
        if (!snap.exists()) return alert('Nenhum histórico encontrado.');
        const all = snap.val();
        const keys = Object.keys(all).filter(k => all[k]?.isTestMode === true);
        await Promise.all(keys.map(k => remove(ref(db, `imports/${k}`))));
        addTestModeLog(`${keys.length} históricos de teste removidos`);
        alert('Históricos de teste removidos.');
    }

    async function readFirebaseTest() {
        if (!db) return alert('Erro ao conectar com Firebase.');
        const lastId = localStorage.getItem('lastFifaTestSaveId');
        if (!lastId) return alert('Nenhum teste salvo encontrado.');
        const snap = await get(ref(db, `tests/fifa/${lastId}`));
        if (!snap.exists()) return alert('Teste não encontrado.');
        addTestModeLog(`Teste lido no Firebase (${lastId})`);
        alert('Teste lido com sucesso.');
    }

    async function updateFirebaseTest() {
        if (!db) return alert('Erro ao conectar com Firebase.');
        const lastId = localStorage.getItem('lastFifaTestSaveId');
        if (!lastId) return alert('Nenhum teste salvo encontrado.');
        await update(ref(db, `tests/fifa/${lastId}`), { updatedAt: new Date().toISOString(), ping: 'updated', isTestMode: true });
        addTestModeLog(`Teste atualizado no Firebase (${lastId})`);
        alert('Teste atualizado com sucesso.');
    }

    async function simulateCompleteTournamentTest() {
        if (!testModeActive) return;
        if (!(tournamentState.registeredPlayers || []).length) {
            await addRandomPlayersForTest(parseInt(participantsInput?.value, 10) || 16, false);
        }
        await simulateGroupPhaseTest();
        await simulateRepechageTest();
        await simulateKnockoutTest();
        addTestModeLog('Simulação completa concluída');
    }

    async function clearTestResultsOnly() {
        if (!testModeActive) return;
        (tournamentState.groups || []).forEach((group, idx) => {
            (group.matches || []).forEach(match => {
                match.gHome = '';
                match.gAway = '';
            });
            updateGroupStats(idx);
        });
        if (tournamentState.knockout) resetKnockoutResults(tournamentState.knockout);
        tournamentState.generalStats = {};
        tournamentState.top3 = { first: '—', second: '—', third: '—' };
        renderTournamentFromState();
        addTestModeLog('Resultados de teste limpos');
    }

    async function resetTestCompletely() {
        if (!testModeActive) return;
        tournamentState.registeredPlayers = [];
        tournamentState.groups = [];
        tournamentState.knockout = null;
        tournamentState.generalStats = {};
        tournamentState.top3 = { first: '—', second: '—', third: '—' };
        tournamentState.status = 'aguardando';
        if (participantsInput) participantsInput.value = '8';
        updateStatus('aguardando');
        renderTournamentFromState();
        addTestModeLog('Reset de teste completo executado');
    }

    async function generateTestCodeOnly() {
        if (!testModeActive) return;
        const code = await generateTournamentCode('fifa');
        tournamentState.tournamentCode = code;
        addTestModeLog(`Código de teste gerado: ${code}`);
        alert(`Código de teste: ${code}`);
    }

    async function testFirebaseSave() {
        if (!db) {
            alert('Firebase indisponível neste ambiente.');
            return;
        }
        const payload = {
            id: `test_${Date.now()}`,
            isTestMode: true,
            label: 'TORNEIO TESTE',
            createdAt: new Date().toISOString(),
            tournament: JSON.parse(JSON.stringify(tournamentState))
        };
        try {
            await set(ref(db, `tests/fifa/${payload.id}`), payload);
            localStorage.setItem('lastFifaTestSaveId', payload.id);
            addTestModeLog(`Teste salvo no Firebase (${payload.id})`);
            alert('Teste salvo com sucesso no Firebase');
        } catch (e) {
            console.error(e);
            alert('Erro ao salvar teste no Firebase');
        }
    }

    async function removeFirebaseTestData() {
        if (!db) return;
        const lastId = localStorage.getItem('lastFifaTestSaveId');
        if (!lastId) {
            alert('Nenhum teste salvo anteriormente para remover.');
            return;
        }
        try {
            await remove(ref(db, `tests/fifa/${lastId}`));
            addTestModeLog(`Teste removido do Firebase (${lastId})`);
            alert('Teste removido do Firebase');
            localStorage.removeItem('lastFifaTestSaveId');
        } catch (e) {
            console.error(e);
            alert('Erro ao remover teste do Firebase');
        }
    }

    async function testHistoryInsert() {
        if (!db) {
            alert('Firebase indisponível.');
            return;
        }
        const fakeHistory = {
            id: `hist_test_${Date.now()}`,
            type: 'tournament-history',
            isTestMode: true,
            status: 'finalizado',
            name: 'TORNEIO TESTE',
            tournamentType: 'fifa',
            importedAt: new Date().toISOString(),
            champion: tournamentState.top3?.first || 'Jogador Teste'
        };
        await set(ref(db, `imports/${fakeHistory.id}`), fakeHistory);
        addTestModeLog('Histórico de teste criado');
        alert('Histórico de teste criado com sucesso.');
    }

    async function testRankingData() {
        if (!db) {
            alert('Firebase indisponível.');
            return;
        }
        const rankingPayload = {
            isTestMode: true,
            updatedAt: new Date().toISOString(),
            players: makeRandomTestPlayers(8).map((p, idx) => ({
                name: p.name,
                titulos: Math.floor(Math.random() * 5),
                finais: Math.floor(Math.random() * 8),
                semifinais: Math.floor(Math.random() * 12),
                vitorias: 10 + idx * 2,
                jogos: 15 + idx * 2,
                gols: 20 + idx * 3,
                golsContra: 9 + idx,
                saldo: 11 + idx * 2,
                pontos: 40 + idx * 3,
                aproveitamento: `${Math.floor(55 + Math.random() * 40)}%`
            }))
        };
        await set(ref(db, 'ranking/test/fifa'), rankingPayload);
        addTestModeLog('Ranking de teste gerado');
        alert('Dados de teste de ranking gerados.');
    }

    async function advanceTestPhase() {
        if (!testModeActive || !tournamentState.knockout) return;
        const firstPendingRound = (tournamentState.knockout.rounds || []).find(r => (r.matches || []).some(m => !getKnockoutMatchWinner(m)));
        if (!firstPendingRound) {
            addTestModeLog('Não há fase pendente para avançar');
            return;
        }
        for (const match of (firstPendingRound.matches || [])) {
            if (getKnockoutMatchWinner(match)) continue;
            const bye = resolveByeMatchOutcome(match);
            if (bye.resolved && bye.winner) {
                propagateWinnerToNextRound(tournamentState.knockout, match.winnerToken, bye.winner);
                continue;
            }
            const [s1, s2] = randomWinnerScore();
            match.s1 = String(s1);
            match.s2 = String(s2);
            match.winner = s1 > s2 ? match.p1 : match.p2;
            match.completed = true;
            match.status = 'completed';
            propagateWinnerToNextRound(tournamentState.knockout, match.winnerToken, match.winner);
        }
        renderTournamentFromState();
        addTestModeLog(`Fase avançada manualmente (${firstPendingRound.name})`);
    }

    async function rollbackTestPhase() {
        if (!testModeActive || !tournamentState.knockout?.rounds?.length) return;
        const rounds = tournamentState.knockout.rounds;
        const lastCompletedIdx = rounds.map((r, idx) => ({ r, idx })).reverse().find(({ r }) => (r.matches || []).every(m => !!getKnockoutMatchWinner(m)))?.idx;
        if (lastCompletedIdx == null || lastCompletedIdx <= 0) {
            addTestModeLog('Não há fase válida para voltar');
            return;
        }
        rounds[lastCompletedIdx].matches.forEach(clearMatchResultFields);
        rounds[lastCompletedIdx - 1].matches.forEach(m => {
            if (m.winnerToken) propagateWinnerToNextRound(tournamentState.knockout, m.winnerToken, m.winnerToken, lastCompletedIdx - 1);
        });
        renderTournamentFromState();
        addTestModeLog(`Fase de teste retornada para ${rounds[lastCompletedIdx - 1].name}`);
    }

    function bindTestModeButtons() {
        const handlers = {
            'btn-test-add-random': () => addRandomPlayersForTest(getSelectedTestParticipantLimit()),
            'btn-test-add-8': () => addRandomPlayersForTest(getSelectedTestParticipantLimit()),
            'btn-test-add-16': () => addRandomPlayersForTest(getSelectedTestParticipantLimit()),
            'btn-test-add-32': () => addRandomPlayersForTest(getSelectedTestParticipantLimit()),
            'btn-test-add-64': () => addRandomPlayersForTest(getSelectedTestParticipantLimit()),
            'btn-test-generate-bracket': async () => {
                if (!(tournamentState.registeredPlayers || []).length) await addRandomPlayersForTest(getSelectedTestParticipantLimit(), false);
                buildTournamentState(tournamentState.registeredPlayers, tournamentState.format || 'grupos-mata-mata');
                renderTournamentFromState();
                addTestModeLog('Chaveamento de teste gerado');
            },
            'btn-test-sim-groups': simulateGroupPhaseTest,
            'btn-test-sim-repechage': simulateRepechageTest,
            'btn-test-sim-knockout': simulateKnockoutTest,
            'btn-test-sim-full': simulateCompleteTournamentTest,
            'btn-test-clear-results': clearTestResultsOnly,
            'btn-test-reset-all': resetTestCompletely,
            'btn-test-generate-code': generateTestCodeOnly,
            'btn-test-save-firebase': testFirebaseSave,
            'btn-test-read-firebase': readFirebaseTest,
            'btn-test-update-firebase': updateFirebaseTest,
            'btn-test-remove-firebase': removeFirebaseTestData,
            'btn-test-history': testHistoryInsert,
            'btn-test-history-remove': removeTestHistory,
            'btn-test-ranking': testRankingData,
            'btn-test-ranking-clear': clearTestRanking,
            'btn-test-next-phase': advanceTestPhase,
            'btn-test-prev-phase': rollbackTestPhase
        };

        Object.entries(handlers).forEach(([id, fn]) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', async () => {
                if (!testModeActive) {
                    alert('Ative o modo teste para usar essa ferramenta.');
                    return;
                }
                await withSensitiveGuard(id, async () => fn());
            });
        });
    }

    function bindContextualToolbarActions() {
        document.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('[data-test-action]');
            if (!btn) return;
            if (!testModeActive || role !== 'organizador') return;
            const action = btn.dataset.testAction;
            if (action === 'groups-sim-all') return simulateGroupPhaseTest();
            if (action === 'groups-clear-all') return clearAllGroupResultsTest();
            if (action === 'groups-recalc-all') return recalculateAllGroupsTest();
            if (action === 'groups-classify') return classifyAutomaticallyFromGroupsTest();
            if (action === 'knockout-match-sim') return simulateKnockoutMatchTest(btn.dataset.type, parseInt(btn.dataset.r || '-1', 10), parseInt(btn.dataset.m || '-1', 10));
            if (action === 'knockout-phase-sim') return simulateKnockoutPhaseTest(parseInt(btn.dataset.r || '0', 10));
            if (action === 'knockout-phase-clear') return clearKnockoutPhaseTest(parseInt(btn.dataset.r || '0', 10));
            if (action === 'knockout-phase-advance') return simulateKnockoutPhaseTest(parseInt(btn.dataset.r || '0', 10));
            if (action === 'repechage-sim-all') return simulateRepechageTest();
            if (action === 'repechage-clear') return clearRepechageTest();
            if (action === 'repechage-advance') return simulateRepechageTest();
            if (action === 'repechage-next-phase') return checkAndOpenNextPhaseModal();
            if (action === 'knockout-next-pending') return advanceTestPhase();
            if (action === 'knockout-phase-current') return simulateKnockoutPhaseTest(0);
            if (action === 'knockout-sim-all') return simulateKnockoutTest();
            if (action === 'knockout-clear-all') return resetKnockoutResults(tournamentState.knockout), renderTournamentFromState(), addTestModeLog('Mata-mata limpo');
            if (action === 'knockout-champion') return simulateKnockoutTest();
            if (action === 'ranking-generate') return testRankingData();
            if (action === 'ranking-recalc') return recalculateGeneralStats(), addTestModeLog('Ranking recalculado com base no estado atual'), alert('Ranking recalculado (dados locais).');
            if (action === 'ranking-clear') return withSensitiveGuard('btn-test-ranking-clear', clearTestRanking);
            if (action === 'ranking-add-champion') return addRankingBadgeTest('titulos');
            if (action === 'ranking-add-finalist') return addRankingBadgeTest('finais');
            if (action === 'history-create') return testHistoryInsert();
            if (action === 'history-clear') return withSensitiveGuard('btn-test-history-remove', removeTestHistory);
            if (action === 'history-open') return alert('Abra um card de histórico para validar os detalhes.');
        });
    }

    if (btnToggleTestMode) {
        btnToggleTestMode.addEventListener('click', async () => {
            if (!testModeActive) {
                return withSensitiveGuard('btn-toggle-test-mode', enterTestMode);
            }
            const shouldClear = confirm('Deseja limpar os dados de teste?\n\nOK = Sim, limpar tudo\nCancelar = Não, manter dados de teste locais');
            if (shouldClear) {
                return withSensitiveGuard('btn-test-exit-clear', async () => exitTestMode(true));
            }
            return exitTestMode(false);
        });
    }
    bindTestModeButtons();
    bindContextualToolbarActions();
    renderTestModeUI();


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
                foto: pData && pData.photo ? pData.photo : `../imgs/svg-bandeiras/${((pData && pData.countryCode) || 'br').toLowerCase()}.svg`,
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
        const inputEl = document.getElementById('sensitive-password-input');
        const errorEl = document.getElementById('sensitive-password-error');
        const actionLabel = ACTION_LABELS[actionFn?.actionId] || 'Ação administrativa';
        if (titleEl) titleEl.textContent = 'Confirmar ação administrativa';
        if (textEl) textEl.textContent = `Confirme para executar: ${actionLabel}.`;
        if (inputEl) inputEl.value = '';
        if (errorEl) errorEl.style.display = 'none';
        modalSensitivePassword?.classList.add('active');
        setTimeout(() => inputEl?.focus(), 0);
    }

    btnConfirmSensitivePassword?.addEventListener('click', async () => {
        if (!pendingSensitiveAction) {
            modalSensitivePassword?.classList.remove('active');
            return;
        }
        const inputEl = document.getElementById('sensitive-password-input');
        const errorEl = document.getElementById('sensitive-password-error');
        if ((inputEl?.value || '') !== SENSITIVE_PASSWORD) {
            if (errorEl) errorEl.style.display = 'block';
            if (inputEl) {
                inputEl.value = '';
                inputEl.focus();
            }
            return;
        }
        modalSensitivePassword?.classList.remove('active');
        const action = pendingSensitiveAction;
        pendingSensitiveAction = null;
        await action();
    });

    document.getElementById('sensitive-password-input')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            btnConfirmSensitivePassword?.click();
        }
    });

    document.getElementById('btn-close-sensitive-password')?.addEventListener('click', () => {
        pendingSensitiveAction = null;
        modalSensitivePassword?.classList.remove('active');
    });

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
                    generalStats: {},
                    live: createDefaultLiveState()
                };
                repechageModalShown = false;
                renderTournamentFromState();
                renderLiveSection();
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
                    await removeParticipantEverywhere(cpfRaw);

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
        btn.addEventListener('click', async () => {
            await withSensitiveGuard(id, async () => fn());
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
                knockout: tournamentState.knockout || null,
                live: ensureLiveState()
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
                    knockout: knockout,
                    live: tournamentState.live || createDefaultLiveState()
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
        chkIdaVolta.addEventListener('change', async (e) => {
            if (selectedGroupIndex === null) return;
            await toggleHomeAwayMode(e.target.checked);
            renderGroupMatchesList();
        });
    }

    const btnSalvarJogos = document.getElementById('btn-salvar-jogos-grupo');
    if (btnSalvarJogos) {
        btnSalvarJogos.addEventListener('click', async () => {
            if (role !== 'organizador') return;
            if (selectedGroupIndex === null) return;
            
            const btn = btnSalvarJogos;
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Salvando...';

            try {
                // Update stats (todos os grupos para classificação consistente)
                (tournamentState.groups || []).forEach((_, idx) => updateGroupStats(idx));

                const groupsFinished = (tournamentState.groups || []).every(group =>
                    (group.matches || []).length > 0 &&
                    (group.matches || []).every(m => m.gHome !== '' && m.gAway !== '')
                );
                if (groupsFinished) {
                    const newQualifiers = getGroupQualifiedEntries().map(entry => entry.name);
                    const hasKnockout = !!tournamentState.knockout?.rounds?.length;
                    if (!hasKnockout) {
                        await rebuildKnockoutFromGroups();
                    } else {
                        const oldQualifiers = getCurrentKnockoutQualifiersFromState();
                        const qualifiersChanged = haveQualifiersChanged(oldQualifiers, newQualifiers);
                        if (qualifiersChanged) {
                            const eliminationStarted = hasEliminationStarted(oldQualifiers);
                            if (!eliminationStarted) {
                                await rebuildKnockoutFromGroups();
                            } else {
                                const shouldRebuild = confirm('Alterar essa partida muda os classificados e pode recriar o mata-mata, apagando resultados já lançados. Deseja continuar?');
                                if (shouldRebuild) {
                                    await rebuildKnockoutFromGroups();
                                }
                            }
                        }
                    }
                }
                recalculateGeneralStats();
                
                // Persist
                await persistCurrentTournament({ groups: tournamentState.groups, knockout: tournamentState.knockout, generalStats: tournamentState.generalStats });

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
