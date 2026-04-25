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

    if (role === 'participante' && participantName) {
        badge.textContent = participantName;
    } else {
        badge.textContent = role.toUpperCase();
    }

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
            if (m.gHome !== "" && m.gAway !== "") {
                const gh = parseInt(m.gHome);
                const ga = parseInt(m.gAway);
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
                    const cpfToRemove = c.usedBy;
                    if (confirm(`Deseja liberar o código ${c.code} e APAGAR o cadastro do jogador associado?`)) {
                        if (!db) return;
                        try {
                            // 1. Reset code in pool
                            const newCodes = [...codesArray];
                            newCodes[idx] = { ...newCodes[idx], used: false, usedBy: null };
                            await set(ref(db, 'codes/pool'), { codes: newCodes });

                            if (cpfToRemove) {
                                // 2. Remove from participants
                                await remove(ref(db, 'participants/' + cpfToRemove));

                                // 3. Remove from current tournament registeredPlayers
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
        
        // Force valid numbers
        if (n > 2) {
            if (n <= 8) n = 8;
            else if (n <= 16) n = 16;
            else if (n <= 32) n = 32;
            else n = 64;
            participantsInput.value = n;
        }

        const format = formatSelect ? formatSelect.value : 'grupos-mata-mata';
        
        if (n >= 8) {
            const phaseMap = { 8: 3, 16: 4, 32: 5, 64: 6 };
            phasesInfo.textContent = `${phaseMap[n] || Math.ceil(Math.log2(n))} fases`;
            
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

    // ========== CONFIG UPDATE BUTTON ==========
    const btnUpdateConfig = document.getElementById('btn-update-config');
    if (btnUpdateConfig) {
        btnUpdateConfig.addEventListener('click', async () => {
            const newName = document.getElementById('tourney-name').value.trim();
            let newParticipants = parseInt(participantsInput.value);
            const newFormat = formatSelect.value;
            const newHomeAway = document.getElementById('tourney-home-away').checked;

            if (!newName) { alert('Informe o nome do torneio.'); return; }
            if (![8, 16, 32, 64].includes(newParticipants)) {
                alert('Número de participantes deve ser 8, 16, 32 ou 64.');
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
                
                // If it's the first load, populate inputs
                if (isNew || document.activeElement.tagName !== 'INPUT') {
                    if (document.getElementById('tourney-name')) document.getElementById('tourney-name').value = tournamentState.name || '';
                    if (participantsInput) participantsInput.value = tournamentState.participants || 8;
                    if (formatSelect) formatSelect.value = tournamentState.format || 'grupos-mata-mata';
                    if (document.getElementById('tourney-home-away')) document.getElementById('tourney-home-away').checked = !!tournamentState.homeAway;
                    
                    const n = tournamentState.participants || 8;
                    const phaseMap = { 8: 3, 16: 4, 32: 5, 64: 6 };
                    if (phasesInfo) phasesInfo.textContent = `${phaseMap[n] || 3} fases`;
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
                    repechageRound.push({ p1, p2 });
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
                    roundMatches.push({ p1, p2 });
                    nextRoundPlayers.push(`Vencedor ${roundName} ${m/2 + 1}`);
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
                let bracketHTML = `<div class="bracket-container${isPreview ? ' preview-mode' : ''}">
                                    ${isPreview ? '<div class="preview-badge">PREVIEW</div>' : ''}`;
                
                if (tournamentState.knockout.repechage && tournamentState.knockout.repechage.length > 0) {
                    bracketHTML += `<div class="bracket-round"><div class="bracket-round-title">Repescagem</div>`;
                    tournamentState.knockout.repechage.forEach(match => {
                        bracketHTML += `
                            <div class="bracket-match">
                                <div class="bracket-slot">
                                    <span class="player-name-clickable" onclick="openPlayerProfile('${match.p1}')">${match.p1}</span>
                                    <span>—</span>
                                </div>
                                <div class="bracket-slot">
                                    <span class="player-name-clickable" onclick="openPlayerProfile('${match.p2}')">${match.p2}</span>
                                    <span>—</span>
                                </div>
                            </div>`;
                    });
                    bracketHTML += `</div>`;
                }

                if (tournamentState.knockout.rounds) {
                    tournamentState.knockout.rounds.forEach(round => {
                        bracketHTML += `<div class="bracket-round"><div class="bracket-round-title">${round.name}</div>`;
                        round.matches.forEach(match => {
                            bracketHTML += `
                                <div class="bracket-match">
                                    <div class="bracket-slot">
                                        <span class="player-name-clickable" onclick="openPlayerProfile('${match.p1}')">${match.p1}</span>
                                        <span>—</span>
                                    </div>
                                    <div class="bracket-slot">
                                        <span class="player-name-clickable" onclick="openPlayerProfile('${match.p2}')">${match.p2}</span>
                                        <span>—</span>
                                    </div>
                                </div>`;
                        });
                        bracketHTML += `</div>`;
                    });
                }
                
                bracketHTML += `</div>`;
                mataMataContainer.innerHTML = bracketHTML;
            } else {
                mataMataContainer.innerHTML = `<div class="empty-state"><i class="ph ph-tree-structure"></i><h3>Mata-Mata desativado</h3><p>O formato atual não inclui eliminatórias.</p></div>`;
            }
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

            // ===== 2. GERAR CÓDIGOS POR PARTICIPANTE =====
            const newCodes = [];
            const existingSet = new Set();

            for (let i = 0; i < participants; i++) {
                let code;
                do {
                    const num = String(Math.floor(1000 + Math.random() * 9000));
                    code = 'F' + num;
                } while (existingSet.has(code));
                existingSet.add(code);
                newCodes.push({ code, used: false });
            }

            tournamentState.codes = newCodes;
            renderCodes(newCodes);

            // ===== 3. SALVAR TUDO NO FIREBASE =====
            if (db) {
                try {
                    await set(ref(db, 'tournaments/current'), tournamentState);
                    await set(ref(db, 'tournaments/' + tourneyCode), tournamentState);
                    await set(ref(db, 'codes/pool'), { codes: newCodes });
                    console.log(`✅ Torneio ${tourneyCode} ATIVADO com 32 códigos!`);
                } catch(e) {
                    console.error("Erro ao salvar:", e);
                    alert('Erro ao salvar no Firebase.');
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
        window.openPlayerProfile = openPlayerProfile; // Make it global
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

            // 2. Simular/Calcular estatísticas (Aqui você pode buscar do histórico real futuramente)
            // Por enquanto, usaremos valores padrão ou do histórico se existir
            const stats = {
                nome: pData ? pData.nome : playerName,
                username: pData ? `@${pData.nick || pData.nome.split(' ')[0].toLowerCase()}` : '@atleta',
                foto: pData && pData.photo ? pData.photo : `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerName}`,
                trofeus: 0, finals: 0, semis: 0,
                jogos: 0, vitorias: 0, empates: 0, derrotas: 0, gols: 0, golsSofridos: 0
            };

            // 3. Renderizar o card (Inspirado no perfil.js)
            const saldo = stats.gols - stats.golsSofridos;
            let saldoClass = saldo > 0 ? 'saldo-pos' : (saldo < 0 ? 'saldo-neg' : 'saldo-neu');

            perfilTarget.innerHTML = `
                <div class="profile-card" style="margin: 0 auto; max-width: 100%;">
                    <div class="profile-header">
                        <div class="avatar-wrapper">
                            <img src="${stats.foto}" alt="">
                        </div>
                        <div class="profile-info">
                            <h1>${stats.nome}</h1>
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
                                <span class="stat-box-value">${saldo > 0 ? '+' : ''}${saldo}</span>
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
            if (db) {
                update(ref(db, 'tournaments/current'), { 
                    groups: tournamentState.groups, 
                    knockout: tournamentState.knockout,
                    updatedAt: new Date().toISOString()
                }).catch(e => console.error('Erro ao embaralhar:', e));
            }
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
            if (db) {
                try {
                    await update(ref(db, 'tournaments/current'), { 
                        knockout: tournamentState.knockout,
                        updatedAt: new Date().toISOString()
                    });
                    renderTournamentFromState();
                    alert('Chaveamento atualizado com os classificados dos grupos!');
                } catch (e) {
                    console.error('Erro ao atualizar chaveamento:', e);
                    alert('Erro ao salvar no Firebase.');
                }
            }
        },
        'btn-encerrar': () => {
            if (confirm('Deseja encerrar e salvar o torneio?')) {
                tournamentState.status = 'encerrado';
                tournamentState.updatedAt = new Date().toISOString();
                updateStatus('encerrado');
                top3Container.style.display = 'flex';
                
                if (db) {
                    update(ref(db, 'tournaments/current'), { status: 'encerrado', updatedAt: tournamentState.updatedAt });
                    if (tournamentState.tournamentCode) {
                        update(ref(db, 'tournaments/' + tournamentState.tournamentCode), { status: 'encerrado', updatedAt: tournamentState.updatedAt });
                    }
                }
            }
        },
        'btn-resetar': () => {
            if (confirm('⚠️ Resetar o torneio atual? Os dados serão perdidos.')) {
                groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Configure e gere o chaveamento para começar.</p></div>`;
                updateStatus('aguardando');
                prizeBanner.style.display = 'none';
                top3Container.style.display = 'none';
                tournamentState.groups = [];
                tournamentState.knockout = null;
                tournamentState.status = 'aguardando';
                tournamentState.tournamentCode = null;
                
                if (db) remove(ref(db, 'tournaments/current'));
            }
        },
        'btn-resetar-tudo': () => {
            if (confirm('🚨 ATENÇÃO: Isso vai apagar TUDO (torneio, códigos, histórico). Tem certeza?')) {
                if (db) {
                    Promise.all([
                        remove(ref(db, 'tournaments/current')),
                        remove(ref(db, 'codes/pool'))
                    ]).then(() => {
                        console.log('[Action] Full site reset — Firebase limpo');
                        location.reload();
                    }).catch(e => {
                        console.error('Erro ao resetar:', e);
                        location.reload();
                    });
                } else {
                    location.reload();
                }
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
        if (btn) btn.addEventListener('click', fn);
    });

    // ========== MOBILE SIDEBAR TOGGLE ==========
    const btnToggleOrganizer = document.getElementById('btn-toggle-organizer');
    const sidebar = document.getElementById('organizer-panel');
    
    if (btnToggleOrganizer && sidebar) {
        btnToggleOrganizer.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
        
        // Fechar ao clicar fora no mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1100 && sidebar.classList.contains('active')) {
                if (!sidebar.contains(e.target) && !btnToggleOrganizer.contains(e.target)) {
                    sidebar.classList.remove('active');
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
                
                // Persist
                if (db) {
                    await set(ref(db, 'tournaments/current'), tournamentState);
                }

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
