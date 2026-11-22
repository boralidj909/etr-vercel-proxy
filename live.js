// Live NPC chat for the hosted build: Mira and Sonia as Nuance Live personas.
// Voice both ways, typed messages, and two game actions the persona can trigger (lead_player, give_charge).
// The game draws the persona's video through its sprite filter; this file only runs the call.
import { createNuanceConversation } from 'https://cdn.jsdelivr.net/npm/@nuancelabs/js-sdk@0.37.1/+esm';

const uid = (() => {
  try {
    let id = localStorage.getItem('etr_uid');
    if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem('etr_uid', id); }
    return id;
  } catch { return 'guest'; }
})();

const OPEN = {
  mira: { sweet: 'Open the conversation already mid-thought: say hi like you know the player and ask if they have seen your friend Molly.',
    snarky: 'Open the conversation unimpressed: a bored "what?", then ask if they have seen Molly, as if you doubt they would know.' },
  sonia: { sweet: 'Open the conversation: gush about the DJ playing right now, tell the player they look cute, and ask if they are trying to get to the booth.',
    snarky: 'Open the conversation annoyed that the player is standing in your shot while you film the DJ, then ask what they want.' },
};

const video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
const audio = Object.assign(document.createElement('audio'), { autoplay: true });
for (const el of [video, audio]) { el.setAttribute('playsinline', ''); el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'; }
document.body.append(video, audio);

// If the phone refuses the mic (in-app browsers, a declined prompt), hand the SDK a silent
// stand-in so the call still connects. She still talks and you type.
let micOff = false, silentCtx = null;
function silentStream() {
  silentCtx = silentCtx || new (window.AudioContext || window.webkitAudioContext)();
  const dst = silentCtx.createMediaStreamDestination();
  const g = silentCtx.createGain(); g.gain.value = 0;
  const o = silentCtx.createOscillator(); o.connect(g); g.connect(dst); o.start();
  return dst.stream;
}
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (micOff && c && c.audio && !c.video) return silentStream();
    try { return await realGUM(c); }
    catch (e) {
      if (c && c.audio && !c.video) { micOff = true; return silentStream(); }
      throw e;
    }
  };
}
// iPhone blocks sound that starts without a tap; any tap after that lets her voice play.
const kick = () => { for (const el of [audio, video]) if (el.srcObject && el.paused) el.play().catch(() => {}); if (silentCtx && silentCtx.state !== 'running') silentCtx.resume().catch(() => {}); };
document.addEventListener('touchend', kick, true); document.addEventListener('click', kick, true);

let conv = null;
let blocked = false; // mic refused or the browser can't call: stay on text
const duck = (v) => { try { window.ETR && ETR.duck && ETR.duck(v); } catch {} };
const send = (ev) => { if (conv) Promise.resolve(conv.sendInterfaceEvent(ev)).catch(() => {}); };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function credits() {
  try { const r = await fetch('/api/usage'); const j = await r.json(); return r.ok ? j.available_credits : null; } catch { return null; }
}

window.ETR_LIVE = {
  available: () => !blocked && window.isSecureContext && 'RTCPeerConnection' in window,
  micOff: () => micOff,
  async start(girl, api, opts) {
    const mood = (opts && opts.mood) === 'snarky' ? 'snarky' : 'sweet';
    if (conv) await this.stop();
    const left = await credits();
    if (left === 0) { api.onFail('no credits left today'); return; }
    let said = '', heard = '';
    const creditsTxt = left == null ? '' : ` · ${left} CREDITS`;
    const c = createNuanceConversation({
      token: async () => {
        const r = await fetch('/api/nuance-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ girl, uid, mood }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.token) throw new Error(j.error || 'token ' + r.status);
        return j.token;
      },
      mediaDevices: { cameraEnabled: false },
    });
    conv = c;
    c.onChange((e) => {
      if (c !== conv) return;
      if (e.type === 'state-changed') {
        if (e.state === 'connecting') api.status('CONNECTING' + creditsTxt);
        else if (e.state === 'queued') api.status('BUSY · RETRYING');
      }
      if (e.type === 'avatar-preparing') api.status('GETTING READY · UP TO 30 S');
      if (e.type === 'join-slow') api.status('STILL CONNECTING');
      if (e.type === 'tracks-changed') { c.avatar.videoTrack?.attach(video); c.avatar.audioTrack?.attach(audio); }
      if (e.type === 'avatar-presented') {
        duck(0.2); api.status((micOff ? 'LIVE · TYPE TO TALK' : 'LIVE') + creditsTxt); api.onVideo(video); kick();
        send({ type: 'response.create', response: { instructions: (OPEN[girl] || OPEN.mira)[mood] } });
      }
      if (e.type === 'time-remaining' && typeof e.secondsRemaining === 'number') api.status(`LIVE${micOff ? ' · TYPE' : ''} · ${mmss(e.secondsRemaining)} LEFT`);
      if (e.type === 'session-ended') { duck(1); conv = null; api.onEnd(e.reason); }
    });
    c.onInterfaceEvent((ev) => {
      if (c !== conv) return;
      if (ev.type === 'session.output_transcript.delta') { said += String(ev.delta ?? ''); api.onHer(said, false); }
      if (ev.type === 'session.output_audio.done') { if (said) api.onHer(said, true); said = ''; }
      if (ev.type === 'session.input_transcript.delta') { heard += String(ev.delta ?? ''); api.onYou(heard, false); }
      if (ev.type === 'session.input_transcript.done') { const t = ev.transcript || ev.text || heard; if (t) api.onYou(String(t), true); heard = ''; }
    });
    c.onToolCall(async (call) => {
      let out;
      try { out = api.tool(call.name, call.arguments || {}); } catch { out = { error: { message: 'That did not work' } }; }
      try { await c.sendToolResult(call.callId, out); } catch {}
    });
    try {
      await c.connect();
    } catch (err) {
      const name = (err && err.name) || '';
      if (name === 'WebRTCUnavailableError' || (name === 'ApiError' && err.code === 'legal_blocked')) blocked = true;
      const why = name === 'MediaAccessError' ? 'mic blocked'
        : name === 'ActiveSessionError' ? 'another call is still on, try again in a minute'
        : name === 'GuestLimitError' ? 'guest limit reached'
        : name === 'LegalRequiredError' ? 'the Nuance account owner needs to accept their terms'
        : name === 'ApiError' && err.code === 'legal_blocked' ? 'Nuance live chat is not offered where this phone is'
        : name === 'MaintenanceError' ? 'Nuance is down for maintenance'
        : name === 'PolicyCurfewError' ? 'Nuance paused new calls'
        : /slow_down/.test(String(err && err.message)) ? 'too many tries, wait a few minutes'
        : name === 'ApiError' && err.code === 'credits_spent' ? 'no credits left today'
        : name === 'ApiError' && err.code ? err.code : name || 'error';
      console.warn('[ETR live] could not start:', name, err && err.message);
      if (c === conv) conv = null;
      duck(1);
      api.onFail(why);
    }
  },
  type(text) {
    send({ type: 'response.item.create', item: { type: 'message', role: 'user', content: String(text).slice(0, 2000) } });
    send({ type: 'response.create' });
  },
  note(text) { send({ type: 'session.instructions.append', delegation_id: null, content: String(text).slice(0, 2000) }); },
  async stop() {
    const c = conv; conv = null; duck(1);
    if (c) { try { await c.disconnect(); } catch {} }
  },
};
