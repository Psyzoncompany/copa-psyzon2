/* ================================================
   FIFA DASHBOARD — Copa Psyzon
   Logic Controller (Firebase-Ready)
   ================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyCL2u-oSlw8EWQ96atPI9Tc-0cIl2k9K6M",
  authDomain: "copa-psyzon2.firebaseapp.com",
  projectId: "copa-psyzon2",
  storageBucket: "copa-psyzon2.firebasestorage.app",
  messagingSenderId: "934292793843",
  appId: "1:934292793843:web:2f67fc6d314e1185f6ca86",
  measurementId: "G-G9Q14JE533"
};

let db = null;
let analytics = null;
try {
    if (firebaseConfig.apiKey !== "SUA_API_KEY") {
        const app = initializeApp(firebaseConfig);
        analytics = getAnalytics(app);
        db = getFirestore(app);
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

    const badge = document.getElementById('user-role-badge');
    const organizerPanel = document.getElementById('organizer-panel');

    badge.textContent = role.toUpperCase();

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
        top3: { first: '—', second: '—', third: '—' },
        createdAt: null,
    };

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
            generatePreviewStructure(n, format);
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
        onSnapshot(doc(db, 'tournaments', 'current'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                tournamentState = data;
                
                // Se o torneio estiver rodando OU se for visão de visitante, renderiza
                if (data.status !== 'aguardando' || role !== 'organizador') {
                    renderGroupsFromState();
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
    } else {
        // Fallback local
        if (role === 'organizador') updatePreview();
    }

    function renderGroupsFromState() {
        groupsContainer.innerHTML = '';
        if (!tournamentState.groups || tournamentState.groups.length === 0) return;

        tournamentState.groups.forEach(group => {
            let rows = '';
            group.players.forEach((player, i) => {
                const statusClass = i < 2 ? 'classified' : (i === 2 ? 'playoff' : 'possible-3rd');
                rows += `
                    <tr class="${statusClass}">
                        <td>${player.name}</td>
                        <td>${player.j}</td><td>${player.v}</td><td>${player.e}</td><td>${player.d}</td>
                        <td>${player.gp}</td><td>${player.gc}</td><td>${player.sg}</td><td>${player.pts}</td>
                    </tr>`;
            });

            const card = document.createElement('div');
            card.className = 'group-card';
            card.innerHTML = `
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

    // ========== GENERATE BRACKET ==========
    const btnGerar = document.getElementById('btn-gerar-chaveamento');
    if (btnGerar) {
        btnGerar.addEventListener('click', () => {
            const name = document.getElementById('tourney-name').value || 'Copa Psyzon FIFA';
            const participants = parseInt(participantsInput.value) || 8;
            const format = document.getElementById('tourney-format').value;
            const homeAway = document.getElementById('tourney-home-away').checked;

            tournamentState.name = name;
            tournamentState.participants = participants;
            tournamentState.format = format;
            tournamentState.homeAway = homeAway;
            tournamentState.status = 'ativo';
            tournamentState.createdAt = new Date().toISOString();

            generateGroups(participants);
            renderGroupsFromState(); // Renderiza visualmente o que gerou
            updateStatus('ativo');

            // Sincronizar com Firebase
            if (db) {
                setDoc(doc(db, 'tournaments', 'current'), tournamentState)
                    .then(() => console.log('Torneio salvo no Firebase!'))
                    .catch(e => console.error("Erro ao salvar:", e));
            } else {
                console.log('[Local] Tournament Data:', tournamentState);
            }
        });
    }

    // ========== GENERATE GROUPS (STATE ONLY) ==========
    function generateGroups(total) {
        const playersPerGroup = 4;
        const numGroups = Math.max(1, Math.ceil(total / playersPerGroup));
        tournamentState.groups = [];

        for (let g = 0; g < numGroups; g++) {
            const letter = String.fromCharCode(65 + g);
            const count = Math.min(playersPerGroup, total - (g * playersPerGroup));
            const players = [];

            for (let p = 0; p < count; p++) {
                const playerNum = p + 1 + (g * playersPerGroup);
                players.push({ name: `Jogador #${playerNum}`, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0 });
            }

            tournamentState.groups.push({ name: `Grupo ${letter}`, players });
        }
    }

    // ========== GENERATE PREVIEW STRUCTURE ==========
    function generatePreviewStructure(total, format) {
        const showGroups = format === 'grupos' || format === 'grupos-mata-mata';
        const showMataMata = format === 'mata-mata' || format === 'grupos-mata-mata';
        
        // --- Grupos Preview ---
        if (showGroups) {
            const playersPerGroup = 4;
            const numGroups = Math.max(1, Math.ceil(total / playersPerGroup));
            groupsContainer.innerHTML = '';
            
            for (let g = 0; g < numGroups; g++) {
                const letter = String.fromCharCode(65 + g);
                const count = Math.min(playersPerGroup, total - (g * playersPerGroup));
                
                let rows = '';
                for (let p = 0; p < count; p++) {
                    const playerNum = p + 1 + (g * playersPerGroup);
                    rows += `
                        <tr>
                            <td>A definir (Slot ${playerNum})</td>
                            <td>—</td><td>—</td><td>—</td><td>—</td>
                            <td>—</td><td>—</td><td>—</td><td>—</td>
                        </tr>`;
                }

                const card = document.createElement('div');
                card.className = 'group-card preview-mode';
                card.innerHTML = `
                    <div class="preview-badge">PREVIEW</div>
                    <div class="group-title">Grupo ${letter}</div>
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
            }
        } else {
            groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Fase de Grupos desativada</h3><p>O formato atual não inclui grupos.</p></div>`;
        }

        // --- Mata-Mata Preview ---
        const mataMataContainer = document.getElementById('tab-mata-mata');
        if (mataMataContainer) {
            if (showMataMata) {
                let power = Math.pow(2, Math.ceil(Math.log2(total)));
                if (power < 2) power = 2;
                let roundsCount = Math.log2(power);
                
                let bracketHTML = `<div class="bracket-container preview-mode">
                                    <div class="preview-badge">PREVIEW</div>`;
                                    
                for (let r = 0; r < roundsCount; r++) {
                    let matchesInRound = power / Math.pow(2, r + 1);
                    let roundName = matchesInRound === 1 ? 'Final' : (matchesInRound === 2 ? 'Semifinal' : (matchesInRound === 4 ? 'Quartas de Final' : `Fase de ${matchesInRound*2}`));
                    
                    let matchesHTML = '';
                    for (let m = 0; m < matchesInRound; m++) {
                        matchesHTML += `
                            <div class="bracket-match">
                                <div class="bracket-slot"><span>A definir</span><span>—</span></div>
                                <div class="bracket-slot"><span>A definir</span><span>—</span></div>
                            </div>`;
                    }
                    
                    bracketHTML += `
                        <div class="bracket-round">
                            <div class="bracket-round-title">${roundName}</div>
                            ${matchesHTML}
                        </div>`;
                }
                bracketHTML += `</div>`;
                mataMataContainer.innerHTML = bracketHTML;
            } else {
                mataMataContainer.innerHTML = `<div class="empty-state"><i class="ph ph-tree-structure"></i><h3>Mata-Mata desativado</h3><p>O formato atual não inclui eliminatórias.</p></div>`;
            }
        }
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
                updateDoc(doc(db, 'tournaments', 'current'), { prize: text })
                    .catch(e => console.error("Erro Prêmio:", e));
            }
        });
    }

    // ========== GENERATE CODES ==========
    const btnGerarCodigos = document.getElementById('btn-gerar-codigos');
    const codesList = document.getElementById('codes-list');

    if (btnGerarCodigos) {
        btnGerarCodigos.addEventListener('click', () => {
            codesList.innerHTML = '';
            tournamentState.codes = [];

            for (let i = 0; i < 32; i++) {
                const code = String(Math.floor(1000 + Math.random() * 9000));
                tournamentState.codes.push({ code, used: false });

                const item = document.createElement('div');
                item.className = 'code-item';
                item.innerHTML = `
                    <span class="code-value">${code}</span>
                    <span class="code-available">Disponível</span>
                    <button class="code-regen" title="Regenerar"><i class="ph ph-arrows-clockwise"></i></button>
                `;
                codesList.appendChild(item);
            }

            document.querySelector('.status-available').textContent = '32 disponíveis';
            document.querySelector('.status-used').textContent = '0 utilizados';

            // Sincronizar códigos
            if (db) {
                setDoc(doc(db, 'codes', 'pool'), { codes: tournamentState.codes })
                    .catch(e => console.error("Erro Códigos:", e));
            }
        });
    }

    // ========== ACTION BUTTONS ==========
    const actions = {
        'btn-embaralhar': () => {
            if (tournamentState.groups.length === 0 && tournamentState.status === 'aguardando') return;
            generateGroups(tournamentState.participants);
            renderGroupsFromState();
            console.log('[Action] Bracket shuffled');
        },
        'btn-atualizar': () => {
            console.log('[Action] Bracket refreshed');
            // Firebase: onSnapshot — will auto-update when connected
        },
        'btn-encerrar': () => {
            if (confirm('Deseja encerrar e salvar o torneio?')) {
                tournamentState.status = 'encerrado';
                updateStatus('encerrado');
                top3Container.style.display = 'flex';
                
                if (db) updateDoc(doc(db, 'tournaments', 'current'), { status: 'encerrado' });
            }
        },
        'btn-resetar': () => {
            if (confirm('⚠️ Resetar o torneio atual? Os dados serão perdidos.')) {
                groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Configure e gere o chaveamento para começar.</p></div>`;
                updateStatus('aguardando');
                prizeBanner.style.display = 'none';
                top3Container.style.display = 'none';
                tournamentState.groups = [];
                tournamentState.status = 'aguardando';
                
                if (db) deleteDoc(doc(db, 'tournaments', 'current'));
            }
        },
        'btn-resetar-tudo': () => {
            if (confirm('🚨 ATENÇÃO: Isso vai apagar TUDO (torneio, códigos, histórico). Tem certeza?')) {
                location.reload();
                // Firebase: batch delete all collections
                console.log('[Action] Full site reset');
            }
        },
    };

    Object.entries(actions).forEach(([id, fn]) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', fn);
    });

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

    // ========== MOBILE SIDEBAR TOGGLE ==========
    const btnToggle = document.getElementById('btn-toggle-organizer');
    const sidebar = document.querySelector('.sidebar');
    
    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && e.target !== btnToggle) {
                sidebar.classList.remove('active');
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        });
    }

    // ========== VER CLIENTES ==========
    const btnClientes = document.getElementById('btn-ver-clientes');
    if (btnClientes) {
        btnClientes.addEventListener('click', () => {
            alert('Módulo de fichas dos clientes em desenvolvimento.');
            // Future: open modal or navigate to clients page
        });
    }
});
