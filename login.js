import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const db = getFirestore(app);

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

    // ==========================================
    // FLUXO DE PARTICIPANTE
    // ==========================================
    const btnParticipante = document.getElementById('btn-participante');
    const participanteChoice = document.getElementById('participante-choice');
    
    const formParticipanteLogin = document.getElementById('participante-login');
    const formParticipanteRegister = document.getElementById('participante-register');

    const btnJaParticipei = document.getElementById('btn-ja-participei');
    const btnSouNovo = document.getElementById('btn-sou-novo');
    const btnVoltarChoice = document.getElementById('btn-voltar-choice');
    const btnVoltarLogin = document.getElementById('btn-voltar-login');
    const btnVoltarRegister = document.getElementById('btn-voltar-register');

    const loginCpf = document.getElementById('login-cpf');
    const regCpf = document.getElementById('reg-cpf');
    const regWhats = document.getElementById('reg-whats');
    const regBandeira = document.getElementById('reg-bandeira');

    // MÁSCARAS
    function applyCpfMask(input) {
        if (!input) return;
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0,11);
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
            e.target.value = value;
        });
    }

    function applyWhatsMask(input) {
        if (!input) return;
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0,11);
            value = value.replace(/^(\d{2})(\d)/g, '($1) $2');
            value = value.replace(/(\d)(\d{4})$/, '$1-$2');
            e.target.value = value;
        });
    }

    applyCpfMask(loginCpf);
    applyCpfMask(regCpf);
    applyWhatsMask(regWhats);

    // TRANSIÇÕES DE TELA
    if (btnParticipante) {
        btnParticipante.addEventListener('click', () => {
            roleActions.style.display = 'none';
            participanteChoice.style.display = 'flex';
            mainTitle.textContent = 'Participante';
            mainSubtitle.textContent = 'Você já participou de um torneio anterior?';
        });
    }

    if (btnVoltarChoice) {
        btnVoltarChoice.addEventListener('click', () => {
            participanteChoice.style.display = 'none';
            roleActions.style.display = 'flex';
            mainTitle.textContent = 'Acessar a Copa';
            mainSubtitle.textContent = 'Selecione o seu perfil para continuar';
        });
    }

    if (btnJaParticipei) {
        btnJaParticipei.addEventListener('click', () => {
            participanteChoice.style.display = 'none';
            formParticipanteLogin.style.display = 'flex';
            mainTitle.textContent = 'Identificação';
            mainSubtitle.textContent = 'Insira seu CPF para continuar';
        });
    }

    if (btnSouNovo) {
        btnSouNovo.addEventListener('click', () => {
            participanteChoice.style.display = 'none';
            formParticipanteRegister.style.display = 'flex';
            mainTitle.textContent = 'Novo Cadastro';
            mainSubtitle.textContent = 'Preencha seus dados para participar';
        });
    }

    if (btnVoltarLogin) {
        btnVoltarLogin.addEventListener('click', () => {
            formParticipanteLogin.style.display = 'none';
            participanteChoice.style.display = 'flex';
            mainTitle.textContent = 'Participante';
            mainSubtitle.textContent = 'Você já participou de um torneio anterior?';
        });
    }

    if (btnVoltarRegister) {
        btnVoltarRegister.addEventListener('click', () => {
            formParticipanteRegister.style.display = 'none';
            participanteChoice.style.display = 'flex';
            mainTitle.textContent = 'Participante';
            mainSubtitle.textContent = 'Você já participou de um torneio anterior?';
        });
    }

    // TELA 2: LOGIN JÁ PARTICIPEI
    if (formParticipanteLogin) {
        formParticipanteLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cpfRaw = loginCpf.value.replace(/\D/g, '');
            if (cpfRaw.length !== 11) {
                alert('Por favor, informe um CPF válido.');
                return;
            }

            const btnSubmit = document.getElementById('btn-continuar-login');
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'Buscando...';
            btnSubmit.disabled = true;

            try {
                const docRef = doc(db, 'participants', cpfRaw);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    window.location.href = `FIFA/Fifa.html?role=participante&id=${cpfRaw}`;
                } else {
                    if (confirm('Não encontramos seu cadastro. Verifique o CPF ou faça um novo cadastro.\nDeseja fazer um novo cadastro agora?')) {
                        formParticipanteLogin.style.display = 'none';
                        formParticipanteRegister.style.display = 'flex';
                        mainTitle.textContent = 'Novo Cadastro';
                        mainSubtitle.textContent = 'Preencha seus dados para participar';
                        regCpf.value = loginCpf.value; 
                    }
                }
            } catch (error) {
                console.error('Erro ao buscar participante:', error);
                alert('Erro de conexão. Tente novamente.');
            } finally {
                btnSubmit.textContent = originalText;
                btnSubmit.disabled = false;
            }
        });
    }

    // TELA 3: REGISTRO NOVO PARTICIPANTE
    if (formParticipanteRegister) {
        formParticipanteRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const cpfRaw = regCpf.value.replace(/\D/g, '');
            if (cpfRaw.length !== 11) {
                alert('Por favor, informe um CPF válido.');
                return;
            }

            const flag = regBandeira.value;
            const nome = document.getElementById('reg-nome').value.trim();
            const insta = document.getElementById('reg-insta').value.trim();
            const whats = regWhats.value.trim();
            const nick = document.getElementById('reg-nick').value.trim();

            const btnSubmit = formParticipanteRegister.querySelector('button[type="submit"]');
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'Cadastrando...';
            btnSubmit.disabled = true;

            try {
                // Check CPF
                const docRef = doc(db, 'participants', cpfRaw);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    alert('Este CPF já está cadastrado!');
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                    return;
                }

                // Check Flag
                const q = query(collection(db, 'participants'), where('flag', '==', flag));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    alert('Esta bandeira já foi escolhida por outro participante! Escolha outra.');
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                    return;
                }

                // Save
                const newParticipant = {
                    nome,
                    cpf: cpfRaw,
                    flag,
                    insta,
                    whats,
                    nick,
                    createdAt: new Date().toISOString()
                };

                await setDoc(docRef, newParticipant);
                alert('Cadastro realizado com sucesso!');
                window.location.href = `FIFA/Fifa.html?role=participante&id=${cpfRaw}`;
                
            } catch (error) {
                console.error('Erro no cadastro:', error);
                alert('Houve um erro no cadastro. Tente novamente.');
                btnSubmit.textContent = originalText;
                btnSubmit.disabled = false;
            }
        });
    }
});
