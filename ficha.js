import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, onValue, remove, set, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

const fichasGrid = document.getElementById('fichas-grid');
const searchInput = document.getElementById('search-input');
const statTotal = document.getElementById('stat-total');
const statCodesUsed = document.getElementById('stat-codes-used');
const statCodesAvail = document.getElementById('stat-codes-avail');

let allParticipants = [];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeParticipant(raw = {}) {
    return {
        id: raw.id || raw.participantId || raw.cpf || '',
        nome: raw.nome || raw.name || 'Sem nome',
        nick: raw.nick || '',
        cpf: raw.cpf || '',
        whats: raw.whatsapp || raw.whats || '',
        insta: raw.instagram || raw.insta || '',
        countryCode: (raw.countryCode || 'br').toLowerCase(),
        photo: raw.photoUrl || raw.photo || raw.fotoURL || null,
        createdAt: raw.createdAt || null
    };
}

// ========== FLAG MAP ==========
const flagNames = {
    br: 'Brasil', ar: 'Argentina', fr: 'França', de: 'Alemanha',
    es: 'Espanha', gb: 'Inglaterra', it: 'Itália', pt: 'Portugal',
    nl: 'Holanda', uy: 'Uruguai'
};

// ========== MASK CPF for display ==========
function maskCpf(cpf) {
    if (!cpf || cpf.length !== 11) return cpf || '---';
    return `${cpf.slice(0,3)}.${cpf.slice(3,6)}.${cpf.slice(6,9)}-${cpf.slice(9)}`;
}

// ========== RENDER ==========
function renderFichas(list) {
    fichasGrid.innerHTML = '';

    if (!list || list.length === 0) {
        fichasGrid.innerHTML = `
            <div class="ficha-empty">
                <i class="ph ph-user-circle-minus"></i>
                <h3>Nenhum participante encontrado</h3>
                <p>Os jogadores cadastrados aparecerão aqui.</p>
            </div>`;
        return;
    }

    list.map(normalizeParticipant).forEach(p => {
        const card = document.createElement('div');
        card.className = 'ficha-card';

        const avatarContent = p.photo
            ? `<img src="${p.photo}" alt="${escapeHtml(p.nome)}">`
            : `<i class="ph-fill ph-user"></i>`;

        const flagCode = (p.countryCode || 'br').toLowerCase();
        const flagName = flagNames[flagCode] || flagCode.toUpperCase();

        const createdDate = p.createdAt
            ? new Date(p.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';

        card.innerHTML = `
            <div class="ficha-card-header">
                <div class="ficha-avatar">${avatarContent}</div>
                <div class="ficha-name-block">
                    <div class="ficha-name">${escapeHtml(p.nome || 'Sem nome')}</div>
                    <div class="ficha-nick">${escapeHtml(p.nick || 'Sem nick')}</div>
                </div>
                <div class="ficha-flag-badge">
                    <img src="https://flagcdn.com/24x18/${flagCode}.png" alt="${flagName}">
                    ${escapeHtml(flagName)}
                </div>
                <button class="btn-delete-ficha" data-cpf="${p.cpf}" title="Apagar Cadastro">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
            <div class="ficha-details">
                <div class="ficha-detail">
                    <i class="ph ph-identification-card"></i>
                    <strong>${maskCpf(p.cpf)}</strong>
                </div>
                <div class="ficha-detail">
                    <i class="ph ph-whatsapp-logo"></i>
                    <span>${escapeHtml(p.whats || '—')}</span>
                </div>
                <div class="ficha-detail">
                    <i class="ph ph-instagram-logo"></i>
                    <span>${escapeHtml(p.insta || '—')}</span>
                </div>
                <div class="ficha-date">Cadastrado em: ${createdDate}</div>
            </div>
        `;

        // Action: Delete Ficha
        const deleteBtn = card.querySelector('.btn-delete-ficha');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const cpf = deleteBtn.dataset.cpf;
                const participantId = p.id || cpf;
                if (!participantId) return;

                if (confirm(`🚨 ATENÇÃO: Deseja apagar permanentemente o cadastro de ${p.nome}?\n\nIsso removerá o jogador do sistema, liberará o código de acesso e o removerá de torneios ativos.`)) {
                    try {
                        // 1. Remover de participants/
                        await remove(ref(db, 'participants/' + participantId));

                        // 2. Liberar código em codes/pool
                        const poolSnap = await get(ref(db, 'codes/pool'));
                        if (poolSnap.exists()) {
                            const poolData = poolSnap.val();
                            const codes = poolData.codes || [];
                            const updatedCodes = codes.map(c => {
                                if (c.usedBy === participantId || c.participantId === participantId) {
                                    return { ...c, status: 'available', used: false, usedBy: null, participantId: null, usedAt: null };
                                }
                                return c;
                            });
                            await update(ref(db, 'codes/pool'), { codes: updatedCodes });
                        }

                        // 3. Remover do torneio atual
                        const tRef = ref(db, 'tournaments/current');
                        const tSnap = await get(tRef);
                        if (tSnap.exists()) {
                            const tData = tSnap.val();
                            const regPlayers = tData.registeredPlayers || [];
                            const filtered = regPlayers.filter(pl => pl.id !== participantId);
                            if (filtered.length !== regPlayers.length) {
                                await update(tRef, { registeredPlayers: filtered });
                            }
                        }

                        alert('Cadastro removido com sucesso!');
                    } catch (e) {
                        console.error('Erro ao deletar ficha:', e);
                        alert('Erro ao processar remoção.');
                    }
                }
            });
        }

        fichasGrid.appendChild(card);
    });
}

// ========== SEARCH ==========
searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
        renderFichas(allParticipants);
        return;
    }
    const filtered = allParticipants.filter(p => {
        return (p.nome && p.nome.toLowerCase().includes(q)) ||
               (p.nick && p.nick.toLowerCase().includes(q)) ||
               (p.cpf && p.cpf.includes(q.replace(/\D/g, '')));
    });
    renderFichas(filtered);
});

// ========== LOAD PARTICIPANTS (real-time) ==========
onValue(ref(db, 'participants'), (snap) => {
    allParticipants = [];
    if (snap.exists()) {
        snap.forEach(child => {
            allParticipants.push(child.val());
        });
    }

    // Sort by name
    allParticipants.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    statTotal.textContent = allParticipants.length;
    renderFichas(allParticipants);
});

// ========== LOAD CODES STATS ==========
onValue(ref(db, 'codes/pool'), (snap) => {
    if (snap.exists()) {
        const data = snap.val();
        const codes = data.codes || [];
        const used = codes.filter(c => c.used).length;
        const avail = codes.filter(c => !c.used).length;
        statCodesUsed.textContent = used;
        statCodesAvail.textContent = avail;
    } else {
        statCodesUsed.textContent = '0';
        statCodesAvail.textContent = '0';
    }
});
