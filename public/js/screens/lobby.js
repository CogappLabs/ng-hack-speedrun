// Feature 2: multiplayer waiting room. Create or join a room, see who's in it, host starts the game.
// Works against the Net interface in ../net/net.js. Until a real backend exists it uses
// createLocalNet(), so you can create a room with only yourself in it, but not join one.
import { createLocalNet } from '../net/net.js';
import { render, esc } from '../ui.js';

let $, off = [];

export default {
  mount(root, ctx) {
    const net = createLocalNet();
    ctx.session = { mode: 'multi', net };
    $ = render(root, `
      <div class="panel centre lobby">
        <h2>Multiplayer</h2>
        <div class="row"><input class="name" placeholder="Your name" maxlength="20"></div>
        <div class="row choose">
          <button class="primary create">Create room</button>
          <input class="join-code" placeholder="Room code" maxlength="8" size="9">
          <button class="join">Join</button>
        </div>
        <div class="room" hidden>
          <p class="muted">Room code</p>
          <div class="code"></div>
          <ul class="players"></ul>
          <div class="row"><button class="primary start" hidden>Start game</button></div>
          <p class="muted waiting" hidden>Waiting for the host to start…</p>
        </div>
        <p class="error" style="color:#f88"></p>
        <div class="row"><button class="back">Back</button></div>
      </div>`);

    const name = () => $('.name').value.trim() || 'Player';
    const showRoom = (code, host) => {
      $('.choose').hidden = true;
      $('.room').hidden = false;
      $('.code').textContent = code;
      $('.start').hidden = !host;
      $('.waiting').hidden = host;
    };
    const fail = e => { $('.error').textContent = e.message ?? String(e); };

    $('.create').onclick = () => net.createRoom(name()).then(code => showRoom(code, true), fail);
    $('.join').onclick = () => {
      const code = $('.join-code').value.trim().toUpperCase();
      net.joinRoom(code, name()).then(() => showRoom(code, false), fail);
    };
    $('.start').onclick = () => net.startGame();
    $('.back').onclick = () => { net.leave(); ctx.session = { mode: 'single', net: null }; ctx.go('landing'); };

    off = [
      net.on('players', players => {
        $('.players').innerHTML = players.map(p =>
          `<li><span style="color:#${p.color.toString(16).padStart(6, '0')}">●</span> ${esc(p.name)}${p.host ? ' (host)' : ''}</li>`).join('');
      }),
      net.on('start', () => { ctx.newRun(); ctx.go('play'); }),
      net.on('error', msg => fail(msg)),
    ];
  },

  unmount() {
    off.forEach(f => f());
    off = [];
  },
};
