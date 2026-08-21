import { GameLoop } from './core/loop.js';
import { PlayerInput, autoBind, keyboard } from './core/input.js';
import { Camera } from './engine/camera.js';
import { Match } from './game/match.js';
import { Renderer } from './render/renderer.js';
import { Renderer3D } from './render/renderer3d.js';
import { HUD } from './render/hud.js';
import { CharacterSelect } from './ui/characterSelect.js';
import { MainMenu } from './ui/mainMenu.js';
import { PauseMenu } from './ui/pauseMenu.js';
import { ResultMenu } from './ui/resultMenu.js';
import { VictorySequence } from './game/victory.js';
import { CPUController } from './game/cpuController.js';
import { STAGES, trainingCamp } from './data/stages/index.js';
import { StageSelect } from './ui/stageSelect.js';
import { DummyController } from './game/dummyController.js';
import { bandit } from './data/fighters/bandit.js';
import { wizard } from './data/fighters/wizard.js';
import { barbarian } from './data/fighters/barbarian.js';
import { goblin } from './data/fighters/goblin.js';
import { megaknight } from './data/fighters/megaknight.js';
import { report as balanceReport } from './tools/balance.js';
import { Connection } from './net/connection.js';
import { Lockstep } from './net/lockstep.js';
import { OnlineMenu } from './ui/onlineMenu.js';

/**
 * Entry point and scene manager.
 *
 * Scenes: 'select' -> 'match'.
 *
 * Two views render the same simulation: the 2.5D view (default) and a flat
 * top-down-style debug view (F3). The simulation itself is 2D in both cases —
 * the 3D renderer only mirrors the z = 0 plane into a perspective scene.
 */

const ROSTER = [bandit, wizard, barbarian, goblin, megaknight];
/** In-world tint for each player's model. */
const PLAYER_COLORS = ['#5ad2c4', '#ff8a4c'];
/**
 * HUD card frame colour per player slot — red for P1, blue for P2, matching
 * the UI mock. Kept separate from the model tint so the fighters keep their
 * own identity on stage.
 */
const PLAYER_HUD_COLORS = ['#d2382f', '#2f6fd0'];
/**
 * Clothing recolour per slot, matching those HUD frames. This is how the two
 * fighters are told apart on stage — including from each other in a mirror
 * match, which is the case a shared palette cannot survive.
 */
const PLAYER_VARIANTS = ['red', 'blue'];
const PLAYER_COUNT = 2;

const canvas3d = document.getElementById('game3d');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const camera = new Camera(1, 1);
const renderer2d = new Renderer(ctx, camera);
const hud = new HUD(ctx);

/** 3D is the intended presentation; fall back to flat if WebGL is unavailable. */
let renderer3d = null;
let view = '3d';
try {
  renderer3d = new Renderer3D(canvas3d, camera);
} catch (err) {
  console.warn('WebGL unavailable, falling back to the flat renderer:', err);
  view = '2d';
}

let inputs = autoBind(PLAYER_COUNT).map((binding, i) => new PlayerInput(i, binding));

/** Scenes: 'title' -> 'stage' -> 'select' -> 'match'. */
let scene = 'title';
/** Training only: refills both bars every frame. Toggled from the pause menu. */
let infiniteElixir = false;
/** 'battle' (two humans) or 'training' (human vs a CPU dummy). */
let mode = 'battle';
/** Stand-in input for the training dummy; swapped in for player 2. */
const dummyInput = new DummyController(1);
/** Difficulty when player 2 is a CPU in a normal battle; null means human. */
let cpuLevel = null;
let cpuInput = null;
let mainMenu = new MainMenu(inputs, canvas);
/** End-of-match options, created once the ceremony reaches its stats phase. */
let results = null;
/** The victory ceremony; owns the fighters and the camera once a match ends. */
let victory = null;
let select = new CharacterSelect(inputs, PLAYER_HUD_COLORS, canvas, mode, cpuLevel);
let stageSelect = new StageSelect(inputs, canvas);
/** The arena a battle is fought on; training always uses the Training Camp. */
let chosenStage = STAGES[0];

/**
 * Netplay state.
 *
 * `net` is the link, `lockstep` drives the simulation from both players'
 * inputs, and `onlineMenu` is the host/join/pick screen. All three are null
 * offline, and `mode === 'online'` is the single flag the rest of the file
 * checks.
 */
let net = null;
let lockstep = null;
let onlineMenu = null;
/** Our own pick and the peer's, held until both have arrived. */
let onlinePicks = [null, null];
let match = null;
let lastSelections = null;
/** Non-null while the battle is paused; the match is simply not stepped. */
let pause = null;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  for (const c of [canvas, canvas3d]) {
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  camera.resize(canvas.width, canvas.height);
  if (renderer3d) renderer3d.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// Rebinding on hotplug means a controller can be connected at any time.
window.addEventListener('gamepadconnected', rebindDevices);
window.addEventListener('gamepaddisconnected', rebindDevices);

function rebindDevices() {
  const bindings = autoBind(PLAYER_COUNT);
  inputs.forEach((inp, i) => { inp.binding = bindings[i]; });
}

function use3d() { return view === '3d' && renderer3d !== null; }

function startMatch(defs) {
  lastSelections = defs;
  pause = null;
  results = null;
  endCeremony();
  const training = mode === 'training';
  // A fresh controller per match so the AI carries no state across restarts.
  cpuInput = (!training && cpuLevel) ? new CPUController(1, cpuLevel) : null;

  match = new Match({
    stageDef: training ? trainingCamp : chosenStage,
    camera,
    rules: training
      // Training never ends: no clock, no stock-out, no late-game ramp.
      ? { untimed: true, training: true, stocks: 99, lateGame: false, infiniteElixir }
      : {},
    entries: defs.map((def, i) => {
      const cpu = i === 1 && (training || !!cpuLevel);
      const input = i === 1
        ? (training ? dummyInput : (cpuInput || inputs[i]))
        : inputs[i];
      return {
        def,
        input,
        cpu,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        hudColor: PLAYER_HUD_COLORS[i % PLAYER_HUD_COLORS.length],
        variant: PLAYER_VARIANTS[i % PLAYER_VARIANTS.length],
      };
    }),
  });
  scene = 'match';
}

/**
 * Starts an online match once both fighters are known.
 *
 * The two machines must build an **identical** Match: same stage, same fighters
 * in the same slots, same rules. Seat order does that — the host is always slot
 * 0 — so both sides construct the same thing without negotiating anything
 * beyond two fighter ids.
 *
 * Both slots are driven by real `PlayerInput` objects: the lockstep driver
 * feeds seat 0 from the local device or the wire depending on which seat we
 * are, so the simulation never learns that one of them is remote.
 */
function startOnlineMatch() {
  pause = null;
  results = null;
  endCeremony();
  lastSelections = onlinePicks.slice();

  match = new Match({
    stageDef: chosenStage,
    camera,
    rules: { externalInput: true },
    entries: onlinePicks.map((def, i) => ({
      def,
      input: inputs[i],
      cpu: false,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      hudColor: PLAYER_HUD_COLORS[i % PLAYER_HUD_COLORS.length],
      variant: PLAYER_VARIANTS[i % PLAYER_VARIANTS.length],
    })),
  });
  lockstep = new Lockstep(net, inputs);
  scene = 'match';
}

/** Tears the link down and returns to the title, for any exit or failure. */
function endOnline(message) {
  if (net) net.close();
  net = null;
  lockstep = null;
  onlinePicks = [null, null];
  mode = 'battle';
  goToTitle();
  if (message) mainMenu.notice = message;
}

function goToOnline() {
  onlineMenu = new OnlineMenu(inputs, canvas);
  scene = 'online';
  match = null;
  pause = null;
  results = null;
  endCeremony();
  for (const inp of inputs) inp.clearBuffer();
}

/** Opens the link and wires every message the client cares about. */
async function openLink() {
  net = new Connection();
  net.on('hosted', (m) => {
    onlineMenu.mode = 'hosting';
    onlineMenu.code = m.code;
  });
  net.on('paired', () => {
    // The host owns the stage — it picked one before hosting — and tells the
    // joiner, so both build the same arena from one authority rather than two
    // guesses.
    if (net.seat === 0) net.send({ t: 'setup', stage: chosenStage.id });
    onlineMenu.startPicking([bandit, wizard], chosenStage.name);
  });
  net.on('peerSetup', (m) => {
    const found = STAGES.find((s) => s.id === m.stage);
    if (found) chosenStage = found;
    if (onlineMenu) onlineMenu.stageName = chosenStage.name;
  });
  net.on('peerReady', (m) => {
    onlinePicks[1 - net.seat] = m.pick === 'wizard' ? wizard : bandit;
    tryStartOnline();
  });
  net.on('peerLeft', () => endOnline('opponent disconnected'));
  net.on('error', (m) => { if (onlineMenu) onlineMenu.setError(m.message); });
  net.on('closed', () => { if (scene === 'online' || scene === 'match') endOnline('connection lost'); });
  await net.connect();
}

function tryStartOnline() {
  if (onlinePicks[0] && onlinePicks[1] && scene === 'online') startOnlineMatch();
}

function goToStageSelect() {
  stageSelect = new StageSelect(inputs, canvas);
  scene = 'stage';
  match = null;
  pause = null;
  results = null;
  endCeremony();
  for (const inp of inputs) inp.clearBuffer();
}

function goToSelect() {
  select = new CharacterSelect(inputs, PLAYER_HUD_COLORS, canvas, mode, cpuLevel);
  scene = 'select';
  match = null;
  pause = null;
  results = null;
  endCeremony();
  for (const inp of inputs) inp.clearBuffer();
}

function goToTitle() {
  mainMenu = new MainMenu(inputs, canvas);
  scene = 'title';
  match = null;
  pause = null;
  results = null;
  endCeremony();
  for (const inp of inputs) inp.clearBuffer();
}

/** Ends the ceremony and hands the rigs back to the simulation. */
function endCeremony() {
  victory = null;
  if (renderer3d) renderer3d.clearCeremony();
}

/** Opens the pause menu, attributed to whoever pressed Start. */
function openPause(playerIndex) {
  pause = new PauseMenu(inputs, playerIndex, PLAYER_HUD_COLORS[playerIndex] || '#d2382f', canvas, {
    training: mode === 'training',
    infiniteElixir,
  });
}

function resolvePauseAction(action) {
  switch (action) {
    case 'resume':
      pause = null;
      for (const inp of inputs) inp.clearBuffer();
      break;
    case 'elixir':
      // Toggled inside the menu; mirror it here so it survives a restart and
      // reaches the running match immediately.
      infiniteElixir = pause.infiniteElixir;
      if (match) match.rules.infiniteElixir = infiniteElixir;
      break;
    case 'restart': startMatch(lastSelections); break;
    case 'select': goToSelect(); break;
    case 'main': goToTitle(); break;
    default: break;
  }
}

function update() {
  if (scene === 'title') {
    const choice = mainMenu.update();
    if (choice === 'battle') {
      // The opponent (human or CPU) is chosen on the character select itself.
      mode = 'battle';
      goToStageSelect();
    } else if (choice === 'online') {
      mainMenu.notice = null;
      goToOnline();
    } else if (choice === 'training') {
      // Training has one arena, so there is nothing to pick — go straight to
      // the roster.
      mode = 'training';
      cpuLevel = null;
      goToSelect();
    }
    return;
  }

  if (scene === 'online') {
    const action = onlineMenu.update();
    if (action === 'cancel') { endOnline(null); return; }
    if (action === 'host') {
      // The host chooses the arena first, then opens a room: the code is the
      // last step, so it is on screen only while it is actually joinable.
      mode = 'online';
      onlineMenu = null;
      goToStageSelect();
      return;
    }
    if (action === 'join') {
      mode = 'online';
      const code = onlineMenu.typedCode;
      openLink()
        .then(() => net.join(code))
        .catch(() => onlineMenu && onlineMenu.setError('could not reach the relay'));
      return;
    }
    if (action === 'pick') {
      const def = onlineMenu.pickedDef;
      onlinePicks[net.seat] = def;
      net.send({ t: 'ready', pick: def.id });
      tryStartOnline();
      return;
    }
    return;
  }

  if (scene === 'stage') {
    const action = stageSelect.update();
    if (action === 'confirm') {
      chosenStage = stageSelect.stage;
      if (mode === 'online') {
        // Stage chosen — now open the room and show the code.
        goToOnline();
        onlineMenu.mode = 'connecting';
        onlineMenu.status = 'creating a match';
        openLink()
          .then(() => net.host())
          .catch(() => onlineMenu && onlineMenu.setError('could not reach the relay'));
      } else {
        goToSelect();
      }
    } else if (action === 'cancel') {
      if (mode === 'online') { mode = 'battle'; goToOnline(); } else goToTitle();
    }
    return;
  }

  if (scene === 'select') {
    if (select.update()) {
      // The select screen owns the player-2 slot type, so read it back.
      cpuLevel = select.cpuLevel;
      startMatch(select.selections());
    }
    return;
  }

  // --- match ---
  /**
   * Online runs on its own clock.
   *
   * There is no pausing: a pause menu only works when one machine can stop
   * time, and here neither can. The frame advances when both players' inputs
   * for it have arrived and not before, so `step()` returning false means the
   * peer is behind and this frame is simply rendered again.
   */
  if (mode === 'online' && lockstep) {
    lockstep.publishLocal();
    if (!lockstep.step()) return;       // stalled: hold the last frame
    match.step();
    lockstep.checkpoint(match);
    if (match.over && match.overFreeze > 26) {
      if (!victory) victory = new VictorySequence(match);
      updateCeremony();
    }
    return;
  }

  if (pause) {
    resolvePauseAction(pause.update());
    return;
  }

  // Start opens the pause menu, except on the results screen where it rematches.
  if (!match.over) {
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].peek('start')) {
        inputs[i].consume('start');
        openPause(i);
        return;
      }
    }
  }

  match.step();

  // Once the KO has read, the ceremony takes over: a short cut sequence on the
  // winner, and then the stats with the options menu over them.
  if (match.over && match.overFreeze > 26) {
    if (!victory) victory = new VictorySequence(match);
    updateCeremony();
  }
}

function updateCeremony() {
  if (victory.phase === 'anim') {
    // The sequence is unskippable, but inputs are still polled and flushed
    // through it. Nothing else polls once the match is over, and without this a
    // button mashed during the animation stays latched and gets spent on the
    // options menu the instant it appears — picking REMATCH for the player.
    for (const p of inputs) p.poll();
    for (const p of inputs) p.clearBuffer();
    keyboard.flush();
    victory.step();
    return;
  }

  victory.step();
  if (!results) results = new ResultMenu(inputs, canvas);
  const choice = results.update();
  if (choice === 'rematch') { results = null; startMatch(lastSelections); }
  else if (choice === 'select') { results = null; goToSelect(); }
  else if (choice === 'main') { results = null; goToTitle(); }
}

function render() {
  // Menus are flat UI; hide the 3D layer behind them.
  if (scene === 'title') {
    canvas3d.style.display = 'none';
    mainMenu.draw(ctx);
    return;
  }
  if (scene === 'online') {
    canvas3d.style.display = 'none';
    onlineMenu.draw(ctx);
    return;
  }
  if (scene === 'stage') {
    canvas3d.style.display = 'none';
    stageSelect.draw(ctx);
    return;
  }
  if (scene === 'select') {
    canvas3d.style.display = 'none';
    select.draw(ctx);
    return;
  }

  if (use3d()) {
    canvas3d.style.display = 'block';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The ceremony replaces both the framing and the HUD: no percentages or
    // Elixir bars over a match that has already been decided.
    if (victory) {
      renderer3d.drawVictory(match, victory);
      hud.drawCeremony(match, victory, canvas.width, canvas.height);
    } else {
      renderer3d.draw(match);
      // The 2D canvas becomes a transparent overlay carrying only the HUD.
      hud.draw(match, (x, y) => renderer3d.worldToScreen(x, y, canvas.width, canvas.height));
    }
  } else {
    canvas3d.style.display = 'none';
    renderer2d.draw(match);
    hud.draw(match, (x, y) => {
      const p = camera.worldToScreen(x, y);
      return { x: p.x, y: p.y, behind: false };
    });
  }

  // The pause menu draws over the frozen battle, which stays visible behind it.
  if (pause) pause.draw(ctx);
  if (results) results.draw(ctx, canvas.width, canvas.height);
  if (loop.paused) drawPausedBanner();
}

function drawPausedBanner() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px Trebuchet MS';
  ctx.fillStyle = 'rgba(255,209,102,0.9)';
  ctx.fillText('PAUSED — O to step one frame, P to resume', canvas.width / 2, 150);
  ctx.restore();
}

const loop = new GameLoop({ update, render });
loop.start();

// --- Developer controls -----------------------------------------------------
// A prototype for validating gameplay needs frame-level inspection.
window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'F1': {
      // One source of truth, so the two views never disagree about the overlay.
      const active = use3d() ? renderer3d.debug : renderer2d.debug;
      const next = !active.SHOW_BOXES;
      renderer2d.debug.SHOW_BOXES = next;
      if (renderer3d) renderer3d.debug.SHOW_BOXES = next;
      e.preventDefault();
      break;
    }
    case 'F2': renderer2d.debug.SHOW_STATE = !renderer2d.debug.SHOW_STATE; e.preventDefault(); break;
    case 'F3':
      if (renderer3d) view = view === '3d' ? '2d' : '3d';
      e.preventDefault();
      break;
    case 'KeyP': loop.paused = !loop.paused; break;
    case 'KeyO': if (loop.paused) loop.stepRequested = true; break;
    case 'KeyR': if (scene === 'match' && lastSelections) startMatch(lastSelections); break;
    case 'Escape':
      // Escape mirrors Start: open/close the pause menu in a battle, and step
      // back out of the select screen.
      if (scene === 'match' && !match.over) {
        if (pause) resolvePauseAction('resume'); else openPause(0);
      } else if (scene === 'select') {
        // Back out one step, not all the way home: a battle came through the
        // stage select, training did not.
        if (mode === 'training') goToTitle(); else goToStageSelect();
      } else if (scene === 'stage') {
        goToTitle();
      }
      break;
    default: break;
  }
});

// Clear held keys when focus is lost so inputs do not stick down.
window.addEventListener('blur', () => { keyboard.down.clear(); });

// Expose for console poking during balance passes and automated checks.
window.CR = {
  get match() { return match; },
  get inputs() { return inputs; },
  get scene() { return scene; },
  get select() { return select; },
  get stageSelect() { return stageSelect; },
  get chosenStage() { return chosenStage; },
  set chosenStage(s) { chosenStage = s; },
  get mainMenu() { return mainMenu; },
  get results() { return results; },
  get victory() { return victory; },
  get pause() { return pause; },
  get mode() { return mode; },
  set mode(m) { mode = m; },
  get cpuLevel() { return cpuLevel; },
  set cpuLevel(l) { cpuLevel = l; },
  get cpu() { return cpuInput; },
  toTitle: goToTitle,
  get view() { return view; },
  set view(v) { view = v; },
  loop,
  hud,
  renderer2d,
  renderer3d,
  ROSTER,
  /** Jump straight into a match, e.g. CR.start(['bandit','wizard']). */
  start(ids = ['bandit', 'wizard']) {
    startMatch(ids.map((id) => ROSTER.find((d) => d.id === id) || ROSTER[0]));
  },
  toSelect: goToSelect,
  toStageSelect: goToStageSelect,
  get net() { return net; },
  get lockstep() { return lockstep; },
  get onlineMenu() { return onlineMenu; },
  toOnline: goToOnline,
  /**
   * Headless balance report: kill percents, DI value and hitbox reach.
   * Consumes the running match — call CR.start() afterwards to play again.
   */
  balance(section = 'all') {
    if (scene !== 'match') this.start();
    const wasPaused = loop.paused;
    loop.paused = true;
    const text = balanceReport(match, section);
    loop.paused = wasPaused;
    console.log(text);
    return text;
  },
};
