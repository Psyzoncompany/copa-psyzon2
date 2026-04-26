import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

document.addEventListener('DOMContentLoaded', () => {
    const CODE_REGEX_BY_MODALITY = {
        fifa: /^[F][A-Z0-9]{4}$/,
        sinuca: /^[S][A-Z0-9]{4}$/,
        cs: /^[C][A-Z0-9]{4}$/
    };

    async function sha256Hex(value) {
        const encoded = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest('SHA-256', encoded);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function createParticipantId() {
        return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeParticipant(raw = {}) {
        return {
            id: raw.id || raw.participantId || null,
            name: raw.name || raw.nome || '',
            nick: raw.nick || '',
            cpfHash: raw.cpfHash || null,
            whatsapp: raw.whatsapp || raw.whats || '',
            instagram: raw.instagram || raw.insta || '',
            flagId: raw.flagId || raw.teamName || raw.flag || 'br',
            countryCode: (raw.countryCode || 'br').toLowerCase(),
            photoUrl: raw.photoUrl || raw.photo || raw.fotoURL || null,
            createdAt: raw.createdAt || new Date().toISOString()
        };
    }

    function normalizeCodeEntry(raw) {
        const status = raw.status || (raw.used ? 'used' : 'available');
        return {
            ...raw,
            status,
            used: status === 'used',
            participantId: raw.participantId || raw.usedBy || null,
            usedBy: raw.usedBy || raw.participantId || null,
            usedAt: raw.usedAt || null
        };
    }

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

    // Máscara CPF direto
    const cpfDiretoInput = document.getElementById('cpf-direto');
    applyCpfMask(cpfDiretoInput);

    // ==========================================
    // SELETOR DE ESCUDOS POR PAÍS
    // ==========================================
    const teamsByCountry = {
        BRAZIL: [
            'Flamengo','Corinthians','Palmeiras','São Paulo','Santos',
            'Grêmio','Internacional','Cruzeiro','Atlético Mineiro','Botafogo',
            'Fluminense','Vasco da Gama','Bahia','Sport Recife','Coritiba',
            'Athletico Paranaense','Fortaleza','Ceará','Goiás','Chapecoense'
        ],
        ENGLAND: [
            'Manchester United','Manchester City','Liverpool','Chelsea','Arsenal',
            'Tottenham','Newcastle','West Ham','Aston Villa','Brighton',
            'Everton','Leicester City','Wolverhampton','Crystal Palace','Fulham',
            'Bournemouth','Nottingham Forest','Brentford','Leeds United','Southampton'
        ],
        SPAIN: [
            'Real Madrid','Barcelona','Atletico Madrid','Sevilla','Real Betis',
            'Real Sociedad','Villarreal','Valencia','Athletic Bilbao','Celta Vigo',
            'Osasuna','Espanyol','Mallorca','Getafe','Rayo Vallecano',
            'Cadiz','Almeria','Elche','Valladolid','Girona'
        ],
        ITALY: [
            'Juventus','AC Milan','Inter Milan','Napoli','Roma',
            'Lazio','Atalanta','Fiorentina','Torino','Bologna',
            'Udinese','Sassuolo','Sampdoria','Verona','Empoli',
            'Salernitana','Lecce','Monza','Spezia','Cremonese'
        ],
        GERMANY: [
            'Bayern Munich','Borussia Dortmund','RB Leipzig','Bayer Leverkusen','Eintracht Frankfurt',
            'Wolfsburg','Borussia Monchengladbach','Freiburg','Union Berlin','Hoffenheim',
            'Mainz','Koln','Augsburg','Hertha Berlin','Stuttgart',
            'Werder Bremen','Schalke 04','Bochum','Darmstadt','Heidenheim'
        ],
        FRANCE: [
            'Paris Saint-Germain','Marseille','Lyon','Monaco','Lille',
            'Nice','Rennes','Lens','Strasbourg','Montpellier',
            'Nantes','Toulouse','Reims','Lorient','Clermont',
            'Brest','Metz','Le Havre','Auxerre','Angers'
        ],
        PORTUGAL: [
            'Benfica','Porto','Sporting CP','Braga','Vitoria Guimaraes',
            'Boavista','Famalicao','Gil Vicente','Santa Clara','Arouca',
            'Estoril','Casa Pia','Vizela','Rio Ave','Portimonense'
        ]
    };

    const regPais = document.getElementById('reg-pais');
    const regBandeiraSelect = document.getElementById('reg-bandeira');
    const shieldSection = document.getElementById('shield-section');
    const shieldPreviewImg = document.getElementById('shield-preview-img');

    if (regPais) {
        regPais.addEventListener('change', () => {
            const country = regPais.value;
            regBandeiraSelect.innerHTML = '<option value="">Selecione o Time</option>';
            shieldPreviewImg.style.display = 'none';

            if (!country || !teamsByCountry[country]) {
                shieldSection.style.display = 'none';
                return;
            }

            shieldSection.style.display = 'block';
            teamsByCountry[country].forEach(team => {
                const opt = document.createElement('option');
                opt.value = team;
                opt.textContent = team;
                regBandeiraSelect.appendChild(opt);
            });
        });
    }

    if (regBandeiraSelect) {
        regBandeiraSelect.addEventListener('change', () => {
            const team = regBandeiraSelect.value;
            if (!team) {
                shieldPreviewImg.style.display = 'none';
                return;
            }
            // Gerar URL de logo via API pública
            const slug = team.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            shieldPreviewImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(team)}&background=16A34A&color=fff&size=128&font-size=0.35&bold=true&rounded=true`;
            shieldPreviewImg.style.display = 'block';
        });
    }

    // ==========================================
    // LOGIN DIRETO POR CPF (sem código)
    // ==========================================
    const formCpfDireto = document.getElementById('form-cpf-direto');
    if (formCpfDireto) {
        formCpfDireto.addEventListener('submit', async (e) => {
            e.preventDefault();
            alert('Por segurança, o acesso direto por CPF foi desativado. Use o código de acesso do organizador.');
            return;
            const cpfRaw = cpfDiretoInput.value.replace(/\D/g, '');
            if (cpfRaw.length !== 11) {
                alert('Por favor, informe um CPF válido (11 dígitos).');
                return;
            }

            const btnSubmit = formCpfDireto.querySelector('button[type="submit"]');
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'BUSCANDO...';
            btnSubmit.disabled = true;

            try {
                const cpfHash = await sha256Hex(cpfRaw);
                const idxSnap = await get(ref(db, 'participantsByCpfHash/' + cpfHash));
                const participantId = idxSnap.exists() ? idxSnap.val() : null;
                const docRef = participantId ? ref(db, 'participants/' + participantId) : ref(db, 'participants/' + cpfRaw);
                const docSnap = await get(docRef);

                if (docSnap.exists()) {
                    const data = normalizeParticipant(docSnap.val());
                    const publicId = data.id || participantId || cpfRaw;
                    // Redirecionar para a área do participante
                    window.location.href = `FIFA/Fifa.html?role=participante&id=${encodeURIComponent(publicId)}&name=${encodeURIComponent(data.name)}`;
                } else {
                    alert('CPF não encontrado. Você precisa de um código de acesso para se cadastrar primeiro.');
                }
            } catch (error) {
                console.error('Erro ao buscar CPF:', error);
                alert('Erro de conexão. Tente novamente.');
            } finally {
                btnSubmit.textContent = originalText;
                btnSubmit.disabled = false;
            }
        });
    }

    // ==========================================
    // VALIDAÇÃO DO CÓDIGO
    // ==========================================
    let validCodeData = null;

    formCodigo.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = inputCodigo.value.trim().toUpperCase();
        if (!code) return;
        if (!CODE_REGEX_BY_MODALITY.fifa.test(code)) {
            alert('Código inválido para FIFA. Use o formato F1234.');
            return;
        }

        const btnSubmit = formCodigo.querySelector('button[type="submit"]');
        const originalText = btnSubmit.textContent;
        btnSubmit.textContent = 'VERIFICANDO...';
        btnSubmit.disabled = true;

        try {
            const docRef = ref(db, 'codes/pool');
            const docSnap = await get(docRef);

            if (docSnap.exists()) {
                const data = docSnap.val();
                const codesArray = (data.codes || []).map(normalizeCodeEntry);
                const codeObj = codesArray.find(c => c.code === code);
                
                if (codeObj) {
                    if (codeObj.status === 'used') {
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
                const cpfHash = await sha256Hex(cpfRaw);
                const idxSnap = await get(ref(db, 'participantsByCpfHash/' + cpfHash));
                const participantId = idxSnap.exists() ? idxSnap.val() : null;
                const docRef = participantId ? ref(db, 'participants/' + participantId) : ref(db, 'participants/' + cpfRaw);
                const docSnap = await get(docRef);

                if (docSnap.exists()) {
                    const existingData = normalizeParticipant(docSnap.val());
                    await markCodeAsUsed(validCodeData, existingData);
                    window.location.href = `FIFA/Fifa.html?role=participante&id=${encodeURIComponent(existingData.id || participantId || cpfRaw)}`;
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
                const participantId = createParticipantId();
                const cpfHash = await sha256Hex(cpfRaw);

                // Check CPF
                const hashIdxRef = ref(db, 'participantsByCpfHash/' + cpfHash);
                const hashIdxSnap = await get(hashIdxRef);
                const legacySnap = await get(ref(db, 'participants/' + cpfRaw));
                if (hashIdxSnap.exists() || legacySnap.exists()) {
                    alert('Este CPF já está cadastrado!');
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                    return;
                }

                // Check Flag (busca local para evitar necessidade de índice)
                const allParticipants = await get(ref(db, 'participants'));
                let flagTaken = false;
                if (allParticipants.exists()) {
                    allParticipants.forEach(child => {
                        if (child.val().flag === flag) flagTaken = true;
                    });
                }
                if (flagTaken) {
                    alert('Esta bandeira já foi escolhida por outro participante! Escolha outra.');
                    btnSubmit.textContent = originalText;
                    btnSubmit.disabled = false;
                    return;
                }

                // Handle Photo Upload (Convert to Base64)
                let photoBase64 = null;
                const photoFile = document.getElementById('reg-foto').files[0];
                if (photoFile) {
                    photoBase64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsDataURL(photoFile);
                    });
                }

            const countryCodeMap = {
                'BRAZIL': 'br', 'ENGLAND': 'gb', 'SPAIN': 'es', 'ITALY': 'it',
                'GERMANY': 'de', 'FRANCE': 'fr', 'PORTUGAL': 'pt'
            };
            const countryCode = countryCodeMap[document.getElementById('reg-pais').value] || 'br';

            // Save
            const normalized = normalizeParticipant({
                id: participantId,
                name: nome,
                nick,
                cpfHash,
                whatsapp: whats,
                instagram: insta,
                flagId: flag,
                teamName: flag,
                countryCode,
                photoUrl: photoBase64,
                createdAt: new Date().toISOString(),
                // compatibilidade legada
                nome,
                cpf: cpfRaw,
                flag,
                insta,
                whats,
                photo: photoBase64
            });

                await set(ref(db, 'participants/' + participantId), normalized);
                await set(hashIdxRef, participantId);
                
                await markCodeAsUsed(validCodeData, normalized);

                alert('Cadastro realizado com sucesso!');
                window.location.href = `FIFA/Fifa.html?role=participante&id=${encodeURIComponent(participantId)}`;
                
            } catch (error) {
                console.error('Erro no cadastro:', error);
                alert('Houve um erro no cadastro. Tente novamente.');
                btnSubmit.textContent = originalText;
                btnSubmit.disabled = false;
            }
        });
    }

    async function consumeAccessCodeAtomically(codeStr, participantId) {
        if (!codeStr) return true;
        const cRef = ref(db, 'codes/pool');
        const tx = await runTransaction(cRef, (current) => {
            if (!current || !Array.isArray(current.codes)) return current;
            const normalizedCodes = current.codes.map(normalizeCodeEntry);
            const idx = normalizedCodes.findIndex(c => c.code === codeStr);
            if (idx < 0) return;
            if (normalizedCodes[idx].status === 'used') return;
            normalizedCodes[idx] = {
                ...normalizedCodes[idx],
                status: 'used',
                used: true,
                participantId,
                usedBy: participantId,
                usedAt: new Date().toISOString()
            };
            current.codes = normalizedCodes;
            return current;
        });
        return !!tx.committed;
    }

    async function markCodeAsUsed(codeStr, participantData) {
        if (!codeStr) return;
        try {
            const codeConsumed = await consumeAccessCodeAtomically(codeStr, participantData?.id || participantData?.cpf);
            if (!codeConsumed) {
                alert('Este código foi utilizado por outro participante. Solicite um novo código ao organizador.');
                return;
            }

            // 2. Adicionar ao torneio e encaixar no chaveamento
            if (participantData) {
                const tRef = ref(db, 'tournaments/current');
                const tSnap = await get(tRef);
                if (tSnap.exists()) {
                    const tData = tSnap.val();
                    let regPlayers = tData.registeredPlayers || [];

                    // Evitar duplicidade
                    const participantId = participantData.id || participantData.cpf;
                    if (regPlayers.find(p => p.id === participantId)) {
                        alert('Você já está inscrito neste torneio!');
                        return; // Não marca o código como usado nem faz nada
                    }

                    regPlayers.push({
                            id: participantId,
                            name: participantData.name || participantData.nome,
                            nick: participantData.nick || "",
                            flagId: participantData.flagId || participantData.flag || "br",
                            countryCode: participantData.countryCode || "br",
                            photo: participantData.photoUrl || participantData.photo || null
                        });

                        // 3. ENCAIXAR NO CHAVEAMENTO — Fase de Grupos
                        let placed = false;
                        if (tData.groups && tData.groups.length > 0) {
                            for (let g = 0; g < tData.groups.length && !placed; g++) {
                                for (let p = 0; p < tData.groups[g].players.length && !placed; p++) {
                                    if (tData.groups[g].players[p].name.startsWith('A definir')) {
                                        tData.groups[g].players[p].name = participantData.name || participantData.nome;
                                        placed = true;
                                    }
                                }
                            }
                        }

                        // 4. ENCAIXAR NO CHAVEAMENTO — Mata-mata (eliminatória direta)
                        if (!placed && tData.knockout && tData.knockout.rounds) {
                            const firstRound = tData.knockout.rounds[0];
                            if (firstRound && firstRound.matches) {
                                for (let m = 0; m < firstRound.matches.length && !placed; m++) {
                                    if (firstRound.matches[m].p1.startsWith('A definir') || firstRound.matches[m].p1.startsWith('Classificado')) {
                                        firstRound.matches[m].p1 = participantData.name || participantData.nome;
                                        placed = true;
                                    } else if (firstRound.matches[m].p2.startsWith('A definir') || firstRound.matches[m].p2.startsWith('Classificado')) {
                                        firstRound.matches[m].p2 = participantData.name || participantData.nome;
                                        placed = true;
                                    }
                                }
                            }
                        }

                        // 5. Salvar tudo de volta no Firebase
                        const updateData = {
                            registeredPlayers: regPlayers,
                            updatedAt: new Date().toISOString()
                        };
                        if (tData.groups) updateData.groups = tData.groups;
                        if (tData.knockout) updateData.knockout = tData.knockout;

                        await update(tRef, updateData);

                        // Atualizar cópia indexada pelo código do torneio
                        if (tData.tournamentCode) {
                            await update(ref(db, 'tournaments/' + tData.tournamentCode), updateData);
                        }

                        console.log(`✅ ${participantData.name || participantData.nome} encaixado no chaveamento!`);
                    }
                }
            } catch(e) {
                console.error("Failed to update code usage", e);
            }
        }
});
