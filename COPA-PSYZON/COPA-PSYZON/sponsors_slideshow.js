/**
 * Sponsors Slideshow Logic
 * Exibe logos e slideshows para clientes na aba de Chaveamento.
 * Cada cliente possui exatamente 3 imagens com rotação automática de 7s,
 * controles manuais (avançar, voltar, pausar/retomar) e link clicável
 * lido automaticamente do arquivo Link.txt da pasta do cliente.
 */

const sponsorsConfig = [
  {
    id: 'acai-ramos',
    name: 'Açaí Ramos',
    logo: 'PATROCINADORES/banner%20ramos%20acai.png',
    images: [
      'SLIDES/acai-ramos/foto1.jpg',
      'SLIDES/acai-ramos/foto2.png',
      'SLIDES/acai-ramos/foto3.png'
    ],
    link: 'https://www.instagram.com/ramos_acai_',
    linkFile: null
  },
  {
    id: 'virtu',
    name: 'Barbearia Virtu',
    logo: 'PATROCINADORES/banner%20virtu.png',
    images: [
      'SLIDES/Barbearia-virtu/IMG_6106.jpg',
      'SLIDES/Barbearia-virtu/IMG_6324.JPG.jpeg',
      {type: 'video', src: 'SLIDES/Barbearia-virtu/video.mp4.mp4'}
    ],
    link: 'https://www.instagram.com/barbeariavirtu',
    linkFile: null
  },
  {
    id: 'biel-motos',
    name: 'Biel Motos',
    logo: 'PATROCINADORES/BIEL%20MOTOS.png',
    images: [
      'SLIDES/Biel-Motos/IMG_20260413_145322.jpg.jpeg',
      'SLIDES/Biel-Motos/IMG_20260413_145346.jpg.jpeg',
      'SLIDES/Biel-Motos/IMG_20260413_151307.jpg.jpeg'
    ],
    link: 'https://www.instagram.com/bielmotos33',
    linkFile: null
  },
  {
    id: 'bizuca',
    name: 'Bizuca Health Academy',
    logo: 'PATROCINADORES/banner%20bizuca.png',
    images: [
      'SLIDES/Bizuca-Health-%26-Academy/slide1.jpg',
      'SLIDES/Bizuca-Health-%26-Academy/slide2.jpg',
      'SLIDES/Bizuca-Health-%26-Academy/slide3.jpg.jpeg'
    ],
    link: 'https://www.instagram.com/bizucahealthacademy',
    linkFile: null
  },
  {
    id: 'bruno-leite',
    name: 'Bruno Leite Assessoria Contábil',
    logo: 'PATROCINADORES/BRUNO%20LEITE.png',
    images: [
      'SLIDES/Bruno-Leite/slide%201.jpeg',
      'SLIDES/Bruno-Leite/slide%202.jpeg',
      'SLIDES/Bruno-Leite/slide%203.jpeg'
    ],
    link: 'https://www.instagram.com/brunoleite.contador',
    linkFile: null
  },
  {
    id: 'carol-home',
    name: 'Carol Home',
    logo: 'PATROCINADORES/CAROL%20ROCHA.png',
    images: [
      'SLIDES/Carol-Home/IMG_20260413_153223.jpg.jpeg',
      'SLIDES/Carol-Home/IMG_20260413_153236.jpg.jpeg',
      'SLIDES/Carol-Home/IMG_20260413_153456.jpg.jpeg'
    ],
    link: 'https://www.instagram.com/carolrochahomeeessence',
    linkFile: null
  },
  {
    id: 'central-bebidas',
    name: 'Central de Bebidas',
    logo: 'PATROCINADORES/CENTRAL%20ATACADISTA.png',
    images: [
      'SLIDES/Central%20de%20Bebidas/Foto%201.jpeg',
      'SLIDES/Central%20de%20Bebidas/foto%202.jpeg',
      'SLIDES/Central%20de%20Bebidas/foto%203.jpeg'
    ],
    link: 'https://www.instagram.com/gerson.rios',
    linkFile: null
  },
  {
    id: 'revitalize',
    name: 'Clínica Revitalize',
    logo: 'PATROCINADORES/banner%20revitalize.png',
    images: [
      'SLIDES/Clinica-Revitalize/clinica1.jpg',
      'SLIDES/Clinica-Revitalize/FOTO2.png',
      'SLIDES/Clinica-Revitalize/FOTO3.png'
    ],
    link: 'https://www.instagram.com/clinica_revitalize_itarantim',
    linkFile: null
  },
  {
    id: 'daby-gourmet',
    name: 'Daby Gourmet',
    logo: 'PATROCINADORES/daby%20gourmet.png',
    images: [
      {type: 'video', src: 'SLIDES/Daby-Gourmet/video1.mp4'}
    ],
    link: 'https://www.instagram.com/dabygourmet',
    linkFile: null
  },
  {
    id: 'eburger',
    name: 'E-Burger',
    logo: 'PATROCINADORES/E-BURGUER.png',
    images: [
      'SLIDES/E-Burger/foto1.jpeg',
      'SLIDES/E-Burger/foto2.jpeg',
      {type: 'video', src: 'SLIDES/E-Burger/video1.mp4'}
    ],
    link: 'https://www.instagram.com/e.burguer_',
    linkFile: null
  },
  {
    id: 'fagundes',
    name: 'Fagundes Distribuidora',
    logo: 'PATROCINADORES/fagundes.png',
    images: [
      'SLIDES/FagundesDistribuidora/foto1.jpg',
      'SLIDES/FagundesDistribuidora/foto2.jpeg',
      'SLIDES/FagundesDistribuidora/foto3.jpeg'
    ],
    link: 'https://www.instagram.com/fagundes_distribuidora',
    linkFile: null
  },
  {
    id: 'giselle',
    name: 'Giselle Fest',
    logo: 'PATROCINADORES/banner%20giselle.png',
    images: [
      'SLIDES/Giselle-Fest/foto1.png',
      'SLIDES/Giselle-Fest/foto2.png',
      'SLIDES/Giselle-Fest/foto3.png'
    ],
    link: 'https://www.instagram.com/chef_giselle_oliveira',
    linkFile: null
  },
  {
    id: 'gusmao-modas',
    name: 'Gusmão Modas',
    logo: 'PATROCINADORES/GUSM%C3%83O%20MODAS.png',
    images: [
      {type: 'video', src: 'SLIDES/Gusmao-Modas/video1.mp4'}
    ],
    link: 'https://www.instagram.com/gusmao.modas',
    linkFile: null
  },
  {
    id: 'imperio',
    name: 'Império MRS',
    logo: 'PATROCINADORES/imperio.png',
    images: [
      {type: 'video', src: 'SLIDES/ImperiosMRS/foto2.mp4'}
    ],
    link: 'https://www.instagram.com/imperiomrs',
    linkFile: null
  },
  {
    id: 'janejoias',
    name: 'Jane Jóias',
    logo: 'PATROCINADORES/banner%20jane%20joias.png',
    images: [
      'SLIDES/JaneJoias/foto1.png',
      'SLIDES/JaneJoias/foto2.png',
      'SLIDES/JaneJoias/foto3.png'
    ],
    link: 'https://www.instagram.com/jane_joiasoficial',
    linkFile: null
  },
  {
    id: 'lavajato-tg',
    name: 'Lava Jato TG',
    logo: 'PATROCINADORES/lava%20jato%20tg.png',
    images: [
      'SLIDES/LavaJato/foto1.jpeg',
      'SLIDES/LavaJato/foto2.jpeg',
      'SLIDES/LavaJato/foto3.jpeg'
    ],
    link: 'https://www.instagram.com/tg_lava_jato',
    linkFile: null
  },
  {
    id: 'ledulcis',
    name: 'Lê Dulcis Brigadeiria',
    logo: 'PATROCINADORES/L%C3%AA%20Dulcis.png',
    images: [
      'SLIDES/Ledulcis/foto1.jpeg',
      'SLIDES/Ledulcis/foto2.png',
      'SLIDES/Ledulcis/foto3.png',
      'SLIDES/Ledulcis/foto4.png'
    ],
    link: 'https://www.instagram.com/ledulcis.brigadeiria',
    linkFile: null
  },
  {
    id: 'nachapa',
    name: 'Na Chapa',
    logo: 'PATROCINADORES/banner%20na%20chapa.png',
    images: [
      'SLIDES/NaChapa/foto1.png',
      'SLIDES/NaChapa/foto2.png',
      'SLIDES/NaChapa/foto3.png'
    ],
    link: 'https://www.instagram.com/trailer_nachapa',
    linkFile: null
  },
  {
    id: 'presencial-tecnologia',
    name: 'Presencial Tecnologia',
    logo: 'PATROCINADORES/PRECENSIAL.png',
    images: [
      'SLIDES/Presencial-Tecnologia/foto1.png',
      'SLIDES/Presencial-Tecnologia/foto2.png',
      'SLIDES/Presencial-Tecnologia/foto3.png'
    ],
    link: 'https://www.instagram.com/matheus_sobrinhoo',
    linkFile: null
  },
  {
    id: 'rogeriorelogio',
    name: 'Rogério Relógio',
    logo: 'PATROCINADORES/banner%20rogerio%20relogio.png',
    images: [
      {type: 'video', src: 'SLIDES/Rogerio-Relogio/video1.mp4'},
      'SLIDES/Rogerio-Relogio/WhatsApp%20Image%202026-04-03%20at%2017.05.34.jpeg'
    ],
    link: 'https://www.instagram.com/rogerio_relogio03',
    linkFile: null
  },
  {
    id: 'bf-distribuidora',
    name: 'BF Distribuidora',
    logo: 'PATROCINADORES/BF%20DISTRIBUIDORA.png',
    images: [
      'SLIDES/BF-DISTRIBUIDORA/FOTO1.png',
      'SLIDES/BF-DISTRIBUIDORA/FOTO2.png',
      'SLIDES/BF-DISTRIBUIDORA/FOTO3.png'
    ],
    link: null,
    linkFile: null
  },
  {
    id: 'ws-bar',
    name: 'WS Bar',
    logo: 'PATROCINADORES/WS%20BAR.png',
    images: [
      'SLIDES/WS-BAR/l.jpeg',
      'SLIDES/WS-BAR/IMG_20260417_155018.jpg.jpeg',
      'SLIDES/WS-BAR/WhatsApp%20Image%202026-04-14%20at%2017.42.33.jpeg'
    ],
    link: 'https://www.instagram.com/ws_bar_12',
    linkFile: null
  },
  {
    id: 'henry-iphones',
    name: 'Henry iPhones',
    logo: 'PATROCINADORES/henry%20iphones.png',
    images: [],
    link: 'https://www.instagram.com/henry.iphones',
    linkFile: null
  },
  {
    id: 'maiqvox',
    name: 'Maiqvox',
    logo: 'PATROCINADORES/maiqvox.png',
    images: [],
    link: 'https://www.instagram.com/maiqvox',
    linkFile: null
  },
  {
    id: 'super-esquinao',
    name: 'Super Esquinão',
    logo: 'PATROCINADORES/SUPER%20ESQUIN%C3%83O.png',
    images: [],
    link: 'https://www.instagram.com/superesquinao',
    linkFile: null
  },
  {
    id: 'ancore',
    name: 'Ancore Seguradora',
    logo: 'PATROCINADORES/ANCORE.png',
    images: [
      'SLIDES/Ancore/foto%201.jpeg',
      'SLIDES/Ancore/foto2.jpeg',
      'SLIDES/Ancore/foto3.jpeg'
    ],
    link: 'https://www.instagram.com/gerson.rios',
    linkFile: null
  }
];

document.addEventListener('DOMContentLoaded', function () {
  initSponsorsShowcase();
});

/**
 * Extrai a primeira URL válida (http/https) de um texto multi-linha.
 */
function extractFirstUrl(text) {
  if (!text) return '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.match(/^https?:\/\//)) {
      return line;
    }
  }
  return '';
}

async function initSponsorsShowcase() {
  var container = document.getElementById('bracket-sponsors-showcase');
  if (!container) return;

  // Título da seção
  var sectionTitle = document.createElement('h3');
  sectionTitle.className = 'sponsors-showcase-title';
  sectionTitle.textContent = 'PATROCINADORES';
  container.appendChild(sectionTitle);

  // ─── Resolução de links (fetch todos em paralelo) ───
  var sponsorLinks = [];
  var linkPromises = sponsorsConfig.map(function (sponsor) {
    if (sponsor.link) return Promise.resolve(sponsor.link);
    if (!sponsor.linkFile) return Promise.resolve('');
    return fetch(sponsor.linkFile)
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { return extractFirstUrl(t); })
      .catch(function () { return ''; });
  });
  sponsorLinks = await Promise.all(linkPromises);

  // ─── Palco único: exibe 1 patrocinador por vez ───
  var stage = document.createElement('div');
  stage.className = 'sponsors-showcase-stage';
  container.appendChild(stage);

  // ─── Loading Overlay (logo Psyzon pulsando) ───
  var loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'sponsor-loading-overlay';
  loadingOverlay.innerHTML = '<img src="img/psyzon-logo.png" alt="Carregando" class="sponsor-loading-logo">' +
    '<span class="sponsor-loading-text">Carregando...</span>';
  stage.appendChild(loadingOverlay);

  // Indicadores de patrocinador (logos no rodapé)
  var sponsorNav = document.createElement('div');
  sponsorNav.className = 'sponsors-nav';
  var sponsorDots = [];
  for (var n = 0; n < sponsorsConfig.length; n++) {
    var sThumb = document.createElement('img');
    sThumb.src = sponsorsConfig[n].logo;
    sThumb.alt = sponsorsConfig[n].name;
    sThumb.className = 'sponsor-nav-logo' + (n === 0 ? ' active' : '');
    sThumb.loading = 'lazy';
    sThumb.dataset.index = n;
    sThumb.addEventListener('click', (function(idx) {
      return function(e) {
        e.preventDefault();
        e.stopPropagation();
        showSponsor(idx, 0);
        startAutoSlide();
      };
    })(n));
    sponsorNav.appendChild(sThumb);
    sponsorDots.push(sThumb);
  }
  container.appendChild(sponsorNav);

  // ─── Estado global do slideshow ───
  var SLIDE_INTERVAL_FULL = 7000;
  var SLIDE_INTERVAL_LOGO = 7000;
  var VIDEO_MAX_DURATION = 40; // segundos
  var currentSponsor = 0;
  var currentSlide = 0;
  var timer = null;
  var isPlaying = true;

  // Elementos em exibição
  var activeCard = null;
  var activeSlideEls = [];
  var activeDotEls = [];
  var activeProgressFill = null;

  /**
   * Cria e exibe o card de um patrocinador no palco.
   * Retorna { card, slideEls, dotEls, progressFill }
   */
  function buildSponsorCard(index) {
    var sponsor = sponsorsConfig[index];
    var targetLink = sponsorLinks[index] || '';
    var slidesFiles = sponsor.images || [];
    var isLogoOnly = slidesFiles.length === 0;

    var cardEl = targetLink ? document.createElement('a') : document.createElement('div');
    cardEl.className = 'sponsor-slidecase-card';
    if (isLogoOnly) cardEl.classList.add('logo-only-card');
    if (targetLink) {
      cardEl.href = targetLink;
      cardEl.target = '_blank';
      cardEl.rel = 'noopener noreferrer';
    } else {
      cardEl.classList.add('no-link');
    }

    // ─── Logo / Nome do patrocinador (topo) ───
    var logoArea = document.createElement('div');
    logoArea.className = 'sponsor-logo-area' + (isLogoOnly ? ' logo-only' : '');

    var logoImg = document.createElement('img');
    logoImg.src = sponsor.logo;
    logoImg.alt = 'Logo ' + sponsor.name;
    logoImg.loading = 'lazy';
    logoImg.className = 'sponsor-logo-img' + (isLogoOnly ? ' logo-only-img' : '');
    logoArea.appendChild(logoImg);

    var logoName = document.createElement('span');
    logoName.className = 'sponsor-logo-name';
    logoName.textContent = sponsor.name;
    logoArea.appendChild(logoName);

    cardEl.appendChild(logoArea);

    var slideEls = [];
    var dotEls = [];
    var progressFill = null;

    if (!isLogoOnly) {
      // ─── Área do Slideshow (imagem adapta ao formato) ───
      var slideArea = document.createElement('div');
      slideArea.className = 'sponsor-slides-area';

      for (var idx = 0; idx < slidesFiles.length; idx++) {
        var mediaItem = slidesFiles[idx];
        var isVideo = typeof mediaItem === 'object' && mediaItem.type === 'video';
        var mediaSrc = isVideo ? mediaItem.src : mediaItem;
        var el;

        if (isVideo) {
          el = document.createElement('video');
          el.src = mediaSrc;
          el.muted = true;
          el.loop = false;
          el.playsInline = true;
          el.preload = 'metadata';
          el.className = 'sponsor-slide-img sponsor-slide-video' + (idx === 0 ? ' active' : '');
        } else {
          el = document.createElement('img');
          el.src = mediaSrc;
          el.loading = 'lazy';
          el.alt = sponsor.name + ' - imagem ' + (idx + 1);
          el.className = 'sponsor-slide-img' + (idx === 0 ? ' active' : '');
        }
        slideArea.appendChild(el);
        slideEls.push(el);
      }

      // Dots indicadores de slide (só se mais de 1 imagem)
      if (slidesFiles.length > 1) {
        var dotsWrap = document.createElement('div');
        dotsWrap.className = 'sponsor-slide-dots';
        for (var d = 0; d < slidesFiles.length; d++) {
          var dot = document.createElement('span');
          dot.className = 'sponsor-dot' + (d === 0 ? ' active' : '');
          dotsWrap.appendChild(dot);
          dotEls.push(dot);
        }
        slideArea.appendChild(dotsWrap);
      }

      // Barra de progresso
      var progressBar = document.createElement('div');
      progressBar.className = 'sponsor-slide-progress';
      progressFill = document.createElement('div');
      progressFill.className = 'sponsor-slide-progress-fill';
      progressBar.appendChild(progressFill);
      slideArea.appendChild(progressBar);

      cardEl.appendChild(slideArea);
    }

    return { card: cardEl, slideEls: slideEls, dotEls: dotEls, progressFill: progressFill };
  }

  /**
   * Mostra/esconde overlay de loading.
   */
  function showLoading() {
    loadingOverlay.classList.add('visible');
  }
  function hideLoading() {
    loadingOverlay.classList.remove('visible');
  }

  /**
   * Espera o elemento de mídia carregar, depois executa callback.
   * Para imagens: espera onload. Para vídeos: espera canplay.
   */
  function waitForMediaLoad(el, callback) {
    if (!el) { callback(); return; }

    if (isVideoEl(el)) {
      if (el.readyState >= 3) { callback(); return; }
      var onReady = function() {
        el.removeEventListener('canplay', onReady);
        callback();
      };
      el.addEventListener('canplay', onReady);
      // Fallback 8s
      setTimeout(function() { el.removeEventListener('canplay', onReady); callback(); }, 8000);
    } else if (el.tagName === 'IMG') {
      if (el.complete && el.naturalWidth > 0) { callback(); return; }
      var onLoad = function() {
        el.removeEventListener('load', onLoad);
        el.removeEventListener('error', onLoad);
        callback();
      };
      el.addEventListener('load', onLoad);
      el.addEventListener('error', onLoad);
      // Fallback 8s
      setTimeout(function() { el.removeEventListener('load', onLoad); el.removeEventListener('error', onLoad); callback(); }, 8000);
    } else {
      callback();
    }
  }

  /**
   * Reinicia a barra de progresso para o slide atual.
   */
  function getCurrentInterval() {
    var sponsor = sponsorsConfig[currentSponsor];
    var imgs = sponsor && sponsor.images ? sponsor.images : [];
    return imgs.length === 0 ? SLIDE_INTERVAL_LOGO : SLIDE_INTERVAL_FULL;
  }

  /**
   * Verifica se um elemento de slide é um vídeo.
   */
  function isVideoEl(el) {
    return el && el.tagName === 'VIDEO';
  }

  /**
   * Para todos os vídeos ativos no card.
   */
  function stopAllVideos(els) {
    for (var v = 0; v < els.length; v++) {
      if (isVideoEl(els[v])) {
        els[v].pause();
        els[v].currentTime = 0;
      }
    }
  }

  /**
   * Inicia reprodução do vídeo ativo se for vídeo.
   * Retorna true se é vídeo (precisa esperar 'ended').
   */
  function playActiveVideo() {
    var el = activeSlideEls[currentSlide];
    if (isVideoEl(el)) {
      el.currentTime = 0;
      el.play().catch(function() {});
      return true;
    }
    return false;
  }

  var videoTimeupdateHandler = null;
  var videoMaxTimer = null;

  /**
   * Configura limite de 40s no vídeo ativo.
   */
  function setupVideoLimit(el) {
    clearVideoLimit();
    var handler = function() {
      if (el.currentTime >= VIDEO_MAX_DURATION) {
        el.pause();
        el.removeEventListener('timeupdate', handler);
      }
    };
    el.addEventListener('timeupdate', handler);
    videoTimeupdateHandler = { el: el, fn: handler };
    // Fallback timer
    videoMaxTimer = setTimeout(function() {
      if (!el.paused) el.pause();
    }, (VIDEO_MAX_DURATION + 0.5) * 1000);
  }

  function clearVideoLimit() {
    if (videoTimeupdateHandler && videoTimeupdateHandler.el) {
      videoTimeupdateHandler.el.removeEventListener('timeupdate', videoTimeupdateHandler.fn);
      videoTimeupdateHandler = null;
    }
    if (videoMaxTimer) {
      clearTimeout(videoMaxTimer);
      videoMaxTimer = null;
    }
  }

  function restartProgress() {
    if (!activeProgressFill) return;
    var interval = getCurrentInterval();
    activeProgressFill.style.transition = 'none';
    activeProgressFill.style.width = '0%';
    void activeProgressFill.offsetWidth;
    if (isPlaying) {
      activeProgressFill.style.transition = 'width ' + interval + 'ms linear';
      activeProgressFill.style.width = '100%';
    }
  }

  /**
   * Exibe o patrocinador na posição `sIdx`, começando pelo slide `slIdx`.
   * Faz animação de entrada/saída.
   */
  function showSponsor(sIdx, slIdx) {
    if (sIdx < 0) sIdx = sponsorsConfig.length - 1;
    if (sIdx >= sponsorsConfig.length) sIdx = 0;
    currentSponsor = sIdx;
    currentSlide = slIdx || 0;

    // Atualiza logos de navegação do patrocinador
    for (var i = 0; i < sponsorDots.length; i++) {
      sponsorDots[i].classList.toggle('active', i === currentSponsor);
      // Marca logos próximos (prev, current, next) para mobile fullscreen
      var diff = Math.abs(i - currentSponsor);
      // Trata wrap-around
      var wrapDiff = sponsorsConfig.length - diff;
      var isNearby = diff <= 1 || wrapDiff <= 1;
      sponsorDots[i].classList.toggle('nearby', isNearby);
    }

    // Anima saída do card atual
    if (activeCard) {
      stopAllVideos(activeSlideEls);
      activeCard.classList.add('exiting');
      var old = activeCard;
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 500);
    }

    // Constrói novo card
    var data = buildSponsorCard(currentSponsor);
    activeCard = data.card;
    activeSlideEls = data.slideEls;
    activeDotEls = data.dotEls;
    activeProgressFill = data.progressFill;

    // Ativa o slide correto
    if (currentSlide > 0 && currentSlide < activeSlideEls.length) {
      activeSlideEls[0].classList.remove('active');
      if (activeDotEls[0]) activeDotEls[0].classList.remove('active');
      activeSlideEls[currentSlide].classList.add('active');
      if (activeDotEls[currentSlide]) activeDotEls[currentSlide].classList.add('active');
    }

    activeCard.classList.add('entering');
    stage.appendChild(activeCard);
    void activeCard.offsetWidth;
    activeCard.classList.remove('entering');
    activeCard.classList.add('visible');

    // Mostra loading até mídia carregar
    var firstEl = activeSlideEls[currentSlide];
    if (firstEl) {
      showLoading();
      waitForMediaLoad(firstEl, function() {
        hideLoading();
        playActiveVideo();
        restartProgress();
        startAutoSlide();
      });
    } else {
      // Logo-only: sem mídia, inicia direto
      hideLoading();
      restartProgress();
      startAutoSlide();
    }
  }

  /**
   * Avança para o próximo slide; se último, vai ao próximo patrocinador.
   */
  function advance() {
    var nextSlide = currentSlide + 1;
    if (nextSlide >= activeSlideEls.length) {
      // Próximo patrocinador
      showSponsor(currentSponsor + 1, 0);
    } else {
      // Para vídeo atual se for vídeo
      if (isVideoEl(activeSlideEls[currentSlide])) {
        activeSlideEls[currentSlide].pause();
      }
      // Próximo slide do mesmo patrocinador
      activeSlideEls[currentSlide].classList.remove('active');
      if (activeDotEls[currentSlide]) activeDotEls[currentSlide].classList.remove('active');
      currentSlide = nextSlide;
      activeSlideEls[currentSlide].classList.add('active');
      if (activeDotEls[currentSlide]) activeDotEls[currentSlide].classList.add('active');
      // Inicia reprodução se for vídeo, espera carregar
      var nextEl = activeSlideEls[currentSlide];
      showLoading();
      waitForMediaLoad(nextEl, function() {
        hideLoading();
        playActiveVideo();
        restartProgress();
        startAutoSlide();
      });
    }
  }

  /**
   * Inicia/reinicia o timer automático.
   * Para vídeos, espera o evento 'ended' antes de avançar.
   */
  var videoEndHandler = null;

  function startAutoSlide() {
    if (timer) clearTimeout(timer);
    // Limpa handler de vídeo anterior
    if (videoEndHandler && videoEndHandler.el) {
      videoEndHandler.el.removeEventListener('ended', videoEndHandler.fn);
      videoEndHandler = null;
    }

    var activeEl = activeSlideEls[currentSlide];

    // Se o slide atual for vídeo, limita a 40s e avança ao terminar
    if (isVideoEl(activeEl)) {
      // Esconde barra de progresso durante vídeo
      if (activeProgressFill) {
        activeProgressFill.style.transition = 'none';
        activeProgressFill.style.width = '0%';
      }
      setupVideoLimit(activeEl);
      var endFn = function() {
        clearVideoLimit();
        if (isPlaying) advance();
        startAutoSlide();
      };
      // Avança quando o vídeo terminar OU quando atingir 21s
      activeEl.addEventListener('ended', endFn, { once: true });
      // Timer de segurança para 40s
      timer = setTimeout(function() {
        activeEl.removeEventListener('ended', endFn);
        endFn();
      }, (VIDEO_MAX_DURATION + 0.5) * 1000);
      videoEndHandler = { el: activeEl, fn: endFn };
      return;
    }

    // Para imagens, usa o timer normal
    var interval = getCurrentInterval();
    timer = setTimeout(function autoTick() {
      if (isPlaying) advance();
      startAutoSlide();
    }, interval);
    restartProgress();
  }

  // ─── Controles globais (prev / play-pause / next) ───
  var controls = document.createElement('div');
  controls.className = 'sponsor-slide-controls sponsor-global-controls';

  var btnPrev = document.createElement('button');
  btnPrev.className = 'sponsor-btn-control';
  btnPrev.setAttribute('aria-label', 'Patrocinador anterior');
  btnPrev.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';

  var btnPlayPause = document.createElement('button');
  btnPlayPause.className = 'sponsor-btn-control';
  btnPlayPause.setAttribute('aria-label', 'Pausar / Retomar');
  btnPlayPause.title = 'Pausar / Retomar';
  btnPlayPause.innerHTML = '<span class="material-symbols-outlined">pause</span>';

  var btnNext = document.createElement('button');
  btnNext.className = 'sponsor-btn-control';
  btnNext.setAttribute('aria-label', 'Próximo patrocinador');
  btnNext.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';

  var btnFullscreen = document.createElement('button');
  btnFullscreen.className = 'sponsor-btn-control sponsor-btn-fullscreen';
  btnFullscreen.setAttribute('aria-label', 'Tela Cheia');
  btnFullscreen.title = 'Tela Cheia';
  btnFullscreen.innerHTML = '<span class="material-symbols-outlined">fullscreen</span>';

  controls.appendChild(btnPrev);
  controls.appendChild(btnPlayPause);
  controls.appendChild(btnNext);
  controls.appendChild(btnFullscreen);
  container.appendChild(controls);

  btnPrev.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    showSponsor(currentSponsor - 1, 0);
    startAutoSlide();
  });

  btnNext.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    showSponsor(currentSponsor + 1, 0);
    startAutoSlide();
  });

  btnPlayPause.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    isPlaying = !isPlaying;
    btnPlayPause.innerHTML = isPlaying
      ? '<span class="material-symbols-outlined">pause</span>'
      : '<span class="material-symbols-outlined">play_arrow</span>';
    if (isPlaying) {
      startAutoSlide();
    } else {
      if (activeProgressFill) {
        activeProgressFill.style.width = getComputedStyle(activeProgressFill).width;
        activeProgressFill.style.transition = 'none';
      }
    }
  });

  // ─── Fullscreen 2-Column Overlay (bracket | slideshow) + live match bar ───
  var isFullscreen = false;
  var overlay = null;
  var containerPlaceholder = null; // marks where the container was before moving
  var fsLiveInterval = null;

  function buildOverlay() {
    if (document.getElementById('fs-3col-overlay')) {
      return document.getElementById('fs-3col-overlay');
    }

    var ov = document.createElement('div');
    ov.id = 'fs-3col-overlay';

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.id = 'fs-3col-close';
    closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    closeBtn.title = 'Sair da Tela Cheia';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      exitFullscreen();
    });
    ov.appendChild(closeBtn);

    // Live match bar (top, hidden by default)
    var liveBar = document.createElement('div');
    liveBar.className = 'fs-live-bar';
    liveBar.id = 'fs-live-bar';
    ov.appendChild(liveBar);

    // Main content area (2 columns)
    var mainArea = document.createElement('div');
    mainArea.className = 'fs-main-area';

    // Column 1: Bracket
    var colBracket = document.createElement('div');
    colBracket.className = 'fs-col-bracket';
    mainArea.appendChild(colBracket);

    // Column 2: Slideshow
    var colSlideshow = document.createElement('div');
    colSlideshow.className = 'fs-col-slideshow';
    mainArea.appendChild(colSlideshow);

    ov.appendChild(mainArea);

    document.body.appendChild(ov);
    return ov;
  }

  /** Scans the bracket for live/paused matches and returns an array of info objects */
  function getLiveMatches() {
    var liveList = [];
    try {
      // Access the global state from script.js
      if (typeof state === 'undefined' || !state.bracket || !state.bracket.rounds) return liveList;
      state.bracket.rounds.forEach(function(round, rIdx) {
        round.matches.forEach(function(match, mIdx) {
          if (match.status === 'live' || match.status === 'paused') {
            var t1 = match.team1;
            var t2 = match.team2;
            liveList.push({
              match: match,
              rIdx: rIdx,
              mIdx: mIdx,
              roundName: round.name,
              t1Name: t1 ? (t1.teamName || t1.playerName || '?') : 'A definir',
              t2Name: t2 ? (t2.teamName || t2.playerName || '?') : 'A definir',
              s1: t1 ? (t1.score || 0) : 0,
              s2: t2 ? (t2.score || 0) : 0,
              isLive: match.status === 'live',
              isPaused: match.status === 'paused'
            });
          }
        });
      });
    } catch(e) {}
    return liveList;
  }

  /** Renders the live match bar at the top of fullscreen */
  function updateLiveBar() {
    var bar = document.getElementById('fs-live-bar');
    if (!bar) return;

    var liveMatches = getLiveMatches();
    if (liveMatches.length === 0) {
      bar.classList.remove('has-live');
      bar.innerHTML = '';
      return;
    }

    bar.classList.add('has-live');
    var html = '';
    liveMatches.forEach(function(info) {
      var statusClass = info.isLive ? 'fs-live-card--live' : 'fs-live-card--paused';
      var statusText = info.isLive ? 'AO VIVO' : 'PAUSADO';
      var statusDotClass = info.isLive ? '' : ' paused';

      // Calculate elapsed time
      var elapsed = '00:00';
      try {
        if (typeof getMatchElapsedSeconds === 'function') {
          var secs = getMatchElapsedSeconds(info.match);
          var m = Math.floor(secs / 60);
          var s = secs % 60;
          elapsed = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
        }
      } catch(e) {}

      // Leg indicator
      var legHtml = '';
      try {
        if (typeof state !== 'undefined' && state.twoLegged && info.match.currentLeg) {
          var legText = info.match.currentLeg === 'ida' ? 'Ida' : 'Volta';
          legHtml = '<span class="fs-live-leg">' + legText + '</span>';
        }
      } catch(e) {}

      html += '<div class="fs-live-card ' + statusClass + '">' +
        '<div class="fs-live-status">' +
          '<span class="fs-live-dot' + statusDotClass + '"></span>' +
          '<span class="fs-live-status-text">' + statusText + '</span>' +
          legHtml +
        '</div>' +
        '<div class="fs-live-teams">' +
          '<span class="fs-live-team">' + escapeHTML(info.t1Name) + '</span>' +
          '<span class="fs-live-score">' + info.s1 + '</span>' +
          '<span class="fs-live-vs">\u00d7</span>' +
          '<span class="fs-live-score">' + info.s2 + '</span>' +
          '<span class="fs-live-team">' + escapeHTML(info.t2Name) + '</span>' +
        '</div>' +
        '<span class="fs-live-timer" data-match-id="' + (info.match.id || '') + '">' + elapsed + '</span>' +
      '</div>';
    });
    bar.innerHTML = html;
  }

  /** Simple HTML escape */
  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Build the Top 3 scorers widget for fullscreen bracket */
  function buildTopScorersWidget() {
    try {
      if (typeof state === 'undefined' || !state.playerStats || !state.teams) return null;

      // Build sorted list of scorers
      var scorers = [];
      state.teams.forEach(function(team) {
        var stats = state.playerStats[team.id];
        if (stats && stats.goals > 0) {
          scorers.push({
            playerName: team.playerName || '',
            teamName: team.teamName || '',
            goals: stats.goals
          });
        }
      });

      if (scorers.length === 0) return null;

      scorers.sort(function(a, b) { return b.goals - a.goals; });
      var top3 = scorers.slice(0, 3);

      var widget = document.createElement('div');
      widget.className = 'fs-top-scorers';

      var title = document.createElement('div');
      title.className = 'fs-top-scorers-title';
      title.textContent = '\u26BD ARTILHEIROS';
      widget.appendChild(title);

      var list = document.createElement('div');
      list.className = 'fs-scorers-list';

      var medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49']; // 🥇🥈🥉

      top3.forEach(function(s, idx) {
        var item = document.createElement('div');
        item.className = 'fs-scorer-item';

        var rank = document.createElement('span');
        rank.className = 'fs-scorer-rank';
        rank.setAttribute('data-rank', idx + 1);
        rank.textContent = medals[idx] || (idx + 1);
        item.appendChild(rank);

        var info = document.createElement('div');
        info.style.cssText = 'display:flex;flex-direction:column;min-width:0;';

        var name = document.createElement('span');
        name.className = 'fs-scorer-name';
        name.textContent = s.playerName;
        info.appendChild(name);

        var team = document.createElement('span');
        team.className = 'fs-scorer-team';
        team.textContent = s.teamName;
        info.appendChild(team);

        item.appendChild(info);

        var goals = document.createElement('span');
        goals.className = 'fs-scorer-goals';
        goals.innerHTML = '<span class="goal-icon">\u26BD</span>' + s.goals;
        item.appendChild(goals);

        list.appendChild(item);
      });

      widget.appendChild(list);
      return widget;
    } catch(e) {
      return null;
    }
  }

  function enterFullscreen() {
    isFullscreen = true;
    overlay = buildOverlay();

    // ─── Detect if groups are active (not yet in knockout) ───
    var groupsActive = false;
    try {
      groupsActive = typeof state !== 'undefined' &&
        state.tournamentFormat === 'groups' &&
        state.groups && state.groups.length > 0 &&
        !state.bracketFromGroups;
    } catch(e) {}

    // ─── Build bracket column ───
    var colBracket = overlay.querySelector('.fs-col-bracket');
    colBracket.innerHTML = '';

    if (groupsActive) {
      // ── Groups mode: show group standings + slideshow vertically ──
      overlay.classList.add('fs-groups-mode');

      var groupsContainer = document.getElementById('groups-container');
      if (groupsContainer) {
        var groupsClone = groupsContainer.cloneNode(true);
        groupsClone.id = 'fs-groups-clone';
        groupsClone.className = 'fs-groups-content';
        groupsClone.style.display = 'block';
        // Remove interactive elements that don't work in fullscreen
        var btns = groupsClone.querySelectorAll('.classification-info-block, .group-actions, .repechage-section, .group-card-footer');
        btns.forEach(function(el) { el.remove(); });
        colBracket.appendChild(groupsClone);
      }

      // No auto-scroll for groups, just allow manual scroll
      colBracket.style.overflowY = 'auto';
      overlay._cleanupBracket = function() {};

    } else {
      // ── Standard knockout bracket ──
      overlay.classList.remove('fs-groups-mode');

    var bracketContainer = document.getElementById('bracket-container');
    var repescagemPanel = document.getElementById('repescagem-panel');

    if (bracketContainer) {
      var bracketClone = bracketContainer.cloneNode(true);
      bracketClone.id = 'fs-bracket-clone';
      bracketClone.style.display = 'block';

      // Find all rounds in the clone
      var rounds = bracketClone.querySelectorAll('.round:not(.connector-col)');

      // Determine which rounds are completed and which is the "active" round
      var activeRoundIdx = 0;
      try {
        if (typeof state !== 'undefined' && state.bracket && state.bracket.rounds) {
          for (var ri = 0; ri < state.bracket.rounds.length; ri++) {
            var rnMatches = state.bracket.rounds[ri].matches;
            var allDone = rnMatches.length > 0 && rnMatches.every(function(m) {
              return m.winner || m.status === 'finished';
            });
            if (allDone && ri < state.bracket.rounds.length - 1) {
              activeRoundIdx = ri + 1;
            }
          }
          // If any round has a live match, focus on that
          for (var ri2 = 0; ri2 < state.bracket.rounds.length; ri2++) {
            var hasLive = state.bracket.rounds[ri2].matches.some(function(m) {
              return m.status === 'live' || m.status === 'paused';
            });
            if (hasLive) {
              activeRoundIdx = ri2;
              break;
            }
          }
        }
      } catch(e) {}

      // Build round navigation tabs
      var roundNav = document.createElement('div');
      roundNav.className = 'fs-round-nav';

      var roundDataArr = [];
      rounds.forEach(function(rEl, idx) {
        var titleEl = rEl.querySelector('.round-title');
        var label = titleEl ? (titleEl.textContent || '').trim() : 'Fase ' + (idx + 1);
        // Trim icon text
        label = label.replace(/^\s*[\u2606\u2605\u26BD\u2B50\u2728\uD83C\uDFC6]/u, '').trim();

        var tab = document.createElement('button');
        tab.className = 'fs-round-tab';
        tab.textContent = label;
        tab.setAttribute('data-round-idx', idx);

        // Mark completed
        try {
          if (typeof state !== 'undefined' && state.bracket && state.bracket.rounds[idx]) {
            var rm = state.bracket.rounds[idx].matches;
            var done = rm.length > 0 && rm.every(function(m) { return m.winner || m.status === 'finished'; });
            if (done) tab.classList.add('completed');
            var live = rm.some(function(m) { return m.status === 'live' || m.status === 'paused'; });
            if (live) tab.classList.add('has-live');
          }
        } catch(e) {}

        if (idx === activeRoundIdx) tab.classList.add('active');

        tab.addEventListener('click', function() {
          showFsRound(idx);
        });
        roundNav.appendChild(tab);
        roundDataArr.push({ el: rEl, tab: tab });
      });

      colBracket.appendChild(roundNav);

      // ─── Top 3 Scorers Widget ───
      var scorersWidget = buildTopScorersWidget();
      if (scorersWidget) colBracket.appendChild(scorersWidget);

      // Scroll area wrapper
      var scrollArea = document.createElement('div');
      scrollArea.className = 'fs-bracket-scroll-area';
      scrollArea.appendChild(bracketClone);
      colBracket.appendChild(scrollArea);

      // Show active round
      function showFsRound(idx) {
        rounds.forEach(function(r, i) {
          r.classList.toggle('fs-round-visible', i === idx);
        });
        roundDataArr.forEach(function(rd, i) {
          rd.tab.classList.toggle('active', i === idx);
        });
        currentFsRound = idx;
        // Reset auto-scroll
        resetAutoScroll();
      }

      showFsRound(activeRoundIdx);

      // ─── Auto-scroll vertical logic ───
      var currentFsRound = activeRoundIdx;
      var autoScrollDir = 1; // 1 = down, -1 = up
      var autoScrollSpeed = 0.6; // px per frame
      var autoScrollRAF = null;
      var autoScrollPaused = false;

      function autoScrollStep() {
        if (!isFullscreen || autoScrollPaused) {
          autoScrollRAF = null;
          return;
        }
        var maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
        if (maxScroll <= 0) {
          // Content fits, no need to scroll
          autoScrollRAF = requestAnimationFrame(autoScrollStep);
          return;
        }

        scrollArea.scrollTop += autoScrollDir * autoScrollSpeed;

        // Bounce at edges
        if (scrollArea.scrollTop >= maxScroll) {
          scrollArea.scrollTop = maxScroll;
          autoScrollDir = -1;
        } else if (scrollArea.scrollTop <= 0) {
          scrollArea.scrollTop = 0;
          autoScrollDir = 1;
        }

        autoScrollRAF = requestAnimationFrame(autoScrollStep);
      }

      function resetAutoScroll() {
        scrollArea.scrollTop = 0;
        autoScrollDir = 1;
        if (!autoScrollRAF && !autoScrollPaused) {
          autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }
      }

      // Pause auto-scroll on hover, resume on leave
      scrollArea.addEventListener('mouseenter', function() {
        autoScrollPaused = true;
        scrollArea.style.overflowY = 'auto';
      });
      scrollArea.addEventListener('mouseleave', function() {
        autoScrollPaused = false;
        scrollArea.style.overflowY = 'hidden';
        if (!autoScrollRAF) {
          autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }
      });

      // Start auto-scroll after a short delay
      setTimeout(function() {
        if (isFullscreen) {
          autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }
      }, 800);

      // Store cleanup function
      overlay._cleanupBracket = function() {
        if (autoScrollRAF) {
          cancelAnimationFrame(autoScrollRAF);
          autoScrollRAF = null;
        }
      };
    }

    if (repescagemPanel && repescagemPanel.style.display !== 'none') {
      var repClone = repescagemPanel.cloneNode(true);
      repClone.id = 'fs-repescagem-clone';
      var scrollAreaEl = colBracket.querySelector('.fs-bracket-scroll-area');
      if (scrollAreaEl) scrollAreaEl.appendChild(repClone);
    }

    } // end else (standard knockout bracket)

    // ─── Move slideshow container into right column ───
    var colSlideshow = overlay.querySelector('.fs-col-slideshow');
    colSlideshow.innerHTML = '';
    containerPlaceholder = document.createElement('div');
    containerPlaceholder.id = 'fs-container-placeholder';
    containerPlaceholder.style.display = 'none';
    container.parentNode.insertBefore(containerPlaceholder, container);
    colSlideshow.appendChild(container);

    // ─── Update live match bar ───
    updateLiveBar();
    // Auto-refresh live bar + check round completion every 1s
    if (fsLiveInterval) clearInterval(fsLiveInterval);
    fsLiveInterval = setInterval(function() {
      if (!isFullscreen) return;
      updateLiveBar();

      // Groups mode: re-clone groups to pick up score changes
      if (groupsActive) {
        try {
          var colBracketUpd = overlay.querySelector('.fs-col-bracket');
          var oldGroupsClone = colBracketUpd ? colBracketUpd.querySelector('#fs-groups-clone') : null;
          var groupsContainer2 = document.getElementById('groups-container');
          if (oldGroupsClone && groupsContainer2 && colBracketUpd) {
            var newGroupsClone = groupsContainer2.cloneNode(true);
            newGroupsClone.id = 'fs-groups-clone';
            newGroupsClone.className = 'fs-groups-content';
            newGroupsClone.style.display = 'block';
            var btnsToRemove = newGroupsClone.querySelectorAll('.classification-info-block, .group-actions, .repechage-section, .group-card-footer');
            btnsToRemove.forEach(function(el) { el.remove(); });
            colBracketUpd.replaceChild(newGroupsClone, oldGroupsClone);
          }
        } catch(e) {}
        return;
      }

      // Check if current round is completed → auto-advance to next
      try {
        if (typeof state !== 'undefined' && state.bracket && state.bracket.rounds && overlay) {
          var tabs = overlay.querySelectorAll('.fs-round-tab');
          var visibleRounds = overlay.querySelectorAll('.round:not(.connector-col)');
          var curIdx = -1;
          tabs.forEach(function(t, i) { if (t.classList.contains('active')) curIdx = i; });

          if (curIdx >= 0 && curIdx < state.bracket.rounds.length) {
            var curMatches = state.bracket.rounds[curIdx].matches;
            var allFinished = curMatches.length > 0 && curMatches.every(function(m) {
              return m.winner || m.status === 'finished';
            });
            if (allFinished && curIdx < state.bracket.rounds.length - 1) {
              // Advance to next round
              visibleRounds.forEach(function(r, i) {
                r.classList.toggle('fs-round-visible', i === curIdx + 1);
              });
              tabs.forEach(function(t, i) {
                t.classList.toggle('active', i === curIdx + 1);
                // Update completed status
                if (i <= curIdx) t.classList.add('completed');
              });
              // Reset scroll
              var scrollAreaCheck = overlay.querySelector('.fs-bracket-scroll-area');
              if (scrollAreaCheck) scrollAreaCheck.scrollTop = 0;
            }

            // Update live indicators on tabs
            tabs.forEach(function(t, i) {
              if (i < state.bracket.rounds.length) {
                var rm = state.bracket.rounds[i].matches;
                var done = rm.length > 0 && rm.every(function(m) { return m.winner || m.status === 'finished'; });
                var live = rm.some(function(m) { return m.status === 'live' || m.status === 'paused'; });
                t.classList.toggle('completed', done);
                t.classList.toggle('has-live', live);
              }
            });

            // Re-clone the bracket to update scores/statuses
            var bracketContainer2 = document.getElementById('bracket-container');
            if (bracketContainer2) {
              var scrollAreaUpd = overlay.querySelector('.fs-bracket-scroll-area');
              var oldClone = scrollAreaUpd ? scrollAreaUpd.querySelector('#fs-bracket-clone') : null;
              if (oldClone && scrollAreaUpd) {
                var newClone = bracketContainer2.cloneNode(true);
                newClone.id = 'fs-bracket-clone';
                newClone.style.display = 'block';
                // Re-apply round visibility
                var newRounds = newClone.querySelectorAll('.round:not(.connector-col)');
                var activeIdx = -1;
                tabs.forEach(function(t, i) { if (t.classList.contains('active')) activeIdx = i; });
                newRounds.forEach(function(r, i) {
                  r.classList.toggle('fs-round-visible', i === activeIdx);
                });
                scrollAreaUpd.replaceChild(newClone, oldClone);
              }
            }

            // Refresh top scorers widget
            var colBracketUpd = overlay.querySelector('.fs-col-bracket');
            if (colBracketUpd) {
              var oldScorers = colBracketUpd.querySelector('.fs-top-scorers');
              var newScorers = buildTopScorersWidget();
              if (oldScorers && newScorers) {
                colBracketUpd.replaceChild(newScorers, oldScorers);
              } else if (!oldScorers && newScorers) {
                var navEl = colBracketUpd.querySelector('.fs-round-nav');
                if (navEl && navEl.nextSibling) {
                  colBracketUpd.insertBefore(newScorers, navEl.nextSibling);
                }
              }
            }
          }
        }
      } catch(e) {}
    }, 1000);

    // Activate
    overlay.classList.add('fs-active');
    document.body.classList.add('fs-3col-active');
    btnFullscreen.innerHTML = '<span class="material-symbols-outlined">fullscreen_exit</span>';
    btnFullscreen.title = 'Sair da Tela Cheia';

    // Try native fullscreen API on the overlay
    var elem = overlay;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(function() {});
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  }

  function exitFullscreen() {
    isFullscreen = false;

    // Stop live bar refresh
    if (fsLiveInterval) {
      clearInterval(fsLiveInterval);
      fsLiveInterval = null;
    }

    // Cleanup auto-scroll
    if (overlay && overlay._cleanupBracket) {
      overlay._cleanupBracket();
    }

    // ─── Move slideshow container back to its original position ───
    if (containerPlaceholder && containerPlaceholder.parentNode) {
      containerPlaceholder.parentNode.insertBefore(container, containerPlaceholder);
      containerPlaceholder.parentNode.removeChild(containerPlaceholder);
      containerPlaceholder = null;
    }

    // Deactivate overlay
    if (overlay) {
      overlay.classList.remove('fs-active');
      overlay.classList.remove('fs-groups-mode');
    }
    document.body.classList.remove('fs-3col-active');
    btnFullscreen.innerHTML = '<span class="material-symbols-outlined">fullscreen</span>';
    btnFullscreen.title = 'Tela Cheia';

    // Exit native fullscreen if active
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(function() {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function toggleFullscreen() {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }

  btnFullscreen.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    toggleFullscreen();
  });

  // Sai do fullscreen se o navegador sair (ESC nativo)
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && isFullscreen) {
      exitFullscreen();
    }
  });
  document.addEventListener('webkitfullscreenchange', function () {
    if (!document.webkitFullscreenElement && isFullscreen) {
      exitFullscreen();
    }
  });

  // ESC como atalho adicional
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isFullscreen) {
      exitFullscreen();
    }
    // F11 para toggle
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  // ─── Inicializa exibindo o primeiro patrocinador ───
  showSponsor(0, 0);
}
