document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') || localStorage.getItem('copaRole') || 'visitante';
    let safeRole = ['organizador', 'visitante', 'apostador', 'participante'].includes(role) ? role : 'visitante';
    const financeButton = document.getElementById('financeiro-option');
    const organizerAccessButton = document.getElementById('btn-organizer-access');
    const organizerExitButton = document.getElementById('btn-organizer-exit');

    localStorage.setItem('copaRole', safeRole);

    function isOrganizerSession() {
        return safeRole === 'organizador' && sessionStorage.getItem('copaPsyzonOrganizer') === 'true';
    }

    function getRoutes() {
        const roleForRoute = isOrganizerSession() ? 'organizador' : safeRole;
        return {
            fifa: `FIFA/Fifa.html?role=${encodeURIComponent(roleForRoute)}`,
            sinuca: `SINUCA/sinuca.html?role=${encodeURIComponent(roleForRoute)}`,
            financeiro: `financeiro.html?role=organizador`
        };
    }

    function showFinanceiroOnlyForOrganizer() {
        const allowed = isOrganizerSession();
        if (financeButton) financeButton.hidden = !allowed;
        if (organizerAccessButton) organizerAccessButton.hidden = true;
        if (organizerExitButton) organizerExitButton.hidden = !allowed;
    }

    document.querySelectorAll('.game-option:not(.disabled)').forEach(button => {
        button.addEventListener('click', () => {
            const game = button.dataset.game;
            if (game === 'financeiro' && !isOrganizerSession()) return;
            const routes = getRoutes();
            if (!routes[game]) return;
            window.location.href = routes[game];
        });
    });

    if (organizerExitButton) {
        organizerExitButton.addEventListener('click', () => {
            sessionStorage.removeItem('copaPsyzonOrganizer');
            safeRole = 'visitante';
            localStorage.setItem('copaRole', 'visitante');
            showFinanceiroOnlyForOrganizer();
        });
    }

    showFinanceiroOnlyForOrganizer();
});
