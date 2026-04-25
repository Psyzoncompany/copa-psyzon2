/* ================================================
   FIFA DASHBOARD — Copa Psyzon
   Logic Controller (Firebase-Ready)
   ================================================ */

// ========== FIREBASE PLACEHOLDER ==========
// import { initializeApp } from "firebase/app";
// import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc } from "firebase/firestore";
// const firebaseConfig = { /* your config */ };
// const app = initializeApp(firebaseConfig);
// const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {

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

    // ========== DYNAMIC PHASES CALC & PREVIEW ==========
    if (participantsInput) {
        participantsInput.addEventListener('input', () => {
            const n = parseInt(participantsInput.value) || 0;
            if (n >= 2) {
                phasesInfo.textContent = `${Math.ceil(Math.log2(n))} fases`;
                generateGroups(n);
            } else {
                phasesInfo.textContent = '—';
                groupsContainer.innerHTML = `<div class="empty-state"><i class="ph ph-soccer-ball"></i><h3>Nenhum torneio ativo</h3><p>Configure e gere o chaveamento para começar.</p></div>`;
            }
        });
        
        // Inicializar a pré-visualização ao carregar
        const initialN = parseInt(participantsInput.value) || 8;
        if (initialN >= 2) {
            generateGroups(initialN);
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
            updateStatus('ativo');

            // Firebase: await setDoc(doc(db, 'tournaments', 'current'), tournamentState);
            console.log('[Firebase Ready] Tournament Data:', tournamentState);
        });
    }

    // ========== GENERATE GROUPS ==========
    function generateGroups(total) {
        const playersPerGroup = 4;
        const numGroups = Math.max(1, Math.ceil(total / playersPerGroup));
        groupsContainer.innerHTML = '';
        tournamentState.groups = [];

        for (let g = 0; g < numGroups; g++) {
            const letter = String.fromCharCode(65 + g);
            const count = Math.min(playersPerGroup, total - (g * playersPerGroup));
            const players = [];

            let rows = '';
            for (let p = 0; p < count; p++) {
                const playerNum = p + 1 + (g * playersPerGroup);
                const statusClass = p < 2 ? 'classified' : (p === 2 ? 'playoff' : 'possible-3rd');
                players.push({ name: `Jogador #${playerNum}`, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0 });

                rows += `
                    <tr class="${statusClass}">
                        <td>Jogador #${playerNum}</td>
                        <td>0</td><td>0</td><td>0</td><td>0</td>
                        <td>0</td><td>0</td><td>0</td><td>0</td>
                    </tr>`;
            }

            tournamentState.groups.push({ name: `Grupo ${letter}`, players });

            const card = document.createElement('div');
            card.className = 'group-card';
            card.innerHTML = `
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

            // Firebase: await updateDoc(doc(db, 'tournaments', 'current'), { prize: text });
            console.log('[Firebase Ready] Prize saved:', text);
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

            // Firebase: await setDoc(doc(db, 'codes', 'pool'), { codes: tournamentState.codes });
            console.log('[Firebase Ready] Codes generated:', tournamentState.codes);
        });
    }

    // ========== ACTION BUTTONS ==========
    const actions = {
        'btn-embaralhar': () => {
            if (tournamentState.groups.length === 0) return;
            generateGroups(tournamentState.participants);
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
                // Firebase: await updateDoc(doc(db, 'tournaments', 'current'), { status: 'encerrado' });
                console.log('[Action] Tournament ended and saved');
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
                // Firebase: await deleteDoc(doc(db, 'tournaments', 'current'));
                console.log('[Action] Tournament reset');
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
