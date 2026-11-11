// Feature 2: multiplayer waiting room. Create or join a room, see who's in it, host starts the game.
// Uses the Net interface (../net/net.js), implemented over PartyKit in ../net/partykit.js.
import { createPartyNet } from '../net/partykit.js';
import { cssColor, selfPlayer } from '../net/net.js';
import { render, esc } from '../ui.js';

const NAME_KEY = 'artdrive.name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const saveName = n => { try { localStorage.setItem(NAME_KEY, n); } catch {} };

let $, off = [];

export default {
  mount(root, ctx) {
    const net = createPartyNet();
    ctx.session = { mode: 'multi', net };
    $ = render(root, `
      <div class="panel centre lobby">
        <h2>Multiplayer</h2>
        <div class="choose">
          <div class="row"><input class="name" placeholder="Your name" maxlength="20" value="${esc(savedName())}"></div>
          <div class="row">
            <button class="primary create">Create room</button>
          </div>
          <div class="row">
            <input class="join-code" placeholder="Room code" maxlength="4" size="9" autocomplete="off">
            <button class="join">Join</button>
          </div>
        </div>
        <div class="room" hidden>
          <p class="muted">Room code: tell the other players</p>
          <div class="code"></div>
          <ul class="players"></ul>
          <div class="row"><button class="primary start" hidden>Start game</button></div>
          <p class="muted waiting" hidden>Waiting for the host to start…</p>
        </div>
        <p class="error"></p>
        <div class="row"><button class="back">Back</button></div>
      </div>`);

    const name = () => {
      const n = $('.name').value.trim() || 'Player';
      saveName(n);
      return n;
    };
    const busy = on => $('.choose').querySelectorAll('button').forEach(b => { b.disabled = on; });
    const fail = e => { busy(false); $('.error').textContent = e?.message ?? String(e); };
    const entered = code => {
      busy(false);
      $('.error').textContent = '';
      $('.choose').hidden = true;
      $('.room').hidden = false;
      $('.code').textContent = code;
    };
    const join = () => {
      const code = $('.join-code').value.trim();
      if (!code) return fail(new Error('Enter a room code.'));
      busy(true);
      net.joinRoom(code, name()).then(entered, fail);
    };

    $('.create').onclick = () => { busy(true); net.createRoom(name()).then(entered, fail); };
    $('.join').onclick = join;
    $('.join-code').onkeydown = e => { if (e.key === 'Enter') join(); };
    $('.start').onclick = () => net.startGame();
    $('.back').onclick = () => { net.leave(); ctx.session = { mode: 'single', net: null }; ctx.go('landing'); };

    off = [
      net.on('players', players => {
        $('.players').innerHTML = players.map(p => `
          <li><span style="color:${cssColor(p.color)}">●</span> ${esc(p.name)}${p.id === net.selfId ? ' (you)' : ''}${p.host ? ' · host' : ''}</li>`).join('');
        const host = !!selfPlayer(net)?.host;
        $('.start').hidden = !host;
        $('.waiting').hidden = host;
      }),
      net.on('start', () => { ctx.newRun(selfPlayer(net)?.slot ?? 0); ctx.go('play'); }),
      net.on('error', msg => fail(msg)),
    ];
  },

  unmount() {
    off.forEach(f => f());
    off = [];
  },
};
