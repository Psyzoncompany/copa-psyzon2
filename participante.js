import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    // TELA 0: CÓDIGO
    const formCodigo = document.getElementById('form-codigo');
    const inputCodigo = document.getElementById('participante-codigo');
    const screenCodigo = document.getElementById('screen-codigo');
    
    // TELAS
    const screenChoice = document.getElementById('screen-choice');
    const screenLogin = document.getElementById('screen-login');
    const screenRegister = document.getElementById('screen-register');

    // BOTÕES DE ESCOLHA
    const btnJaParticipei = document.getElementById('btn-ja-participei');
    const btnSouNovo = document.getElementById('btn-sou-novo');
    const btnVoltarChoice = document.getElementById('btn-voltar-choice');

    // BOTÕES DE VOLTAR
    const btnVoltarLogin = document.getElementById('btn-voltar-login');
    const btnVoltarRegister = document.getElementById('btn-voltar-register');

    // FORMULÁRIOS E INPUTS
    const formLogin = document.getElementById('form-login');
    const formRegister = document.getElementById('form-register');
    
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

    // ==========================================
    // VALIDAÇÃO DO CÓDIGO
    // ==========================================
    let validCodeData = null;

    formCodigo.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = inputCodigo.value.trim();
        if (!code) return;

        const btnSubmit = formCodigo.querySelector('button[type="submit"]');
        const originalText = btnSubmit.textContent;
        btnSubmit.textContent = 'VERIFICANDO...';
        btnSubmit.disabled = true;

        try {
            const docRef = doc(db, 'codes', 'pool');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                const codesArray = data.codes || [];
                
                const codeObj = codesArray.find(c => c.code === code);
                
                if (codeObj) {
                    if (codeObj.used) {
                        alert('Este código já foi utilizado.');
                    } else {
                        validCodeData = code;
                        screenCodigo.style.display = 'none';
                        screenChoice.style.display = 'block';
                    }
                } else {
                    alert('Código inválido. Verifique com o organizador.');
                }
            } else {
                alert('Nenhum código gerado pelo organizador ainda.');
            }
        } catch (error) {
            console.error('Erro ao verificar código:', error);
            alert('Erro de conexão ao verificar o código.');
        } finally {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
    });

    // ==========================================
    // TRANSIÇÕES DE TELA
    // ==========================================
    if (btnVoltarChoice) {
        btnVoltarChoice.addEventListener('click', () => {
            screenChoice.style.display = 'none';
            screenCodigo.style.display = 'block';
        });
    }

    if (btnJaParticipei) {
        btnJaParticipei.addEventListener('click', () => {
            screenChoice.style.display = 'none';
            screenLogin.style.display = 'block';
        });
    }

    if (btnSouNovo) {
        btnSouNovo.addEventListener('click', () => {
            screenChoice.style.display = 'none';
            screenRegister.style.display = 'block';
        });
    }

    if (btnVoltarLogin) {
        btnVoltarLogin.addEventListener('click', () => {
            screenLogin.style.display = 'none';
            screenChoice.style.display = 'block';
        });
    }

    if (btnVoltarRegister) {
        btnVoltarRegister.addEventListener('click', () => {
            screenRegister.style.display = 'none';
            screenChoice.style.display = 'block';
        });
    }

    // ==========================================
    // LOGIN JÁ PARTICIPEI
    // ==========================================
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
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
                    await markCodeAsUsed(validCodeData);
                    window.location.href = `FIFA/Fifa.html?role=participante&id=${cpfRaw}`;
                } else {
                    if (confirm('Não encontramos seu cadastro. Verifique o CPF ou faça um novo cadastro.\nDeseja fazer um novo cadastro agora?')) {
                        screenLogin.style.display = 'none';
                        screenRegister.style.display = 'block';
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

    // ==========================================
    // REGISTRO NOVO PARTICIPANTE
    // ==========================================
    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
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

            const btnSubmit = formRegister.querySelector('button[type="submit"]');
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
                
                await markCodeAsUsed(validCodeData);

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

    async function markCodeAsUsed(codeStr) {
        if (!codeStr) return;
        try {
            const docRef = doc(db, 'codes', 'pool');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                const codesArray = data.codes || [];
                const updatedCodes = codesArray.map(c => {
                    if (c.code === codeStr) {
                        return { ...c, used: true };
                    }
                    return c;
                });
                await updateDoc(docRef, { codes: updatedCodes });
            }
        } catch(e) {
            console.error("Failed to update code usage", e);
        }
    }
});
