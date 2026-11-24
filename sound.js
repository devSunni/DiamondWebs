(function (root) {
  'use strict';

  let audioCtx = null;
  let cachedKoreanVoice = null;
  let activeUtterance = null;
  let activeSpeakAudio = null;
  let speakWatchdog = null;
  let speakDelayTimer = null;

  const settings = {
    sfxEnabled: true,
    ttsEnabled: true
  };

  function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, duration, { type = 'sine', gain = 0.14, delay = 0, endFreq = null } = {}) {
    if (!settings.sfxEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    }

    vol.gain.setValueAtTime(0.0001, now);
    vol.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playSelect() {
    playTone(540, 0.075, { type: 'triangle', gain: 0.11, endFreq: 680 });
  }

  function playStep() {
    playTone(340, 0.085, { type: 'triangle', gain: 0.15, endFreq: 260 });
    playTone(680, 0.05, { type: 'sine', gain: 0.07, delay: 0.015 });
  }

  function playHop(hopIndex) {
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
    const freq = scale[Math.min(hopIndex, scale.length - 1)];
    playTone(freq, 0.12, { type: 'sine', gain: 0.14, endFreq: freq * 1.06 });
    playTone(freq * 0.5, 0.07, { type: 'triangle', gain: 0.08 });
  }

  function playUndo() {
    playTone(420, 0.08, { type: 'sine', gain: 0.1, endFreq: 300 });
  }

  function playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      playTone(n, 0.24, { type: 'triangle', gain: 0.15, delay: i * 0.11 });
    });
  }

  function resolveKoreanVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return cachedKoreanVoice;
    const koVoices = voices.filter((v) => {
      const lang = (v.lang || '').toLowerCase().replace('_', '-');
      return lang === 'ko-kr' || lang.startsWith('ko');
    });
    if (!koVoices.length) return null;
    cachedKoreanVoice =
      koVoices.find((v) => /google|samsung|yuna|sora|heami|sunhi/i.test(v.name) && v.localService) ||
      koVoices.find((v) => v.localService) ||
      koVoices.find((v) => /google|samsung|yuna|sora|heami|sunhi/i.test(v.name)) ||
      koVoices[0];
    return cachedKoreanVoice;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    resolveKoreanVoice();
    window.speechSynthesis.addEventListener?.('voiceschanged', resolveKoreanVoice);
  }

  function normalizeSpeakText(text) {
    return String(text || '').replace(/[·/]/g, ', ').replace(/\s+/g, ' ').trim();
  }

  function playFallbackTTS(cleanText, userTriggered, onToast) {
    if (activeSpeakAudio) {
      try { activeSpeakAudio.pause(); } catch {}
      activeSpeakAudio = null;
    }
    const audio = new Audio();
    audio.referrerPolicy = 'no-referrer';
    audio.src = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    activeSpeakAudio = audio;
    audio.play?.().catch(() => {
      if (userTriggered && typeof onToast === 'function') {
        onToast('🔇 기기에서 한국어 음성 재생이 차단되었어요.');
      }
    });
  }

  function speakKorean(text, { userTriggered = false, onToast = null } = {}) {
    if (!settings.ttsEnabled) {
      if (userTriggered && typeof onToast === 'function') {
        onToast('🔇 음성이 꺼져 있어요! 상단 음성 버튼을 켜주세요.');
      }
      return;
    }
    const cleanText = normalizeSpeakText(text);
    if (!cleanText || typeof window === 'undefined') return;

    clearTimeout(speakWatchdog);
    clearTimeout(speakDelayTimer);
    if (activeSpeakAudio) {
      try { activeSpeakAudio.pause(); } catch {}
      activeSpeakAudio = null;
    }

    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      playFallbackTTS(cleanText, userTriggered, onToast);
      return;
    }

    const voice = resolveKoreanVoice();
    if ((synth.getVoices() || []).length > 0 && !voice) {
      playFallbackTTS(cleanText, userTriggered, onToast);
      return;
    }

    const doSpeak = () => {
      if (synth.paused) synth.resume();
      const u = new SpeechSynthesisUtterance(cleanText);
      u.lang = 'ko-KR';
      u.rate = 0.96;
      if (voice) u.voice = voice;
      let started = false;
      let settled = false;
      activeUtterance = u;
      u.onstart = () => {
        started = true;
        clearTimeout(speakWatchdog);
      };
      u.onend = () => {
        settled = true;
        clearTimeout(speakWatchdog);
        if (activeUtterance === u) activeUtterance = null;
      };
      u.onerror = (ev) => {
        clearTimeout(speakWatchdog);
        if (activeUtterance === u) activeUtterance = null;
        if (ev?.error === 'canceled' || ev?.error === 'interrupted') return;
        if (!settled) {
          settled = true;
          playFallbackTTS(cleanText, userTriggered, onToast);
        }
      };
      synth.speak(u);
      if (synth.paused) synth.resume();
      speakWatchdog = setTimeout(() => {
        if (!started && !settled) {
          settled = true;
          try { synth.cancel(); } catch {}
          playFallbackTTS(cleanText, userTriggered, onToast);
        }
      }, 950);
    };

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (synth.speaking || synth.pending) {
      synth.cancel();
      if (isIOS) doSpeak();
      else speakDelayTimer = setTimeout(doSpeak, 65);
    } else {
      doSpeak();
    }
  }

  root.DiamondSound = {
    settings,
    playSelect,
    playStep,
    playHop,
    playUndo,
    playWin,
    speakKorean
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
