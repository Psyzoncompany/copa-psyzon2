import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firebase-client.js";
import {
  getTournamentByCode,
  isTournamentCodeValid,
  normalizeTournamentCode,
  updateTournamentData
} from "./tournament-service.js";

document.addEventListener('DOMContentLoaded', () => {
    const formCodigo = document.getElementById('form-codigo');
    const inputCodigo = document.getElementById('participante-codigo');
    const screenCodigo = document.getElementById('screen-codigo');

    const screenChoice = document.getElementById('screen-choice');
    const screenLogin = document.getElementById('screen-login');
    const screenRegister = document.getElementById('screen-register');

    const btnJaParticipei = document.getElementById('btn-ja-participei');
    const btnSouNovo = document.getElementById('btn-sou-novo');
    const btnVoltarChoice = document.getElementById('btn-voltar-choice');
    const btnVoltarLogin = document.getElementById('btn-voltar-login');
    const btnVoltarRegister = document.getElementById('btn-voltar-register');

    const formLogin = document.getElementById('form-login');
    const formRegister = document.getElementById('form-register');

    const loginCpf = document.getElementById('login-cpf');
    const regCpf = document.getElementById('reg-cpf');
    const regWhats = document.getElementById('reg-whats');
    const regBandeira = document.getElementById('reg-bandeira');

    function applyCpfMask(input) {
        if (!input) return;
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);
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
            if (value.length > 11) value = value.slice(0, 11);
            value = value.replace(/^(\d{2})(\d)/g, '($1) $2');
            value = value.replace(/(\d)(\d{4})$/, '$1-$2');
            e.target.value = value;
        });
    }

    applyCpfMask(loginCpf);
    applyCpfMask(regCpf);
    applyWhatsMask(regWhats);

    let selectedTournament = null;

    function buildTournamentUrl(role, code, participantId = '', tournamentType = 'fifa') {
        const params = new URLSearchParams({ role, code });
        if (participantId) params.set('id', participantId);

        const routes = {
            fifa: 'FIFA/Fifa.html',
            sinuca: 'FIFA/Fifa.html',
            cs: 'FIFA/Fifa.html'
        };

        return `${routes[tournamentType] || routes.fifa}?${params.toString()}`;
    }

    formCodigo.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = normalizeTournamentCode(inputCodigo.value);
        inputCodigo.value = code;

        if (code.length !== 5 || !isTournamentCodeValid(code)) {
            alert('Código inválido. Use 5 caracteres e inicie com F, S ou C.');
            return;
        }

        const btnSubmit = formCodigo.querySelector('button[type="submit"]');
        const originalText = btnSubmit.textContent;
        btnSubmit.textContent = 'VERIFICANDO...';
        btnSubmit.disabled = true;

        try {
            const result = await getTournamentByCode(code);
            if (!result.exists) {
                alert('Código não encontrado. Verifique e tente novamente.');
                return;
            }

            selectedTournament = result.data;
            screenCodigo.style.display = 'none';
            screenChoice.style.display = 'block';
        } catch (error) {
            console.error('Erro ao verificar código:', error);
            alert('Erro ao verificar código. Consulte o console para mais detalhes.');
        } finally {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
    });

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
                const docSnap = await getDoc(doc(db, 'participants', cpfRaw));
                if (docSnap.exists()) {
                    await attachParticipantToTournament(selectedTournament.code, docSnap.data());
                    window.location.href = buildTournamentUrl('participante', selectedTournament.code, cpfRaw, selectedTournament.type);
                } else if (confirm('Não encontramos seu cadastro. Deseja fazer um novo cadastro agora?')) {
                    screenLogin.style.display = 'none';
                    screenRegister.style.display = 'block';
                    regCpf.value = loginCpf.value;
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
                const docRef = doc(db, 'participants', cpfRaw);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    alert('Este CPF já está cadastrado!');
                    return;
                }

                const q = query(collection(db, 'participants'), where('flag', '==', flag));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    alert('Esta bandeira já foi escolhida por outro participante! Escolha outra.');
                    return;
                }

                const newParticipant = {
                    nome,
                    cpf: cpfRaw,
                    flag,
                    insta,
                    whats,
                    nick,
                    createdAt: serverTimestamp()
                };

                await setDoc(docRef, newParticipant);
                await attachParticipantToTournament(selectedTournament.code, newParticipant);

                alert('Cadastro realizado com sucesso!');
                window.location.href = buildTournamentUrl('participante', selectedTournament.code, cpfRaw, selectedTournament.type);
            } catch (error) {
                console.error('Erro no cadastro:', error);
                alert('Houve um erro no cadastro. Tente novamente.');
            } finally {
                btnSubmit.textContent = originalText;
                btnSubmit.disabled = false;
            }
        });
    }

    async function attachParticipantToTournament(code, participantData) {
        if (!code || !participantData) return;

        const result = await getTournamentByCode(code);
        if (!result.exists) {
            throw new Error('Torneio não encontrado ao associar participante.');
        }

        const tData = result.data;
        const registeredPlayers = Array.isArray(tData.participants) ? [...tData.participants] : [];

        if (!registeredPlayers.find((p) => p.id === participantData.cpf)) {
            registeredPlayers.push({
                id: participantData.cpf,
                name: participantData.nome,
                nick: participantData.nick || '',
                flagId: participantData.flag || 'br'
            });

            await updateTournamentData(code, { participants: registeredPlayers });
        }
    }
});
