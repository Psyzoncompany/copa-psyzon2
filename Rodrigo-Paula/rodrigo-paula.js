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
import {
    getStorage,
    ref as storageRef,
    uploadBytesResumable,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
    const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
    const ALLOWED_UPLOAD_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi"];

    const params = new URLSearchParams(window.location.search);
    const isHost = String(params.get("host") || "").toLowerCase() === "rodrigo";
    const isPaulaGuest = String(params.get("guest") || "").toLowerCase() === "paula";

    const $ = (selector) => document.querySelector(selector);

    const els = {
        connectionBadge: $("#connectionBadge"),
        roomBadge: $("#roomBadge"),
        syncStatus: $("#sync-status"),
        participantsBadge: $("#participantsBadge"),
        movieTitleDisplay: $("#movieTitleDisplay"),
        playerStateBadge: $("#playerStateBadge"),
        videoContainer: $("#video-container"),
        moviePlayer: null,
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
        uploadFileInput: $("#uploadFileInput"),
        uploadFileName: $("#uploadFileName"),
        uploadFileSize: $("#uploadFileSize"),
        uploadWarning: $("#uploadWarning"),
        uploadButton: $("#uploadButton"),
        uploadProgress: $("#uploadProgress"),
        uploadProgressText: $("#uploadProgressText"),
        uploadStatus: $("#uploadStatus"),
        mediaStatusType: $("#mediaStatusType"),
        mediaStatusMode: $("#mediaStatusMode"),
        mediaStatusSync: $("#mediaStatusSync"),
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
    let storage = null;
    let firebaseReady = false;
    let appStarted = false;
    let roomId = sanitizeRoomId(params.get("room"));
    let currentRoom = null;
    let currentVideoUrl = "";
    let currentMediaType = "direct";
    let iframeLoadTimer = null;
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
    let selectedUploadFile = null;
    let uploadTask = null;

    initFirebase();
    setupEvents();
    resolveIdentity();

    function initFirebase() {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            storage = getStorage(app);
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
        els.uploadFileInput?.addEventListener("change", handleUploadSelection);
        els.uploadButton?.addEventListener("click", uploadSelectedMovie);

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

    }

    function setupSync(video) {
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
            showVideoError("Não foi possível carregar o vídeo. Verifique o link direto e tente novamente.");
            setSyncStatus("Erro ao carregar vídeo", "warning");
            showToast("Erro ao carregar vídeo", "O player não conseguiu abrir esse link direto.", "error");
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

    function getMediaType(value) {
        const url = String(value || "").toLowerCase();
        return [".mp4", ".m3u8", ".webm", ".ogg"].some((extension) => url.includes(extension))
            ? "direct"
            : "iframe";
    }

    function isGoogleDriveUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return parsed.hostname.replace(/^www\./, "").toLowerCase() === "drive.google.com";
        } catch (_) {
            return false;
        }
    }

    function isYouFilesUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return parsed.hostname.replace(/^www\./, "").toLowerCase() === "youfiles.herokuapp.com";
        } catch (_) {
            return false;
        }
    }

    function isGoogleDriveFolderUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return parsed.hostname.replace(/^www\./, "").toLowerCase() === "drive.google.com"
                && parsed.pathname.includes("/drive/folders/");
        } catch (_) {
            return false;
        }
    }

    function extractGoogleDriveFileId(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
            if (fileMatch?.[1]) return fileMatch[1];
            const id = parsed.searchParams.get("id");
            return id || null;
        } catch (_) {
            const fileMatch = String(value || "").match(/\/file\/d\/([^/?#]+)/);
            return fileMatch?.[1] || null;
        }
    }

    function buildGoogleDriveLinks(originalUrl, fileId) {
        return {
            originalUrl,
            provider: "google-drive",
            fileId,
            directUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
            embedUrl: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
            viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
        };
    }

    function extractYouFilesGoogleDriveFileId(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            const rawState = parsed.searchParams.get("state");
            if (!rawState) return null;
            const decoded = decodeURIComponent(rawState);
            const state = JSON.parse(decoded);
            const id = Array.isArray(state?.ids) ? state.ids[0] : null;
            return typeof id === "string" && id.trim() ? id.trim() : null;
        } catch (error) {
            console.warn("Não foi possível extrair ID do YouFiles:", error);
            return null;
        }
    }

    function toMegaEmbedUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            if (!parsed.hostname.toLowerCase().includes("mega.")) return "";
            return parsed.href.replace("/file/", "/embed/");
        } catch (_) {
            return "";
        }
    }

    function isValidMediaUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return ["http:", "https:"].includes(parsed.protocol);
        } catch (_) {
            return false;
        }
    }

    function isHtml5Playable(fileType, fileName) {
        const type = String(fileType || "").toLowerCase();
        const name = String(fileName || "").toLowerCase();
        if (["video/mp4", "video/webm", "video/ogg"].includes(type)) return true;
        if ([".mp4", ".webm", ".ogg"].some((extension) => name.endsWith(extension))) return true;
        if (type === "video/quicktime" || name.endsWith(".mov")) return "warning";
        if (name.endsWith(".mkv") || name.endsWith(".avi") || type.includes("matroska") || type.includes("x-msvideo")) return "warning";
        return "warning";
    }

    function getUploadWarning(file) {
        const playable = isHtml5Playable(file?.type, file?.name);
        if (playable === true) return "";
        return "Seu navegador pode não reproduzir este formato. Para melhor sincronização, use MP4 H.264.";
    }

    function isAllowedUploadFile(fileName) {
        const name = String(fileName || "").toLowerCase();
        return ALLOWED_UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension));
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
        if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
        if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${value} B`;
    }

    function safeStorageFileName(name) {
        const clean = String(name || "filme")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
        return clean || "filme";
    }

    function validatePlayableVideo(url) {
        return new Promise((resolve) => {
            const video = document.createElement("video");
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                video.removeAttribute("src");
                video.load();
                resolve(result);
            };
            const timer = setTimeout(() => finish(false), 8000);
            video.preload = "metadata";
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = () => finish(true);
            video.onerror = () => finish(false);
            video.src = url;
            video.load();
        });
    }

    async function processGoogleDriveUrl(originalUrl) {
        if (isGoogleDriveFolderUrl(originalUrl)) {
            throw new Error("Esse link é de uma pasta. Cole o link do arquivo de vídeo.");
        }

        const fileId = extractGoogleDriveFileId(originalUrl);
        if (!fileId) {
            throw new Error("Não consegui identificar o arquivo do Google Drive.");
        }

        const links = buildGoogleDriveLinks(originalUrl, fileId);
        setSettingsFeedback("Verificando link do Google Drive...");
        setMediaStatus("Google Drive", "Verificando", "Testando", "neutral");

        // Links do Google Drive podem falhar no <video> por bloqueio,
        // permissão, quota ou CORS. Por isso testamos primeiro o modo direto.
        // Se falhar, usamos o preview em iframe como fallback.
        const directWorks = await validatePlayableVideo(links.directUrl);
        if (directWorks) {
            return {
                ...links,
                videoUrl: links.directUrl,
                embedUrl: links.embedUrl,
                viewUrl: links.viewUrl,
                videoProvider: "google-drive",
                playerMode: "video",
                syncEnabled: true,
                statusMessage: "Google Drive carregado com sincronização ativa."
            };
        }

        return {
            ...links,
            videoUrl: links.embedUrl,
            embedUrl: links.embedUrl,
            viewUrl: links.viewUrl,
            videoProvider: "google-drive",
            playerMode: "iframe",
            syncEnabled: false,
            statusMessage: "Google Drive aberto em modo compatibilidade. A sincronização pode não funcionar.",
            warning: "O Google Drive pode bloquear vídeos grandes ou muitos acessos. Se travar, tente compactar o vídeo ou usar Firebase Storage. Se o arquivo não estiver público, defina como 'Qualquer pessoa com o link pode ver'."
        };
    }

    async function processYouFilesUrl(originalUrl) {
        setSettingsFeedback("Link YouFiles detectado. Tentando extrair vídeo do Google Drive...");
        setMediaStatus("YouFiles", "Extraindo Drive", "Testando", "neutral");

        const fileId = extractYouFilesGoogleDriveFileId(originalUrl);
        if (!fileId) {
            return {
                originalUrl,
                videoUrl: originalUrl,
                embedUrl: originalUrl,
                viewUrl: originalUrl,
                videoProvider: "youfiles",
                playerMode: "iframe",
                syncEnabled: false,
                statusMessage: "YouFiles aberto em modo compatibilidade. Não consegui extrair o ID do Google Drive.",
                warning: "Não consegui extrair o ID do Google Drive no parâmetro state; o link foi carregado como iframe externo."
            };
        }

        const links = buildGoogleDriveLinks(originalUrl, fileId);
        const directWorks = await validatePlayableVideo(links.directUrl);
        if (directWorks) {
            return {
                ...links,
                videoUrl: links.directUrl,
                embedUrl: links.embedUrl,
                viewUrl: links.viewUrl,
                videoProvider: "youfiles-google-drive",
                playerMode: "video",
                syncEnabled: true,
                statusMessage: "Link YouFiles convertido para Google Drive com sincronização ativa."
            };
        }

        return {
            ...links,
            videoUrl: links.embedUrl,
            embedUrl: links.embedUrl,
            viewUrl: links.viewUrl,
            videoProvider: "youfiles-google-drive",
            playerMode: "iframe",
            syncEnabled: false,
            statusMessage: "YouFiles convertido para Google Drive em modo compatibilidade. A sincronização pode não funcionar.",
            warning: "O Google Drive pode bloquear vídeos grandes ou muitos acessos. Se travar, tente compactar o vídeo ou usar Firebase Storage."
        };
    }

    async function loadMedia(inputUrl) {
        const originalUrl = sanitizeText(inputUrl, 800);
        if (!isValidMediaUrl(originalUrl)) {
            throw new Error("Link inválido. Use um endereço HTTP/HTTPS permitido.");
        }

        if (isYouFilesUrl(originalUrl)) {
            return processYouFilesUrl(originalUrl);
        }

        if (isGoogleDriveUrl(originalUrl)) {
            return processGoogleDriveUrl(originalUrl);
        }

        const megaEmbedUrl = toMegaEmbedUrl(originalUrl);
        if (megaEmbedUrl) {
            return {
                originalUrl,
                videoUrl: megaEmbedUrl,
                embedUrl: megaEmbedUrl,
                viewUrl: originalUrl,
                videoProvider: "mega",
                playerMode: "iframe",
                syncEnabled: false,
                statusMessage: "Mega aberto em modo compatibilidade. A sincronização pode não funcionar."
            };
        }

        if (getMediaType(originalUrl) === "direct") {
            return {
                originalUrl,
                videoUrl: originalUrl,
                embedUrl: "",
                viewUrl: originalUrl,
                videoProvider: "direct-link",
                playerMode: "video",
                syncEnabled: true,
                statusMessage: "Link direto carregado com sincronização ativa."
            };
        }

        return {
            originalUrl,
            videoUrl: originalUrl,
            embedUrl: originalUrl,
            viewUrl: originalUrl,
            videoProvider: "external-page",
            playerMode: "iframe",
            syncEnabled: false,
            statusMessage: "Player externo aberto em modo compatibilidade."
        };
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
        const formatWarning = room.uploadSource === "firebase-storage" ? getUploadWarning({
            type: room.videoType,
            name: room.videoName
        }) : "";
        const forceDirect = room.uploadSource === "firebase-storage" || room.playerMode === "video" || room.syncEnabled === true;

        if (els.movieTitleDisplay) els.movieTitleDisplay.textContent = nextTitle;
        if (els.movieTitleInput && document.activeElement !== els.movieTitleInput) els.movieTitleInput.value = nextTitle;
        if (els.videoUrlInput && document.activeElement !== els.videoUrlInput) els.videoUrlInput.value = room.originalUrl || room.viewUrl || nextVideoUrl;

        if (nextVideoUrl !== currentVideoUrl) {
            loadVideo(nextVideoUrl, {
                keepNotice: true,
                forceDirect,
                forceIframe: room.playerMode === "iframe" || room.syncEnabled === false,
                formatWarning
            });
        }

        setMediaStatusFromRoom(room);

        renderParticipants(room.participants || {});

        if (currentMediaType === "direct") {
            updateSyncStatusFromState(room.state);
        } else {
            setSyncStatus("Modo compatibilidade: sincronização limitada", "warning");
            setPlayerBadge("Modo compatibilidade", false);
        }

        if (room.state && currentMediaType === "direct") {
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

        if (!isValidMediaUrl(videoUrl)) {
            roomId = "";
            throw new Error("Link inválido");
        }

        const initialMediaMode = getMediaType(videoUrl) === "direct" ? "video" : "iframe";

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
            originalUrl: videoUrl,
            embedUrl: initialMediaMode === "iframe" ? videoUrl : "",
            viewUrl: videoUrl,
            videoProvider: initialMediaMode === "video" ? "direct-link" : "external-page",
            playerMode: initialMediaMode,
            syncEnabled: initialMediaMode === "video",
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
                if (roomId) {
                    setSyncStatus(
                        currentMediaType === "direct" ? "Sincronização ativa" : "Modo compatibilidade: sincronização limitada",
                        currentMediaType === "direct" ? "active" : "warning"
                    );
                }
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
        if (!isValidMediaUrl(cleanUrl)) {
            showVideoError("Link inválido. Use um endereço HTTP/HTTPS de vídeo direto ou página externa.");
            showToast("Link inválido", "Use um link HTTP/HTTPS permitido para reprodução.", "warning");
            return false;
        }

        currentVideoUrl = cleanUrl;
        currentMediaType = options.forceDirect ? "direct" : (options.forceIframe ? "iframe" : getMediaType(cleanUrl));
        ignorePlayerEventsUntil = Date.now() + 900;
        isApplyingRemoteUpdate = true;

        hideVideoError();
        clearTimeout(iframeLoadTimer);
        els.moviePlayer = null;
        if (els.videoContainer) els.videoContainer.replaceChildren();

        if (currentMediaType === "direct") {
            const video = document.createElement("video");
            video.id = "moviePlayer";
            video.className = "custom-player";
            video.controls = true;
            video.playsInline = true;
            video.preload = "auto";
            video.controlsList = "nodownload noplaybackrate";
            video.textContent = "Seu navegador não suporta vídeo HTML5.";
            video.src = cleanUrl;
            els.videoContainer?.appendChild(video);
            els.moviePlayer = video;
            setupSync(video);
            video.load();
            if (options.keepNotice !== false) showVideoNotice("Clique em play para iniciar sincronizado.");
            setSyncStatus("Sincronização ativa", "active");
            setPlayerBadge("Sincronização ativa", true);
            if (options.formatWarning) {
                showVideoNotice(`${options.formatWarning} Clique em play para testar a reprodução sincronizada.`);
            }
        } else {
            // IMPORTANTE:
            // Iframes de sites externos NÃO permitem controle via JS (play/pause/tempo)
            // devido a políticas de segurança do navegador (cross-origin).
            // Portanto, sincronização só funciona com vídeos diretos (.mp4, .m3u8).
            const iframe = document.createElement("iframe");
            iframe.className = "custom-player";
            iframe.src = cleanUrl;
            iframe.allowFullscreen = true;
            iframe.referrerPolicy = "no-referrer";
            iframe.loading = "lazy";
            iframe.title = "Player externo Rodrigo & Paula";
            iframe.addEventListener("load", () => {
                clearTimeout(iframeLoadTimer);
            });
            els.videoContainer?.appendChild(iframe);
            showVideoNotice("Este tipo de link usa um player externo. A sincronização em tempo real pode não funcionar.");
            setSyncStatus("Modo compatibilidade: sincronização limitada", "warning");
            setPlayerBadge("Modo compatibilidade", false);
            showToast("Modo compatibilidade", "Este link abriu em player externo; play, pause e tempo não sincronizam.", "warning");
            iframeLoadTimer = setTimeout(() => {
                if (currentMediaType === "iframe") {
                    hideVideoNotice();
                    showVideoError("Não foi possível confirmar o carregamento deste conteúdo. Alguns sites bloqueiam abertura em iframe.", true);
                }
            }, 12000);
        }

        setTimeout(() => {
            isApplyingRemoteUpdate = false;
        }, 750);
        return true;
    }

    async function updateMovieSettings() {
        if (!isHost) return;

        const title = sanitizeText(els.movieTitleInput?.value, 80) || DEFAULT_MOVIE_TITLE;
        const inputUrl = sanitizeText(els.videoUrlInput?.value, 800) || DEFAULT_VIDEO_URL;

        if (!isValidMediaUrl(inputUrl)) {
            setSettingsFeedback("Link inválido. Use um endereço HTTP/HTTPS permitido.", true);
            showToast("Link inválido", "O endereço precisa começar com http:// ou https://.", "warning");
            setMediaStatus("Erro", "Não carregado", "Erro", "error");
            return;
        }

        let media;
        try {
            setSettingsFeedback("Preparando link...");
            media = await loadMedia(inputUrl);
        } catch (error) {
            const message = error.message || "Não foi possível carregar esse link.";
            setSettingsFeedback(message, true);
            setMediaStatus("Erro", "Não carregado", "Erro", "error");
            showToast("Link não carregado", message, "error");
            return;
        }

        if (!firebaseReady || !db) {
            if (loadVideo(media.videoUrl, {
                keepNotice: true,
                forceDirect: media.playerMode === "video",
                forceIframe: media.playerMode === "iframe"
            })) {
                if (els.movieTitleDisplay) els.movieTitleDisplay.textContent = title;
            }
            setMediaStatusFromDescriptor(media);
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
                action: "media_loaded",
                version: Math.max(lastKnownVersion + 1, 1)
            };
            lastKnownVersion = nextState.version;
            lastAppliedStateAt = Math.max(lastAppliedStateAt, now);

            await update(ref(db, roomPath()), {
                movieTitle: title,
                originalUrl: media.originalUrl,
                videoUrl: media.videoUrl,
                embedUrl: media.embedUrl || "",
                viewUrl: media.viewUrl || "",
                videoProvider: media.videoProvider,
                playerMode: media.playerMode,
                syncEnabled: media.syncEnabled,
                videoName: "",
                videoType: "",
                uploadedAt: null,
                uploadedBy: "",
                uploadSource: "external-link",
                updatedAt: now,
                state: nextState
            });

            setMediaStatusFromDescriptor(media);
            setSettingsFeedback(media.statusMessage || "Filme atualizado na sala em tempo real.", !media.syncEnabled);
            showToast("Filme atualizado", "Rodrigo e Paula receberão o novo player.", "success");
            if (media.warning) showToast("Aviso do Google Drive", media.warning, "warning");
        } catch (error) {
            console.warn("Erro ao atualizar filme:", error);
            setSettingsFeedback(error.message || "Não foi possível atualizar a sessão.", true);
            showToast("Erro ao atualizar", "Confira a conexão com o Firebase.", "error");
        }
    }

    function handleUploadSelection(event) {
        const file = event.target.files?.[0] || null;
        selectedUploadFile = file;
        setUploadProgress(0);

        if (!file) {
            setUploadMeta("Nenhum arquivo selecionado", "Escolha um filme para enviar.");
            setUploadWarning("");
            setUploadStatus("Aguardando arquivo");
            if (els.uploadButton) els.uploadButton.disabled = true;
            return;
        }

        setUploadMeta(file.name, `${formatBytes(file.size)} • ${file.type || "tipo não informado"}`);

        const warning = getUploadWarning(file);
        setUploadWarning(warning);

        if (!isAllowedUploadFile(file.name)) {
            setUploadStatus("Formato não permitido. Use MP4, WebM, OGG, MOV, MKV ou AVI.", true);
            if (els.uploadButton) els.uploadButton.disabled = true;
            return;
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            setUploadStatus("Arquivo muito grande. Limite atual: 1GB.", true);
            if (els.uploadButton) els.uploadButton.disabled = true;
            showToast("Arquivo muito grande", "Limite atual: 1GB.", "warning");
            return;
        }

        setUploadStatus(warning ? "Formato aceito com aviso de compatibilidade" : "Arquivo pronto para envio");
        if (els.uploadButton) els.uploadButton.disabled = !!uploadTask;
    }

    async function uploadSelectedMovie() {
        if (!isHost || uploadTask) return;
        if (!selectedUploadFile) {
            showToast("Selecione um arquivo", "Escolha um filme antes de enviar.", "warning");
            return;
        }
        if (!isAllowedUploadFile(selectedUploadFile.name)) {
            setUploadStatus("Formato não permitido. Use MP4, WebM, OGG, MOV, MKV ou AVI.", true);
            return;
        }
        if (selectedUploadFile.size > MAX_UPLOAD_BYTES) {
            setUploadStatus("Arquivo muito grande. Limite atual: 1GB.", true);
            return;
        }
        if (!firebaseReady || !db || !storage) {
            setUploadStatus("Firebase Storage não conectado.", true);
            showToast("Storage indisponível", "Não foi possível iniciar o upload agora.", "error");
            return;
        }

        // Proteção inicial apenas visual/frontend: sem autenticação real, regras do Firebase
        // ainda devem validar permissões no backend antes de abrir uploads publicamente.
        try {
            await createRoomIfNeeded();
            setUploadStatus("Preparando envio...");
            setUploadProgress(0);
            if (els.uploadButton) els.uploadButton.disabled = true;

            const file = selectedUploadFile;
            const path = `watchRooms/${roomId}/videos/${Date.now()}_${safeStorageFileName(file.name)}`;
            const fileRef = storageRef(storage, path);
            uploadTask = uploadBytesResumable(fileRef, file, {
                contentType: file.type || "application/octet-stream",
                customMetadata: {
                    roomId,
                    uploadedBy: userName,
                    originalName: file.name
                }
            });

            uploadTask.on("state_changed", (snapshot) => {
                const percent = snapshot.totalBytes
                    ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                    : 0;
                setUploadProgress(percent);
                setUploadStatus(percent >= 100 ? "Processando..." : `Enviando ${percent}%...`);
            }, (error) => {
                console.warn("Erro ao enviar filme:", error);
                uploadTask = null;
                if (els.uploadButton) els.uploadButton.disabled = false;
                setUploadStatus("Erro ao enviar", true);
                showToast("Erro ao enviar", "Confira as permissões do Firebase Storage.", "error");
            }, async () => {
                try {
                    const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                    await finalizeUploadedMovie(file, downloadUrl);
                    uploadTask = null;
                    if (els.uploadButton) els.uploadButton.disabled = false;
                    setUploadProgress(100);
                    setUploadStatus("Filme pronto");
                    showToast("Filme enviado com sucesso.", "Rodrigo e Paula já recebem o novo player.", "success");
                } catch (error) {
                    console.warn("Erro ao finalizar upload:", error);
                    uploadTask = null;
                    if (els.uploadButton) els.uploadButton.disabled = false;
                    setUploadStatus("Erro ao enviar", true);
                    showToast("Erro ao finalizar", "O upload terminou, mas a sala não foi atualizada.", "error");
                }
            });
        } catch (error) {
            console.warn("Erro ao preparar upload:", error);
            uploadTask = null;
            if (els.uploadButton) els.uploadButton.disabled = false;
            setUploadStatus("Erro ao enviar", true);
            showToast("Erro ao enviar", error.message || "Não foi possível preparar a sala.", "error");
        }
    }

    async function finalizeUploadedMovie(file, downloadUrl) {
        const now = Date.now();
        const title = sanitizeText(els.movieTitleInput?.value, 80) || sanitizeText(file.name.replace(/\.[^.]+$/, ""), 80) || DEFAULT_MOVIE_TITLE;
        const nextState = {
            isPlaying: false,
            currentTime: 0,
            updatedAt: now,
            updatedBy: userKey,
            updatedByName: userName,
            updatedByClient: clientId,
            action: "video_uploaded",
            version: Math.max(lastKnownVersion + 1, 1)
        };
        lastKnownVersion = nextState.version;
        lastAppliedStateAt = Math.max(lastAppliedStateAt, now);

        await update(ref(db, roomPath()), {
            movieTitle: title,
            originalUrl: downloadUrl,
            videoUrl: downloadUrl,
            embedUrl: "",
            viewUrl: downloadUrl,
            videoProvider: "firebase-storage",
            playerMode: "video",
            syncEnabled: true,
            videoName: file.name,
            videoType: file.type || "",
            uploadedAt: now,
            uploadedBy: userKey,
            uploadSource: "firebase-storage",
            updatedAt: now,
            state: nextState
        });

        if (els.movieTitleInput) els.movieTitleInput.value = title;
        if (els.videoUrlInput) els.videoUrlInput.value = downloadUrl;
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
        if (currentMediaType !== "direct") return;
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
        if (currentMediaType !== "direct") return;
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

    function providerLabel(provider) {
        const labels = {
            "google-drive": "Google Drive",
            "youfiles-google-drive": "YouFiles / Drive",
            youfiles: "YouFiles",
            "firebase-storage": "Upload Firebase",
            "direct-link": "Link direto",
            "external-page": "Player externo",
            mega: "Mega"
        };
        return labels[provider] || "Link";
    }

    function modeLabel(mode) {
        return mode === "video" ? "Vídeo direto" : "Compatibilidade iframe";
    }

    function setMediaStatus(type, mode, sync, tone = "neutral") {
        if (els.mediaStatusType) els.mediaStatusType.textContent = type || "Aguardando link";
        if (els.mediaStatusMode) els.mediaStatusMode.textContent = mode || "Não carregado";
        if (els.mediaStatusSync) {
            els.mediaStatusSync.textContent = sync || "Aguardando";
            els.mediaStatusSync.classList.remove("rp-status-active", "rp-status-limited", "rp-status-error", "rp-status-neutral");
            els.mediaStatusSync.classList.add(
                tone === "active"
                    ? "rp-status-active"
                    : tone === "warning"
                        ? "rp-status-limited"
                        : tone === "error"
                            ? "rp-status-error"
                            : "rp-status-neutral"
            );
        }
    }

    function setMediaStatusFromDescriptor(media) {
        setMediaStatus(
            providerLabel(media.videoProvider),
            modeLabel(media.playerMode),
            media.syncEnabled ? "Ativa" : "Limitada",
            media.syncEnabled ? "active" : "warning"
        );
    }

    function setMediaStatusFromRoom(room) {
        if (!room?.videoProvider && !room?.playerMode) return;
        setMediaStatus(
            providerLabel(room.videoProvider),
            modeLabel(room.playerMode),
            room.syncEnabled === false ? "Limitada" : "Ativa",
            room.syncEnabled === false ? "warning" : "active"
        );
    }

    function setUploadMeta(name, size) {
        if (els.uploadFileName) els.uploadFileName.textContent = name;
        if (els.uploadFileSize) els.uploadFileSize.textContent = size;
    }

    function setUploadWarning(message) {
        if (!els.uploadWarning) return;
        els.uploadWarning.textContent = message || "";
        els.uploadWarning.hidden = !message;
    }

    function setUploadProgress(percent) {
        const cleanPercent = Math.max(0, Math.min(100, Number(percent) || 0));
        if (els.uploadProgress) els.uploadProgress.style.width = `${cleanPercent}%`;
        if (els.uploadProgressText) els.uploadProgressText.textContent = `${Math.round(cleanPercent)}%`;
    }

    function setUploadStatus(message, isWarning = false) {
        if (!els.uploadStatus) return;
        els.uploadStatus.textContent = message || "";
        els.uploadStatus.classList.toggle("is-warning", !!isWarning);
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

    function showVideoError(message, soft = false) {
        if (!els.videoErrorCard) return;
        const text = els.videoErrorCard.querySelector("span");
        if (text) text.textContent = message;
        els.videoErrorCard.classList.toggle("is-soft", !!soft);
        els.videoErrorCard.hidden = false;
    }

    function hideVideoError() {
        if (els.videoErrorCard) {
            els.videoErrorCard.hidden = true;
            els.videoErrorCard.classList.remove("is-soft");
        }
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
