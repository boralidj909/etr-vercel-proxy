// Live NPC chat for the hosted build: Mira and Sonia as Nuance Live personas.
// The game shows the persona's video through its sprite filter; this file only runs the call.
import { createNuanceConversation } from 'https://cdn.jsdelivr.net/npm/@nuancelabs/js-sdk@0.37.1/+esm';

const uid = (() => {
  try {
    let id = localStorage.getItem('etr_uid');
    if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem('etr_uid', id); }
    return id;
  } catch { return 'guest'; }
})();

const OPEN = {
  mira: 'Jump straight in, already mid-thought: say hi like you know the player and ask if they have seen your friend Molly.',
  sonia: 'Jump straight in: gush about the DJ playing right now, then tell the player you know a shortcut to the booth and they should follow you.',
};

// Hidden media elements; the game draws the video into its dialog portrait.
const video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: true });
const audio = Object.assign(document.createElement('audio'), { autoplay: true });
for (const el of [video, audio]) { el.setAttribute('playsinline', ''); el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'; }
document.body.append(video, audio);

let conv = null;
let blocked = false; // mic refused or browser can't call: stay on the scripted lines

const duck = (v) => { try { window.ETR && ETR.duck && ETR.duck(v); } catch {} };

window.ETR_LIVE = {
  available: () => !blocked && window.isSecureContext && 'RTCPeerConnection' in window,
  async start(girl, api) {
    if (conv) await this.stop();
    let said = '';
    const c = createNuanceConversation({
      token: async () => {
        const r = await fetch('/api/nuance-token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ girl, uid }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.token) throw new Error(j.error || 'token ' + r.status);
        return j.token;
      },
      maxSessionSeconds: 32,
      mediaDevices: { cameraEnabled: false },
    });
    conv = c;
    c.onChange((e) => {
      if (c !== conv) return;
      if (e.type === 'tracks-changed') {
        c.avatar.videoTrack?.attach(video);
        c.avatar.audioTrack?.attach(audio);
      }
      if (e.type === 'avatar-presented') {
        duck(0.2);
        api.onVideo(video);
        Promise.resolve(c.sendInterfaceEvent({ type: 'response.create', response: { instructions: OPEN[girl] || OPEN.mira } })).catch(() => {});
      }
      if (e.type === 'session-ended') { duck(1); conv = null; api.onEnd(e.reason); }
    });
    c.onInterfaceEvent((ev) => {
      if (c !== conv) return;
      if (ev.type === 'session.output_transcript.delta') { said += String(ev.delta ?? ''); api.onText(said); }
      if (ev.type === 'session.output_audio.done') said = '';
    });
    try {
      await c.connect();
    } catch (err) {
      const name = (err && err.name) || '';
      if (name === 'MediaAccessError' || name === 'WebRTCUnavailableError') blocked = true;
      console.warn('[ETR live] could not start:', name, err && err.message);
      if (c === conv) conv = null;
      duck(1);
      api.onFail(name);
    }
  },
  say(instructions) {
    if (conv) Promise.resolve(conv.sendInterfaceEvent({ type: 'response.create', response: { instructions } })).catch(() => {});
  },
  async stop() {
    const c = conv; conv = null; duck(1);
    if (c) { try { await c.disconnect(); } catch {} }
  },
};
