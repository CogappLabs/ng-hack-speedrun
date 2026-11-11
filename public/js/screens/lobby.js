// Feature 2: multiplayer waiting room. Pick an open room from the live list (or create one),
// see who's in it, and the host starts the game. Rooms stay in the list until the host starts.
// Uses the Net interface (../net/net.js), implemented over PartyServer in ../net/partykit.js.
import { createPartyNet, watchRooms } from '../net/partykit.js';
import { cssColor, selfPlayer } from '../net/net.js';
import { optionsLabel, cleanOptions } from '../options.js';
import { render, esc } from '../ui.js';

const NAME_KEY = 'artdrive.name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const saveName = n => { try { localStorage.setItem(NAME_KEY, n); } catch {} };

let $, off = [], stopWatching = () => {};

export default {
  mount(root, ctx) {
    const net = createPartyNet();
    ctx.session = { mode: 'multi', net };
    $ = render(root, `
      <div class="panel centre lobby">
        <h2>Multiplayer</h2>
        <div class="choose">
          <div class="row"><input class="name" placeholder="Your name" maxlength="20" value="${esc(savedName())}"></div>
          <h3>Open rooms</h3>
          <ul class="rooms"><li class="muted">Connecting…</li></ul>
          <h3>Or start your own</h3>
          <p class="muted create-options"></p>
          <div class="row">
            <input class="title" maxlength="30" autocomplete="off">
            <button class="primary create">Create room</button>
          </div>
        </div>
        <div class="room" hidden>
          <h3 class="room-title"></h3>
          <p class="muted room-options"></p>
          <ul class="players"></ul>
          <div class="row"><button class="primary start" hidden>Start game</button></div>
          <p class="muted waiting" hidden>Waiting for the host to start…</p>
        </div>
        <p class="error"></p>
        <div class="row"><button class="back">Back</button></div>
      </div>`);

    const name = () => $('.name').value.trim() || 'Player';
    const titlePlaceholder = () => { $('.title').placeholder = `${name()}’s room`; };
    titlePlaceholder();
    $('.create-options').textContent = `${optionsLabel(ctx.options)} (change it on the first screen)`;
    $('.name').oninput = titlePlaceholder;

    const busy = on => $('.choose').querySelectorAll('button').forEach(b => { b.disabled = on; });
    const fail = e => { busy(false); $('.error').textContent = e?.message ?? String(e); };
    const entered = room => {
      stopWatching();
      busy(false);
      $('.error').textContent = '';
      $('.choose').hidden = true;
      $('.room').hidden = false;
      $('.room-title').textContent = room.title;
      $('.room-options').textContent = optionsLabel(cleanOptions(room.options));
    };
    const start = promise => {
      saveName(name());
      busy(true);
      $('.error').textContent = '';
      promise.then(entered, fail);
    };

    // The list of open rooms, kept up to date by the server.
    stopWatching = watchRooms(rooms => {
      const list = $('.rooms');
      if (!rooms) {
        list.innerHTML = `<li class="muted">${navigator.onLine ? 'Connecting…' : 'You’re offline.'}</li>`;
        return;
      }
      if (!rooms.length) {
        list.innerHTML = '<li class="muted">No open rooms right now. Start your own below.</li>';
        return;
      }
      list.innerHTML = rooms.map(r => {
        const full = r.players >= r.max;
        return `
          <li><button class="room-btn" data-id="${esc(r.id)}"${full ? ' disabled' : ''}>
            <strong>${esc(r.title)}</strong>
            <span class="muted">${esc(r.host)} · ${r.players}/${r.max} players · ${esc(optionsLabel(cleanOptions(r.options)))}${full ? ' · full' : ''}</span>
          </button></li>`;
      }).join('');
      list.querySelectorAll('.room-btn').forEach(b => {
        b.onclick = () => start(net.joinRoom(b.dataset.id, name()));
      });
    });

    $('.create').onclick = () => start(net.createRoom(name(), $('.title').value.trim(), ctx.options));
    $('.title').onkeydown = e => { if (e.key === 'Enter') $('.create').click(); };
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
      net.on('start', ({ seed, options }) => { ctx.newRun(selfPlayer(net)?.slot ?? 0, seed, options); ctx.go('play'); }),
      net.on('error', msg => fail(msg)),
    ];
  },

  unmount() {
    stopWatching();
    stopWatching = () => {};
    off.forEach(f => f());
    off = [];
  },
};
