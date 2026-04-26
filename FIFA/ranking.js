import { ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

export function initRankingSystem(db, role) {
    if (!db) {
        console.warn("Ranking System: No db provided.");
        return;
    }

    // Role visibility
    if (role === 'organizador') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
    }

    // ----- UI ELEMENTS -----
    const importFileInput = document.getElementById('import-file');
    const importModality = document.getElementById('import-modality');
    const btnPreviewImport = document.getElementById('btn-preview-import');
    const importPreviewArea = document.getElementById('import-preview-area');
    
    const rankingModalityFilter = document.getElementById('ranking-modality-filter');
    const rankingTbody = document.getElementById('ranking-tbody');
    const rankingHighlights = document.getElementById('ranking-highlights');
    const rankingCards = document.getElementById('ranking-cards');
    const customCupRankingUI = !!document.getElementById('ranking-view-current');

    let currentParsedData = null;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ----- IMPORT LOGIC -----
    if (btnPreviewImport && importFileInput) {
        btnPreviewImport.addEventListener('click', () => {
            const file = importFileInput.files[0];
            if (!file) {
                alert("Selecione um arquivo JSON primeiro.");
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const json = JSON.parse(e.target.result);
                    previewImport(json, importModality.value);
                } catch (err) {
                    console.error("Erro ao ler JSON:", err);
                    alert("O arquivo não é um JSON válido.");
                }
            };
            reader.readAsText(file);
        });
    }

    function previewImport(json, modality) {
        if (!json.groups && !json.standings && !json.teams) {
            importPreviewArea.innerHTML = `<div style="color: #ef4444;"><i class="ph ph-warning"></i> Formato de JSON incompatível. Faltam grupos ou times.</div>`;
            importPreviewArea.style.display = 'block';
            return;
        }

        const name = json.tournamentName || "Torneio Desconhecido";
        let playersMap = new Map();
        let matchesCount = 0;

        if (json.groups) {
            json.groups.forEach(g => {
                if (g.standings) {
                    g.standings.forEach(p => {
                        playersMap.set(p.id || p.playerName, p);
                    });
                }
                if (g.matches) matchesCount += g.matches.length;
            });
        }

        currentParsedData = {
            raw: json,
            modality: modality,
            name: name,
            players: Array.from(playersMap.values()),
            matchesCount: matchesCount
        };

        let playerOptions = '<option value="">Não registrar (Nenhum)</option>';
        currentParsedData.players.forEach(p => {
            playerOptions += `<option value="${p.id || p.playerName}">${p.playerName} (${p.teamName})</option>`;
        });

        importPreviewArea.innerHTML = `
            <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px;">
                <h4 style="margin: 0 0 10px 0; color: #fff;">Resumo: ${name}</h4>
                <ul style="list-style: none; padding: 0; margin: 0 0 15px 0; color: rgba(255,255,255,0.7); display: grid; gap: 8px;">
                    <li><i class="ph ph-users"></i> Participantes encontrados: <strong>${currentParsedData.players.length}</strong></li>
                    <li><i class="ph ph-soccer-ball"></i> Partidas: <strong>${matchesCount}</strong></li>
                    <li><i class="ph ph-game-controller"></i> Modalidade: <strong style="text-transform: uppercase;">${modality}</strong></li>
                </ul>
                
                <h4 style="margin: 20px 0 10px 0; color: #fff; font-size:14px;">Atribuir Títulos (Opcional)</h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom: 20px;">
                    <div>
                        <label style="font-size:12px; color:#facc15;">🏆 Campeão</label>
                        <select id="import-champ" class="form-control" style="padding: 8px; font-size:12px;">${playerOptions}</select>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#cbd5e1;">🥈 Vice-Campeão</label>
                        <select id="import-vice" class="form-control" style="padding: 8px; font-size:12px;">${playerOptions}</select>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8;">Semifinalista 1</label>
                        <select id="import-semi1" class="form-control" style="padding: 8px; font-size:12px;">${playerOptions}</select>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8;">Semifinalista 2</label>
                        <select id="import-semi2" class="form-control" style="padding: 8px; font-size:12px;">${playerOptions}</select>
                    </div>
                </div>

                <button class="btn btn-primary" id="btn-confirm-ranking-import" style="width: 100%; background: #22c55e;">
                    <i class="ph-bold ph-check"></i> Confirmar e Importar para o Ranking
                </button>
            </div>
        `;
        importPreviewArea.style.display = 'block';

        document.getElementById('btn-confirm-ranking-import').addEventListener('click', executeImport);
    }

    async function executeImport() {
        if (!currentParsedData) return;
        
        const btn = document.getElementById('btn-confirm-ranking-import');
        btn.disabled = true;
        btn.textContent = "Importando...";

        const champId = document.getElementById('import-champ').value;
        const viceId = document.getElementById('import-vice').value;
        const semi1Id = document.getElementById('import-semi1').value;
        const semi2Id = document.getElementById('import-semi2').value;

        const safeName = (currentParsedData.name || 'torneio').replace(/\s+/g, '_').toLowerCase();
        const dateKey = new Date().toISOString().slice(0, 10);
        const importId = `${safeName}_${currentParsedData.modality}_${dateKey}`;
        
        try {
            // Check if already imported
            const importRef = ref(db, 'imports/' + importId);
            const importSnap = await get(importRef);
            if (importSnap.exists()) {
                alert("Este torneio já foi importado anteriormente.");
                btn.disabled = false;
                btn.textContent = "Confirmar e Importar";
                return;
            }

            // Process players
            for (const p of currentParsedData.players) {
                const playerId = p.id || p.playerName.replace(/\s+/g, '').toLowerCase();
                const playerRef = ref(db, 'players/' + playerId);
                const pSnap = await get(playerRef);

                let pd = {
                    id: playerId,
                    name: p.playerName || "Desconhecido",
                    nick: p.teamName || "",
                    flagId: p.flagId || "br",
                    stats: {}
                };

                if (pSnap.exists()) {
                    pd = pSnap.val();
                    if(!pd.stats) pd.stats = {};
                }

                const mod = currentParsedData.modality;
                if (!pd.stats[mod]) {
                    pd.stats[mod] = { j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0, titles: 0, finals: 0, semifinals: 0, participations: 0 };
                }

                let s = pd.stats[mod];
                s.j += p.played || 0;
                s.v += p.wins || 0;
                s.e += p.draws || 0;
                s.d += p.losses || 0;
                s.gp += p.goalsFor || 0;
                s.gc += p.goalsAgainst || 0;
                
                let diff = p.goalDiff !== undefined ? p.goalDiff : ((p.goalsFor || 0) - (p.goalsAgainst || 0));
                s.sg += diff;
                
                let points = p.points !== undefined ? p.points : ((p.wins || 0) * 3 + (p.draws || 0));
                s.pts += points;
                
                s.participations += 1;

                // Títulos Manuais
                if (playerId === champId) {
                    s.titles = (s.titles || 0) + 1;
                    s.finals = (s.finals || 0) + 1;
                    s.semifinals = (s.semifinals || 0) + 1;
                } else if (playerId === viceId) {
                    s.finals = (s.finals || 0) + 1;
                    s.semifinals = (s.semifinals || 0) + 1;
                } else if (playerId === semi1Id || playerId === semi2Id) {
                    s.semifinals = (s.semifinals || 0) + 1;
                }
                
                await set(playerRef, pd);
            }

            // Save import record
            await set(importRef, {
                id: importId,
                name: currentParsedData.name,
                modality: currentParsedData.modality,
                playersCount: currentParsedData.players.length,
                matchesCount: currentParsedData.matchesCount,
                importedAt: new Date().toISOString()
            });

            alert("Torneio importado com sucesso!");
            importPreviewArea.innerHTML = `<div style="color: #22c55e;"><i class="ph ph-check-circle"></i> Importação concluída. O Ranking foi atualizado.</div>`;
            
            // Reload Ranking
            loadRanking(rankingModalityFilter.value);
            loadImportHistory();

        } catch (e) {
            console.error("Erro na importação:", e);
            alert("Ocorreu um erro ao importar os dados.");
            btn.disabled = false;
            btn.textContent = "Tentar Novamente";
        }
    }

    // ----- RANKING LOGIC -----
    async function loadRanking(modality) {
        rankingTbody.innerHTML = `<tr><td colspan="12" style="text-align:center;">Carregando ranking...</td></tr>`;
        
        try {
            const snap = await get(ref(db, 'players'));
            let playersList = [];
            
            if (snap.exists()) {
                snap.forEach(childSnap => {
                    let p = childSnap.val();
                    if (!p.stats) return;

                let statsToUse = { j:0, v:0, e:0, d:0, gp:0, gc:0, sg:0, pts:0, titles:0, finals:0 };
                
                if (modality === 'geral') {
                    // Soma todas as modalidades
                    Object.values(p.stats).forEach(s => {
                        statsToUse.j += s.j || 0;
                        statsToUse.v += s.v || 0;
                        statsToUse.e += s.e || 0;
                        statsToUse.d += s.d || 0;
                        statsToUse.gp += s.gp || 0;
                        statsToUse.gc += s.gc || 0;
                        statsToUse.sg += s.sg || 0;
                        statsToUse.pts += s.pts || 0;
                        statsToUse.titles += s.titles || 0;
                        statsToUse.finals += s.finals || 0;
                    });
                } else {
                    if (p.stats[modality]) {
                        statsToUse = p.stats[modality];
                    } else {
                        return; // O jogador não tem dados nessa modalidade
                    }
                }

                if (statsToUse.j > 0) {
                    playersList.push({
                        ...p,
                        currentStats: statsToUse,
                        aprov: statsToUse.j > 0 ? ((statsToUse.pts / (statsToUse.j * 3)) * 100).toFixed(1) : 0
                    });
                }
                });
            }

            // Ordenação: 1.Pontos, 2.Vitórias, 3.Saldo, 4.Gols Pró, 5.Menos Gols Contra, 6.Nome
            playersList.sort((a, b) => {
                if (b.currentStats.pts !== a.currentStats.pts) return b.currentStats.pts - a.currentStats.pts;
                if (b.currentStats.v !== a.currentStats.v) return b.currentStats.v - a.currentStats.v;
                if (b.currentStats.sg !== a.currentStats.sg) return b.currentStats.sg - a.currentStats.sg;
                if (b.currentStats.gp !== a.currentStats.gp) return b.currentStats.gp - a.currentStats.gp;
                if (a.currentStats.gc !== b.currentStats.gc) return a.currentStats.gc - b.currentStats.gc;
                return (a.name || '').localeCompare(b.name || '', 'pt-BR');
            });

            renderRanking(playersList);

        } catch (e) {
            console.error("Erro ao carregar ranking", e);
            rankingTbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:#ef4444;">Erro ao carregar o ranking.</td></tr>`;
        }
    }

    function renderRanking(list) {
        if (list.length === 0) {
            rankingTbody.innerHTML = `<tr><td colspan="12" style="text-align:center;">Nenhum jogador encontrado.</td></tr>`;
            rankingHighlights.innerHTML = '';
            if (rankingCards) rankingCards.innerHTML = '';
            return;
        }

        let html = '';
        list.forEach((p, i) => {
            const s = p.currentStats;
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : i + 1));
            
            html += `
                <tr>
                    <td style="font-weight:bold; color: #042D15;">${medal}</td>
                    <td style="text-align:left; display:flex; align-items:center; gap:12px;">
                        <div style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: #eee; flex-shrink: 0; border: 2px solid rgba(22,163,74,0.1); display: flex; align-items: center; justify-content: center;">
                            ${(p.photo || p.fotoURL) ? `<img src="${p.photo || p.fotoURL}" style="width:100%; height:100%; object-fit:cover;">` : `<img src="../imgs/svg-bandeiras/${(p.countryCode || 'br').toLowerCase()}.svg" style="width:100%; height:100%; object-fit:cover;">`}
                        </div>
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; color:#042D15;">${escapeHtml(formatName(p.name))}</span>
                        </div>
                    </td>
                    <td style="color:#D97706; font-weight:bold;">${s.titles > 0 ? s.titles : '-'}</td>
                    <td style="font-weight:bold; color:#042D15;">${s.pts}</td>
                    <td>${s.j}</td>
                    <td>${s.v}</td>
                    <td>${s.e}</td>
                    <td>${s.d}</td>
                    <td>${s.gp}</td>
                    <td>${s.gc}</td>
                    <td style="color:${s.sg > 0 ? '#16A34A' : (s.sg < 0 ? '#E63946' : '#042D15')}">${s.sg > 0 ? '+'+s.sg : s.sg}</td>
                    <td>${p.aprov}%</td>
                </tr>
            `;
        });

    function formatName(fullName) {
        if (!fullName) return '';
        const parts = fullName.trim().split(/\s+/);
        if (parts.length <= 2) return fullName;
        return `${parts[0]} ${parts[parts.length - 1]}`;
    }
        rankingTbody.innerHTML = html;

        if (rankingCards) {
            rankingCards.innerHTML = list.map((p, i) => {
                const s = p.currentStats;
                return `
                    <article class="ranking-player-card">
                        <div class="ranking-player-top">
                            <div class="ranking-player-position">#${i + 1}</div>
                            <strong>${escapeHtml(formatName(p.name))}</strong>
                            <span>${s.pts} pts</span>
                        </div>
                        <div class="ranking-player-stats">
                            <span class="ranking-chip">J: ${s.j}</span>
                            <span class="ranking-chip">V: ${s.v}</span>
                            <span class="ranking-chip">D: ${s.d}</span>
                            <span class="ranking-chip">GP: ${s.gp}</span>
                            <span class="ranking-chip">GC: ${s.gc}</span>
                            <span class="ranking-chip">SG: ${s.sg > 0 ? '+' : ''}${s.sg}</span>
                        </div>
                    </article>
                `;
            }).join('');
        }

        // Render Highlights
        const topScorer = [...list].sort((a,b) => b.currentStats.gp - a.currentStats.gp)[0];
        const topDefense = [...list].sort((a,b) => a.currentStats.gc - b.currentStats.gc)[0]; // Menos gols sofridos
        
        rankingHighlights.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <div style="background: rgba(217,119,6,0.1); padding: 15px; border-radius: 16px; border: 1px solid rgba(217,119,6,0.15); backdrop-filter: blur(8px);">
                    <div style="font-size:12px; color:#D97706; font-weight:bold; margin-bottom:5px; text-transform:uppercase; letter-spacing:0.5px;">MAIOR CAMPEÃO</div>
                    <div style="color:#042D15; font-size:18px; font-weight:800;">${escapeHtml(formatName(list[0].name))}</div>
                    <div style="color:#51715C; font-size:13px;">${list[0].currentStats.titles} Títulos / ${list[0].currentStats.pts} PTS</div>
                </div>
                <div style="background: rgba(13,110,253,0.08); padding: 15px; border-radius: 16px; border: 1px solid rgba(13,110,253,0.12); backdrop-filter: blur(8px);">
                    <div style="font-size:12px; color:#0D6EFD; font-weight:bold; margin-bottom:5px; text-transform:uppercase; letter-spacing:0.5px;">MÁQUINA DE GOLS</div>
                    <div style="color:#042D15; font-size:18px; font-weight:800;">${escapeHtml(formatName(topScorer.name))}</div>
                    <div style="color:#51715C; font-size:13px;">${topScorer.currentStats.gp} Gols Marcados</div>
                </div>
                <div style="background: rgba(22,163,74,0.08); padding: 15px; border-radius: 16px; border: 1px solid rgba(22,163,74,0.12); backdrop-filter: blur(8px);">
                    <div style="font-size:12px; color:#16A34A; font-weight:bold; margin-bottom:5px; text-transform:uppercase; letter-spacing:0.5px;">MELHOR DEFESA</div>
                    <div style="color:#042D15; font-size:18px; font-weight:800;">${escapeHtml(formatName(topDefense.name))}</div>
                    <div style="color:#51715C; font-size:13px;">Apenas ${topDefense.currentStats.gc} Gols Sofridos</div>
                </div>
            </div>
        `;
    }

    if (rankingModalityFilter && !customCupRankingUI) {
        rankingModalityFilter.addEventListener('change', (e) => {
            loadRanking(e.target.value);
        });
    }

    // ----- IMPORT HISTORY -----
    async function loadImportHistory() {
        const container = document.getElementById('imported-tournaments-list');
        const historyModal = document.getElementById('modal-history-details');
        const historyDetailsContent = document.getElementById('history-details-content');
        if(!container) return;

        try {
            const snap = await get(ref(db, 'imports'));
            if(!snap.exists()) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-clock-counter-clockwise"></i>
                        <h3>Nenhum histórico</h3>
                        <p>Os torneios finalizados e importados aparecerão aqui.</p>
                    </div>`;
                return;
            }

            let html = '';
            snap.forEach(childSnap => {
                const d = childSnap.val();
                const isHistory = d.type === 'tournament-history';
                const title = d.name || d.tournamentName || 'Torneio';
                const modality = (d.modality || d.tournamentType || 'fifa').toUpperCase();
                const playersCount = d.playersCount || (d.participants ? d.participants.length : 0);
                const matchesCount = d.matchesCount || (d.results?.groups ? d.results.groups.length : 0);
                const date = d.importedAt || d.finishedAt || d.createdAt;
                html += `
                    <div class="group-card" style="display:flex; justify-content:space-between; align-items:center; padding: 15px;">
                        <div>
                            <h4 style="margin:0 0 5px 0; color:#042D15;">${title}</h4>
                            <div style="font-size:12px; color:#51715C;">
                                ${isHistory ? 'Histórico finalizado' : 'Importação'} •
                                Modalidade: <strong style="text-transform:uppercase;">${modality}</strong> • 
                                ${playersCount} Jogadores • ${matchesCount} Partidas
                            </div>
                        </div>
                        <div style="font-size:11px; color:#8A9E8F;">
                            ${isHistory ? 'Encerrado em' : 'Importado em'}: ${date ? new Date(date).toLocaleDateString() : '—'}
                        </div>
                        ${isHistory ? `<button class="btn btn-outline-full btn-history-details" data-id="${d.id || childSnap.key}" style="margin-left:10px; min-height:44px;">Ver detalhes</button>` : ''}
                    </div>
                `;
            });
            container.innerHTML = html;

            container.querySelectorAll('.btn-history-details').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const historyId = btn.dataset.id;
                    const detailSnap = await get(ref(db, `imports/${historyId}`));
                    if (!detailSnap.exists()) return;
                    const detail = detailSnap.val();
                    const rankingRows = (detail.rankingFinal || []).slice(0, 8).map((r, idx) => `
                        <tr><td>${idx + 1}</td><td>${formatName(r.name)}</td><td>${r.pts || 0}</td><td>${r.v || 0}</td><td>${r.sg || 0}</td></tr>
                    `).join('');
                    historyDetailsContent.innerHTML = `
                        <div style="display:grid; gap:12px;">
                            <div class="group-card" style="padding:12px;">
                                <h3 style="margin-bottom:8px;">${detail.name || 'Torneio'}</h3>
                                <p><strong>Código:</strong> ${detail.code || detail.tournamentCode || '—'}</p>
                                <p><strong>Modalidade:</strong> ${(detail.tournamentType || detail.modality || 'fifa').toUpperCase()}</p>
                                <p><strong>Campeão:</strong> ${formatName(detail.champion || '—')}</p>
                                <p><strong>Vice:</strong> ${formatName(detail.vice || '—')}</p>
                                <p><strong>Participantes:</strong> ${(detail.participants || []).length}</p>
                            </div>
                            <div class="table-responsive">
                                <table class="group-table ranking-table">
                                    <thead><tr><th>#</th><th>Jogador</th><th>PTS</th><th>V</th><th>SG</th></tr></thead>
                                    <tbody>${rankingRows || '<tr><td colspan="5">Sem ranking disponível.</td></tr>'}</tbody>
                                </table>
                            </div>
                        </div>
                    `;
                    historyModal?.classList.add('active');
                });
            });

        } catch (e) {
            console.error(e);
        }
    }

    document.getElementById('btn-close-history-details')?.addEventListener('click', () => {
        document.getElementById('modal-history-details')?.classList.remove('active');
    });

    // Initialize initial loads
    if (!customCupRankingUI) {
        loadRanking('fifa');
    }
    loadImportHistory();
}
