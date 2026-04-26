import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCL2u-oSlw8EWQ96atPI9Tc-0cIl2k9K6M",
  authDomain: "copa-psyzon2.firebaseapp.com",
  projectId: "copa-psyzon2",
  storageBucket: "copa-psyzon2.firebasestorage.app",
  messagingSenderId: "934292793843",
  appId: "1:934292793843:web:2f67fc6d314e1185f6ca86",
  measurementId: "G-G9Q14JE533"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

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
            const email = loginForm.querySelector('input[type="email"]').value;
            const password = loginForm.querySelector('input[type="password"]').value;
            const btnSubmit = loginForm.querySelector('button[type="submit"]');

            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'ENTRANDO...';
            btnSubmit.disabled = true;

            signInWithEmailAndPassword(auth, email, password)
                .then((userCredential) => {
                    // Login sucesso
                    window.location.href = 'FIFA/Fifa.html?role=organizador';
                })
                .catch((error) => {
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                    
                    const errorCode = error.code;
                    let message = 'Erro ao entrar. Verifique suas credenciais.';
                    
                    if (errorCode === 'auth/invalid-credential') {
                        message = 'Email ou senha incorretos.';
                    } else if (errorCode === 'auth/user-not-found') {
                        message = 'Usuário não encontrado.';
                    }
                    
                    alert(message);
                    console.error("Login Error:", error);
                });
        });
    }

    const btnVisitante = document.getElementById('btn-visitante');
    if (btnVisitante) {
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
