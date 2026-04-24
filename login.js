document.addEventListener('DOMContentLoaded', () => {
    const btnOrganizador = document.getElementById('btn-organizador');
    const btnVoltar = document.getElementById('btn-voltar');
    
    const roleActions = document.getElementById('role-actions');
    const loginForm = document.getElementById('login-form');
    const mainTitle = document.getElementById('main-title');
    const mainSubtitle = document.getElementById('main-subtitle');

    if (btnOrganizador && btnVoltar && roleActions && loginForm) {
        btnOrganizador.addEventListener('click', () => {
            // Hide role buttons
            roleActions.style.display = 'none';
            // Show form
            loginForm.style.display = 'flex';
            // Update titles
            mainTitle.textContent = 'Acesso Organizador';
            mainSubtitle.textContent = 'Insira suas credenciais';
        });

        btnVoltar.addEventListener('click', () => {
            loginForm.style.display = 'none';
            roleActions.style.display = 'flex';
            mainTitle.textContent = 'Acessar a Copa';
            mainSubtitle.textContent = 'Selecione o seu perfil para continuar';
        });

        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Simula login de organizador
            window.location.href = 'FIFA/Fifa.html?role=organizador';
        });
    }

    const btnVisitante = document.querySelectorAll('.btn-role')[0]; // Participante is an <a> tag now, so btn-role[0] is Visitante
    if (btnVisitante && btnVisitante.textContent.includes('Visitante')) {
        btnVisitante.addEventListener('click', () => {
            window.location.href = 'FIFA/Fifa.html?role=visitante';
        });
    }

    const btnApostador = document.getElementById('btn-apostador');
    if (btnApostador) {
        btnApostador.addEventListener('click', () => {
            window.location.href = 'FIFA/Fifa.html?role=apostador';
        });
    }
});
