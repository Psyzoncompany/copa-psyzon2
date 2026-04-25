/**
 * Objeto de dados (Exemplo funcional)
 * O sistema foi desenhado para ser totalmente dinâmico.
 */
const dadosAtleta = {
    nome: "Júlio César Ferreira",
    username: "@Mr_julius96",
    foto: "https://api.dicebear.com/7.x/avataaars/svg?seed=Julius", // Avatar dinâmico
    trofeus: 1,
    finais: 1,
    semifinais: 1,
    jogos: 3,
    vitorias: 2,
    empates: 0,
    derrotas: 1,
    gols: 17,
    golsSofridos: 16
};

/**
 * Função principal de renderização
 * Calcula automaticamente o saldo e injeta no DOM.
 */
function renderProfile(dados) {
    const container = document.getElementById('profile-container');
    if (!container) return;

    // 1. Cálculo Automático
    const saldo = dados.gols - dados.golsSofridos;

    // 2. Lógica de Destaque Inteligente (Saldo)
    let saldoClass = 'saldo-neu';
    if (saldo > 0) saldoClass = 'saldo-pos';
    else if (saldo < 0) saldoClass = 'saldo-neg';

    // 3. Montagem do Template
    container.innerHTML = `
        <div class="profile-card">
            <!-- TOPO (PERFIL) -->
            <div class="profile-header">
                <div class="avatar-wrapper">
                    <img src="${dados.foto}" alt="${dados.nome}">
                </div>
                <div class="profile-info">
                    <h1>${dados.nome}</h1>
                    <span class="username">${dados.username}</span>
                </div>
            </div>

            <!-- ESTATÍSTICAS PRINCIPAIS -->
            <div class="main-badges">
                <div class="badge-item">
                    <i class="ph-fill ph-trophy badge-icon"></i>
                    <span class="badge-value">${dados.trofeus}</span>
                    <span class="badge-label">Troféus</span>
                </div>
                <div class="badge-item">
                    <i class="ph-fill ph-medal badge-icon" style="color: #cbd5e1;"></i>
                    <span class="badge-value">${dados.finais}</span>
                    <span class="badge-label">Finais</span>
                </div>
                <div class="badge-item">
                    <i class="ph-fill ph-target badge-icon" style="color: #94a3b8;"></i>
                    <span class="badge-value">${dados.semifinais}</span>
                    <span class="badge-label">Semifinais</span>
                </div>
            </div>

            <!-- ESTATÍSTICAS GERAIS -->
            <div class="general-stats">
                <div class="stats-grid">
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.jogos}</span>
                        <span class="stat-box-label">Jogos</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.vitorias}</span>
                        <span class="stat-box-label">Vitórias</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.empates}</span>
                        <span class="stat-box-label">Empates</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.derrotas}</span>
                        <span class="stat-box-label">Derrotas</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.gols}</span>
                        <span class="stat-box-label">Gols</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-box-value">${dados.golsSofridos}</span>
                        <span class="stat-box-label">Sofridos</span>
                    </div>
                    
                    <!-- SALDO DE GOLS (Calculado) -->
                    <div class="stat-box highlight ${saldoClass}">
                        <span class="stat-box-label">Saldo de Gols</span>
                        <span class="stat-box-value">${saldo > 0 ? '+' : ''}${saldo}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    renderProfile(dadosAtleta);
});

// Exemplo de atualização dinâmica após 2 segundos (Simulação)
/*
setTimeout(() => {
    dadosAtleta.vitorias += 1;
    dadosAtleta.gols += 3;
    renderProfile(dadosAtleta);
}, 2000);
*/
