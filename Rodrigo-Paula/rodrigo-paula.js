import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getDatabase,
    ref,
    get,
    set,
    update,
    onValue,
    push,
    query,
    limitToLast,
    onDisconnect
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

document.addEventListener("DOMContentLoaded", () => {
    const DEFAULT_VIDEO_URL = "https://streamx.me/8277813/m3tr0g0ldw1n.mp4?180";
    const DEFAULT_MOVIE_TITLE = "Cinema Rodrigo & Paula";
    const USER_NAME_KEY = "rpWatchUserName";
    const CLIENT_ID_KEY = "rpWatchClientId";
    const TIME_SYNC_THRESHOLD = 1.2;
    const TIME_UPDATE_THROTTLE = 4500;
    const PRESENCE_INTERVAL = 25000;

    const params = new URLSearchParams(window.location.search);
    const isHost = String(params.get("host") || "").toLowerCase() === "rodrigo";
    const isPaulaGuest = String(params.get("guest") || "").toLowerCase() === "paula";

    const $ = (selector) => document.querySelector(selector);

    const els = {
        connectionBadge: $("#connectionBadge"),
        roomBadge: $("#roomBadge"),
        syncStatus: $("#syncStatus"),
        participantsBadge: $("#participantsBadge"),
        movieTitleDisplay: $("#movieTitleDisplay"),
        playerStateBadge: $("#playerStateBadge"),
        moviePlayer: $("#moviePlayer"),
        videoNotice: $("#videoNotice"),
        videoErrorCard: $("#videoErrorCard"),
        retryVideoButton: $("#retryVideoButton"),
        participantsList: $("#participantsList"),
        organizerPanel: $("#organizerPanel"),
        movieSettingsForm: $("#movieSettingsForm"),
        movieTitleInput: $("#movieTitleInput"),
        videoUrlInput: $("#videoUrlInput"),
        sharePaulaButton: $("#sharePaulaButton"),
        copyRoomButton: $("#copyRoomButton"),
        settingsFeedback: $("#settingsFeedback"),
        chatPanel: $("#chatPanel"),
        toggleChatButton: $("#toggleChatButton"),
        hideChatButton: $("#hideChatButton"),
        chatFullscreenButton: $("#chatFullscreenButton"),
        messagesList: $("#messagesList"),
        chatForm: $("#chatForm"),
        messageInput: $("#messageInput"),
        messageTicker: $("#messageTicker"),
        tickerTrack: $("#tickerTrack"),
        nameModal: $("#nameModal"),
        nameForm: $("#nameForm"),
        nameInput: $("#nameInput"),
        toastStack: $("#toastStack")
    };

    let db = null;
    let firebaseReady = false;
    let appStarted = false;
    let roomId = sanitizeRoomId(params.get("room"));
    let currentRoom = null;
    let currentVideoUrl = "";
    let roomMissing = false;
    let userName = "";
    let userKey = "";
    let clientId = getOrCreateClientId();

    let roomUnsubscribe = null;
    let messagesUnsubscribe = null;
    let connectionUnsubscribe = null;
    let presenceTimer = null;
    let hasSeenConnection = false;
    let hasShownLostConnection = false;

    let isApplyingRemoteUpdate = false;
    let ignorePlayerEventsUntil = 0;
    let pendingRemoteState = null;
    let lastKnownVersion = 0;
    let lastAppliedStateAt = 0;
    let lastTimeUpdateSentAt = 0;
    let lastKnownPlayerTime = 0;
    let seekStartTime = 0;
    let isChatHidden = false;
    let isChatFullscreen = false;
    let messageItems = [];

    initFirebase();
    setupEvents();
    resolveIdentity();

    function initFirebase() {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            firebaseReady = true;
        } catch (error) {
            firebaseReady = false;
            console.warn("Firebase não conectado:", error);
            setConnectionStatus("Firebase não conectado", "offline");
            showToast("Firebase não conectado", "A sessão local abre, mas a sincronia e o chat dependem do Firebase.", "error");
        }
    }

    function setupEvents() {
        els.retryVideoButton?.addEventListener("click", () => {
            loadVideo(currentVideoUrl || DEFAULT_VIDEO_URL, { keepNotice: true });
        });

        els.movieSettingsForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            updateMovieSettings();
        });

        els.sharePaulaButton?.addEventListener("click", shareWithPaula);
        els.copyRoomButton?.addEventListener("click", copyRoomLink);

        els.chatForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            sendChatMessage();
        });

        els.messageInput?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            els.chatForm?.requestSubmit();
        });

        els.toggleChatButton?.addEventListener("click", () => setChatHidden(!isChatHidden));
        els.hideChatButton?.addEventListener("click", () => setChatHidden(true));
        els.chatFullscreenButton?.addEventListener("click", () => setChatFullscreen(!isChatFullscreen));
        els.messageTicker?.addEventListener("click", () => setChatHidden(false));
        els.messageTicker?.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setChatHidden(false);
            }
        });

        els.nameForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            const nextName = sanitizeText(els.nameInput?.value, 32);
            if (!nextName) {
                showToast("Nome obrigatório", "Digite um nome para entrar na sala.", "warning");
                els.nameInput?.focus();
                return;
            }
            setIdentity(nextName);
            els.nameModal.hidden = true;
            startApp();
        });

        setupVideoEvents();
    }

    function setupVideoEvents() {
        const video = els.moviePlayer;
        if (!video) return;

        video.addEventListener("loadedmetadata", () => {
            hideVideoError();
            if (pendingRemoteState) {
                const state = pendingRemoteState;
                pendingRemoteState = null;
                applyRemoteState(state, { force: true });
                return;
            }
            showVideoNotice("Clique em play para iniciar sincronizado.");
        });

        video.addEventListener("play", () => {
            hideVideoNotice();
            if (shouldIgnorePlayerEvent()) return;
            sendPlayerState("play");
        });

        video.addEventListener("pause", () => {
            if (video.ended || shouldIgnorePlayerEvent()) return;
            showVideoNotice("Pausado. O outro player acompanha automaticamente.");
            sendPlayerState("pause");
        });

        video.addEventListener("seeking", () => {
            seekStartTime = lastKnownPlayerTime || video.currentTime || 0;
        });

        video.addEventListener("seeked", () => {
            if (shouldIgnorePlayerEvent()) return;
            const currentTime = video.currentTime || 0;
            const action = currentTime > seekStartTime + TIME_SYNC_THRESHOLD
                ? "forward"
                : currentTime < seekStartTime - TIME_SYNC_THRESHOLD
                    ? "rewind"
                    : "seek";
            sendPlayerState(action);
            lastKnownPlayerTime = currentTime;
        });

        video.addEventListener("timeupdate", () => {
            const now = Date.now();
            if (!shouldIgnorePlayerEvent() && !video.paused && roomId && now - lastTimeUpdateSentAt > TIME_UPDATE_THROTTLE) {
                lastTimeUpdateSentAt = now;
                sendPlayerState("time");
            }
            lastKnownPlayerTime = video.currentTime || 0;
        });

        video.addEventListener("error", () => {
            showVideoError("Não foi possível carregar o vídeo. Verifique o link MP4 e tente novamente.");
            setSyncStatus("Erro ao carregar vídeo", "warning");
            showToast("Erro ao carregar vídeo", "O player não conseguiu abrir esse MP4.", "error");
        });
    }

    function resolveIdentity() {
        if (isHost) {
            setIdentity("Rodrigo");
            startApp();
            return;
        }

        if (isPaulaGuest) {
            setIdentity("Paula");
            startApp();
            return;
        }

        const savedName = sanitizeText(localStorage.getItem(USER_NAME_KEY), 32);
        if (els.nameInput && savedName) els.nameInput.value = savedName;
        els.nameModal.hidden = false;
        setTimeout(() => els.nameInput?.focus(), 60);
    }

    function startApp() {
        if (appStarted) return;
        appStarted = true;

        document.body.classList.toggle("rp-is-host", isHost);
        if (els.organizerPanel) els.organizerPanel.hidden = !isHost;
        if (els.movieTitleInput) els.movieTitleInput.value = DEFAULT_MOVIE_TITLE;
        if (els.videoUrlInput) els.videoUrlInput.value = DEFAULT_VIDEO_URL;

        loadVideo(DEFAULT_VIDEO_URL, { keepNotice: true });
        setRoomStatus(roomId ? "Entrando..." : "Sem sala");
        setSyncStatus(roomId ? "Conectando..." : "Aguardando sala", roomId ? "warning" : "neutral");
        renderParticipants({});
        updateTicker();
        watchConnection();

        if (roomId) {
            enterRoom(roomId);
        } else {
            setConnectionStatus(firebaseReady ? "Pronto" : "Firebase não conectado", firebaseReady ? "connected" : "offline");
        }
    }

    function getOrCreateClientId() {
        const saved = localStorage.getItem(CLIENT_ID_KEY);
        if (saved) return saved;
        const next = `rp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_ID_KEY, next);
        return next;
    }

    function setIdentity(name) {
        userName = sanitizeText(name, 32) || "Visitante";
        userKey = normalizeUserKey(userName);
        localStorage.setItem(USER_NAME_KEY, userName);
    }

    function normalizeUserKey(name) {
        const clean = String(name || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        if (clean.includes("rodrigo")) return "rodrigo";
        if (clean.includes("paula")) return "paula";
        return clean || clientId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    }

    function sanitizeRoomId(value) {
        const clean = String(value || "").trim();
        return /^[a-zA-Z0-9_-]{6,40}$/.test(clean) ? clean : "";
    }

    function generateRoomId() {
        const random = Math.random().toString(36).slice(2, 8);
        return `rp-${Date.now().toString(36)}-${random}`;
    }

    function sanitizeText(value, maxLength = 240) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, maxLength);
    }

    function isValidMp4Url(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return ["http:", "https:"].includes(parsed.protocol) && /\.mp4$/i.test(parsed.pathname);
        } catch (_) {
            return false;
        }
    }

    function roomPath(path = "") {
        return `watchRooms/${roomId}${path ? `/${path}` : ""}`;
    }

    async function enterRoom(nextRoomId) {
        if (!firebaseReady || !db) {
            setConnectionStatus("Firebase não conectado", "offline");
            setSyncStatus("Firebase não conectado", "warning");
            return;
        }

        roomId = sanitizeRoomId(nextRoomId);
        if (!roomId) {
            setRoomStatus("Sala inválida");
            showToast("Sala inválida", "O link da sala não tem um ID válido.", "error");
            return;
        }

        setRoomStatus("Entrando...");
        setSyncStatus("Conectando...", "warning");

        try {
            const snapshot = await get(ref(db, roomPath()));
            if (!snapshot.exists()) {
                handleRoomNotFound();
                return;
            }

            roomMissing = false;
            subscribeToRoom();
            await markParticipantOnline();
            setRoomStatus(`Sala ${roomId.slice(-6).toUpperCase()}`);
            showToast("Sala conectada", "O cinema privado está sincronizando.", "success");
        } catch (error) {
            console.warn("Erro ao entrar na sala:", error);
            setSyncStatus("Erro de conexão", "warning");
            showToast("Erro ao abrir sala", "Não foi possível carregar essa sala agora.", "error");
        }
    }

    function handleRoomNotFound() {
        currentRoom = null;
        roomMissing = true;
        setRoomStatus("Sala não encontrada");
        setSyncStatus("Sala não encontrada", "warning");
        showToast("Sala não encontrada", "Peça um novo link ou crie uma nova sala.", "error");

        if (isHost) {
            roomId = "";
            roomMissing = false;
            replaceRoomInUrl("");
            setRoomStatus("Sem sala");
        }
    }

    function subscribeToRoom() {
        roomUnsubscribe?.();
        messagesUnsubscribe?.();

        roomUnsubscribe = onValue(ref(db, roomPath()), (snapshot) => {
            if (!snapshot.exists()) {
                handleRoomNotFound();
                return;
            }
            currentRoom = snapshot.val() || {};
            roomMissing = false;
            renderRoom(currentRoom);
        }, (error) => {
            console.warn("Erro ao acompanhar sala:", error);
            setSyncStatus("Conexão perdida", "warning");
            showToast("Conexão perdida", "Não foi possível acompanhar a sala em tempo real.", "error");
        });

        messagesUnsubscribe = onValue(query(ref(db, roomPath("messages")), limitToLast(80)), (snapshot) => {
            renderMessages(snapshot);
        }, (error) => {
            console.warn("Erro ao acompanhar chat:", error);
            showToast("Chat indisponível", "As mensagens não puderam ser carregadas agora.", "error");
        });
    }

    function renderRoom(room) {
        const nextTitle = sanitizeText(room.movieTitle, 80) || DEFAULT_MOVIE_TITLE;
        const nextVideoUrl = sanitizeText(room.videoUrl, 500) || DEFAULT_VIDEO_URL;

        if (els.movieTitleDisplay) els.movieTitleDisplay.textContent = nextTitle;
        if (els.movieTitleInput && document.activeElement !== els.movieTitleInput) els.movieTitleInput.value = nextTitle;
        if (els.videoUrlInput && document.activeElement !== els.videoUrlInput) els.videoUrlInput.value = nextVideoUrl;

        if (nextVideoUrl !== currentVideoUrl) {
            loadVideo(nextVideoUrl, { keepNotice: true });
        }

        renderParticipants(room.participants || {});
        updateSyncStatusFromState(room.state);

        if (room.state) {
            applyRemoteState(room.state);
        }
    }

    async function createRoomIfNeeded() {
        if (roomId) return roomId;
        if (!firebaseReady || !db) {
            throw new Error("Firebase não conectado");
        }

        roomId = generateRoomId();
        const now = Date.now();
        const title = sanitizeText(els.movieTitleInput?.value, 80) || DEFAULT_MOVIE_TITLE;
        const videoUrl = sanitizeText(els.videoUrlInput?.value, 500) || DEFAULT_VIDEO_URL;

        if (!isValidMp4Url(videoUrl)) {
            roomId = "";
            throw new Error("Link MP4 inválido");
        }

        const initialState = {
            isPlaying: false,
            currentTime: 0,
            updatedAt: now,
            updatedBy: userKey,
            updatedByName: userName,
            updatedByClient: clientId,
            action: "room-created",
            version: 1
        };

        const payload = {
            videoUrl,
            movieTitle: title,
            createdAt: now,
            createdBy: userKey,
            updatedAt: now,
            state: initialState,
            participants: {
                [userKey]: participantPayload(true)
            },
            messages: {}
        };

        await set(ref(db, roomPath()), payload);
        roomMissing = false;
        lastKnownVersion = 1;
        lastAppliedStateAt = Math.max(lastAppliedStateAt, now);
        replaceRoomInUrl(roomId);
        subscribeToRoom();
        await markParticipantOnline();
        setRoomStatus(`Sala ${roomId.slice(-6).toUpperCase()}`);
        setSyncStatus("Sincronizado", "active");
        return roomId;
    }

    function participantPayload(online) {
        return {
            name: userName,
            key: userKey,
            role: isHost ? "host" : "guest",
            online,
            joinedAt: Date.now(),
            lastSeen: Date.now()
        };
    }

    async function markParticipantOnline() {
        if (!roomId || !firebaseReady || !db || !userKey) return;
        const participantRef = ref(db, roomPath(`participants/${userKey}`));
        await update(participantRef, participantPayload(true));
        onDisconnect(participantRef).update({
            name: userName,
            key: userKey,
            role: isHost ? "host" : "guest",
            online: false,
            lastSeen: Date.now()
        }).catch(() => {});

        clearInterval(presenceTimer);
        presenceTimer = setInterval(() => {
            update(participantRef, {
                name: userName,
                key: userKey,
                role: isHost ? "host" : "guest",
                online: true,
                lastSeen: Date.now()
            }).catch(() => {});
        }, PRESENCE_INTERVAL);
    }

    function watchConnection() {
        if (!firebaseReady || !db || connectionUnsubscribe) return;

        connectionUnsubscribe = onValue(ref(db, ".info/connected"), (snapshot) => {
            const connected = snapshot.val() === true;
            if (connected) {
                hasSeenConnection = true;
                hasShownLostConnection = false;
                setConnectionStatus("Conectado", "connected");
                if (roomId) setSyncStatus("Sincronizado", "active");
                return;
            }

            setConnectionStatus("Conectando...", "warning");
            if (hasSeenConnection && !hasShownLostConnection) {
                hasShownLostConnection = true;
                setSyncStatus("Conexão perdida", "warning");
                showToast("Conexão perdida", "A sala tenta reconectar automaticamente.", "warning");
            }
        });
    }

    function loadVideo(url, options = {}) {
        const cleanUrl = sanitizeText(url, 500);
        if (!isValidMp4Url(cleanUrl)) {
            showVideoError("Link inválido. Use um endereço HTTP/HTTPS apontando para um arquivo .mp4.");
            showToast("Link inválido", "Use um link MP4 permitido para reprodução.", "warning");
            return false;
        }

        currentVideoUrl = cleanUrl;
        ignorePlayerEventsUntil = Date.now() + 900;
        isApplyingRemoteUpdate = true;

        hideVideoError();
        if (options.keepNotice !== false) showVideoNotice("Clique em play para iniciar sincronizado.");

        if (els.moviePlayer) {
            els.moviePlayer.src = cleanUrl;
            els.moviePlayer.load();
        }

        setTimeout(() => {
            isApplyingRemoteUpdate = false;
        }, 750);
        return true;
    }

    async function updateMovieSettings() {
        if (!isHost) return;

        const title = sanitizeText(els.movieTitleInput?.value, 80) || DEFAULT_MOVIE_TITLE;
        const videoUrl = sanitizeText(els.videoUrlInput?.value, 500) || DEFAULT_VIDEO_URL;

        if (!isValidMp4Url(videoUrl)) {
            setSettingsFeedback("Link inválido. Use um MP4 externo com permissão de reprodução.", true);
            showToast("Link inválido", "O endereço precisa ser HTTP/HTTPS e terminar em .mp4.", "warning");
            return;
        }

        if (!firebaseReady || !db) {
            if (loadVideo(videoUrl, { keepNotice: true })) {
                if (els.movieTitleDisplay) els.movieTitleDisplay.textContent = title;
            }
            setSettingsFeedback("Firebase não conectado. O filme mudou só neste navegador.", true);
            return;
        }

        try {
            await createRoomIfNeeded();
            const now = Date.now();
            const nextState = {
                isPlaying: false,
                currentTime: 0,
                updatedAt: now,
                updatedBy: userKey,
                updatedByName: userName,
                updatedByClient: clientId,
                action: "video",
                version: Math.max(lastKnownVersion + 1, 1)
            };
            lastKnownVersion = nextState.version;
            lastAppliedStateAt = Math.max(lastAppliedStateAt, now);

            await update(ref(db, roomPath()), {
                movieTitle: title,
                videoUrl,
                updatedAt: now,
                state: nextState
            });

            setSettingsFeedback("Filme atualizado na sala em tempo real.");
            showToast("Filme atualizado", "Rodrigo e Paula receberão o novo player.", "success");
        } catch (error) {
            console.warn("Erro ao atualizar filme:", error);
            setSettingsFeedback(error.message || "Não foi possível atualizar a sessão.", true);
            showToast("Erro ao atualizar", "Confira a conexão com o Firebase.", "error");
        }
    }

    async function shareWithPaula() {
        if (!isHost) return;

        try {
            await createRoomIfNeeded();
            const link = buildGuestLink();
            await copyText(link);
            showToast("Link copiado!", "Envie para Paula.", "success");
            setSettingsFeedback("Link da Paula copiado para a área de transferência.");
        } catch (error) {
            console.warn("Erro ao compartilhar:", error);
            showToast("Não foi possível compartilhar", error.message || "Tente novamente em alguns segundos.", "error");
            setSettingsFeedback(error.message || "Não foi possível copiar o link.", true);
        }
    }

    async function copyRoomLink() {
        if (!isHost) return;

        try {
            await createRoomIfNeeded();
            await copyText(buildGuestLink());
            showToast("Link copiado!", "A sala privada está pronta para enviar.", "success");
        } catch (error) {
            console.warn("Erro ao copiar link:", error);
            showToast("Não foi possível copiar", error.message || "Crie a sala novamente.", "error");
        }
    }

    function buildGuestLink() {
        const url = new URL(window.location.href);
        url.search = "";
        url.searchParams.set("room", roomId);
        url.searchParams.set("guest", "paula");
        return url.toString();
    }

    function replaceRoomInUrl(nextRoomId) {
        const url = new URL(window.location.href);
        if (nextRoomId) {
            url.searchParams.set("room", nextRoomId);
            if (isHost) url.searchParams.set("host", "rodrigo");
        } else {
            url.searchParams.delete("room");
        }
        window.history.replaceState({}, "", url.toString());
    }

    async function sendChatMessage() {
        const text = sanitizeText(els.messageInput?.value, 240);
        if (!text) {
            if (els.messageInput) els.messageInput.value = "";
            return;
        }

        if ((!roomId || roomMissing) && !isHost) {
            showToast("Sala necessária", "Entre pelo link compartilhado para conversar.", "warning");
            return;
        }

        try {
            if (!roomId) await createRoomIfNeeded();
            if (!firebaseReady || !db) throw new Error("Firebase não conectado");

            await push(ref(db, roomPath("messages")), {
                name: userName,
                userKey,
                text,
                createdAt: Date.now()
            });
            await update(ref(db, roomPath()), { updatedAt: Date.now() });
            if (els.messageInput) els.messageInput.value = "";
        } catch (error) {
            console.warn("Erro ao enviar mensagem:", error);
            showToast("Mensagem não enviada", error.message || "Confira a conexão da sala.", "error");
        }
    }

    function renderMessages(snapshot) {
        const nextMessages = [];
        snapshot.forEach((childSnapshot) => {
            nextMessages.push({
                id: childSnapshot.key,
                ...(childSnapshot.val() || {})
            });
        });

        messageItems = nextMessages
            .filter((message) => message && message.text)
            .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));

        if (!els.messagesList) return;
        els.messagesList.replaceChildren();

        if (!messageItems.length) {
            const empty = document.createElement("div");
            empty.className = "rp-empty-chat";
            empty.textContent = "As mensagens aparecem aqui em tempo real.";
            els.messagesList.appendChild(empty);
            updateTicker();
            return;
        }

        messageItems.slice(-80).forEach((message) => {
            const item = document.createElement("article");
            const key = normalizeUserKey(message.userKey || message.name);
            item.className = `rp-message from-${key} ${key === userKey ? "from-me" : ""}`;

            const meta = document.createElement("div");
            meta.className = "rp-message-meta";

            const name = document.createElement("strong");
            name.textContent = sanitizeText(message.name, 40) || "Visitante";

            const time = document.createElement("span");
            time.textContent = formatMessageTime(message.createdAt);

            const text = document.createElement("p");
            text.textContent = sanitizeText(message.text, 240);

            meta.append(name, time);
            item.append(meta, text);
            els.messagesList.appendChild(item);
        });

        els.messagesList.scrollTop = els.messagesList.scrollHeight;
        updateTicker();
    }

    function updateTicker() {
        const ticker = els.messageTicker;
        const track = els.tickerTrack;
        if (!ticker || !track) return;

        ticker.hidden = !isChatHidden;
        const latest = messageItems.slice(-6);
        track.textContent = latest.length
            ? latest.map((message) => `${sanitizeText(message.name, 28) || "Visitante"}: ${sanitizeText(message.text, 80)}`).join("   •   ")
            : "Nenhuma mensagem ainda.";
    }

    function setChatHidden(hidden) {
        isChatHidden = hidden;
        if (hidden) setChatFullscreen(false);
        document.body.classList.toggle("rp-chat-hidden", isChatHidden);

        if (els.toggleChatButton) {
            els.toggleChatButton.innerHTML = isChatHidden
                ? '<i class="ph-fill ph-chat-circle-dots"></i> Mostrar chat'
                : '<i class="ph-fill ph-chat-circle-dots"></i> Ocultar chat';
        }

        updateTicker();
    }

    function setChatFullscreen(fullscreen) {
        isChatFullscreen = fullscreen && !isChatHidden;
        document.body.classList.toggle("rp-chat-fullscreen", isChatFullscreen);

        const icon = els.chatFullscreenButton?.querySelector("i");
        if (icon) icon.className = isChatFullscreen ? "ph-fill ph-corners-in" : "ph-fill ph-corners-out";
        if (els.chatFullscreenButton) {
            els.chatFullscreenButton.title = isChatFullscreen ? "Sair da tela cheia do chat" : "Tela cheia do chat";
            els.chatFullscreenButton.setAttribute("aria-label", els.chatFullscreenButton.title);
        }
    }

    async function sendPlayerState(action) {
        const video = els.moviePlayer;
        if (!video || !roomId || !firebaseReady || !db) return;
        if (isApplyingRemoteUpdate || Date.now() < ignorePlayerEventsUntil) return;

        const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
        const now = Date.now();
        const nextState = {
            isPlaying: !video.paused && !video.ended,
            currentTime,
            updatedAt: now,
            updatedBy: userKey,
            updatedByName: userName,
            updatedByClient: clientId,
            action,
            version: Math.max((Number(lastKnownVersion) || 0) + 1, 1)
        };

        lastKnownVersion = nextState.version;
        lastAppliedStateAt = Math.max(lastAppliedStateAt, now);

        try {
            await update(ref(db, roomPath()), {
                state: nextState,
                updatedAt: now
            });
            if (action !== "time") updateSyncStatusFromState(nextState);
        } catch (error) {
            console.warn("Erro ao sincronizar player:", error);
            setSyncStatus("Erro ao sincronizar", "warning");
        }
    }

    function shouldIgnorePlayerEvent() {
        return isApplyingRemoteUpdate || Date.now() < ignorePlayerEventsUntil;
    }

    function applyRemoteState(remoteState, options = {}) {
        const video = els.moviePlayer;
        if (!video || !remoteState) return;

        const remoteVersion = Number(remoteState.version) || 0;
        const remoteAt = Number(remoteState.updatedAt) || 0;
        lastKnownVersion = Math.max(lastKnownVersion, remoteVersion);

        if (!options.force && remoteState.updatedByClient === clientId) return;
        if (!options.force && remoteAt && remoteAt < lastAppliedStateAt) return;
        if (video.readyState < 1) {
            pendingRemoteState = remoteState;
            return;
        }

        lastAppliedStateAt = Math.max(lastAppliedStateAt, remoteAt);
        const targetTime = estimateRemoteTime(remoteState);
        const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        const shouldSeek = Number.isFinite(targetTime) && Math.abs(currentTime - targetTime) > TIME_SYNC_THRESHOLD;

        isApplyingRemoteUpdate = true;
        ignorePlayerEventsUntil = Date.now() + 1200;

        try {
            if (shouldSeek) {
                video.currentTime = targetTime;
            }

            if (remoteState.isPlaying) {
                const playPromise = video.play();
                if (playPromise?.catch) {
                    playPromise.catch(() => {
                        showVideoNotice("Clique em play para iniciar sincronizado.");
                        setSyncStatus("Clique em play para sincronizar", "warning");
                    });
                }
            } else if (!video.paused) {
                video.pause();
            }
        } catch (error) {
            console.warn("Erro ao aplicar atualização remota:", error);
        } finally {
            setTimeout(() => {
                isApplyingRemoteUpdate = false;
            }, 650);
        }
    }

    function estimateRemoteTime(remoteState) {
        let target = Number(remoteState.currentTime) || 0;
        if (remoteState.isPlaying && remoteState.updatedAt) {
            target += Math.max(0, Date.now() - Number(remoteState.updatedAt)) / 1000;
        }

        const duration = Number(els.moviePlayer?.duration);
        if (Number.isFinite(duration) && duration > 0) {
            target = Math.min(target, Math.max(0, duration - 0.2));
        }

        return Math.max(0, target);
    }

    function updateSyncStatusFromState(state) {
        if (!state) {
            setSyncStatus("Aguardando sala", "neutral");
            return;
        }

        const label = describePlayerAction(state);
        const active = state.isPlaying ? "active" : "neutral";
        setSyncStatus(label, active);
        setPlayerBadge(state.isPlaying ? "Reproduzindo" : "Pausado", state.isPlaying);
    }

    function describePlayerAction(state) {
        if (state.updatedByClient === clientId && state.action !== "video") return "Sincronizado";
        const actor = sanitizeText(state.updatedByName, 32) || (state.updatedBy === "paula" ? "Paula" : "Rodrigo");

        switch (state.action) {
            case "play":
                return `${actor} deu play`;
            case "pause":
                return `${actor} pausou`;
            case "forward":
                return `${actor} avançou o filme`;
            case "rewind":
                return `${actor} voltou o filme`;
            case "seek":
                return `${actor} ajustou o tempo`;
            case "video":
                return `${actor} atualizou o filme`;
            case "room-created":
                return "Sala criada";
            default:
                return "Sincronizado";
        }
    }

    function renderParticipants(participants) {
        const entries = Object.entries(participants || {})
            .map(([key, participant]) => ({ key, ...(participant || {}) }))
            .filter((participant) => participant.online !== false && Date.now() - (Number(participant.lastSeen) || 0) < 90000)
            .sort((a, b) => {
                const order = { rodrigo: 1, paula: 2 };
                return (order[a.key] || 9) - (order[b.key] || 9);
            });

        const count = entries.length;
        if (els.participantsBadge) {
            els.participantsBadge.querySelector("span").textContent = `${count} online`;
        }

        if (!els.participantsList) return;
        els.participantsList.replaceChildren();

        if (!roomId) {
            const chip = createParticipantChip("Aguardando sala", "muted");
            els.participantsList.appendChild(chip);
            return;
        }

        if (!entries.length) {
            const chip = createParticipantChip("Sem participantes online", "muted");
            els.participantsList.appendChild(chip);
            return;
        }

        entries.forEach((participant) => {
            const chip = createParticipantChip(sanitizeText(participant.name, 32) || participant.key, participant.key);
            els.participantsList.appendChild(chip);
        });
    }

    function createParticipantChip(label, modifier) {
        const chip = document.createElement("span");
        chip.className = `rp-participant-chip ${modifier || ""}`.trim();
        const icon = document.createElement("i");
        icon.className = modifier === "paula" ? "ph-fill ph-heart" : "ph-fill ph-user-circle";
        const text = document.createElement("span");
        text.textContent = label;
        chip.append(icon, text);
        return chip;
    }

    function setConnectionStatus(message, mode = "warning") {
        if (!els.connectionBadge) return;
        els.connectionBadge.classList.toggle("is-connected", mode === "connected");
        els.connectionBadge.classList.toggle("is-offline", mode === "offline");
        const icon = els.connectionBadge.querySelector("i");
        const label = els.connectionBadge.querySelector("span");
        if (icon) {
            icon.className = mode === "connected"
                ? "ph-fill ph-wifi-high"
                : mode === "offline"
                    ? "ph-fill ph-wifi-x"
                    : "ph-fill ph-circle-notch";
        }
        if (label) label.textContent = message;
    }

    function setRoomStatus(message) {
        if (!els.roomBadge) return;
        const label = els.roomBadge.querySelector("span");
        if (label) label.textContent = message;
    }

    function setSyncStatus(message, mode = "neutral") {
        if (!els.syncStatus) return;
        els.syncStatus.classList.toggle("is-warning", mode === "warning");
        const label = els.syncStatus.querySelector("span");
        if (label) label.textContent = message;
    }

    function setPlayerBadge(message, isActive) {
        if (!els.playerStateBadge) return;
        els.playerStateBadge.textContent = message;
        els.playerStateBadge.classList.toggle("is-active", !!isActive);
    }

    function setSettingsFeedback(message, isWarning = false) {
        if (!els.settingsFeedback) return;
        els.settingsFeedback.textContent = message || "";
        els.settingsFeedback.classList.toggle("is-warning", !!isWarning);
    }

    function showVideoNotice(message) {
        if (!els.videoNotice) return;
        const label = els.videoNotice.querySelector("span");
        if (label) label.textContent = message;
        els.videoNotice.hidden = false;
    }

    function hideVideoNotice() {
        if (els.videoNotice) els.videoNotice.hidden = true;
    }

    function showVideoError(message) {
        if (!els.videoErrorCard) return;
        const text = els.videoErrorCard.querySelector("span");
        if (text) text.textContent = message;
        els.videoErrorCard.hidden = false;
    }

    function hideVideoError() {
        if (els.videoErrorCard) els.videoErrorCard.hidden = true;
    }

    function formatMessageTime(value) {
        const date = new Date(Number(value) || Date.now());
        return date.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    async function copyText(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (_) {
                // Fallback below.
            }
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }

    function showToast(title, message, type = "success") {
        if (!els.toastStack) return;
        const toast = document.createElement("div");
        toast.className = `rp-toast is-${type}`;

        const icon = document.createElement("i");
        icon.className = type === "error"
            ? "ph-fill ph-warning-circle"
            : type === "warning"
                ? "ph-fill ph-info"
                : "ph-fill ph-check-circle";

        const content = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = title;
        const span = document.createElement("span");
        span.textContent = message;

        content.append(strong, span);
        toast.append(icon, content);
        els.toastStack.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(8px)";
            setTimeout(() => toast.remove(), 220);
        }, 4200);
    }
});
