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
  mira: 'Open the conversation already mid-thought: say hi like you know the player and ask if they have seen your friend Molly.',
  sonia: 'Open the conversation: gush about the DJ playing right now, tell the player they look cute, and ask if they are trying to get to the booth.',
};

const video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
const audio = Object.assign(document.createElement('audio'), { autoplay: true });
for (const el of [video, audio]) { el.setAttribute('playsinline', ''); el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'; }
document.body.append(video, audio);

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
  async start(girl, api) {
    if (conv) await this.stop();
    const left = await credits();
    if (left === 0) { api.onFail('no credits left today'); return; }
    let said = '', heard = '';
    const creditsTxt = left == null ? '' : ` · ${left} CREDITS`;
    const c = createNuanceConversation({
      token: async () => {
        const r = await fetch('/api/nuance-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ girl, uid }) });
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
        duck(0.2); api.status('LIVE' + creditsTxt); api.onVideo(video);
        send({ type: 'response.create', response: { instructions: OPEN[girl] || OPEN.mira } });
      }
      if (e.type === 'time-remaining' && typeof e.secondsRemaining === 'number') api.status(`LIVE · ${mmss(e.secondsRemaining)} LEFT`);
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
      if (name === 'MediaAccessError' || name === 'WebRTCUnavailableError') blocked = true;
      const why = name === 'MediaAccessError' ? 'mic blocked'
        : name === 'ActiveSessionError' ? 'another call is still on'
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
