import * as THREE from 'three';
import { S } from '../game/states.js';
import { clamp, lerp } from '../core/math.js';

/**
 * Low-poly placeholder character rig.
 *
 * A hierarchical skeleton of boxes, proportioned from the fighter's own
 * `width`/`height` so every character in the roster gets a body for free.
 * There are no animation assets: poses are computed procedurally from the
 * simulation state (velocity, state, current move and its frame counter), so
 * a new fighter animates correctly the moment its data file exists.
 *
 * The model is built facing +x. Sim space is y-down, world space is y-up, so
 * the renderer places the rig at (sim.x, -sim.y, 0).
 *
 * Limb convention: every limb's geometry is pre-translated so its pivot sits
 * at the joint and the limb hangs along -y. Because the body faces +x, a
 * forward/back swing is therefore a rotation about z, and a sideways spread
 * is a rotation about x.
 */

/** Slight turn toward the camera, so fighters do not read as flat cutouts. */
const CAMERA_YAW_BIAS = 0.26;

/**
 * Stride length per full gait cycle (two steps), as a multiple of the
 * fighter's height. The gait phase advances with distance covered rather than
 * at a fixed rate, so cadence falls out of the movement speed and the feet
 * stay planted instead of scrabbling. Longer stride = slower, heavier cadence.
 */
const WALK_STRIDE = 1.7;
const SPRINT_STRIDE = 2.75;

/**
 * Resting a shouldered weapon (see `carryWeapon`). The elbow curls the forearm
 * *up and in*, the direction an elbow actually bends, and the cock at the wrist
 * is what lays the weapon back over the shoulder — exactly as a real grip does,
 * since a bat on your shoulder sits across your forearm, not in line with it.
 * Folding the elbow backwards instead would put the weapon in the same place
 * but with the arm bending the wrong way.
 */
const CARRY_ELBOW = 1.75;
const CARRY_WRIST = 1.85;

/**
 * The sword is carried differently from the bat: down at the hip rather than
 * over the shoulder, with the blade running roughly level and tipped slightly
 * up. A sword shouldered like a bat reads as a club, and the whole point of the
 * Barbarian's silhouette is that the blade is out in front of him.
 *
 * Measured against the rig rather than guessed — the blade extends along the
 * hand's -y, so laying it flat is a wrist rotation of about a right angle and
 * the tilt is what comes off that.
 */
const SWORD_SHOULDER = -0.34;
const SWORD_ELBOW = 1.05;
const SWORD_WRIST = 1.18;

/**
 * The Goblin's dagger carry: fist up in front of the chest, blade angled up.
 *
 * The blade runs along the forearm's own axis, so the elbow fold is what sets
 * the blade's angle and the wrist only trims it. Solved against a hanging
 * shoulder — see `carryWeapon`.
 */
const DAGGER_ELBOW = 1.72;
const DAGGER_WRIST = 0.34;

/**
 * Roll geometry, as fractions of the fighter's height.
 *
 * A point `t` up a body pivoting at `p` sits at `p + (t - p)·cos(spin)`, so at
 * full inversion the head lands at `2p - t`. Anything under half the height
 * therefore drives the head through the floor at the halfway point of the roll,
 * which is exactly where the old value put it. Half is the minimum that works
 * and it only grazes, so the roll also carries the body up as it goes over —
 * which is what a real roll does anyway.
 */
const ROLL_PIVOT = 0.50;
const ROLL_LIFT = 0.10;

/** Shoulder z that points a limb straight down the fighter's facing. */
const HALF_PI = Math.PI / 2;

/**
 * Scratch for the barrel roll's orientation, which cannot be written as a
 * three-axis Euler.
 *
 * Riding inside the barrel means spinning about the body's **own long axis**
 * after that axis has been laid down and turned toward the camera — a
 * `Y · X · Y` sequence. Euler angles are always three *different* axes in a
 * fixed order, so the composition is built from quaternions instead. Module
 * scope so the per-frame pose never allocates.
 */
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _qSpin = new THREE.Quaternion();
const _qLay = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qStand = new THREE.Quaternion();
const _eStand = new THREE.Euler();
/** Scratch for reading fist positions when seating the Battle Ram on them. */
const _ramGrip = new THREE.Vector3();
const _ramGrip2 = new THREE.Vector3();

/**
 * How far the barrel's axis is turned off pure depth.
 *
 * Zero: square to the camera, the way a barrel rolling along a side-on stage
 * actually sits. The cost is that only the near end is ever visible — the far
 * one hides directly behind it — but angling it to show both reads as a barrel
 * skidding sideways, which is worse than losing sight of his feet.
 */
const BARREL_TILT = 0;

/**
 * Yaw that turns a fighter square to the camera, measured from the small bias
 * the rig already carries. Used by moves whose arc travels front-to-back, which
 * is the one direction a side-on camera cannot show.
 */
const FACE_CAMERA_TURN = HALF_PI - CAMERA_YAW_BIAS;

/**
 * How much of that turn an overhead arc takes — nearly all of it, so she plays
 * the swing square to the camera. Safe to turn this far only because these
 * poses cancel the yaw again at the shoulder; without that the arc would rotate
 * with her and foreshorten away down the lens.
 */
const ARC_FACING = 0.88;

/**
 * How far the back air turns her when the weapon arm is on the blind side.
 * Enough to lift the swing clear of her silhouette, well short of the ~115
 * degrees that would fully clear it — that far and she reads as facing the
 * wrong way mid-swing.
 */
const BAIR_TURN = 0.0;

/**
 * How far the up smash turns her *away* from the camera as she leaps. Less than
 * the up tilt's pivot: past this she is showing pure back and the bat vanishes
 * behind her own shoulders.
 */
const SWOOP_FACING = 0.26;


/**
 * How far the down air turns her into the camera. Nearly all the way: the move
 * is symmetric about her centre line, and that symmetry is edge-on from the side.
 */
const DAIR_FACING = 0.88;

/**
 * Shoulder x each arm angles inwards by for a two-handed grip, bringing both
 * hands onto the fighter's centre line instead of under one shoulder.
 */
const GRIP_CONVERGE = 0.62;
/**
 * How much of that the elbow takes back out. Less than the full amount: the
 * shoulder and elbow rotations do not commute, so cancelling the angle exactly
 * overshoots and throws the weapon past the centre line the other way.
 */
const GRIP_COUNTER = 0.47;

/**
 * Turns for moves performed with the *free* hand. That hand is on the far side
 * of the body from the camera, so without a turn the action plays out behind
 * her torso and the player sees nothing happen.
 */
const THROW_FACING = 0.50;
const SNATCH_FACING = 0.38;

/**
 * Frames spent easing out of an attack pose into whatever comes next, scaled by
 * how far the pose actually has to travel.
 *
 * A fixed length is wrong at both ends: the up tilt finishes with the arm
 * behind her head and has four radians to unwind, while a down tilt is nearly
 * home already. Giving both the same number of frames either leaves the big one
 * stepping visibly or leaves the small one drifting back in slow motion. The
 * ceiling matters too — the fighter is actionable the moment the move ends, so
 * a long ease keeps them looking busy after they can already move.
 */
const POSE_BLEND_PER_RADIAN = 2.5;
const POSE_BLEND_MIN = 4;
const POSE_BLEND_MAX = 12;

/**
 * States that must never be eased into. A hit, a grab or a death has to land
 * on the frame it lands — smoothing them would soften the one thing both
 * players need to read instantly.
 */
const NO_BLEND_STATES = new Set([
  S.HITSTUN, S.TUMBLE, S.DOWNED, S.DEAD, S.RESPAWN,
  S.GRABBED, S.SHIELD_BREAK, S.DIZZY, S.LEDGE_HANG,
]);

/**
 * Is this fighter mid-evade, and *actually* invulnerable right now?
 *
 * Tied to the intangible frames rather than to the whole animation, so the
 * ghost marks the window that beats an attack instead of the window the
 * animation happens to occupy — the recovery frames of a spot dodge are as
 * punishable as anything else and should not look safe.
 */
function isEvading(f) {
  const m = f.move;
  if (!m) return false;
  const k = m.kind;
  if (k !== 'dodge' && k !== 'airdodge' && k !== 'roll' && k !== 'tech') return false;
  return f.isIntangible();
}

/**
 * Lays a colour variant over a fighter's base `model` block.
 *
 * A variant only ever restates colours — the clothing palette plus whichever
 * of the garment pieces it wants to repaint — so the character keeps its
 * silhouette, its features and everything that makes it recognisable. Anything
 * the variant does not mention is inherited.
 */
function applyVariant(model, name) {
  const variant = name && model.variants && model.variants[name];
  if (!variant) return model;
  const out = { ...model, palette: { ...model.palette, ...variant.palette } };
  for (const part of ['hood', 'tabard', 'belt', 'cloak']) {
    if (variant[part]) out[part] = { ...model[part], ...variant[part] };
  }
  return out;
}

function box(w, h, d, material, { pivotTop = false } = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class FighterRig {
  constructor(fighter) {
    this.fighter = fighter;
    this.def = fighter.def;

    /**
     * `model.scale` trims or swells the whole silhouette without touching the
     * fighter's box.
     *
     * Every proportion below, and every offset in every pose, is written as a
     * fraction of `this.W` / `this.H` — so scaling those two here is the one
     * place a uniform resize can be applied and have the arms, the weapon and
     * the animation offsets all come along with it. The sim reads
     * `def.width` / `def.height` directly for hurtboxes, so this stays purely
     * cosmetic: a model can be shrunk without quietly making the fighter
     * harder to hit. Feet stay planted because the whole rig is measured
     * upward from the root, which sits on the ground.
     */
    const mScale = (this.def.model && this.def.model.scale) || 1;
    const W = this.def.width * mScale;
    const H = this.def.height * mScale;
    this.W = W; this.H = H;

    // --- palette ----------------------------------------------------------
    // Colours come from the fighter's own data, so each character looks like
    // itself. Player identity rides on top as a colour variant — a recolour of
    // the clothing only — which is what keeps a mirror match readable.
    const model = applyVariant(this.def.model || {}, fighter.variant);
    this.model = model;

    const pal = {
      garment: '#4a5568', garmentDark: '#333c4a', trim: '#a8b4c4',
      skin: '#e0a878', hair: '#4a3020', leather: '#6b4423',
      metal: '#b9c4d6', gold: '#c9a227', trousers: '#3a3a44',
      boot: '#2b2f3d', eye: '#20232e', wood: '#a97c50', woodDark: '#7a5533',
      ...(model.palette || {}),
    };
    this.pal = pal;

    const M = (c) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c) });
    this.materials = {
      garment: M(pal.garment),
      garmentDark: M(pal.garmentDark),
      trim: M(pal.trim),
      skin: M(pal.skin),
      hair: M(pal.hair),
      leather: M(pal.leather),
      metal: M(pal.metal),
      gold: M(pal.gold),
      trousers: M(pal.trousers),
      boot: M(pal.boot),
      eye: M(pal.eye),
      dark: M('#171a23'),
      wood: M(pal.wood),
      woodDark: M(pal.woodDark),
    };
    /** Flash colour used for hit feedback; swapped in and out per frame. */
    this.flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    /**
     * Ghost worn through a dodge's intangible frames. Unlit and translucent so
     * it reads as "not there" at a glance, but `depthWrite` stays on — without
     * it the far side of the body shows through the near side and the fighter
     * turns into a heap of overlapping boxes.
     */
    this.dodgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x9db3cc, transparent: true, opacity: 0.42, depthWrite: true,
    });

    // --- proportions -------------------------------------------------------
    // The body faces +x, so a part's *width* (shoulder to shoulder) runs along
    // z and its *depth* (chest to back) runs along x. Getting these the wrong
    // way round makes the characters read as deep and narrow.
    /**
     * Optional per-fighter reshaping, declared as `model.build`.
     *
     * The proportions below are the shared default silhouette. A fighter whose
     * *shape* is part of their identity — the Barbarian is broader through the
     * shoulders and thicker through the legs than either of the others — scales
     * the relevant pieces here rather than getting a bespoke rig.
     *
     * Presentation only: hurtboxes are built from `def.width` and `def.height`,
     * so broadening the model does not quietly make a fighter easier to hit.
     * If a character should also *be* bigger, that belongs in those two numbers.
     */
    const b = (this.model && this.model.build) || {};
    const bShoulder = b.shoulders || 1;
    const bChest = b.chest || 1;
    const bArm = b.arms || 1;
    const bLeg = b.legs || 1;
    /**
     * `build.head` and `build.legLength` change *proportion*, not just girth.
     *
     * `legLength` has to scale `hipY` along with the thigh and shin, because the
     * default proportions are solved so that `thigh + shin === hipY` — the legs
     * exactly reach the floor. Shortening the bones alone would leave the whole
     * fighter hovering. Scaling the hip with them keeps the feet planted and
     * simply moves the waistline down, which is what "short legs, long torso"
     * actually means.
     */
    const bHead = b.head || 1;
    const bLegLen = b.legLength || 1;

    const p = {
      hipY: H * 0.46 * bLegLen,
      torsoH: H * 0.30,
      torsoW: W * 0.60 * bShoulder,   // across the shoulders -> z
      torsoD: W * 0.42 * bChest,      // chest to back        -> x
      headR: W * 0.21 * bHead,
      // Shoulders sit just outside the chest, or the arms disappear into it.
      shoulderZ: W * 0.39 * bShoulder,
      hipZ: W * 0.155 * bLeg,
      upperArm: H * 0.20,
      foreArm: H * 0.18,
      armT: W * 0.17 * bArm,
      thigh: H * 0.24 * bLegLen,
      shin: H * 0.22 * bLegLen,
      legT: W * 0.21 * bLeg,
    };
    this.p = p;

    this.root = new THREE.Group();

    // Pelvis -> torso -> chest -> head/arms
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = p.hipY;
    this.root.add(this.pelvis);

    this.torso = box(p.torsoD, p.torsoH, p.torsoW, this.materials.garment);
    this.torso.position.y = p.torsoH / 2;
    this.pelvis.add(this.torso);

    this.chest = new THREE.Group();
    this.chest.position.y = p.torsoH;
    this.pelvis.add(this.chest);

    this.neck = new THREE.Group();
    this.chest.add(this.neck);

    this.head = box(p.headR * 2, p.headR * 2, p.headR * 2, this.materials.skin);
    this.head.position.y = p.headR;
    this.neck.add(this.head);

    // Kept as a field so a full helm can hide it — see `buildHelm`.
    this.nose = box(p.headR * 0.34, p.headR * 0.3, p.headR * 0.34, this.materials.skin);
    this.nose.position.set(p.headR * 1.08, p.headR * 1.02, 0);
    this.neck.add(this.nose);

    this.arms = {};
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(0, -p.armT * 0.3, sign * p.shoulderZ);
      this.chest.add(shoulder);

      // Sleeve in the garment colour, bare forearm in skin: the break at the
      // elbow is what makes the arm read as an arm at this size.
      const upper = box(p.armT, p.upperArm, p.armT, this.materials.garment, { pivotTop: true });
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -p.upperArm;
      shoulder.add(elbow);

      const fore = box(p.armT * 0.88, p.foreArm, p.armT * 0.88, this.materials.skin, { pivotTop: true });
      elbow.add(fore);

      /**
       * `model.gloves: false` strips the forearm cuff and takes the fist back to
       * skin — the Barbarian fights bare-handed. The fist block itself stays
       * either way: it is what reads as a hand at this size, and it is the node
       * every weapon is parented to, so it cannot simply be dropped.
       */
      const gloved = !this.model || this.model.gloves !== false;
      const handMat = gloved ? this.materials.leather : this.materials.skin;

      if (gloved) {
        const bracer = box(p.armT * 1.02, p.foreArm * 0.42, p.armT * 1.02, this.materials.leather);
        bracer.position.y = -p.foreArm * 0.25;
        elbow.add(bracer);
      }

      const hand = new THREE.Group();
      hand.position.y = -p.foreArm;
      elbow.add(hand);

      const glove = box(p.armT * 1.1, p.armT * 0.95, p.armT * 1.1, handMat);
      glove.position.y = -p.armT * 0.3;
      hand.add(glove);

      this.arms[side] = { shoulder, elbow, hand };
    }

    this.legs = {};
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? -1 : 1;
      const hip = new THREE.Group();
      hip.position.set(0, 0, sign * p.hipZ);
      this.pelvis.add(hip);

      /**
       * `model.shorts` leaves the shins bare: the thigh keeps the garment and
       * the lower leg takes skin. Without it a fighter in shorts reads as a
       * fighter in trousers, because the leg is one colour from hip to ankle.
       */
      const bare = this.model && this.model.shorts;
      const thigh = box(p.legT, p.thigh, p.legT, this.materials.trousers, { pivotTop: true });
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -p.thigh;
      hip.add(knee);

      const shin = box(p.legT * 0.9, p.shin, p.legT * 0.9,
        bare ? this.materials.skin : this.materials.trousers, { pivotTop: true });
      knee.add(shin);

      const boot = box(p.legT * 1.0, p.shin * 0.42, p.legT * 1.0, this.materials.boot);
      boot.position.y = -p.shin * 0.8;
      knee.add(boot);

      const foot = box(p.legT * 1.6, p.legT * 0.5, p.legT * 1.05, this.materials.boot);
      foot.position.set(p.legT * 0.3, -p.shin - p.legT * 0.2, 0);
      knee.add(foot);

      this.legs[side] = { hip, knee };
    }

    this.buildCharacterExtras();

    this.walkPhase = 0;
    this.bobPhase = Math.random() * Math.PI * 2;
    this._allMeshes = [];
    this.root.traverse((o) => { if (o.isMesh) this._allMeshes.push(o); });
    /** Whichever whole-body material is currently worn, or null for none. */
    this._overlay = null;

    /**
     * Joints carried across frames for the attack-exit blend. The root is
     * deliberately absent: it holds world placement and facing, and easing
     * those would drag the fighter behind its own hurtbox.
     */
    this._blendNodes = [
      this.pelvis, this.chest, this.neck,
      this.arms.l.shoulder, this.arms.l.elbow, this.arms.l.hand,
      this.arms.r.shoulder, this.arms.r.elbow, this.arms.r.hand,
      this.legs.l.hip, this.legs.l.knee,
      this.legs.r.hip, this.legs.r.knee,
    ];
    this._snap = new Float32Array(this._blendNodes.length * 3);
    this._snapHipY = this.p.hipY;
    /** The pose an attack ended on, held still while the blend eases off it. */
    this._frozen = new Float32Array(this._blendNodes.length * 3);
    this._frozenHipY = this.p.hipY;
    this._blendFrames = 0;
    this._blendTotal = 1;
    this._wasAction = false;

    // With ~45 meshes per fighter the shadow pass dominates the frame. The
    // silhouette comes from the large parts, so small detail — eyes, trim,
    // buckles, brows — is excluded from it at no visible cost.
    const minShadowVolume = (W * 0.15) ** 3;
    for (const mesh of this._allMeshes) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const vol = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
      if (vol < minShadowVolume) mesh.castShadow = false;
    }
  }

  // ------------------------------------------------------------ character bits

  /**
   * Per-character detail, declared in the fighter's data file under `model`.
   * The shared rig stays generic; everything that makes a fighter recognisable
   * — hood, hair, mask, beard, tabard, weapon — is assembled from these flags.
   */
  buildCharacterExtras() {
    const m = this.model;
    if (m.hood) this.buildHood(m.hood);
    if (m.hair) this.buildHair(m.hair);
    if (m.mask) this.buildMask();
    if (m.brows) this.buildBrows();
    if (m.beard) this.buildBeard(m.beard);
    this.buildEyes();
    if (m.tabard) this.buildTabard(m.tabard);
    if (m.belt) this.buildBelt(m.belt);
    if (m.bracers) this.buildBracers(m.bracers);
    if (m.barrel) this.buildBarrel(m.barrel);
    if (m.spring) this.buildSpring(m.spring);
    if (m.ram) this.buildRam(m.ram);
    if (m.shoulderTrim) this.buildShoulderTrim();
    if (m.cloak) this.buildCloak(m.cloak);
    if (m.ears) this.buildEars(m.ears);
    if (m.suspenders) this.buildSuspenders(m.suspenders);
    if (m.helm) this.buildHelm(m.helm);
    if (m.pauldrons) this.buildPauldrons(m.pauldrons);
    if (m.scaleSkirt) this.buildScaleSkirt(m.scaleSkirt);
    if (m.maces) this.buildMaces(m.maces);
    /**
     * Which fist the weapon lives in. Everything defaults to the right, which
     * is what every pose family assumes when it drives "the weapon arm" — the
     * Goblin carries his dagger left-handed, so his own poses have to drive
     * `arms.l` to match.
     */
    this.weaponSide = m.weaponHand === 'left' ? 'l' : 'r';
    if (m.weapon) this.buildWeapon(m.weapon);
    // After the weapon: the spear shares the same fist and needs `weaponSide`.
    if (m.spear) this.buildSpear(m.spear);
    if (m.gobBarrel) this.buildGobBarrel(m.gobBarrel);
    if (m.drill) this.buildDrill(m.drill);
  }

  /**
   * A hood: crown, back drape and two cheek panels, leaving the face open
   * towards +x. `peak` pulls the crown back into a point, as the Bandit's does.
   */
  buildHood(opts) {
    const p = this.p;
    const r = p.headR;
    const cloth = opts.color ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.garment;
    this.materials[`hood_${opts.color || 'x'}`] = cloth;
    const trim = opts.trim
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.trim) })
      : this.materials.trim;
    this.materials[`hoodTrim_${opts.trim || 'x'}`] = trim;

    // Kept close to the skull: an oversized hood turns the whole fighter into
    // a block and buries the face.
    const crown = box(r * 1.95, r * 0.6, r * 2.2, cloth);
    crown.position.set(-r * 0.18, r * 2.12, 0);
    this.neck.add(crown);

    const back = box(r * 0.42, r * 2.4, r * 2.2, cloth);
    back.position.set(-r * 0.95, r * 1.1, 0);
    this.neck.add(back);

    for (const sgn of [-1, 1]) {
      const cheek = box(r * 1.5, r * 1.95, r * 0.36, cloth);
      cheek.position.set(-r * 0.32, r * 1.05, sgn * r * 1.02);
      this.neck.add(cheek);
      // Trim running down the face opening.
      const edge = box(r * 0.28, r * 2.0, r * 0.4, trim);
      edge.position.set(r * 0.5, r * 1.08, sgn * r * 1.0);
      this.neck.add(edge);
    }
    const brow = box(r * 0.42, r * 0.3, r * 2.2, trim);
    brow.position.set(r * 0.5, r * 2.0, 0);
    this.neck.add(brow);

    if (opts.peak) {
      const peak = box(r * 1.0, r * 0.55, r * 1.5, cloth);
      peak.position.set(-r * 1.2, r * 2.42, 0);
      peak.rotation.z = -0.5;
      this.neck.add(peak);
    }
    // Slim drape over the shoulders so the hood does not float.
    const shawl = box(p.torsoD * 1.05, p.torsoH * 0.2, p.torsoW * 1.06, cloth);
    shawl.position.y = -p.torsoH * 0.05;
    this.chest.add(shawl);
  }

  /** Straight-fringed bob, as the Bandit wears under her hood. */
  buildHair(style) {
    const r = this.p.headR;
    const hair = this.materials.hair;
    if (style === 'bob') {
      // Sits proud of the face so it stays visible inside the hood.
      const fringe = box(r * 0.36, r * 0.66, r * 1.85, hair);
      fringe.position.set(r * 1.02, r * 1.56, 0);
      this.neck.add(fringe);
      const cap = box(r * 1.7, r * 0.5, r * 2.02, hair);
      cap.position.set(r * 0.1, r * 1.78, 0);
      this.neck.add(cap);
      for (const sgn of [-1, 1]) {
        const lock = box(r * 1.1, r * 1.7, r * 0.36, hair);
        lock.position.set(r * 0.5, r * 0.82, sgn * r * 0.92);
        this.neck.add(lock);
      }
    } else if (style === 'short') {
      const cap = box(r * 1.9, r * 0.6, r * 2.02, hair);
      cap.position.set(-r * 0.05, r * 1.75, 0);
      this.neck.add(cap);
    } else if (style === 'mane') {
      /**
       * The Barbarian's hair, which is most of his silhouette.
       *
       * It is not a haircut so much as a helmet: a heavy slab over the crown,
       * a centre-parted fringe sitting proud of the brow, and two thick curtains
       * dropping past the jaw either side. Built oversized on purpose — at this
       * poly count a scalp-hugging cap disappears against the head and he stops
       * being recognisable from across the stage.
       */
      // Pulled back off the brow. Centred on the head it overhung the face and
      // he had no features at all from the three-quarter view the camera
      // actually uses.
      const crown = box(r * 1.9, r * 1.05, r * 2.3, hair);
      crown.position.set(-r * 0.22, r * 1.85, 0);
      this.neck.add(crown);

      // Centre-parted fringe: two wedges with a gap down the middle.
      for (const sgn of [-1, 1]) {
        const fringe = box(r * 0.4, r * 0.8, r * 0.8, hair);
        fringe.position.set(r * 0.92, r * 1.45, sgn * r * 0.6);
        this.neck.add(fringe);
      }
      // Curtains down both sides, past the jaw — set back so the face and the
      // moustache stay clear in front of them.
      for (const sgn of [-1, 1]) {
        const curtain = box(r * 1.5, r * 2.15, r * 0.46, hair);
        curtain.position.set(-r * 0.34, r * 0.55, sgn * r * 1.0);
        this.neck.add(curtain);
      }
      // Back of the mane.
      const back = box(r * 0.5, r * 1.9, r * 2.2, hair);
      back.position.set(-r * 1.0, r * 0.95, 0);
      this.neck.add(back);
    }
  }

  /** The Bandit's black domino mask. */
  buildMask() {
    const r = this.p.headR;
    const mask = box(r * 0.28, r * 0.55, r * 2.02, this.materials.dark);
    mask.position.set(r * 0.98, r * 1.16, 0);
    this.neck.add(mask);
  }

  buildBrows() {
    const r = this.p.headR;
    for (const sgn of [-1, 1]) {
      const brow = box(r * 0.22, r * 0.2, r * 0.7, this.materials.hair);
      brow.position.set(r * 1.02, r * 1.46, sgn * r * 0.45);
      this.neck.add(brow);
    }
  }

  /**
   * Facial hair. `beard: true` is the Wizard's full beard; `beard: 'horseshoe'`
   * is the Barbarian's, which is the single most recognisable thing about him:
   * a heavy moustache with two thick tails hanging past the jaw and no chin
   * hair between them.
   */
  buildBeard(style) {
    const r = this.p.headR;
    const hair = this.materials.hair;

    if (style === 'horseshoe') {
      // The bar across the top lip, wide enough to overhang the mouth.
      const tache = box(r * 0.40, r * 0.42, r * 1.55, hair);
      tache.position.set(r * 1.02, r * 0.72, 0);
      this.neck.add(tache);
      // Two tails dropping either side of the mouth, past the jaw.
      for (const sgn of [-1, 1]) {
        const tail = box(r * 0.38, r * 1.30, r * 0.42, hair);
        tail.position.set(r * 1.0, -r * 0.10, sgn * r * 0.57);
        this.neck.add(tail);
      }
      return;
    }

    const beard = box(r * 0.75, r * 1.15, r * 1.5, hair);
    beard.position.set(r * 0.75, r * 0.12, 0);
    this.neck.add(beard);
    const chin = box(r * 0.5, r * 0.6, r * 0.7, hair);
    chin.position.set(r * 0.85, -r * 0.45, 0);
    this.neck.add(chin);
    const tache = box(r * 0.34, r * 0.26, r * 1.15, hair);
    tache.position.set(r * 1.05, r * 0.78, 0);
    this.neck.add(tache);
  }

  /**
   * Studded leather bracers on both forearms — the Barbarian's wristbands.
   *
   * Parented to the elbow rather than the hand so they stay on the forearm
   * through every swing instead of riding round with the wrist.
   */
  buildBracers(opts) {
    const W = this.W, H = this.H;
    const band = opts.color
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.leather;
    this.materials[`bracer_${opts.color || 'x'}`] = band;
    const stud = this.materials.metal;

    for (const side of ['l', 'r']) {
      const cuff = box(W * 0.135, H * 0.075, W * 0.135, band);
      cuff.position.y = -this.p.foreArm * 0.62;
      this.arms[side].elbow.add(cuff);
      // Four studs round the cuff, which is what makes it read as spiked
      // rather than as a thick sleeve.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const spike = box(W * 0.05, H * 0.028, W * 0.05, stud);
        spike.position.set(dx * W * 0.085, -this.p.foreArm * 0.62, dz * W * 0.085);
        this.arms[side].elbow.add(spike);
      }
    }
  }

  buildEyes() {
    const r = this.p.headR;
    for (const sgn of [-1, 1]) {
      const eye = box(r * 0.16, r * 0.26, r * 0.34, this.materials.eye);
      eye.position.set(r * 1.06, r * 1.18, sgn * r * 0.44);
      this.neck.add(eye);
    }
  }

  /** Cloth panel hanging down the front from the belt. */
  buildTabard(opts) {
    const p = this.p;
    const mat = opts.color
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.leather;
    this.materials[`tabard_${opts.color || 'x'}`] = mat;
    const panel = box(p.torsoD * 0.26, p.torsoH * 1.5, p.torsoW * 0.34, mat);
    panel.position.set(p.torsoD * 0.5, p.torsoH * 0.42, 0);
    this.pelvis.add(panel);
  }

  buildBelt(opts) {
    const p = this.p;
    const beltMat = opts.color
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.leather;
    this.materials[`belt_${opts.color || 'x'}`] = beltMat;
    const belt = box(p.torsoD * 1.08, this.H * 0.045, p.torsoW * 1.08, beltMat);
    belt.position.y = p.torsoH * 0.1;
    this.pelvis.add(belt);

    const buckle = box(p.torsoD * 0.2, this.H * 0.052, p.torsoW * 0.28,
      opts.buckle === 'gold' ? this.materials.gold : this.materials.metal);
    buckle.position.set(p.torsoD * 0.55, p.torsoH * 0.1, 0);
    this.pelvis.add(buckle);
  }

  buildShoulderTrim() {
    const p = this.p;
    for (const side of ['l', 'r']) {
      const cap = box(p.armT * 1.22, p.upperArm * 0.3, p.armT * 1.22, this.materials.trim);
      cap.position.y = -p.upperArm * 0.1;
      this.arms[side].shoulder.add(cap);
    }
  }

  /**
   * Cape hanging off the shoulders. Built as two tapering panels rather than
   * one slab — a single box reads as a wall bolted to the back.
   */
  buildCloak(opts) {
    const mat = opts.color
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.garment;
    this.materials[`cloak_${opts.color || 'x'}`] = mat;

    const len = this.H * (opts.length || 0.46);
    const backX = -(this.p.torsoD / 2 + this.W * 0.035);

    const cape = new THREE.Group();
    cape.position.set(backX, this.p.torsoH * 1.02, 0);
    cape.rotation.z = -0.06;                 // hangs slightly away from the back
    this.pelvis.add(cape);

    const upper = box(this.W * 0.07, len * 0.55, this.p.torsoW * 0.86, mat, { pivotTop: true });
    cape.add(upper);

    const lower = box(this.W * 0.06, len * 0.5, this.p.torsoW * 0.64, mat, { pivotTop: true });
    lower.position.y = -len * 0.54;
    cape.add(lower);

    this.cape = cape;
  }

  /**
   * The Mega Knight's great helm, built from the reference.
   *
   * Three stacked pieces, and the proportion between them is the whole
   * likeness: a **narrow riveted crown**, a dark eye slit, and a **jaw that is
   * wider than the crown above it**. Getting that the wrong way round — a big
   * head tapering to a small chin — is what made the first pass read as a
   * bucket rather than as this helmet.
   *
   * The head underneath is **hidden outright**. He has one slit to see through
   * and no skin should be visible anywhere; leaving the skin box in place had it
   * showing around every seam, and the nose poked clean through the front.
   *
   * The plume is deliberately the one bright thing on him. Everything else is
   * charcoal, and without it he reads as a grey blob at gameplay distance.
   */
  buildHelm(opts = {}) {
    const p = this.p, r = p.headR;
    const steel = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.color || '#3f4551'),
    });
    const plate = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.plate || '#4b5262'),
    });
    const trim = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.trim || '#565e6e'),
    });
    const bolt = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.bolt || '#6e7788'),
    });
    // Not merely dark — unlit, so the slits read as holes rather than as
    // surfaces that happen to be in shadow.
    const hollow = new THREE.MeshBasicMaterial({ color: 0x14171d });
    this.materials.helmSteel = steel;

    /** No skin, anywhere. The helm is the head now. */
    this.head.visible = false;
    if (this.nose) this.nose.visible = false;

    /**
     * The dark interior. Sits inside every opening so the slits and the grille
     * show blackness behind them instead of the sky.
     */
    const core = box(r * 1.9, r * 2.1, r * 1.9, hollow);
    core.position.y = r * 1.15;
    this.neck.add(core);

    // ---------------------------------------------------------------- crown
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.06, r * 0.92, 10, 1), steel);
    crown.position.y = r * 1.92;
    this.neck.add(crown);

    // Domed cap, slightly proud of the crown.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 1.02, r * 0.26, 10, 1), plate);
    cap.position.y = r * 2.44;
    this.neck.add(cap);

    /**
     * The riveted band round the base of the crown, with studs. The studs are
     * what stop the crown reading as a plain tin — six of them, spaced round
     * the front and sides where the camera can actually see them.
     */
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.30, 10, 1), trim);
    band.position.y = r * 1.52;
    this.neck.add(band);
    for (let i = 0; i < 6; i++) {
      const a = -1.6 + (i / 5) * 3.2;      // front-facing arc only
      const stud = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 6, 5), bolt);
      stud.position.set(Math.cos(a) * r * 1.14, r * 1.52, Math.sin(a) * r * 1.14);
      this.neck.add(stud);
    }

    // ------------------------------------------------------------- eye slit
    // A dark ring between crown and jaw. Modelled explicitly rather than left as
    // a gap, so it reads as a slit he sees out of and not as a construction seam.
    const slit = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.16, r * 1.16, r * 0.22, 10, 1), hollow);
    slit.position.y = r * 1.26;
    this.neck.add(slit);

    // ------------------------------------------------------------------ jaw
    /**
     * **Wider than the crown**, and curved. Two stacked cylinders flaring out
     * and then tucking back under give the rounded muzzle of the reference
     * without a curved primitive.
     */
    const jawTop = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.24, r * 1.34, r * 0.44, 10, 1), plate);
    jawTop.position.y = r * 0.94;
    this.neck.add(jawTop);
    const jawBase = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.34, r * 1.16, r * 0.30, 10, 1), plate);
    jawBase.position.y = r * 0.12;
    this.neck.add(jawBase);

    /**
     * The grille: vertical bars with gaps between them, wrapped round the front
     * and both cheeks. The gaps are the point — the dark core behind shows
     * through, which is what makes it a vent rather than a painted stripe.
     */
    const BARS = 9;
    for (let i = 0; i < BARS; i++) {
      const a = -1.9 + (i / (BARS - 1)) * 3.8;
      const bar = box(r * 0.20, r * 0.60, r * 0.14, plate);
      bar.position.set(Math.cos(a) * r * 1.30, r * 0.54, Math.sin(a) * r * 1.30);
      bar.rotation.y = -a;
      this.neck.add(bar);
    }

    /**
     * The two big jaw bolts. Cylinders lying along the depth axis, one on each
     * cheek, with a paler cap — these are the largest single detail on the helm
     * in the reference and they are what make it read as bolted together.
     */
    for (const sz of [-1, 1]) {
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.30, r * 0.30, r * 0.34, 8, 1), trim);
      shank.rotation.x = HALF_PI;
      shank.position.set(r * 0.10, r * 1.02, sz * r * 1.32);
      this.neck.add(shank);
      const head2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.19, r * 0.19, r * 0.16, 8, 1), bolt);
      head2.rotation.x = HALF_PI;
      head2.position.set(r * 0.10, r * 1.02, sz * r * 1.52);
      this.neck.add(head2);
    }

    // ---------------------------------------------------------------- plume
    const plume = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.plume || '#3b7ddd'),
    });
    const stalk = box(r * 0.16, r * 0.62, r * 0.16, plume);
    stalk.position.set(-r * 0.04, r * 2.86, 0);
    this.neck.add(stalk);
    /**
     * The tuft curls back and broadens, the way the reference's does. Blocks
     * rather than a curve: at this poly count they read identically and the
     * shape is carried by the outline, not the surface.
     */
    const CURL = [[0.10, 3.30, 0.34], [-0.12, 3.60, 0.40], [-0.46, 3.74, 0.30], [-0.74, 3.60, 0.20]];
    for (const [dx, yy, s] of CURL) {
      const tuft = box(r * s, r * s * 0.95, r * s * 0.9, plume);
      tuft.position.set(r * dx, r * yy, 0);
      this.neck.add(tuft);
    }
  }


  /**
   * Slab pauldrons. Two plates each, the outer one dropped and angled, which is
   * what gives the silhouette its width at the top — the single-box version
   * read as a shoulder pad rather than as armour.
   */
  buildPauldrons(opts = {}) {
    const p = this.p;
    const steel = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.color || '#3f4551'),
    });
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? -1 : 1;
      const cap = box(p.armT * 1.9, p.upperArm * 0.46, p.armT * 1.55, steel);
      cap.position.set(0, -p.upperArm * 0.02, sign * p.armT * 0.12);
      this.arms[side].shoulder.add(cap);

      const skirtPlate = box(p.armT * 1.62, p.upperArm * 0.30, p.armT * 1.34, steel);
      skirtPlate.position.set(0, -p.upperArm * 0.34, sign * p.armT * 0.18);
      skirtPlate.rotation.x = sign * 0.16;
      this.arms[side].shoulder.add(skirtPlate);
    }
  }

  /**
   * Scale-mail **shorts**, not a skirt.
   *
   * The first version flared steadily wider as it descended — 1.06 of the waist
   * at the top out to 1.24 at the hem — and a hem wider than the hips is a
   * skirt, whatever it is made of. This runs the hips straight down at a
   * constant width and then **splits into two legs**, which is the difference
   * between armoured shorts and a dress.
   *
   * Still built in stepped layers, because the steps are what read as
   * overlapping scales at any distance. They just no longer grow.
   *
   * Parented to the pelvis, so it moves with the hips instead of floating.
   */
  buildScaleSkirt(opts = {}) {
    const p = this.p, H = this.H;
    const mail = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.color || '#b8bec9'),
    });
    const mailDark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.shade || '#98a0ad'),
    });

    // Waist block: straight sided, one width the whole way down.
    const WAIST = [
      { y: 0.015, h: 0.05 },
      { y: -0.032, h: 0.05 },
    ];
    WAIST.forEach((L, i) => {
      const ring = box(p.torsoD * 1.10, H * L.h, p.torsoW * 1.08, i % 2 ? mailDark : mail);
      ring.position.y = p.torsoH * 0.1 + H * L.y;
      this.pelvis.add(ring);
    });

    /**
     * Two legs below it, one over each thigh, with a gap between them. The gap
     * is what makes them read as separate — a single block at this width is
     * indistinguishable from the skirt it replaced.
     */
    const LEGS = [
      { y: -0.078, h: 0.05 },
      { y: -0.124, h: 0.05 },
    ];
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? -1 : 1;
      LEGS.forEach((L, i) => {
        const cuff = box(p.torsoD * 1.06, H * L.h, p.torsoW * 0.46, i % 2 ? mailDark : mail);
        cuff.position.set(0, p.torsoH * 0.1 + H * L.y, sign * p.torsoW * 0.28);
        this.pelvis.add(cuff);
      });
    }
  }

  /**
   * The two spiked maces, one welded to each fist.
   *
   * These are **not** weapons in the `buildWeapon` sense: that system is for one
   * held item on the weapon hand, and these are a permanent part of both arms.
   * They are never hidden, and no pose has to remember to carry them — they
   * simply are his hands.
   *
   * Built as a block with pyramid spikes on five faces, extending along **-y**
   * off the fist like every other held thing, so the existing shoulder dials
   * aim them without special cases.
   */
  buildMaces(opts = {}) {
    const W = this.W;
    const iron = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.color || '#4a5160'),
    });
    const spikeMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.spike || '#6b7280'),
    });
    this.materials.maceIron = iron;

    /**
     * Enormous on purpose. At half this size they read as boxing gloves; the
     * whole point of the card is that his fists are bigger than his head.
     */
    /**
     * Big, but not bigger than he is. At 0.46 of his width each mace measured
     * 93 across against a 32-wide head — they overlapped his own torso and the
     * fighter read as a heap of dark boxes with no silhouette at all. 0.30
     * keeps them comfortably larger than his head, which is the read the card
     * has, without eating the body they hang off.
     */
    const R = W * 0.28;
    this.maces = {};
    for (const side of ['l', 'r']) {
      const g = new THREE.Group();
      /**
       * Hangs **at** the fist, not below it. Slung down by a full 0.62 of its
       * own radius the block reached the floor — measured, its bottom sat at
       * y = -2 on a fighter whose hip is at 52 — and it buried the scale skirt
       * completely. A short drop reads as weight without the mace becoming a
       * second pair of feet.
       */
      g.position.y = -R * 0.15;

      const core = box(R * 1.5, R * 1.5, R * 1.5, iron);
      g.add(core);

      /**
       * Spikes on every face but the one against his wrist. Cones rather than
       * boxes: a box spike is indistinguishable from the block it sits on, and
       * the taper is the only thing that reads as a point.
       */
      const FACES = [
        [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      ];
      for (const [ax, ay, az] of FACES) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(R * 0.30, R * 0.70, 4), spikeMat,
        );
        spike.position.set(ax * R * 0.98, ay * R * 0.98, az * R * 0.98);
        // Point the cone (built along +y) down its own face normal.
        if (ax) spike.rotation.z = -Math.sign(ax) * HALF_PI;
        else if (az) spike.rotation.x = Math.sign(az) * HALF_PI;
        else if (ay < 0) spike.rotation.x = Math.PI;
        g.add(spike);
      }

      this.arms[side].hand.add(g);
      this.maces[side] = g;
    }
  }

  /**
   * The Spear Goblin's spear — built once, hidden, shown only by the throw.
   *
   * Parented to the **free** fist, not the weapon one. His dagger lives in his
   * right hand and stays there; a thrown spear coming out of the same fist
   * meant the dagger had to vanish and reappear for every throw. Off-handing it
   * lets him keep hold of both, and the throw becomes a left-arm motion with the
   * dagger arm doing nothing.
   *
   * Built along **-y**, matching the dagger and every other held weapon, so the
   * same shoulder dial aims all of them.
   */
  buildSpear(opts = {}) {
    const H = this.H;
    const shaft = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#b08040'),
    });
    const wrap = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wrap || '#6b4426'),
    });
    const head = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.metal || '#c9d0da'),
    });

    const g = new THREE.Group();
    /**
     * **Longer than he is tall**, and on a thick shaft.
     *
     * The first pass was 0.95 of his height on a 3% shaft and read as an arrow —
     * at this scale a thin stick with a pin on the end is indistinguishable from
     * a thrown dart. A spear has to overhang him at both ends to be a spear. The
     * grip sits about a third up, which is where a thrown javelin is held.
     */
    const L = H * 1.21;
    const T = H * 0.055;
    const grip = L * 0.34;

    const pole = box(T, L, T, shaft, { pivotTop: true });
    pole.position.y = grip;          // hand a third of the way along
    g.add(pole);

    // Leather binding at the grip, the dark wrap in the card art.
    const bind = box(T * 1.5, L * 0.13, T * 1.5, wrap);
    bind.position.y = grip - L * 0.30;
    g.add(bind);

    /**
     * A leaf head: two stacked boxes that widen then taper to a point. A single
     * box read as a nail, and the widening is the whole silhouette of a spear
     * tip at this poly count.
     */
    const collar = box(T * 1.25, L * 0.05, T * 1.25, head);
    collar.position.y = grip - L * 0.66;
    g.add(collar);
    const blade = box(T * 2.9, L * 0.16, T * 0.95, head);
    blade.position.y = grip - L * 0.74;
    g.add(blade);
    const point = box(T * 1.1, L * 0.07, T * 0.7, head);
    point.position.y = grip - L * 0.84;
    g.add(point);

    g.visible = false;
    this.spear = g;
    const free = (this.weaponSide || 'r') === 'r' ? 'l' : 'r';
    this.spearHand = free;
    this.arms[free].hand.add(g);
  }

  /**
   * The Goblin Barrel — the whole move's silhouette, so it is the whole prop.
   *
   * Deliberately the Barbarian Barrel's poorer cousin: lighter wood, no spikes,
   * and small enough to belong to a fighter 74 tall. The important difference is
   * that it is **closed at both ends**. His is a barrel he is thrown *inside*,
   * not one he is lying across, so nothing of him shows — which means the end
   * caps are solid discs rather than the Barbarian's open rings.
   *
   * Axis along **z**, the depth axis, so a spin about it tumbles the barrel
   * across the screen rather than rotating it on the spot.
   */
  buildGobBarrel(opts = {}) {
    const W = this.W;
    const wood = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#c08a4e'),
    });
    const woodDark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.woodDark || '#a06f38'),
    });
    const band = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.band || '#7a5228'),
    });

    const g = new THREE.Group();
    /**
     * An inner group carries the resting orientation; the outer one is what the
     * pose spins. Separating them is what lets the tumble be a plain
     * `rotation.z` without the axis and the animation fighting each other.
     *
     * The parts below are modelled with their axis along **z**, so a quarter
     * turn about y lays that axis **across the screen** — and a spin about z
     * then tumbles the barrel end over end with its *side* facing the camera.
     * Left along z it pointed straight at the lens and the whole prop rendered
     * as a circle rotating on the spot, staves and hoops all edge-on.
     *
     * The 0.42 taken off that quarter turn is deliberate: it yaws the barrel
     * just off square so one end cap stays partly visible, which is what gives
     * it depth instead of reading as a flat plank.
     */
    const inner = new THREE.Group();
    inner.rotation.y = HALF_PI - 0.42;
    g.add(inner);

    const R = W * 0.62;
    const L = W * 0.86;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 10, 1), wood);
    body.rotation.x = Math.PI / 2;
    inner.add(body);

    const belly = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.07, R * 1.07, L * 0.40, 10, 1), woodDark);
    belly.rotation.x = Math.PI / 2;
    inner.add(belly);

    // Wooden hoops, not steel — nothing on this barrel is meant to look armed.
    for (const zz of [-L * 0.32, L * 0.32]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.10, R * 1.10, L * 0.10, 10, 1), band);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.z = zz;
      inner.add(hoop);
    }

    // Solid lids. He is sealed in: this is what makes it read as a delivery
    // rather than as a barrel he happens to be riding.
    for (const zz of [-L * 0.5, L * 0.5]) {
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.99, R * 0.99, L * 0.06, 10, 1), woodDark);
      lid.rotation.x = Math.PI / 2;
      lid.position.z = zz;
      inner.add(lid);
    }

    g.visible = false;
    this.gobBarrel = g;
    this.root.add(g);
  }

  /**
   * The Goblin Drill — a stepped cone of riveted tiers ending in a screw point.
   *
   * Four stacked cylinders shrinking toward the tip, which is what the card art
   * is: not a smooth cone but a machine assembled out of rings. The rivets are
   * what stop it reading as a traffic cone, and they are cheap — six little
   * boxes per tier on the widest two only.
   *
   * Built along **+x**, pointing the way he faces, because unlike the held
   * weapons this is not swung: it is driven forward, and its axis is its travel.
   */
  buildDrill(opts = {}) {
    const W = this.W, H = this.H;
    const steel = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.metal || '#d3d8de'),
    });
    const dark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.metalDark || '#9aa3ad'),
    });
    const rivet = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.rivet || '#7d868f'),
    });

    const g = new THREE.Group();
    // Big for him — that is the joke — but still inside arm's reach.
    const R = W * 0.46;
    const L = H * 0.46;

    const TIERS = [
      { r: 1.00, len: 0.30, at: -0.34, rivets: 6 },
      { r: 0.80, len: 0.26, at: -0.05, rivets: 6 },
      { r: 0.58, len: 0.22, at: 0.20, rivets: 0 },
      { r: 0.36, len: 0.18, at: 0.40, rivets: 0 },
    ];
    for (const t of TIERS) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(R * t.r, R * t.r, L * t.len, 10, 1), steel);
      seg.rotation.z = Math.PI / 2;          // axis along x
      seg.position.x = L * t.at;
      g.add(seg);
      // Dark collar at the back of each tier, which is what makes the steps read.
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(R * t.r * 1.06, R * t.r * 1.06, L * 0.05, 10, 1), dark);
      lip.rotation.z = Math.PI / 2;
      lip.position.x = L * (t.at - t.len * 0.5);
      g.add(lip);

      for (let i = 0; i < t.rivets; i++) {
        const a = (i / t.rivets) * Math.PI * 2;
        const stud = box(L * 0.035, R * 0.10, R * 0.10, rivet);
        stud.position.set(L * t.at, Math.sin(a) * R * t.r * 0.96, Math.cos(a) * R * t.r * 0.96);
        g.add(stud);
      }
    }

    // The screw point: three short blades set at a twist, reading as a helix.
    for (let i = 0; i < 3; i++) {
      const flute = box(L * 0.22, R * 0.30, R * 0.16, dark);
      flute.position.x = L * 0.56;
      flute.rotation.x = (i / 3) * Math.PI * 2;
      g.add(flute);
    }
    const tip = box(L * 0.14, R * 0.13, R * 0.13, steel);
    tip.position.x = L * 0.68;
    g.add(tip);

    /**
     * A wooden shaft out the back, and it is the reason the whole prop works.
     *
     * Held directly, a drill this size sits in his face — the widest tier is
     * most of his body width and the machine ends up level with his chin. The
     * handle pushes the business end a body-width clear of him and gives the
     * hands somewhere honest to be, which is also why the tiers can stay big.
     */
    const timber = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#8a5a2b'),
    });
    const shaft = box(L * 0.62, R * 0.22, R * 0.22, timber);
    shaft.position.x = -L * 0.72;
    g.add(shaft);
    // Two grips, where each fist closes on it.
    for (const gx of [-L * 0.55, -L * 0.88]) {
      const hold = box(L * 0.10, R * 0.32, R * 0.32, dark);
      hold.position.x = gx;
      g.add(hold);
    }

    g.visible = false;
    this.drill = g;
    this.chest.add(g);
  }

  /**
   * The Barbarian Barrel — built once, hidden, and shown only by the pose that
   * needs it.
   *
   * Its axis runs along **z**, the depth axis, because that is the one a barrel
   * rolling along the stage turns about. Built on `root` rather than on the
   * pelvis so it inherits the whole-body roll without also inheriting whatever
   * the hips are doing inside it.
   *
   * Staves, two steel hoops and eight spikes, matching the card: at this poly
   * count the hoops and the spikes are what say "barrel" rather than "log".
   */
  buildBarrel(opts) {
    const W = this.W, H = this.H;
    const wood = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#8a5a2b'),
    });
    const woodDark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.woodDark || '#6d4520'),
    });
    const steel = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.metal || '#9aa2ad'),
    });
    this.materials.barrelWood = wood;
    this.materials.barrelWoodDark = woodDark;
    this.materials.barrelSteel = steel;

    const g = new THREE.Group();
    /**
     * Sized so he *doesn't* fit. At a radius that encloses him the barrel is
     * just a wheel with nobody in it — his head and his feet have to clear the
     * staves at both ends for the gag to read.
     */
    const R = W * 0.58;          // radius
    // Short as well as narrow: he is 104 long and has to clear it at *both*
    // ends, so the staves cover only his middle.
    const L = W * 0.76;          // length along the axis

    // Body. A ten-sided cylinder reads as staves without needing them modelled.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 10, 1), wood);
    body.rotation.x = Math.PI / 2;   // lay the axis along z
    g.add(body);

    // Slightly fatter belly, the way a real barrel bulges at the middle.
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.06, R * 1.06, L * 0.42, 10, 1), woodDark);
    belly.rotation.x = Math.PI / 2;
    g.add(belly);

    // Two steel hoops.
    for (const zz of [-L * 0.30, L * 0.30]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.09, R * 1.09, L * 0.11, 10, 1), steel);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.z = zz;
      g.add(hoop);
    }
    /**
     * The ends are what the camera actually sees.
     *
     * Rolling along the stage means the barrel turns about the depth axis, so a
     * side-on view looks straight at its end face — the same way you see a
     * wheel. Capping that with a solid steel disc turned the whole prop into a
     * grey coin. It is a **ring** at the rim instead, with the wooden face left
     * showing and two crossed planks over it, which is what says "barrel end".
     */
    for (const zz of [-L * 0.5, L * 0.5]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.97, W * 0.045, 6, 12), steel);
      rim.position.z = zz;
      g.add(rim);

      for (const rot of [0, Math.PI / 2]) {
        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(R * 1.7, W * 0.10, W * 0.05), woodDark,
        );
        plank.position.z = zz;
        plank.rotation.z = rot;
        g.add(plank);
      }
    }

    // Spikes around the circumference, on both hoops.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
      for (const zz of [-L * 0.30, L * 0.30]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(W * 0.075, W * 0.20, 4), steel);
        spike.position.set(Math.cos(a) * R * 1.10, Math.sin(a) * R * 1.10, zz);
        // Cones are built along +y; point it outward along its own radius.
        spike.rotation.z = a - Math.PI / 2;
        g.add(spike);
      }
    }

    // Sat exactly on the roll pivot, so the barrel spins about its own centre
    // instead of orbiting it. Four units off and it visibly wobbles.
    g.position.y = H * ROLL_PIVOT;
    g.visible = false;
    this.root.add(g);
    this.barrel = g;
  }

  /**
   * The Clash of Clans spring trap: a square wooden plank riding a gold coil,
   * set in a darker sunken frame.
   *
   * The coil is built as a stack of separate rings rather than one helix, so it
   * can **compress and extend like an accordion** — `setSpringCompression` moves
   * the rings and the plank together. Scaling a single tube instead squashes its
   * cross-section and the coil goes flat and ribbon-like.
   */
  buildSpring(opts = {}) {
    const W = this.W;
    const wood = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#c58a4a'),
    });
    const frame = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.frame || '#7a4a24'),
    });
    const brass = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.coil || '#d8a521'),
    });

    const g = new THREE.Group();
    const S = W * 0.62;               // plank half-width

    // Sunken frame it sits in.
    const base = new THREE.Mesh(new THREE.BoxGeometry(S * 2.05, W * 0.09, S * 2.05), frame);
    base.position.y = W * 0.045;
    g.add(base);

    // The coil: rings, biggest at the bottom, tapering slightly upward.
    const COILS = 5;
    const rings = [];
    for (let i = 0; i < COILS; i++) {
      const k = i / (COILS - 1);
      const r = S * (0.66 - k * 0.14);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, W * 0.052, 5, 10), brass,
      );
      ring.rotation.x = HALF_PI;      // lay it flat
      g.add(ring);
      rings.push(ring);
    }

    // The plank on top — light wood, square, with a lip so it reads as a board.
    const plank = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(S * 1.9, W * 0.10, S * 1.9), wood);
    plank.add(board);
    for (const sgn of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(S * 1.9, W * 0.05, S * 0.16), frame);
      lip.position.set(0, -W * 0.035, sgn * S * 0.88);
      plank.add(lip);
    }
    g.add(plank);

    g.visible = false;
    this.root.add(g);
    this.spring = g;
    this.springRings = rings;
    this.springPlank = plank;
    this.springTravel = W * 0.62;     // coil height when fully extended
  }

  /**
   * The Battle Ram: a faceted stone head on a banded wooden log.
   *
   * Built lying along **+x**, the direction the model faces, so it points where
   * he charges and the root's facing turn carries it round with him. The head
   * leads; the log and its hoops trail back over his shoulders.
   */
  buildRam(opts = {}) {
    const W = this.W;
    const timber = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.wood || '#8a5a2b'),
    });
    const timberDark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.woodDark || '#68411c'),
    });
    const rock = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.stone || '#6f7175'),
    });
    const rockDark = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.stoneDark || '#55575b'),
    });
    const steel = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.metal || '#8d949d'),
    });

    const g = new THREE.Group();
    const LOG = W * 1.25;              // log length
    const R = W * 0.27;               // log radius

    // The shaft. Laid along x, so a quarter turn off its built axis.
    const log = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, LOG, 10, 1), timber);
    log.rotation.z = HALF_PI;
    log.position.x = -LOG * 0.18;
    g.add(log);

    // End cap, so the back of the log reads as sawn timber rather than a tube.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.98, W * 0.05, 10, 1), timberDark);
    cap.rotation.z = HALF_PI;
    cap.position.x = -LOG * 0.68;
    g.add(cap);

    // Steel bands along the shaft.
    for (const k of [-0.42, -0.02]) {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 1.08, R * 1.08, W * 0.09, 10, 1), steel,
      );
      band.rotation.z = HALF_PI;
      band.position.x = LOG * k;
      g.add(band);
    }

    /**
     * The head: a ten-sided **truncated cone**, wide where it meets the timber
     * and tapering to a flat face at the front. The faceting is what makes it
     * read as chiselled stone — a sphere would be a boulder and a box a crate —
     * and the taper is what makes it read as something built to hit things.
     *
     * A cylinder's `radiusTop` sits at its +y end, and the quarter turn below
     * lays that end **backward**, so the *bottom* radius is the front face.
     * Measured, not assumed: swapping them gives a funnel pointing at his back.
     */
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.44, W * 0.25, W * 0.56, 10, 1), rock,
    );
    head.rotation.z = HALF_PI;
    head.position.x = LOG * 0.36;
    g.add(head);

    // A darker collar where the stone meets the timber.
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.31, W * 0.31, W * 0.10, 10, 1), rockDark,
    );
    collar.rotation.z = HALF_PI;
    collar.position.x = LOG * 0.19;
    g.add(collar);

    // The two big carrying loops from the card, standing proud of the shaft.
    for (const k of [-0.50, 0.10]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(W * 0.15, W * 0.035, 5, 10), steel,
      );
      ring.position.set(LOG * k, R * 1.15, 0);
      g.add(ring);
    }

    g.visible = false;
    this.root.add(g);
    this.ram = g;
    this.ramLength = LOG;
  }

  /** @param {number} k 0 fully compressed, 1 fully extended. */
  setSpringCompression(k) {
    if (!this.spring) return;
    const bottom = this.W * 0.10;
    const height = this.W * 0.10 + this.springTravel * k;
    const n = this.springRings.length;
    for (let i = 0; i < n; i++) {
      this.springRings[i].position.y = bottom + (height - bottom) * (i / (n - 1 || 1));
    }
    this.springPlank.position.y = height + this.W * 0.06;
  }

  /**
   * Long pointed ears, swept back and slightly up.
   *
   * They are most of the Goblin's silhouette, so they are built big and angled
   * *outward* in depth as well as back — flat against the skull they vanish
   * into the head at this poly count, which is the same trap the hoods hit.
   */
  buildEars(opts = {}) {
    const r = this.p.headR;
    const skin = opts.color
      ? new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color) })
      : this.materials.skin;
    this.materials[`ear_${opts.color || 'x'}`] = skin;
    const len = r * (opts.length || 2.3);

    for (const sgn of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(r * 0.46, len, 4), skin);
      ear.position.set(-r * 0.22, r * 1.5, sgn * r * 0.92);
      // Cones build along +y; lay it back and out so the point trails behind.
      ear.rotation.z = -0.55;
      ear.rotation.x = sgn * -0.62;
      this.neck.add(ear);
    }
  }

  /**
   * Two braces over a bare chest, meeting at the belt.
   *
   * Drawn as straps on the torso rather than a garment, so the skin underneath
   * still reads — a full front panel would cover the chest the way the tabard
   * did on the Barbarian.
   */
  buildSuspenders(opts = {}) {
    const p = this.p;
    const strap = new THREE.MeshLambertMaterial({
      color: new THREE.Color(opts.color || '#c0392b'),
    });
    this.materials[`susp_${opts.color || 'x'}`] = strap;
    const w = p.torsoW * 0.16;

    /**
     * They hang **down** from the shoulders.
     *
     * `chest.position.y = torsoH` puts the chest node at shoulder height, so
     * chest-local `+y` climbs into the head — a strap centred at `+torsoH/2`
     * ends up across his face rather than his ribs. Everything here is measured
     * downward from zero.
     */
    for (const sgn of [-1, 1]) {
      const band = box(w, p.torsoH * 0.96, p.torsoD * 0.10, strap);
      band.position.set(p.torsoD * 0.5, -p.torsoH * 0.48, sgn * p.torsoW * 0.24);
      band.rotation.x = sgn * 0.10;
      this.chest.add(band);
      // The back run, so each reads as a loop over the shoulder rather than a
      // stripe painted on his front.
      const back = box(w, p.torsoH * 0.88, p.torsoD * 0.10, strap);
      back.position.set(-p.torsoD * 0.5, -p.torsoH * 0.52, sgn * p.torsoW * 0.22);
      this.chest.add(back);
      // A short cap over the top of the shoulder joining the two.
      const cap = box(p.torsoD * 1.05, w * 0.9, w, strap);
      cap.position.set(0, -w * 0.4, sgn * p.torsoW * 0.23);
      this.chest.add(cap);
    }
  }

  buildWeapon(kind) {
    const W = this.W, H = this.H;
    this.weaponKind = kind;
    /**
     * The weapon's pieces are parented straight onto the fist rather than into
     * a group, so a pose that needs it out of the way has to be able to find
     * them. Recorded here as they are built; see `setWeaponVisible`.
     */
    this.weaponParts = [];
    const handChildrenBefore = this.arms.r.hand.children.length;
    this._weaponFrom = handChildrenBefore;

    /**
     * Wooden bat: a short darker grip and a barrel that widens toward the end,
     * built as stacked boxes so the taper reads at this poly count. Extends up
     * out of the fist, so a swing carries it through the arc.
     */
    if (kind === 'bat') {
      // Limbs hang along -y from their joint, so the bat continues *past* the
      // fist in that same direction. Building it along +y instead lays it back
      // up the forearm and buries it in the arm.
      const knob = box(W * 0.11, H * 0.022, W * 0.11, this.materials.leather);
      knob.position.y = H * 0.018;
      this.arms[this.weaponSide].hand.add(knob);

      const grip = box(W * 0.085, H * 0.11, W * 0.085, this.materials.leather);
      grip.position.y = -H * 0.05;
      this.arms[this.weaponSide].hand.add(grip);

      const mid = box(W * 0.115, H * 0.13, W * 0.115, this.materials.wood);
      mid.position.y = -H * 0.17;
      this.arms[this.weaponSide].hand.add(mid);

      const barrel = box(W * 0.155, H * 0.17, W * 0.155, this.materials.wood);
      barrel.position.y = -H * 0.32;
      this.arms[this.weaponSide].hand.add(barrel);

      const cap = box(W * 0.14, H * 0.022, W * 0.14, this.materials.woodDark);
      cap.position.y = -H * 0.415;
      this.arms[this.weaponSide].hand.add(cap);
    }

    /**
     * Goblin dagger: a heavy hilt under a short triangular blade.
     *
     * Built along **-y** so it continues *past* the fist, the same convention
     * the bat and the sword use. Flipped the other way it lay back along his
     * forearm, which hid it against his own arm from every angle — the point of
     * a weapon at this poly count is the silhouette it adds.
     *
     * The proportions come straight off the card art, and they are unusual: the
     * hilt is nearly as long as the blade. A big wrapped grip with a fat pommel
     * carries a stubby triangle that is widest at the guard and runs to a point
     * in about two thirds of its own length. The first version had the ratio the
     * other way round — a 33-unit blade on a 74-tall fighter, which read as a
     * short sword.
     *
     * The taper is four stacked boxes narrowing in **both** axes rather than one
     * slab with a cap. At this poly count a triangle has to be built out of the
     * steps themselves; a constant-width blade with a pointed end reads as a
     * spike, not a knife.
     *
     * Blade tip now sits at about `-H * 0.27` in hand space (≈20 units), down
     * from `-H * 0.50` (≈37). Anything measuring the tip has to use the new
     * number.
     */
    if (kind === 'dagger') {
      const hand = this.arms[this.weaponSide].hand;
      // Grip sits back through the fist so it reads as held, not balanced on it.
      const grip = box(W * 0.115, H * 0.135, W * 0.115, this.materials.wood);
      grip.position.y = H * 0.028;
      hand.add(grip);
      const pommel = box(W * 0.16, H * 0.045, W * 0.16, this.materials.gold);
      pommel.position.y = H * 0.098;
      hand.add(pommel);

      const guard = box(W * 0.13, H * 0.04, W * 0.34, this.materials.gold);
      guard.position.y = -H * 0.048;
      hand.add(guard);

      // Widest at the guard, to a point in four steps. x is the blade's
      // thickness, z its width — the body faces +x, so z is what is seen.
      const STEPS = [
        [0.076, 0.055, 0.20],
        [0.070, 0.050, 0.155],
        [0.062, 0.045, 0.105],
        [0.050, 0.045, 0.055],
      ];
      let top = -H * 0.068;
      for (const [thick, len, wide] of STEPS) {
        const seg = box(W * thick, H * len, W * wide, this.materials.metal, { pivotTop: true });
        seg.position.y = top;
        hand.add(seg);
        top -= H * len;
      }
    }
    /**
     * Barbarian sword: a broad grey blade on a bronze crossguard, with a
     * pommel below the fist.
     *
     * Built along **-y** like the bat, so it continues past the fist and a
     * swing carries it through the arc. Building it up +y instead lays it back
     * along the forearm — the mistake the bat cost a whole debugging pass on.
     *
     * The blade tapers to a point over the last two boxes, which is what makes
     * it read as a sword rather than a plank at this poly count.
     */
    if (kind === 'sword') {
      const pommel = box(W * 0.10, H * 0.03, W * 0.10, this.materials.gold);
      pommel.position.y = H * 0.035;
      this.arms[this.weaponSide].hand.add(pommel);

      const grip = box(W * 0.07, H * 0.09, W * 0.07, this.materials.leather);
      grip.position.y = -H * 0.02;
      this.arms[this.weaponSide].hand.add(grip);

      // Crossguard, wide across the depth axis so it reads side-on.
      const guard = box(W * 0.09, H * 0.028, W * 0.30, this.materials.gold);
      guard.position.y = -H * 0.075;
      this.arms[this.weaponSide].hand.add(guard);

      const blade = box(W * 0.055, H * 0.30, W * 0.20, this.materials.metal);
      blade.position.y = -H * 0.24;
      this.arms[this.weaponSide].hand.add(blade);

      const taper = box(W * 0.05, H * 0.09, W * 0.135, this.materials.metal);
      taper.position.y = -H * 0.43;
      this.arms[this.weaponSide].hand.add(taper);

      const tip = box(W * 0.045, H * 0.07, W * 0.06, this.materials.metal);
      tip.position.y = -H * 0.50;
      this.arms[this.weaponSide].hand.add(tip);
    }
    if (kind === 'staff') {
      const shaft = box(W * 0.09, H * 0.86, W * 0.09, this.materials.wood);
      shaft.position.y = H * 0.2;
      this.arms[this.weaponSide].hand.add(shaft);
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(W * 0.17, 0),
        new THREE.MeshBasicMaterial({ color: 0xffb15c }),
      );
      orb.position.y = H * 0.63;
      this.arms[this.weaponSide].hand.add(orb);
      this.staffOrb = orb;
    }
    // Everything added to the fist by this call is the weapon.
    this.weaponParts = this.arms.r.hand.children.slice(this._weaponFrom);
  }

  /**
   * Shows or hides the held weapon.
   *
   * The Battle Ram needs both fists on the shaft, and a sword still in one of
   * them reads as him gripping a two-handed log one-handed. Reset to visible
   * every frame by `clearPose`, so only the pose that wants it gone turns it
   * off and nothing can leave it hidden.
   */
  setWeaponVisible(v) {
    if (!this.weaponParts) return;
    for (const part of this.weaponParts) part.visible = v;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); }
    });
    for (const m of Object.values(this.materials)) m.dispose();
    this.flashMaterial.dispose();
    this.dodgeMaterial.dispose();
  }

  // --------------------------------------------------------------- posing

  /** Resets every joint so each pose function only sets what it cares about. */
  clearPose() {
    this.pelvis.position.y = this.p.hipY;
    this.pelvis.rotation.set(0, 0, 0);
    this.pelvis.scale.set(1, 1, 1);
    this.chest.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    for (const side of ['l', 'r']) {
      this.arms[side].shoulder.rotation.set(0, 0, 0);
      this.arms[side].elbow.rotation.set(0, 0, 0);
      this.arms[side].hand.rotation.set(0, 0, 0);
      this.legs[side].hip.rotation.set(0, 0, 0);
      this.legs[side].knee.rotation.set(0, 0, 0);
    }
    this.root.rotation.set(0, 0, 0);
    // Props that belong to one move are off unless that move turns them on.
    if (this.barrel) this.barrel.visible = false;
    if (this.spring) this.spring.visible = false;
    if (this.ram) this.ram.visible = false;
    if (this.spear) this.spear.visible = false;
    if (this.gobBarrel) this.gobBarrel.visible = false;
    if (this.drill) this.drill.visible = false;
    // The body is itself a prop the Goblin Barrel hides — make sure it returns.
    this.pelvis.visible = true;
    this.setWeaponVisible(true);
  }

  /**
   * Main entry point: place and pose the rig from the simulation state.
   * @param {number} frame global frame counter, for idle cycles
   */
  update(frame) {
    const f = this.fighter;
    // `ceremony` is set by the renderer during the victory sequence, which
    // poses the fighters itself rather than reading a simulation that has
    // already stopped.
    const cer = this.ceremony;
    this.root.visible = cer ? true : f.state !== S.DEAD;
    if (!this.root.visible) return;

    this.root.position.set(f.x, -f.y, 0);

    /**
     * A brief judder on the spot — the Goblin's Gold Rush activation.
     *
     * Applied to the root *after* it is placed and before the pose runs, so it
     * rides on top of whatever he is doing without any pose having to know
     * about it. Presentation only: the simulation's `f.x` is untouched, so his
     * hurtbox does not shiver along with the model.
     *
     * The amplitude decays with the counter, so it lands hard and settles
     * rather than stopping dead.
     */
    const shake = f.custom && f.custom.gold && f.custom.gold.shake;
    if (shake > 0) {
      const amp = (shake / 26) * this.W * 0.11;
      this.root.position.x += (Math.random() - 0.5) * 2 * amp;
      this.root.position.y += (Math.random() - 0.5) * amp;
    }
    this.clearPose();

    /**
     * Facing turns her **around** — a half turn, not a reflection.
     *
     * A mirror would make the two directions identical on screen, but it swaps
     * her handedness with them: the bat changes hands, and the hood peak, mask
     * and cloak all flip. She is a character, not a decal. Turning her round
     * keeps the bat in the hand that holds it, which means the two facings are
     * *not* visually identical — facing one way the weapon arm is nearest the
     * camera, facing the other it is behind her. That is simply what a person
     * turning round looks like.
     *
     * The consequence for posing: her local depth axis points at the camera
     * facing one way and away from it facing the other. Anything authored to
     * read against the camera — a head turn, a sideways reach — therefore needs
     * a `facing` term, while anything authored against her own body does not.
     */
    this.root.scale.x = 1;
    this.root.rotation.y = f.facing > 0 ? -CAMERA_YAW_BIAS : Math.PI + CAMERA_YAW_BIAS;

    if (cer) {
      this.bobPhase += 0.06;
      this.poseCeremony(cer);
      // Still needed: a fighter caught mid-flash by the final KO would
      // otherwise celebrate in hit-flash white.
      this.applyOverlay(f);
      return;
    }

    // Gait phase is driven by distance travelled, so cadence is whatever the
    // fighter's speed and stride imply. Advancing it at a flat multiple of
    // speed is what made running look like a cartoon scramble.
    const speed = Math.abs(f.vx);
    const running = f.state === S.RUN || f.state === S.DASH;
    // Walking at partial tilt shortens the stride and slows the cadence
    // together, the way it does in life; sprinting is always full stride.
    this.gaitAmp = running
      ? 1
      : clamp(Math.sqrt(speed / Math.max(0.01, f.attr.walkSpeed)), 0.45, 1);
    const stride = this.H * (running ? SPRINT_STRIDE : WALK_STRIDE) * this.gaitAmp;
    this.walkPhase += (speed / Math.max(1, stride)) * Math.PI * 2;
    this.bobPhase += 0.06;

    switch (f.state) {
      case S.ACTION: this.poseAction(f); break;
      case S.WALK: this.poseWalk(f, this.gaitAmp); break;
      case S.DASH:
      case S.RUN: this.poseSprint(f); break;
      case S.RUN_BRAKE:
      case S.TURN: this.poseBrake(f); break;
      case S.CROUCH: this.poseCrouch(0.55); break;
      case S.JUMPSQUAT: this.poseCrouch(0.75); break;
      /**
       * **A heavy landing bends him.**
       *
       * The depth is read off the landing lag rather than from a flag, so it
       * needs no per-move plumbing and it is right for every fighter: a move
       * that costs 26 frames on the floor is by definition one that arrived
       * hard, and one that costs the default handful barely registers. A
       * stall-then-fall that stood up straight after cratering the stage was
       * the case that made this obvious.
       */
      case S.LANDING: {
        const lag = f.landingLagFrames || this.fighter.attr.landFrames || 4;
        this.poseCrouch(clamp(0.34 + (lag - 4) / 22, 0.34, 1));
        break;
      }
      case S.AIR:
      case S.HELPLESS: this.poseAir(f); break;
      case S.SHIELD:
      case S.SHIELD_STUN:
      case S.SHIELD_DROP: this.poseShield(f); break;
      case S.HITSTUN:
      case S.TUMBLE: this.poseHitstun(f); break;
      case S.DOWNED: this.poseDowned(); break;
      case S.SHIELD_BREAK:
      case S.DIZZY: this.poseDizzy(); break;
      case S.GRABBED: this.poseGrabbed(); break;
      case S.GRABBING: this.poseGrab(); break;
      case S.LEDGE_HANG: this.poseLedge(f); break;
      case S.RESPAWN: this.poseIdle(); break;
      default: this.poseIdle(); break;
    }

    this.blendOut(f);
    this.applyOverlay(f);
  }

  /**
   * Eases out of an attack instead of cutting to the next pose.
   *
   * Every pose is computed from scratch each frame, so the frame an attack ends
   * the fighter is simply *standing* — the arm that was extended is suddenly by
   * her side. Over one frame that reads as a snap.
   *
   * Only the way *out* is smoothed. Blending into an attack would soften the
   * windup, and in a fighting game the startup is information the opponent is
   * entitled to read at full sharpness. Getting hit is exempt for the same
   * reason: a hit has to land on the frame it lands.
   */
  blendOut(f) {
    const nodes = this._blendNodes;
    const wasAction = this._wasAction;
    this._wasAction = f.state === S.ACTION;

    // Starting an attack cancels any ease still running from the last one. A
    // move that begins part-way through a blend would have its windup dragged
    // back toward the previous pose, which is the startup going soft — the one
    // thing this must not touch.
    if (this._wasAction) this._blendFrames = 0;

    if (wasAction && !this._wasAction && !NO_BLEND_STATES.has(f.state)) {
      // Freeze the pose the attack finished on and ease away from *that*,
      // rather than chasing the previous frame. Chasing compounds: the weight
      // and the thing it weighs both move, and the largest step lands in the
      // middle of the blend, which is where the eye is looking.
      this._frozen.set(this._snap);
      this._frozenHipY = this._snapHipY;

      // How far there is to go decides how long to take. This frame already
      // holds the pose being blended *to*, so the distance is measurable now.
      let far = 0;
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].rotation;
        const b = i * 3;
        far = Math.max(far, Math.abs(r.x - this._frozen[b]),
          Math.abs(r.y - this._frozen[b + 1]), Math.abs(r.z - this._frozen[b + 2]));
      }
      this._blendTotal = clamp(Math.round(far * POSE_BLEND_PER_RADIAN),
        POSE_BLEND_MIN, POSE_BLEND_MAX);
      this._blendFrames = this._blendTotal;
    }

    if (this._blendFrames > 0) {
      const u = 1 - this._blendFrames / this._blendTotal;    // 0 -> 1 across the blend
      const w = 1 - u * u * (3 - 2 * u);                     // smoothstep, flat at both ends
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].rotation;
        const b = i * 3;
        r.x = lerp(r.x, this._frozen[b], w);
        r.y = lerp(r.y, this._frozen[b + 1], w);
        r.z = lerp(r.z, this._frozen[b + 2], w);
      }
      this.pelvis.position.y = lerp(this.pelvis.position.y, this._frozenHipY, w);
      this._blendFrames--;
    }

    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].rotation;
      const b = i * 3;
      this._snap[b] = r.x; this._snap[b + 1] = r.y; this._snap[b + 2] = r.z;
    }
    this._snapHipY = this.pelvis.position.y;
  }

  poseIdle() {
    const b = Math.sin(this.bobPhase) * 0.5;
    this.pelvis.position.y = this.p.hipY + b;
    this.chest.rotation.z = 0.04 + b * 0.006;
    this.arms.l.shoulder.rotation.x = -0.22;
    this.arms.r.shoulder.rotation.x = 0.22;
    this.arms.l.shoulder.rotation.z = 0.10 + b * 0.01;
    this.arms.r.shoulder.rotation.z = 0.10 - b * 0.01;
    this.arms.l.elbow.rotation.z = 0.35;
    this.arms.r.elbow.rotation.z = 0.35;
    this.neck.rotation.y = Math.sin(this.bobPhase * 0.4) * 0.08;
    this.carryWeapon();
  }

  /**
   * Settles a long weapon into a pose that was written for an empty hand.
   *
   * The bat extends *past* the fist, so an arm left hanging drags it through
   * the shins and into the floor; curling the elbow and cocking the wrist rests
   * it over the shoulder instead, which is also how the Bandit carries it. The
   * staff is built the other way up and stands out of the fist, so it only
   * needs the forearm kept vertical. A dagger is short enough to ignore.
   *
   * The shoulder is left alone by default so the pose's own arm swing still
   * comes through — the weapon rides with it rather than freezing in place.
   *
   * @param {number|null} [shoulder] shoulder override, or null to keep the pose's
   */
  carryWeapon(shoulder = null) {
    // Whichever fist actually holds it — see `weaponSide`.
    const arm = this.arms[this.weaponSide || 'r'];
    if (this.weaponKind === 'sword') {
      // Held low and level at the hip, not shouldered.
      arm.shoulder.rotation.z = shoulder !== null ? shoulder : SWORD_SHOULDER;
      arm.elbow.rotation.z = SWORD_ELBOW;
      arm.hand.rotation.z = SWORD_WRIST;
    } else if (this.weaponKind === 'bat') {
      if (shoulder !== null) arm.shoulder.rotation.z = shoulder;
      arm.elbow.rotation.z = CARRY_ELBOW;
      arm.hand.rotation.z = CARRY_WRIST;
    } else if (this.weaponKind === 'staff') {
      arm.elbow.rotation.z = -arm.shoulder.rotation.z;
    } else if (this.weaponKind === 'dagger') {
      /**
       * Carried point-up, angled forward — the card-art pose.
       *
       * A dagger is short enough that it never had to be settled anywhere; it
       * simply hung down the leg with the arm. That is also how nobody holds a
       * knife. Folding the elbow brings the fist up in front of the chest, and
       * because the blade runs along the forearm's own axis it comes up with
       * it: the elbow angle *is* the blade angle. The wrist adds the last bit
       * of cock so it finishes above horizontal rather than level.
       *
       * The shoulder is deliberately left to the caller, so the arm still
       * swings through the walk and run cycles and the blade rides with it.
       */
      if (shoulder !== null) arm.shoulder.rotation.z = shoulder;
      arm.elbow.rotation.z = DAGGER_ELBOW;
      arm.hand.rotation.z = DAGGER_WRIST;
    }
  }

  /**
   * Walk cycle. `amp` scales stride length, and must stay in step with the
   * stride used to advance the phase or the feet start sliding.
   *
   * Sign conventions that are easy to get wrong here: a positive z rotation
   * swings a limb forward, so a knee — which only folds backwards — is always
   * negative. The hips ride highest at mid-stance and dip when the legs are
   * spread, not the other way round.
   */
  poseWalk(f, amp) {
    if (this.model && this.model.gait === 'strut') { this.poseStrutWalk(f, amp); return; }
    const ph = this.walkPhase;
    const swing = Math.sin(ph);
    const spread = 1 - Math.abs(Math.cos(ph));
    const lean = 0.07 * amp;

    // Lean from the hips, then take it back out of the legs so they stay
    // upright underneath — the torso is a child of the pelvis, so rotating the
    // pelvis alone would tip the whole fighter over.
    //
    // Note the sign. A limb hangs *down* from its joint, so +z swings it
    // forward; the torso stacks *up* from the pelvis, so the same +z carries it
    // backward. Leaning forward from the pelvis is negative.
    this.pelvis.rotation.z = -lean;

    this.legs.l.hip.rotation.z = swing * 0.72 * amp + lean;
    this.legs.r.hip.rotation.z = -swing * 0.72 * amp + lean;
    this.legs.l.knee.rotation.z = -Math.max(0, -Math.sin(ph + 0.7)) * 0.95 * amp;
    this.legs.r.knee.rotation.z = -Math.max(0, Math.sin(ph + 0.7)) * 0.95 * amp;

    this.arms.l.shoulder.rotation.z = -swing * 0.46 * amp;
    this.arms.r.shoulder.rotation.z = swing * 0.46 * amp;
    this.arms.l.shoulder.rotation.x = -0.14;
    this.arms.r.shoulder.rotation.x = 0.14;
    this.arms.l.elbow.rotation.z = 0.30 + Math.max(0, -swing) * 0.25 * amp;
    this.arms.r.elbow.rotation.z = 0.30 + Math.max(0, swing) * 0.25 * amp;
    this.carryWeapon();

    this.pelvis.position.y = this.p.hipY - spread * this.H * 0.028 * amp;
  }

  /**
   * Sprint. Distinct from the walk rather than a louder version of it: deep
   * forward drive from the hips, head kept level, knees driving high in front
   * with the heel kicking up behind, and arms locked near 90 degrees pumping
   * against the legs.
   */
  poseSprint(f) {
    if (this.model && this.model.gait === 'strut') { this.poseStrutRun(f); return; }
    const ph = this.walkPhase;
    const swing = Math.sin(ph);
    const spread = 1 - Math.abs(Math.cos(ph));
    // A real sprinter leans ~17 degrees, but on a short, big-headed build that
    // reads as falling over, so it is pulled back to something legible.
    const lean = 0.2;

    // Negative leans the torso forward — see the note in poseWalk.
    this.pelvis.rotation.z = -lean;
    // Counter-rotate the head, but not all the way — the fighter should look
    // ahead down the track, not straight down at it.
    this.neck.rotation.z = lean * 0.6;

    this.legs.l.hip.rotation.z = swing * 1.06 + lean;
    this.legs.r.hip.rotation.z = -swing * 1.06 + lean;
    // A constant slight bend, plus a hard fold as the leg swings through.
    this.legs.l.knee.rotation.z = -(0.22 + Math.max(0, -Math.sin(ph + 0.5)) * 1.5);
    this.legs.r.knee.rotation.z = -(0.22 + Math.max(0, Math.sin(ph + 0.5)) * 1.5);

    this.arms.l.shoulder.rotation.z = -swing * 0.80 - 0.18;
    this.arms.r.shoulder.rotation.z = swing * 0.80 - 0.18;
    this.arms.l.shoulder.rotation.x = -0.10;
    this.arms.r.shoulder.rotation.x = 0.10;
    this.arms.l.elbow.rotation.z = 1.45;
    this.arms.r.elbow.rotation.z = 1.45;
    this.carryWeapon();

    this.pelvis.position.y = this.p.hipY - spread * this.H * 0.05;
  }

  /**
   * The Mega Knight's strut — his walk, and nothing like anyone else's.
   *
   * Three things carry it, and none of them is stride length:
   *
   * 1. **Both maces stay up in front.** They do not swing in opposition to the
   *    legs the way every other fighter's arms do. He carries them like a boxer
   *    holding a guard, and the only arm motion is a small alternating bob. A
   *    counter-swinging arm is the single strongest "walking" cue there is, so
   *    removing it is most of what makes this read as a swagger.
   *
   * 2. **He bounces on every step.** `Math.abs(Math.cos(ph))` peaks twice per
   *    cycle — once per footfall — which is the rhythm to hang the bob on. The
   *    default walk dips on the same beat but at a third of the amplitude,
   *    because for everyone else it is weight settling rather than a strut.
   *
   * 3. **The shoulders roll.** `chest.rotation.y` swings with the step, so his
   *    top half rotates around the axis of travel. Heavy characters read as
   *    heavy when their mass visibly moves side to side.
   */
  poseStrutWalk(f, amp) {
    const ph = this.walkPhase;
    const swing = Math.sin(ph);
    /** Peaks once per footfall — the beat the whole gait is built on. */
    const step = Math.abs(Math.cos(ph));
    const spread = 1 - step;

    // Upright, and rocked back a touch: he is not chasing anything.
    this.pelvis.rotation.z = 0.05;
    this.chest.rotation.z = -0.02;

    // Short, heavy stride. He is stocky, so a long one reads as marching.
    this.legs.l.hip.rotation.z = swing * 0.52 * amp;
    this.legs.r.hip.rotation.z = -swing * 0.52 * amp;
    this.legs.l.knee.rotation.z = -Math.max(0, -Math.sin(ph + 0.6)) * 1.05 * amp;
    this.legs.r.knee.rotation.z = -Math.max(0, Math.sin(ph + 0.6)) * 1.05 * amp;

    /**
     * The guard. 1.18 on the dial is forward and a shade below horizontal; the
     * folded elbow brings each mace up in front of his chest. The bob is tiny
     * and deliberately *in phase on both sides* — they rise and fall together
     * with the bounce rather than alternating, which is what stops it reading
     * as an arm swing.
     */
    const guard = 0.96 + step * 0.10 * amp;
    for (const side of ['l', 'r']) {
      const sign = side === 'r' ? 1 : -1;
      const arm = this.arms[side];
      arm.shoulder.rotation.z = guard;
      arm.shoulder.rotation.x = sign * (0.30 - step * 0.06);
      arm.shoulder.rotation.y = 0;
      arm.elbow.rotation.z = 0.94 - step * 0.10 * amp;
      arm.hand.rotation.z = 0;
    }

    // Shoulder roll, and the head counter-rolling a little so it stays level.
    this.chest.rotation.y = swing * 0.20 * amp;
    this.neck.rotation.z = 0.04 + step * 0.05 * amp;

    /**
     * The bounce. Up on the push-off, down as the legs spread for the next
     * footfall — and much deeper than the shared walk's 0.028, because on him
     * it is the point rather than a side effect.
     */
    this.pelvis.position.y = this.p.hipY + step * this.H * 0.030 * amp
      - spread * this.H * 0.038 * amp;
  }

  /**
   * The strut, at speed. **Distinct from the walk, not a louder copy of it.**
   *
   * The guard drops and opens out into a pump, the stride roughly doubles, he
   * leans into it, and the bounce turns into a genuine lope — he leaves the
   * ground fractionally on every stride, which the walk never does. The maces
   * still lead: even sprinting he keeps them in front of him rather than
   * driving them back past his hips.
   */
  poseStrutRun(f) {
    const ph = this.walkPhase;
    const swing = Math.sin(ph);
    const step = Math.abs(Math.cos(ph));
    const spread = 1 - step;

    // Committed forward, but nothing like a sprinter's pitch — he is a wall
    // moving, and a deep lean on this build reads as toppling.
    this.pelvis.rotation.z = -0.16;
    this.neck.rotation.z = 0.13;

    this.legs.l.hip.rotation.z = swing * 0.98 - 0.16;
    this.legs.r.hip.rotation.z = -swing * 0.98 - 0.16;
    this.legs.l.knee.rotation.z = -(0.30 + Math.max(0, -Math.sin(ph + 0.5)) * 1.55);
    this.legs.r.knee.rotation.z = -(0.30 + Math.max(0, Math.sin(ph + 0.5)) * 1.55);

    /**
     * The guard **stays in unison**, and only its amplitude separates the run
     * from the walk.
     *
     * An earlier version alternated the arms against each other, which is what
     * arms normally do at speed — and it was wrong for him. He holds both maces
     * out and heaves them together; alternating turned the strut back into an
     * ordinary run with the hands held high. So the motion is driven off `step`,
     * the footfall beat, exactly like the walk's, just deeper and lower.
     */
    const pump = 0.86 + step * 0.34;
    for (const side of ['l', 'r']) {
      const sign = side === 'r' ? 1 : -1;
      const arm = this.arms[side];
      arm.shoulder.rotation.z = pump;
      arm.shoulder.rotation.x = sign * (0.26 - step * 0.05);
      arm.shoulder.rotation.y = 0;
      arm.elbow.rotation.z = 1.06 - step * 0.24;
      arm.hand.rotation.z = 0;
    }

    this.chest.rotation.y = swing * 0.26;
    this.chest.rotation.z = -0.06;

    // A real lope: he rises clear on the drive and drops through the spread.
    this.pelvis.position.y = this.p.hipY + step * this.H * 0.045
      - spread * this.H * 0.055;
  }

  poseBrake(f) {
    this.pelvis.position.y = this.p.hipY - this.H * 0.06;
    this.chest.rotation.z = -0.30;
    this.legs.l.hip.rotation.z = 0.5;
    this.legs.r.hip.rotation.z = -0.35;
    this.legs.l.knee.rotation.z = -0.35;
    this.arms.l.shoulder.rotation.z = -0.7;
    this.arms.r.shoulder.rotation.z = -0.5;
    this.carryWeapon();
  }

  poseCrouch(amount) {
    this.pelvis.position.y = this.p.hipY - this.H * 0.24 * amount;
    this.legs.l.hip.rotation.z = 0.55 * amount;
    this.legs.r.hip.rotation.z = 0.55 * amount;
    this.legs.l.knee.rotation.z = -1.05 * amount;
    this.legs.r.knee.rotation.z = -1.05 * amount;
    this.chest.rotation.z = 0.30 * amount;
    this.arms.l.shoulder.rotation.z = -0.45 * amount;
    this.arms.r.shoulder.rotation.z = -0.45 * amount;
    this.arms.l.elbow.rotation.z = 0.7 * amount;
    this.arms.r.elbow.rotation.z = 0.7 * amount;
    this.carryWeapon();
  }

  poseAir(f) {
    /**
     * Spring-trap flight: a straight dive on the way up, front flips on the way
     * down.
     *
     * It is keyed on the sign of `vy` rather than on a frame count, so the
     * tumble starts at the **actual apex** whatever the charge threw him to —
     * a timer would start flipping early on a tap and late on a full wind.
     *
     * The flag is set at launch and cleared on landing, so this survives the Up
     * B action ending mid-flight and handing over to freefall.
     */
    if (f.custom && f.custom.springFlight) {
      this.poseSpringFlight(f);
      return;
    }
    const rising = clamp(-f.vy / 12, -1, 1);
    this.legs.l.hip.rotation.z = 0.30 + rising * 0.35;
    this.legs.r.hip.rotation.z = -0.20 - rising * 0.15;
    this.legs.l.knee.rotation.z = -0.75 - rising * 0.4;
    this.legs.r.knee.rotation.z = -0.35;
    this.arms.l.shoulder.rotation.z = -0.9 - rising * 0.5;
    this.arms.r.shoulder.rotation.z = -0.7 - rising * 0.4;
    this.arms.l.shoulder.rotation.x = -0.5;
    this.arms.r.shoulder.rotation.x = 0.5;
    this.arms.l.elbow.rotation.z = 0.5;
    this.arms.r.elbow.rotation.z = 0.5;
    this.chest.rotation.z = rising * 0.12;
    this.carryWeapon();

    if (f.state === S.HELPLESS) {
      // Limp, flailing — freefall must look like a punished state.
      const flail = Math.sin(this.bobPhase * 2.4) * 0.4;
      this.arms.l.shoulder.rotation.z = -1.6 + flail;
      this.arms.r.shoulder.rotation.z = -1.6 - flail;
      this.chest.rotation.z = -0.25;
    }
  }

  /**
   * Launched by the spring: a rigid dive up, then front flips down.
   *
   * The flip accumulates on its own counter rather than off a clock, because
   * how long he falls depends on where he was launched from — it has to keep
   * turning until he lands, however long that takes.
   */
  poseSpringFlight(f) {
    /**
     * The counter lives on the **fighter**, not the rig.
     *
     * It has to be zeroed at the launch, and the launch pose runs from the
     * render path — so a frame that is simulated but not drawn skips the reset
     * and the next flight inherits the last one's total. Measured that way it
     * reached 172 radians, twenty-seven flips he never did. Owned by the
     * simulation it cannot drift, because the same step that sets the flight
     * flag clears the count.
     */
    const falling = f.vy > 0;
    // Half the old rate: at 0.30 a flip took under a second of fall and read as
    // a blur rather than as tumbling.
    if (falling) f.custom.springSpin = (f.custom.springSpin || 0) + 0.13;

    // Forward flips: negative z pitches a body forward (positive leans it back).
    const spin = -f.facing * (f.custom.springSpin || 0);
    this.root.rotation.z = spin;
    const r = this.H * ROLL_PIVOT;
    const yaw = this.root.rotation.y;
    this.root.position.x += r * Math.sin(spin) * Math.cos(yaw);
    this.root.position.y += r * (1 - Math.cos(spin));
    this.root.position.z -= r * Math.sin(spin) * Math.sin(yaw);

    // Rising: speared straight, arms overhead, legs together. Falling: tucked,
    // which is both what a flip looks like and what keeps him compact.
    const tuck = falling ? Math.min(1, (f.custom.springSpin || 0) / 0.6) : 0;
    for (const leg of [this.legs.l, this.legs.r]) {
      leg.hip.rotation.z = lerp(0.02, 1.60, tuck);
      leg.knee.rotation.z = lerp(-0.05, -2.10, tuck);
    }
    this.legs.l.hip.rotation.x = 0.10;
    this.legs.r.hip.rotation.x = -0.10;
    const reach = lerp(2.95, 0.55, tuck);
    for (const arm of [this.arms.l, this.arms.r]) {
      arm.shoulder.rotation.z = reach;
      arm.elbow.rotation.z = lerp(0.08, 1.85, tuck);
      arm.hand.rotation.z = 0;
    }
    this.arms.r.shoulder.rotation.y = 0.16;
    this.arms.l.shoulder.rotation.y = -0.16;
    this.chest.rotation.z = lerp(-0.12, 0.30, tuck);
    this.neck.rotation.z = lerp(-0.18, 0.24, tuck);
    // Passed through, or the sword arm is put back at his hip — see the launch.
    this.carryWeapon(reach);
  }

  poseShield(f) {
    // Guard up in front of the body.
    this.poseCrouch(0.35);
    this.arms.l.shoulder.rotation.z = 0.85;
    this.arms.r.shoulder.rotation.z = 0.85;
    this.arms.l.shoulder.rotation.x = -0.45;
    this.arms.r.shoulder.rotation.x = 0.45;
    this.arms.l.elbow.rotation.z = 1.25;
    this.arms.r.elbow.rotation.z = 1.25;
    this.carryWeapon(0.15);
    this.chest.rotation.z = 0.18;
  }

  poseHitstun(f) {
    const dir = Math.sign(f.vx) || 1;
    const face = this.fighter.facing;
    // Arch away from the direction of travel.
    const away = -dir * face;
    this.chest.rotation.z = away * 0.5;
    this.pelvis.rotation.z = away * 0.25;
    this.arms.l.shoulder.rotation.z = away * 1.5 - 0.3;
    this.arms.r.shoulder.rotation.z = away * 1.5 - 0.3;
    this.arms.l.shoulder.rotation.x = -0.7;
    this.arms.r.shoulder.rotation.x = 0.7;
    this.legs.l.hip.rotation.z = away * 0.7;
    this.legs.r.hip.rotation.z = away * 0.4;
    this.legs.l.knee.rotation.z = -0.5;
    this.neck.rotation.z = away * 0.3;
  }

  poseDowned() {
    // Lie flat on the stage.
    this.root.rotation.z = Math.PI / 2;
    this.root.position.y += this.p.legT * 1.2;
    this.arms.l.shoulder.rotation.z = -1.2;
    this.arms.r.shoulder.rotation.z = -1.2;
    this.legs.l.hip.rotation.z = 0.2;
    this.legs.r.hip.rotation.z = -0.2;
  }

  poseDizzy() {
    const w = Math.sin(this.bobPhase * 1.7);
    this.chest.rotation.z = w * 0.28;
    this.neck.rotation.z = w * 0.4;
    this.neck.rotation.y = w * 0.5;
    this.arms.l.shoulder.rotation.z = -0.5 + w * 0.3;
    this.arms.r.shoulder.rotation.z = -0.5 - w * 0.3;
    this.pelvis.position.y = this.p.hipY - this.H * 0.05;
  }

  poseGrab() {
    // Reaching out in front, not behind. A fighter carrying a long weapon
    // grabs with the free hand and keeps the weapon out of the way.
    this.arms.l.shoulder.rotation.z = 1.45;
    this.arms.r.shoulder.rotation.z = 1.45;
    this.arms.l.elbow.rotation.z = -0.15;
    this.arms.r.elbow.rotation.z = -0.15;
    this.arms.l.shoulder.rotation.x = -0.25;
    this.arms.r.shoulder.rotation.x = 0.25;
    this.chest.rotation.z = 0.1;
    this.carryWeapon(0.0);
  }

  poseGrabbed() {
    const w = Math.sin(this.bobPhase * 3) * 0.25;
    this.chest.rotation.z = -0.3 + w;
    this.arms.l.shoulder.rotation.z = -2.2 + w;
    this.arms.r.shoulder.rotation.z = -2.2 - w;
    this.legs.l.hip.rotation.z = 0.4 + w;
    this.legs.r.hip.rotation.z = -0.3 - w;
  }

  poseLedge(f) {
    // Hanging faces the stage, so the arms reach up over the lip in front.
    this.arms.l.shoulder.rotation.z = 2.7;
    this.arms.r.shoulder.rotation.z = 2.7;
    this.arms.l.shoulder.rotation.x = -0.2;
    this.arms.r.shoulder.rotation.x = 0.2;
    this.arms.l.elbow.rotation.z = 0.5;
    this.arms.r.elbow.rotation.z = 0.5;
    this.legs.l.hip.rotation.z = 0.25;
    this.legs.r.hip.rotation.z = -0.15;
    this.legs.l.knee.rotation.z = -0.5;
    this.chest.rotation.z = -0.1;
  }

  /**
   * Victory ceremony posing.
   *
   * Driven by the sequence rather than by simulation state: `t` runs 0..1
   * through the current shot, and `clock` is a free-running seconds counter for
   * the poses that loop. Each pose ends by settling the weapon, so the Wizard's
   * staff stays upright and the Bandit's bat stays out of the floor.
   *
   * @param {{pose:string, t:number, clock:number}} cer
   */
  poseCeremony(cer) {
    const t = clamp(cer.t, 0, 1);
    const clock = cer.clock;

    switch (cer.pose) {
      // Both arms punched overhead, weight coming up onto the front foot.
      case 'raise': {
        const bounce = t >= 1 ? Math.abs(Math.sin(clock * 7)) * 2 : 0;
        this.arms.r.shoulder.rotation.z = lerp(0.55, 2.95, t);
        this.arms.l.shoulder.rotation.z = lerp(0.35, 2.70, t);
        this.arms.r.elbow.rotation.z = lerp(-1.0, -0.10, t);
        this.arms.l.elbow.rotation.z = lerp(-0.9, -0.20, t);
        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.r.shoulder.rotation.x = 0.30;
        this.chest.rotation.z = lerp(0.22, -0.24, t);
        this.neck.rotation.z = lerp(0.1, -0.28, t);
        this.legs.l.hip.rotation.z = lerp(0.1, 0.30, t);
        this.legs.r.hip.rotation.z = lerp(-0.1, -0.26, t);
        this.legs.r.knee.rotation.z = -0.25 * (1 - t);
        this.pelvis.position.y = this.p.hipY + lerp(-this.H * 0.06, this.H * 0.02, t) + bounce;
        break;
      }

      // A full turn that decelerates into the camera, arms flung wide.
      case 'spin': {
        this.root.rotation.y += Math.PI * 2 * t;
        const open = Math.sin(Math.PI * t);   // widest mid-turn, closed at both ends
        this.arms.l.shoulder.rotation.x = -1.35 * open - 0.2;
        this.arms.r.shoulder.rotation.x = 1.35 * open + 0.2;
        this.arms.l.shoulder.rotation.z = lerp(0.3, 1.1, open);
        this.arms.r.shoulder.rotation.z = lerp(0.4, 1.5, open);
        this.arms.r.elbow.rotation.z = -0.3 * (1 - open);
        this.chest.rotation.z = -0.12;
        this.legs.l.hip.rotation.z = 0.28 * open;
        this.legs.r.hip.rotation.z = -0.22 * open;
        this.legs.l.knee.rotation.z = -0.3 * open;
        this.pelvis.position.y = this.p.hipY + open * this.H * 0.03;
        break;
      }

      // Weapon shouldered, free hand levelled at the camera.
      case 'point': {
        const settle = Math.sin(clock * 3) * 0.03;
        this.arms.l.shoulder.rotation.z = lerp(0.2, 1.52, t) + settle;
        this.arms.l.elbow.rotation.z = lerp(0.9, 0.05, t);
        this.arms.l.shoulder.rotation.x = -0.42;
        this.arms.r.shoulder.rotation.x = 0.18;
        this.chest.rotation.z = 0.16;
        this.neck.rotation.z = -0.12;
        this.legs.l.hip.rotation.z = 0.26;
        this.legs.r.hip.rotation.z = -0.22;
        this.legs.r.knee.rotation.z = -0.18;
        this.pelvis.position.y = this.p.hipY - this.H * 0.02;
        break;
      }

      // The held celebration the results panel sits over: a two-beat bounce.
      case 'cheer': {
        const beat = Math.sin(clock * 4.4);
        const up = Math.max(0, beat);
        this.arms.r.shoulder.rotation.z = 2.55 + up * 0.35;
        this.arms.l.shoulder.rotation.z = 2.30 + up * 0.30;
        this.arms.r.elbow.rotation.z = -0.15;
        this.arms.l.elbow.rotation.z = -0.25;
        this.arms.l.shoulder.rotation.x = -0.34;
        this.arms.r.shoulder.rotation.x = 0.34;
        this.chest.rotation.z = -0.14 - up * 0.06;
        this.neck.rotation.z = -0.18;
        this.neck.rotation.y = Math.sin(clock * 2.2) * 0.12;
        this.legs.l.hip.rotation.z = 0.20;
        this.legs.r.hip.rotation.z = -0.18;
        this.legs.l.knee.rotation.z = -0.30 * (1 - up);
        this.legs.r.knee.rotation.z = -0.30 * (1 - up);
        this.pelvis.position.y = this.p.hipY + up * this.H * 0.05 - this.H * 0.02;
        break;
      }

      // Defeat: spine folded, head down, and a slow breath rather than a bob.
      case 'sad':
      default: {
        const breath = Math.sin(clock * 1.5);
        this.chest.rotation.z = 0.42 + breath * 0.03;
        this.neck.rotation.z = 0.46;
        this.neck.rotation.y = Math.sin(clock * 0.55) * 0.16;
        this.arms.l.shoulder.rotation.z = 0.30 + breath * 0.02;
        this.arms.r.shoulder.rotation.z = 0.26;
        this.arms.l.elbow.rotation.z = 0.55;
        this.arms.l.shoulder.rotation.x = -0.10;
        this.arms.r.shoulder.rotation.x = 0.10;
        this.legs.l.hip.rotation.z = 0.12;
        this.legs.r.hip.rotation.z = -0.10;
        this.legs.l.knee.rotation.z = -0.22;
        this.legs.r.knee.rotation.z = -0.16;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 + breath * 0.6;
        break;
      }
    }

    // The overhead poses are holding the weapon up on purpose, so they only
    // need the staff's correction (it stands out of the fist the other way);
    // everything else rests the weapon as usual.
    const overhead = cer.pose === 'raise' || cer.pose === 'cheer';
    if (!overhead || this.weaponKind === 'staff') this.carryWeapon();
  }

  /**
   * Attack posing.
   *
   * Rather than authoring an animation per move, the pose is derived from the
   * move's own frame data: the windup runs up to the first active hitbox, the
   * strike snaps on it, and the recovery eases out over the remaining frames.
   * The shape of the pose is chosen from the move's id, which is enough to
   * read what an attack is doing in a prototype.
   */
  poseAction(f) {
    const move = f.move;
    if (!move) { this.poseIdle(); return; }

    const total = Math.max(1, move.total);
    const hb = move.hitboxes && move.hitboxes.length ? move.hitboxes[0].frames : null;
    const strikeAt = hb ? hb[0] : Math.round(total * 0.4);
    const strikeEnd = hb ? hb[1] : Math.round(total * 0.55);

    const frame = f.moveFrame;
    let phase;      // -1 = full windup, 0 = strike, 1 = fully recovered
    if (frame < strikeAt) phase = -1 + (frame / Math.max(1, strikeAt));
    else if (frame <= strikeEnd) phase = 0;
    else phase = (frame - strikeEnd) / Math.max(1, total - strikeEnd);

    const k = this.kindOf(move);
    const strike = phase >= 0 ? 1 - Math.min(1, phase) : 1 + phase; // 0..1 peaking at the hit

    /**
     * 0 at the first frame, 1 on the **last active frame of the whole move**.
     *
     * `phase` is anchored to the first hitbox, so on a move whose hitboxes
     * chase each other around an arc it has already flipped to "recovering"
     * while later boxes are still live — the up tilt's second box is behind
     * her, and on `phase` timing the bat only reaches vertical by then. This
     * lets a travelling swing finish its journey while it can still hit.
     */
    let lastActive = strikeEnd;
    if (move.hitboxes) for (const h of move.hitboxes) lastActive = Math.max(lastActive, h.frames[1]);
    const sweep = clamp(frame / Math.max(1, lastActive), 0, 1);

    /**
     * Charging a smash holds the windup and shakes with the charge level.
     *
     * It holds the pose at the point the move has *actually* reached, rather
     * than at a hard-coded start. A smash charges partway into its windup — the
     * forward smash freezes on frame 7 of an 11-frame startup — so pinning the
     * pose to frame zero left the bat somewhere the swing had already moved
     * past, and release snapped it through a third of the arc in a single
     * frame. On a swing centred on its own midpoint that snap crossed the
     * contact point, which is why she wound up one way and hit the other.
     */
    if (f.charging) {
      const shake = Math.sin(this.bobPhase * 6) * 0.05 * Math.min(1, f.chargeFrames / 40);
      this.applyAttackShape(k, strike, phase, sweep);
      this.chest.rotation.z += shake;
      this.pelvis.position.y = this.p.hipY - this.H * 0.06;
      return;
    }

    this.applyAttackShape(k, strike, phase, sweep);
  }

  /**
   * Categorises a move into a pose family.
   *
   * A move can name its own family with `pose`, which is how a fighter asks for
   * a specific animation — the id and kind heuristics below are only the
   * fallback for moves that have not been authored one.
   */
  kindOf(move) {
    if (move.pose) return move.pose;
    const id = move.id;
    // A getup or ledge option that swings should read as a swing, not a tumble.
    const armed = move.hitboxes && move.hitboxes.length;
    if (armed && move.kind === 'getup') return 'low';
    if (armed && move.kind === 'ledge') return 'forward';
    if (move.kind === 'roll' || move.kind === 'tech' || move.kind === 'getup') return 'roll';
    if (move.kind === 'dodge') return 'dodge';
    if (move.kind === 'airdodge') return 'airdodge';
    if (move.kind === 'throw') return 'throw';
    if (move.kind === 'grab' || move.kind === 'pummel') return 'grab';
    if (move.kind === 'ledge') return 'ledge';
    if (/usmash|utilt|uair|Wings|heroWings/i.test(id)) return 'up';
    if (/dair/i.test(id)) return 'down';
    if (/dsmash|dtilt/i.test(id)) return 'low';
    if (/bair/i.test(id)) return 'back';
    if (/nair/i.test(id)) return 'spin';
    if (/dash|Dash/i.test(id)) return 'lunge';
    if (move.kind === 'special') return 'cast';
    return 'forward';
  }

  poseWindupShape(move, phase) {
    this.applyAttackShape(this.kindOf(move), 0, phase);
  }

  /**
   * @param {string} kind pose family
   * @param {number} strike 0..1, peaks on the active frames
   * @param {number} phase -1 windup .. 0 strike .. 1 recovered
   */
  /**
   * Attack posing.
   *
   * Sign convention, which is easy to invert by accident: limbs hang along -y
   * from their joint and a **positive** z rotation swings one toward +x, which
   * is the way the model faces. So a forward strike ends positive and a windup
   * starts negative.
   *
   * **The elbow only bends one way, and that way is positive.** Measured on a
   * hanging arm: `+1.4` puts the hand 28 in front of the elbow, `-1.4` puts it
   * 28 behind — and a forearm does not go behind the upper arm. Because the
   * rotation is relative to the upper arm the world direction flips as the
   * shoulder swings (overhead, positive folds the hand behind the head, which is
   * still the correct way), but the *sign* never does.
   *
   * The one deliberate exception is the Bandit's weapon arm: a bat cocked back
   * over the shoulder is a hyperextension you would not do bare-handed, and it
   * reads as a windup rather than as a broken joint. Every empty-handed pose —
   * all of the Wizard's — must stay positive.
   *
   * The weapon is held in the right hand, so the right arm leads every swing.
   */
  applyAttackShape(kind, strike, phase, sweep = 0) {
    const s = strike;
    const windup = phase < 0 ? -phase : 0;
    /**
     * A one-way sweep: 0 at the start of the windup, 0.5 on the hit, 1 fully
     * recovered. `strike` peaks on the hit and falls back the way it came,
     * which is right for a thrust but wrong for a swing — a bat that retraces
     * its own arc looks like it is being un-swung. Anything that travels
     * through the target uses this instead.
     *
     * Shoulder z is an angle around the body: 0 hangs down, ~1.57 points
     * forward, ~3.14 straight up, and past that it carries on over and behind.
     * Sweeps are written as a lerp along that dial, which is why some of them
     * run past pi.
     *
     * Contact happens at t = 0.5, so a sweep's **midpoint** has to be the
     * contact pose — set the endpoints for where the swing starts and finishes
     * and the hit lands halfway through, still on the way out.
     */
    const t = (phase + 1) * 0.5;
    /** Snap out by contact and stay there, for a limb that jabs rather than swings. */
    const snap = Math.min(1, t * 2);

    /**
     * Which arm the weapon is in, and the mirror that follows from it.
     *
     * A pose that swings a weapon has to name an arm, and naming `arms.l`
     * directly hard-codes the fighter's handedness into the animation. These
     * three let a pose be written once and work either way:
     *
     * - `wArm` is the arm holding the weapon, `oArm` the other one.
     * - `mir` is +1 when the weapon is in the **left** hand — the configuration
     *   the Goblin's `dag*` poses were originally authored against — and -1
     *   when it moves to the right.
     *
     * Every term that places an arm *in depth* is multiplied by `mir`:
     * `shoulder.rotation.x`, `shoulder.rotation.y` and `chest.rotation.y`. Those
     * are the three dials whose sign says which side of the body a limb sits on,
     * so flipping them mirrors the pose across the fighter's centre line while
     * the swing itself — which lives on `shoulder.rotation.z` — is untouched.
     * Nothing else needs to change: a z-swing, a lean and a leg are all
     * handedness-neutral.
     */
    const wSide = this.weaponSide || 'r';
    const wArm = this.arms[wSide];
    const oArm = this.arms[wSide === 'r' ? 'l' : 'r'];
    const mir = wSide === 'r' ? -1 : 1;

    switch (kind) {
      /**
       * Horizontal swings — jab 1, jab 2 and the forward tilt.
       *
       * The trick is `shoulder.rotation.x`. Holding it near a right angle lays
       * the arm into the *horizontal* plane, and from there the z rotation
       * stops being an up-and-down arc and becomes a sweep around the body:
       * `z = 1.57` points straight down the fighter's facing, below that swings
       * behind, above that carries on across the front. Driving z with x left
       * near zero is what produced the overhead chops.
       *
       * The torso turns with it. Shoulders hang off the chest, so a chest y
       * rotation carries the whole arm round and the swing reads as thrown from
       * the hips rather than flapped from the shoulder.
       */
      case 'swingAcross':
      case 'swingBack':
      case 'swipe': {
        const back = kind === 'swingBack';
        // How far either side of straight-ahead the swing travels. The big
        // one is the forward tilt; the jabs are compact.
        const arc = kind === 'swipe' ? 1.30 : 1.05;
        const dir = back ? -1 : 1;
        const from = HALF_PI - arc * dir;
        const to = HALF_PI + arc * dir;

        this.arms.r.shoulder.rotation.x = kind === 'swipe' ? 1.42 : 1.32;
        this.arms.r.shoulder.rotation.z = lerp(from, to, t);
        this.arms.r.elbow.rotation.z = lerp(-1.25, -0.04, snap);
        this.arms.r.hand.rotation.z = 0;

        this.chest.rotation.y = lerp(-0.5 * dir, 0.5 * dir, t);
        this.chest.rotation.z = lerp(-0.16 * dir, 0.18 * dir, t);
        this.pelvis.rotation.y = lerp(-0.22 * dir, 0.24 * dir, t);

        // Off arm counter-swings, which is what keeps her balanced over the hit.
        this.arms.l.shoulder.rotation.x = -0.55 * dir;
        this.arms.l.shoulder.rotation.z = lerp(0.55 * dir, -0.55 * dir, t);
        this.arms.l.elbow.rotation.z = -0.65;

        if (kind === 'swipe') {
          // Steps into it, which is what sells the reach.
          this.legs.l.hip.rotation.z = lerp(-0.25, 0.55, t);
          this.legs.r.hip.rotation.z = lerp(0.25, -0.35, t);
          this.legs.l.knee.rotation.z = lerp(-0.45, -0.08, t);
          this.pelvis.position.y = this.p.hipY - this.H * 0.06 * s;
        } else {
          this.legs.l.hip.rotation.z = lerp(-0.10 * dir, 0.26 * dir, t);
          this.legs.r.hip.rotation.z = lerp(0.14 * dir, -0.18 * dir, t);
          this.legs.l.knee.rotation.z = -0.18;
        }
        break;
      }
      // Up tilt: anti-air. Starts out in front, goes up over the head and
      // finishes behind, so it covers both sides on the way through.
      case 'arcOver': {
        // Timed on `sweep`, not `t`: the travel has to be finished by the last
        // active frame, because the late hitbox is the one behind her head.
        const a = sweep;

        /**
         * Pivot to face the camera for the swing.
         *
         * The arc travels front to back, which is the one direction a side-on
         * camera cannot show — seen from the side it is mostly foreshortening,
         * and the bat appears to shrink and grow rather than travel. Turning her
         * square to the camera puts the whole arc in the screen plane.
         *
         * Purely presentational: hitboxes are built in sim space from the
         * fighter's facing and never look at the rig, so she still hits exactly
         * where the frame data says.
         */
        const turn = Math.min(1, a * 3) * (1 - Math.max(0, phase));
        const turnRad = FACE_CAMERA_TURN * ARC_FACING * turn;
        this.root.rotation.y += -this.fighter.facing * turnRad;

        /**
         * Swept on shoulder **z**, which carries the arm through her sagittal
         * plane — the front-up-back one. On that dial 1.57 points straight
         * ahead and 3.14 straight up, so the arc starts out in front of her,
         * passes overhead and finishes behind, and at no point is the arm
         * anywhere near her torso.
         *
         * Sweeping on x instead moves it through the *frontal* plane, and that
         * plane runs straight through her body: half of every rotation is spent
         * inside her, which is exactly what it looked like.
         *
         * Her body turns square to the camera, but the swing must not turn with
         * it — a sagittal arc rotated to face the viewer points its travel
         * straight down the lens and foreshortens to nothing. Cancelling the
         * body's yaw at the shoulder holds the arc in the screen plane while
         * she turns underneath it, so the player gets the front-on pose *and*
         * the full sweep.
         *
         * The cancellation carries a `facing` term because the root turn does:
         * she pivots toward the lens from either side, which is opposite
         * directions in her own frame.
         */
        this.arms.r.shoulder.rotation.y = this.fighter.facing * turnRad;
        this.arms.r.shoulder.rotation.z = lerp(1.05, 4.05, a);
        // Held a little off her flank so the bat clears her shoulder on the way
        // past, without leaving the plane of the swing.
        this.arms.r.shoulder.rotation.x = 0.20;
        // Straight the whole way through. A bat on a bent arm has no reach and
        // reads as a flail rather than a swing.
        this.arms.r.elbow.rotation.z = lerp(-0.40, -0.02, Math.min(1, a * 2));
        this.arms.r.hand.rotation.z = 0;

        // Torso takes the opposite sign to a limb: positive leans back.
        this.chest.rotation.z = lerp(0.14, -0.12, a);
        this.arms.l.shoulder.rotation.x = -0.25;
        this.arms.l.shoulder.rotation.z = lerp(0.30, -0.30, a);
        this.arms.l.elbow.rotation.z = -0.7;
        this.legs.l.hip.rotation.z = lerp(0.12, -0.16, a);
        this.legs.r.hip.rotation.z = lerp(-0.10, 0.14, a);
        this.legs.l.knee.rotation.z = -0.20;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 * windup;
        break;
      }
      /**
       * Wizard jab 1 and 2 — straight punches, alternating hands.
       *
       * A punch is not a swing. It drives out along the facing and comes
       * straight back, so it runs on `snap` (out by contact, held) rather than
       * on `t`, and the shoulder stays near the horizontal plane with almost no
       * arc: `x` at a right angle lays the arm forward, and the extension is all
       * in the elbow. Swinging it on z instead gives a hook, which is what jab 3
       * is for.
       *
       * `poseJab` picks the hand: jab 1 leads with the left, jab 2 answers with
       * the right, so the two read as a one-two rather than the same arm twice.
       */
      case 'punchL':
      case 'punchR': {
        const right = kind === 'punchR';
        const lead = right ? this.arms.r : this.arms.l;
        const off = right ? this.arms.l : this.arms.r;
        // Reaches full extension exactly on the hit, then retracts — the fist
        // must not hang in the air through the recovery. The startup is only
        // four frames, so anything faster than this has the arm already out on
        // frame one and there is no punch to see.
        const drive = phase < 0 ? Math.min(1, (phase + 1) * 1.15) : 1 - Math.max(0, phase) * 0.88;
        const side = right ? 1 : -1;

        /**
         * A punch drives along the facing and stays there — it is not a swing,
         * so `x` is left alone. Laying the arm into the horizontal plane the way
         * the sweeps do sends the fist out sideways in depth instead of forward.
         *
         * `y` is the small correction that brings the fist onto the centre line,
         * because the shoulders sit either side of the body in depth. Measured
         * on the rig: **+y pulls the right arm inward and −y the left**, so the
         * correction is `+0.3 * side`. The opposite sign spreads the fist a
         * shoulder-width wide of the target, which is what it was doing.
         */
        lead.shoulder.rotation.x = 0;
        lead.shoulder.rotation.y = 0.18 * side;
        lead.shoulder.rotation.z = lerp(1.02, 1.60, drive);
        lead.elbow.rotation.z = lerp(1.55, 0.05, drive);
        lead.hand.rotation.z = 0;

        // The off hand stays up as a guard and pulls back as the lead goes out —
        // the counter-rotation is what makes the punch look driven from the hip.
        off.shoulder.rotation.x = 0;
        off.shoulder.rotation.y = -0.20 * side;
        off.shoulder.rotation.z = lerp(1.20, 0.70, drive);
        off.elbow.rotation.z = lerp(1.15, 1.70, drive);

        /**
         * Hips and shoulders rotate into the punch, opposite ways for each hand.
         *
         * Also measured: a **positive** chest yaw drives the right shoulder
         * forward and a negative one the left, and it is worth real reach — the
         * fist travels 44 forward with the turn against 38 without it. So the
         * windup turns away and the strike turns into it.
         */
        this.chest.rotation.y = lerp(-0.30 * side, 0.35 * side, drive);
        this.pelvis.rotation.y = lerp(-0.14 * side, 0.18 * side, drive);
        this.chest.rotation.z = lerp(0.10, -0.10, drive);

        this.legs.l.hip.rotation.z = lerp(-0.16, 0.24, drive);
        this.legs.r.hip.rotation.z = lerp(0.20, -0.14, drive);
        this.legs.l.knee.rotation.z = -0.22;
        this.legs.r.knee.rotation.z = -0.30;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05;
        break;
      }
      /**
       * Wizard jab 3 — a rising fire uppercut.
       *
       * The finisher, so it travels: the fist starts low by the hip and comes up
       * through the front, and the whole body rises with it. Swept on shoulder
       * **z** through the sagittal plane, same dial as `arcOver` — 1.57 points
       * ahead, 3.14 is straight up — so the punch climbs in front of him rather
       * than across his chest.
       *
       * On `sweep` rather than `t` because the rise has to still be going while
       * the hitbox is live; a `t`-timed uppercut has already peaked and started
       * back down by contact.
       */
      case 'uppercut': {
        const a = sweep;
        const rise = a * a * (3 - 2 * a);          // ease in, so the launch snaps

        this.arms.r.shoulder.rotation.x = 0.16;
        this.arms.r.shoulder.rotation.z = lerp(0.55, 3.05, rise);
        this.arms.r.elbow.rotation.z = lerp(1.30, 0.18, Math.min(1, a * 1.8));
        this.arms.r.hand.rotation.z = 0;

        // Off arm drops and opens as the lead climbs — a counterweight.
        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.shoulder.rotation.z = lerp(1.15, -0.45, rise);
        this.arms.l.elbow.rotation.z = lerp(1.30, 0.55, rise);

        // Torso opens up and back with the punch. Positive leans back, which is
        // what an uppercut wants — the chest follows the fist upward.
        this.chest.rotation.z = lerp(0.22, -0.26, rise);
        this.chest.rotation.y = lerp(0.30, -0.16, rise);
        this.pelvis.rotation.y = lerp(0.14, -0.10, rise);

        // Drives up off a bent front leg: sinks into the windup, extends through.
        // The knees fold deeply on the sink so the drop at the pelvis comes out
        // of the legs rather than pushing the feet through the stage.
        this.legs.l.hip.rotation.z = lerp(0.48, -0.12, rise);
        this.legs.r.hip.rotation.z = lerp(-0.30, 0.22, rise);
        this.legs.l.knee.rotation.z = lerp(-1.30, -0.10, rise);
        this.legs.r.knee.rotation.z = lerp(-1.05, -0.22, rise);
        this.pelvis.position.y = this.p.hipY
          - this.H * 0.18 * (1 - rise) + this.H * 0.10 * rise;
        break;
      }
      /**
       * Wizard forward tilt — a horizontal side kick.
       *
       * The leg goes out sideways along the facing and stays in the horizontal
       * plane, so it uses the same trick the arm swings do: hold `hip.rotation.x`
       * near a right angle to lay the leg flat, then drive `z` for the extension.
       * Driving z alone from a hanging leg gives a front kick, which is not what
       * a side kick looks like from a side-on camera.
       *
       * Snapped, not swept — a kick fires out, holds through the active frames
       * and pulls back; it does not travel through the target.
       */
      case 'sideKick': {
        // Reaches full extension on the hit rather than four frames early. At
        // 2.3 the whole kick was over by frame 4 and the chamber and the
        // extension happened on top of each other, which is what made the foot
        // climb as it travelled instead of driving straight out.
        const kick = phase < 0 ? Math.min(1, (phase + 1) * 1.05) : 1 - Math.max(0, phase) * 0.90;

        /**
         * Chamber first, then extend — that is what makes it a *side kick*
         * rather than a swing.
         *
         * The knee comes up to its final height over the first third, and only
         * then does the shin fire out. Ramping the hip and the knee together
         * instead sweeps the whole leg up from the floor in one arc, so the foot
         * climbs while it travels and the kick reads as going up and down.
         * Splitting them holds the foot at a constant height and drives it
         * straight out.
         */
        const chamber = Math.min(1, kick / 0.42);
        const extend = clamp((kick - 0.40) / 0.60, 0, 1);
        this.legs.l.hip.rotation.x = 0.25 * chamber;
        // Barely any backswing: the knee comes straight up from a near-neutral
        // stance. Starting the thigh behind him turned the chamber into a
        // wind-up and the whole thing back into a swing.
        // The thigh eases back down as the shin fires. Extending a shin about a
        // knee held at a fixed height traces an arc and the foot climbs; letting
        // the hip give a little as it goes cancels most of that and keeps the
        // strike travelling flat.
        this.legs.l.hip.rotation.z = lerp(0.10, 1.68, chamber) - 0.34 * extend;
        /**
         * The knee folds *tighter* as the thigh lifts, then fires.
         *
         * Holding a constant fold through the chamber lets the foot ride
         * forward with the advancing knee, so by the time the extension starts
         * the leg is already halfway out and the whole thing reads as one
         * diagonal swing. Pulling the heel in to the buttock keeps the foot
         * under him until the shin actually snaps out.
         */
        this.legs.l.knee.rotation.z = lerp(lerp(-1.20, -2.45, chamber), -0.06, extend);

        /**
         * Standing leg braces and the body leans away to counterweight the kick.
         *
         * The knee has to bend *more* than it looks like it should. A near
         * straight leg is 46 long against a 46 hip height, so any sink at the
         * pelvis drives the foot straight through the floor — measured at 6
         * below it. Bending shortens the leg enough to absorb the sink.
         */
        this.legs.r.hip.rotation.z = lerp(0.20, -0.26, kick);
        this.legs.r.knee.rotation.z = lerp(-0.30, -0.62, kick);
        this.chest.rotation.z = lerp(0.10, 0.40, kick);   // positive leans back
        this.chest.rotation.y = lerp(0.10, 0.34, kick);   // opens the hip through

        // Arms swing open for balance, the way a real side kick throws them.
        this.arms.l.shoulder.rotation.x = -0.35;
        this.arms.l.shoulder.rotation.z = lerp(-0.30, -1.10, kick);
        this.arms.l.elbow.rotation.z = 0.55;
        this.arms.r.shoulder.rotation.x = 0.30;
        this.arms.r.shoulder.rotation.z = lerp(-0.40, 0.85, kick);
        this.arms.r.elbow.rotation.z = 0.80;

        this.pelvis.position.y = this.p.hipY - this.H * 0.04 * kick;
        break;
      }
      /**
       * Wizard up tilt — a two-armed fire arc overhead.
       *
       * He turns square to the camera first, for the same reason the Bandit's up
       * tilt does: an arc drawn front-to-back is the one thing a side-on camera
       * cannot show. Here the arc is drawn *laterally* instead — both arms start
       * together above his head and sweep down and apart into a T — so the turn
       * puts that spread across the screen rather than into it.
       *
       * The arms are mirrored on `z`, which is what makes it one continuous arc
       * over his head instead of two independent swings, and they finish level
       * with the shoulders: arms straight out, palms open, the shape the fire
       * trail is left hanging in.
       */
      case 'fireArc': {
        const a = sweep;
        const spread = a * a * (3 - 2 * a);

        const turn = Math.min(1, a * 3.5) * (1 - Math.max(0, phase) * 0.5);
        const turnRad = FACE_CAMERA_TURN * ARC_FACING * turn;
        this.root.rotation.y += -this.fighter.facing * turnRad;

        /**
         * Cancelling the body's yaw at each shoulder holds the arc in the screen
         * plane while he turns underneath it — without it the spread rotates
         * away from the lens and flattens. The cancellation carries a `facing`
         * term because the root turn does.
         *
         * It is **mirrored between the two arms**, which a one-armed swing like
         * `arcOver` does not have to worry about. Applying the same correction
         * to both tips the whole T nine units out of level, because the two
         * shoulders meet the body's yaw from opposite sides. Mirrored, the hands
         * come out dead level with the spread unchanged.
         */
        const yawFix = this.fighter.facing * turnRad;
        this.arms.r.shoulder.rotation.y = yawFix;
        this.arms.l.shoulder.rotation.y = -yawFix;

        // Starts above: hands almost touching over the crown, elbows soft.
        this.arms.r.shoulder.rotation.x = lerp(0.10, HALF_PI * 0.98, spread);
        this.arms.l.shoulder.rotation.x = lerp(-0.10, -HALF_PI * 0.98, spread);
        this.arms.r.shoulder.rotation.z = lerp(3.02, 3.06, spread);
        this.arms.l.shoulder.rotation.z = lerp(3.02, 3.06, spread);
        // Arms straighten as they open — the T-pose finish wants them locked.
        this.arms.r.elbow.rotation.z = lerp(0.85, 0.03, spread);
        this.arms.l.elbow.rotation.z = lerp(0.85, 0.03, spread);
        this.arms.r.hand.rotation.z = 0;
        this.arms.l.hand.rotation.z = 0;

        /**
         * Sinks into the windup and rises onto the balls of the feet as the arc
         * opens. The knees have to fold *hard* on the sink: a leg is 46 long
         * against a 46 hip height, so a 14 drop at the pelvis on near-straight
         * legs put both feet 14 through the floor.
         */
        this.chest.rotation.z = lerp(0.16, -0.10, spread);
        this.legs.l.hip.rotation.z = lerp(0.22, -0.06, spread);
        this.legs.r.hip.rotation.z = lerp(-0.22, 0.06, spread);
        this.legs.l.knee.rotation.z = lerp(-0.85, -0.12, spread);
        this.legs.r.knee.rotation.z = lerp(-0.85, -0.12, spread);
        this.pelvis.position.y = this.p.hipY
          - this.H * 0.06 * (1 - spread) + this.H * 0.04 * spread;
        break;
      }
      /**
       * Wizard down tilt — a low spinning legsweep.
       *
       * Crouched right down with both hands planted on the floor, then a full
       * 360 with one leg extended. The spin is a whole-body yaw on the root, and
       * it has to be a **full** turn: stopping short leaves him facing the wrong
       * way at the end of a move that is supposed to return him to neutral.
       *
       * Driven on `sweep` so the leg is still travelling while the hitbox is
       * live, and the spin is deliberately not eased at the end — a legsweep
       * carries through and settles, it does not brake into position.
       */
      case 'legSweep': {
        const a = sweep;
        // Full revolution, eased in so the plant reads before he goes round.
        const spin = Math.min(1, a * 1.05);
        const turn = spin * spin * (3 - 2 * spin);
        this.root.rotation.y += -this.fighter.facing * Math.PI * 2 * turn;

        /**
         * Down on his hands, low enough that the sweep passes under a jab.
         *
         * Every number below was solved against the rig rather than guessed,
         * because a crouch this deep puts the whole body within a few units of
         * the floor and there is no margin: at the first attempt the pivot foot
         * sat 19 *under* the stage and the hands never got closer than 20 above
         * it, which is not a fighter on his hands, it is a fighter hovering.
         */
        this.pelvis.position.y = this.p.hipY - this.H * 0.26;
        // Measured, against an earlier comment here that claimed the opposite:
        // a positive chest z leans the torso **back**. He is low because of the
        // pelvis drop above, not because of this.
        this.chest.rotation.z = 0.52;

        // Both hands planted on the floor in front of him — hand height 3, which
        // is as close to the deck as the arm chain reaches from this crouch.
        const plant = Math.min(1, a * 2);
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(0.45, 0.02, plant);
          arm.elbow.rotation.z = lerp(0.95, 0.25, plant);
          arm.hand.rotation.z = 0;
        }
        // Spread shoulder-width in depth so they read as two planted hands
        // rather than one: negative x throws the right arm out, positive the left.
        this.arms.l.shoulder.rotation.x = 0.30;
        this.arms.r.shoulder.rotation.x = -0.30;

        // The sweeping leg: out flat and low, held out through the whole spin.
        // Starts tucked under him like the pivot leg and only then extends. Left
        // hanging at a half-fold through the windup it trailed 21 below the
        // stage, which is the deepest anything in the game reaches.
        const out = Math.min(1, a * 2.6);
        this.legs.l.hip.rotation.x = 0.62 * out;
        this.legs.l.hip.rotation.z = lerp(1.05, 1.52, out);
        this.legs.l.knee.rotation.z = lerp(-2.10, -0.05, out);
        // The other folds up tight underneath as the pivot — hip 1.3 against a
        // knee at -2.3 is what lands that foot on the floor instead of below it.
        this.legs.r.hip.rotation.z = 1.30;
        this.legs.r.knee.rotation.z = -2.30;
        break;
      }
      /**
       * Wizard neutral B — the fireball throw.
       *
       * All of the character is in the weight transfer. He winds up rocked right
       * back over his rear leg with both arms folded in to his chest, then drives
       * everything forward and finishes with both arms locked out. The release
       * lands on the way through, not at the end, so the ball leaves his hands
       * while the body is still travelling.
       *
       * Timed on `t`, which puts contact at the midpoint — the same reason the
       * bat swings use it. On `strike` he would throw the ball and then pull it
       * back, which is exactly what an un-thrown throw looks like.
       */
      case 'castHeave': {
        // Ease the drive so the windup hangs and the release snaps.
        const drive = t * t * (3 - 2 * t);

        for (const arm of [this.arms.l, this.arms.r]) {
          // Folded in tight at the chest, then punched out level and locked.
          arm.shoulder.rotation.x = 0;
          arm.shoulder.rotation.z = lerp(0.55, 1.62, drive);
          arm.elbow.rotation.z = lerp(2.05, 0.04, drive);
          arm.hand.rotation.z = 0;
        }
        // Hands converge on the ball rather than travelling parallel: the
        // shoulders sit a body-width apart in depth, and without this it reads
        // as two arms pushing air instead of one throw.
        this.arms.r.shoulder.rotation.y = 0.26;
        this.arms.l.shoulder.rotation.y = -0.26;

        /**
         * The lean, and it is the whole move.
         *
         * Torso takes the opposite sign to a limb — positive leans *back* — so
         * the windup is positive and the follow-through negative. Both ends are
         * pushed hard on purpose: he coils almost onto his back heel and then
         * throws his whole upper body through the release, which is what the
         * Clash art does and what makes a slow projectile look heavy rather
         * than politely handed over.
         *
         * Split between pelvis and chest so the bend accumulates down the spine
         * instead of the torso pivoting as one board.
         */
        this.pelvis.rotation.z = lerp(0.52, -0.40, drive);
        this.chest.rotation.z = lerp(0.66, -0.62, drive);
        this.neck.rotation.z = lerp(-0.38, 0.26, drive);   // head stays on target

        // Weight moves off the back foot and onto the front through the throw.
        // A lean this deep needs the stance to travel with it or he tips over.
        this.legs.l.hip.rotation.z = lerp(-0.62, 0.86, drive);
        this.legs.r.hip.rotation.z = lerp(0.70, -0.44, drive);
        this.legs.l.knee.rotation.z = lerp(-0.26, -0.70, drive);
        this.legs.r.knee.rotation.z = lerp(-1.05, -0.20, drive);
        this.pelvis.position.y = this.p.hipY - this.H * (0.13 - drive * 0.05);
        break;
      }
      /**
       * Wizard side B — conjuring the fire tornado.
       *
       * Both arms rise slowly and evenly from his sides to overhead, and the
       * slowness is the point: the move costs 4 Elixir and has a long startup,
       * so the animation has to show him *working* for it rather than sitting in
       * a hold. Driven on `sweep` so the raise is still finishing as the tornado
       * spawns, and eased at both ends so it starts and stops smoothly.
       *
       * Deliberately not turned to face the camera. The Bandit's up tilt turns
       * because its arc travels front-to-back and would foreshorten to nothing;
       * this one travels straight up, which a side-on camera already shows in
       * full, and turning him would only cost the silhouette.
       */
      case 'summon': {
        const raise = sweep * sweep * (3 - 2 * sweep);
        const tremble = Math.sin(sweep * 34) * 0.02 * raise;

        for (const arm of [this.arms.l, this.arms.r]) {
          // Hanging at his sides up to nearly straight overhead.
          arm.shoulder.rotation.x = 0;
          arm.shoulder.rotation.z = lerp(0.30, 2.95, raise) + tremble;
          arm.elbow.rotation.z = lerp(0.55, 0.10, raise);
          arm.hand.rotation.z = 0;
        }
        // Held slightly apart so the hands frame the space they are filling.
        this.arms.r.shoulder.rotation.y = -0.16 * raise;
        this.arms.l.shoulder.rotation.y = 0.16 * raise;

        // Opens up and rises with the arms.
        this.chest.rotation.z = lerp(0.14, -0.16, raise);
        this.neck.rotation.z = lerp(0, -0.20, raise);      // watches his hands
        this.legs.l.hip.rotation.z = lerp(0.20, -0.04, raise);
        this.legs.r.hip.rotation.z = lerp(-0.20, 0.04, raise);
        this.legs.l.knee.rotation.z = lerp(-0.70, -0.14, raise);
        this.legs.r.knee.rotation.z = lerp(-0.70, -0.14, raise);
        this.pelvis.position.y = this.p.hipY - this.H * 0.07 * (1 - raise);
        break;
      }
      /**
       * Wizard up B — carried by the wings.
       *
       * Held for as long as the player has flaps left, so unlike every other
       * attack pose this one has to survive being looked at for a few seconds.
       * That rules out anything that reads as a single frozen action: he hangs
       * with his arms swept back and his legs trailing, which is a posture
       * rather than a gesture.
       *
       * `strike` peaks on the lift and falls away, so it doubles as the surge:
       * he tucks on the beat and stretches out again as he coasts.
       */
      case 'soar': {
        const surge = s;

        // Arms swept back and out of the way of the wings.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(-0.55, -0.95, surge);
          arm.elbow.rotation.z = lerp(0.45, 0.85, surge);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.x = -0.42;
        this.arms.l.shoulder.rotation.x = 0.42;

        // Chest opens on the beat — positive is a backward lean, and rising
        // under a pair of wings is exactly that.
        this.chest.rotation.z = lerp(-0.10, 0.26, surge);
        this.neck.rotation.z = -0.14;

        // Legs trail, tucking slightly on each stroke.
        this.legs.l.hip.rotation.z = lerp(-0.30, -0.05, surge);
        this.legs.r.hip.rotation.z = lerp(-0.16, 0.14, surge);
        this.legs.l.knee.rotation.z = lerp(-0.45, -0.95, surge);
        this.legs.r.knee.rotation.z = lerp(-0.30, -0.70, surge);
        this.pelvis.position.y = this.p.hipY + this.H * 0.02 * surge;
        break;
      }
      /**
       * Wizard neutral air — a cannonball tuck inside a ring of fire.
       *
       * Knees to the chest, arms wrapped round the shins, head tucked down. It
       * is the fastest thing he has, so the tuck **snaps** rather than eases:
       * the shape is the hitbox and it needs to be there on frame one of the
       * active window, not easing toward it.
       */
      case 'cannonball': {
        const tuck = phase < 0 ? Math.min(1, (phase + 1) * 2.6) : 1 - Math.max(0, phase) * 0.85;

        // Knees up and in. Hip forward, knee folded hard back under him.
        for (const leg of [this.legs.l, this.legs.r]) {
          leg.hip.rotation.z = lerp(0.20, 1.75, tuck);
          leg.knee.rotation.z = lerp(-0.45, -2.35, tuck);
        }
        // A little offset so the legs read as two, not one block.
        this.legs.l.hip.rotation.x = 0.16 * tuck;
        this.legs.r.hip.rotation.x = -0.16 * tuck;

        /**
         * Arms wrapped round the shins.
         *
         * The shoulder stays almost **hanging** — the reach comes from the
         * elbow, which folds the forearm forward to hip height where the tucked
         * knees are. Swinging the shoulder forward as well lifts the whole arm
         * and the hands end up level with his face, hugging nothing.
         */
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(0.30, 0.38, tuck);
          arm.elbow.rotation.z = lerp(0.40, 2.00, tuck);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.34 * tuck;   // hands meet in front
        this.arms.l.shoulder.rotation.y = -0.34 * tuck;

        // Curled over: negative leans the torso forward, negative on the neck
        // drops the chin onto the chest.
        this.chest.rotation.z = lerp(0, -0.62, tuck);
        this.neck.rotation.z = lerp(0, -0.70, tuck);
        this.pelvis.position.y = this.p.hipY + this.H * 0.06 * tuck;
        break;
      }
      /**
       * Wizard forward air — a fire punch swung from overhead down past his
       * waist, the Mario-fair arc.
       *
       * Shoulder z is the dial that does it: 3.14 is straight up, 1.57 points
       * ahead, 0 hangs down, so a single lerp from just under pi down to near
       * zero carries the fist over the top, out through the front and down
       * below his belt without ever passing through his body.
       *
       * The arm stays **folded** through the travel and only extends in the last
       * few frames, which is what makes it read as a hammer blow rather than a
       * windmill — the reach arrives with the impact.
       */
      case 'firePunch': {
        const a = sweep;
        const arc = a * a * (3 - 2 * a);
        // Snaps open over the back third of the swing.
        const extend = clamp((a - 0.62) / 0.30, 0, 1);

        this.arms.r.shoulder.rotation.x = 0.10;
        this.arms.r.shoulder.rotation.y = 0.22;
        // Stops just forward of straight down rather than at it. The torso is
        // folding forward at the same time, and that carries the shoulder back
        // with it — ending the dial at 0.32 put the fist 9 units *behind* him on
        // the last active frame, which is the wrong side for a forward air.
        this.arms.r.shoulder.rotation.z = lerp(3.00, 0.62, arc);
        this.arms.r.elbow.rotation.z = lerp(1.85, 0.06, extend);
        this.arms.r.hand.rotation.z = 0;

        // Off arm counterweights across the body.
        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.shoulder.rotation.z = lerp(0.70, 1.35, arc);
        this.arms.l.elbow.rotation.z = lerp(1.30, 1.75, arc);

        // Torso whips over with it: leans back to load, folds forward through.
        this.chest.rotation.z = lerp(0.34, -0.40, arc);
        this.neck.rotation.z = lerp(0.20, -0.28, arc);
        this.pelvis.rotation.z = lerp(0.16, -0.18, arc);

        // Legs trail and tuck as he throws his weight down.
        this.legs.l.hip.rotation.z = lerp(-0.20, 0.42, arc);
        this.legs.r.hip.rotation.z = lerp(0.24, -0.16, arc);
        this.legs.l.knee.rotation.z = lerp(-0.40, -0.95, arc);
        this.legs.r.knee.rotation.z = -0.55;
        break;
      }
      /**
       * Wizard up air — three fireballs straight up, alternating hands.
       *
       * The shot index comes off `sweep`, so the arms swap in step with the
       * three hitboxes rather than on a timer of their own. Whichever arm is
       * firing punches straight up; the other is held folded across the chest,
       * which is what makes the alternation legible at speed — without the
       * across-body guard the two arms just look like they are both waving.
       */
      case 'fireVolley': {
        const a = sweep;
        const shot = Math.min(2, Math.floor(a * 3));
        // 0..1 within the current shot: the arm punches up and recoils.
        const beat = (a * 3) - shot;
        const thrust = Math.sin(clamp(beat, 0, 1) * Math.PI);
        // Left leads, then right, then left again.
        const up = shot === 1 ? this.arms.r : this.arms.l;
        const across = shot === 1 ? this.arms.l : this.arms.r;
        const side = shot === 1 ? 1 : -1;

        up.shoulder.rotation.x = 0;
        up.shoulder.rotation.y = 0.16 * side;
        up.shoulder.rotation.z = lerp(2.55, 3.10, thrust);
        up.elbow.rotation.z = lerp(0.85, 0.08, thrust);
        up.hand.rotation.z = 0;

        // Folded flat across the chest — shoulder forward, elbow closed right up.
        across.shoulder.rotation.x = -0.55 * side;
        across.shoulder.rotation.y = -0.30 * side;
        across.shoulder.rotation.z = 1.45;
        across.elbow.rotation.z = 2.05;
        across.hand.rotation.z = 0;

        // Watching his own shots: positive tips the head back.
        this.neck.rotation.z = 0.42;
        this.chest.rotation.z = 0.20 + thrust * 0.10;
        this.chest.rotation.y = 0.26 * side;

        // Legs hang and swing a little with each recoil.
        this.legs.l.hip.rotation.z = -0.22 + thrust * 0.14;
        this.legs.r.hip.rotation.z = -0.05 - thrust * 0.12;
        this.legs.l.knee.rotation.z = -0.70;
        this.legs.r.knee.rotation.z = -0.40;
        break;
      }
      /**
       * Wizard down air — a two-footed stomp.
       *
       * He turns square to the camera to wind it up, coils, then drives both
       * legs straight down. The turn is what makes the coil readable: seen from
       * the side a fighter pulling his knees up and stamping is mostly hidden
       * behind his own thigh, and front-on it is unmistakable.
       *
       * Snapped rather than swept — a stomp fires and holds. Easing it through
       * contact would read as sinking rather than stamping.
       */
      case 'stomp': {
        /**
         * He holds a full **cannonball** — the same ball as the neutral air —
         * and then kicks out of it. The extension is deliberately late and
         * sharp rather than a steady unfold: the whole read of a stomp is the
         * snap, so he stays balled through most of the startup and the legs
         * fire over the last few frames.
         */
        const w = clamp(phase + 1, 0, 1);              // 0..1 across the startup
        const drop = phase < 0 ? clamp((w - 0.62) / 0.38, 0, 1) : 1 - Math.max(0, phase) * 0.7;
        const coil = 1 - drop;

        const turn = Math.min(1, sweep * 3) * (1 - Math.max(0, phase) * 0.6);
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * 0.92 * turn;

        // Knees right up to the chest, then both legs snap straight down.
        for (const leg of [this.legs.l, this.legs.r]) {
          leg.hip.rotation.z = lerp(0.02, 1.78, coil);
          leg.knee.rotation.z = lerp(-0.04, -2.35, coil);
        }
        this.legs.l.hip.rotation.x = 0.16;
        this.legs.r.hip.rotation.x = -0.16;

        /**
         * Arms wrapped round the shins in the ball, thrown up and open on the
         * drive. As in the cannonball the shoulder stays low and the elbow does
         * the work — a raised shoulder lifts the hands to his face and he stops
         * reading as tucked.
         */
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(2.45, 0.40, coil);
          arm.elbow.rotation.z = lerp(0.25, 2.00, coil);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.34 * coil;
        this.arms.l.shoulder.rotation.y = -0.34 * coil;
        this.arms.r.shoulder.rotation.x = -0.55 * drop;
        this.arms.l.shoulder.rotation.x = 0.55 * drop;

        // Curled in the ball, opening out as he stamps.
        this.chest.rotation.z = lerp(-0.14, -0.55, coil);
        this.neck.rotation.z = lerp(-0.25, -0.62, coil);
        this.pelvis.position.y = this.p.hipY + this.H * 0.10 * coil;
        break;
      }
      /**
       * Wizard back air — a spinning kick through the midsection.
       *
       * A full revolution on the root, with the kicking leg out at waist height
       * as he passes through the back. Timed on `sweep` so the leg is still
       * travelling while the hitbox is live, and the spin runs the whole way
       * round: stopping at the kick would leave him facing backwards at the end
       * of a move that has to return him to neutral.
       */
      case 'spinKick': {
        const a = sweep;
        const spin = a * a * (3 - 2 * a);
        this.root.rotation.y += -this.fighter.facing * Math.PI * 2 * spin;

        // Out fast, held through the contact window, pulled in at the end.
        const out = phase < 0 ? Math.min(1, (phase + 1) * 2.2) : 1 - Math.max(0, phase) * 0.8;

        /**
         * The kick goes **behind** him, so the hip runs negative — that is the
         * side of the dial where the leg trails. Held near horizontal so it
         * lands at the opponent's middle rather than at their shins.
         */
        this.legs.r.hip.rotation.z = lerp(-0.30, -1.62, out);
        this.legs.r.knee.rotation.z = lerp(-1.35, -0.10, out);
        this.legs.r.hip.rotation.x = -0.18 * out;

        // The other leg tucks under to keep the silhouette compact through the
        // spin, which is what stops it reading as a stumble.
        this.legs.l.hip.rotation.z = lerp(0.20, 0.85, out);
        this.legs.l.knee.rotation.z = lerp(-0.55, -1.70, out);

        // Arms pull in tight — a spin is faster with the mass close.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(0.45, 1.05, out);
          arm.elbow.rotation.z = lerp(0.90, 1.85, out);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.x = -0.45;
        this.arms.l.shoulder.rotation.x = 0.45;

        this.chest.rotation.z = lerp(0.10, 0.30, out);
        this.pelvis.position.y = this.p.hipY + this.H * 0.04 * out;
        break;
      }
      /**
       * Wizard forward smash — a two-handed fire push.
       *
       * Not a punch: both palms chamber back at his hip while it charges and
       * then drive out together, arms locking straight at full extension. The
       * hands travel as a pair on the centre line, which is what separates a
       * push from a jab thrown with both arms.
       *
       * The charge pose is the chamber, and `applyAttackShape` holds whatever
       * pose the move has actually reached while charging, so the hands sit
       * loaded at the hip for as long as the player holds it.
       */
      case 'fireHeave': {
        const drive = phase < 0 ? Math.min(1, (phase + 1) * 1.1) : 1 - Math.max(0, phase) * 0.55;

        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.x = 0;
          // Chambered low at the hip, driving out level with his chest. The
          // torso folds forward through the push and takes the shoulders down
          // with it, so the arm has to finish *above* horizontal to land level.
          arm.shoulder.rotation.z = lerp(0.42, 1.92, drive);
          arm.elbow.rotation.z = lerp(2.35, 0.06, drive);
          arm.hand.rotation.z = 0;
        }
        // Both hands converge on the centre line — inward is +y on the right
        // and -y on the left. Without this they push a shoulder-width apart.
        this.arms.r.shoulder.rotation.y = 0.42;
        this.arms.l.shoulder.rotation.y = -0.18;

        // Loads backward, then throws everything forward through the push.
        this.pelvis.rotation.z = lerp(0.30, -0.26, drive);
        this.chest.rotation.z = lerp(0.26, -0.22, drive);
        this.neck.rotation.z = lerp(0.10, -0.12, drive);

        // Braced back leg, front leg stepping into it.
        this.legs.l.hip.rotation.z = lerp(-0.34, 0.62, drive);
        this.legs.l.knee.rotation.z = lerp(-0.30, -0.22, drive);
        this.legs.r.hip.rotation.z = lerp(0.30, -0.42, drive);
        this.legs.r.knee.rotation.z = lerp(-0.55, -0.30, drive);
        this.pelvis.position.y = this.p.hipY - this.H * 0.09 + this.H * 0.03 * drive;
        break;
      }
      /**
       * Wizard up smash — a grounded backflip kick.
       *
       * Same pivot mechanism as the Bandit's back-flipping up air: rotating the
       * root alone spins him about his feet and drives his head through the
       * floor, so the body is also translated by `(p - R·p)` to put the pivot at
       * hip height instead.
       *
       * The kick leg leads the rotation rather than riding it. That is what
       * makes the arc sweep from in front of him, up over his head and away
       * behind — the hitbox covers all three and the leg has to actually be
       * there for each.
       */
      case 'flipKick': {
        const a = sweep;
        /**
         * The flip is held back until nearly half the sweep has gone.
         *
         * It has to be, because the hitboxes are placed where the *foot* is and
         * the foot is carried by the rotation. Starting the flip early put the
         * kick overhead by frame 10, four frames before the first box went live,
         * and the boxes then covered an arc the leg had already left. This puts
         * the overhead point in the middle of the active window instead.
         */
        const flip = clamp((a - 0.42) / 0.58, 0, 1);
        const spin = this.fighter.facing * flip * flip * (3 - 2 * flip) * Math.PI * 2;
        this.root.rotation.z = spin;
        const r = this.H * ROLL_PIVOT;
        const yaw = this.root.rotation.y;
        this.root.position.x += r * Math.sin(spin) * Math.cos(yaw);
        this.root.position.y += r * (1 - Math.cos(spin));
        this.root.position.z -= r * Math.sin(spin) * Math.sin(yaw);

        /**
         * He has to actually leave the ground.
         *
         * The pivot correction alone rotates him about his hip, which is right
         * for the Bandit's version because hers happens in mid-air. Grounded,
         * turning upside down about a point 50 units up puts his head *on the
         * floor* at the halfway mark, and it reads as falling over rather than
         * flipping. A parabolic hop peaking with the inversion lifts him clear.
         * Presentation only — the simulation still has him standing.
         */
        this.root.position.y += Math.sin(flip * Math.PI) * this.H * 0.42;

        // Load into a crouch, then the kicking leg whips up through the front.
        const load = clamp(a / 0.35, 0, 1);
        const kick = clamp((a - 0.34) / 0.40, 0, 1);
        this.legs.r.hip.rotation.z = lerp(lerp(0.55, -0.35, load), 1.72, kick);
        this.legs.r.knee.rotation.z = lerp(lerp(-1.05, -1.30, load), -0.08, kick);
        // Trailing leg stays tucked so the kicking one reads on its own.
        this.legs.l.hip.rotation.z = lerp(lerp(0.55, 0.10, load), 0.70, kick);
        this.legs.l.knee.rotation.z = lerp(-1.05, -1.35, kick);

        // Arms thrown down and back for the launch, the way a real flip does it.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(lerp(0.30, -0.55, load), -0.95, kick);
          arm.elbow.rotation.z = lerp(0.60, 0.30, kick);
          arm.hand.rotation.z = 0;
        }
        this.chest.rotation.z = lerp(lerp(0.10, 0.34, load), -0.22, kick);
        this.pelvis.position.y = this.p.hipY - this.H * 0.16 * load * (1 - kick);
        break;
      }
      /**
       * Wizard down smash — both hands driven into the floor.
       *
       * Turned square to the camera, because the move is symmetric: it detonates
       * on both sides at once and side-on you would only ever see one of them.
       *
       * The hands have to actually reach the deck. As with the legsweep, a
       * crouch this deep leaves only a few units of margin, so the arm chain is
       * aimed at a measured hand height rather than at a plausible-looking angle.
       */
      case 'groundPound': {
        const slam = phase < 0 ? Math.min(1, (phase + 1) * 1.12) : 1 - Math.max(0, phase) * 0.75;

        const turn = Math.min(1, sweep * 3) * (1 - Math.max(0, phase) * 0.5);
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * 0.95 * turn;

        // Overhead on the charge, planted on the floor on the strike.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(2.95, 0.02, slam);
          arm.elbow.rotation.z = lerp(0.55, 0.26, slam);
          arm.hand.rotation.z = 0;
        }
        // Spread shoulder-width so they land as two fists, not one.
        this.arms.l.shoulder.rotation.x = 0.32;
        this.arms.r.shoulder.rotation.x = -0.32;

        // Drops into a deep crouch as the hands come down. Knees fold hard so
        // the sink comes out of the legs instead of the feet leaving the stage.
        // The knee fold has to outrun the pelvis drop or the feet go through the
        // stage: a leg is 46 long against a 46 hip height, and a 30 sink on
        // knees at -1.35 put both feet 21 under it.
        this.legs.l.hip.rotation.z = lerp(0.20, 0.62, slam);
        this.legs.r.hip.rotation.z = lerp(0.20, 0.62, slam);
        this.legs.l.knee.rotation.z = lerp(-0.55, -1.72, slam);
        this.legs.r.knee.rotation.z = lerp(-0.55, -1.72, slam);
        this.legs.l.hip.rotation.x = 0.22;
        this.legs.r.hip.rotation.x = -0.22;

        this.chest.rotation.z = lerp(0.20, -0.50, slam);
        this.neck.rotation.z = lerp(0.16, -0.34, slam);
        this.pelvis.position.y = this.p.hipY - this.H * 0.25 * slam;
        break;
      }
      /**
       * Wizard dash attack — a horizontal dive that finishes in a roll.
       *
       * Three beats on one dial. He pitches forward to horizontal over the
       * startup, flies flat with both arms speared out in front through the
       * active frames — which is where the hitbox is — and then carries the
       * rotation the rest of the way round into a forward roll and back to his
       * feet.
       *
       * The rotation runs **negative**: positive z on the root tips a body
       * backward (it is what the backflip uses), so a forward dive is the other
       * way round the dial.
       */
      case 'diveRoll': {
        // 0 standing, 1 flat, then round to a full turn during recovery. The
        // roll finishes at 80% of the recovery and holds upright, so he is back
        // on his feet before he can act rather than exactly as the move ends.
        const rec = Math.max(0, phase);
        const out = phase < 0 ? (phase + 1) : 1;
        const turnT = Math.min(1, out * 0.25 + Math.min(1, rec / 0.8) * 0.75);
        /**
         * **No `facing` term.** Facing is a half turn of the whole root, not a
         * reflection, so a body-space z rotation already produces the same
         * pitch relative to the character whichever way he is pointing.
         * Multiplying by facing inverts one side: measured, he dived forward
         * going right and backwards-and-upside-down going left, with his feet
         * ending at height 94 instead of 6.
         */
        const spin = -turnT * Math.PI * 2;
        this.root.rotation.z = spin;
        const r = this.H * ROLL_PIVOT;
        const yaw = this.root.rotation.y;
        this.root.position.x += r * Math.sin(spin) * Math.cos(yaw);
        this.root.position.y += r * (1 - Math.cos(spin));
        this.root.position.z -= r * Math.sin(spin) * Math.sin(yaw);

        /**
         * The limb angles have to be **compensated for the body's own pitch**.
         *
         * Shoulder z is measured in body space, so once he has rotated a quarter
         * turn forward, "point the arms ahead" points them at the floor — which
         * is exactly what it did, leaving the hands at height 4 while the hitbox
         * sat at 40. Subtracting the spin holds the arms pointing forward *in
         * the world* however far round the body has gone.
         */
        const spear = phase < 0 ? Math.min(1, (phase + 1) * 1.6) : 1 - Math.min(1, rec * 2.2);
        // Body-space correction against a body-space rotation, so no facing term
        // here either.
        const fix = -spin;
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.x = 0;
          arm.shoulder.rotation.z = lerp(0.40, 1.66 + fix, spear);
          arm.elbow.rotation.z = lerp(1.40, 0.05, spear);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.26 * spear;
        this.arms.l.shoulder.rotation.y = -0.26 * spear;

        // Legs trail out behind him in world terms, so they take the same
        // correction, then tuck for the roll.
        const tuck = Math.min(1, rec * 2.4);
        this.legs.l.hip.rotation.z = lerp(lerp(0.30, -0.34 + fix, spear), 1.55, tuck);
        this.legs.r.hip.rotation.z = lerp(lerp(0.10, -0.22 + fix, spear), 1.35, tuck);
        this.legs.l.knee.rotation.z = lerp(-0.20, -1.90, tuck);
        this.legs.r.knee.rotation.z = lerp(-0.35, -2.05, tuck);

        this.chest.rotation.z = lerp(-0.20, 0.30, tuck);
        this.neck.rotation.z = lerp(-0.24, 0.20, tuck);
        break;
      }
      /**
       * Barbarian Barrel — he leaps into a barrel and rolls through you.
       *
       * Two full turns, which is `4π` and not `2π`: the brief asks for two
       * rotations and a single one at this speed reads as a stumble rather than
       * as a barrel rolling.
       *
       * Negative, like the dash-attack dive — positive z on the root tips a body
       * *backward*, so a forward roll runs the other way round the dial.
       *
       * He is tucked inside the whole time. The tuck is not decoration: at this
       * radius a straight leg comes clean through the staves, and the barrel is
       * meant to be the silhouette.
       */
      /**
       * Up B — the spring trap.
       *
       * It sits under him **fully compressed** for the whole charge, which is
       * the read the player needs: the longer it stays squashed the further it
       * throws. It fires open over three frames at the launch and he leaves in
       * a straight dive; the tumble is handled in `poseAir` once he is off it.
       */
      case 'springLaunch': {
        /**
         * Timed off the **move frame against the launch frame**, not off
         * `phase`.
         *
         * `phase` centres on a move's first hitbox, and this one has none — it
         * falls back to the middle of the move, which is frame 24 of 44 while
         * the spring actually fires on 12. The pose was still crouched a dozen
         * frames after he had left the ground. `costFrame` is the same constant
         * the launch uses, so reading it keeps the two in step by construction.
         */
        const fire = this.fighter.move.costFrame || 12;
        const fired = clamp((this.fighter.moveFrame - fire) / 4, 0, 1);


        /**
         * He **rides the plank**, so the plank is always exactly at his feet.
         *
         * Extending the coil in place drove the board up through his shins and
         * out of his chest. Instead the whole fighter is lifted by the coil's
         * height and the spring is pushed down by the same amount, which leaves
         * it standing on the floor with the board under his soles at every
         * point of the extension.
         */
        if (this.spring) {
          /**
           * Handed over to the projectile the moment it has finished opening.
           *
           * This one is parented to the fighter, so leaving it up means it rides
           * into the sky on his feet while the real one falls — two springs, one
           * of them airborne. It only exists to play the extension.
           */
          this.spring.visible = this.fighter.moveFrame <= fire + 2;
          // Never fully flat: some gold has to show or it reads as a bare plank.
          const open = 0.22 + fired * 0.78;
          this.setSpringCompression(open);
          const lift = this.springPlank.position.y;
          this.spring.position.set(0, -lift, 0);
          this.root.position.y += lift;
        }

        // Crouched right down on the plank, then thrown straight.
        const crouch = 1 - fired;
        this.pelvis.position.y = this.p.hipY - this.H * 0.20 * crouch + this.H * 0.05 * fired;
        for (const leg of [this.legs.l, this.legs.r]) {
          leg.hip.rotation.z = lerp(0.10, 0.72, crouch);
          leg.knee.rotation.z = lerp(-0.08, -1.45, crouch);
        }
        /**
         * Both arms are overhead the instant it fires, not eased up over the
         * extension — he is being thrown, and the throw reads from the arms
         * before it reads from anything else.
         */
        const reach = Math.min(1, fired * 3);
        const raised = lerp(0.85, 3.00, reach);
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = raised;
          arm.elbow.rotation.z = lerp(1.30, 0.08, reach);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.16 * reach;
        this.arms.l.shoulder.rotation.y = -0.16 * reach;
        this.chest.rotation.z = lerp(0.34, -0.10, reach);
        this.neck.rotation.z = lerp(0.20, -0.14, reach);
        // The angle has to be handed to `carryWeapon`, not set before it: for a
        // sword it *overwrites* the weapon shoulder, so a bare call drops the
        // right arm back to his hip and only one goes up.
        this.carryWeapon(raised);
        break;
      }
      /**
       * Side B — hoisting the Battle Ram and charging with it.
       *
       * Two beats on one clock: he heaves it up over the startup, then runs.
       * `sweep` is no use here because the move is 150 frames of held charge
       * with the hitbox live for nearly all of it, so the hoist is timed off
       * the move frame against the launch frame the data already declares.
       */
      /**
       * Side B, cancelled — he dumps the Battle Ram and is winded by it.
       *
       * Its own pose rather than the sword chop the end lag used to borrow: he
       * has just thrown a siege weapon on the floor, and a tidy overhead swing
       * reads as a completely different move. Two beats — the throw down, then
       * the recovery, hands toward his knees.
       */
      /**
       * Barbarian jab — a one-two-three of horizontal sword swings.
       *
       * Each one starts where the last finished, which is what makes the string
       * read as one motion rather than three separate attacks: swing one runs
       * from behind him across the front, two comes back the other way, three
       * goes out again and follows through further.
       *
       * Laid into the **horizontal plane** by holding `shoulder.rotation.x` near
       * a right angle, so `z` sweeps *around* his body instead of chopping over
       * it. Driving z from a hanging arm gives an overhead swing every time.
       */
      case 'swordJab1':
      case 'swordJab2':
      case 'swordJab3': {
        const step = kind === 'swordJab1' ? 0 : kind === 'swordJab2' ? 1 : 2;
        const back = step === 1;               // the middle one cuts back up
        const dir = back ? -1 : 1;

        /**
         * **Diagonal cuts in the screen plane**, not sweeps around his waist.
         *
         * Laying the arm flat with a big `shoulder.rotation.x` is right for a
         * bat, which is swung round the body like a club. A sword is cut along
         * its own edge, and flattened out that way it reads as a helicopter
         * blade — which is what looked so wrong. Keeping `x` near zero holds the
         * swing in the plane the camera is looking at, so the blade travels as a
         * line rather than a disc.
         *
         * One down, one back up, one down harder — each starting where the last
         * finished, which is what ties the three into a single motion.
         */
        const CUT = [[2.55, 1.42], [1.35, 2.48], [2.60, 1.10]][step];
        this.arms.r.shoulder.rotation.x = 0.10;
        this.arms.r.shoulder.rotation.z = lerp(CUT[0], CUT[1], t);
        // Drawn in tight before each cut, opening only through the hit. Starting
        // near straight put him at full reach on frame one with no wind-up.
        this.arms.r.elbow.rotation.z = lerp(2.20, 0.15, snap);
        this.arms.r.hand.rotation.z = 0;

        // A little shoulder turn so it comes off the body, but nothing like the
        // full hip rotation a round-the-waist swing needs.
        this.chest.rotation.y = lerp(-0.26 * dir, 0.26 * dir, t);
        this.pelvis.rotation.y = lerp(-0.12 * dir, 0.14 * dir, t);
        this.chest.rotation.z = lerp(0.10, -0.12, t);

        // Off arm counter-swings for balance.
        this.arms.l.shoulder.rotation.x = -0.50 * dir;
        this.arms.l.shoulder.rotation.z = lerp(0.50 * dir, -0.50 * dir, t);
        this.arms.l.elbow.rotation.z = 0.70;

        this.legs.l.hip.rotation.z = lerp(-0.12 * dir, 0.28 * dir, t);
        this.legs.r.hip.rotation.z = lerp(0.16 * dir, -0.20 * dir, t);
        this.legs.l.knee.rotation.z = -0.20;
        this.legs.r.knee.rotation.z = -0.24;
        this.pelvis.position.y = this.p.hipY - this.H * 0.04;
        break;
      }
      /**
       * Barbarian forward tilt — the big overhead chop, his signature swing.
       *
       * Loads with the arm up and the **blade hanging down behind him**, which
       * is the elbow folded right back rather than the shoulder taken further
       * round: at this length the sword is most of the silhouette, and folding
       * it behind his head is what makes the wind-up read.
       *
       * Then it comes over. He leans into it — the torso pitches forward through
       * contact rather than staying upright, because the weight of the swing is
       * the whole point of the move.
       */
      case 'swordChop': {
        /**
         * The load is **held**, not swung through. Easing straight from the
         * wind-up meant the blade was already halfway over by the time anyone
         * could see it, and the pose the move is named for lasted one frame.
         */
        const a = sweep;
        const s = clamp((a - 0.28) / 0.72, 0, 1);
        const swing = s * s * (3 - 2 * s);

        // Arm straight up, blade folded down behind him — the fold is what puts
        // the point at his back rather than at the sky.
        this.arms.r.shoulder.rotation.x = 0.12;
        /**
         * Finishes **level**, with a few degrees of lift.
         *
         * On the shoulder dial 1.57 points straight along the facing, so ending
         * just above it leaves the blade parallel to the ground rather than
         * angled into it. That end angle is the whole constraint on this swing:
         * the sword adds another fifty units past the fist, so anything lower
         * drives the point at the stage — at 1.32 it was still nosing down, and
         * further round than that put it thirty-two units under the floor.
         */
        /**
         * The end angle has to **pay for the torso lean**.
         *
         * Shoulder z is measured against the chest, and the chest is a child of
         * the pelvis — so the forward pitch of both is subtracted from whatever
         * the arm is set to. Ending at 1.66 looks level on paper and lands at
         * 1.24 in the world, a good 19 degrees into the floor, which is exactly
         * where the point kept finishing. 1.57 for horizontal, plus the 0.42 the
         * torso takes away, plus a few degrees of lift.
         */
        this.arms.r.shoulder.rotation.z = lerp(3.15, 2.22, swing);
        this.arms.r.elbow.rotation.z = lerp(2.55, 0.08, Math.min(1, swing * 1.4));
        this.arms.r.hand.rotation.z = 0;

        // Leans back to load, then throws his weight through it. Negative
        // pitches the torso forward — it stacks up from the pelvis.
        this.pelvis.rotation.z = lerp(0.26, -0.34, swing);
        this.chest.rotation.z = lerp(0.30, -0.30, swing);
        this.neck.rotation.z = lerp(0.16, -0.22, swing);

        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.shoulder.rotation.z = lerp(-0.55, 0.85, swing);
        this.arms.l.elbow.rotation.z = lerp(0.60, 1.20, swing);

        // Steps into it off the front foot.
        this.legs.l.hip.rotation.z = lerp(-0.30, 0.62, swing);
        this.legs.r.hip.rotation.z = lerp(0.26, -0.38, swing);
        this.legs.l.knee.rotation.z = lerp(-0.35, -0.18, swing);
        this.legs.r.knee.rotation.z = lerp(-0.30, -0.55, swing);
        this.pelvis.position.y = this.p.hipY - this.H * (0.05 + 0.06 * swing);
        break;
      }
      /**
       * Barbarian up tilt — a stab straight up, squared to the camera.
       *
       * The turn is the same trick the Bandit's up tilt uses: a thrust that runs
       * along the depth axis is invisible side-on, and front-on it is the whole
       * move.
       *
       * The blade has to be **flipped in the fist**. A sword is built extending
       * along `-y` from the hand, so an arm raised overhead points the tip at
       * the floor; `hand.rotation.z = π` turns it over so the point leads.
       */
      case 'swordStabUp': {
        const a = sweep;
        // Chambered low and folded across his chest, then fired straight up.
        const thrust = clamp((a - 0.34) / 0.30, 0, 1);
        const punch = thrust * thrust * (3 - 2 * thrust);

        const turn = Math.min(1, a * 3.2) * (1 - Math.max(0, phase) * 0.5);
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * 0.90 * turn;

        this.arms.r.shoulder.rotation.x = 0;
        this.arms.r.shoulder.rotation.y = this.fighter.facing * FACE_CAMERA_TURN * 0.90 * turn;
        this.arms.r.shoulder.rotation.z = lerp(2.30, 3.08, punch);
        this.arms.r.elbow.rotation.z = lerp(2.45, 0.05, punch);
        /**
         * **No flip.** A limb's children hang along its own -y, so with the arm
         * raised the hand's -y already points at the sky and the blade extends
         * straight up out of the fist. Turning it over sent the point at the
         * floor — measured, the tip finished at height 63 on a thrust whose
         * hitbox reaches 168.
         */
        this.arms.r.hand.rotation.z = 0;

        // Off arm tucks in across the chest, out of the blade's line.
        this.arms.l.shoulder.rotation.x = -0.40;
        this.arms.l.shoulder.rotation.z = lerp(1.10, 0.70, punch);
        this.arms.l.elbow.rotation.z = 1.85;

        // Coils down then drives up onto his toes.
        this.chest.rotation.z = lerp(0.24, -0.16, punch);
        this.neck.rotation.z = lerp(0.10, -0.30, punch);   // looks up after it
        this.legs.l.hip.rotation.z = lerp(0.34, -0.05, punch);
        this.legs.r.hip.rotation.z = lerp(0.34, -0.05, punch);
        this.legs.l.knee.rotation.z = lerp(-0.85, -0.10, punch);
        this.legs.r.knee.rotation.z = lerp(-0.85, -0.10, punch);
        this.pelvis.position.y = this.p.hipY
          - this.H * 0.14 * (1 - punch) + this.H * 0.04 * punch;
        break;
      }
      /**
       * Barbarian down tilt — a fast low stab along the deck.
       *
       * Crouched right down with the blade run out flat in front of him. The arm
       * points along the facing, so the sword continues past the fist in that
       * same direction and no wrist flip is needed — unlike the up tilt, where
       * the arm points at the sky and the blade would otherwise trail behind it.
       */
      case 'swordStabLow': {
        const jab = phase < 0 ? Math.min(1, (phase + 1) * 1.9) : 1 - Math.max(0, phase) * 0.85;

        this.poseCrouch(0.62);
        this.arms.r.shoulder.rotation.x = 0;
        this.arms.r.shoulder.rotation.y = 0.22;
        // Angled down, not level: the blade runs on past the fist, so an arm
        // held straight forward puts the point at chest height on a move whose
        // hitbox is along the floor.
        /**
         * A **stab**, so the shoulder barely moves and the elbow does all of it.
         *
         * Swinging the shoulder through an arc is what made it read as waving
         * the sword downward rather than thrusting: the blade traced a curve
         * instead of travelling along its own length. Held near 1.57 — straight
         * along the facing — the arm and the sword stay one horizontal line, and
         * opening the elbow drives the point out in front of him.
         *
         * The height comes from the crouch above, not from aiming the arm down.
         */
        /**
         * Chambered from a **hanging** upper arm, not a raised one.
         *
         * The elbow folds the forearm toward the front of the upper arm, so with
         * the arm already pointing forward a fold lifts it — measured, the point
         * started 126 up, over his own head. Dropping the shoulder and folding
         * from there puts the forearm horizontal at hip height with the blade
         * run out in front of him, which is the chamber this wants.
         *
         * Shoulder and elbow then trade off: their sum stays near 1.6 the whole
         * way, so the blade holds level while the arm straightens and the point
         * travels forward along its own length.
         */
        /**
         * The `+0.45` on the strike pays for the forward pitch below. Shoulder z
         * is measured against the chest, so leaning the torso down to get the
         * blade low would tip the blade with it — the arm has to give the lean
         * straight back to stay parallel.
         */
        this.arms.r.shoulder.rotation.z = lerp(-0.55, 1.75, jab);
        this.arms.r.elbow.rotation.z = lerp(2.10, 0.25, jab);
        this.arms.r.hand.rotation.z = 0;

        this.arms.l.shoulder.rotation.x = -0.35;
        this.arms.l.shoulder.rotation.z = lerp(-0.30, -0.85, jab);
        this.arms.l.elbow.rotation.z = 0.80;

        // Pitched down over the thrust, which is what actually gets the blade
        // near the deck — the kneel alone still leaves his shoulder at 45.
        this.chest.rotation.z = lerp(0.10, -0.45, jab);
        this.neck.rotation.z = 0.20;

        /**
         * He **kneels** rather than squatting.
         *
         * A crouch deep enough to put the blade near the deck runs the shins
         * straight through it — the leg is as long as the hip is high, so there
         * is nowhere for it to go. Folding the back leg underneath puts the knee
         * on the floor and the shin flat behind him, which is where the height
         * comes from, and the front leg braces out ahead.
         */
        /**
         * Solved against the chain rather than eyeballed. The thigh is 24 and
         * the shin 22, so with the hips at `P` the knee sits at
         * `P - 24·cos(hip)` and the foot a further `22·cos(hip + knee)` below
         * that. Dropping the pelvis without opening the hips just drives both
         * through the stage — at 0.34 the feet finished 29 under it.
         *
         * Back leg kneels: hips at 15 with the thigh angled forward puts the
         * knee exactly on the deck, and the shin folds back flat behind him.
         * Front leg braces out ahead with its foot down.
         */
        this.legs.l.hip.rotation.z = lerp(1.30, 1.52, jab);   // front, braced out
        this.legs.l.knee.rotation.z = lerp(-0.35, -0.20, jab);
        this.legs.r.hip.rotation.z = 1.15;                    // back, knee down
        this.legs.r.knee.rotation.z = -2.70;                  // shin folded flat
        this.pelvis.position.y = this.p.hipY - this.H * 0.35;
        break;
      }
      /**
       * Barbarian neutral air — a flat spin with the blade held out.
       *
       * The turn is on **y**, the vertical axis, so the sword sweeps a circle
       * around him and catches whatever is in front and then behind. That is a
       * different axis from the tumbling moves, which spin on z, and it is the
       * reason this reads as a pirouette rather than a cartwheel.
       *
       * Held a touch below horizontal and leaning into it, so the disc it cuts
       * is tilted rather than perfectly flat.
       */
      case 'swordSpin': {
        const a = sweep;
        const spin = a * a * (3 - 2 * a);
        this.root.rotation.y += -this.fighter.facing * spin * Math.PI * 2;

        const out = Math.min(1, a * 3.5);
        // 1.35 sits just under level; the torso lean below tips it further, so
        // the blade traces a shallow cone pointing slightly at the floor.
        const arm = lerp(0.90, 1.35, out);
        this.arms.r.shoulder.rotation.x = 0.10;
        this.arms.r.shoulder.rotation.z = arm;
        this.arms.r.elbow.rotation.z = lerp(1.60, 0.10, out);
        this.arms.r.hand.rotation.z = 0;
        // No carryWeapon here: for a sword it forces the carried grip and
        // overwrites the elbow and wrist this swing is driving.

        // Off arm tucked in tight, which is also what a spin wants.
        this.arms.l.shoulder.rotation.x = -0.45;
        this.arms.l.shoulder.rotation.z = 0.75;
        this.arms.l.elbow.rotation.z = 1.70;

        this.chest.rotation.z = -0.24 * out;      // negative pitches forward
        this.pelvis.rotation.z = -0.12 * out;
        this.legs.l.hip.rotation.z = 0.55 - 0.20 * out;
        this.legs.r.hip.rotation.z = 0.10;
        this.legs.l.knee.rotation.z = -1.15;
        this.legs.r.knee.rotation.z = -0.60;
        break;
      }
      /**
       * Barbarian up air — a punch straight up with the free hand.
       *
       * The sword hand is busy, so this is the **left**. He turns a quarter
       * round to throw it, which squares his shoulders to the camera and puts
       * the punch across the screen instead of straight down the lens, then
       * carries the turn the rest of the way round to land facing forward again.
       */
      case 'swordPunchUp': {
        const a = sweep;
        /**
         * A quarter turn to set his shoulders, then the rest **spread across
         * the recovery** rather than crammed into the active frames. Driving
         * the whole revolution off `sweep` spun him out at the same rate the
         * punch travelled, which is far quicker than a punch should look.
         */
        const early = Math.min(1, a / 0.72) * 0.25;
        const late = clamp(phase / 0.9, 0, 1) * 0.75;
        this.root.rotation.y += -this.fighter.facing * (early + late) * Math.PI * 2;

        /**
         * It is a **punch**, so it chambers first.
         *
         * The fist drops and folds in against his ribs, then fires. Ramping
         * straight to the extended position from wherever the arm happened to
         * be gave no wind-up at all — the hand simply arrived overhead.
         */
        const wind = Math.min(1, a / 0.44);
        const punch = clamp((a - 0.44) / 0.26, 0, 1);
        const drive = punch * punch * (3 - 2 * punch);
        this.arms.l.shoulder.rotation.x = 0;
        this.arms.l.shoulder.rotation.y = -0.20;
        this.arms.l.shoulder.rotation.z = lerp(lerp(0.80, 0.15, wind), 3.05, drive);
        this.arms.l.elbow.rotation.z = lerp(lerp(1.10, 2.50, wind), 0.06, drive);
        this.arms.l.hand.rotation.z = 0;

        // Sword arm swings down and out of the way as the punch goes up.
        const off = lerp(0.60, -0.35, drive);
        this.arms.r.shoulder.rotation.x = 0.30;
        this.arms.r.shoulder.rotation.z = off;
        this.arms.r.elbow.rotation.z = 0.55;
        this.carryWeapon(off);

        this.chest.rotation.z = lerp(0.18, -0.20, drive);
        this.neck.rotation.z = lerp(0.10, -0.34, drive);   // looks up after it
        this.legs.l.hip.rotation.z = lerp(0.40, -0.10, drive);
        this.legs.r.hip.rotation.z = lerp(0.15, 0.45, drive);
        this.legs.l.knee.rotation.z = -0.75;
        this.legs.r.knee.rotation.z = -1.30;
        break;
      }
      /**
       * Barbarian forward air — a flat horizontal slice.
       *
       * This is the one aerial that genuinely wants the arm laid into the
       * horizontal plane: the brief is a cut that travels across in front of
       * him, so `shoulder.rotation.x` near a right angle is right here even
       * though it would be wrong for the grounded swings.
       *
       * Starts folded across his chest and opens through the cut. The off arm
       * is bent up and out to the side, clearing the blade's path.
       */
      case 'swordSlice': {
        /**
         * Runs the arc the **other way**: it starts wound across his chest on
         * his off side and opens outward, rather than starting out wide and
         * closing across him. Same dial, reversed endpoints.
         */
        const arc = 1.25;
        const from = HALF_PI + arc;
        const to = HALF_PI - arc;
        const swing = lerp(from, to, t);

        this.arms.r.shoulder.rotation.x = 1.36;
        this.arms.r.shoulder.rotation.z = swing;
        // Folded tight across the chest, opening only through contact.
        this.arms.r.elbow.rotation.z = lerp(2.30, 0.10, snap);
        this.arms.r.hand.rotation.z = 0;
        // No carryWeapon here: for a sword it forces the carried grip and
        // overwrites the elbow and wrist this swing is driving.

        // Off arm bent, pointing up and swung wide of the blade.
        this.arms.l.shoulder.rotation.x = -0.85;
        this.arms.l.shoulder.rotation.z = lerp(2.10, 2.55, t);
        this.arms.l.elbow.rotation.z = 1.55;

        // Torso turn reversed with the arc, or the body would be unwinding
        // against the cut instead of driving it.
        this.chest.rotation.y = lerp(0.52, -0.52, t);
        this.pelvis.rotation.y = lerp(0.24, -0.22, t);
        this.chest.rotation.z = -0.10;

        this.legs.l.hip.rotation.z = lerp(0.55, 0.15, t);
        this.legs.r.hip.rotation.z = lerp(-0.05, 0.35, t);
        this.legs.l.knee.rotation.z = -0.95;
        this.legs.r.knee.rotation.z = -0.55;
        break;
      }
      /**
       * Barbarian back air — a rising cut behind him, turning through a circle.
       *
       * He comes round to face the way he is going to hit, swings low to high
       * as he passes through, and keeps turning to finish where he started.
       * Timing the swing to the point of the turn where he is actually facing
       * backwards is what makes the blade and the hitbox agree.
       */
      case 'swordRiseBack': {
        const a = sweep;
        /**
         * **Half the turn by the hit, half after it.**
         *
         * The hitbox is behind him, so he has to be facing that way while it is
         * live. Easing the whole revolution across the active frames put him
         * nine tenths of the way round by contact and the blade was back out in
         * front — measured at world +53 with the box at -26 to -92. Reaching a
         * half turn in the middle of the window points the sword where the
         * hitbox actually is.
         */
        const early = Math.min(1, a / 0.83);
        const late = clamp(phase, 0, 1);
        this.root.rotation.y += -this.fighter.facing * (early * 0.5 + late * 0.5) * Math.PI * 2;

        // The cut peaks at the same point, so blade and hitbox agree.
        const cut = clamp((a - 0.35) / 0.48, 0, 1);
        const rise = cut * cut * (3 - 2 * cut);
        const arm = lerp(0.45, 2.85, rise);        // low behind, up and over
        this.arms.r.shoulder.rotation.x = 0.14;
        this.arms.r.shoulder.rotation.z = arm;
        this.arms.r.elbow.rotation.z = lerp(1.35, 0.10, Math.min(1, cut * 1.8));
        this.arms.r.hand.rotation.z = 0;
        // No carryWeapon here: for a sword it forces the carried grip and
        // overwrites the elbow and wrist this swing is driving.

        this.arms.l.shoulder.rotation.x = -0.40;
        this.arms.l.shoulder.rotation.z = lerp(0.60, -0.55, rise);
        this.arms.l.elbow.rotation.z = 1.10;

        this.chest.rotation.z = lerp(0.22, -0.24, rise);
        this.neck.rotation.z = lerp(0.14, -0.16, rise);
        this.legs.l.hip.rotation.z = lerp(0.55, 0.05, rise);
        this.legs.r.hip.rotation.z = lerp(0.10, 0.50, rise);
        this.legs.l.knee.rotation.z = -1.05;
        this.legs.r.knee.rotation.z = -1.25;
        break;
      }
      /**
       * Barbarian down air — a two-handed drive straight down, then a flip out.
       *
       * The blade goes down through the gap between his legs, so they split
       * front and back to open it: seen from the side that is what stops the
       * swing reading as passing through his own shins.
       *
       * The front flip is **recovery**, not part of the hit. It starts once the
       * active frames are done and unwinds the commitment — he has thrown
       * everything downward and has to turn out of it to land.
       */
      case 'swordDive': {
        const drive = sweep * sweep * (3 - 2 * sweep);
        /**
         * He **flips through the hit**, not after it.
         *
         * Swinging down and then snapping round in the recovery read as two
         * separate things bolted together. Starting the rotation during the
         * wind-up and carrying it past the active frames makes the strike part
         * of one continuous dive — he is already tipping forward as the blade
         * comes down.
         *
         * The curve is deliberately slow at the front: raised to a power, the
         * first third of the flip covers only about a sixth of the turn, so he
         * is 30-60 degrees over at contact — leaning into it, with the blade
         * still pointing at the floor where the hitbox is — and the rest of the
         * revolution unwinds afterwards.
         *
         * Counted off the **move frame**. `phase` is anchored to the first
         * hitbox and normalised against the tail of the move, and reading it
         * here turned a full revolution into a quarter of a radian by frame 44.
         */
        const rec = clamp((this.fighter.moveFrame - 7) / 33, 0, 1);
        // Negative pitches a body forward, so this is a front flip.
        const flip = -Math.pow(rec, 1.7) * Math.PI * 2;
        if (rec > 0) {
          this.root.rotation.z = flip;
          const r = this.H * ROLL_PIVOT;
          const yaw = this.root.rotation.y;
          this.root.position.x += r * Math.sin(flip) * Math.cos(yaw);
          this.root.position.y += r * (1 - Math.cos(flip));
          this.root.position.z -= r * Math.sin(flip) * Math.sin(yaw);
        }

        // Squared to the camera: the move is symmetric, and side-on that
        // symmetry is edge-on and invisible.
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * DAIR_FACING
          * Math.min(1, sweep * 2.5) * (1 - Math.max(0, phase));

        const arm = lerp(3.05, 0.18, drive);
        this.arms.r.shoulder.rotation.x = 0.10;
        this.arms.r.shoulder.rotation.y = 0.30;      // onto his centre line
        this.arms.r.shoulder.rotation.z = arm;
        this.arms.r.elbow.rotation.z = lerp(1.30, 0.05, Math.min(1, drive * 1.6));
        this.arms.r.hand.rotation.z = 0;
        // No carryWeapon here: for a sword it forces the carried grip and
        // overwrites the elbow and wrist this swing is driving.

        // Off hand joins the grip, then lets go through the follow-through.
        const grip = 1 - clamp(rec / 0.3, 0, 1);
        this.arms.l.shoulder.rotation.x = -0.62 * grip;
        this.arms.l.shoulder.rotation.y = -0.30 * grip;
        this.arms.l.shoulder.rotation.z = lerp(2.80, 0.35, drive);
        this.arms.l.elbow.rotation.z = lerp(1.20, 0.25, drive);

        this.chest.rotation.z = lerp(0.26, -0.42, drive);
        this.neck.rotation.z = lerp(0.16, -0.30, drive);
        // Legs split hard front and back so the blade has a clear gap to come
        // through — and the wider stance is most of what sells the dive.
        this.legs.l.hip.rotation.z = lerp(0.35, 1.55, drive);
        this.legs.r.hip.rotation.z = lerp(-0.15, -1.10, drive);
        this.legs.l.knee.rotation.z = -0.30;
        this.legs.r.knee.rotation.z = -0.20;
        break;
      }
      /**
       * Barbarian down smash — one cut to each side, squared to the camera.
       *
       * Both halves are timed off the **move frame** rather than a normalised
       * clock. A move with two separated hitboxes has no single "the strike":
       * `phase` anchors to the first and `sweep` stretches to the last, and
       * neither lines up with a second swing that has to land on its own beat.
       *
       * Laid into the horizontal plane so the blade sweeps across him. With his
       * shoulders square to the lens that sweep runs left to right on screen,
       * which is the only way a two-sided move reads at all side-on.
       */
      case 'swordSweepBoth': {
        const mf = this.fighter.moveFrame;
        const turn = Math.min(1, mf / 10) * (1 - Math.max(0, phase) * 0.5);
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * 0.95 * turn;

        /**
         * First cut lands **left**, second lands **right**, and each sweep is
         * timed to finish in the middle of its own hitbox window.
         *
         * On this dial a higher `z` puts the blade at negative world x and a
         * lower one at positive, so the first sweep has to travel *up* the dial
         * to arrive on the left. Run the other way round it ends on the side the
         * second box covers and both hits land opposite their own boxes —
         * measured, the blade was at +50 while box one sat at -22 to -96.
         */
        const one = clamp((mf - 6) / 9, 0, 1);
        const two = clamp((mf - 17) / 9, 0, 1);
        const arc = 1.30;
        const swing = two === 0
          ? lerp(HALF_PI - arc, HALF_PI + arc, one)
          : lerp(HALF_PI + arc, HALF_PI - arc, two);

        this.arms.r.shoulder.rotation.x = 1.44;   // flat, so z sweeps sideways
        this.arms.r.shoulder.rotation.z = swing;
        this.arms.r.elbow.rotation.z = lerp(1.70, 0.12, Math.min(1, mf / 9));
        this.arms.r.hand.rotation.z = 0;

        // Off hand rides with it — a low sweep this wide is a two-handed job.
        this.arms.l.shoulder.rotation.x = 1.05;
        this.arms.l.shoulder.rotation.z = swing - 0.25;
        this.arms.l.elbow.rotation.z = 0.60;

        // Right down on his haunches. Positive leans the torso back, so this is
        // a small forward fold over the sweep.
        this.chest.rotation.z = -0.18;
        this.neck.rotation.z = 0.24;
        this.legs.l.hip.rotation.z = 0.72;
        this.legs.r.hip.rotation.z = 0.72;
        this.legs.l.knee.rotation.z = -1.55;
        this.legs.r.knee.rotation.z = -1.55;
        this.legs.l.hip.rotation.x = 0.30;
        this.legs.r.hip.rotation.x = -0.30;
        this.pelvis.position.y = this.p.hipY - this.H * 0.30;
        break;
      }
      /**
       * Barbarian up smash — two big cuts straight up, back to back.
       *
       * The first is a **link**: it exists to hold the target above him for the
       * second, which is the one that kills. Same idea as the Wizard's up air
       * volley, and it has the same requirement — the second hitbox only
       * connects if it opts back into re-hitting, because repeat hits are
       * tracked per move rather than per box.
       *
       * Both arcs run on the move frame for the same reason the down smash
       * does: two hits, no single strike for a normalised clock to sit on.
       */
      case 'swordDoubleUp': {
        const mf = this.fighter.moveFrame;
        const one = clamp((mf - 6) / 10, 0, 1);
        const two = clamp((mf - 20) / 10, 0, 1);
        const ease = (u) => u * u * (3 - 2 * u);

        // Up, back down to reload, then up again — bigger the second time.
        const arm = two > 0
          ? lerp(0.55, 3.25, ease(two))
          : (one < 1 ? lerp(0.40, 3.10, ease(one)) : lerp(3.10, 0.55, clamp((mf - 16) / 4, 0, 1)));

        this.arms.r.shoulder.rotation.x = 0.12;
        this.arms.r.shoulder.rotation.y = 0.24;   // onto his centre line
        this.arms.r.shoulder.rotation.z = arm;
        this.arms.r.elbow.rotation.z = lerp(1.45, 0.08, Math.min(1, (two > 0 ? two : one) * 1.7));
        this.arms.r.hand.rotation.z = 0;

        // Off hand joins for the second, heavier swing.
        this.arms.l.shoulder.rotation.x = -0.55 * two;
        this.arms.l.shoulder.rotation.y = -0.24 * two;
        this.arms.l.shoulder.rotation.z = lerp(0.70, arm - 0.20, two);
        this.arms.l.elbow.rotation.z = lerp(1.20, 0.30, two);

        const rise = Math.max(one, two);
        this.chest.rotation.z = lerp(0.20, -0.22, rise);
        this.neck.rotation.z = lerp(0.10, -0.28, rise);
        this.legs.l.hip.rotation.z = lerp(0.38, -0.08, rise);
        this.legs.r.hip.rotation.z = lerp(0.38, -0.08, rise);
        this.legs.l.knee.rotation.z = lerp(-0.85, -0.12, rise);
        this.legs.r.knee.rotation.z = lerp(-0.85, -0.12, rise);
        this.pelvis.position.y = this.p.hipY - this.H * 0.14 * (1 - rise);
        break;
      }
      /**
       * Barbarian forward smash — a two-handed horizontal swing, once each way.
       *
       * These are the two halves of a manual chain: the first comes out on the
       * smash input and the second only if the player presses attack again, so
       * they are separate moves and each gets its own clean sweep rather than
       * sharing one clock.
       *
       * Both arms travel together so the hands read as sharing the grip, which
       * is what separates this from the one-handed jab cuts. The off hand has to
       * reach **across** — matching the sword arm's rotation leaves the hands a
       * shoulder-width apart in depth and it reads as two arms swinging in
       * parallel rather than as a grip.
       */
      case 'swordHeaveA':
      case 'swordHeaveB': {
        const dir = kind === 'swordHeaveB' ? -1 : 1;
        const arc = 1.52;
        const swing = lerp(HALF_PI - arc * dir, HALF_PI + arc * dir, t);

        this.arms.r.shoulder.rotation.x = 1.40;
        this.arms.r.shoulder.rotation.z = swing;
        this.arms.r.elbow.rotation.z = lerp(1.65, 0.06, snap);
        this.arms.r.hand.rotation.z = 0;

        // Both hands on it, the off one pulled across onto the grip.
        this.arms.l.shoulder.rotation.x = 0.92;
        this.arms.l.shoulder.rotation.z = swing - 0.30 * dir;
        this.arms.l.elbow.rotation.z = lerp(1.30, 0.45, snap);

        // Thrown from the hips: chest carries the arms round, pelvis follows.
        this.chest.rotation.y = lerp(-0.62 * dir, 0.62 * dir, t);
        this.pelvis.rotation.y = lerp(-0.30 * dir, 0.32 * dir, t);
        this.chest.rotation.z = lerp(0.16, -0.20, t);

        // Steps into it, which is what sells the weight.
        this.legs.l.hip.rotation.z = lerp(-0.28 * dir, 0.60 * dir, t);
        this.legs.r.hip.rotation.z = lerp(0.30 * dir, -0.34 * dir, t);
        this.legs.l.knee.rotation.z = -0.30;
        this.legs.r.knee.rotation.z = -0.42;
        this.pelvis.position.y = this.p.hipY - this.H * 0.08;
        break;
      }
      /**
       * Goblin jab — three fast horizontal stabs off the same arm.
       *
       * Everything here drives `arms.l`, because his dagger is in his left
       * hand. Every other pose family in this file assumes the weapon is on the
       * right, so a left-handed fighter needs his own — reusing one would swing
       * an empty fist and leave the blade hanging at his hip.
       *
       * Shoulder and elbow trade off so their sum stays near horizontal: the
       * point travels forward along its own length rather than arcing, which is
       * what separates a stab from a swipe. Chambered with the upper arm angled
       * *back*, so the fist has somewhere to come from.
       */
      case 'dagStab1':
      case 'dagStab2':
      case 'dagStab3': {
        const step = kind === 'dagStab1' ? 0 : kind === 'dagStab2' ? 1 : 2;
        const reach = [0.0, 0.06, 0.14][step];      // each one a little further
        /**
         * The chamber is **held**, then released.
         *
         * A plain ramp across a five frame wind-up is already 60% extended by
         * frame one — measured, the point barely moved across the whole thrust
         * because it started most of the way out. Holding the wound position for
         * the first third and firing over the rest is what gives the stab any
         * travel at all.
         */
        const w = clamp(phase + 1, 0, 1);
        const jab = phase < 0 ? clamp((w - 0.34) / 0.66, 0, 1) : 1 - Math.max(0, phase) * 0.88;

        wArm.shoulder.rotation.x = mir * (0);
        wArm.shoulder.rotation.y = mir * (-0.24); // onto his centre line
        // Drawn right back at the chamber so the fist has room to travel.
        wArm.shoulder.rotation.z = lerp(-0.95, 1.40 + reach, jab);
        wArm.elbow.rotation.z = lerp(2.50, 0.16 - reach, jab);
        wArm.hand.rotation.z = 0;

        // Off hand held up as a guard, out of the blade's line.
        oArm.shoulder.rotation.x = mir * (0.30);
        oArm.shoulder.rotation.z = lerp(0.85, 0.55, jab);
        oArm.elbow.rotation.z = 1.55;

        // Chest turn drives the thrust. Negative brings the **left** shoulder
        // forward — the mirror of the right-handed punches.
        this.chest.rotation.y = mir * (lerp(0.30, -0.34, jab));
        this.pelvis.rotation.y = lerp(0.14, -0.16, jab);
        this.chest.rotation.z = lerp(0.08, -0.10, jab);

        this.legs.l.hip.rotation.z = lerp(-0.14, 0.26, jab);
        this.legs.r.hip.rotation.z = lerp(0.18, -0.16, jab);
        this.legs.l.knee.rotation.z = -0.22;
        this.legs.r.knee.rotation.z = -0.26;
        this.pelvis.position.y = this.p.hipY - this.H * 0.04;
        break;
      }
      /**
       * Goblin forward tilt — a diagonal swipe, high and back to low and front.
       *
       * The arm is folded at the top of the arc and opens through it, so the
       * blade accelerates as it falls: a slash that is already extended at the
       * start has no snap in it.
       */
      case 'dagSwipeDiag': {
        const a = sweep;
        const cut = a * a * (3 - 2 * a);

        /**
         * The end angle **pays for the torso lean**. Shoulder z is measured
         * against the chest, and the chest against the pelvis, so a forward
         * pitch is subtracted from whatever the arm is set to — 0.9 on the dial
         * with a 0.3 fold lands the blade well below where it reads on paper.
         */
        wArm.shoulder.rotation.x = mir * (0.10);
        wArm.shoulder.rotation.y = mir * (-0.18);
        wArm.shoulder.rotation.z = lerp(2.70, 1.06, cut);
        wArm.elbow.rotation.z = lerp(1.95, 0.10, Math.min(1, cut * 1.5));
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.28);
        oArm.shoulder.rotation.z = lerp(-0.35, 0.70, cut);
        oArm.elbow.rotation.z = 0.85;

        this.chest.rotation.y = mir * (lerp(0.34, -0.30, cut));
        this.chest.rotation.z = lerp(0.20, -0.22, cut);
        this.neck.rotation.z = lerp(0.10, -0.14, cut);
        this.legs.l.hip.rotation.z = lerp(-0.22, 0.48, cut);
        this.legs.r.hip.rotation.z = lerp(0.24, -0.28, cut);
        this.legs.l.knee.rotation.z = -0.28;
        this.legs.r.knee.rotation.z = -0.40;
        this.pelvis.position.y = this.p.hipY - this.H * (0.04 + 0.05 * cut);
        break;
      }
      /**
       * Goblin up tilt — a half circle traced over his head, squared up.
       *
       * Same two-part trick the Bandit's up tilt uses. He turns toward the
       * camera so the arc is not drawn straight down the lens, and then the
       * body's yaw is **cancelled at the shoulder** so the sweep itself stays in
       * the screen plane while he turns underneath it. Without the second half
       * the turn buys nothing: the arc rotates away with him and foreshortens
       * to a flat line.
       */
      case 'dagArcOver': {
        const a = sweep;
        const turn = Math.min(1, a * 3) * (1 - Math.max(0, phase));
        const turnRad = FACE_CAMERA_TURN * ARC_FACING * turn;
        this.root.rotation.y += -this.fighter.facing * turnRad;
        wArm.shoulder.rotation.y = this.fighter.facing * turnRad;

        // Front, over the top, and away behind — a half circle on the z dial,
        // where 1.57 points ahead and 3.14 is straight up.
        wArm.shoulder.rotation.z = lerp(1.15, 4.20, a);
        wArm.shoulder.rotation.x = mir * (0.18);
        // Nearly straight the whole way: a bent arm has no radius and the arc
        // stops reading as a circle.
        wArm.elbow.rotation.z = lerp(0.55, 0.06, Math.min(1, a * 2));
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.22);
        oArm.shoulder.rotation.z = lerp(0.35, -0.30, a);
        oArm.elbow.rotation.z = 0.80;

        this.chest.rotation.z = lerp(0.16, -0.12, a);
        this.neck.rotation.z = -0.18;               // watching the blade over him
        this.legs.l.hip.rotation.z = lerp(0.14, -0.16, a);
        this.legs.r.hip.rotation.z = lerp(-0.10, 0.16, a);
        this.legs.l.knee.rotation.z = -0.24;
        this.legs.r.knee.rotation.z = -0.20;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 * windup;
        break;
      }
      /**
       * Goblin down tilt — a fast low stab along the deck.
       *
       * The Barbarian's shape, mirrored to the left hand and scaled to a much
       * smaller fighter. He crouches rather than kneels: at 74 tall his leg is
       * short enough that a plain crouch already puts the blade near the floor
       * without driving his shins through it.
       */
      case 'dagStabLow': {
        // Same held chamber as the jab, for the same reason.
        const wLow = clamp(phase + 1, 0, 1);
        const jab = phase < 0 ? clamp((wLow - 0.30) / 0.70, 0, 1) : 1 - Math.max(0, phase) * 0.85;

        this.poseCrouch(0.55);
        wArm.shoulder.rotation.x = mir * (0);
        wArm.shoulder.rotation.y = mir * (-0.22);
        // Sum held near 1.6 so the blade stays level while the arm extends; the
        // extra on the strike pays for the forward pitch below.
        wArm.shoulder.rotation.z = lerp(-0.50, 1.62, jab);
        wArm.elbow.rotation.z = lerp(2.05, 0.22, jab);
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.30);
        oArm.shoulder.rotation.z = lerp(-0.25, -0.75, jab);
        oArm.elbow.rotation.z = 0.75;

        this.chest.rotation.z = lerp(0.12, -0.40, jab);
        this.neck.rotation.z = 0.18;
        this.legs.l.hip.rotation.z = lerp(0.75, 1.05, jab);
        this.legs.l.knee.rotation.z = lerp(-1.10, -0.85, jab);
        this.legs.r.hip.rotation.z = 0.62;
        this.legs.r.knee.rotation.z = -1.62;
        // Shallower than it looks like it wants: his leg is only 34 long against
        // a 33 hip height, so almost the whole sink has to come out of the knees
        // — at 0.26 his shins finished twenty units under the stage.
        this.pelvis.position.y = this.p.hipY - this.H * 0.15;
        break;
      }
      /**
       * Goblin forward smash — a flat slash across the front.
       *
       * Laid into the horizontal plane by holding `shoulder.rotation.x` near a
       * right angle, so `z` sweeps *around* him rather than chopping over the
       * top. The blade is short, so the reach has to come from the body: chest
       * and hips turn through the whole arc and he steps into it.
       */
      case 'dagSlash': {
        const arc = 1.34;
        const swing = lerp(HALF_PI - arc, HALF_PI + arc, t);

        wArm.shoulder.rotation.x = 1.38;
        wArm.shoulder.rotation.z = swing;
        wArm.elbow.rotation.z = lerp(1.85, 0.08, snap);
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.55);
        oArm.shoulder.rotation.z = lerp(-0.50, 0.55, t);
        oArm.elbow.rotation.z = 0.80;

        // Negative chest yaw drives the **left** shoulder through the cut.
        this.chest.rotation.y = mir * (lerp(0.50, -0.52, t));
        this.pelvis.rotation.y = lerp(0.24, -0.26, t);
        this.chest.rotation.z = lerp(0.14, -0.16, t);

        this.legs.l.hip.rotation.z = lerp(-0.26, 0.56, t);
        this.legs.r.hip.rotation.z = lerp(0.28, -0.30, t);
        this.legs.l.knee.rotation.z = -0.26;
        this.legs.r.knee.rotation.z = -0.38;
        this.pelvis.position.y = this.p.hipY - this.H * 0.06;
        break;
      }
      /**
       * Goblin up smash — a leaping stab with a full turn under it.
       *
       * The spin is on **y**, the vertical axis, so he pirouettes rather than
       * tumbling: the blade stays pointed at the sky the whole way round while
       * his body rotates beneath it.
       *
       * The hop is a parabola on the root and is presentation only — the
       * simulation keeps him grounded, so his hurtbox does not leave the floor
       * and the move stays a grounded smash.
       */
      case 'dagLeapStab': {
        const a = sweep;
        const spin = a * a * (3 - 2 * a);
        this.root.rotation.y += -this.fighter.facing * spin * Math.PI * 2;

        // Crouch, launch, land: peaks with the active frames.
        const lift = Math.sin(clamp(a, 0, 1) * Math.PI);
        const load = Math.min(1, a / 0.22);
        this.root.position.y += lift * this.H * 0.30;

        /**
         * Blade straight up, and **no wrist flip**. A limb hangs along its own
         * -y, so raising the arm to 3.08 on the dial already turns the hand
         * over and the dagger continues up out of the fist. A half turn on top
         * of that points it back at the floor — measured, the tip sat at chest
         * height (65) while the hitbox ran to 112.
         */
        const thrust = clamp((a - 0.18) / 0.34, 0, 1);
        const drive = thrust * thrust * (3 - 2 * thrust);
        wArm.shoulder.rotation.x = mir * (0);
        wArm.shoulder.rotation.y = mir * (-0.16);
        wArm.shoulder.rotation.z = lerp(1.90, 3.08, drive);
        wArm.elbow.rotation.z = lerp(2.30, 0.05, drive);
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.35);
        oArm.shoulder.rotation.z = lerp(0.70, -0.40, drive);
        oArm.elbow.rotation.z = 1.15;

        this.chest.rotation.z = lerp(0.26, -0.18, drive);
        this.neck.rotation.z = lerp(0.10, -0.32, drive);
        // Tucks his legs on the way up, the way a jumping thrust does.
        this.legs.l.hip.rotation.z = lerp(0.52 * load, 0.85, drive);
        this.legs.r.hip.rotation.z = lerp(0.52 * load, 0.45, drive);
        this.legs.l.knee.rotation.z = lerp(-0.95 * load, -1.55, drive);
        this.legs.r.knee.rotation.z = lerp(-0.95 * load, -1.20, drive);
        this.pelvis.position.y = this.p.hipY - this.H * 0.16 * load * (1 - drive);
        break;
      }
      /**
       * Goblin down smash — a low turn on the spot with the blade held out.
       *
       * Same vertical-axis spin as the up smash, but he stays down: the dagger
       * sweeps a circle at shin height and catches everything around him. The
       * arm is laid flat so `z` holds it out sideways through the whole turn
       * rather than swinging it.
       */
      case 'dagSpinLow': {
        const a = sweep;
        const spin = a * a * (3 - 2 * a);
        this.root.rotation.y += -this.fighter.facing * spin * Math.PI * 2;

        const out = Math.min(1, a * 3.2);
        wArm.shoulder.rotation.x = mir * (1.46); // flat, held out from the body
        wArm.shoulder.rotation.z = lerp(0.95, 1.62, out);
        wArm.elbow.rotation.z = lerp(1.70, 0.10, out);
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.60);
        oArm.shoulder.rotation.z = 0.60;
        oArm.elbow.rotation.z = 1.40;

        // Right down on his haunches — the knees take the sink, not the hips,
        // or a fighter this short puts his shins through the stage.
        this.chest.rotation.z = -0.20;
        this.neck.rotation.z = 0.22;
        this.legs.l.hip.rotation.z = 0.80;
        this.legs.r.hip.rotation.z = 0.80;
        this.legs.l.knee.rotation.z = -1.72;
        this.legs.r.knee.rotation.z = -1.72;
        this.legs.l.hip.rotation.x = 0.28;
        this.legs.r.hip.rotation.x = -0.28;
        this.pelvis.position.y = this.p.hipY - this.H * 0.17;
        break;
      }
      /**
       * Goblin dash attack — a low lunge with a rising cut.
       *
       * He crouches, throws himself forward and slashes upward, and the cut
       * **stops in front of him** rather than carrying on overhead: the blade
       * runs from about his knee to about his chin, which is where the hitbox
       * is. Swinging it further would put the sword above his head and the box
       * nowhere near it.
       */
      case 'dagLungeUp': {
        const a = sweep;
        const rise = a * a * (3 - 2 * a);
        const load = Math.min(1, a / 0.20);

        // Low from the front, up to chest height — 0.55 on the dial is down and
        // ahead, 2.05 is up and ahead, and it stops there.
        wArm.shoulder.rotation.x = mir * (0.14);
        wArm.shoulder.rotation.y = mir * (-0.20);
        wArm.shoulder.rotation.z = lerp(0.55, 1.72, rise);
        wArm.elbow.rotation.z = lerp(1.60, 0.12, Math.min(1, rise * 1.6));
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.x = mir * (-0.30);
        oArm.shoulder.rotation.z = lerp(0.55, -0.45, rise);
        oArm.elbow.rotation.z = 1.05;

        // Folded over the launch, opening as the cut rises.
        this.chest.rotation.z = lerp(-0.34, 0.16, rise);
        this.neck.rotation.z = lerp(0.24, -0.10, rise);
        this.legs.l.hip.rotation.z = lerp(0.80 * load, -0.20, rise);
        this.legs.r.hip.rotation.z = lerp(0.55 * load, 0.62, rise);
        this.legs.l.knee.rotation.z = lerp(-1.55 * load, -0.30, rise);
        this.legs.r.knee.rotation.z = lerp(-1.10 * load, -1.05, rise);
        this.pelvis.position.y = this.p.hipY - this.H * (0.13 * load * (1 - rise) + 0.03);
        break;
      }
      /**
       * Goblin neutral air — a face-on star.
       *
       * **No tuck.** The cannonball version is gone: a ball read as a shapeless
       * blob at this size whichever way the timing was cut, and the two-shape
       * idea cost startup frames without buying anything legible.
       *
       * He squares to the camera and throws all four limbs out on the
       * diagonals, head back. The turn is the load-bearing part. A limb spread
       * lives on `shoulder.rotation.x` / `hip.rotation.x`, which swings it along
       * his own shoulder axis — and side-on that axis points into the screen, so
       * a fully spread star is a fighter with his arms hidden behind himself.
       * Turned face-on, the same axis lies across the screen and the X shape is
       * the whole silhouette.
       */
      case 'dagStarBurst': {
        const a = sweep;
        const open = clamp(a / 0.40, 0, 1);
        const out = open * open * (3 - 2 * open);
        const settle = clamp((a - 0.78) / 0.22, 0, 1);
        const ext = out * (1 - settle * 0.28);

        // Square to the camera, and back out of it as he closes.
        this.root.rotation.y += -this.fighter.facing * (Math.PI / 2) * ext;

        /**
         * Arms up and out at roughly 45°. On this dial 0 hangs straight down,
         * `HALF_PI` is straight out to the side and `PI` is straight up, so
         * 2.36 is the up-diagonal. Elbows lock — a star with bent elbows reads
         * as a flail.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = 0;
          arm.shoulder.rotation.y = 0;
          arm.shoulder.rotation.x = -sign * lerp(0.34, 2.36, ext);
          arm.elbow.rotation.z = lerp(1.45, 0.04, ext);
          arm.hand.rotation.z = 0;
        }

        // Legs down and out on the matching diagonal — 0.78 is 45° off vertical.
        for (const side of ['l', 'r']) {
          const leg = this.legs[side];
          const sign = side === 'r' ? 1 : -1;
          leg.hip.rotation.z = 0;
          leg.hip.rotation.x = -sign * lerp(0.12, 0.78, ext);
          leg.knee.rotation.z = lerp(-0.95, -0.03, ext);
        }

        // Head up. Positive on the neck tips it back, which from a square chest
        // points the face at the sky.
        this.neck.rotation.z = lerp(0, 0.48, ext);
        this.chest.rotation.z = lerp(0, 0.14, ext);
        this.pelvis.position.y = this.p.hipY;
        break;
      }

      /**
       * Goblin forward air — two stabs, low then high.
       *
       * Both thrusts share one arm and one clock, so the ladder is driven off
       * `moveFrame` in halves rather than off `phase`: `phase` is anchored to
       * the first hitbox and would hold at its plateau across both. Each rung
       * chambers and fires inside its own half.
       *
       * **This is a thrust, not a sweep.** The first version swung
       * `shoulder.rotation.y` through 0.64 radians as it fired, which drags the
       * whole arm horizontally across the body — the motion of waving something,
       * not of stabbing with it. The yaw is now *held* at a fixed inward value
       * so the blade tracks one line down his centre, and every bit of the
       * travel comes from the elbow unfolding and the shoulder driving forward
       * behind it. That is also where the extra range comes from: an elbow that
       * locks at 0.02 instead of 0.06, from a deeper chamber.
       */
      case 'dagTripleStab': {
        const mf = Math.max(0, this.fighter.moveFrame - 1);
        const span = Math.max(1, (this.fighter.move.total || 34) * 0.60);
        const ladder = clamp(mf / span, 0, 1);
        const rung = Math.min(1, Math.floor(ladder * 2));
        const local = clamp(ladder * 2 - rung, 0, 1);
        /**
         * The chamber is **held**, then released — the jab's curve, for the
         * jab's reason. A plain ramp is already most of the way extended by the
         * first frame, so the point barely travels and the thrust reads as a
         * wave. Holding the wound position and firing over the back half is
         * what makes it a stab.
         */
        const push = clamp((local - 0.34) / 0.50, 0, 1);

        /**
         * Both stabs run **horizontal**, and the range comes from the shoulder
         * and the elbow trading off so their sum stays at `HALF_PI`: the point
         * travels forward along its own length instead of arcing up or down.
         * Drawn right back to -1.15 at the chamber, which is further than the
         * jab's -0.95 — this is the aerial and it is supposed to out-reach the
         * ground version.
         *
         * The second stab carries a little more of the extension in the
         * shoulder and correspondingly less in the elbow, which keeps it level
         * while pushing the point further out.
         */
        /**
         * **He commits his body into the thrust**, and this is where the extra
         * range actually comes from.
         *
         * Measured, the arm alone tops out at 42 forward — the jab reaches
         * exactly the same 42, because both are the same fully-extended limb off
         * a shoulder sitting over his centre. No amount of dialling the shoulder
         * and elbow moves that: it is the length of his arm. The only way an
         * aerial stab out-ranges the grounded one is to move the shoulder, so he
         * pitches forward into it about his hip.
         *
         * The pitch is added back into the shoulder dial so the stab stays
         * horizontal instead of angling into the floor — the same correction the
         * Barbarian's forward tilt needs, for the same reason: a torso lean is
         * subtracted from the arm's world angle.
         */
        const dive = 0.44 * push;
        this.root.rotation.z += -dive;
        {
          const rr = this.H * ROLL_PIVOT;
          const yaw = this.root.rotation.y;
          this.root.position.x += rr * Math.sin(-dive) * Math.cos(yaw);
          this.root.position.y += rr * (1 - Math.cos(dive));
          this.root.position.z -= rr * Math.sin(-dive) * Math.sin(yaw);
        }

        const reach = rung === 0 ? 0.0 : 0.11;
        wArm.shoulder.rotation.x = mir * (0);
        wArm.shoulder.rotation.y = mir * (-0.08);   // near his centre line
        wArm.shoulder.rotation.z = lerp(-1.15, 1.44 + reach, push) + dive;
        wArm.elbow.rotation.z = lerp(2.60, 0.13 - reach * 0.8, push);
        wArm.hand.rotation.z = 0;

        /**
         * Quarter turn over the move — **on the hips only**.
         *
         * Turning the whole root through 90° also turns the stabbing arm 90°,
         * and the payoff stab measured at x=8 while its hitbox reached to 70:
         * he was thrusting at the camera. The turn is therefore applied at the
         * root and taken straight back out at the chest, so the legs and pelvis
         * wind round through the full quarter while the shoulders stay square
         * to the target.
         *
         * The direction is the reverse of the first pass — the dagger changed
         * hands, and a coil that opens the weapon shoulder on one side closes
         * it on the other.
         */
        const turn = clamp(ladder, 0, 1);
        /**
         * A **third** of a turn, not a quarter.
         *
         * 90° of hip coil is fine on its own, but it rotates the frame the
         * forward dive is defined in: by the second stab the body had turned 84
         * degrees and the pitch was tilting him sideways relative to the camera
         * instead of driving him at the target. Measured, the first stab reached
         * 51 and the second only 37 — the later the stab, the more of its own
         * commitment it threw away. 0.60 keeps the coil readable while leaving
         * the dive pointing where the blade is going.
         */
        const quarter = this.fighter.facing * turn * 0.60;
        this.root.rotation.y += quarter;
        /**
         * Only the drive term mirrors. `quarter` exists to cancel the root's
         * turn so the shoulders stay square, and that turn is the same either
         * way he is holding the dagger — mirroring it would double the rotation
         * instead of undoing it. The drive is the shoulder pushing in behind
         * the thrust, which is what a stab has instead of a sweep.
         */
        /**
         * The drive is written in **left-hand polarity**, like every other
         * mirrored term in these poses, and `mir` flips it for the right hand.
         * Writing it right-handed and letting `mir` flip it again drove the
         * weapon shoulder *backwards* into the thrust and cost about a third of
         * the reach — the stab measured 29 forward where the arm alone should
         * have carried it past 40.
         */
        this.chest.rotation.y = -quarter + mir * lerp(0.20, -0.58, push) * this.fighter.facing;

        oArm.shoulder.rotation.z = lerp(0.60, 0.95, push);
        oArm.shoulder.rotation.x = mir * (-0.42);
        oArm.elbow.rotation.z = 1.30;

        // Legs trail loosely: this is thrown in the air, so nothing is braced.
        this.legs.l.hip.rotation.z = 0.36;
        this.legs.l.knee.rotation.z = -0.62;
        this.legs.r.hip.rotation.z = -0.20;
        this.legs.r.knee.rotation.z = -1.05;
        // Leans into the thrust. Negative is forward, and it carries the whole
        // shoulder with it — worth several units of reach on its own.
        this.chest.rotation.z = lerp(-0.04, -0.06, push);
        break;
      }

      /**
       * Goblin down air — flip, cut, finish. **Three steps, not one curve.**
       *
       * The first version ran a single smooth `2π` with the cut overlapping it,
       * and the swipe was invisible: the arm was sweeping while the body was
       * also rotating, the two motions cancelled in world space, and the blade
       * measured as barely moving. Whatever the numbers said, on screen there
       * was no swipe.
       *
       * So the flip stops in the middle. He snaps upside down over the first
       * third, **holds inverted** while the arm swings through the arc under
       * him, then completes the revolution. Only one thing moves at a time,
       * which is the entire reason the cut now reads.
       *
       * "Relaxed" still governs the legs — knees bent, gently scissored, never
       * locked, so it stays a loose flip rather than the tight cannonball the
       * nair owns.
       */
      case 'dagBackflipArc': {
        const total = this.fighter.move.total || 40;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total - 1), 0, 1);

        /**
         * Step boundaries as fractions of the move: snap to inverted by `A`,
         * hold and cut until `B`, come round to upright by `C`, then settle.
         */
        const A = 0.30, B = 0.60, C = 0.90;
        let spin;
        if (u < A) {
          const k = u / A;
          spin = 0.5 * (k * k * (3 - 2 * k));
        } else if (u < B) {
          spin = 0.5;                                   // held inverted
        } else {
          const k = clamp((u - B) / (C - B), 0, 1);
          spin = 0.5 + 0.5 * (k * k * (3 - 2 * k));
        }
        const mf = u;
        /**
         * The roll, **about his hip rather than his feet**.
         *
         * `root` sits on the ground, so a bare z rotation swings the whole body
         * around the soles: measured, his head passed 65 units *below* his own
         * feet at the halfway point and the blade reached 90 down. A person
         * flipping rotates about their middle, so the same offset every other
         * flip in this file uses is applied here — translate the root by the
         * hip radius so the pivot lands where the body's mass is.
         *
         * No facing multiplier on the rotation itself: facing is a half turn
         * about y and already mirrors a z-roll. The pivot *offset* does need the
         * yaw, because it is a translation in world space rather than a
         * rotation, which is what the `cos(yaw)`/`sin(yaw)` terms are for.
         */
        const roll = spin * Math.PI * 2;
        this.root.rotation.z += roll;
        const r = this.H * ROLL_PIVOT;
        const yaw = this.root.rotation.y;
        this.root.position.x += r * Math.sin(roll) * Math.cos(yaw);
        this.root.position.y += r * (1 - Math.cos(roll));
        this.root.position.z -= r * Math.sin(roll) * Math.sin(yaw);

        /**
         * The arm charges through step one and fires through step two, so the
         * two never overlap. `charge` runs with the snap to inverted; `cut`
         * runs only across the hold.
         */
        const charge = clamp(u / A, 0, 1);
        const wind = charge * charge * (3 - 2 * charge);
        const swipe = clamp((u - A) / (B - A), 0, 1);
        const cut = swipe * swipe * (3 - 2 * swipe);

        /**
         * He is inverted, so an arc "under him" is an arc that runs *over* his
         * head in body space: the dial value that points the arm at his own
         * feet points it at the sky once he is upside down, and vice versa.
         * Sweeping 2.05 up through π to 4.25 therefore carries the blade from
         * ahead of him, down under his body, and out behind — passing straight
         * below him at the midpoint, where the hitbox sits.
         */
        wArm.shoulder.rotation.x = mir * (0.18);
        wArm.shoulder.rotation.y = mir * (-0.22);
        wArm.shoulder.rotation.z = lerp(lerp(1.30, 1.75, wind), 4.55, cut);
        // Chambered tight, then thrown out for reach through the cut.
        // Straightens ahead of the sweep: a half-folded elbow costs reach at
        // exactly the moment the blade passes under him.
        wArm.elbow.rotation.z = lerp(lerp(0.90, 1.70, wind), 0.08, Math.min(1, cut * 1.8));
        wArm.hand.rotation.z = 0;

        // Off arm counterweights the swing rather than tucking.
        oArm.shoulder.rotation.z = lerp(1.05, 1.95, cut);
        oArm.shoulder.rotation.x = mir * (-0.30);
        oArm.elbow.rotation.z = 1.05;

        // Loose legs: bent, gently scissored, never straight.
        const tuck = Math.sin(clamp(mf, 0, 1) * Math.PI);
        this.legs.l.hip.rotation.z = lerp(0.30, 0.86, tuck);
        this.legs.l.knee.rotation.z = lerp(-0.70, -1.15, tuck);
        this.legs.r.hip.rotation.z = lerp(0.05, 0.52, tuck);
        this.legs.r.knee.rotation.z = lerp(-0.95, -1.40, tuck);

        this.chest.rotation.z = lerp(0.16, -0.12, cut);
        this.neck.rotation.z = -0.24;
        break;
      }

      /**
       * Goblin up air — a big semicircle over the head.
       *
       * The arm travels the full half circle, front to back over the top, so
       * the tip traces a dome rather than poking up. The body pulls the other
       * way: a quarter turn *left* plus a backward lean, so he looks like he is
       * getting out of the path of his own blade. `chest.rotation.z` positive
       * leans back, and the lean peaks with the swing rather than at the end.
       */
      case 'dagRiseArc': {
        const a = sweep;
        const wind = Math.min(1, a / 0.26);
        const drive = clamp((a - 0.15) / 0.80, 0, 1);
        const arc = drive * drive * (3 - 2 * drive);

        /**
         * Quarter turn left, **cancelled at the shoulder** — the same two-part
         * trick the up tilt uses. The turn is what makes the body read as
         * moving away from its own blade; the cancellation is what keeps the
         * arc in the screen plane instead of letting it rotate away with him.
         *
         * It only became necessary when the dagger moved hands. On the old
         * shoulder the turn happened to foreshorten the arc harmlessly; on the
         * new one it ate the back half of the semicircle, and the tip that had
         * finished 36 units behind him finished 4 in front instead.
         */
        /**
         * **No facing term, and the opposite sign.**
         *
         * With `facing` in it the turn mirrored, so the two directions were
         * different animations and the left-facing one read as awkward. Dropping
         * it makes the body turn the same way on screen whichever way he faces —
         * he does going left exactly what he does going right. The negation is
         * the correction from the first pass: `+` on this dial turned him toward
         * his right, and this is meant to be a quarter turn *left*.
         */
        const quarter = -clamp(a * 1.3, 0, 1) * (Math.PI / 2);
        this.root.rotation.y += quarter;

        // 0.62 (down and forward) up over 3.10 (straight up) to 4.30 (down and
        // behind): a genuine semicircle, not a poke.
        wArm.shoulder.rotation.x = mir * (0.12);
        // Placement plus cancellation: the first term mirrors with the hand,
        // the second undoes the body's yaw and is side-independent.
        wArm.shoulder.rotation.y = mir * (-0.18) - quarter;
        wArm.shoulder.rotation.z = lerp(lerp(1.00, 0.62, wind), 4.30, arc);
        wArm.elbow.rotation.z = lerp(0.70, 0.05, Math.min(1, arc * 2));
        wArm.hand.rotation.z = 0;

        oArm.shoulder.rotation.z = lerp(0.55, 1.15, arc);
        oArm.shoulder.rotation.x = mir * (-0.40);
        oArm.elbow.rotation.z = lerp(1.40, 0.85, arc);

        // Body away from the attack, deepest at contact.
        const lean = Math.sin(clamp(arc, 0, 1) * Math.PI) * 0.34 + arc * 0.10;
        this.chest.rotation.z = 0.14 + lean;
        this.pelvis.rotation.z = 0.10 + lean * 0.45;
        this.neck.rotation.z = -0.30 * arc;

        this.legs.l.hip.rotation.z = lerp(0.20, -0.34, arc);
        this.legs.l.knee.rotation.z = lerp(-0.90, -0.40, arc);
        this.legs.r.hip.rotation.z = lerp(0.40, 0.10, arc);
        this.legs.r.knee.rotation.z = -1.15;
        break;
      }

      /**
       * Goblin back air — a spinning back kick, thrown with everything.
       *
       * Same skeleton as the Wizard's, deliberately: it is the same move. What
       * separates them is commitment. The kicking leg goes as far back as the
       * hip dial allows and tilts *up* rather than sitting level, the head turns
       * to look down the leg, and the torso and both arms throw forward — the
       * counterweight that makes a real back kick possible. The support leg
       * tucks tight along the body.
       *
       * The extension is held flat across the contact window (`out` plateaus at
       * 1) so the leg is at full stretch for every active frame, not only the
       * midpoint.
       */
      /**
       * Goblin neutral B — a javelin throw.
       *
       * Two halves with the release between them: he coils back with the spear
       * cocked above and behind the shoulder, then unwinds forward and throws
       * the arm through. All the power reads from the *torso* reversing — the
       * arm is along for the ride, which is what separates a javelin throw from
       * a dart flick.
       *
       * The spear replaces the dagger in the fist for the duration; both at once
       * reads as a bundle of sticks.
       */
      case 'spearThrow': {
        const rel = (this.fighter.move && this.fighter.move.costFrame) || 16;
        const total = (this.fighter.move && this.fighter.move.total) || 40;
        const mf = this.fighter.moveFrame;
        // Held coil, then a fast unwind through the release, then recovery.
        const coil = clamp(mf / rel, 0, 1);
        const wind = coil * coil * (3 - 2 * coil);
        const after = clamp((mf - rel) / Math.max(1, total * 0.32), 0, 1);
        const fire = after * after * (3 - 2 * after);

        /**
         * **The spear arm is the free one**, and the dagger arm barely moves.
         *
         * He is holding a knife in his other hand the whole time, so raising
         * both arms made it look like he was throwing that too. The dagger hand
         * now just counterbalances near the hip, which is what a thrower's off
         * hand actually does.
         *
         * `sMir` is written so the authored values below apply directly in the
         * normal configuration (dagger right, spear left) and flip if the two
         * ever swap.
         */
        const sArm = this.arms[this.spearHand || 'l'];
        const dArm = this.arms[this.weaponSide || 'r'];
        const sMir = (this.spearHand || 'l') === 'l' ? 1 : -1;

        // The spear leaves his hand at the release and the dagger never hides.
        if (this.spear) this.spear.visible = mf <= rel;
        this.setWeaponVisible(true);

        /**
         * The throwing arm: cocked high and back (2.55 on the dial is up and
         * behind) with the elbow folded, then driven forward and down to 1.30 —
         * a shade above horizontal, which is where a low-arc throw releases.
         */
        sArm.shoulder.rotation.x = sMir * (-0.10);
        sArm.shoulder.rotation.y = sMir * (0.16);
        sArm.shoulder.rotation.z = lerp(lerp(1.20, 2.55, wind), 1.30, fire);
        sArm.elbow.rotation.z = lerp(lerp(0.80, 1.55, wind), 0.10, fire);
        sArm.hand.rotation.z = 0;

        // Dagger arm: low and tucked, swinging back a little as he follows
        // through. It never comes above the shoulder.
        dArm.shoulder.rotation.x = sMir * (0.22);
        dArm.shoulder.rotation.z = lerp(lerp(0.55, 0.30, wind), 0.85, fire);
        dArm.elbow.rotation.z = lerp(0.95, 1.35, fire);
        dArm.hand.rotation.z = 0;

        /**
         * The reversal. `chest.rotation.z` positive leans **back**, so the coil
         * is the positive side and the throw swings through to negative. The
         * pelvis follows at about half, which keeps it a rotation through the
         * body rather than a hinge at the waist.
         */
        this.chest.rotation.z = lerp(lerp(0.06, 0.42, wind), -0.30, fire);
        this.pelvis.rotation.z = lerp(lerp(0.0, 0.20, wind), -0.14, fire);
        // Drives the *spear* shoulder, so it takes the spear arm sign.
        this.chest.rotation.y = sMir * lerp(lerp(0, 0.34, wind), -0.30, fire) * this.fighter.facing;
        this.neck.rotation.z = lerp(lerp(0, 0.16, wind), -0.12, fire);

        // Steps into it: back leg loaded on the coil, front leg planted after.
        this.legs.l.hip.rotation.z = lerp(lerp(0, -0.26, wind), 0.34, fire);
        this.legs.r.hip.rotation.z = lerp(lerp(0, 0.30, wind), -0.22, fire);
        this.legs.l.knee.rotation.z = lerp(-0.30, -0.14, fire);
        this.legs.r.knee.rotation.z = lerp(-0.46, -0.24, fire);
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 * wind * (1 - fire);
        break;
      }

      /**
       * Goblin up B — sealed inside the Goblin Barrel.
       *
       * The whole point is that **he is not visible**: the barrel is the entire
       * silhouette, so the body is hidden outright rather than tucked small. It
       * comes back when the barrel breaks, which the move data drives by leaving
       * this pose.
       *
       * The spin is slow on purpose. A fast tumble reads as a thrown object; a
       * lazy one reads as a delivery arriving, which is the joke.
       */
      case 'gobBarrel': {
        const mf = this.fighter.moveFrame;
        const launch = (this.fighter.move && this.fighter.move.costFrame) || 8;
        /** 0 while he climbs in, 1 once he is sealed and airborne. */
        const inside = clamp((mf - launch * 0.4) / Math.max(1, launch * 0.6), 0, 1);

        if (this.gobBarrel) {
          this.gobBarrel.visible = true;
          // Sits at his middle, not at his feet, so it flies where he would.
          this.gobBarrel.position.set(0, this.H * 0.46, 0);
          /**
           * Tumbles end over end. The prop's own axis already lies across the
           * screen (see `buildGobBarrel`), so this is the rotation that rolls it
           * *forwards* through the air rather than spinning it on the spot.
           *
           * No facing multiplier: facing is a half turn about y and mirrors a
           * z rotation on its own.
           */
          this.gobBarrel.rotation.z = mf * 0.11;
          const s = lerp(0.55, 1, inside);
          this.gobBarrel.scale.setScalar(s);
        }
        // Hidden completely once the lid is on.
        this.pelvis.visible = inside < 0.85;
        if (this.spear) this.spear.visible = false;
        this.setWeaponVisible(inside < 0.85);

        // Curling in for the frames before he disappears.
        const tuck = inside;
        for (const side of ['l', 'r']) {
          this.arms[side].shoulder.rotation.z = lerp(0.30, 1.70, tuck);
          this.arms[side].elbow.rotation.z = lerp(0.20, 2.20, tuck);
          this.legs[side].hip.rotation.z = lerp(0.10, 1.30, tuck);
          this.legs[side].knee.rotation.z = lerp(-0.20, -2.10, tuck);
        }
        this.pelvis.position.y = this.p.hipY - this.H * 0.10 * tuck;
        this.neck.rotation.z = -0.30 * tuck;
        break;
      }

      /**
       * Goblin side B — driven forward behind the Goblin Drill.
       *
       * He is not swinging it, he is **hanging on to it**: the drill is doing
       * the moving and he is being dragged along behind. So the arms lock out
       * ahead of him rather than pulling, the torso pitches forward over the
       * machine, and the legs trail and scrabble instead of striding.
       *
       * The drill is parented to the chest and points along +x, so it aims where
       * he faces without any per-frame maths.
       */
      case 'drillPush': {
        const mf = this.fighter.moveFrame;
        const total = (this.fighter.move && this.fighter.move.total) || 46;
        const u = clamp(mf / Math.max(1, total), 0, 1);
        const draw = clamp(mf / 8, 0, 1);            // pulls it out
        const grip = draw * draw * (3 - 2 * draw);
        const done = clamp((u - 0.72) / 0.28, 0, 1); // packs it away

        if (this.drill) {
          this.drill.visible = grip > 0.05 && done < 0.9;
          // Pushed a full body-width out. The wooden shaft added behind the
          // head is what makes this possible: he holds the timber, the machine
          // sits clear of his face, and his fists land on the grips.
          this.drill.position.set(this.W * 1.02 * grip, -this.H * 0.02, 0);
          // Spins about its own axis. Fast — it is the only part of him that is.
          this.drill.rotation.x = mf * 0.85;
          this.drill.scale.setScalar(lerp(0.4, 1, grip));
        }
        if (this.spear) this.spear.visible = false;
        this.setWeaponVisible(false);

        // Both arms out and locked onto the handles.
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(0.40, 1.52, grip);
          arm.shoulder.rotation.x = sign * 0.26 * grip;
          arm.elbow.rotation.z = lerp(1.30, 0.30, grip);
          arm.hand.rotation.z = 0;
        }

        // Pitched forward over it, riding the machine.
        this.chest.rotation.z = lerp(0, -0.34, grip) * (1 - done);
        this.pelvis.rotation.z = lerp(0, -0.16, grip) * (1 - done);
        this.neck.rotation.z = lerp(0, 0.22, grip);

        /**
         * Legs scrabbling. A fast alternating cycle rather than a stride: he is
         * being pulled and his feet are trying to keep up, which is a much
         * faster cadence than a run and reads as loss of control.
         */
        const churn = Math.sin(mf * 0.85) * 0.44 * grip * (1 - done);
        this.legs.l.hip.rotation.z = 0.16 + churn;
        this.legs.r.hip.rotation.z = 0.16 - churn;
        this.legs.l.knee.rotation.z = -0.55 - Math.max(0, churn) * 1.2;
        this.legs.r.knee.rotation.z = -0.55 - Math.max(0, -churn) * 1.2;
        this.pelvis.position.y = this.p.hipY - this.H * 0.06 * grip;
        break;
      }

      /**
       * Mega Knight jab — a 1-2, alternating fists, thrown with his whole body.
       *
       * Both halves share this case and differ only in which arm throws, which
       * is the point: they are the same punch mirrored, and mirroring is what
       * makes a 1-2 read as a 1-2 rather than as two unrelated swings.
       *
       * The weight comes from the **chest rotating behind the fist**, not from
       * arm speed. `chest.rotation.y` positive drives the right shoulder
       * forward, so the sign follows whichever arm is punching and the torso
       * unwinds through the strike. The step forward lives in the move data.
       */
      case 'mkPunchR':
      case 'mkPunchL': {
        const right = kind === 'mkPunchR';
        const pArm = right ? this.arms.r : this.arms.l;
        const offA = right ? this.arms.l : this.arms.r;
        const sg = right ? 1 : -1;

        /**
         * Held chamber then release — the same curve the stabs use, for the
         * same reason: a plain ramp is most of the way extended on frame one
         * and the fist never appears to travel.
         */
        const w = clamp(phase + 1, 0, 1);
        const drive = phase < 0 ? clamp((w - 0.30) / 0.70, 0, 1)
          : 1 - Math.max(0, phase) * 0.80;

        // Chambered at the ribs, fired straight out at chest height. 1.52 on
        // the dial is horizontal, and the elbow locks behind it.
        pArm.shoulder.rotation.z = lerp(0.44, 1.52, drive);
        pArm.shoulder.rotation.y = sg * lerp(0.34, -0.10, drive);
        pArm.shoulder.rotation.x = sg * 0.10;
        pArm.elbow.rotation.z = lerp(2.25, 0.04, drive);
        pArm.hand.rotation.z = 0;

        // Off fist pulls back to the hip as the other goes out — the trade is
        // what stops him looking like he is reaching.
        offA.shoulder.rotation.z = lerp(1.20, 0.52, drive);
        offA.shoulder.rotation.y = -sg * 0.22;
        offA.shoulder.rotation.x = -sg * 0.24;
        offA.elbow.rotation.z = lerp(0.90, 1.85, drive);
        offA.hand.rotation.z = 0;

        // Torso unwinding behind the punch, and a small forward pitch into it.
        this.chest.rotation.y = sg * lerp(-0.40, 0.46, drive) * this.fighter.facing;
        this.pelvis.rotation.y = sg * lerp(-0.16, 0.22, drive) * this.fighter.facing;
        this.chest.rotation.z = lerp(0.10, -0.16, drive);
        this.neck.rotation.z = lerp(0.06, -0.10, drive);

        // Braced: front foot planted, back leg driving.
        this.legs.l.hip.rotation.z = lerp(-0.10, 0.30, drive);
        this.legs.r.hip.rotation.z = lerp(0.22, -0.18, drive);
        this.legs.l.knee.rotation.z = -0.26;
        this.legs.r.knee.rotation.z = -0.34;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05;
        break;
      }

      /**
       * Mega Knight forward tilt — the **unroll**.
       *
       * He starts with the left arm wrapped across his chest, elbow tight and
       * the mace tucked against the opposite shoulder, and then unwinds it
       * straight out. The whole read is the *uncoiling*: it has to start folded
       * across the body and finish fully extended along his own centre line, so
       * `shoulder.rotation.y` carries the arm from across him to square while
       * the elbow opens.
       *
       * On the **left** arm a negative `shoulder.y` pulls it inward across the
       * chest, which is where the coil lives.
       */
      case 'mkUnroll': {
        /**
         * Driven off **moveFrame**, not `phase`.
         *
         * `phase` is normalised against the hitbox window, so the sweep's timing
         * moved every time the window did — and the window has to be placed on
         * where the mace actually is, which made the two circular. Measured with
         * the box at [9,13], the arm had finished sweeping by frame 9 and the
         * active frames caught it on the way back in at 46 forward instead of at
         * its 95 peak. On its own clock the peak stays put and the box can be
         * put on it.
         *
         * **Fast**: a short chamber and a violent release, over well under half
         * the move. This is the one grounded normal meant to arrive before you
         * can react to it.
         */
        const total = (this.fighter.move && this.fighter.move.total) || 32;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.45), 0, 1);
        const snapOut = u * u * (3 - 2 * u);

        const a = this.arms.l;
        /**
         * A **sweep**, not a thrust, and swept the other way.
         *
         * The first version wound the arm across his chest and unrolled it
         * straight out in front, which is a punch — it read as the jab with more
         * damage on it, because mechanically that is what it was. This travels
         * the opposite way through a much wider arc: the fist starts out wide on
         * the far side, comes round through the front at full stretch, and
         * finishes across his body. The extremes of `shoulder.y` are what make
         * it an arc at all, and they are roughly double the old range.
         *
         * The elbow locks out **early** — by a third of the way in — so the
         * whole back half of the sweep happens at maximum extension. That is
         * where the distance comes from; an arm that is still unfolding at
         * contact has thrown away most of its reach.
         */
        a.shoulder.rotation.y = lerp(0.66, -0.78, snapOut);
        a.shoulder.rotation.z = lerp(1.30, 1.46, snapOut);
        a.shoulder.rotation.x = lerp(0.30, -0.34, snapOut);
        a.elbow.rotation.z = lerp(1.95, 0.02, Math.min(1, snapOut * 3));
        a.hand.rotation.z = 0;

        // Right mace thrown back as a counterweight — a wide swing needs
        // something going the other way or he reads as toppling into it.
        this.arms.r.shoulder.rotation.z = lerp(1.05, 0.62, snapOut);
        this.arms.r.shoulder.rotation.y = lerp(-0.20, 0.44, snapOut);
        this.arms.r.shoulder.rotation.x = 0.34;
        this.arms.r.elbow.rotation.z = lerp(1.10, 1.60, snapOut);
        this.arms.r.hand.rotation.z = 0;

        /**
         * The whole body turns through it. These are large — a sweep this wide
         * driven only from the shoulder looks like the arm came loose. Negative
         * `chest.rotation.y` drives the LEFT shoulder forward, so the torso
         * unwinds in the same direction as the arm.
         */
        this.chest.rotation.y = lerp(0.62, -0.74, snapOut) * this.fighter.facing;
        this.pelvis.rotation.y = lerp(0.30, -0.40, snapOut) * this.fighter.facing;
        this.chest.rotation.z = lerp(0.16, -0.22, snapOut);
        this.neck.rotation.z = lerp(0.10, -0.14, snapOut);

        // Steps through it rather than standing and reaching.
        this.legs.l.hip.rotation.z = lerp(-0.24, 0.40, snapOut);
        this.legs.r.hip.rotation.z = lerp(0.34, -0.22, snapOut);
        this.legs.l.knee.rotation.z = -0.22;
        this.legs.r.knee.rotation.z = -0.42;
        this.pelvis.position.y = this.p.hipY - this.H * 0.07;
        break;
      }

      /**
       * Mega Knight up tilt — a huge uppercut.
       *
       * One continuous rise from below his own knee to well past his helm, and
       * the range is meant to cover **both** the space in front of him and the
       * space above: the arm travels through the front on the way up, so the
       * hitbox is a tall capsule rather than a puck over his head.
       *
       * He sinks first. The dip is what gives the swing somewhere to come from,
       * and on a fighter this heavy the load is most of the readability.
       */
      case 'mkUppercut': {
        // On its own clock rather than `phase`, for the same reason the forward
        // tilt is: the box has to be placed on the measured swing, and `phase`
        // is derived from the box.
        const total = (this.fighter.move && this.fighter.move.total) || 42;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.40), 0, 1);
        const load = clamp(u / 0.30, 0, 1);
        const swing = u * u * (3 - 2 * u);

        /**
         * From down-and-**behind** to overhead, and the arm is locked out for
         * most of it.
         *
         * The first version ran 0.18 → 3.05 with the elbow still folding as it
         * rose, and the fist measured 59 forward at the bottom and 49 at the
         * top — it went almost straight up a wall. Starting at -0.55 puts the
         * chamber behind his hip, so the swing has to travel through the whole
         * space in front of him to get overhead, and locking the elbow by a
         * third of the way up means it does that at full radius. Stopping at
         * 2.72 rather than 3.05 leaves it forward of vertical at the top instead
         * of tipping back over his own head.
         */
        const a = this.arms.r;
        a.shoulder.rotation.z = lerp(-0.26, 2.86, swing);
        a.shoulder.rotation.y = 0.10;
        a.shoulder.rotation.x = 0.08;
        a.elbow.rotation.z = lerp(1.55, 0.02, Math.min(1, swing * 3));
        a.hand.rotation.z = 0;

        // Off arm counterweights downward — it is what keeps him from reading
        // as simply raising both arms.
        this.arms.l.shoulder.rotation.z = lerp(0.90, 0.34, swing);
        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.elbow.rotation.z = lerp(1.20, 1.60, swing);
        this.arms.l.hand.rotation.z = 0;

        // Sink, then drive up through the legs and open the chest.
        this.chest.rotation.z = lerp(0.24 * load, -0.22, swing);
        this.chest.rotation.y = lerp(-0.26, 0.30, swing) * this.fighter.facing;
        this.neck.rotation.z = lerp(0.10, -0.26, swing);

        const crouch = load * (1 - swing);
        this.legs.l.hip.rotation.z = lerp(0.16, -0.10, swing);
        this.legs.r.hip.rotation.z = lerp(0.10, -0.16, swing);
        this.legs.l.knee.rotation.z = -(0.30 + crouch * 0.80);
        this.legs.r.knee.rotation.z = -(0.34 + crouch * 0.80);
        this.pelvis.position.y = this.p.hipY - this.H * (0.16 * crouch + 0.02)
          + this.H * 0.05 * swing;
        break;
      }

      /**
       * Mega Knight down tilt — two mace slams into the floor, right then left.
       *
       * A 1-2 inside a single move, so it runs off `moveFrame` in halves rather
       * than off `phase`: `phase` is anchored to the first hitbox and would hold
       * at its plateau across both slams.
       *
       * **The maces have to actually reach the ground.** His shoulder sits high
       * enough that a straight-armed swing from a standing pose stops well short
       * of the floor, so the crouch is not decoration — it is what closes the
       * remaining distance. The depth here was solved against the measured
       * bottom of the mace, not chosen.
       */
      case 'mkFloorPound': {
        const total = (this.fighter.move && this.fighter.move.total) || 46;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.72), 0, 1);
        const half = u < 0.5 ? 0 : 1;
        const local = clamp(u * 2 - half, 0, 1);
        // Wind up over the first third of each half, slam over the rest.
        const raise = clamp(1 - local / 0.36, 0, 1);
        const hit = clamp((local - 0.30) / 0.34, 0, 1);
        const slam = hit * hit * (3 - 2 * hit);

        const lead = half === 0 ? this.arms.r : this.arms.l;
        const rest = half === 0 ? this.arms.l : this.arms.r;
        const sg = half === 0 ? 1 : -1;

        // Up over the shoulder, then straight down past his own knee. 0.02 on
        // the dial is very nearly hanging, which is as low as the joint goes.
        lead.shoulder.rotation.z = lerp(lerp(0.70, 2.30, raise), 0.62, slam);
        lead.shoulder.rotation.y = sg * 0.26;
        lead.shoulder.rotation.x = sg * 0.16;
        lead.elbow.rotation.z = lerp(lerp(0.60, 1.70, raise), 0.60, slam);
        lead.hand.rotation.z = 0;

        // The other stays low and planted, already having swung or waiting to.
        // Lifted clear of the deck: hanging straight down from a crouch this
        // deep put the idle mace 11 units into the stage.
        rest.shoulder.rotation.z = 0.46;
        rest.shoulder.rotation.x = -sg * 0.20;
        rest.elbow.rotation.z = 0.62;
        rest.hand.rotation.z = 0;

        /**
         * Bent down over the strike, with the arm **not** fully straightened.
         *
         * Solved against the measured underside of the mace. A straight arm
         * from his shoulder already reaches the deck standing up, so adding the
         * crouch on top drove the mace 27 units *through* the stage. Holding a
         * little angle in the shoulder and elbow gives the bend back without
         * the mace disappearing into the floor — it now lands just proud of it,
         * which is the read a slam wants.
         */
        const stoop = 0.55 + slam * 0.45;
        this.pelvis.position.y = this.p.hipY - this.H * 0.09 * stoop;
        this.pelvis.rotation.z = -0.16 * stoop;
        this.chest.rotation.z = -0.30 * stoop;
        this.chest.rotation.y = sg * lerp(-0.20, 0.28, slam) * this.fighter.facing;
        this.neck.rotation.z = 0.34 * stoop;

        // Wide, braced stance — he is not stepping, he is planting.
        this.legs.l.hip.rotation.z = 0.34;
        this.legs.r.hip.rotation.z = -0.14;
        this.legs.l.knee.rotation.z = -1.05 * stoop;
        this.legs.r.knee.rotation.z = -0.95 * stoop;
        break;
      }

      /**
       * Mega Knight forward smash — both maces driven forward together.
       *
       * The card's move. He rocks back with both arms folded up around head
       * height, then throws his whole body forward behind the pair of them.
       *
       * The two arms travel as a **matched pair** — same dial, same fold, only
       * mirrored in depth. That is the entire difference between this and a
       * two-handed swing: nothing crosses the centre line, nothing leads, and
       * the hands stay a shoulder-width apart the whole way. Driven off
       * `moveFrame` rather than `phase` so the contact point stays put when the
       * hitbox window is tuned.
       */
      case 'mkDoubleSmash': {
        const total = (this.fighter.move && this.fighter.move.total) || 58;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.34), 0, 1);
        const rock = Math.min(1, u / 0.42);
        const fire = clamp((u - 0.40) / 0.36, 0, 1);
        const drive = fire * fire * (3 - 2 * fire);

        /**
         * The whole body is the swing. He rocks back onto his heels through the
         * wind-up — `chest.rotation.z` positive is *back* — and then throws
         * everything forward, which is what makes this read as the heaviest
         * thing he owns rather than as a two-armed shove.
         */
        const chestLean = lerp(lerp(0.10, 0.46, rock), -0.42, drive);
        const hipLean = lerp(lerp(0, 0.24, rock), -0.26, drive);
        this.chest.rotation.z = chestLean;
        this.pelvis.rotation.z = hipLean;
        this.neck.rotation.z = lerp(lerp(0, 0.22, rock), -0.20, drive);

        /**
         * Chambered at head height with the elbows folded hard, then punched out
         * to full extension just below the shoulder.
         *
         * **The lean is added back into the dial.** The chest is a child of the
         * pelvis, so a forward pitch is subtracted from the arm's world angle —
         * and this move pitches nearly 0.7 radians forward at full drive.
         * Setting 1.44 and expecting a horizontal punch put the maces at height
         * 11, on the floor, pointing 43° down. Compensating keeps the strike
         * where it is aimed no matter how far he throws his weight into it.
         */
        const worldZ = lerp(lerp(1.30, 2.05, rock), 1.52, drive);
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = worldZ - (chestLean + hipLean);
          arm.shoulder.rotation.y = 0;
          // Angled inward at the strike so the two maces converge rather than
          // arriving a shoulder-width apart — the card has them almost touching.
          arm.shoulder.rotation.x = sign * lerp(0.42, -0.34, drive);
          arm.elbow.rotation.z = lerp(lerp(1.20, 2.30, rock), 0.02, drive);
          arm.hand.rotation.z = 0;
        }

        // Loads onto the back leg, then steps through onto the front.
        this.legs.l.hip.rotation.z = lerp(lerp(0, -0.34, rock), 0.46, drive);
        this.legs.r.hip.rotation.z = lerp(lerp(0, 0.30, rock), -0.30, drive);
        this.legs.l.knee.rotation.z = lerp(-0.20, -0.34, drive);
        this.legs.r.knee.rotation.z = lerp(-0.55 * rock, -0.30, drive);
        this.pelvis.position.y = this.p.hipY - this.H * (0.10 * rock * (1 - drive) + 0.04);
        break;
      }

      /**
       * Mega Knight up smash — both maces swept up the sides to meet overhead.
       *
       * He squares to the camera first. The maces start out wide at hip height
       * on either side and sweep up and inward to clap together above the helm,
       * so the move has to be seen face-on — side-on, the entire sweep happens
       * in depth and the silhouette never changes.
       *
       * The **scoops** are the low part of that arc, which is why they exist as
       * hitboxes at all: the maces genuinely pass through the space beside his
       * ankles on the way up. They are not a courtesy box bolted on.
       */
      case 'mkUpSmash': {
        const total = (this.fighter.move && this.fighter.move.total) || 54;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.52), 0, 1);
        const square = Math.min(1, u / 0.30);
        const lift = clamp((u - 0.34) / 0.46, 0, 1);
        const rise = lift * lift * (3 - 2 * lift);

        // Face the camera. Same trick the neutral air uses: a spread along his
        // own shoulder axis is invisible side-on and reads fully face-on.
        this.root.rotation.y += -this.fighter.facing * (Math.PI / 2) * square;

        /**
         * A **half circle about his own spine**, not a lift.
         *
         * `shoulder.x` swings the arm in the frontal plane — the one facing the
         * camera once he has squared up — so a single dial running from 0 to π
         * carries each mace from hanging at his hip, out through horizontal at
         * his side, and up to meet its partner above the helm. His body is
         * literally the centre of that rotation, which is the shape the move
         * wants.
         *
         * Two earlier attempts got this wrong in opposite directions. The first
         * used `shoulder.x` but stopped at 1.20, well short of `HALF_PI`, so the
         * arms froze in a crucifix at ankle height. The second gave up and used
         * `shoulder.z`, which raised them correctly but through the *sagittal*
         * plane — a front lift, with no sweep out to the sides at all. The dial
         * was right the first time; only its range was wrong.
         *
         * `shoulder.z` stays near zero throughout so nothing pulls the arc out
         * of that plane.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(0.20, 0.10, rise);
          arm.shoulder.rotation.x = -sign * lerp(0.34, 3.28, rise);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(0.60, 0.03, Math.min(1, rise * 2));
          arm.hand.rotation.z = 0;
        }

        // Sinks into the scoop and drives up out of it.
        this.chest.rotation.z = lerp(0.18, -0.10, rise);
        this.neck.rotation.z = lerp(0.10, 0.30, rise);
        const crouch = (1 - rise) * square;
        this.legs.l.hip.rotation.z = 0.12;
        this.legs.r.hip.rotation.z = -0.12;
        this.legs.l.knee.rotation.z = -(0.24 + crouch * 0.85);
        this.legs.r.knee.rotation.z = -(0.24 + crouch * 0.85);
        // Shallower than it was: at 0.15 the bottom of the arc put both maces
        // five units under the stage.
        this.pelvis.position.y = this.p.hipY - this.H * 0.09 * crouch
          + this.H * 0.05 * rise;
        break;
      }

      /**
       * Mega Knight down smash — both maces into the deck, one either side.
       *
       * The Wizard's shape, at his weight. Both arms come up together and drive
       * down simultaneously rather than one after the other, so it covers both
       * sides on the same frame and functions as a panic button.
       *
       * The reach into the floor is solved the same way the down tilt's was:
       * the crouch closes the distance and the arms deliberately stop short of
       * locking straight, because a straight arm from his shoulder already
       * reaches the deck standing up.
       */
      case 'mkFloorBoth': {
        const total = (this.fighter.move && this.fighter.move.total) || 56;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.36), 0, 1);
        const raise = Math.min(1, u / 0.44);
        const drop = clamp((u - 0.42) / 0.34, 0, 1);
        const slam = drop * drop * (3 - 2 * drop);

        /**
         * Squares to the camera. Both maces come down on opposite sides of him,
         * and side-on those two impacts are stacked in depth — one hides the
         * other and the move reads as a single slam. Face-on they land left and
         * right of him where you can see both.
         */
        this.root.rotation.y += -this.fighter.facing * (Math.PI / 2) * Math.min(1, u / 0.30);

        /**
         * Up over the shoulders, then down past the hips on opposite sides.
         * `shoulder.x` is what puts one each side — the dial itself only ever
         * takes them up and down.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(lerp(0.80, 2.15, raise), 0.58, slam);
          arm.shoulder.rotation.x = -sign * lerp(0.30, 0.92, slam);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(lerp(0.70, 1.60, raise), 0.55, slam);
          arm.hand.rotation.z = 0;
        }

        // Rises for the wind-up and stamps down through the strike.
        const stoop = 0.35 + slam * 0.65;
        this.pelvis.position.y = this.p.hipY - this.H * 0.13 * stoop
          + this.H * 0.04 * raise * (1 - slam);
        this.pelvis.rotation.z = -0.10 * stoop;
        this.chest.rotation.z = lerp(0.20 * raise, -0.26, slam);
        this.neck.rotation.z = 0.28 * slam;

        this.legs.l.hip.rotation.z = 0.30;
        this.legs.r.hip.rotation.z = -0.30;
        this.legs.l.knee.rotation.z = -0.95 * stoop;
        this.legs.r.knee.rotation.z = -0.95 * stoop;
        break;
      }

      /**
       * Mega Knight dash attack — a lunging headbutt.
       *
       * He drops his helm and throws himself at knee height. The point is the
       * **low** profile: it is the answer to a small fighter crouching under
       * everything else he has, so the head goes down to meet them rather than
       * the maces coming down from above.
       *
       * The maces trail back along his flanks — nothing about this move is
       * thrown with the arms, and holding them up in front would put them in
       * the way of the thing that is supposed to connect.
       */
      case 'mkHeadbutt': {
        const total = (this.fighter.move && this.fighter.move.total) || 40;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.42), 0, 1);
        const coil = Math.min(1, u / 0.30);
        const launch = clamp((u - 0.24) / 0.40, 0, 1);
        const dive = launch * launch * (3 - 2 * launch);

        /**
         * Pitched right over. `pelvis.rotation.z` negative is a forward lean,
         * and at -0.72 his shoulders are most of the way to horizontal — which
         * is what drops the helm to knee height without him leaving his feet.
         */
        this.pelvis.rotation.z = lerp(0.12 * coil, -0.72, dive);
        this.chest.rotation.z = lerp(0.16 * coil, -0.34, dive);
        // Chin tucked: the crown of the helm leads, not the face.
        this.neck.rotation.z = lerp(-0.10, -0.42, dive);

        // Arms swept back and low, out of the way.
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(lerp(1.10, 0.70, coil), -0.34, dive);
          arm.shoulder.rotation.x = sign * 0.34;
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(1.20, 0.45, dive);
          arm.hand.rotation.z = 0;
        }

        // Legs trailing behind the lunge.
        this.legs.l.hip.rotation.z = lerp(0.20, -0.44, dive);
        this.legs.r.hip.rotation.z = lerp(-0.10, -0.20, dive);
        this.legs.l.knee.rotation.z = lerp(-0.40, -0.85, dive);
        this.legs.r.knee.rotation.z = lerp(-0.50, -0.30, dive);
        this.pelvis.position.y = this.p.hipY - this.H * (0.14 * coil * (1 - dive) + 0.10 * dive);
        break;
      }

      /**
       * Mega Knight neutral air — a belly bash.
       *
       * The reference is King K. Rool's: the gut is the weapon, and everything
       * else gets out of its way. He arches hard so the belly is the leading
       * surface, then **trails all four limbs behind him** — arms swept back
       * past his hips, legs streaming out behind, head thrown back.
       *
       * The trailing is the whole read. An arched torso with the arms still in
       * front is a fighter falling over backwards; the same arch with nothing
       * ahead of the belly is a body check. `chest.rotation.z` positive leans
       * *back*, which is what pushes the gut forward.
       */
      case 'mkBellyBash': {
        const total = (this.fighter.move && this.fighter.move.total) || 42;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.30), 0, 1);
        const out = u * u * (3 - 2 * u);
        const settle = clamp((this.fighter.moveFrame - total * 0.52) / Math.max(1, total * 0.48), 0, 1);
        const arch = out * (1 - settle * 0.72);

        // The arch. Pelvis tips forward under him while the chest opens back,
        // which is what puts the belly out in front rather than just leaning.
        this.pelvis.rotation.z = lerp(0, -0.30, arch);
        this.chest.rotation.z = lerp(0.05, 0.72, arch);
        // Head stays level. Thrown back it read as a fighter losing his footing
        // rather than as a body check.
        this.neck.rotation.z = lerp(0, 0.10, arch);

        /**
         * **A T-pose, trailing.** The arms go out to his sides and *up* to near
         * horizontal, then sweep back behind the line of his shoulders.
         *
         * The first pass dropped them to -0.86 on the dial, which is behind him
         * but hanging — it read as a fighter with his arms limp at his sides.
         * Out and up is what clears the whole front of his body so the belly is
         * unmistakably the thing doing the hitting.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          /**
           * At exactly `HALF_PI` the arm points along the body's own z axis,
           * which a chest lean about z leaves untouched — so the T holds at
           * shoulder height no matter how hard he arches. The small negative on
           * the z dial is the only thing sweeping it back, and it has to stay
           * small: at -0.40 it dragged both arms down to hip height and the
           * pose read as limp rather than as trailing.
           */
          arm.shoulder.rotation.x = -sign * lerp(0.30, 1.52, arch);
          arm.shoulder.rotation.z = lerp(0.70, -0.12, arch);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(0.90, 0.16, arch);
          arm.hand.rotation.z = 0;
        }

        // Legs streaming out behind, knees loosely folded.
        for (const side of ['l', 'r']) {
          const leg = this.legs[side];
          const sign = side === 'r' ? 1 : -1;
          leg.hip.rotation.z = lerp(0.10, -0.78, arch);
          leg.hip.rotation.x = sign * 0.18 * arch;
          leg.knee.rotation.z = lerp(-0.30, -0.92, arch);
        }
        this.pelvis.position.y = this.p.hipY + this.H * 0.03 * arch;
        break;
      }

      /**
       * Mega Knight up air — a 1-2 overhead, right mace then left.
       *
       * Driven off `moveFrame` in halves, like every other multi-hit in his kit:
       * `phase` is anchored to the first hitbox and would plateau across both.
       *
       * The **eighth turn** is deliberately small. A quarter turn squares him to
       * the camera and flattens the swing into the screen plane; half of one
       * leaves him three-quarter on, which is enough to see both arms working
       * without losing the profile that says which way he is facing.
       */
      case 'mkUpDouble': {
        const total = (this.fighter.move && this.fighter.move.total) || 44;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.62), 0, 1);
        const half = u < 0.5 ? 0 : 1;
        const local = clamp(u * 2 - half, 0, 1);
        const draw = clamp((local - 0.20) / 0.52, 0, 1);
        const punch = draw * draw * (3 - 2 * draw);

        /**
         * **No turn at all.** An eighth turn looked better in isolation but it
         * pushed the two overhead punches onto different screen positions, and
         * a 1-2 whose halves land in different places cannot connect. Squared
         * to his facing, both maces come up through the same column.
         */

        const lead = half === 0 ? this.arms.r : this.arms.l;
        const rest = half === 0 ? this.arms.l : this.arms.r;
        const sg = half === 0 ? 1 : -1;

        // Chambered at the shoulder, driven straight up past the helm.
        lead.shoulder.rotation.z = lerp(0.75, 3.02, punch);
        lead.shoulder.rotation.x = sg * lerp(0.34, 0.10, punch);
        lead.shoulder.rotation.y = 0;
        lead.elbow.rotation.z = lerp(1.70, 0.03, Math.min(1, punch * 2));
        lead.hand.rotation.z = 0;

        // The other drops away to make room and to counterweight.
        rest.shoulder.rotation.z = lerp(1.30, 0.55, punch);
        rest.shoulder.rotation.x = -sg * 0.30;
        rest.elbow.rotation.z = lerp(0.80, 1.30, punch);
        rest.hand.rotation.z = 0;

        this.chest.rotation.y = sg * lerp(-0.22, 0.30, punch) * this.fighter.facing;
        this.chest.rotation.z = lerp(0.16, -0.14, punch);
        this.neck.rotation.z = lerp(0.06, -0.30, punch);

        // Legs tucked and trailing — nothing here is braced.
        this.legs.l.hip.rotation.z = lerp(0.30, 0.05, punch);
        this.legs.r.hip.rotation.z = lerp(0.05, 0.30, punch);
        this.legs.l.knee.rotation.z = -0.85;
        this.legs.r.knee.rotation.z = -0.70;
        break;
      }

      /**
       * Mega Knight forward air — a big overhand swing, thrown downward.
       *
       * Not the flat punch it was. The mace comes from **above and behind his
       * helm** and travels down and forward through a wide arc, which is what
       * gives the move its spike window: there is a stretch in the middle where
       * the head of the mace is genuinely travelling downward, and that is the
       * part that sends you at the floor.
       *
       * The arc is why the three hitboxes are placed the way they are — early
       * and late catch it on the way in and on the way out, the middle catches
       * it at the bottom of the swing.
       */
      case 'mkAirHammer': {
        const total = (this.fighter.move && this.fighter.move.total) || 44;
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.46), 0, 1);
        const wind = Math.min(1, u / 0.30);
        const fall = clamp((u - 0.24) / 0.52, 0, 1);
        const chop = fall * fall * (3 - 2 * fall);

        /**
         * 3.15 is straight up and a shade behind; -0.28 is past vertical on the
         * way down and slightly under him. Sweeping the whole way carries the
         * mace through the front at head height and out the bottom, which is a
         * far bigger arc than the old 1.5-radian punch.
         */
        const a = this.arms.r;
        a.shoulder.rotation.z = lerp(lerp(1.80, 3.15, wind), 0.34, chop);
        a.shoulder.rotation.y = 0.12;
        a.shoulder.rotation.x = 0.06;
        a.elbow.rotation.z = lerp(lerp(0.90, 1.40, wind), 0.03, Math.min(1, chop * 2.2));
        a.hand.rotation.z = 0;

        /**
         * Off arm **folded down along his ribs**, not raised. Held up as a
         * counterweight it sat directly in the path of the swing and the two
         * maces overlapped through the whole arc.
         */
        this.arms.l.shoulder.rotation.z = lerp(0.30, 0.16, chop);
        this.arms.l.shoulder.rotation.x = -0.16;
        this.arms.l.elbow.rotation.z = lerp(1.35, 1.62, chop);
        this.arms.l.hand.rotation.z = 0;

        // Body folds over the swing — the torso is where the power comes from.
        this.chest.rotation.z = lerp(lerp(0.10, 0.38, wind), -0.50, chop);
        this.pelvis.rotation.z = lerp(lerp(0, 0.16, wind), -0.28, chop);
        this.neck.rotation.z = lerp(0.10, -0.30, chop);

        this.legs.l.hip.rotation.z = lerp(-0.20, 0.42, chop);
        this.legs.r.hip.rotation.z = lerp(0.24, -0.16, chop);
        this.legs.l.knee.rotation.z = -0.55;
        this.legs.r.knee.rotation.z = -0.70;
        break;
      }

      /**
       * Mega Knight back air — the same backhand, thrown out of a spin.
       *
       * The turn is the addition. It runs on its **own clock and lands before
       * the arm extends** — the lesson from the Goblin's back kick, where
       * sharing one clock spread the revolution across the contact window and
       * carried the strike away from whatever it was aimed at.
       */
      case 'mkSpinBack': {
        const total = (this.fighter.move && this.fighter.move.total) || 44;
        /**
         * **The hit happens inside the spin, at the halfway mark.**
         *
         * The turn runs slowly across most of the move instead of snapping
         * shut early, and the arm reaches full stretch exactly as he passes
         * 180° — so he strikes mid-rotation and then carries on round. An
         * earlier version finished the spin first and struck afterwards, which
         * is two motions bolted together rather than one.
         */
        const u = clamp((this.fighter.moveFrame - 1) / Math.max(1, total * 0.82), 0, 1);
        const spin = u;
        this.root.rotation.y += -this.fighter.facing * Math.PI * 2 * spin;

        /** Peaks at the halfway point of the turn and eases off either side. */
        const out = 1 - Math.min(1, Math.abs(u - 0.50) / 0.24);

        /**
         * The arm extends **forward in body space**, and that is what makes it a
         * back air.
         *
         * Hitbox coordinates are in the fighter's *facing* frame, which the
         * render spin does not touch. At 180° through the turn his body-space
         * front is pointing back down the screen — so a forward reach is where
         * the rearward box actually is. Reaching backwards here would have put
         * the mace in front of him at the moment of contact.
         */
        const a = this.arms.l;
        a.shoulder.rotation.z = lerp(0.95, 1.52, out);
        a.shoulder.rotation.x = lerp(-0.34, -0.06, out);
        a.shoulder.rotation.y = 0;
        a.elbow.rotation.z = lerp(1.70, 0.03, Math.min(1, out * 1.6));
        a.hand.rotation.z = 0;

        // Other arm tucks in tight — a spin is faster with the mass close.
        this.arms.r.shoulder.rotation.z = lerp(0.90, 1.25, out);
        this.arms.r.shoulder.rotation.x = 0.42;
        this.arms.r.elbow.rotation.z = lerp(1.30, 1.80, out);
        this.arms.r.hand.rotation.z = 0;

        this.chest.rotation.z = lerp(0.14, -0.20, out);
        this.chest.rotation.y = lerp(0.30, -0.34, out) * this.fighter.facing;
        this.neck.rotation.z = lerp(0, 0.22, out);

        this.legs.l.hip.rotation.z = lerp(0.24, -0.30, out);
        this.legs.r.hip.rotation.z = lerp(-0.10, 0.34, out);
        this.legs.l.knee.rotation.z = -0.75;
        this.legs.r.knee.rotation.z = -0.95;
        break;
      }

      /**
       * Mega Knight down air — the deploy. A stall, then a fall.
       *
       * His arrival animation from Clash, turned into a move. Three beats, and
       * they are deliberately unequal in length:
       *
       * 1. **The hang.** Everything stops. He squares to the camera, hauls both
       *    maces up over his head and holds there — this is the frames the
       *    opponent gets to see it coming, and it is why the move is committal
       *    rather than free.
       * 2. **The plunge.** Straight down, fast, maces led out in front and
       *    below so they arrive first.
       * 3. **The arrival**, which is not in this pose at all — the crater and
       *    the landing are driven from the move's `onLand`.
       */
      case 'mkDeployDrop': {
        const mf = this.fighter.moveFrame;
        const hang = (this.fighter.move && this.fighter.move.stallFrames) || 16;
        const square = Math.min(1, mf / 6);
        const lift = clamp(mf / (hang * 0.7), 0, 1);
        const plunge = clamp((mf - hang) / 8, 0, 1);

        // Faces the camera for the hang, and stays there through the drop.
        this.root.rotation.y += -this.fighter.facing * (Math.PI / 2) * square;

        /**
         * Maces up over the helm during the hang, then thrown down and forward
         * for the drop — they lead the whole way down, which is what makes the
         * landing read as the maces arriving before he does.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(lerp(0.60, 2.90, lift), 0.44, plunge);
          arm.shoulder.rotation.x = -sign * lerp(0.30, 0.55, plunge);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(lerp(0.80, 0.35, lift), 0.05, plunge);
          arm.hand.rotation.z = 0;
        }

        // Curled up on the hang, then straightened into a spear on the way down.
        this.chest.rotation.z = lerp(lerp(0, 0.26, lift), -0.16, plunge);
        this.neck.rotation.z = lerp(0.20 * lift, -0.24, plunge);
        for (const side of ['l', 'r']) {
          const leg = this.legs[side];
          const sign = side === 'r' ? 1 : -1;
          leg.hip.rotation.z = lerp(lerp(0.20, 0.85, lift), 0.06, plunge);
          leg.hip.rotation.x = -sign * 0.16;
          leg.knee.rotation.z = lerp(lerp(-0.40, -1.40, lift), -0.12, plunge);
        }
        this.pelvis.position.y = this.p.hipY - this.H * 0.06 * lift * (1 - plunge);
        break;
      }

      /**
       * Mega Knight up B — the charged jump attack.
       *
       * Four beats in one pose, because they are one motion: he compresses on
       * the ground while charging, launches, rides up with the arms swept back,
       * and turns them over at the apex to come down maces-first.
       *
       * **The apex flip is the whole animation.** Going up and coming down look
       * identical without it, and the move reads as a hop rather than as a
       * launch and a landing. `f.vy` is what tells us which half we are in —
       * cleaner than a frame count, because how long the rise takes depends on
       * how long he charged.
       */
      case 'mkLeapSlam': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const launch = (f.move && f.move.charge && f.move.charge.frame) || 12;
        const load = clamp(mf / launch, 0, 1);
        const airborne = !f.grounded && mf > launch;
        /** 0 on the way up, 1 on the way down. */
        const falling = airborne ? clamp(f.vy / 9, 0, 1) : 0;
        const flight = airborne ? 1 : 0;

        // The compression. Deep, and deeper still the longer he holds it.
        const squat = load * (1 - flight);
        this.pelvis.position.y = this.p.hipY - this.H * 0.24 * squat;
        this.legs.l.knee.rotation.z = -(0.20 + squat * 1.30);
        this.legs.r.knee.rotation.z = -(0.20 + squat * 1.30);
        this.legs.l.hip.rotation.z = 0.30 * squat;
        this.legs.r.hip.rotation.z = 0.30 * squat;

        /**
         * Arms: tucked in the crouch, thrown back and out on the rise — the
         * neutral air's trailing T — then hauled forward and down at the apex
         * so the maces lead him into the floor.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          const rise = flight * (1 - falling);
          const drop = flight * falling;
          arm.shoulder.rotation.x = -sign * (0.24 + rise * 1.20 - drop * 0.10);
          arm.shoulder.rotation.z = lerp(lerp(0.90, 0.40, squat), -0.18, rise)
            + drop * 0.70;
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(lerp(1.10, 1.80, squat), 0.14, Math.max(rise, drop));
          arm.hand.rotation.z = 0;
        }

        // Curled forward on the way up, straightened into the drop.
        this.chest.rotation.z = lerp(0.34 * squat, 0, flight) + falling * -0.22;
        this.neck.rotation.z = 0.20 * squat - falling * 0.22;
        if (flight) {
          for (const side of ['l', 'r']) {
            this.legs[side].hip.rotation.z = lerp(0.95, 0.10, falling);
            this.legs[side].knee.rotation.z = lerp(-1.60, -0.16, falling);
          }
          this.pelvis.position.y = this.p.hipY;
        }
        break;
      }

      /**
       * Mega Knight down B — a cannonball, dropped or leapt into.
       *
       * The same shape either way: squared to the camera, curled up tight, and
       * driven down. What differs is only how he got there, and that lives in
       * the move data — from the ground he vaults forward first, from the air
       * he simply stops and drops.
       *
       * Tighter than the down air's deploy on purpose. That one is a spear with
       * the maces led out; this is a ball, and the difference is what tells the
       * two apart in the half second you get to react to either.
       */
      case 'mkCannonDrop': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const hang = (f.move && f.move.stallFrames) || 14;
        const square = Math.min(1, mf / 6);
        const curl = clamp(mf / (hang * 0.8), 0, 1);
        const drop = clamp((mf - hang) / 8, 0, 1);
        const ball = Math.max(curl * 0.8, drop);

        this.root.rotation.y += -this.fighter.facing * (Math.PI / 2) * square;

        // Knees to the chest, arms wrapped round them.
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const leg = this.legs[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(0.80, 1.62, ball);
          arm.shoulder.rotation.x = -sign * lerp(0.30, 0.46, ball);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(1.00, 2.35, ball);
          arm.hand.rotation.z = 0;
          leg.hip.rotation.z = lerp(0.20, 1.45, ball);
          leg.hip.rotation.x = -sign * 0.20 * ball;
          leg.knee.rotation.z = lerp(-0.40, -2.15, ball);
        }
        this.chest.rotation.z = lerp(0, -0.34, ball);
        this.neck.rotation.z = lerp(0, -0.40, ball);
        this.pelvis.position.y = this.p.hipY - this.H * 0.12 * ball;
        break;
      }

      /**
       * Mega Knight side B — the hug. Arms wide, then shut.
       *
       * A command grab has to *look* like one from the first frame or it is
       * indistinguishable from a punch, so the opening is as wide as the rig
       * allows: both arms out to the sides and slightly forward, which is a
       * silhouette nothing else in his kit makes. The close is fast.
       */
      case 'mkHug': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const total = (f.move && f.move.total) || 40;
        const open = clamp(mf / (total * 0.24), 0, 1);
        const shut = clamp((mf - total * 0.26) / (total * 0.14), 0, 1);
        const clamp01 = shut * shut * (3 - 2 * shut);

        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          // Wide open, then swept in until the maces nearly touch in front.
          arm.shoulder.rotation.x = -sign * lerp(0.30, lerp(1.36, 0.10, clamp01), open);
          arm.shoulder.rotation.z = lerp(0.90, lerp(1.30, 1.46, clamp01), open);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(1.20, lerp(0.30, 0.65, clamp01), open);
          arm.hand.rotation.z = 0;
        }

        this.chest.rotation.z = lerp(0.16 * open, -0.24, clamp01);
        this.neck.rotation.z = lerp(0.10, -0.16, clamp01);
        this.legs.l.hip.rotation.z = lerp(-0.14, 0.30, clamp01);
        this.legs.r.hip.rotation.z = lerp(0.20, -0.14, clamp01);
        this.legs.l.knee.rotation.z = -0.28;
        this.legs.r.knee.rotation.z = -0.40;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05;
        break;
      }

      /**
       * Mega Knight side B follow-up — carrying them forward and slamming down.
       *
       * The victim is held by the throw machinery at his hold offset, so this
       * only has to place *him*: crouched with them gathered in, launched
       * forward, then pitched over so he lands on top of the slam rather than
       * beside it.
       */
      case 'mkBodySlam': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const rel = (f.move && f.move.releaseFrame) || 24;
        const gather = clamp(mf / 8, 0, 1);
        const leap = clamp((mf - 8) / 8, 0, 1);
        const plant = clamp((mf - (rel - 6)) / 8, 0, 1);

        // Arms clamped in front the whole way — they are holding someone.
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(1.35, 1.10, plant);
          arm.shoulder.rotation.x = -sign * 0.14;
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(0.80, 0.40, plant);
          arm.hand.rotation.z = 0;
        }

        // Crouch, extend into the leap, then pitch hard forward onto the slam.
        this.pelvis.position.y = this.p.hipY
          - this.H * (0.20 * gather * (1 - leap) + 0.18 * plant);
        this.pelvis.rotation.z = lerp(0.10 * gather, -0.52, plant);
        this.chest.rotation.z = lerp(lerp(0.20, -0.10, leap), -0.34, plant);
        this.neck.rotation.z = lerp(0.10, -0.30, plant);

        for (const side of ['l', 'r']) {
          const leg = this.legs[side];
          leg.hip.rotation.z = lerp(lerp(0.34, -0.30, leap), 0.50, plant);
          leg.knee.rotation.z = lerp(lerp(-1.10, -0.30, leap), -1.05, plant);
        }
        break;
      }

      /**
       * Mega Knight neutral B — the stomp.
       *
       * He turns a little off-square, rocks back onto his right leg with the
       * left knee lifted high, then drives that foot into the deck. The lift is
       * what the move is: a stomp with no wind-up is a step, and the shockwaves
       * that follow have to look like they were caused by something.
       */
      case 'mkStomp': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const hit = (f.move && f.move.stompFrame) || 16;
        const rear = clamp(mf / (hit - 2), 0, 1);
        const wind = rear * rear * (3 - 2 * rear);
        const down = clamp((mf - (hit - 3)) / 4, 0, 1);
        const stomp = down * down * (3 - 2 * down);

        // A small turn off his facing, so the raised knee reads.
        this.root.rotation.y += -this.fighter.facing * 0.42 * Math.min(1, mf / 6);

        // Left knee up and out, then driven straight down past his own hip.
        this.legs.l.hip.rotation.z = lerp(lerp(0.10, 1.35, wind), -0.16, stomp);
        this.legs.l.knee.rotation.z = lerp(lerp(-0.30, -1.75, wind), -0.06, stomp);
        this.legs.l.hip.rotation.x = -0.24 * wind;
        // Right leg carries him, straightening as he drives down.
        this.legs.r.hip.rotation.z = lerp(lerp(0, 0.24, wind), -0.05, stomp);
        this.legs.r.knee.rotation.z = lerp(lerp(-0.24, -0.70, wind), -0.20, stomp);

        // Leans back over the standing leg, then drops his weight through it.
        this.pelvis.rotation.z = lerp(lerp(0, 0.26, wind), -0.14, stomp);
        this.chest.rotation.z = lerp(lerp(0.06, 0.34, wind), -0.24, stomp);
        this.neck.rotation.z = lerp(0.16 * wind, -0.18, stomp);

        // Maces out for balance on the lift, thrown down with the stomp.
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.x = -sign * lerp(0.26, lerp(0.95, 0.34, stomp), wind);
          arm.shoulder.rotation.z = lerp(lerp(0.85, 1.15, wind), 0.30, stomp);
          arm.shoulder.rotation.y = 0;
          arm.elbow.rotation.z = lerp(lerp(1.05, 0.70, wind), 0.90, stomp);
          arm.hand.rotation.z = 0;
        }

        // Rises onto the standing leg, then drops hard through the impact.
        this.pelvis.position.y = this.p.hipY
          + this.H * 0.05 * wind * (1 - stomp)
          - this.H * 0.16 * stomp;
        break;
      }

      /**
       * Mega Knight neutral B in the air — hang, then drive one mace down.
       *
       * The grounded stomp's shape compressed into something small and precise.
       * He tucks, holds for a moment, and spears a single mace straight below
       * him — one arm, not two, because this is a needle rather than the wall
       * of shockwaves the ground version puts out, and the silhouette should
       * say so before the hitbox does.
       */
      case 'mkStompAir': {
        const f = this.fighter;
        const mf = f.moveFrame;
        const hang = 12;
        const tuck = clamp(mf / (hang * 0.6), 0, 1);
        const drive = clamp((mf - hang) / 5, 0, 1);
        const stab = drive * drive * (3 - 2 * drive);

        // Curled through the hang, then speared out for the drop.
        this.legs.r.hip.rotation.z = lerp(lerp(0.20, 1.25, tuck), -0.10, stab);
        this.legs.r.knee.rotation.z = lerp(lerp(-0.40, -1.90, tuck), -0.05, stab);
        this.legs.l.hip.rotation.z = lerp(0.30, 0.95, tuck) * (1 - stab * 0.4);
        this.legs.l.knee.rotation.z = lerp(-0.60, -1.70, tuck);

        // Driving mace punched straight down; the other stays tucked.
        this.arms.r.shoulder.rotation.z = lerp(lerp(1.05, 1.70, tuck), 0.06, stab);
        this.arms.r.shoulder.rotation.x = 0.10;
        this.arms.r.elbow.rotation.z = lerp(lerp(1.10, 1.85, tuck), 0.04, stab);
        this.arms.r.hand.rotation.z = 0;
        this.arms.l.shoulder.rotation.z = lerp(1.00, 1.50, tuck);
        this.arms.l.shoulder.rotation.x = -0.36;
        this.arms.l.elbow.rotation.z = lerp(1.20, 2.05, tuck);
        this.arms.l.hand.rotation.z = 0;

        this.chest.rotation.z = lerp(lerp(0.10, 0.32, tuck), -0.24, stab);
        this.neck.rotation.z = lerp(0.14 * tuck, -0.26, stab);
        this.pelvis.position.y = this.p.hipY - this.H * 0.08 * tuck * (1 - stab);
        break;
      }

      case 'goblinBackKick': {
        const a = sweep;
        /**
         * The turn is on its own clock and lands **before** the leg goes out.
         * Sharing one clock spread the revolution across the contact window:
         * the measured foot ran from 38 behind him at the start of the window
         * to 12 in *front* of him by the end, because the spin was carrying the
         * kick away from whatever it was aimed at. Wind, then strike.
         */
        const spinT = clamp(a / 0.60, 0, 1);
        const spin = spinT * spinT * (3 - 2 * spinT);
        this.root.rotation.y += -this.fighter.facing * Math.PI * 2 * spin;

        const out = phase < 0 ? Math.min(1, (phase + 1) * 2.6) : 1 - Math.max(0, phase) * 0.72;

        /**
         * Negative on the hip dial trails the leg behind him; -2.05 is past
         * horizontal, which is what gives the "as far as possible" read. The
         * knee straightens to almost nothing and `hip.rotation.x` cants the
         * whole leg slightly upward at the end of the stretch.
         */
        this.legs.r.hip.rotation.z = lerp(-0.24, -1.80, out);
        this.legs.r.knee.rotation.z = lerp(-1.55, -0.02, out);
        this.legs.r.hip.rotation.x = -0.26 * out;

        // Support leg tucked tight along the body, not merely trailing.
        this.legs.l.hip.rotation.z = lerp(0.24, 1.30, out);
        this.legs.l.knee.rotation.z = lerp(-0.60, -2.20, out);
        this.legs.l.hip.rotation.x = 0.14 * out;

        /**
         * Both arms forward — the direction *opposite* the kick. Low numbers on
         * the shoulder dial are down and ahead, so they swing down and across
         * as the leg goes back, and the elbows fold to keep them off the hips.
         */
        for (const side of ['l', 'r']) {
          const arm = this.arms[side];
          const sign = side === 'r' ? 1 : -1;
          arm.shoulder.rotation.z = lerp(0.95, 0.30, out);
          arm.shoulder.rotation.y = -sign * 0.26 * out;
          arm.shoulder.rotation.x = sign * 0.34 * out;
          arm.elbow.rotation.z = lerp(1.20, 1.70, out);
          arm.hand.rotation.z = 0;
        }

        /**
         * Torso pitches forward as the leg goes back — `chest.rotation.z`
         * positive leans *back*, so the forward lean is the negative side.
         */
        this.chest.rotation.z = lerp(0.08, -0.52, out);
        this.pelvis.rotation.z = lerp(0.0, -0.14, out);

        /**
         * Head turns to look down the leg. The neck's z tips the head back,
         * which from a forward-pitched chest points the face behind him — at
         * exactly what he is kicking.
         */
        this.neck.rotation.z = lerp(0, 0.78, out);
        this.pelvis.position.y = this.p.hipY + this.H * 0.05 * out;
        break;
      }

      case 'ramSlam': {
        const mf = this.fighter.moveFrame;
        const slam = clamp(mf / 9, 0, 1);
        const spent = clamp((mf - 9) / 20, 0, 1);

        // Arms drive down out of the carry and then hang, heavy.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(2.92, 0.34, slam) - spent * 0.22;
          arm.elbow.rotation.z = lerp(0.22, 1.05, slam) + spent * 0.40;
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.18 * (1 - slam);
        this.arms.l.shoulder.rotation.y = -0.18 * (1 - slam);

        // Doubled over the throw, then sagging further as it costs him.
        this.pelvis.position.y = this.p.hipY - this.H * (0.10 * slam + 0.09 * spent);
        this.pelvis.rotation.z = -0.26 * slam;
        this.chest.rotation.z = -0.22 * slam - 0.20 * spent;
        this.neck.rotation.z = 0.18 * slam + 0.26 * spent;

        // Braced wide on the landing leg.
        this.legs.l.hip.rotation.z = lerp(0.16, 0.58, slam);
        this.legs.r.hip.rotation.z = lerp(0.06, -0.28, slam);
        this.legs.l.knee.rotation.z = lerp(-0.26, -0.88, slam);
        this.legs.r.knee.rotation.z = lerp(-0.26, -0.50, slam);
        this.carryWeapon();
        break;
      }
      case 'ramCharge': {
        const fire = this.fighter.move.costFrame || 18;
        const mf = this.fighter.moveFrame;
        const hoist = clamp(mf / fire, 0, 1);
        const eased = hoist * hoist * (3 - 2 * hoist);

        /**
         * Both fists on the shaft, and the **sword put away** — a blade still in
         * his right hand reads as carrying a two-handed log one-handed, and it
         * is not in his hands in the card either.
         *
         * Because the sword is gone, `carryWeapon` is not called at all: it
         * exists to keep a held weapon sensible, and calling it here would drag
         * the right arm back down to the hip it wants swords at.
         */
        this.setWeaponVisible(false);
        const reach = lerp(1.10, 2.92, eased);
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = reach;
          arm.elbow.rotation.z = lerp(1.20, 0.22, eased);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.20 * eased;
        this.arms.l.shoulder.rotation.y = -0.20 * eased;

        /**
         * It weighs on him. He sinks into his knees and hunches forward, and
         * stays there for the whole charge — a carry that straightens up mid
         * run stops looking heavy the moment it does.
         */
        this.pelvis.position.y = this.p.hipY - this.H * 0.15 * eased;
        this.pelvis.rotation.z = -0.20 * eased;      // negative pitches forward
        this.chest.rotation.z = -0.26 * eased;
        this.neck.rotation.z = 0.30 * eased;         // chin up to see past it

        /**
         * Legs run on the shared gait phase, which is already advanced from
         * `|vx|` before the pose runs — so the cadence comes out of how fast
         * the ram is actually carrying him, not a hand-picked rate.
         */
        const ph = this.walkPhase;
        const swing = Math.sin(ph) * eased;
        const lift = Math.max(0, -Math.cos(ph)) * eased;
        this.legs.l.hip.rotation.z = 0.30 * eased + swing * 0.78;
        this.legs.r.hip.rotation.z = 0.30 * eased - swing * 0.78;
        this.legs.l.knee.rotation.z = -0.40 - Math.max(0, -swing) * 1.05 - lift * 0.35;
        this.legs.r.knee.rotation.z = -0.40 - Math.max(0, swing) * 1.05 - lift * 0.35;

        /**
         * Seated **last**, and on his fists rather than above them.
         *
         * The height is read from where the hands actually finish rather than
         * picked, so the shaft's underside meets them: the centre line is a log
         * radius up from the grip.
         *
         * This has to be the final thing the pose does. The duck lowers the
         * pelvis, and the pelvis carries the arms — computing the ram before it
         * seats the ram on hands that are about to drop 16 units, which is
         * exactly the gap that had it floating over his head.
         */
        if (this.ram) {
          this.ram.visible = true;
          // World matrices only refresh at render time, after every pose has
          // run, so the chain has to be brought current before it is read.
          this.arms.l.hand.updateWorldMatrix(true, false);
          this.arms.r.hand.updateWorldMatrix(true, false);
          const grip = Math.min(
            this.arms.l.hand.getWorldPosition(_ramGrip).y,
            this.arms.r.hand.getWorldPosition(_ramGrip2).y,
          ) - this.root.position.y;
          const shaftR = this.W * 0.27;
          this.ram.position.set(this.W * 0.16, grip + shaftR * 0.72, 0);
          this.ram.rotation.z = lerp(-0.55, -0.13, eased);
        }
        break;
      }
      case 'barrelRoll': {
        const a = sweep;
        const facing = this.fighter.facing;
        // Held back so the leap into the barrel reads before the roll starts.
        const roll = clamp((a - 0.14) / 0.86, 0, 1);
        /** How far he is into the barrel: 0 standing, 1 fully aboard. */
        const t = clamp(a / 0.13, 0, 1) * (1 - clamp((phase - 0.02) / 0.35, 0, 1));

        /**
         * He lies **along** the barrel's axis and log-rolls with it, head out of
         * one open end and feet out of the other — not tumbling head over heels
         * across it.
         *
         * That orientation is three turns in sequence: spin about his own long
         * axis, lay that axis down from vertical, then swing it off pure depth
         * so the camera sees both ends rather than staring down the near one. It
         * is a `Y · X · Y` composition, which no Euler triple can express, so it
         * is built from quaternions and slerped in from the standing pose.
         */
        const spin = -facing * roll * Math.PI * 4;
        const tilt = facing > 0 ? BARREL_TILT : -BARREL_TILT;
        _qSpin.setFromAxisAngle(AXIS_Y, spin);
        _qLay.setFromAxisAngle(AXIS_X, HALF_PI);
        _qTilt.setFromAxisAngle(AXIS_Y, tilt);
        _qTilt.multiply(_qLay).multiply(_qSpin);
        _eStand.set(0, this.root.rotation.y, 0);
        _qStand.setFromEuler(_eStand);
        // Shortest-arc blend, so the leap in never sweeps the long way round.
        this.root.quaternion.slerpQuaternions(_qStand, _qTilt, t);

        /**
         * The barrel is thrown, not placed: it appears in the air and bounces
         * twice, each lower than the last, before settling into the roll. The
         * whole arc is presentation — the simulation has him grounded the whole
         * way, so this never affects where his hitbox is.
         */
        const hop = (u) => {
          const arc = (from, to, peak) =>
            u < from || u > to ? null
              : peak * 4 * ((u - from) / (to - from)) * (1 - (u - from) / (to - from));
          if (u < 0.08) return 0;
          if (u < 0.20) { const k = (u - 0.08) / 0.12; return this.H * 0.30 * (1 - k * k); }
          return arc(0.20, 0.38, this.H * 0.20)
            ?? arc(0.38, 0.52, this.H * 0.09)
            ?? 0;
        };

        /**
         * Ride height is the barrel's radius, and he sits at its **midpoint**
         * along the axis, so the offsets are the half-body projected onto the
         * tilted axis. Getting this wrong leaves him beside the barrel rather
         * than inside it.
         */
        const R = this.W * 0.58;
        const half = this.H * 0.5;
        this.root.position.x -= half * Math.sin(tilt) * t;
        this.root.position.y += (R + hop(a)) * t;
        this.root.position.z -= half * Math.cos(tilt) * t;

        if (this.barrel) {
          this.barrel.visible = a > 0.06 && phase < 0.04;
          // Its own axis is built along z, so a quarter turn puts it on his.
          this.barrel.rotation.set(-HALF_PI, 0, 0);
          this.barrel.position.set(0, half, 0);
        }

        /**
         * Straight as a plank. He is a passenger, and anything folded disappears
         * inside the staves — only what clears the two ends is ever on screen.
         */
        for (const leg of [this.legs.l, this.legs.r]) {
          leg.hip.rotation.z = lerp(0.20, 0.04, t);
          leg.knee.rotation.z = lerp(-0.45, -0.03, t);
        }
        this.legs.l.hip.rotation.x = 0.13 * t;
        this.legs.r.hip.rotation.x = -0.13 * t;

        // Arms pinned along his sides, inside the barrel and out of the way.
        for (const arm of [this.arms.l, this.arms.r]) {
          arm.shoulder.rotation.z = lerp(0.30, 0.10, t);
          arm.elbow.rotation.z = lerp(0.40, 0.30, t);
          arm.hand.rotation.z = 0;
        }
        this.arms.r.shoulder.rotation.y = 0.14 * t;
        this.arms.l.shoulder.rotation.y = -0.14 * t;

        this.chest.rotation.z = 0;
        this.neck.rotation.z = 0;
        break;
      }
      // Down tilt: a low kick off the front foot, weight rocked back onto the
      // other. The bat is not involved, so the weapon arm just carries it.
      case 'lowKick': {
        this.poseCrouch(0.42);
        this.chest.rotation.z = lerp(0.20, -0.32, t);
        // A kick snaps out, holds through the active frames, then pulls back
        // in — it does not ease through contact the way a swing does, and
        // leaving the leg hanging out for the recovery looks like a freeze.
        const kick = phase < 0 ? Math.min(1, (phase + 1) * 2.2) : 1 - Math.max(0, phase) * 0.92;
        this.legs.l.hip.rotation.z = lerp(-0.45, 1.30, kick);
        this.legs.l.knee.rotation.z = lerp(-1.25, -0.04, kick);
        this.legs.r.hip.rotation.z = lerp(0.30, -0.10, t);
        this.legs.r.knee.rotation.z = -0.55;
        this.arms.l.shoulder.rotation.z = lerp(-0.30, -0.95, t);
        this.arms.l.elbow.rotation.z = 0.5;
        this.arms.r.shoulder.rotation.z = -0.25;
        this.carryWeapon(-0.25);
        this.pelvis.position.y = this.p.hipY - this.H * 0.16;
        break;
      }
      /**
       * Forward smash — a two-handed baseball swing.
       *
       * Same horizontal-plane trick as the jab and forward tilt, but both arms
       * travel together so the hands read as sharing the grip, and the arc is
       * wider on both ends. The turn comes from the hips: chest y carries the
       * arms round, the pelvis follows, and she steps into it.
       */
      case 'batSwing2H': {
        const arc = 1.55;
        const from = HALF_PI - arc;
        const to = HALF_PI + arc;
        const swingZ = lerp(from, to, t);

        this.arms.r.shoulder.rotation.x = 1.38;
        this.arms.r.shoulder.rotation.z = swingZ;
        this.arms.r.elbow.rotation.z = lerp(-1.45, -0.03, snap);
        this.arms.r.hand.rotation.z = 0;

        /**
         * Both hands on the bat through the swing, one at the end.
         *
         * The off hand has to reach *across* to meet the other: the shoulders
         * sit either side of the body, so matching the weapon arm's rotation
         * leaves the hands a shoulder-width apart in depth and it reads as two
         * arms swinging in parallel rather than as a grip. A larger x rotation
         * pulls it over. It lets go partway through the follow-through, the way
         * a real swing finishes.
         */
        const grip = 1 - clamp((phase - 0.22) / 0.42, 0, 1);
        this.arms.l.shoulder.rotation.x = lerp(-0.18, 2.05, grip);
        this.arms.l.shoulder.rotation.z = lerp(-0.35, swingZ - 0.10, grip);
        this.arms.l.elbow.rotation.z = lerp(-0.55, lerp(-1.55, -0.18, snap), grip);

        this.chest.rotation.y = lerp(-0.62, 0.62, t);
        this.chest.rotation.z = lerp(-0.22, 0.24, t);
        this.pelvis.rotation.y = lerp(-0.34, 0.36, t);
        this.legs.l.hip.rotation.z = lerp(-0.30, 0.60, t);
        this.legs.r.hip.rotation.z = lerp(0.30, -0.40, t);
        this.legs.l.knee.rotation.z = lerp(-0.50, -0.10, t);
        this.pelvis.position.y = this.p.hipY - this.H * 0.08 * s;
        break;
      }

      /**
       * Up smash — a jumping swoop, reaching high with the bat.
       *
       * She turns *away* from the camera as she goes up, following the swing
       * round: the opposite sign to the up tilt's pivot, which turns her
       * towards it. Reaching straight overhead survives that rotation — the
       * vertical stays vertical at any yaw — so the swing stays readable while
       * the body spins under it.
       */
      case 'swoopUp': {
        const a = sweep;
        /**
         * A quarter turn through the swing, and the bat follows it round.
         *
         * She starts side-on with the bat low, then rotates 90 degrees as the
         * arm comes up, so the swing and the body turn are one movement rather
         * than a spin with an arm waving inside it. As with the up tilt the
         * shoulder cancels the yaw, which is what keeps the rising arc across
         * the screen instead of rotating away from the camera with her.
         */
        const turn = Math.min(1, a * 1.35) * (1 - Math.max(0, phase) * 0.85);
        const turnRad = HALF_PI * turn;
        this.root.rotation.y += -this.fighter.facing * turnRad;

        /**
         * Same plane as the up tilt: swept on shoulder z, so the bat travels
         * from in front of her, up past vertical, and finishes over her head
         * rather than out to one side. Holding the arm off her flank on x kept
         * it clear of her shoulder; sweeping *on* x is what threw it sideways.
         *
         * Starts far lower than it used to — down by her knee rather than
         * already half raised — so the upward sweep is the whole move.
         */
        this.arms.r.shoulder.rotation.y = this.fighter.facing * turnRad;
        this.arms.r.shoulder.rotation.z = lerp(0.12, 3.55, a);
        this.arms.r.shoulder.rotation.x = 0.20;
        // Coils with the bat carried *up*, not cocked down: she is crouched at
        // this point, and a bat cocked behind a crouch reaches under the floor.
        // Straight by the time the swing is underway and straight from there on.
        this.arms.r.elbow.rotation.z = lerp(1.35, -0.03, Math.min(1, a * 1.7));
        this.arms.r.hand.rotation.z = 0;
        // Off arm stays down and out of it. Only one hand is swinging.
        this.arms.l.shoulder.rotation.x = -0.25;
        this.arms.l.shoulder.rotation.z = lerp(0.20, -0.35, a);
        this.arms.l.elbow.rotation.z = lerp(-0.5, -0.25, a);

        this.chest.rotation.z = lerp(0.26, -0.16, a);
        // Coils down into the crouch, then everything extends off the ground.
        this.legs.l.hip.rotation.z = lerp(0.55, -0.12, a);
        this.legs.r.hip.rotation.z = lerp(0.55, 0.20, a);
        this.legs.l.knee.rotation.z = lerp(-1.05, -0.12, a);
        this.legs.r.knee.rotation.z = lerp(-1.05, -0.45, a);
        this.pelvis.position.y = this.p.hipY - this.H * 0.20 * (1 - a);
        break;
      }

      /**
       * Down smash — a splits kick, both legs out along the floor.
       *
       * The legs go to full opposite extension and the pelvis drops to meet
       * the ground, so the silhouette is a flat line either side of her. Hands
       * plant for the weight, which is also what keeps the bat out of the way.
       */
      case 'splits': {
        const drop = phase < 0 ? Math.min(1, (phase + 1) * 2.4) : 1 - Math.max(0, phase) * 0.9;
        this.legs.l.hip.rotation.z = lerp(-0.20, 1.62, drop);
        this.legs.r.hip.rotation.z = lerp(0.20, -1.62, drop);
        this.legs.l.knee.rotation.z = lerp(-0.55, -0.02, drop);
        this.legs.r.knee.rotation.z = lerp(-0.55, -0.02, drop);
        this.pelvis.position.y = this.p.hipY - this.H * 0.40 * drop;
        this.chest.rotation.z = lerp(0.05, 0.30, drop);
        this.arms.l.shoulder.rotation.z = lerp(-0.20, 1.05, drop);
        this.arms.l.elbow.rotation.z = -0.35;
        // Shoulder the bat rather than planting that hand: with the pelvis this
        // low, an arm reaching for the floor puts the bat straight through it.
        this.carryWeapon(lerp(-0.20, -0.30, drop));
        break;
      }

      /**
       * Dash attack — a lunging smack. Overhead at the start, driven down to
       * the floor by the end, so the arc runs top to bottom while she is still
       * carrying her dash momentum forward.
       *
       * On `sweep`, so the bat reaches the floor on the last active frame
       * rather than somewhere in the recovery.
       */
      case 'chopDown': {
        const a = sweep;
        // Starts with the bat held straight overhead — pi on the shoulder dial
        // is vertical — and drives it down to the floor. The swing bottoms out
        // *at* the ground, not through it: the bat runs well past the fist, so
        // an arm taken all the way to vertical-down buries it. Recovery then
        // lifts the arm back out, or it drags for every frame after the hit.
        const recover = Math.max(0, phase);
        // Smoothstepped, not linear: it holds the bat overhead at the start,
        // accelerates through the middle and settles at the floor. A linear
        // sweep is already 40 degrees off vertical by the second frame, so the
        // raised-bat silhouette never actually reads.
        const chop = a * a * (3 - 2 * a);
        this.arms.r.shoulder.rotation.z = lerp(Math.PI, 0.42, chop) + recover * 0.95;
        this.arms.r.shoulder.rotation.x = lerp(0.0, -0.05, chop);
        this.arms.r.elbow.rotation.z = lerp(0.0, -0.03, Math.min(1, chop * 1.8));
        this.arms.r.hand.rotation.z = 0;
        this.arms.l.shoulder.rotation.z = lerp(2.40, 0.10, chop) + recover * 0.5;
        this.arms.l.elbow.rotation.z = lerp(-0.9, -0.2, chop);

        this.chest.rotation.z = lerp(-0.30, 0.46, chop);
        this.pelvis.rotation.z = lerp(-0.08, 0.16, chop);

        /**
         * Lands it on one knee. Ramps in over the back half of the swing so
         * the drop arrives with the bat rather than ahead of it — the leading
         * leg plants forward, the trailing knee folds under her to the floor.
         */
        const kneel = clamp((a - 0.42) / 0.58, 0, 1);
        this.legs.l.hip.rotation.z = lerp(-0.55, 0.80, kneel);
        this.legs.l.knee.rotation.z = lerp(-0.85, -0.30, kneel);
        this.legs.r.hip.rotation.z = lerp(0.45, -0.85, kneel);
        this.legs.r.knee.rotation.z = lerp(-0.35, -2.05, kneel);
        this.pelvis.position.y = this.p.hipY - this.H * 0.34 * kneel;
        break;
      }

      /**
       * Neutral air — the sex kick. The front leg snaps out over the first few
       * frames and then simply *stays* out while the hitbox lingers; that
       * persistence is the entire move, so the pose holds rather than easing
       * through contact. It sags a little as it hangs, which is what stops the
       * held frames reading as a freeze.
       */
      case 'sexKick': {
        const out = Math.min(1, sweep * 5);
        const sag = Math.max(0, phase) * 0.22;
        // Front leg extends. The back leg does *not* mirror it — it tucks:
        // thigh carried forward the same way, shin folded up underneath. Swung
        // back instead, the two legs scissor and it reads as the splits.
        // Carried high — the kicking leg comes up to near a right angle with
        // the body, which is where the sex kick's silhouette lives.
        this.legs.l.hip.rotation.z = lerp(-0.40, 1.48, out) - sag;
        this.legs.l.knee.rotation.z = lerp(-1.15, -0.05, out);
        this.legs.r.hip.rotation.z = lerp(0.10, 0.66, out) - sag * 0.5;
        this.legs.r.knee.rotation.z = lerp(-0.45, -1.70, out);
        this.chest.rotation.z = lerp(0.05, -0.26, out);
        this.pelvis.rotation.z = lerp(0, -0.14, out);
        this.arms.l.shoulder.rotation.z = lerp(-0.25, -1.20, out);
        this.arms.l.shoulder.rotation.x = -0.5;
        this.arms.l.elbow.rotation.z = 0.55;
        this.carryWeapon(lerp(-0.25, -0.55, out));
        break;
      }

      /**
       * Up air — a backflip kick. The flip is a root rotation, which pivots at
       * the feet, so it needs the same correction the roll does: turning about
       * a point means translating by (p - R*p) for that point, or she scythes
       * round her own ankles instead of tumbling.
       */
      case 'backflipKick': {
        // No `facing` term — see `diveRoll`. With one, she back-flipped facing
        // right and front-flipped facing left, because the root's half turn
        // already mirrors a body-space rotation.
        const spin = t * Math.PI * 2;
        this.root.rotation.z = spin;
        const r = this.H * ROLL_PIVOT;
        const yaw = this.root.rotation.y;
        this.root.position.x += r * Math.sin(spin) * Math.cos(yaw);
        this.root.position.y += r * (1 - Math.cos(spin));
        this.root.position.z -= r * Math.sin(spin) * Math.sin(yaw);

        const kick = phase < 0 ? Math.min(1, (phase + 1) * 2.6) : 1 - Math.max(0, phase) * 0.8;
        this.legs.l.hip.rotation.z = lerp(-0.30, 1.05, kick);
        this.legs.l.knee.rotation.z = lerp(-1.20, -0.05, kick);
        this.legs.r.hip.rotation.z = lerp(0.10, 0.55, kick);
        this.legs.r.knee.rotation.z = -1.10;
        this.chest.rotation.z = lerp(0.10, -0.18, kick);
        this.arms.l.shoulder.rotation.z = lerp(-0.20, -0.75, kick);
        this.arms.l.elbow.rotation.z = 0.5;
        this.carryWeapon(-0.30);
        break;
      }

      /**
       * Down air — both hands on the bat, driven straight down through the gap
       * between her legs. The legs split front and back to open that gap: from
       * the side that is what makes the bat's path read as clear rather than
       * passing through her own shins.
       */
      case 'batSpike': {
        const drive = sweep * sweep * (3 - 2 * sweep);

        // Turns square to the camera. Everything about this move is symmetric
        // — two hands on the bat, legs split either side of it — and side-on
        // that symmetry is edge-on and invisible.
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * DAIR_FACING
          * Math.min(1, sweep * 2.5) * (1 - Math.max(0, phase));

        /**
         * Both arms angle inwards by the same amount, so the grip lands on her
         * centre line rather than under whichever shoulder holds the bat.
         *
         * Pulling only the off hand across meets the weapon hand where it
         * already is — out at the right shoulder — and once she is facing the
         * camera that offset is straight across the screen, so the "straight
         * down the middle" swing comes down a third of a body-width off centre.
         */
        const swingZ = lerp(3.05, 0.06, drive);
        const elbow = lerp(-0.35, -0.02, Math.min(1, drive * 2));
        this.arms.r.shoulder.rotation.x = GRIP_CONVERGE;
        this.arms.r.shoulder.rotation.z = swingZ;
        // The elbow takes the shoulder's angle back out, so the forearm drops
        // vertically from a centred grip. Without it the hands meet on the
        // centre line but the bat, which continues along the forearm, carries
        // straight on past it and lands as far off-centre on the other side.
        this.arms.r.elbow.rotation.x = -GRIP_COUNTER;
        this.arms.r.elbow.rotation.z = elbow;
        this.arms.r.hand.rotation.z = 0;
        this.arms.l.shoulder.rotation.x = -GRIP_CONVERGE;
        this.arms.l.shoulder.rotation.z = swingZ;
        this.arms.l.elbow.rotation.x = GRIP_COUNTER;
        this.arms.l.elbow.rotation.z = elbow;

        // Split sideways, not front-to-back: once she has turned, her lateral
        // axis is the one the camera can see, and that is the gap the bat has
        // to come down through.
        this.legs.l.hip.rotation.x = lerp(0.10, 0.85, drive);
        this.legs.r.hip.rotation.x = lerp(-0.10, -0.85, drive);
        this.legs.l.hip.rotation.z = lerp(0.10, 0.20, drive);
        this.legs.r.hip.rotation.z = lerp(-0.10, 0.20, drive);
        this.legs.l.knee.rotation.z = -0.15;
        this.legs.r.knee.rotation.z = -0.15;
        this.chest.rotation.z = lerp(-0.18, 0.10, drive);
        // Head down, watching the spike land. Negative pitches it forward — the
        // head stacks up from the neck, so it takes the torso's sign, not a
        // limb's.
        this.neck.rotation.z = lerp(-0.10, -0.62, drive);
        break;
      }

      /**
       * Back air — a horizontal swipe behind her, and she turns into it.
       *
       * Same horizontal-plane mechanism as the forward swings, but the sweep is
       * centred on straight *back* instead of straight ahead. The body turn is
       * what stops it looking like an arm flapping backwards out of a fixed
       * torso: she rotates a little into the direction she is swinging.
       */
      /**
       * Back air — a rising bat swing behind her.
       *
       * Rewritten from an arc that dipped through its own contact point: the
       * bat measured its **lowest** height exactly on the active frames (105
       * against 111 at the start) and only rose afterwards, which is why it
       * read as swinging down. It now climbs the whole way through, so the
       * frames that hit are the frames going up.
       *
       * **No facing terms in the swing.** The previous version carried a
       * one-sided camera turn for the facing where the weapon arm sits away
       * from the lens. Combined with the yaw bias that is baked into facing,
       * the bat reached 67 behind her one way and 54 the other — the "range is
       * shorter on one side" that made it feel unreliable. The bias cannot be
       * removed, but pulling the arm onto her centre line leaves it almost
       * nothing to act on, because it only skews things offset in depth.
       */
      case 'swipeBack': {
        // Rises the whole way: low behind, through horizontal, to high behind.
        const rise = clamp(t, 0, 1);

        this.arms.r.shoulder.rotation.x = 0;
        /**
         * The symmetry fix, and it is **solved rather than reasoned**.
         *
         * The camera yaw bias is the same absolute rotation for both facings
         * rather than a mirrored one, so it skews anything held off the centre
         * line in depth — and the weapon arm always is. Sweeping this angle and
         * measuring the bat's reach on each side gives a gap that crosses zero
         * near -0.28: at +0.4 she reached 78 one way and 53 the other, and at
         * -0.28 it is about 69 both ways, which is also near the most reach
         * available anywhere on the sweep.
         */
        this.arms.r.shoulder.rotation.y = -0.28;
        this.arms.r.shoulder.rotation.z = lerp(-0.28, -2.85, rise);
        // Folded at the start so the startup reads as a coil, thrown out by
        // contact so the reach arrives with the hit.
        this.arms.r.elbow.rotation.z = lerp(-1.70, -0.05, snap);
        this.arms.r.hand.rotation.z = 0;

        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.shoulder.rotation.z = lerp(0.55, -0.30, rise);
        this.arms.l.elbow.rotation.z = -0.6;

        /**
         * The look-back lives in the **neck only**.
         *
         * The arm hangs off the chest, so a camera-relative chest turn twists
         * the swing itself in opposite directions depending on facing. The head
         * carries nothing, so it can be aimed at the camera freely: she looks
         * back over whichever shoulder keeps her face visible, while the swing
         * stays identical relative to her body either way.
         */
        const look = Math.min(1, t * 1.5);
        this.chest.rotation.y = 0;
        this.neck.rotation.y = -this.fighter.facing * lerp(0.25, 1.35, look);
        this.chest.rotation.z = lerp(0.20, -0.24, rise);
        this.legs.l.hip.rotation.z = lerp(0.35, -0.25, rise);
        this.legs.r.hip.rotation.z = lerp(-0.25, 0.30, rise);
        this.legs.l.knee.rotation.z = -0.55;
        this.legs.r.knee.rotation.z = -0.30;
        break;
      }

      /**
       * Forward air — a full vertical swipe, overhead down to low. Same shape
       * as the dash attack's chop without the landing, and quick: the arc is
       * smoothstepped so it holds high, snaps through, and settles.
       */
      case 'chopAir': {
        const chop = sweep * sweep * (3 - 2 * sweep);
        const recover = Math.max(0, phase);
        this.arms.r.shoulder.rotation.z = lerp(3.10, 0.45, chop) + recover * 0.80;
        this.arms.r.shoulder.rotation.x = lerp(0.0, -0.05, chop);
        this.arms.r.elbow.rotation.z = lerp(0.0, -0.03, Math.min(1, chop * 1.8));
        this.arms.r.hand.rotation.z = 0;
        this.arms.l.shoulder.rotation.z = lerp(2.30, 0.05, chop) + recover * 0.4;
        this.arms.l.elbow.rotation.z = lerp(-0.8, -0.2, chop);

        this.chest.rotation.z = lerp(-0.26, 0.40, chop);
        this.legs.l.hip.rotation.z = lerp(-0.35, 0.60, chop);
        this.legs.r.hip.rotation.z = lerp(0.30, -0.35, chop);
        this.legs.l.knee.rotation.z = lerp(-0.70, -0.30, chop);
        this.legs.r.knee.rotation.z = -0.50;
        break;
      }

      /**
       * Forward tilt — a one-handed vertical swing, the grounded cousin of the
       * forward air.
       *
       * It starts from the carry: elbow folded, bat laid back on her shoulder.
       * The arm then whips up and over and the elbow straightens into the hit,
       * so the reach arrives *with* the contact rather than being held out
       * through the windup and telegraphing it.
       */
      case 'shoulderSwing': {
        const raise = Math.min(1, t / 0.24);            // off the shoulder
        const fall = clamp((t - 0.24) / 0.50, 0, 1);    // down through the hit
        const extend = Math.min(1, t * 2.4);

        this.arms.r.shoulder.rotation.x = 0.12;
        this.arms.r.shoulder.rotation.z = raise < 1
          ? lerp(-0.30, 2.95, raise)
          : lerp(2.95, 0.50, fall);
        this.arms.r.elbow.rotation.z = lerp(CARRY_ELBOW, -0.05, extend);
        this.arms.r.hand.rotation.z = lerp(CARRY_WRIST, 0, extend);

        this.arms.l.shoulder.rotation.z = lerp(0.30, -0.60, t);
        this.arms.l.elbow.rotation.z = -0.55;
        this.chest.rotation.z = lerp(-0.22, 0.34, t);
        this.pelvis.rotation.z = lerp(-0.08, 0.14, t);
        // Steps into it, which is what carries the weight through the swing.
        this.legs.l.hip.rotation.z = lerp(-0.20, 0.52, t);
        this.legs.r.hip.rotation.z = lerp(0.22, -0.30, t);
        this.legs.l.knee.rotation.z = lerp(-0.40, -0.10, t);
        this.legs.r.knee.rotation.z = -0.22;
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 * s;
        break;
      }

      /**
       * Neutral B — an overhand throw. The arm cocks back behind the ear and
       * whips over the top, with the shoulders squaring up behind it; the
       * release lands at the midpoint and the arm carries on down across her.
       */
      case 'throwOver': {
        /**
         * She throws with the *free* hand — the other one is holding a bat —
         * and that hand is on the far side of her body from the camera, so
         * side-on the whole throw happens behind her torso where none of it is
         * visible. Turning her part-way round brings it into view. A thrower
         * opens their shoulders anyway, so the turn is doing double duty.
         */
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * THROW_FACING
          * Math.sin(Math.PI * clamp(t, 0, 1));

        this.arms.l.shoulder.rotation.x = -0.30;
        this.arms.l.shoulder.rotation.z = lerp(3.55, 0.85, t);
        this.arms.l.elbow.rotation.z = lerp(-1.75, -0.10, Math.min(1, t * 1.9));
        this.chest.rotation.z = lerp(-0.26, 0.30, t);
        this.pelvis.rotation.y = lerp(0.18, -0.14, t);
        this.legs.l.hip.rotation.z = lerp(-0.30, 0.50, t);
        this.legs.r.hip.rotation.z = lerp(0.28, -0.28, t);
        this.legs.l.knee.rotation.z = lerp(-0.55, -0.12, t);
        this.legs.r.knee.rotation.z = -0.25;
        // Bat arm stays out of the way, carried across her.
        this.carryWeapon(lerp(-0.15, -0.50, t));
        break;
      }

      /**
       * Both dashes: a sprinter's set position, then the launch.
       *
       * She drops into a deep crouch with the chest low over the knees and the
       * elbows folded — coiled, but with the knees held off the floor, because
       * a knee down reads as landing rather than as loading. The launch pulls
       * her body into a straight line along the direction of travel.
       */
      case 'sprintSet': {
        // Fully loaded on the launch frame, not partway there: `windup` runs 1
        // to 0 across exactly the startup, so the crouch completes as she goes.
        // Driving it on `sweep` instead spreads it over the travel too, and she
        // launches out of a half-crouch having never actually set.
        const set = 1 - windup;
        const go = Math.max(0, phase);             // out of it, along the dash
        this.pelvis.position.y = this.p.hipY - this.H * (0.26 * set - 0.10 * go);

        /**
         * Pitch the whole body forward over the front foot, then take the lean
         * back out of the legs so the feet stay planted underneath — the same
         * trick the sprint uses. Leaning on the chest alone leaves the hips
         * where they were, which reads as sitting back into the crouch rather
         * than loading forward over it.
         */
        // Negative tips the torso *forward* — the torso stacks up from the
        // pelvis, so it takes the opposite sign to a limb. Getting this
        // backwards is what had her charging while leaning away from the dash.
        // The lean is held for the whole move rather than eased out, because a
        // tuck that unwinds mid-flight reads as her sitting up in the air.
        const lean = 0.72 * set;
        this.pelvis.rotation.z = -lean;
        this.chest.rotation.z = -0.30 * set;
        this.neck.rotation.z = lean * 0.45;

        this.legs.l.hip.rotation.z = lerp(0.10, 0.95, set) + lean - go * 0.55;
        this.legs.r.hip.rotation.z = lerp(-0.10, -0.15, set) + lean - go * 0.30;
        this.legs.l.knee.rotation.z = lerp(-0.20, -1.15, set) + go * 0.95;
        this.legs.r.knee.rotation.z = lerp(-0.20, -1.35, set) + go * 1.10;

        this.arms.r.shoulder.rotation.z = lerp(-0.10, -0.85, set) + go * 0.55;
        this.arms.r.elbow.rotation.z = lerp(-0.40, -2.05, set) + go * 0.75;
        this.arms.l.shoulder.rotation.z = lerp(-0.10, 0.75, set) - go * 1.20;
        this.arms.l.elbow.rotation.z = lerp(-0.40, 1.85, set) - go * 0.70;
        this.arms.l.shoulder.rotation.x = -0.30;
        break;
      }

      /**
       * Down B — Snatch. A low lunge with the free hand thrown out to grab.
       * The bat arm stays back and out of the way: this is a pickpocket, not
       * a swing, and it should not look like one.
       */
      case 'snatch': {
        const reach = phase < 0 ? Math.min(1, (phase + 1) * 2.4) : 1 - Math.max(0, phase) * 0.9;
        // Same problem as the throw: the grabbing hand is the free one, which
        // sits on the blind side. A partial turn puts the snatch on camera.
        this.root.rotation.y += -this.fighter.facing * FACE_CAMERA_TURN * SNATCH_FACING * reach;
        this.pelvis.position.y = this.p.hipY - this.H * 0.16 * reach;
        this.chest.rotation.z = lerp(0.10, 0.46, reach);
        this.arms.l.shoulder.rotation.z = lerp(0.20, 1.72, reach);
        this.arms.l.shoulder.rotation.x = lerp(-0.20, -0.34, reach);
        this.arms.l.elbow.rotation.z = lerp(-1.30, -0.06, reach);
        this.legs.l.hip.rotation.z = lerp(-0.10, 0.82, reach);
        this.legs.l.knee.rotation.z = lerp(-0.35, -0.22, reach);
        this.legs.r.hip.rotation.z = lerp(0.10, -0.48, reach);
        this.legs.r.knee.rotation.z = lerp(-0.40, -0.75, reach);
        this.carryWeapon(lerp(-0.20, -0.55, reach));
        break;
      }

      case 'forward': {
        this.chest.rotation.z = lerp(-0.2, 0.28, s);
        this.arms.r.shoulder.rotation.z = lerp(-0.75, 1.55, s);
        this.arms.r.elbow.rotation.z = lerp(-1.25, -0.05, s);
        this.arms.l.shoulder.rotation.z = lerp(0.35, -0.55, s);
        this.arms.l.elbow.rotation.z = -0.6;
        this.legs.l.hip.rotation.z = lerp(-0.15, 0.45, s);
        this.legs.r.hip.rotation.z = lerp(0.2, -0.3, s);
        this.pelvis.position.y = this.p.hipY - this.H * 0.04 * s;
        break;
      }
      case 'up': {
        this.chest.rotation.z = lerp(0.3, -0.1, s);
        // Arcs up in front rather than behind the head.
        this.arms.r.shoulder.rotation.z = lerp(-0.9, 2.85, s);
        this.arms.l.shoulder.rotation.z = lerp(-0.7, 2.6, s);
        this.arms.r.elbow.rotation.z = lerp(-1.2, -0.05, s);
        this.arms.l.elbow.rotation.z = lerp(-1.2, -0.05, s);
        this.pelvis.position.y = this.p.hipY + this.H * 0.05 * s - this.H * 0.10 * windup;
        this.legs.l.knee.rotation.z = -0.5 * windup;
        this.legs.r.knee.rotation.z = -0.5 * windup;
        break;
      }
      case 'down': {
        this.chest.rotation.z = lerp(-0.3, 0.25, s);
        // Overhead, then chopped straight down in front.
        this.arms.r.shoulder.rotation.z = lerp(2.5, 0.25, s);
        this.arms.l.shoulder.rotation.z = lerp(2.1, 0.4, s);
        this.arms.r.elbow.rotation.z = lerp(-0.9, 0.0, s);
        this.legs.l.hip.rotation.z = -0.3 * s;
        this.legs.r.hip.rotation.z = -0.3 * s;
        this.legs.l.knee.rotation.z = -0.2;
        break;
      }
      case 'low': {
        this.poseCrouch(0.55 + 0.25 * s);
        this.chest.rotation.z = 0.5;
        this.arms.r.shoulder.rotation.z = lerp(-0.5, 0.95, s);
        this.arms.r.elbow.rotation.z = lerp(-1.2, -0.1, s);
        this.arms.l.shoulder.rotation.z = lerp(0.5, -0.85, s);
        break;
      }
      case 'back': {
        // Swings behind, and leads with the weapon hand.
        this.chest.rotation.z = lerp(0.35, -0.4, s);
        this.arms.r.shoulder.rotation.z = lerp(1.0, -1.75, s);
        this.arms.r.elbow.rotation.z = lerp(-1.1, -0.1, s);
        this.arms.l.shoulder.rotation.z = lerp(-0.8, 1.3, s);
        this.legs.l.hip.rotation.z = lerp(0.3, -0.7, s);
        this.legs.l.knee.rotation.z = lerp(-0.8, -0.1, s);
        break;
      }
      case 'spin': {
        this.root.rotation.y += s * Math.PI * 1.6;
        this.arms.l.shoulder.rotation.x = -1.35;
        this.arms.r.shoulder.rotation.x = 1.35;
        this.arms.l.shoulder.rotation.z = -0.2;
        this.arms.r.shoulder.rotation.z = -0.2;
        this.legs.l.hip.rotation.z = 0.4;
        this.legs.r.hip.rotation.z = -0.4;
        this.legs.l.knee.rotation.z = -0.6;
        break;
      }
      case 'lunge': {
        // Charging in behind the weapon, not trailing it.
        this.chest.rotation.z = 0.45 + 0.25 * s;
        this.arms.r.shoulder.rotation.z = lerp(-1.0, 1.9, s);
        this.arms.r.elbow.rotation.z = lerp(-1.3, -0.15, s);
        this.arms.l.shoulder.rotation.z = lerp(0.8, -1.1, s);
        this.arms.l.elbow.rotation.z = -0.5;
        this.legs.l.hip.rotation.z = 0.9;
        this.legs.r.hip.rotation.z = -0.5;
        this.legs.l.knee.rotation.z = -0.5;
        this.pelvis.position.y = this.p.hipY - this.H * 0.10;
        break;
      }
      case 'cast': {
        this.chest.rotation.z = lerp(-0.25, 0.3, s);
        // Thrusts the weapon hand out in front to release the projectile.
        this.arms.r.shoulder.rotation.z = lerp(-0.6, 1.75, s);
        this.arms.r.elbow.rotation.z = lerp(-1.5, -0.1, s);
        this.arms.l.shoulder.rotation.z = lerp(-0.4, 1.3, s);
        this.arms.l.elbow.rotation.z = lerp(-1.4, -0.3, s);
        // A swung weapon should follow the thrust; only a staff needs saving
        // from being speared into the floor by it.
        if (this.weaponKind === 'staff') this.carryWeapon();
        this.pelvis.position.y = this.p.hipY - this.H * 0.05 * windup;
        if (this.staffOrb) {
          const glow = 0.8 + s * 1.6;
          this.staffOrb.scale.setScalar(glow);
        }
        break;
      }
      case 'grab': {
        this.poseGrab();
        this.arms.l.shoulder.rotation.z = lerp(0.5, 1.6, s);
        this.arms.r.shoulder.rotation.z = lerp(0.5, 1.6, s);
        // Re-shoulder afterwards: the reach above would otherwise sweep the
        // weapon arm forward and drag the bat through the floor.
        this.carryWeapon(0.0);
        break;
      }
      case 'throw': {
        // Hauls up and over, releasing forward.
        this.chest.rotation.z = lerp(-0.35, 0.5, s);
        this.arms.l.shoulder.rotation.z = lerp(2.2, 0.2, s);
        this.arms.r.shoulder.rotation.z = lerp(2.2, 0.2, s);
        this.carryWeapon(lerp(0.15, -0.15, s));
        break;
      }
      case 'dodge': {
        this.pelvis.scale.set(1, 0.86, 1);
        this.chest.rotation.x = 0.5;
        this.poseCrouch(0.5);
        break;
      }
      case 'airdodge': {
        // Tucked in tight rather than flung out behind.
        this.chest.rotation.z = -0.4;
        this.arms.l.shoulder.rotation.z = 1.2;
        this.arms.r.shoulder.rotation.z = 1.2;
        this.arms.l.elbow.rotation.z = -1.4;
        this.arms.r.elbow.rotation.z = -1.4;
        this.legs.l.hip.rotation.z = 0.6;
        this.legs.r.hip.rotation.z = 0.5;
        this.legs.l.knee.rotation.z = -0.9;
        this.legs.r.knee.rotation.z = -0.9;
        break;
      }
      case 'roll': {
        // Tuck and spin about the z axis for rolls, techs and getups.
        //
        // The root's origin is at the fighter's feet, so spinning it there
        // swings the body down through the floor — a roll has to turn about
        // its own middle. Rotating about a point p instead of the origin means
        // translating by (p - R·p), and R here is the yaw the rig is already
        // carrying times the spin, so the correction has a depth term too.
        const spin = -this.fighter.facing * (phase + 1) * Math.PI;
        this.root.rotation.z = spin;
        const r = this.H * ROLL_PIVOT;
        const yaw = this.root.rotation.y;
        this.root.position.x += r * Math.sin(spin) * Math.cos(yaw);
        this.root.position.y += r * (1 - Math.cos(spin));
        this.root.position.z -= r * Math.sin(spin) * Math.sin(yaw);
        // Ride up over the shoulder, peaking at the inverted halfway point.
        const inverted = (1 - Math.cos(spin)) * 0.5;
        this.root.position.y += this.H * ROLL_LIFT * inverted;
        this.poseCrouch(0.8);
        break;
      }
      case 'ledge': {
        this.poseLedge(this.fighter);
        this.pelvis.position.y = this.p.hipY - this.H * 0.1 * (1 - Math.max(0, phase));
        break;
      }
      default: this.poseIdle();
    }
  }

  /**
   * Whole-body material overrides: white for a hit, a translucent ghost while
   * a dodge is intangible.
   *
   * One slot rather than one flag per effect, so the two can never disagree
   * about which material a mesh should be wearing. A fighter clipped on the
   * tail of a dodge reads as hit, which is the more urgent of the two.
   */
  applyOverlay(f) {
    let material = null;
    if (f.flashFrames > 0) material = this.flashMaterial;
    else if (isEvading(f)) material = this.dodgeMaterial;

    if (material === this._overlay) return;
    this._overlay = material;
    for (const mesh of this._allMeshes) {
      if (material) {
        if (!mesh.userData.baseMaterial) mesh.userData.baseMaterial = mesh.material;
        mesh.material = material;
      } else if (mesh.userData.baseMaterial) {
        mesh.material = mesh.userData.baseMaterial;
        mesh.userData.baseMaterial = null;
      }
    }
  }
}
