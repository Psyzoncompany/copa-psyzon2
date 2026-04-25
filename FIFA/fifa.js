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

    // ========== RENDER CODES (reusable) ==========
    function renderCodes(codesArray) {
        const codesList = document.getElementById('codes-list');
        if (!codesList) return;
        codesList.innerHTML = '';

        if (!codesArray || codesArray.length === 0) return;

        codesArray.forEach(c => {
            const item = document.createElement('div');
            item.className = 'code-item';
            item.innerHTML = `
                <span class="code-value">${c.code}</span>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="${c.used ? 'code-used' : 'code-available'}">${c.used ? 'Utilizado' : 'Disponível'}</span>
                    ${!c.used ? `<button class="code-copy-btn" data-code="${c.code}" title="Copiar código" style="background:none; border:1px solid rgba(22,163,74,0.2); border-radius:6px; padding:3px 6px; cursor:pointer; color:#16A34A; font-size:0.8rem; display:flex; align-items:center; transition:all 0.2s;"><i class="ph ph-copy"></i></button>` : ''}
                </div>
            `;
            // Copiar ao clicar
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
        const n = parseInt(participantsInput.value) || 0;
        const format = formatSelect ? formatSelect.value : 'grupos-mata-mata';
        
        if (n >= 2) {
            phasesInfo.textContent = `${Math.ceil(Math.log2(n))} fases`;
            
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

    // ========== FIREBASE REAL-TIME SYNC ==========
    if (db) {
        // --- Listener do Torneio ---
        onValue(ref(db, 'tournaments/current'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.val();
                tournamentState = data;
                
                // Se o torneio estiver rodando OU se for visão de visitante, renderiza
                if (data.status !== 'aguardando' || role !== 'organizador') {
                    renderTournamentFromState(false);
                    updateStatus(data.status);
                    
                    if(data.prize) {
                        prizeTitle.textContent = data.prize;
                        prizeBanner.style.display = 'flex';
                    } else {
                        prizeBanner.style.display = 'none';
                    }
                } else if (role === 'organizador') {
                    updatePreview();
                }
            } else {
                if (role !== 'organizador') {
                    groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Aguarde o organizador iniciar a partida.</p></div>`;
                    updateStatus('aguardando');
                    prizeBanner.style.display = 'none';
                } else {
                    updatePreview();
                }
            }
        });

        // --- Listener dos Códigos (persiste ao recarregar) ---
        onValue(ref(db, 'codes/pool'), (snap) => {
            if (snap.exists()) {
                const data = snap.val();
                const codesArray = data.codes || [];
                tournamentState.codes = codesArray;
                renderCodes(codesArray);
                console.log(`🔑 ${codesArray.length} códigos carregados do Firebase`);
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
        const showMataMata = format === 'mata-mata' || format === 'grupos-mata-mata';

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
            for (let i=0; i<G; i++) knockoutPlayers.push(showGroups ? `1º Grupo ${String.fromCharCode(65 + i)}` : `Classificado ${i+1}`);
            if (showGroups) knockoutPlayers = knockoutPlayers.concat(repechagePlayers);
            else {
                while(knockoutPlayers.length < K) knockoutPlayers.push(`A definir`);
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

    function renderTournamentFromState(isPreview = false) {
        // Groups
        groupsContainer.innerHTML = '';
        if (tournamentState.groups && tournamentState.groups.length > 0) {
            tournamentState.groups.forEach(group => {
                let rows = '';
                group.players.forEach((player, i) => {
                    const statusClass = i < 2 ? 'classified' : (i === 2 ? 'playoff' : 'possible-3rd');
                    const isMe = participantName && player.name === participantName;
                    const nameStyle = isMe ? 'color: #16A34A; font-weight: 800;' : '';
                    rows += `
                        <tr class="${statusClass}">
                            <td style="${nameStyle}">${isMe ? '✅ ' : ''}${player.name}</td>
                            <td>${player.j}</td><td>${player.v}</td><td>${player.e}</td><td>${player.d}</td>
                            <td>${player.gp}</td><td>${player.gc}</td><td>${player.sg}</td><td>${player.pts}</td>
                        </tr>`;
                });

                const card = document.createElement('div');
                card.className = 'group-card' + (isPreview ? ' preview-mode' : '');
                card.innerHTML = `
                    ${isPreview ? '<div class="preview-badge">PREVIEW</div>' : ''}
                    <div class="group-title">${group.name}</div>
                    <table class="group-table">
                        <thead>
                            <tr>
                                <th>Jogador</th>
                                <th>J</th><th>V</th><th>E</th><th>D</th>
                                <th>GP</th><th>GC</th><th>SG</th><th>PTS</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>`;
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
                                <div class="bracket-slot"><span>${match.p1}</span><span>—</span></div>
                                <div class="bracket-slot"><span>${match.p2}</span><span>—</span></div>
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
                                    <div class="bracket-slot"><span>${match.p1}</span><span>—</span></div>
                                    <div class="bracket-slot"><span>${match.p2}</span><span>—</span></div>
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

            // ===== 2. GERAR 32 CÓDIGOS =====
            const newCodes = [];
            const existingSet = new Set();

            for (let i = 0; i < 32; i++) {
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

    // ========== ACTION BUTTONS ==========
    const actions = {
        'btn-embaralhar': () => {
            if (!tournamentState.groups || tournamentState.groups.length === 0) return;
            
            // Coletar todos os jogadores atuais dos grupos
            let allPlayers = [];
            tournamentState.groups.forEach(g => {
                g.players.forEach(p => allPlayers.push({ name: p.name }));
            });
            
            // Embaralhar (Fisher-Yates)
            for (let i = allPlayers.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
            }
            
            // Reconstruir o chaveamento
            buildTournamentState(allPlayers, tournamentState.format);
            renderTournamentFromState(false);
            
            // Salvar no Firebase
            if (db) {
                update(ref(db, 'tournaments/current'), { 
                    groups: tournamentState.groups, 
                    knockout: tournamentState.knockout,
                    updatedAt: new Date().toISOString()
                }).catch(e => console.error('Erro ao embaralhar:', e));
            }
            
            console.log('[Action] Bracket shuffled');
        },
        'btn-atualizar': () => {
            console.log('[Action] Bracket refreshed');
            // Firebase: onSnapshot — will auto-update when connected
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
});
