document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || localStorage.getItem('copaRole') || 'visitante';
    const safeRole = ['organizador', 'visitante', 'apostador', 'participante'].includes(role) ? role : 'visitante';

    localStorage.setItem('copaRole', safeRole);

    const routes = {
        fifa: `FIFA/Fifa.html?role=${encodeURIComponent(safeRole)}`,
        sinuca: `SINUCA/sinuca.html?role=${encodeURIComponent(safeRole)}`
    };

    document.querySelectorAll('.game-option:not(.disabled)').forEach(button => {
        button.addEventListener('click', () => {
            const game = button.dataset.game;
            if (!routes[game]) return;
            window.location.href = routes[game];
        });
    });
});
