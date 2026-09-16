/*
 * Neon Persona — Chat Box exclusivo para Twitch no Streamlabs.
 * Criado por Leonardo do Guia do Streamer com ajuda de IA.
 * Identificador de autoria: GDS-NP-2026-4C1A7E
 *
 * Uso gratuito conforme LICENSE.txt. Não redistribua, revenda, faça reupload
 * nem apresente este material como criação própria.
 */

(() => {
  "use strict";

  /* ================================================================
     CHAVE RÁPIDA
     true  = mostra e consulta os avatares
     false = oculta os avatares e não consulta a DecAPI
     ================================================================ */
  const MOSTRAR_AVATAR = true;

  const DECAPI_AVATAR = "https://decapi.me/twitch/avatar/";
  const TEMPO_LIMITE_MS = 6500;
  const TOTAL_TENTATIVAS = 2;
  const PAUSA_ENTRE_TENTATIVAS_MS = 900;
  const CACHE_FALHA_MS = 8000;
  const avatarCache = new Map();
  const mensagensProcessadas = new WeakSet();
  const NP_K = "4c1a7e";

  let iniciado = false;

  function normalizarUsername(valor) {
    return String(valor || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function usernameTwitchValido(username) {
    return /^[a-z0-9_]{1,25}$/.test(username);
  }

  function primeiraLetra(valor) {
    const nome = String(valor || "").trim();
    return nome ? nome.charAt(0).toUpperCase() : "?";
  }

  function urlHttpsValida(valor) {
    try {
      const url = new URL(valor);
      return url.protocol === "https:" ? url.href : null;
    } catch (_erro) {
      return null;
    }
  }

  function esperar(tempoMs) {
    return new Promise((resolver) => setTimeout(resolver, tempoMs));
  }

  async function consultarAvatarUmaVez(username, novaTentativa) {
    const controller = typeof AbortController === "function"
      ? new AbortController()
      : null;

    const timer = controller
      ? setTimeout(() => controller.abort(), TEMPO_LIMITE_MS)
      : null;

    try {
      const semCache = novaTentativa ? `?npv=${Date.now()}` : "";
      const resposta = await fetch(
        `${DECAPI_AVATAR}${encodeURIComponent(username)}/${semCache}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          signal: controller ? controller.signal : undefined
        }
      );

      if (!resposta.ok) {
        return null;
      }

      const texto = (await resposta.text()).trim();
      return urlHttpsValida(texto);
    } catch (_erro) {
      return null;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function consultarAvatar(username) {
    for (let tentativa = 0; tentativa < TOTAL_TENTATIVAS; tentativa += 1) {
      const avatarUrl = await consultarAvatarUmaVez(username, tentativa > 0);

      if (avatarUrl) {
        return avatarUrl;
      }

      if (tentativa + 1 < TOTAL_TENTATIVAS) {
        await esperar(PAUSA_ENTRE_TENTATIVAS_MS);
      }
    }

    return null;
  }

  function obterAvatar(username) {
    const agora = Date.now();
    const itemEmCache = avatarCache.get(username);

    if (itemEmCache && itemEmCache.expiraEm > agora) {
      return itemEmCache.consulta;
    }

    /*
     * A Promise também entra no cache: mensagens simultâneas do mesmo usuário
     * compartilham uma única consulta. Sucessos ficam pela sessão inteira;
     * falhas expiram rapidamente para permitir uma nova tentativa controlada.
     */
    const item = {
      consulta: null,
      expiraEm: Number.POSITIVE_INFINITY
    };

    const consulta = consultarAvatar(username).then((avatarUrl) => {
      item.expiraEm = avatarUrl
        ? Number.POSITIVE_INFINITY
        : Date.now() + CACHE_FALHA_MS;

      return avatarUrl;
    });

    item.consulta = consulta;
    avatarCache.set(username, item);
    return consulta;
  }

  function invalidarAvatar(username) {
    avatarCache.delete(username);
  }

  function adicionarQuebraDeCache(avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      url.searchParams.set("npv", Date.now().toString());
      return url.href;
    } catch (_erro) {
      return avatarUrl;
    }
  }

  function carregarImagem(mensagem, imagem, username, avatarUrl, podeRepetir) {
    imagem.onload = () => {
      imagem.onload = null;
      imagem.onerror = null;
      mensagem.classList.add("avatar-ready");
    };

    imagem.onerror = async () => {
      imagem.onload = null;
      imagem.onerror = null;
      mensagem.classList.remove("avatar-ready");
      imagem.removeAttribute("src");
      invalidarAvatar(username);

      if (!podeRepetir || !mensagem.isConnected) {
        return;
      }

      await esperar(PAUSA_ENTRE_TENTATIVAS_MS);
      const novaUrl = await obterAvatar(username);

      if (!novaUrl || !mensagem.isConnected) {
        return;
      }

      const urlFinal = novaUrl === avatarUrl
        ? adicionarQuebraDeCache(novaUrl)
        : novaUrl;

      carregarImagem(mensagem, imagem, username, urlFinal, false);
    };

    imagem.src = avatarUrl;
  }

  function aplicarCorDoUsuario(mensagem) {
    const nome = mensagem.querySelector(".name");
    const avatar = mensagem.querySelector(".avatar-wrap");

    if (!nome || !avatar) {
      return;
    }

    const cor = nome.style.color || getComputedStyle(nome).color;
    if (cor) {
      avatar.style.setProperty("--user-color", cor);
    }
  }

  async function prepararMensagem(mensagem) {
    if (
      !mensagem ||
      !mensagem.matches(".chat-entry[data-from]") ||
      mensagensProcessadas.has(mensagem)
    ) {
      return;
    }

    mensagensProcessadas.add(mensagem);

    const nomeOriginal = mensagem.dataset.from || "";
    const username = normalizarUsername(nomeOriginal);
    const fallback = mensagem.querySelector(".avatar-fallback");
    const imagem = mensagem.querySelector(".avatar-image");

    if (fallback) {
      fallback.textContent = primeiraLetra(nomeOriginal);
    }

    aplicarCorDoUsuario(mensagem);

    if (!MOSTRAR_AVATAR || !imagem || !usernameTwitchValido(username)) {
      return;
    }

    const avatarUrl = await obterAvatar(username);

    if (!avatarUrl || !mensagem.isConnected) {
      return;
    }

    carregarImagem(mensagem, imagem, username, avatarUrl, true);
  }

  function processarNosAdicionados(nos) {
    nos.forEach((no) => {
      if (!(no instanceof Element)) {
        return;
      }

      if (no.matches(".chat-entry[data-from]")) {
        prepararMensagem(no);
      }

      no.querySelectorAll(".chat-entry[data-from]").forEach(prepararMensagem);
    });
  }

  function iniciar() {
    if (iniciado) {
      return;
    }

    const log = document.getElementById("log");
    if (!log) {
      return;
    }

    iniciado = true;
    document.documentElement.dataset.npk = NP_K;
    document.documentElement.classList.toggle("avatar-disabled", !MOSTRAR_AVATAR);

    log.querySelectorAll(".chat-entry[data-from]").forEach(prepararMensagem);

    const observer = new MutationObserver((mutacoes) => {
      mutacoes.forEach((mutacao) => processarNosAdicionados(mutacao.addedNodes));
    });

    observer.observe(log, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  } else {
    iniciar();
  }

  /* Compatibilidade com o evento de carregamento emitido pelo widget. */
  document.addEventListener("onLoad", iniciar, { once: true });
})();
