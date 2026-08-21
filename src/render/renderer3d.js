import * as THREE from 'three';
import { DEBUG, SHIELD } from '../config/gameplay.js';
import { S } from '../game/states.js';
import { FighterRig } from './rig.js';

/**
 * 2.5D renderer.
 *
 * The simulation is, and stays, two-dimensional: positions, collision capsules
 * and knockback all live in the z = 0 plane. This module is purely
 * presentational — it mirrors that plane into a 3D scene viewed from a low
 * perspective camera, the way Smash Bros. does.
 *
 * Coordinate mapping:  world.x = sim.x,  world.y = -sim.y,  world.z = 0
 * (the simulation is y-down; 3D is y-up).
 *
 * Nothing here may write to simulation state.
 */

/** Vertical field of view. */
const FOV = 42;
/** How far above the horizontal the camera sits. Low, so the stage reads edge-on. */
const CAMERA_PITCH = 0.17;      // ~10 degrees
/** Extra dolly-back, since a perspective frustum frames slightly tighter than the flat view. */
const FRAMING_MUL = 1.06;

/** Gameplay happens at z = 0; the stage extends backwards from just in front of it. */
const STAGE_FRONT_Z = 25;
const STAGE_DEPTH = 300;
const PLATFORM_DEPTH = 190;

/**
 * Simulation y of the backdrop landmass surface — positive is down, so this is
 * just below the stage's standable surface at y = 0. Props anchored with
 * `on: 'terrain'` stand here.
 *
 * It has to be near stage level rather than far below it. Dropped to a shelf a
 * few hundred units down, the landmass sits *inside* the corridor under the
 * stage, and a fighter crossing underneath reads as being below ground. Keeping
 * it at roughly stage height and far back instead makes it a cliff behind the
 * arena: the fighter passes in front of it, which is how it should look.
 */
const TERRAIN_Y = 40;
function terrainTop(theme) {
  return theme.terrain && theme.terrain.y !== undefined ? theme.terrain.y : TERRAIN_Y;
}

/** Simple reusable-mesh pool so per-frame visuals never allocate. */
class Pool {
  constructor(scene, factory) {
    this.scene = scene;
    this.factory = factory;
    this.items = [];
    this.cursor = 0;
  }
  begin() { this.cursor = 0; }
  acquire() {
    if (this.cursor === this.items.length) {
      const obj = this.factory();
      this.scene.add(obj);
      this.items.push(obj);
    }
    const obj = this.items[this.cursor++];
    obj.visible = true;
    return obj;
  }
  end() {
    for (let i = this.cursor; i < this.items.length; i++) this.items[i].visible = false;
  }
}

export class Renderer3D {
  constructor(canvas, camera) {
    this.camera2d = camera;
    // Collision overlays start hidden here: in the 3D view they completely
    // bury the models. F1 turns them on, and the flat view still defaults to
    // showing them.
    this.debug = { ...DEBUG, SHOW_BOXES: false };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x0c1020, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0c1020, 900, 3000);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
    this.scene.add(this.camera);

    this.buildLights();

    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);
    this.stageBuiltFor = null;

    this.rigs = new Map();
    this.shieldMeshes = new Map();
    this.auraMeshes = new Map();
    this.wingMeshes = new Map();

    // Scratch objects, so the per-frame sync never allocates.
    this._scratchColor = new THREE.Color();
    this._scratchVec = new THREE.Vector3();

    this.buildPools();
  }

  buildLights() {
    // Held as fields so a stage's theme can retint them (see applyAtmosphere).
    this.hemiLight = new THREE.HemisphereLight(0x9fc6ff, 0x2a2438, 1.15);
    this.scene.add(this.hemiLight);

    const key = new THREE.DirectionalLight(0xfff2d8, 1.5);
    key.position.set(420, 950, 780);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera;
    c.left = -900; c.right = 900; c.top = 700; c.bottom = -500;
    c.near = 100; c.far = 2600;
    key.shadow.bias = -0.002;
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x7aa8ff, 0.55);
    rim.position.set(-500, 300, -600);
    this.scene.add(rim);
    this.rimLight = rim;
  }

  buildPools() {
    const sphere = new THREE.SphereGeometry(1, 12, 10);
    const icosa = new THREE.IcosahedronGeometry(1, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const ring = new THREE.TorusGeometry(1, 0.12, 8, 20);
    // Open-ended so the funnel does not show a lid when seen from above.
    const cone = new THREE.ConeGeometry(1, 1, 12, 1, true);

    this.geo = { sphere, icosa, boxGeo, cyl, ring, cone };

    this.projectilePool = new Pool(this.scene, () => {
      const g = new THREE.Group();
      const core = new THREE.Mesh(icosa, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false,
      }));
      g.add(core); g.add(glow);
      g.userData = { core, glow };
      return g;
    });

    this.effectPool = new Pool(this.scene, () => new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
    ));

    this.ringPool = new Pool(this.scene, () => new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
    ));

    // Debug capsules are drawn as two spheres plus a barrel, which represents
    // the real 2D collision volume exactly rather than approximating it.
    this.debugPool = new Pool(this.scene, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3c5a, wireframe: true, transparent: true, opacity: 0.85 });
      const g = new THREE.Group();
      const a = new THREE.Mesh(sphere, mat);
      const b = new THREE.Mesh(sphere, mat);
      const barrel = new THREE.Mesh(cyl, mat);
      g.add(a); g.add(b); g.add(barrel);
      g.userData = { a, b, barrel, mat };
      return g;
    });
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ stage

  buildStage(stage) {
    if (this.stageBuiltFor === stage) return;
    this.stageBuiltFor = stage;

    // Every new match constructs a new Stage, so this runs per match. Release
    // the previous stage's GPU resources rather than just detaching them.
    this.stageGroup.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isLineSegments) return;
      if (o.geometry) o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else if (o.material) o.material.dispose();
    });
    this.stageGroup.clear();

    const theme = stage.def.theme;
    const matGround = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.ground) });
    const matGroundTop = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.groundTop) });
    const matPlat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.platform) });
    const matPlatTop = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.platformTop) });
    const matAccent = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.accent) });

    for (const p of stage.platforms) {
      const solid = p.type === 'solid';
      const depth = solid ? STAGE_DEPTH : PLATFORM_DEPTH;
      const zCenter = STAGE_FRONT_Z - depth / 2;

      /**
       * **The cap owns the standable surface, and nothing else may touch it.**
       *
       * Every layer here used to put its top face at exactly `-p.y`: the keel's
       * first tier, the plain body, the cap and the ledge markers were four
       * coincident rectangles in one plane, all the same width and depth. That
       * is textbook z-fighting, and because it covered the whole deck of every
       * platform it read as the entire stage flickering.
       *
       * The cap stays at `-p.y` because that is where the simulation says the
       * floor is; everything underneath is pushed strictly below its underside.
       */
      const capH = solid ? 10 : 5;

      if (solid) {
        // The main platform is drawn as a tapering island keel rather than one
        // box. Three strata, each narrower than the one above, give the stage a
        // silhouette instead of a rectangle.
        //
        // Every tier stays **inside** the collision box: the top tier is exactly
        // p.w wide so the ledges sit on the visible corner, and the ones below
        // only ever shrink. Drawing anything wider or deeper than p.h would put
        // rock where the simulation says there is open air, and the whole point
        // of the keel is that a fighter can fly under it.
        const TIERS = [
          { h: 0.30, inset: 0.000, zin: 0.00 },
          { h: 0.33, inset: 0.035, zin: 0.10 },
          { h: 0.37, inset: 0.105, zin: 0.26 },
        ];
        // Starts under the cap, and the tiers divide what is left of the keel
        // so the silhouette still ends exactly at the bottom of the box.
        let top = -p.y - capH;
        const usable = Math.max(1, p.h - capH);
        TIERS.forEach((t, i) => {
          const th = usable * t.h;
          const tw = p.w * (1 - t.inset * 2);
          const td = depth * (1 - t.zin);
          const mat = i === 0 ? matGround : new THREE.MeshLambertMaterial({
            color: new THREE.Color(theme.ground).multiplyScalar(1 - i * 0.16),
          });
          const tier = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), mat);
          tier.position.set(p.x + p.w / 2, top - th / 2, zCenter);
          tier.receiveShadow = true;
          this.stageGroup.add(tier);
          top -= th;
        });
      } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, 18, depth), matPlat);
        body.position.set(p.x + p.w / 2, -p.y - capH - 9, zCenter);
        body.receiveShadow = true;
        body.castShadow = true;
        this.stageGroup.add(body);
      }

      // A brighter cap makes the standable surface unmistakable.
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(p.w, capH, depth),
        solid ? matGroundTop : matPlatTop,
      );
      cap.position.set(p.x + p.w / 2, -p.y - capH / 2, zCenter);
      cap.receiveShadow = true;
      this.stageGroup.add(cap);
    }

    // Optional distance markers across the floor — a practice-yard cue that
    // also gives a read on how far a launch travelled.
    if (theme.markers) {
      const markMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(theme.accent).multiplyScalar(0.85),
      });
      const main = stage.platforms.find((p) => p.type === 'solid');
      if (main) {
        for (let x = main.x + theme.markers; x < main.x + main.w; x += theme.markers) {
          const major = Math.round(x) === 0;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(major ? 8 : 4, 3, STAGE_DEPTH * 0.82),
            markMat,
          );
          // Bottom clear of the cap: at +1 the lower half unit was buried in it.
          m.position.set(x, -main.y + 1.7, STAGE_FRONT_Z - STAGE_DEPTH / 2);
          this.stageGroup.add(m);
        }
      }
    }

    // Ledge markers.
    for (const l of stage.ledges) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(26, 14, STAGE_DEPTH * 0.9), matAccent);
      /**
       * Tucked under the deck, and clear of the keel's first tier too.
       *
       * Its top face used to sit in the deck's plane; moving it to the cap's
       * underside just swapped one coplanar pair for another, because that is
       * exactly where the top tier begins. Only the outer half of this marker is
       * ever visible — the inner half is inside the island — so it can be
       * dropped well below both without losing anything.
       */
      m.position.set(l.x, -l.y - 24, STAGE_FRONT_Z - STAGE_DEPTH / 2);
      this.stageGroup.add(m);
    }

    // Terrain first: the props stand on it, so it must exist before they land.
    this.buildTerrain(stage, theme);
    this.buildProps(stage, theme);
    this.buildBackdrop(stage, theme);
    this.buildBlastZoneFrame(stage);
  }

  /**
   * Set dressing, declared as data on the stage.
   *
   * Each entry is `{ type, x, y, ... }` in simulation coordinates, and the
   * builders below are deliberately crude — boxes, cylinders and cones in the
   * same low-poly language as the fighters. The point is that a stage is
   * recognisable at a glance, not that it is modelled: the Bone Pit needs tusks
   * and banners, Spell Valley needs crystals and a glowing pot, and those read
   * from silhouette and colour alone.
   *
   * Props are decoration only. Nothing here is collidable — the simulation
   * never sees them — so a stage's feel is entirely its platform layout.
   */
  buildProps(stage, theme) {
    if (!theme.props) return;
    const M = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c), ...opts });
    const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
    const cyl = (rt, rb, h, c, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(c));

    for (const p of theme.props) {
      const g = new THREE.Group();
      const z = p.z !== undefined ? p.z : -120;
      const s = p.scale || 1;

      switch (p.type) {
        // Goblin Stadium: spiked wooden palisade.
        case 'palisade': {
          const n = p.count || 5;
          for (let i = 0; i < n; i++) {
            const hgt = (70 + (i % 3) * 22) * s;
            const post = box(16 * s, hgt, 16 * s, p.color || '#7a5a33');
            post.position.set((i - (n - 1) / 2) * 22 * s, hgt / 2, 0);
            g.add(post);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(9 * s, 18 * s, 4), M(p.tip || '#5d431f'));
            tip.position.set(post.position.x, hgt + 9 * s, 0);
            g.add(tip);
          }
          break;
        }
        // Bone Pit: a curved tusk arching out of the ground.
        case 'tusk': {
          const seg = 5;
          for (let i = 0; i < seg; i++) {
            const t = i / (seg - 1);
            const b = box((26 - t * 12) * s, 34 * s, (26 - t * 12) * s, p.color || '#e8e2d0');
            b.position.set(Math.sin(t * 1.5) * 60 * s * (p.flip ? -1 : 1), t * 34 * s + 16 * s, 0);
            b.rotation.z = -t * 0.75 * (p.flip ? -1 : 1);
            g.add(b);
          }
          break;
        }
        case 'skull': {
          const sk = box(46 * s, 40 * s, 40 * s, p.color || '#efe9d8');
          sk.position.y = 22 * s;
          g.add(sk);
          for (const side of [-1, 1]) {
            const eye = box(11 * s, 12 * s, 6 * s, '#2b2a26');
            eye.position.set(side * 11 * s, 27 * s, 20 * s);
            g.add(eye);
          }
          const jaw = box(34 * s, 12 * s, 32 * s, p.color || '#efe9d8');
          jaw.position.y = 3 * s;
          g.add(jaw);
          break;
        }
        // Hanging banner — Bone Pit and Barbarian Bowl both fly them.
        // A banner is anchored at its **base**, like every other prop, and
        // carries its own mast up to the crossbar. It used to be anchored at the
        // crossbar with nothing holding it up, which is exactly how you get a
        // flag hanging unsupported in the sky.
        case 'banner': {
          const h = (p.h || 150) * s;
          const mast = (p.mast || 300) * s;
          const post = box(11 * s, mast, 11 * s, p.pole || '#6b4a2a');
          post.position.y = mast / 2;
          g.add(post);
          const pole = box(78 * s, 9 * s, 9 * s, p.pole || '#6b4a2a');
          pole.position.y = mast;
          g.add(pole);
          const cloth = box(64 * s, h, 6 * s, p.color || '#c0392b');
          cloth.position.y = mast - h / 2;
          g.add(cloth);
          // Crossed swords, the Barbarian Bowl motif.
          if (p.emblem) {
            for (const d of [-1, 1]) {
              const sw = box(7 * s, 62 * s, 4 * s, p.emblem);
              sw.position.set(0, mast - h / 2, 5 * s);
              sw.rotation.z = d * 0.5;
              g.add(sw);
            }
          }
          break;
        }
        // Barbarian Bowl: the great barrel.
        case 'barrel': {
          const body = cyl(58 * s, 66 * s, 150 * s, p.color || '#6d4a28', 12);
          body.position.y = 75 * s;
          g.add(body);
          for (const yy of [30, 75, 120]) {
            const hoop = cyl(68 * s, 68 * s, 10 * s, p.band || '#3f3a34', 12);
            hoop.position.y = yy * s;
            g.add(hoop);
          }
          break;
        }
        // Spell Valley: clustered crystals.
        case 'crystal': {
          const n = p.count || 3;
          for (let i = 0; i < n; i++) {
            const hgt = (90 + (i % 3) * 55) * s;
            const c = new THREE.Mesh(new THREE.ConeGeometry(20 * s, hgt, 5), M(p.color || '#a855c9'));
            c.position.set((i - (n - 1) / 2) * 34 * s, hgt / 2, (i % 2) * 18 * s);
            c.rotation.z = (i - (n - 1) / 2) * 0.16;
            g.add(c);
          }
          break;
        }
        // Spell Valley: the glowing pot on its plinth.
        case 'cauldron': {
          const plinth = cyl(46 * s, 56 * s, 90 * s, p.stone || '#6d6a72', 10);
          plinth.position.y = 45 * s;
          g.add(plinth);
          const pot = cyl(52 * s, 40 * s, 46 * s, p.color || '#c9a227', 12);
          pot.position.y = 112 * s;
          g.add(pot);
          const brew = cyl(46 * s, 46 * s, 8 * s, p.glow || '#49e0e8', 12);
          brew.position.y = 134 * s;
          brew.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.glow || '#49e0e8') });
          g.add(brew);
          break;
        }
        // Builder's Workshop: scaffold tower with a jib.
        case 'crane': {
          const hgt = (p.h || 260) * s;
          for (const d of [-1, 1]) {
            const leg = box(12 * s, hgt, 12 * s, p.color || '#8a6a3c');
            leg.position.set(d * 30 * s, hgt / 2, 0);
            g.add(leg);
          }
          for (let i = 1; i <= 3; i++) {
            const rung = box(72 * s, 8 * s, 8 * s, p.color || '#8a6a3c');
            rung.position.y = (hgt / 4) * i;
            g.add(rung);
          }
          const jib = box(180 * s, 10 * s, 10 * s, p.color || '#8a6a3c');
          jib.position.set(70 * s, hgt, 0);
          g.add(jib);
          const rope = box(3 * s, 70 * s, 3 * s, '#3a3a3a');
          rope.position.set(150 * s, hgt - 35 * s, 0);
          g.add(rope);
          const hook = box(26 * s, 22 * s, 26 * s, p.load || '#7d838c');
          hook.position.set(150 * s, hgt - 82 * s, 0);
          g.add(hook);
          break;
        }
        // Builder's Workshop: a big circular saw blade leaning on the scenery.
        case 'sawblade': {
          const disc = cyl(60 * s, 60 * s, 7 * s, p.color || '#9aa2ad', 14);
          disc.rotation.x = Math.PI / 2;
          disc.position.y = 60 * s;
          g.add(disc);
          const hub = cyl(16 * s, 16 * s, 11 * s, p.hub || '#5c6470', 10);
          hub.rotation.x = Math.PI / 2;
          hub.position.y = 60 * s;
          g.add(hub);
          break;
        }
        // Training Camp: archery butt, red and white rings.
        case 'target': {
          const rings = [[62, '#e8e4d8'], [44, '#c0392b'], [26, '#e8e4d8'], [12, '#c0392b']];
          rings.forEach(([r, c], i) => {
            const d = cyl(r * s, r * s, (9 - i) * s, c, 14);
            d.rotation.x = Math.PI / 2;
            d.position.set(0, 70 * s, i * 3 * s);
            g.add(d);
          });
          const stand = box(12 * s, 70 * s, 12 * s, '#6b4a2a');
          stand.position.y = 35 * s;
          g.add(stand);
          break;
        }
        case 'fence': {
          const n = p.count || 4;
          const span = 46 * s;
          for (let i = 0; i < n; i++) {
            const post = box(10 * s, 54 * s, 10 * s, p.color || '#7a5a33');
            post.position.set((i - (n - 1) / 2) * span, 27 * s, 0);
            g.add(post);
          }
          for (const yy of [22, 42]) {
            const rail = box(span * (n - 1) + 10 * s, 8 * s, 7 * s, p.color || '#7a5a33');
            rail.position.y = yy * s;
            g.add(rail);
          }
          break;
        }
        case 'tree': {
          const trunk = cyl(13 * s, 17 * s, 90 * s, p.trunk || '#5f4325', 7);
          trunk.position.y = 45 * s;
          g.add(trunk);
          for (let i = 0; i < 3; i++) {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry((62 - i * 12) * s, 0),
              M(p.color || '#4f8f3a'),
            );
            leaf.position.set((i - 1) * 24 * s, (110 + i * 34) * s, (i - 1) * 14 * s);
            g.add(leaf);
          }
          break;
        }
        // A flat band of water read from the front — moats and streams.
        case 'water': {
          const w = (p.w || 300) * s;
          const surf = new THREE.Mesh(
            new THREE.BoxGeometry(w, 8 * s, (p.d || 200) * s),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color || '#3fbcc4') }),
          );
          /**
           * **Sits proud of the bank, not flush with it.**
           *
           * Authored at `y: 4` these bands put their top face exactly on the
           * terrain surface — a 3000 x 200 coplanar sheet on three stages, and
           * the last of the background flicker. Four units up is invisible at
           * this camera distance and gives the depth buffer something to
           * separate.
           */
          surf.position.y = 4 * s;
          g.add(surf);
          break;
        }
        default: break;
      }

      // Props stand on a surface, never in mid-air. `on: 'terrain'` anchors to
      // the backdrop landmass; the default anchors to the top of the stage. The
      // stage is only 300 deep, so anything placed further back than that has
      // no arena under it and has to belong to the terrain instead.
      const base = p.on === 'terrain' ? terrainTop(theme) : 0;
      g.position.set(p.x, -(base + (p.y || 0)), z);
      if (p.rotY) g.rotation.y = p.rotY;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = !!p.shadow; o.receiveShadow = true; } });
      this.stageGroup.add(g);
    }
  }

  /**
   * The stage's own air: clear colour, fog and light.
   *
   * These were fixed at a dark navy, which meant every arena rendered at night
   * whatever its palette said — Spell Valley's violet and the Training Camp's
   * midday green came out the same murky blue. They belong to the theme, so a
   * stage sets its own time of day.
   *
   * Fog is tinted to the horizon rather than the zenith. Distance should fade
   * *into* the skyline, and the two differ most in exactly the stages where it
   * matters (a bright sky over a dark floor).
   */
  applyAtmosphere(theme) {
    const horizon = new THREE.Color(theme.skyLow);
    this.renderer.setClearColor(horizon, 1);
    // Fog sits between the two sky bands, not on the horizon itself. Keyed to a
    // pale horizon it bleached the palisades and towers to near-white; pulling
    // it toward the zenith keeps the backdrop reading as solid objects.
    this.scene.fog.color.copy(horizon).lerp(new THREE.Color(theme.sky), 0.45);
    // Fog has to clear the camera's own pull-back, not just the stage depth.
    // The camera sits ~1200 out at spawn and past 2200 when the fighters split
    // to the ledges, so a near plane of 1500 fogged the *fighters* by a quarter
    // and bleached the props to grey the moment the view widened. Starting past
    // the widest camera distance leaves fog doing only its real job: the far
    // floor plane below the stage.
    this.scene.fog.near = theme.fogNear !== undefined ? theme.fogNear : 2800;
    this.scene.fog.far = theme.fogFar !== undefined ? theme.fogFar : 6800;

    const light = theme.light || {};
    this.hemiLight.color.set(light.sky || 0x9fc6ff);
    this.hemiLight.groundColor.set(light.bounce || 0x2a2438);
    this.hemiLight.intensity = light.ambient !== undefined ? light.ambient : 1.15;
    this.keyLight.color.set(light.key || 0xfff2d8);
    this.keyLight.intensity = light.keyIntensity !== undefined ? light.keyIntensity : 1.5;
    this.rimLight.color.set(light.rim || 0x7aa8ff);
    this.rimLight.intensity = light.rimIntensity !== undefined ? light.rimIntensity : 0.55;
  }

  /**
   * A vertical sky gradient as a canvas texture.
   *
   * A flat wall of one colour reads as a wall. Ramping zenith to horizon over
   * the backdrop is what makes the space behind the stage feel open, and it is
   * two colours the theme already carries.
   */
  skyTexture(theme) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.sky);
    grad.addColorStop(0.62, theme.skyLow);
    grad.addColorStop(1, theme.skyLow);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * The backdrop landmass the scenery stands on.
   *
   * The arena is a floating plate 300 deep. Everything behind it — towers,
   * cranes, trees, the big Bone Pit tusks — used to be positioned at "ground
   * level" with no ground beneath it, so it hung in the sky. This is that
   * ground: a wide shelf set back past the stage and below it, which reads as
   * the valley floor the arena floats over.
   *
   * The gap between it and the stage is what sells the arena as a floating
   * plate: the keel tapers into open air, and the land starts again a long way
   * behind. Close the gap and the stage just looks like the near edge of a
   * field.
   */
  buildTerrain(stage, theme) {
    const top = terrainTop(theme);
    const t = theme.terrain || {};
    const w = t.width || 5600;
    const front = t.z !== undefined ? t.z : -700;
    const depth = t.depth || 2200;

    // Deliberately shallow, and held well down in value.
    //
    // The landmass is seen front-on, so its **front face** is what the camera
    // actually shows, and depth on that face becomes a wall of flat colour
    // behind the arena. At 340 the island was silhouetted against that wall
    // rather than against sky, which is exactly what stops a floating stage from
    // looking like it floats. A thin plateau lip leaves open sky under and
    // behind the arena instead.
    //
    // The darkening does the other half: in the stage's own colours the two
    // greens matched and the plate stopped reading as a separate object.
    // Distance should look like distance.
    const h = t.height || 110;
    /**
     * **The cap owns the plateau surface**, same rule as the platforms.
     *
     * These two were the single worst z-fight in the scene: both the body and
     * the cap put their top face at exactly `-top`, both 5600 wide and 2200
     * deep, which is 12 million square units of coincident surface — forty
     * times the area of the platform deck. It filled the whole background.
     */
    const capH = 26;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, depth),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(t.color || theme.ground).multiplyScalar(0.5),
      }),
    );
    body.position.set(t.x || 0, -top - capH - h / 2, front - depth / 2);
    body.receiveShadow = true;
    this.stageGroup.add(body);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w, capH, depth),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(t.topColor || theme.groundTop).multiplyScalar(0.62),
      }),
    );
    cap.position.set(t.x || 0, -top - capH / 2, front - depth / 2);
    cap.receiveShadow = true;
    this.stageGroup.add(cap);
  }

  /**
   * The sky.
   *
   * There were a pair of generic cone-roofed keeps flanking every stage here.
   * They were borrowed scenery — the same two towers whatever arena you picked,
   * in a shape that belonged to none of them — so they are gone. Each stage's
   * own props do the framing now, which is the whole point of having them.
   */
  buildBackdrop(stage, theme) {
    this.applyAtmosphere(theme);

    // Tall enough that the gradient still fills frame when the camera pulls
    // out to its widest, and far enough back to sit behind the fog.
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 3200),
      new THREE.MeshBasicMaterial({ map: this.skyTexture(theme), fog: false }),
    );
    wall.position.set(0, 200, -1800);
    this.stageGroup.add(wall);
  }

  /** Faint frame showing where the blast zones are — prototype affordance. */
  buildBlastZoneFrame(stage) {
    const b = stage.blastZones;
    const pts = [
      new THREE.Vector3(b.left, -b.top, 0), new THREE.Vector3(b.right, -b.top, 0),
      new THREE.Vector3(b.right, -b.top, 0), new THREE.Vector3(b.right, -b.bottom, 0),
      new THREE.Vector3(b.right, -b.bottom, 0), new THREE.Vector3(b.left, -b.bottom, 0),
      new THREE.Vector3(b.left, -b.bottom, 0), new THREE.Vector3(b.left, -b.top, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xff5a78, transparent: true, opacity: 0.22,
    }));
    this.stageGroup.add(line);
  }

  // ----------------------------------------------------------------- camera

  syncCamera() {
    const c = this.camera2d;
    const cx = c.x + c.shakeX;
    const cy = -(c.y + c.shakeY);

    // The ceremony flies the camera itself and changes the lens; put both back.
    if (this.camera.fov !== FOV) {
      this.camera.fov = FOV;
      this.camera.updateProjectionMatrix();
    }

    // Reuse the 2D camera's framing: convert its orthographic zoom into the
    // dolly distance that shows the same world height through this frustum.
    const visibleHeight = (c.viewHeight / c.zoom) * FRAMING_MUL;
    const dist = visibleHeight / (2 * Math.tan((FOV * Math.PI) / 360));

    this.camera.position.set(
      cx,
      cy + Math.sin(CAMERA_PITCH) * dist,
      Math.cos(CAMERA_PITCH) * dist,
    );
    this.camera.lookAt(cx, cy, 0);

    this.keyLight.position.set(cx + 420, cy + 950, 780);
    this.keyLight.target.position.set(cx, cy - 100, 0);
    this.keyLight.target.updateMatrixWorld();
  }

  /**
   * Places the camera for a victory shot. The sequence describes shots in
   * simulation space — a point to look at, plus an orbit around it — and this
   * is the only place that turns that into a 3D transform.
   *
   * @param {{x:number,y:number,dist:number,yaw:number,pitch:number,fov:number}} shot
   */
  applyCeremonyCamera(shot) {
    const cx = shot.x;
    const cy = -shot.y;
    const flat = Math.cos(shot.pitch) * shot.dist;

    if (this.camera.fov !== shot.fov) {
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      cx + Math.sin(shot.yaw) * flat,
      cy + Math.sin(shot.pitch) * shot.dist,
      Math.cos(shot.yaw) * flat,
    );
    this.camera.lookAt(cx, cy, 0);

    // Keep the key light on the subject, or the fighters go flat as the camera
    // swings around behind them.
    this.keyLight.position.set(cx + 380, cy + 700, 620);
    this.keyLight.target.position.set(cx, cy, 0);
    this.keyLight.target.updateMatrixWorld();
  }

  // --------------------------------------------------------------- fighters

  /**
   * Drops rigs and per-fighter meshes belonging to fighters that no longer
   * exist. Each match builds fresh Fighter objects with new ids, so without
   * this every restart would leave the previous match's models in the scene.
   */
  pruneStale(match) {
    const live = new Set(match.fighters.map((f) => f.id));

    for (const [id, rig] of this.rigs) {
      if (live.has(id)) continue;
      rig.dispose(this.scene);
      this.rigs.delete(id);
    }
    // Shield and aura meshes share pooled geometry, so only their materials
    // are theirs to dispose.
    for (const [id, mesh] of this.shieldMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(mesh);
      mesh.material.dispose();
      this.shieldMeshes.delete(id);
    }
    // The aura is a stack of shells rather than one mesh.
    for (const [id, bubble] of this.auraMeshes) {
      if (live.has(id)) continue;
      for (const s of bubble.shells) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
      }
      this.auraMeshes.delete(id);
    }
    for (const [id, entry] of this.wingMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(entry.group);
      entry.group.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      this.wingMeshes.delete(id);
    }
  }

  syncFighters(match) {
    this.pruneStale(match);
    for (const f of match.fighters) {
      let rig = this.rigs.get(f.id);
      if (!rig) {
        rig = new FighterRig(f);
        this.scene.add(rig.root);
        this.rigs.set(f.id, rig);
      }
      rig.update(match.frame);
      this.syncShield(f);
      this.syncAura(f, match.frame);
      this.syncWings(f, match.frame);
    }
  }

  syncShield(f) {
    let mesh = this.shieldMeshes.get(f.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.geo.sphere, new THREE.MeshBasicMaterial({
        color: 0x7ec8ff, transparent: true, opacity: 0.3, depthWrite: false,
      }));
      this.scene.add(mesh);
      this.shieldMeshes.set(f.id, mesh);
    }
    if (!f.isShielding()) { mesh.visible = false; return; }
    const health = f.shield.health / SHIELD.MAX_HEALTH;
    mesh.visible = true;
    mesh.position.set(f.x, -(f.y - f.def.height * 0.5), 0);
    mesh.scale.setScalar(f.shield.radius);
    mesh.material.opacity = 0.20 + health * 0.22;
  }

  /**
   * The Wizard's Fire Shield — a gameplay state that must be visible.
   *
   * A sphere that darkens toward its edge, so it reads as a **volume** of
   * violet fire with the Wizard clearly visible inside it.
   *
   * The darkening is a stack of concentric shells rather than a shader. Each is
   * nearly transparent on its own; near the middle of the bubble a sightline
   * crosses only the outermost shells, while near the silhouette it passes
   * through every one of them almost tangentially, so the alpha accumulates and
   * the rim comes out deep purple. That is the same effect a fresnel term gives,
   * built out of geometry the renderer already pools.
   *
   * `BackSide` on every shell is what keeps the fighter readable: only the far
   * hemisphere is drawn, so nothing is painted between the camera and him.
   */
  syncAura(f, frame) {
    let bubble = this.auraMeshes.get(f.id);
    if (!bubble) {
      // Outermost first. Colours run light violet at the core to deep magenta
      // at the skin, so the accumulated edge is a colour shift as well as an
      // alpha one — a bubble, not a smudge.
      const shells = [
        { at: 1.00, color: 0x6a1f96, alpha: 0.34 },
        { at: 0.96, color: 0x7b2ea8, alpha: 0.28 },
        { at: 0.90, color: 0x9b45c4, alpha: 0.20 },
        { at: 0.80, color: 0xb765e0, alpha: 0.13 },
        { at: 0.68, color: 0xd08cf0, alpha: 0.08 },
      ].map((s) => {
        const mesh = new THREE.Mesh(this.geo.sphere, new THREE.MeshBasicMaterial({
          color: s.color, transparent: true, opacity: s.alpha,
          depthWrite: false, side: THREE.BackSide,
        }));
        this.scene.add(mesh);
        return { mesh, ...s };
      });
      bubble = { shells };
      this.auraMeshes.set(f.id, bubble);
    }

    const active = f.custom.fireShield && f.custom.fireShield.active;
    if (!active) {
      for (const s of bubble.shells) s.mesh.visible = false;
      return;
    }

    const pulse = 0.6 + 0.4 * Math.sin(frame * 0.18);
    const r = f.def.height * 0.62 + pulse * 4;
    const y = -(f.y - f.def.height * 0.5);

    for (let i = 0; i < bubble.shells.length; i++) {
      const s = bubble.shells[i];
      s.mesh.visible = true;
      s.mesh.position.set(f.x, y, 0);
      s.mesh.scale.setScalar(r * s.at);
      // Counter-rotated per shell so the facets never line up and the surface
      // churns instead of sitting still.
      s.mesh.rotation.set(0, frame * 0.02 * (i % 2 ? -1 : 1), frame * 0.012);
      s.mesh.material.opacity = s.alpha * (0.8 + pulse * 0.35);
    }
  }

  /**
   * The Wizard's Hero Wings — golden plate, worn on the back while Up B runs.
   *
   * Built as meshes attached to the scene rather than as an effect, because
   * unlike a puff of smoke this is **state**: the wings are on his back for as
   * long as he has flaps left, and their presence is how the player reads that
   * the recovery is still live. Each feather is a tapered slab, fanned from the
   * shoulder, and the whole wing swings forward on a flap and eases back.
   */
  syncWings(f, frame) {
    let rig = this.wingMeshes.get(f.id);
    if (!rig) {
      rig = { group: new THREE.Group(), wings: [] };
      const gold = new THREE.MeshLambertMaterial({ color: 0xf2c14e, emissive: 0x5a3a08 });
      const ember = new THREE.MeshBasicMaterial({
        color: 0xff9b3d, transparent: true, opacity: 0.75, depthWrite: false,
      });
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        // Six feathers, longest at the top, swept back and down the fan. Sized
        // to clear the torso: at half this length they were buried inside the
        // silhouette from a side-on camera and read as a smudge on his back.
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const len = 78 - t * 34;
          const feather = new THREE.Mesh(this.geo.boxGeo, gold);
          feather.scale.set(len, 7, 3.5);
          feather.position.set(-len * 0.5, 16 - t * 26, 0);
          feather.rotation.z = -0.22 - t * 0.62;
          wing.add(feather);
          // A flame riding the trailing tip of every second feather.
          if (i % 2 === 0) {
            const fire = new THREE.Mesh(this.geo.icosa, ember);
            fire.scale.setScalar(9 - t * 3);
            fire.position.set(-len * 0.95, 16 - t * 26, 0);
            wing.add(fire);
          }
        }
        // Splayed well out in depth so both wings clear the body.
        wing.position.z = side * 17;
        rig.group.add(wing);
        rig.wings.push({ obj: wing, side });
      }
      this.scene.add(rig.group);
      this.wingMeshes.set(f.id, rig);
    }

    const wg = f.custom.wings;
    if (!wg || !wg.active) { rig.group.visible = false; return; }

    rig.group.visible = true;
    // Mounted on the shoulder blades and mirrored with facing — the feathers are
    // modelled trailing along -x, so facing left has to turn the whole rig or
    // the wings sprout out of his chest.
    rig.group.position.set(f.x - f.facing * 6, -(f.y - f.def.height * 0.66), 0);
    rig.group.rotation.y = f.facing > 0 ? 0 : Math.PI;

    // A flap is a fast throw forward and a slow ease back, which is the shape
    // of the real motion — the power stroke is the quick half.
    const beat = wg.flapAnim / 12;
    const swing = beat > 0 ? Math.sin(beat * Math.PI) : 0;
    const idle = Math.sin(frame * 0.09) * 0.06;
    for (const { obj, side } of rig.wings) {
      // Splayed apart at rest, driven together and forward on the beat.
      obj.rotation.y = side * (0.55 - swing * 0.75);
      obj.rotation.z = idle + swing * 0.35;
      obj.scale.setScalar(0.9 + swing * 0.18);
    }
    // They fade as the flaps run out, so the player can see the fuel gauge.
    const left = wg.flaps / 3;
    for (const { obj } of rig.wings) {
      obj.traverse((o) => {
        if (o.isMesh && o.material.transparent) o.material.opacity = 0.35 + left * 0.45;
      });
    }
  }

  // ------------------------------------------------------- projectiles / fx

  /**
   * The spring trap, as a whole prop rather than a stand-in box.
   *
   * It is the same object the Barbarian launched off, so it has to be the same
   * thing on the way down — plank, coil and frame, tumbling together. Built
   * lazily and pooled, because most matches never spawn one.
   */
  springProp() {
    if (!this.springPool) {
      this.springPool = new Pool(this.scene, () => {
        const g = new THREE.Group();
        const wood = new THREE.MeshLambertMaterial({ color: 0xc58a4a });
        const frame = new THREE.MeshLambertMaterial({ color: 0x7a4a24 });
        const brass = new THREE.MeshLambertMaterial({ color: 0xd8a521 });
        const S = 1;                       // unit-sized; scaled per projectile

        const base = new THREE.Mesh(new THREE.BoxGeometry(S * 2.05, 0.16, S * 2.05), frame);
        base.position.y = -S * 0.9;
        g.add(base);
        for (let i = 0; i < 5; i++) {
          const k = i / 4;
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(S * (0.66 - k * 0.14), 0.09, 5, 10), brass,
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.y = -S * 0.78 + k * S * 1.34;
          g.add(ring);
        }
        const board = new THREE.Mesh(new THREE.BoxGeometry(S * 1.9, 0.18, S * 1.9), wood);
        board.position.y = S * 0.72;
        g.add(board);
        return g;
      });
    }
    return this.springPool;
  }

  /**
   * The thrown spear, as a prop rather than a streak.
   *
   * It is the same object that was in his fist a moment ago, so it has to look
   * like it in flight: shaft, binding and leaf head. Built pointing along **+x**
   * and rotated by the projectile's own heading, so the point leads all the way
   * round the arc instead of the shaft sliding sideways through the air.
   */
  spearProp() {
    if (!this.spearPool) {
      this.spearPool = new Pool(this.scene, () => {
        const g = new THREE.Group();
        const shaft = new THREE.MeshLambertMaterial({ color: 0xb08040 });
        const wrap = new THREE.MeshLambertMaterial({ color: 0x6b4426 });
        const head = new THREE.MeshLambertMaterial({ color: 0xc9d0da });
        const S = 1;                       // unit-sized; scaled per projectile

        const pole = new THREE.Mesh(new THREE.BoxGeometry(S * 4.4, S * 0.22, S * 0.22), shaft);
        pole.position.x = -S * 0.4;
        g.add(pole);
        const bind = new THREE.Mesh(new THREE.BoxGeometry(S * 0.5, S * 0.33, S * 0.33), wrap);
        bind.position.x = -S * 1.3;
        g.add(bind);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(S * 0.95, S * 0.62, S * 0.2), head);
        blade.position.x = S * 2.15;
        g.add(blade);
        const point = new THREE.Mesh(new THREE.BoxGeometry(S * 0.5, S * 0.26, S * 0.16), head);
        point.position.x = S * 2.8;
        g.add(point);
        return g;
      });
    }
    return this.spearPool;
  }

  syncProjectiles(match) {
    this.projectilePool.begin();
    if (this.springPool) this.springPool.begin();
    if (this.spearPool) this.spearPool.begin();
    for (const p of match.projectiles) {
      if (p.dead) continue;
      /**
       * The spear points where it is *going*, not where it was thrown. On a
       * gravity arc those diverge steadily, and a spear that stays level while
       * its path bends over reads as a floating stick.
       */
      if (p.shape === 'spear') {
        const s = this.spearProp().acquire();
        s.position.set(p.x, -p.y, 0);
        /**
         * The pitch is **not** negated for a left-hand throw.
         *
         * The yaw of π already turns the prop round, and Euler XYZ composes as
         * `Ry(π) · Rz(θ)`: a point on the tip goes to `(-cosθ, sinθ, 0)`, which
         * is pointing left and pitched up by θ — exactly right. Flipping θ on
         * top of that pitched it the wrong way against a path that was still
         * arcing the other, and the spear read as tumbling backwards through
         * its own flight.
         */
        s.rotation.set(0, p.facing < 0 ? Math.PI : 0, Math.atan2(-p.vy, Math.abs(p.vx)));
        /**
         * Scaled to match the spear he was just holding. At 0.42 the flying one
         * was a quarter the length of the held prop — the same weapon has to be
         * the same size in the air as it is in his fist.
         */
        s.scale.setScalar(p.radius * 1.57);
        continue;
      }
      // The spring is a modelled prop, not a pooled blob — handled separately.
      if (p.shape === 'spring') {
        const s = this.springProp().acquire();
        s.position.set(p.x, -p.y, 0);
        s.rotation.set(0, 0, -p.rotation);
        // Built at unit size, so the scale *is* the radius — the board comes out
        // a little under two radii across, which matches the rig's own spring.
        s.scale.setScalar(p.radius * 1.25);
        continue;
      }
      const obj = this.projectilePool.acquire();
      const { core, glow } = obj.userData;
      obj.position.set(p.x, -p.y, 0);
      obj.rotation.z = -p.rotation;

      const color = new THREE.Color(p.color);
      core.material.color.copy(color);
      glow.material.color.copy(color);

      if (p.shape === 'dagger') {
        core.geometry = this.geo.boxGeo;
        core.scale.set(p.radius * 2, p.radius * 0.5, p.radius * 0.5);
        glow.scale.setScalar(p.radius * 0.9);
      } else if (p.shape === 'tornado') {
        /**
         * A funnel, not a cylinder.
         *
         * A cone tapered to its point at the bottom is the whole silhouette of a
         * tornado, and the previous spinning box read as a spinning box. The
         * cone is drawn point-down (scaled negative on y) and spun several times
         * faster than the projectile's own rotation, so the facets strobe and
         * the funnel reads as churning rather than merely turning.
         *
         * The flames are separate: the projectile's `onStep` lays a helix of
         * embers climbing the outside, which is what makes it read as fire.
         */
        // Flipped with a rotation, not a negative scale. A cone is built apex-up
        // and negating the y scale inverts the winding instead of the shape, so
        // an open-ended cone just shows its inside and still reads point-up.
        //
        // The container's roll is also cancelled. Every other projectile tumbles
        // in the screen plane, which is right for a thrown object and wrong for
        // a vortex — it tipped the whole funnel onto its side. A tornado stands
        // up and spins about its own axis, so all of the motion goes to core y.
        obj.rotation.z = 0;
        core.geometry = this.geo.cone;
        core.scale.set(p.radius * 1.3, p.radius * 2.4, p.radius * 1.3);
        core.rotation.set(Math.PI, p.rotation * 3.4, 0);
        glow.scale.setScalar(p.radius * 1.05);
      } else if (p.shape === 'burst') {
        core.geometry = this.geo.sphere;
        core.scale.setScalar(p.radius * 0.8);
        glow.scale.setScalar(p.radius * 1.4);
      } else if (p.shape === 'shock') {
        /**
         * A ground shockwave: wide, flat and short, hugging the floor. It is a
         * disturbance running along the deck rather than a thrown object, so it
         * does not tumble — the roll is cancelled and it keeps its footing.
         */
        obj.rotation.z = 0;
        core.geometry = this.geo.boxGeo;
        core.scale.set(p.radius * 0.9, p.radius * 1.5, p.radius * 2.2);
        core.rotation.set(0, 0, 0);
        glow.scale.set(p.radius * 1.6, p.radius * 0.8, p.radius * 2.4);
      } else {
        core.geometry = this.geo.icosa;
        core.scale.setScalar(p.radius);
        core.rotation.set(p.rotation, p.rotation * 0.7, 0);
        glow.scale.setScalar(p.radius * 1.5);
      }
    }
    this.projectilePool.end();
    if (this.springPool) this.springPool.end();
    /**
     * Without this the spears never go away.
     *
     * `end()` is what hides the pooled meshes the frame did not claim — the
     * simulation was expiring the projectiles correctly all along, and the props
     * simply stayed on screen where they were last drawn. A missing `end()` is
     * invisible until something spawns often enough to litter.
     */
    if (this.spearPool) this.spearPool.end();
  }

  syncEffects(match) {
    this.effectPool.begin();
    this.ringPool.begin();

    for (const e of match.effects) {
      const t = e.age / e.life;
      const fade = 1 - t;
      const usesRing = e.kind === 'shield' || e.kind === 'clank' || e.kind === 'ko'
        || e.kind === 'airjump';

      if (usesRing) {
        const m = this.ringPool.acquire();
        m.position.set(e.x, -e.y, 0);
        m.material.color.set(
          e.kind === 'shield' ? 0x8fd3ff
            : e.kind === 'ko' ? (e.color || 0xffffff)
              : e.kind === 'airjump' ? 0xdcefff
                : 0xffe066,
        );
        if (e.kind === 'airjump') {
          // Flattened towards the floor: the ring is the puff of air pushed out
          // from under the fighter, not a shockwave through them. It snaps wide
          // immediately and then eases, which is what makes it read at speed.
          const grow = e.size * (0.35 + Math.sqrt(t) * 0.85);
          m.material.opacity = fade * 0.95;
          m.scale.set(grow, grow * 0.45, e.size * 0.8);
          m.rotation.z = 0;
        } else {
          m.material.opacity = fade * 0.9;
          m.scale.setScalar(e.size * (0.5 + t * (e.kind === 'ko' ? 2.2 : 1.2)));
          m.rotation.z = t * 2;
        }
      } else {
        const m = this.effectPool.acquire();
        m.position.set(e.x, -e.y, 0);
        if (e.color) this._scratchColor.set(e.color);
        else if (e.effect === 'fire') this._scratchColor.setHex(0xffb24d);
        else if (e.effect === 'electric') this._scratchColor.setHex(0x9fd8ff);
        else if (e.effect === 'blunt') this._scratchColor.setHex(0xffe0a8);
        else this._scratchColor.setHex(0xfff2b0);
        m.material.color.copy(this._scratchColor);
        if (e.kind === 'streak') {
          // A speed line: stretched along its own heading and thinning as it
          // fades, rather than a puff that happens to be moving.
          m.material.opacity = fade * 0.85;
          m.scale.set(e.size * (1.6 - t * 0.5), e.size * 0.22 * fade, 1);
          m.rotation.z = e.angle || 0;
        } else if (e.kind === 'smoke') {
          // Smoke swells and thins instead of flashing out like an impact.
          m.material.opacity = fade * fade * 0.7;
          m.scale.setScalar(e.size * (0.5 + t * 1.5));
          m.rotation.z = (e.spin || 0) * t;
        } else {
          m.material.opacity = fade;
          const grow = e.kind === 'explosion' ? (0.4 + t) : (0.7 + t * 0.9);
          m.scale.setScalar(e.size * grow);
        }
      }
    }

    this.effectPool.end();
    this.ringPool.end();
  }

  // ------------------------------------------------------------------ debug

  syncDebug(match) {
    this.debugPool.begin();
    if (this.debug.SHOW_BOXES) {
      for (const f of match.fighters) {
        if (f.state === S.DEAD) continue;
        for (const h of f.getHurtboxes()) {
          this.drawCapsule(h, f.isIntangible() ? 0x64dcff : 0xffe93c, 0.35);
        }
        for (const box of f.getActiveHitboxes()) {
          this.drawCapsule(box.capsule, 0xff3c5a, 0.95);
        }
        const gb = f.getActiveGrabbox();
        if (gb) this.drawCapsule(gb, 0x965aff, 0.95);
      }
    }
    this.debugPool.end();
  }

  /**
   * Draws a simulation capsule in world space. The capsule lives in the
   * z = 0 plane, so this is an exact picture of the collision volume rather
   * than a 3D reinterpretation of it.
   */
  drawCapsule(c, color, opacity) {
    const obj = this.debugPool.acquire();
    const { a, b, barrel, mat } = obj.userData;
    mat.color.setHex(color);
    mat.opacity = opacity;

    const ax = c.x, ay = -c.y;
    const bx = c.x2, by = -c.y2;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);

    a.position.set(ax, ay, 0);
    a.scale.setScalar(c.r);
    b.position.set(bx, by, 0);
    b.scale.setScalar(c.r);

    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    barrel.position.set((ax + bx) / 2, (ay + by) / 2, 0);
    barrel.scale.set(c.r, Math.max(len, 0.001), c.r);
    // The cylinder's axis is +y; rotate it onto the capsule's axis.
    barrel.rotation.set(0, 0, len > 0.001 ? Math.atan2(dy, dx) - Math.PI / 2 : 0);
    barrel.visible = len > 0.001;
  }

  // ------------------------------------------------------------------- draw

  draw(match) {
    this.buildStage(match.stage);
    this.syncCamera();
    this.syncFighters(match);
    this.syncProjectiles(match);
    this.syncEffects(match);
    this.syncDebug(match);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The victory ceremony: the same scene, but posed and framed by the sequence
   * instead of by the simulation. Projectiles and debug overlays are dropped —
   * the match is over and they are only clutter.
   *
   * @param {object} match
   * @param {import('../game/victory.js').VictorySequence} seq
   */
  drawVictory(match, seq) {
    this.buildStage(match.stage);
    this.applyCeremonyCamera(seq.camera());

    this.pruneStale(match);
    for (const f of match.fighters) {
      let rig = this.rigs.get(f.id);
      if (!rig) {
        rig = new FighterRig(f);
        this.scene.add(rig.root);
        this.rigs.set(f.id, rig);
      }
      rig.ceremony = seq.poseFor(f);
      rig.update(match.frame);
      rig.root.visible = rig.root.visible && seq.isVisible(f);
      const shield = this.shieldMeshes.get(f.id);
      if (shield) shield.visible = false;
      const aura = this.auraMeshes.get(f.id);
      if (aura) for (const s of aura.shells) s.mesh.visible = false;
      const wings = this.wingMeshes.get(f.id);
      if (wings) wings.group.visible = false;
    }

    this.projectilePool.begin(); this.projectilePool.end();
    this.debugPool.begin(); this.debugPool.end();
    this.syncEffects(match);
    this.renderer.render(this.scene, this.camera);
  }

  /** Drops the ceremony override so the rigs read the simulation again. */
  clearCeremony() {
    for (const rig of this.rigs.values()) rig.ceremony = null;
  }

  /** Projects a world position to screen pixels, for HUD markers. */
  worldToScreen(simX, simY, width, height) {
    const v = this._scratchVec.set(simX, -simY, 0).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, behind: v.z > 1 };
  }
}
