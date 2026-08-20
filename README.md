# Clash Rumble — First Playable Prototype

A gameplay-validation prototype of **Clash Rumble**, the Clash-universe platform fighter
described in *Clash Rumble Full Presentation.docx* and *Clash Rumble Presentation (Executive).docx*.

This is the build a studio makes **before** art, animation and content: low-poly placeholder
models, procedural animation, visible hitboxes, and every frame of every move exposed for tuning.
The only thing it is trying to be good at is feeling like a platform fighter.

---

## Running it

Requires Node (any recent version) and one dependency (three.js), which is already installed
in `node_modules`. There is no build step.

```bash
npm install && node server.js
```

Then open <http://localhost:5173>.

A static server is needed because the project uses native ES modules, which browsers
refuse to load over `file://`.

---

## 2.5D presentation

The game renders in 3D and plays in 2D, exactly as Smash Bros. does.

**The simulation is, and stays, two-dimensional.** Positions, capsule collision, knockback,
ledges and blast zones all live in a single plane. The 3D layer is purely presentational: it
mirrors that plane into a scene viewed through a low perspective camera (about 10° above
horizontal, so the stage reads edge-on but you can still see its depth).

```
sim (x, y)  ->  world (x, -y, 0)      # the simulation is y-down, 3D is y-up
```

Nothing in `src/render/` may write to simulation state, and no gameplay code knows the 3D
renderer exists. That separation is what lets the flat debug view (**F3**) run off exactly the
same match data, and it means swapping in real art later touches only the render layer.

**Characters** are hierarchical box skeletons proportioned from each fighter's own `width` and
`height`, so a new fighter gets a body for free. There are no animation assets — poses are
computed each frame from velocity, state, the current move and its frame counter, including
attack poses derived from the move's own frame data (windup up to the first active hitbox,
snap on it, ease out through the recovery). Per-character silhouette pieces (the Wizard's hood
and beard, the Bandit's mask and bat) are declared in the fighter data files under `model`.

The camera reuses the existing 2D camera's framing logic and converts its zoom into a dolly
distance, so both views frame the action identically.

---

## Controls

**A controller is the intended way to play.** Plug it in before loading the page (or after —
hotplug is handled). Player 1 takes the first pad, Player 2 the second; anyone without a pad
falls back to a keyboard half.

### Controller (Xbox layout; Smash Ultimate-style bindings)

| Input | Action |
|---|---|
| Left stick | Move · walk (tilt) · dash (flick) · aim specials · DI |
| Right stick | **Tilts** on the ground, directional aerials in the air |
| A | Attack |
| B | Special (costs Elixir) |
| X / Y / LS | Jump (tap = short hop, hold = full hop) |
| RB / LT / RT | Shield · air dodge · roll (shield + flick) · spot dodge (shield + down flick) |
| LB | Grab (also Shield + Attack) |
| D-pad | Taunt |
| Start | Rematch · confirm |

### Keyboard

| | Player 1 | Player 2 |
|---|---|---|
| Move | `W A S D` | Arrow keys |
| Jump | `Space` | `Numpad0` / `Enter` |
| Attack | `F` | `Numpad1` / `.` |
| Special | `G` | `Numpad2` / `,` |
| Shield | `H` | `Numpad3` / `/` |
| Grab | `T` | `Numpad4` / `'` |
| Walk modifier | `Left Shift` | `Right Shift` |
| Smash modifier | `E` | `Numpad6` |
| Taunt | `Q` | `Numpad5` |

**Keyboard runs by default.** Holding a direction breaks into a run; hold the **walk modifier**
(Shift) to move at walking pace instead. Shift can be pressed and released mid-movement to switch
between the two without stopping — which is how a keyboard player gets into tilt range, since
attacking out of a run gives a dash attack.

Digital keys have no flick velocity, so the **smash modifier** (E) converts a direction into a
smash input. It also holds the fighter still, so a smash can be aimed without running off.

### Developer keys

| Key | |
|---|---|
| `F1` | Toggle hitbox / hurtbox overlay (off in the 3D view, on in the flat view) |
| `F2` | Toggle state + frame-counter labels (flat view) |
| `F3` | Switch between the 2.5D view and the flat debug view |
| `P` | Pause |
| `O` | Advance exactly one frame while paused |
| `R` | Restart the match |
| `Esc` | Back one screen (match → pause, character select → stage select, stage select → title) |

The collision overlay draws the real simulation capsules in the z = 0 plane, so it shows the
actual hit volumes in both views rather than a 3D reinterpretation of them.

---

## The two fighters

The brief asked for two fighters chosen from the documents' cast. These two were picked because
together they demonstrate every core system and produce the most legible matchup.

### Bandit — Brawler
> *"Fast, agile, medium weight. Dash mechanic that would use elixir to apply a lot of shield
> pressure. There would probably be a cooldown of like 1-2 seconds before dashing again. It would
> probably be a side B that you could aim in every direction. Great recovery tool as well.
> Up B could be some sort of upgraded dash that would deal no damage, but cover a greater distance."*

| Special | Cost | Behaviour |
|---|---|---|
| Neutral B — Stone Toss | 1 | Lobbed arcing projectile, combo starter |
| Side B — Bandit Dash | 2 (1.5 s cooldown) | Aimable in all 8 directions, intangible, heavy shield chip, doubles as recovery. 248px |
| Up B — Vanishing Dash | 3 | No damage, **+79% distance** (445px), ends in freefall |
| Down B — Snatch | 1 (2.5 s cooldown) | Steals 3 Elixir on hit — a 5-point swing. Weak, short, punishable on whiff |

**Snatch is invented**, and the reasoning matters more than the numbers. The document leaves her down
B open, and the smoke bomb it replaces was a second escape option sitting beside two dashes that
already do that job. Stealing is the one thing the character's name actually promises, and Elixir is
the mechanic the whole game is built on — nothing else in either kit touches the resource layer, so
a move that moves Elixir between players is doing something genuinely new. The balance lives in the
swing, not the damage: landing it can be the difference between the Wizard having a Fireball and
not, against 4% damage, almost no knockback, short range and 15 frames stood in front of him if it
whiffs. It also cannot conjure Elixir out of an empty bar, so robbing a broke opponent is its own
punishment.

### Wizard — Zoner
> *"Slow but powerful character. Neutral B shoots a fireball that deals great knockback. He could
> use his hero wings as a recovery tool. He could also conjure up a fire tornado with his down B or
> side B. His Evo ability could be implemented as a combo breaker… it would create a shield around
> the wizard that would explode of destruction… a grab would cancel the shield. The Wizard could
> also control when to detonate the shield by pressing down B again."*

| Special | Cost | Behaviour |
|---|---|---|
| Neutral B — Fireball | 5 | Slow, huge, high knockback; a genuine kill threat. He rocks back over his rear foot with both arms folded in, then drives everything forward and releases with the arms locked out |
| Side B — Fire Tornado | 4 | Raises both arms overhead to conjure it, then a slow multi-hit that drags opponents in and **ends by throwing them straight up** |
| Up B — Hero Wings | 2 | Golden wings unfurl and lift him once, then he **stays winged**. Jump flaps (3 max) and may turn him round, B furls, attack or a right-stick flick cancels into an aerial |
| Down B — Fire Shield | 10, then 10s cooldown | A violet bubble that lasts **indefinitely**. Absorbs the next hit and detonates. Press Down B again to detonate manually. A grab cancels it outright. Cannot be activated while in hitstun. |

**Hero Wings is the interesting one.** Flight is a *state*, not an animation with a fixed length: he
stays winged until he chooses to leave, and the controls split across three buttons.

| input | effect |
|---|---|
| jump | flap — up to three, each buying height; a held stick **turns him round** |
| special | furl the wings, drop into freefall |
| attack, or a right-stick flick | cancel into an aerial, which inherits the freefall |
| getting hit | wings come off, **no** freefall |

Two details that only show up with a pad in hand. The flap is the one place a fighter may reverse
facing in mid-air without a directional special — facing is otherwise committed the moment you leave
the ground, and being unable to turn toward the stage made a good flap and a bad one feel identical.
And the **right stick cancels too**: a C-stick flick is an attack input everywhere else in the game,
so a state that only listened for the button left pad players unable to cancel with the input they
actually use for aerials.

Putting the flap on **jump** rather than on B is what buys the whole thing. With both jobs — gain
height, leave the state — on the same button, the player could not hold the state open to look for
an aerial, and any hesitation dropped him into freefall. Split across two buttons, staying up is
free and leaving is deliberate. Measured: he holds the winged state for the entire 122-frame descent
from the top of the stage with all three flaps still banked, and only exits on landing.

Getting hit deliberately does **not** cause freefall. A hit already costs him the position; adding
helplessness on top turns every stray jab offstage into a stock.

Heights, measured from a standing start: **177** with no follow-up, then **284 / 365 / 436** as each
flap is added, and mashing past three changes nothing. The cap is what keeps it a decision about
*when* to spend rather than whether they run out — once they are gone he keeps the wings and the
aerial cancel, he just stops climbing.

The opening lift goes **straight up**: it damps horizontal momentum to 15% instead of adding to it.
Carrying the run into the recovery meant the direction he happened to be moving decided how much of
it went upward, so the same input recovered different distances depending on momentum he no longer
wanted. Measured: identical 177 of height whether he enters standing or at a full sprint.

**The tornado has to actually trap.** At an 85° churn angle every tick threw the victim out of the
top, so they popped free long before the finisher and the whole move was a few chip hits. A shallow
18° angle *along the tornado's travel* carries them with it instead, and `kbg: 0` matters as much as
the angle — any growth means the trap stops working at exactly the percents where the finisher's
launch would be worth having. Measured: 22 connected ticks at 0–100% with the finisher landing,
against 4–5 before.

That made it hit too hard, so the per-tick damage came down from 1.6 to 1.0 — a full capture was
nearly 29% from a single 4-Elixir cast, which is a kill setup and a third of a stock on one button.

The tornado also **plants him when cast on the ground**. Specials keep their momentum by default,
which is right for an aerial cast but wrong here — sprinting into it slid him most of a body length
while he was supposedly standing still conjuring something. Killing the run only when grounded
leaves the air version untouched, where carrying the drift is the point: measured, 0px of travel
grounded against 458 airborne.

**The Fire Shield is now 10 Elixir and a 10-second cooldown** rather than once per stock. The old
gate made it a thing you saved for so long that most stocks ended without it ever coming out; a
price plus a cooldown is a rhythm instead of a single use. The cooldown starts when the shield
*ends* — on detonation or on a grab cancel — not when it is cast, so holding it never pays down its
own downtime. Being grabbed puts it on cooldown too: the grab is the counterplay, so it has to cost
him the tool rather than just the cast.

It shows in the HUD as a chip beside the stock pips, with the name, a live countdown and a draining
bar. That readout has to be positioned from where the pips *actually* end rather than from
`f.stocks`: pips cap at five and collapse to a multiplier, and training draws one pip plus an
infinity glyph for a nominal count of 99 — which threw the chip two thousand pixels off-screen.

**The jab string needed hitstun and knockback to come apart.** Three attempts:

| knockback | result |
|---|---|
| scaling (`bkb 12, kbg 16`) | pushed further the higher the percent — the string got harder to finish exactly as the launcher became worth landing |
| zero | range fixed, but hitstun is *derived* from knockback, so the opponent could walk away between jabs |
| `setKnockback: 34` | 13 frames of hold, but 55px of shove per link, which walked them out of range again |

So `applyLaunch` grew an optional **`hitstun` override**: a hitbox may state its hold directly
instead of inheriting it from knockback. The jabs run `setKnockback: 5` (a nudge worth a couple of
pixels) with `hitstun: 15` (the hold, independent of both the shove and the victim's percent).
Measured after: all three hits connect in 15/15 range-and-percent combinations, 0–200% and out to
88px, with 2px of drift between links.

Jab 3's hitbox also had to reach as far *forward* as jabs 1 and 2. A rising capsule that stopped at
x 40 fell short of the 64 the first two cover, so a string started at the tip of jab 1 whiffed the
finisher — the exact case where landing it matters.

The tornado's finisher was tuned by measurement against the 900 ceiling: a **119px pop at 0%**,
inside a full hop (175) so he can chase it, rising to a KO at about **230%**. Low base knockback with
steep growth is what buys both ends — the first draft could not kill at *any* percent, which made
the finisher pure decoration.

His grounded normals are hand-to-hand, which is the point: a zoner who "struggles with close-quarter
combat" needs a close game that exists but is committal.

| Normal | Shape | Role |
|---|---|---|
| Jab 1-2-3 | left straight, right straight, rising fire uppercut | 1 and 2 are weak and near-vertical so the string holds; jab 3 launches (231px at 40%, 361px at 90%) |
| Forward tilt | horizontal side kick | the reach check — 188px of horizontal drift at 40% |
| Up tilt | turns to camera, sweeps a fire arc overhead into a T-pose | anti-air; sends straight up (116px, −10 drift) |
| Down tilt | crouched 360° legsweep, hands planted | combo starter: pops up 67px with only 20 of drift, so they stay in front of him |

His aerials are hand-to-hand too, and each one is doing a different job:

| Aerial | Shape | Role |
|---|---|---|
| Neutral | cannonball tuck inside a ring of fire | his fastest option — the get-off-me button |
| Forward | fire punch swung overhead down past his waist | the commitment; spikes on the low half of the arc |
| Up | three fireballs, alternating hands | juggling — the first two link, only the third launches |
| Down | two-footed stomp, turned square to the camera | spike, paid for with 14 frames of landing lag |
| Back | spinning midsection kick through a full 360 | the quick retreating hit |

Two of them lean on tricks established elsewhere. Up air's first two fireballs use the **jab
string's** fixed-knockback-plus-stated-hitstun pairing, so they hold the target above him instead of
pushing them out of the third. Down air turns square to the camera like the Bandit's up tilt, for the
same reason: seen from the side a fighter pulling his knees up and stamping is mostly hidden behind
his own thigh, and front-on it is unmistakable. It also holds a full cannonball — the same ball as
the neutral air — and kicks out of it late and sharply, because the whole read of a stomp is the snap.

**A move whose hitboxes land in sequence must opt into `rehitRate`.** Repeat hits are tracked per
*move*, keyed `moveId:victimId` — not per hitbox — so a target struck by up air's first fireball was
locked out of the other two and the string ended after one shot. That is the default for good reason
(it stops a single swing double-hitting and making kill percents non-monotonic), but multi-hits have
to turn it off.

Picking the rate is not obvious either, because it is measured in **global** frames while the move's
own frames are frozen by hitlag — so a hitbox stays live well past its stated window. Measured on up
air: 5 gave six hits for 16.6%, 11 gave two, and 7-9 all gave exactly three. 8 sits in the middle.

Two things about the field are easy to get wrong, and both cost a session. It is read off **each
hitbox** (`hitSystem.js`), not off the move, so it has to be repeated on every box that needs to
clear the lock — putting it on the move object does nothing at all, silently. And the rate has to
be tuned against *two* intervals at once: long enough that a box cannot re-hit inside its own
window, short enough that the next box clears the gap. The Goblin's forward air at 7 landed three
times (frames 7, 20 and 27 — the second stab firing twice); at 12, which sits above its own
self-repeat and below the 13 frame gap between stabs, it lands exactly twice.

The symptom of getting this wrong is a move that looks finished and simply drops its later hits, so
**count the hits in a live hit test** rather than trusting the table. Park a target in the strike
zone, run the move, and log every change in the victim's damage. Use a fresh match per test: move
staling silently shrinks the numbers across repeated runs and makes the results look like a
placement problem.

Neutral air's ring is `awayFromAttacker`, which is what makes it read as a *ring* rather than a kick
— whoever it catches is thrown out and up on the side they were standing.

His smashes and dash attack:

| Move | Shape |
|---|---|
| Forward smash | two-handed fire push — palms chambered at the hip while it charges, then driven out together |
| Up smash | grounded backflip kick, foot sweeping from in front, up over his head and away behind |
| Down smash | turns to camera, drives both fists into the floor, detonating on both sides |
| Dash attack | a horizontal dive with both arms speared out, finishing in a forward roll |

**A rotating body needs its limb angles compensated.** Shoulder z is measured in body space, so once
the dash attack has pitched him a quarter turn forward, "point the arms ahead" points them at the
floor — measured, the hands sat at height 4 while the hitbox was at 40. Subtracting the body's own
spin from the limb angle holds the arms pointing forward *in the world* however far round he has gone.

**The camera yaw bias breaks mirror symmetry for anything held off the centre line in depth.** It is
the same absolute rotation for both facings rather than a mirrored one, so a limb offset in depth
projects differently on each side. The Bandit's back air reached 78 units behind her one way and 53
the other — the "range is shorter on one side" that made it feel unreliable. The bias cannot be
removed (it is what stops the fighters reading as flat cutouts), so the fix is to find the shoulder
angle where the two sides agree. That is **solved, not reasoned**: sweeping the angle and measuring
the bat tip on both facings gives a gap that crosses zero near −0.28, where reach is about 69 both
ways and also near the most available anywhere on the sweep. Measured after: a gap of **0**.

**A body-space rotation must not be multiplied by `facing`.** Facing is a half turn of the whole
root, not a reflection, so the same `rotation.z` already produces the same pitch relative to the
character whichever way they point. Multiplying by facing inverts one side: the Wizard dived forward
going right and backwards-and-upside-down going left, feet ending at height 94 instead of 6. The
Bandit's back-flipping up air had the same bug from the same line — she back-flipped facing right
and *front*-flipped facing left. Both now use a constant sign, and measure identical heights on both
sides (41 / 46 / 6). The small residual difference in horizontal reach is the camera yaw bias, which
is a lens offset rather than a mirroring error.

**A kick that chambers and a kick that swings are different animations.** The forward tilt ramped
the hip and the knee together, so the leg came up off the floor in one arc and the foot climbed as it
travelled — a swing. Splitting them (knee up first, shin fired second) and folding the heel *tighter*
during the lift keeps the foot under him until the strike, and easing the thigh back down as the shin
extends cancels the arc it would otherwise trace about the knee. The drive now holds between heights
19 and 30 across its travel instead of climbing 27.

**Measuring a weapon means knowing where its tip is in hand space**, and that number changes when the
model does. The Goblin's dagger tip sat at `-H * 0.50` (≈37 units) and now sits at `-H * 0.27` (≈20)
after it was rebuilt to the card-art proportions — big hilt, short triangular blade. Every probe in
this file's history that reads a blade position hard-codes that offset, so a model change silently
invalidates the measurements taken before it. Re-read the constructor before trusting an old number.

Shortening a weapon does **not** shorten its hitboxes, and that is deliberate: a box covers the swept
volume of the whole limb plus the generosity a fighting game needs, and the reach of a move is a
balance decision rather than a consequence of its art. It does mean the two can drift apart — his
forward smash reaches 105 while the blade now tops out at 42 — so the gap is worth re-measuring after
any model change, and closing on purpose if it has grown far enough to feel dishonest.

**A weapon pose should never name an arm.** `applyAttackShape` exposes `wArm` (the arm holding the
weapon), `oArm` (the other one) and `mir` — `+1` when the weapon is in the left hand, `-1` when it is
in the right. Writing `arms.l` directly hard-codes a fighter's handedness into their animation, and
moving the Goblin's dagger from his left hand to his right meant rewriting fifteen poses.

`mir` multiplies exactly the three dials that say *which side of the body a limb is on*:
`shoulder.rotation.x`, `shoulder.rotation.y` and `chest.rotation.y`. Everything else is
handedness-neutral — a z-swing, a lean, a leg, a body rotation.

The trap is that `shoulder.rotation.y` and `chest.rotation.y` do two different jobs, and only one of
them mirrors. **Placement** ("pull the arm onto his centre line") is side-dependent and takes `mir`.
**Cancellation** — the term that undoes a `root.rotation.y` so a swing stays in the screen plane — is
a rotation about the same vertical axis whichever arm is swinging, so mirroring it *doubles* the yaw
instead of undoing it. The Goblin's up tilt was measured tracing its arc backwards until the
cancellation was taken back out of `mir`, and his up air needed a cancellation added that it had
never needed on the old shoulder: the body's quarter turn used to foreshorten the arc harmlessly and
on the new one it ate the back half, finishing the tip 4 units in front of him instead of 36 behind.

Verify a hand swap by running every move under both settings and comparing the blade's **x and y**
only — z will differ legitimately, because the shoulder itself sits 14 units to the other side, and
that is real geometry rather than a bug. Then re-measure each hitbox's clearance to the blade: the
swap moved the Goblin's up tilt arc high enough to leave its own boxes, and lengthened his jab by 12.

**The pivot correction is not automatic — every flip has to opt in.** `root` sits on the ground, so a
bare `root.rotation.z` swings the whole body about the soles rather than about the middle. The
Goblin's down air was written without it and measured with his head 65 units *below* his own feet at
the halfway mark, and the blade 90 below. The three-line offset (translate by `H * ROLL_PIVOT` along
the rolled axis, with the `cos(yaw)`/`sin(yaw)` terms because it is a world-space translation) is
what puts the pivot where a person's mass actually is.

**A body turn during a swing rotates the weapon off its target.** The Goblin's forward air is three
stabs thrown through a quarter turn. Applying that turn to `root` turned the arm with it: the third
and most powerful stab measured at x=8 while its hitbox reached to 70 — he was thrusting at the
camera. Applying the turn at the root and taking it straight back out at the chest winds the hips and
legs through the full quarter while the shoulders stay square. That is not a compromise; a body that
coils from the hips while the upper half tracks its target is where the torque reads from anyway.

**Regression harnesses must run in `battle` mode, not `training`.** `startMatch` hard-codes
`trainingCamp` whenever the mode is training (`main.js:147`) and ignores `chosenStage` entirely — so
a harness that sets `CR.mode = 'training'` and then walks the stage list is running the same flat
stage every time, however many stage ids it prints. That went unnoticed for several sessions and
meant no soft platform, no second ledge and no gap was ever actually exercised. Set
`CR.mode = 'battle'`, then assert on `match.stage.platforms.length` before trusting the run.

**An arm has a fixed length, and no amount of dialling gets past it.** The Goblin's jab, forward tilt
and forward air all measured a maximum reach of 42 — the same number, because all three are the same
fully-extended limb off a shoulder sitting over his centre line. When a move needs to out-range the
others, the shoulder itself has to move: his forward air pitches the body forward into the thrust
(about the hip, with the pitch added back into the shoulder dial so the stab stays horizontal) and
reaches 53. Reading a "give it more range" note as a shoulder-angle problem wastes a pass.

**A body-frame pitch stops pointing forward once the body has yawed.** The same forward air coils its
hips through the move, and at a full 90° of coil the dive was tilting him sideways relative to the
camera rather than driving him at the target — the first stab reached 51 and the second only 37, so
the later the stab the more of its own commitment it threw away. Capping the coil at about 35° fixed
both. Any time a pose composes a turn and a lean, check the *last* frame of the move, not the first:
that is where the two have drifted furthest apart.

**A spin and a strike must not share one clock.** Driving both from `sweep` spreads the revolution
across the contact window, and the strike travels with it: the Goblin's back kick measured its foot
38 units behind him at the start of the active frames and 12 in *front* of him by the end. The turn
gets its own faster clock and finishes before the leg extends — wind, then strike.

**A grounded flip has to actually leave the ground.** The pivot correction rotates a fighter about a
point at hip height, which is right for the Bandit's back-flipping up air because hers happens in
mid-air. Grounded, turning upside down about a point 50 units up puts the Wizard's head on the floor
at the halfway mark, and it reads as falling over. A parabolic hop peaking with the inversion lifts
him clear — presentation only, the simulation still has him standing.

The up smash's arc also had to be **retimed against its own hitboxes**. The boxes are placed where the
foot is, and the foot is carried by the rotation; starting the flip early put the kick overhead four
frames before the first box went live, so the boxes covered an arc the leg had already left.

The fire trails on jab 3, the up tilt, the down tilt, and now the neutral, up and forward aerials are
spawned from the Wizard's own `onStep` hook rather than baked into the renderer, keyed on move id and
frame window — nothing shared has to learn what a wizard is. The tornado's flames work the same way, laid as a helix from the
projectile's own `onStep` so they climb *with* the spin rather than being sprayed out of it.

Two rendering traps, both of which cost a pass:

- **A cone cannot be flipped with a negative scale.** Negating `scale.y` inverts the winding, not
  the shape, so an open-ended cone just shows its inside and still reads point-up. The funnel is
  flipped with `rotation.x = π`.
- **The projectile container rolls in the screen plane.** That is right for a thrown object and
  wrong for a vortex — it tipped the whole tornado onto its side. The tornado zeroes the container's
  roll and puts all of its motion on the core's own y axis.

The Fire Shield is a **stack of five concentric sphere shells** rather than a shader. Each is nearly
transparent alone; a sightline through the middle of the bubble crosses only the outermost few,
while one near the silhouette passes through every shell almost tangentially, so the alpha
accumulates and the rim comes out deep violet. That is what a fresnel term gives, built out of
geometry the renderer already pools. The colours also run light at the core and dark at the skin, so
the edge is a colour shift as well as an alpha one — a bubble rather than a smudge.

`BackSide` on every shell is what keeps the fighter readable: only the far hemisphere is drawn, so
nothing is ever painted between the camera and him. The constraint is that a shield the player
cannot see through hides the character it is protecting, and his pose is still information.

### Barbarian — Swordie
> *"Side B is a Battle Ram burst option… it would last until the player cancels it with pressing B,
> hitting the opponent, or getting hit. It would be powerful, but would have a lot of end lag."*
> *"Down B could be his Evo ability. For like 10 seconds, he's enraged and deals more damage… he
> would glow purple."* *"Barbarian Barrel dash attack."* *"Up B is the spring trap meme from Clash of
> Clans. By holding up b, the spring could charge up, giving the Barb more distance."*

| Special | Cost | Behaviour |
|---|---|---|
| Neutral B — Sword Slam | 2 | A shockwave along the floor. Ground-hugging, so a jump beats it outright |
| Side B — Battle Ram | 4 | Charges at 11.4/frame until B, until it connects, or until he is hit — then 40 frames of end lag either way |
| Up B — Spring Trap | 3 | Hold B to wind it. Cancels all vertical momentum on activation; the spring is left behind and falls with a live hitbox |
| Down B — Rage | 10 | Ten seconds at +40% damage with a purple aura, then a twelve second lockout |

**His weakness is written into the specials, not the attributes.** Every one of them costs Elixir
*including his recovery* — no other fighter pays to get back to the stage, so a Barbarian who spends
everything on Battle Rams simply dies offstage. Rage is deliberately **damage only**: buffing
knockback too would move every one of his kill percents for ten seconds, and a temporary state
should change how hard he hits, not rewrite the matchup.

The Battle Ram's distance is uncapped by design — it runs until you stop it, which means
over-committing carries you off the ledge. That is the drawback the brief's "powerful, but a lot of
end lag" is paying for.

**The Barbarian Barrel** throws itself in the way it does in Clash: it appears in the air, drops,
bounces twice — each lower than the last — rolls two full turns, and bursts into staves and hoops
after the second bounce. The whole vertical arc is presentation; the simulation has him grounded
throughout, so it never moves his hitbox.

He rides it **lying along its axis and log-rolling with it**, head out of one open end and feet out
of the other — not tumbling head over heels across it. The barrel is sized smaller than he is in both
directions (radius `W * 0.58`, length `W * 0.76`, against a 104-tall body) so he clears it at both
ends; anything that encloses him is a wheel with nobody in it.

That orientation is three turns in sequence — spin about his own long axis, lay that axis down from
vertical, then swing it off pure depth — which is a `Y · X · Y` composition. **No Euler triple can
express it**, since Euler angles are always three different axes in a fixed order, so it is built
from quaternions and slerped in from the standing pose (shortest arc, so the leap in never sweeps
the long way round).

The tilt is a compromise the camera forces. A barrel rolling along a side-on stage has its axis
pointing at the viewer, so only the near end is ever visible and the far one hides directly behind
it. Swinging the axis partly across the screen shows both ends without it ceasing to read as rolling
forward.

Its speed and its distance are set in two different places, which is worth knowing before tuning it:
the roll is driven by `sweep`, so **the active window sets the rotation speed** (widening it slows
the two turns down without changing their count), while the distance lives in the movement script.
It also carries `momentum: 1`, because the default for a grounded move scrubs most of the run speed
off on frame one — a dash attack should never brake you.

**It stops dead on the frame the barrel breaks.** Tapering the speed off first left it spinning on
the spot for a few frames, and a barrel that is still rolling has to be going somewhere: the break
ends the roll, rather than a slowdown before it.

### The spring trap

The board is always **at his feet**. Extending the coil in place drove it up through his shins and
out of his chest, so instead the fighter is lifted by the coil's height and the spring pushed down by
the same amount — it stands on the floor with the plank under his soles at every point of the throw.
The coil is five separate rings rather than one helix so it compresses like an accordion; scaling a
tube squashes its cross-section and it goes flat and ribbon-like.

**A charging move gets no physics at all.** The charge branch freezes the move's frame and returns
before the integrator *and* before `onFrame`, so `gravityMul` had nothing to scale and a per-frame
hook in `onFrame` was dead code — measured, a full 42-frame wind drifted one unit. The sag belongs on
`onChargeFrame`, and has to move `y` rather than `vy` because nothing is integrating it. Airborne
only: the collision pass is skipped too, so nudging a grounded fighter down sinks him into the stage.

Vertical momentum is **cancelled outright** at the start rather than damped. Reducing gravity scaled
the acceleration but left the velocity he arrived with, so winding up out of a jump carried him on up
and winding up out of a fall drove him down. Measured across three entries — rising at 13, falling at
9, running at 7 — the sag is now an identical 10 units.

`carryWeapon()` **overwrites the weapon shoulder** for a sword, so any pose that wants the sword arm
somewhere specific has to pass the angle in rather than set it first. A bare call after raising both
arms drops the right one back to his hip and only one goes up.

### The Battle Ram

A faceted stone head on a banded log, built lying along **+x** — the direction the model faces — so
it points where he charges and the root's facing turn carries it round with him. In the card two
Barbarians share the load; here one has it, which is the excuse for the carry.

He heaves it up over the startup and then runs under it, and the weight is sold by three things
holding for the *whole* charge: hips dropped 15% of his height, torso pitched forward, and the head
end nosed down rather than level. A carry that straightens up mid-run stops looking heavy the moment
it does.

The legs run on the **shared gait phase**, which `update` has already advanced from `|vx|` before any
pose runs — so the cadence falls out of how fast the ram is actually carrying him rather than a rate
picked by hand.

Its hoist is timed off the **move frame against `costFrame`**, not `sweep`. The move is 150 frames of
held charge with the hitbox live for nearly all of it, so a sweep-normalised clock would stretch the
lift across the entire run.

Props that belong to one move (`barrel`, `spring`, `ram`) are switched off in `clearPose` every frame
and switched on by their own pose. Leaving that out means a move interrupted mid-way — by a hit, a
grab, a KO — leaves its prop hanging on the fighter for the rest of the stock. The held weapon is
reset to *visible* there for the same reason, since the ram carry hides it.

**The ram is seated on his fists, and that has to be the last thing the pose does.** Its height is
read from where the hands actually finish rather than picked by hand — the shaft's underside meets
them, so its centre line is one log radius up. Two traps in doing that:

- World matrices only refresh at render time, *after* every pose has run, so the arm chain has to be
  brought current with `updateWorldMatrix` before it is read. Otherwise the ram sits on last frame's
  hands, and during the hoist that is a moving target.
- Ordering inside the pose matters as much. The duck lowers the pelvis and the pelvis carries the
  arms, so computing the ram before it seats the ram on hands that are about to drop sixteen units —
  which is precisely the gap that had it hovering over his head.

The sword is **hidden** for the carry. A blade still in his right hand reads as holding a two-handed
log one-handed, and `carryWeapon` is not called at all there: it exists to keep a held weapon
sensible and would drag the right arm back down to the hip it wants swords at.

Cancelling out of the charge is its own pose and its own descent. It used to borrow the sword chop,
which reads as a completely different move, and handing him back to full gravity sent him from 3.7 to
terminal 9.6 within a dozen frames — 224 units of drop before the end lag was over. He now comes down
capped, under control, and doubles over the throw instead of swinging.

### A rolling move must not multiply its spin by facing

Facing is a **half turn** of the whole root, and that half turn already mirrors a z rotation as the
camera sees it. Multiplying by `facing` on top cancels the mirroring, so the move plays the same
screen direction whichever way the fighter runs — forwards one way and backwards the other. Both the
Barbarian's barrel and the Wizard's dive had this.

The measurement that settles it is the **path of the head**, not the sign of the rotation: sample its
world position across the roll and check which way it circles the body. Rolling right, it should go
front → down → back → up (clockwise); rolling left, the exact mirror. A signed-area shortcut over
those points is easy to get wrong — it reported "clockwise both ways" even after the fix, while the
raw coordinates showed a clean mirror.

**Why this trio:** the Wizard's Fireball is the exact example both documents use to introduce
Elixir, and the Bandit's entire kit is Elixir-gated mobility with cooldowns. Between them they span
the whole economy the executive document describes — a 1-cost tool you use constantly against an
8-cost tool you use once a stock — and the Brawler/Zoner, light/heavy, fast/slow contrast stresses
knockback, recovery and neutral in a way a mirror matchup never would.

---

## HUD

The in-game HUD is a recreation of the project's own UI mock: a rounded character card with a
coloured frame, a large chunky damage percentage right-aligned above a segmented Clash
Royale-style Elixir bar, with a circular Elixir counter badge on the bar's left end.

The panel is authored in units where the card is 100×100 (`L` in `src/render/hud.js`) and scaled
to the canvas, so the proportions hold at any resolution. Card frame colours come from
`PLAYER_HUD_COLORS` in `main.js` — red for P1, blue for P2, as in the mock. They are kept separate
from the in-world model tints so the fighters keep their own identity on stage.

Two deliberate departures from the mock, both because the mock is a still and the game is not:

- **Stock pips** sit under the bar. The mock has no stock indicator, but the match needs one.
- **The percentage heats up.** It is cream below ~55% (matching both mock frames, which show 0.0%
  and 32.6%) and ramps toward red as damage climbs, so percent is readable at a glance.

### Card portraits

Portraits are declared per fighter and cropped to a bust at draw time:

```js
portrait: { src: 'assets/portraits/wizard.png', crop: [0.20, 0.15, 0.60, 0.41] }
```

`crop` is `[x, y, w, h]` in 0..1 of the source image, so full character cards can be used directly
without pre-cutting them — the Bandit and Wizard cards have different aspect ratios (1066×992 and
848×1248) and each just gets its own crop. **If the file is missing the HUD draws a placeholder
bust instead** — no error, no gap — so art can be dropped in whenever it exists.

To add a fighter's portrait, save the image as `assets/portraits/<fighter id>.png` and adjust the
`crop` in that fighter's data file until the bust is framed.

## Menus

Scene flow is `title` → `stage` → `select` → `match`, with the pause menu overlaying a battle.
Training mode skips the stage step and goes straight to the roster, because it has exactly one
arena. `Esc` backs out one step at a time, so leaving the character select in a battle returns to
the stage select rather than all the way to the title.

**Stage select** — a grid of cards, each the arena's own art with its name under it, and nothing
else. No layout diagrams, no blurbs: the pictures already say which arena it is, and the layout is
something you learn by playing on it.

The grid **solves for its own column count** rather than fixing one. Five cards in a row only work
in a wide window; in anything squarer they shrink to thumbnails with the bottom half of the screen
empty. Every shape from one column to five is tried and whichever makes the cards biggest inside
the available box wins, so the same screen gives a 5-wide row on a monitor and a 2-wide grid in a
narrow pane. A short final row stays centred under the others. Left/right steps through the roster
and up/down jumps a row, at the same repeat rate as every other menu.

**Main menu** — the game logo over Normal Battle and Training Mode, on a painted backdrop
(`assets/menu-bg.png`). Nothing else: no strapline, no controller count, no control hints. The logo
takes the top half and the two buttons the bottom.

The backdrop is drawn **cover-fit**: scaled to fill and centre-cropped, the same rule as CSS
`background-size: cover`, so any window shape is filled without letterboxing or stretching. A very
wide painting in a very tall window crops hard and reads as a soft wash, which is the accepted cost
of never showing empty bars. It is a bright daytime scene and the buttons are light, so a vertical
wash plus a vignette sits between the two, or the menu washes out against the sky. If the image is
missing, the menu falls back to the character select's gradient.

The logo art (`assets/logo.png`) ships on a white plate rather than with transparency, so it is
keyed once when it loads.

Two things make that more than a threshold. The white is not only *around* the logo — it fills the
pockets between CLASH and RUMBLE, the counters of the A and E, and the gap before the shield — so
clearing only the background reachable from the border leaves white trapped between the letters.
And the artwork's own highlights (the shine along the sword blades, the tops of the stone caps) run
bright, so the cut has to land above them or it eats the art. The plate sits at 243+ on every
channel and the brightest highlight that must survive is comfortably below that, so a flat key at
`LOGO_KEY` separates them wherever they are.

That leaves the antialiased boundary: a hard cut keeps a rim of half-white pixels that reads as a
halo on a dark background. Those are faded out across `LOGO_FEATHER..LOGO_KEY` and un-blended back
toward their true colour — but only where they touch keyed pixels, so the same brightness in the
middle of a blade is treated as a highlight and left alone.

The keyed result is trimmed to its content and cached, so it costs one pass at startup and nothing
per frame. If the file is missing or fails to load, the menu falls back to drawing `CLASH RUMBLE`
as text.

Who player 2 is gets chosen **on the character select itself**, the way Smash does it. Point the
cursor at player 2's chip and confirm to toggle HUMAN ↔ CPU; when it is a CPU, a difficulty row
appears under the card where every level is its own target, so any of them is one confirm away.
Changing difficulty leaves the chosen fighters alone — only switching who is picking clears them,
and the last difficulty is remembered while player 2 is a human.

Picking a CPU switches the screen to a single cursor that chooses both fighters in turn. There is
no separate opponent screen. Either player's cursor can hit the chip, so player 2 can turn *itself*
into a CPU with its own controller. The cursor stays live after a fighter is locked in — only the
roster selection freezes — so difficulty can still be changed right up until the match starts.

**Every menu is navigable by mouse as well as pad and keys.** `MenuList` records its item rects
each draw; hovering highlights an entry and clicking confirms it.

**End of match** shows a real options list — REMATCH, CHARACTER SELECT, MAIN MENU — instead of
relying on remembering which button did what. It is the second half of the victory ceremony below.

## Victory ceremony

`src/game/victory.js`. Half a second after the last KO reads, the match hands over to a ceremony
in two phases:

**The sequence** (222 frames, ~3.7s) is a shot list, not one long camera move — four hard cuts
around the winner, each with its own lens, angle and pose: a low push-in on the weapon raise, an
orbit behind them through a spinning flourish, a tight hero angle as they level a hand at the
camera, and a wide settle that brings the loser into frame. Cuts punch the frame with a flash, and
bars close in for the duration. It always plays in full — there is no skip.

Inputs are still polled and flushed through the sequence even though nothing can act on them.
Nothing else polls once the match is over, and without it a button mashed during the animation
stays latched and gets spent on the options menu the frame it appears, choosing REMATCH for the
player.

**The stats** hold that last framing: the winner celebrating on one side, the loser slumped on the
other, and a panel of match tallies in the gap between them — KOs, falls, damage dealt and taken,
biggest single hit, self-destructs, stocks left, with the better of each pair picked out. The
options menu sits underneath.

Shots are described in *simulation* coordinates — a point to look at, plus an orbit around it —
so the game layer never touches a three.js type; `Renderer3D.applyCeremonyCamera` is the only
place that turns one into a transform. Poses come from the sequence rather than from fighter
state, because by then there is no simulation running to read: the match is over, and the fighters
have become props the ceremony places and poses itself.

The tallies behind the panel are collected during play by `Fighter.recordDamage`, which every path
that deals damage funnels through, and a KO is credited to whoever last connected within five
seconds — anything staler counts as a self-destruct.

## Character models

`src/render/rig.js` builds a low-poly hierarchical box rig, proportioned from each fighter's own
`width`/`height`. There are no model or animation assets — poses are computed procedurally from
simulation state, so a new fighter animates the moment its data file exists.

### Gait

The walk and sprint phases advance with **distance travelled**, not at a flat multiple of speed.
`WALK_STRIDE` / `SPRINT_STRIDE` in `rig.js` set how far the fighter covers per full cycle (two
steps) as a multiple of its height, so cadence falls out of the movement speed:

| | speed | cadence | stride |
|---|---|---|---|
| Bandit walk | 3.2 px/f | 2.5 steps/s | 1.70 heights |
| Bandit run | 7.2 px/f | 3.4 steps/s | 2.75 heights |
| Bandit dash | 8.5 px/f | 4.0 steps/s | 2.75 heights |
| Wizard run | 5.83 px/f | 2.5 steps/s | 2.75 heights |

Driving the phase at a flat multiple of speed instead produced 18 steps/s at a run, which is where
the old "goofy" scramble came from.

**To retime the gait, change the two stride constants — nothing else.** Longer stride means slower
cadence for the same movement speed. Leg swing amplitude should move with them: the stride is how
far the body travels per cycle, the swing is how far the feet visibly reach, and if they drift too
far apart the feet start skating. These strides are already longer than the legs can strictly
cover, which is unavoidable — the fighters move about twice as fast relative to their leg length as
a real sprinter, so a strictly foot-locked cadence would be back in scramble territory. The Wizard's heavier, slower cadence falls out of the same
formula purely because he is taller and slower — no per-character animation tuning.

Walking and sprinting are separate poses, not one pose at two amplitudes: the sprint leans from the
hips (with the legs counter-rotated so they stay underneath, and the head counter-rotated so it
looks ahead), drives the knees high, and pumps arms locked near 90°.

Four sign conventions are easy to get wrong in this rig. Limbs hang along **−y** from their joint
and the model faces **+x**, so a positive z rotation swings a limb *forward* — which makes a knee,
folding only backwards, always negative. At an elbow the rotation is relative to the upper arm:
positive curls the forearm in, negative cocks it back over the shoulder, which is what the windup of
a swing wants. And the hips ride *highest* at mid-stance, dipping when the legs are spread.

**Facing turns her around; it is not a reflection.** The rig adds pi to the yaw, so a fighter who
turns keeps their handedness — the Bandit's bat stays in the hand that holds it. A reflection
(`scale.x = -1`) would make the two directions pixel-identical, and it was tried, but it swaps
handedness with them: the bat changes hands and the hood peak, mask and cloak all flip. She is a
character, not a decal.

The cost is real and worth stating. A half turn flips the forward axis *and* the depth axis, so her
weapon arm is nearest the camera facing one way and behind her body facing the other. **The two
facings cannot look identical**, and any pose that reaches sideways needs thinking about twice.

Three rules fall out of that, each learned the hard way:

- A rotation added to `root.rotation.y` needs a `-facing *` term, because she pivots toward the lens
  from either side, which is opposite directions in her own frame.
- A shoulder's own `rotation.y`, used to cancel that pivot so a swing stays in the screen plane,
  needs `+facing *` to match.
- **Anything that carries the swinging arm must not be camera-relative at all.** The arm hangs off
  the chest, so a facing-multiplied `chest.rotation.y` twists the swing in opposite directions
  depending on which way she is turned — it put the back air's bat 54px further behind her one way
  than the other. Aim the *head* at the camera instead; it carries nothing. That split took the gap
  down to 15px, which is the residual from the shoulder's own depth offset and is unavoidable.

Where a swing would otherwise play out inside her own silhouette on the blind facing, raise the arc
above the shoulder line rather than turning her: fully clearing her torso by rotation takes about
115 degrees, by which point she reads as facing the wrong way mid-move.

**The torso takes the opposite sign to a limb.** A limb hangs *down* from its joint; the torso
stacks *up* from the pelvis, so the same positive z rotation carries it backwards. Leaning forward
from the pelvis is **negative**. This one is genuinely counter-intuitive and it silently inverted
the walk, the sprint and the Bandit's dash — all three leaned *away* from the direction they were
travelling, measured at 12–15px of head-behind-hips, while their comments claimed a forward lean.
Whenever a lean is in question, measure it: take the world positions of `pelvis` and `neck` and
check the sign of `(head.x - hip.x) * facing`. Positive means leaning into the travel.

### Authoring an attack animation

A move names its own animation with **`pose`**; the id and kind heuristics in `kindOf` are only the
fallback for moves that have not been given one. Adding `pose: 'swipe'` to a move's data is the
whole hook-up — there is no per-fighter animation code.

Pose functions get three clocks, and picking the wrong one is the usual bug:

| clock | runs | use for |
|---|---|---|
| `strike` | 0 → 1 → 0, peaking on the hit | thrusts, anything that goes out and comes back |
| `t` | 0 at windup, **0.5 on the hit**, 1 recovered | swings that travel *through* the target |
| `sweep` | 0 at frame 1, 1 on the move's **last active frame** | arcs whose later hitboxes are elsewhere |

Two consequences worth stating outright. On `t`, contact happens at the **midpoint**, so a swing's
endpoints are where it *starts and finishes* — set them to the contact pose and the hit lands with
the bat already on its way back. And `strike` retraces its own path, so a bat swung on it looks like
it is being un-swung; only `t` and `sweep` follow through.

**A windmill swing needs two things, and both are easy to get half-right.**

*Turn the fighter toward the camera.* An arc that runs front-to-back is the one thing a side-on
camera cannot show — seen from the side it is almost pure foreshortening, and the weapon appears to
shrink and grow rather than travel. The Bandit's up tilt pivots over its startup, holds through the
active frames and unwinds during recovery. It stops short of square on purpose (`ARC_FACING`):
fully front-on reads as a pose break, and the residual angle keeps her shoulders reading as a body
in the world rather than a cutout.

*Then swing on the other axis.* Once she has turned, `shoulder.rotation.z` — the usual dial —
points at the camera, so an arc driven on it foreshortens away exactly as before and the turn buys
nothing. The swing has to move to `shoulder.rotation.x`, which sweeps through the plane she is now
facing: down one side, over the head, down the other, all across the screen. The dial runs past pi
so the arm travels *over* rather than down through her own legs.

**Mirror it with facing.** The turn leaves her at yaw ≈ −π/2 one way and ≈ +3π/2 the other, and the
sine of both is negative — so an unmirrored sweep travels the same screen direction whichever way
she faces, and disagrees with hitboxes that *are* mirrored. Negating the dial by `facing` flips the
arc horizontally and leaves its height untouched; measured, the bat tip traces the same heights
(58, 104, 135, 138, 72) with x mirrored.

All of it is presentation: hitboxes are built in sim space from the fighter's facing and never
consult the rig, so reach is identical throughout (94px in front, 90px behind).

`sweep` exists because `phase` is anchored to the *first* hitbox. The Bandit's up tilt travels front
→ overhead → behind and its second hitbox is the one behind her head; on `phase` timing the bat had
only reached vertical by the time that box went live. Shoulder z reads as a dial around the body — 0
hangs down, ~1.57 forward, ~3.14 straight up, and past that it carries on over and behind, which is
why some sweeps are written as a lerp running past pi.

**Attacks are eased out of, never into.** Every pose is computed from scratch each frame, so the
frame a move ends the fighter is simply *standing* — the arm that was extended is suddenly at her
side, a whole pose crossed in one frame. `blendOut` freezes the pose the attack finished on and
eases away from it on a smoothstep, which is flat at both ends and so has no visible step entering
or leaving the blend.

Three rules keep it from doing harm:

- **Only the exit.** Blending *into* an attack would soften the windup, and startup is information
  the opponent is entitled to read at full sharpness. Starting a move also cancels any ease still
  running from the last one.
- **Hits are exempt.** Hitstun, tumble, grabs, knockdown and ledge grabs are in `NO_BLEND_STATES` —
  a hit has to land on the frame it lands.
- **Length scales with distance.** The up tilt finishes with the arm behind her head and has four
  radians to unwind; a down tilt is nearly home already. One fixed length either leaves the big
  move stepping visibly or the small one drifting back in slow motion, so it is derived from the
  actual gap (4-12 frames).

Measured on the Bandit's normals, this cuts the largest single-frame joint move after a move ends by
66-86%, and the remaining motion is spread as a symmetric bell that starts and ends at zero.

Kicks are the exception to all of it: they snap out, hold through the active frames, then retract.
Easing one through contact reads as a stumble, and leaving the leg extended for the recovery reads
as a freeze.

**Horizontal swings live on `shoulder.rotation.x`.** Driving a swing with z alone gives a *vertical*
arc — an overhead chop — because z sweeps the limb up and over. Holding x near a right angle first
lays the arm into the horizontal plane, and only then does z become a sweep *around* the body:
`z = 1.57` points down the fighter's facing, below that swings behind, above that carries across the
front. The Bandit's one-two and her forward tilt are all one pose family built this way, mirrored by
a `dir` sign — jab 1 sweeps out, jab 2 sweeps back. The torso turns with them: shoulders hang off
the chest, so a chest y rotation carries the whole arm round and the swing reads as thrown from the
hips rather than flapped from the shoulder.

**A punch is not a swing.** The Wizard's jabs drive along the facing and come straight back, so they
run on `snap` and leave `x` alone entirely — laying the arm into the horizontal plane the way the
sweeps do sends the fist out *sideways*, measured 31 units off the centre line. The extension is all
in `shoulder.rotation.z` and the elbow.

### Rig axis signs, measured

Guessing these wastes more time than measuring them. Every value below was read off the rig by
posing a joint and taking the world position of the hand or foot, and several are the opposite of
what seemed obvious:

| what | rule |
|---|---|
| `shoulder.rotation.z` | the main dial: 0 hangs down, 1.57 forward, 3.14 straight up |
| `shoulder.rotation.y` | **+ pulls the right arm inward, − the left** — so an on-centre punch is `+0.18 * side` |
| `chest.rotation.y` | **+ drives the right shoulder forward, − the left**; worth real reach (fist travels 44 with the turn against 38 without) |
| `shoulder.rotation.x` | spreads the arm into depth — **and its sign flips with `z`**: at `z ≈ 0`, −x throws the right arm outward; overhead at `z ≈ π`, +x does |
| `elbow.rotation.z` | **always positive.** A forearm does not fold behind the upper arm |

**The elbow only bends one way.** Measured on a hanging arm: `+1.4` puts the hand 28 in front of the
elbow, `-1.4` puts it 28 *behind* it. Because the rotation is relative to the upper arm the world
direction flips as the shoulder swings — overhead, positive folds the hand behind the head, which is
still correct — but the sign never does.

The one deliberate exception is the Bandit's weapon arm: a bat cocked back over the shoulder is a
hyperextension you would not do bare-handed, and on a weapon it reads as a windup rather than as a
broken joint. Every empty-handed pose must stay positive. The Wizard's first draft had all eight of
his pose families negative, which is what made the fireball throw look wrong.

That last row is the nasty one. The T-pose at the end of the Wizard's up tilt is built at `z ≈ 3.06`
where the signs are inverted relative to a hanging arm, so a spread that is correct overhead is
backwards at the hip.

**A symmetric two-armed pose needs the camera-yaw cancellation mirrored.** A one-armed swing like
the Bandit's up tilt just cancels the body's yaw at the shoulder. Doing the same to *both* arms tips
the whole T nine units out of level, because the two shoulders meet that yaw from opposite sides.
Negating it on one arm brings the hands dead level (measured gap 9 → 0) with the spread unchanged.

**Deep crouches put feet through the stage.** A leg is 46 long against a 46 hip height, so *any*
sink at the pelvis drives the feet below y = 0 unless the knees fold to absorb it. Three of the four
Wizard normals shipped their first draft with feet underground — the legsweep worst at 21 below,
against an idle baseline of −6. The fix is always the same: bend the knee harder, not raise the hip.
Worth checking numerically on anything that crouches, because at these depths the margin is a few
units and the eye will not catch it in motion.

### Weapons

A weapon is parented to the fist, so it inherits whatever the arm is doing. The bat extends *past*
the fist along the limb; the staff stands *out* of it the other way. Both are long enough that a
pose written for an empty hand puts them somewhere absurd — dragging through the shins, or speared
into the floor — so locomotion, guard, grab and throw poses finish with `carryWeapon()`, which rests
the bat over the shoulder and keeps the staff upright. Attack poses do not call it: a swing is
supposed to carry the weapon through its arc.

Resting the bat is done with a curled elbow **and a cocked wrist**, not by folding the elbow
backwards. Both put the bat in the same place, but only one is a joint that bends that way — which
is why the wrist is a posable joint at all. It is the same reason a real shoulder-carry works: the
bat lies *across* your forearm, not in line with it.

The wrist is also the joint people reach for by reflex when a blade points the wrong way, and it is
usually the wrong fix. A limb hangs along its own -y, so **raising an arm overhead already turns the
hand over** and a weapon built along -y continues straight up out of the fist. Adding
`hand.rotation.z = Math.PI` on top of that points it back at the floor. The Goblin's up smash was
written that way and measured with its blade at chest height (65) while the hitbox ran to 112 —
the hit connected, so nothing looked broken until the tip was measured. Check the arm's world
angle before touching the wrist.

A fighter's `hitEffect` (`'blunt'`, `'fire'`, `'slash'`, `'electric'`) drives its impact sparks,
and the shared getup and ledge attacks inherit it — so a bat-wielding fighter never sparks like a
blade on a move it shares with everyone else.

Two knobs sit alongside the feature list and are easy to miss. `model.scale` multiplies `this.W` and
`this.H` at the top of the rig, which uniformly resizes every proportion *and* every pose offset,
because all of them are written as fractions of those two numbers — it is the one place a resize can
be applied and have the arms, the weapon and the animation all come along. The Barbarian carries a
`0.95`. `model.gloves: false` takes the fist back to skin and drops the forearm cuff; the fist block
itself always stays, because it is what reads as a hand and it is the node every weapon is parented
to. Both are cosmetic — hurtboxes come from `def.width`/`def.height`, so neither quietly changes how
hard a fighter is to hit.

**Everything that makes a fighter recognisable is data.** Each fighter's `model` block declares a
palette plus which features to assemble, and the rig does the rest:

```js
model: {
  palette: { garment, trim, skin, hair, leather, gold, trousers, boot, eye, wood, … },
  hood: { color, trim, peak },   // crown, back drape, cheek panels, face trim
  hair: 'bob' | 'short',
  mask: true,                    // Bandit's domino mask
  beard: true, brows: true,      // Wizard
  tabard: { color },             // panel hanging from the belt
  belt: { color, buckle: 'gold' | 'metal' },
  shoulderTrim: true,
  cloak: { color, length },
  weapon: 'bat' | 'dagger' | 'staff',   // omit for a bare-handed fighter
  variants: { red: {…}, blue: {…} },    // player-slot recolours, below
}
```

Adding a fighter's look means writing that block, not touching the renderer.

Two things worth knowing:

- **Player identity is a recolour, not a tint or a marker.** Each fighter authors a `red` and a
  `blue` variant: a partial `model` block restating the clothing palette and whichever garment
  pieces it repaints, laid over the base by `applyVariant`. Everything unmentioned is inherited, so
  the Bandit keeps her white bob, mask, teal eyes and bat on either side. Slot 0 wears red and slot
  1 blue, matching the HUD frames — which is what makes a mirror match readable, the case a marker
  under the feet was solving less well.
- **Detail meshes are excluded from the shadow pass.** At ~45 meshes per fighter the shadow render
  became the dominant frame cost (142 → 68 fps). The silhouette comes from the large parts, so any
  mesh below a volume threshold has `castShadow` disabled — that restored the full 142 fps with no
  visible difference.

### Inspecting the render

`server.js` exposes a dev-only `POST /__capture` that writes a canvas data URL to `capture/`:

```js
fetch('/__capture', { method: 'POST', headers: { 'x-capture-name': 'shot' },
                      body: document.getElementById('game3d').toDataURL('image/png') });
```

Useful for checking the 3D view at full quality without depending on an external screenshot tool.

## Stages

Five battle stages plus the training arena, one data file each in `src/data/stages/`. They are the
Clash Royale arenas, built from the card art: palette, skyline, light and props all come from the
reference rather than being invented.

| Stage | Layout | Platforms |
|---|---|---|
| Goblin Stadium | Battlefield | two side + one top |
| Bone Pit | Final Destination | none |
| Barbarian Bowl | Smashville | one long central |
| Spell Valley | Pokémon Stadium 2 | two, set wide |
| Builder's Workshop | Town and City | one central + two high |
| Training Camp | flat, with distance markers | none |

### What is shared and what is not

`common.js` holds the numbers that must not drift: `GROUND`, `BLAST`, `SPAWNS`, and the two
platform heights. Every stage imports them, so blast zones and stage width are identical
everywhere and a kill percent measured on one transfers to all of them. What varies is **layout,
palette and dressing** — never the geometry a launch is measured against.

The two platform heights are defined against *measured* jump heights, not picked to look right:

- `LOW` (150) sits inside a full hop, which peaks at **172** for the Bandit and **175** for the Wizard
- `HIGH` (290) is above a full hop and inside a double jump, which peaks at **311** / **317**

That is the whole point of Builder's Workshop's tiers: its outer platforms **cost a fighter their
air jump** to reach, so going up there is a commitment that can be punished. The margins are about
20px on both tiers — tight enough to feel deliberate, wide enough not to be a coin flip.

Its high platforms are **inset from the ledges** rather than flush with them. Hanging off an edge
underneath an overhanging platform makes recovery and edgeguarding fiddly, and Town and City's
outer platforms sit inboard for the same reason.

Barbarian Bowl's central platform is **static**. Smashville's moves; ours does not, because moving
geometry is a simulation feature — the collision resolver assumes platforms hold still — and that
is not something to smuggle in through a stage data file.

### The main platform is a plate

`GROUND.h` is the depth of the solid body hanging under the standable surface, and it is the single
number that decides whether a stage plays like a Smash stage or like a box. At its original 700 the
body reached almost to the bottom blast zone, so **the space under the stage did not exist**: an
offstage fighter could only ever return to the ledge it fell from, and every edgeguard was a
one-sided read.

At 120 the body is a keel and everything below it is open air. Dropping off one ledge and crossing
underneath to the other is a real option — and a real risk, because the bottom blast zone is down
there and the trip costs an air jump and most of a bar of Elixir.

The depth was measured, not eyeballed. A fighter is 92 tall, so the corridor its feet can occupy
runs from `h + 92` down to the blast zone at 540, and how far you get across the 1012 depends
entirely on how long you can stay in it:

| `GROUND.h` | corridor | how far the Bandit gets |
|---|---|---|
| 170 | 278px | 852 of 1012 — dies short |
| 130 | 318px | clears the far ledge |
| **120** | **328px** | **clears it with margin** |

So 170 looked right and was not: it left the underside as a dead end you could enter but never
leave. 120 is the shallowest the keel can be drawn and still read as an island, and the deepest
that leaves the crossing open.

Verified end to end at the shipped value: walking off the left ledge, the Bandit enters the corridor
at x = −491, crosses the whole underside on drift plus one air jump and eight side specials, and
exits past the far ledge at x = 511 — **with zero frames of wall contact**, so she is genuinely
under the plate rather than scraping along its side.

Thin plates invite tunnelling, where something moves further in one frame than the plate is deep.
Nothing here does: the hardest launch measured is **94px per frame at 400%**, against the 120 + 92 =
212 a fighter would have to cover to skip the plate entirely. Ledges are unaffected either way —
ledge detection reads `p.x` and `p.y` only, and never `p.h`.

The renderer draws the plate as three tapering strata rather than one box, so it has an island
silhouette. Every tier stays **inside** the collision box: the top tier is exactly `p.w` wide so the
ledges sit on the visible corner, and the ones below only ever shrink. Drawing wider or deeper than
`p.h` would put rock where the simulation says there is open air, which is the one thing the keel
must never do.

### Props

Set dressing is declared as data on the theme and built by `buildProps` in the renderer: each entry
is `{ type, x, y, z, ... }` in simulation coordinates, drawn from a library of crude builders
(palisade, tusk, skull, banner, barrel, crystal, cauldron, crane, sawblade, target, fence, tree,
water) in the same low-poly language as the fighters. The Bone Pit needs tusks and banners and
Spell Valley needs crystals and a glowing pot; both read from silhouette and colour alone.

**Props are decoration only.** Nothing here is collidable and the simulation never sees them, so a
stage's feel is entirely its platform layout.

**Everything stands on a surface.** Props were originally placed at "ground level" wherever they
looked good, but the arena is a plate only 300 deep, so anything set further back than that had no
ground beneath it and simply hung in the sky. Two things fix that:

- `on: 'terrain'` anchors a prop to the **backdrop plateau** instead of the stage deck, and that is
  where all the scenery now lives. The play deck is left bare, which is also better for reading a
  match — clutter on the floor competes with the fighters.
- The banner builder grew a **mast**. A banner is anchored at its base like every other prop and
  carries its own pole up to the crossbar; before, it was anchored at the crossbar with nothing
  holding it up, which is precisely how you end up with flags floating in mid-air.

Two more traps worth recording, because both cost a debugging pass:

- The stage is a **300-deep box**, not a plane — it spans z from 25 back to −275. A prop meant to
  sit *behind* the arena must clear z = −275 or the ground swallows it. All three water features
  were originally buried.
- Scenery must not share a colour and a height with a platform. The Workshop's cranes in timber, at
  the height of its high platforms, made it impossible to tell what could be stood on; they are
  steel now, and its timber stacks moved to the flanks for the same reason. The same fix (taller,
  darker) separates Goblin Stadium's watchtower from its top platform, and Barbarian Bowl's barrel
  from its central one.

### The backdrop plateau

`buildTerrain` draws the landmass the scenery stands on: a wide shelf set back past the stage, its
surface a little below the arena's. Getting it to read took three corrections, all of them about
what the camera actually sees rather than what the geometry is:

- **Height.** It sits near stage level, not far below. Dropped to a shelf a few hundred units down
  it lands *inside* the corridor under the stage, and a fighter crossing underneath reads as being
  below ground.
- **Depth.** The landmass is seen front-on, so its **front face** is what fills the frame. At 340
  tall that face became a wall of flat colour behind the arena, and the island was silhouetted
  against a wall instead of against sky — which is exactly what stops a floating stage from looking
  like it floats. It is a thin 110 lip now, with open sky under and behind the arena.
- **Value.** It is darkened hard against the stage's own palette. In matching colours the two greens
  read as one surface and the arena looked like a slightly raised patch of the field behind it.
  Distance should look like distance.

### Light

Clear colour, fog and all three lights were fixed values, which meant every arena rendered at
night whatever its palette said. They belong to the theme, so a stage now sets its own time of
day — midday over Goblin Stadium, desert dusk in the Bone Pit, overcast in the Workshop, and Spell
Valley lit from within by its own crystals rather than from above.

Two things fell out of doing this:

- **Fog has to clear the camera's own pull-back.** The camera sits ~1200 out at spawn and past 2200
  when the fighters split to the ledges, so the original 1500 near plane fogged the *fighters* by a
  quarter and bleached the props to grey the moment the view widened. Starting past the widest
  camera distance leaves fog doing only its real job: the far floor plane below the stage.
- **Fog is tinted between the two sky bands, not to the horizon.** Keyed to a pale horizon it
  washed the backdrop to near-white; pulling it toward the zenith keeps distant objects solid.

The backdrop wall is a **vertical gradient** from `sky` to `skyLow` rather than one flat colour —
a wall of a single colour reads as a wall, and the ramp is what makes the space behind the stage
feel open.

Beyond that the sky is empty. A pair of generic cone-roofed keeps used to flank every stage; they
were borrowed scenery — the same two towers whatever arena you picked, in a shape that belonged to
none of them — so they are gone, along with the `backdrop: 'plain'` flag that existed to switch
them off. Each stage's own props do the framing now, which is the point of having them.

## CPU opponents

`src/game/cpuController.js` is a **drop-in PlayerInput**, like the training dummy — the AI presses
the same buttons a human does and is bound by the same input buffers, frame data, landing lag,
Elixir costs and special cooldowns. It has no privileged information and no abilities a player
lacks.

Three stages per frame:

- `perceive()` records the opponent and reads that history back **N frames stale**, so reaction
  time is a genuine information delay rather than a fake accuracy penalty
- `think()` picks a short plan — a held input plus a duration
- `poll()` renders that plan into raw input fields, edge-triggering smash flicks and dashes

It recovers, edgeguards, shields and rolls, techs knockdowns, DIs to survive, chases landed hits
into follow-ups, switches to kill moves at high percent, and keeps enough Elixir in reserve to make
it back from offstage.

It also **changes floors.** Nothing in the moveset crosses a platform gap, so an opponent standing
a storey up is not something to swing at — `climb()` walks underneath them and jumps, spending the
air jump at the apex when the platform needs it, and `descend()` crouch-flicks down through a soft
platform to get at someone below. Both only trigger for an opponent who is *standing* somewhere;
one merely airborne overhead is being juggled, which the anti-air already handles.

Because a plan's held inputs run straight into the next plan's, every jump goes through
`jumpPlan()`, which releases the button for a frame first. Two plans that both hold jump are one
press, not two — the bug that had a CPU jump once and then walk around with the button welded down.

**Difficulty is only ever numbers in `src/config/cpu.js`** — no tier gets extra behaviour. Measured
over a round robin (both sides, independent seeds, 8 matches per pairing):

| level | record | damage dealt ÷ taken |
|---|---|---|
| Easy | 6W–18L | 0.59 |
| Normal | 12W–12L | 1.01 |
| Hard | 17W–7L | 1.19 |
| Expert | 13W–11L | 1.40 |

Easy loses to every other tier and is the only one that fails recoveries. Hard and Expert are
close — Hard converts slightly more wins, Expert is the more efficient. Tuning further is a matter
of editing that one table.

**Pause menu** — Start (or Escape) during a battle opens it, attributed to whoever pressed it.
Resume, Restart Battle, Character Select, Main Menu. The frozen battle stays visible behind the
dim, and the match is simply **not stepped** while paused, so pausing costs zero simulation frames
and resuming is frame-exact. Input buffers are flushed on both open and resume so a queued attack
never fires on the way back in.

Both are built on `src/ui/menuList.js`, a shared vertical list that any connected player can drive
— menus should not care which pad is "player one". Locked entries can be highlighted but refuse
confirmation with the same shake-and-deny used by locked roster slots.

Note that the developer pause (`P`) is separate and orthogonal: it freezes the entire loop
including menus, for frame-stepping with `O`.

## Training mode

Same roster grid, but with one human. A single cursor picks your fighter and then the dummy's —
the cursor changes to the CPU's colour and a `C` tag for the second pick, and the dummy's panel
reads "TRAINING DUMMY · CPU · WILL NOT FIGHT BACK".

The match runs on the **Training Camp** — the Clash Royale tutorial yard, and the only stage you do
not pick, because it is not an option so much as where training happens. It is flat with no soft
platforms, has distance markers along the floor and no arena towers, and is the brightest and
flattest light in the game: reading the fighters matters more than atmosphere. Its main platform
and blast zones are the shared ones, so anything measured in training transfers straight to a real
match. Training is untimed and never ends — the HUD shows `TRAINING` instead of a clock and `∞`
instead of stock pips.

### The dummy

`src/game/dummyController.js` is a **drop-in replacement for a PlayerInput**, not a special case
inside `Fighter`. The fighter stays completely input-agnostic, so the dummy is bound by exactly the
same rules, physics and frame data a human is — it can be grabbed, shielded through, and KO'd
normally.

It stands still until it is knocked off the stage, then recovers the way a player would: drift back
toward the centre, **double jump first**, and fall back on the **up special** only once the jump is
spent. On reaching the ledge it hangs briefly then climbs back up.

It deliberately does **not** DI. Leaving the stick neutral through hitstun keeps launch
trajectories reproducible, which is the entire point of a training dummy.

## Character select

A Smash-style roster grid holding the full cast from the design document — **61 fighters** in one
continuous grid, in the document's own order (which happens to group them by archetype: Brawlers 13,
Zoners 13, Swordies 10, Heavies 12, Floaties 5, Riders 5, Tag Teams 3).

61 is prime, so no column count divides it evenly. The layout picks from a shortlist of column
counts — the ones that leave a reasonably full final row rather than an orphan — and chooses
whichever gives the grid an aspect ratio closest to the space available, then centres the partial
last row. On a typical 16:9 window that lands on 11 × 6.

Only fighters with a data file are selectable. The rest are locked slots — padlocked, greyed, and
named, so the intended roster is legible. Adding a fighter to `IMPLEMENTED` in
`src/data/roster.js` is all it takes to unlock its slot.

Each player drives a **free-roaming hand cursor**. The left stick steers it analogue (with a
response curve for fine control near centre) and the mouse moves it directly; whichever slot sits
under the fingertip is the one that gets picked. Attack/A or a mouse click locks in, Special/B
cancels, Start begins the match. Trying to lock a locked slot shakes the hand and refuses, and
locking in freezes that player's cursor in place.

The mouse drives player 1 and hands control straight back to the stick the moment it moves.
Gamepad navigation uses `PlayerInput.menuX/menuY`, which merge the stick with the full D-pad —
deliberately separate from the in-game axes, because in a match the D-pad is bound to taunt.

### Shared UI kit

The chunky outlined type, the rounded character card and the portrait loader live in
`src/render/uiKit.js` and are used by **both** the HUD and the character select, so a fighter's
card looks identical on the select screen and on the match HUD, and there is one implementation
to change rather than two.

**Type is chiselled, not soft.** `displayText` strokes its outline with **mitred** joins and a low
miter limit, so the outline comes to a point at every corner of the letterform instead of being
sanded off, and the drop is a hard offset rather than a blur. The limit is low on purpose: an
outline this thick throws long spikes off the sharpest glyph corners without one.

**`roughRect` is the angular counterpart to `roundRect`** — corners chamfered instead of rounded,
and each edge walked with per-vertex noise so it reads as cut stone. Two things matter in it. The
noise is derived from the vertex index, never from a random source, so a shape's chips are
identical every frame; anything else makes the edges crawl and the panel looks like it is boiling.
And the noise is *squared*, so most vertices sit almost on the true edge and only a few take a real
bite — spread evenly, the same amplitude reads as a wave rather than as something chipped.

Menu slabs (`MenuList`) use it for the body, the inset face and the selected rim, each with its own
seed so no two buttons share a chip pattern. The face is lit by stroking **its own path** with a
top-to-bottom gradient, which lights the chipped contour itself; straight highlight lines drawn
across the top instead float free of the edge they are meant to be catching.

The character select grid deliberately keeps its rounded cards — the angular pass is for type and
menu slabs only.

The character select is built from the same kit: the card gets a coloured halo and the panel
border lights up when a player readies up, the archetype sits in an Elixir-pink chip, and the
whole screen is controller-navigable exactly as before.

**Movement** — walk, dash, run, run-brake, turnaround, crouch, jumpsquat, short hop vs full hop,
double jump, air drift with momentum preservation, fast fall, platform drop-through, landing lag,
autocancel windows.

*Platform drop-through is checked ahead of the state machine*, not inside the crouch state, and the
distinction matters. Dropping through is a property of **pressing down while standing on a soft
platform**, not of already being crouched. With the check inside the crouch case it could almost
never fire: the same down input that asks for the drop is also what moves IDLE or WALK into CROUCH,
and the flick that carries the request lasts exactly one frame, so by the time the crouch case ran
it was already gone. Holding down did nothing at all, and only a second press while *already*
crouched would drop you. Attacks still resolve first, so down-plus-A on a platform is a down tilt,
not a drop.

*Spending an air jump is visible.* It leaves a flattened ring hanging in the air where the fighter
pushed off, as in Ultimate — an air jump is a resource, and a player needs to see it go without
having to count.

*Intangibility is visible too.* A dodge, roll, air dodge or tech ghosts the fighter to a
translucent grey, tied to the **intangible frames** rather than to the animation: the ghost marks
the window that actually beats an attack, and drops the moment the recovery frames begin. The
recovery of a spot dodge is as punishable as anything else and should not look safe. Hit flash and
dodge ghost share one material slot on the rig, so they can never disagree about what a mesh is
wearing — a fighter clipped on the tail of a dodge reads as hit, the more urgent of the two.

*Hanging on a ledge puts the whole body below the lip.* `LEDGE.HANG_DROP_RATIO` drops the fighter
by a multiple of **its own height**, not a flat distance, so every character hangs with its head
the same depth below the edge (currently ~11px) rather than a tall one leaving more skull in
range than a short one. Only the arms reach over the lip, which is what keeps a hanging fighter out
of reach of grounded pokes. All four ledge options still recover from the lower position — getup,
roll and attack step onto the lip, and the ledge jump clears it by 58-79px.

*Smashes are deliberate; dashes are not.* Both read the same motion — the stick crossing a
threshold from near-neutral — but not through the same window, because they want opposite
treatment. A smash coming out when a tilt was wanted costs 40-odd frames of recovery the player did
not ask for, so it needs a genuine flick: the stick has to travel from near-neutral to past 0.84
within **2 frames**, and attack has to follow within **3**. A dash wants to be easy, since it is how
you move and dash-dancing throws the stick around all game, so it keeps a 5-frame window. Sharing
one window meant tightening the smash also broke dash-dancing.

The right stick is a **tilt stick**, not a smash stick. Smashes are the left stick's flick plus
attack and nothing else — including out of shield — so the stick you reach for when you want a quick
poke can never hand you a committal smash instead.

The CPU is bound by all of this, since it presses the same buttons through the same layer. It
re-throws its flick while its attack is still queued, which is what a player does when they flick,
find they cannot act yet, and flick again — not a longer window than the player gets.

*Dash-dancing.* A reverse **flick** out of a dash or a run reverses instantly at full speed —
no skid, no turnaround animation — so flicking back and forth holds the dash indefinitely.
The run-brake is reserved for the two cases where the player actually means to stop: releasing
the stick, or deliberately tilting the other way at walk magnitude. Holding a full tilt the
other way without flicking still turns around, but pays the turnaround animation for it.

*Keyboard is not a stick.* A key goes 0 → 1 in a single frame, which is indistinguishable from a
stick flick, so the analog flick detector must not run on it — otherwise every keypress becomes a
dash and every directional attack becomes a smash. Keyboard derives those from explicit intent
instead, and inverts the walk/run default:

- `PlayerInput.autoRun` is true for keyboard bindings. A stick decides walk-vs-run from how far it
  is pushed; a keyboard cannot express that, and defaulting to a walk meant double-tapping for
  every approach.
- `PlayerInput.wantsWalk` is the walk modifier. The fighter reads this **semantic flag**, not the
  device — a gamepad simply never sets it, so gamepad feel is untouched and a walk button could be
  bound later without touching the state machine.
- `PlayerInput.smashModHeld` suppresses auto-run, so holding a direction to aim a smash does not
  break into a dash and turn it into a dash attack.

Auto-run is applied in the fighter's idle/walk branch rather than only on the key press, so it also
takes effect after landing, braking, or any other return to neutral with a direction still held.
Gamepads keep the velocity-based detection throughout.

*Movement scale.* The Bandit crosses the 1012px stage in ~2.2 s and the Wizard in ~2.8 s.
A full hop peaks at ~175px (about 1.8 character-heights) with 52-58 frames of airtime.

*Jumpsquat is universal* — `PHYSICS.JUMP_SQUAT_FRAMES`, not a per-fighter attribute. It is the
window every short hop, jump-cancel and out-of-shield option is timed against, so giving a heavy a
longer one reads as unresponsiveness rather than weight. Weight lives in gravity, fall speed and
air control instead.

Jump height and platform height are coupled: the side platforms must sit inside a full hop with
room to act on landing, and the top platform must require a double jump. Changing one means
re-checking the other — `CR.balance()` won't catch it, but the reachability check in the
movement notes below will.

*Facing is committed on leaving the ground.* Neither drifting backwards nor double-jumping
backwards flips the character — that is what keeps back air a distinct move from forward air.
An air jump still reverses your *momentum* toward the stick, it just doesn't turn you around.
The only mid-air reversal is a directional special, which is a deliberate, committed input.

**Combat** — jab chains with rekindle cancels, tilts, dash attack, chargeable smashes, five aerials,
grab / dash grab / pummel / four throws, capsule hitboxes and hurtboxes, hitlag, hitstun,
move staling, clanking, projectile priority, super armour hooks.

*Two things about grabs are easy to get wrong, and both were.* The pummel never runs as an action —
the hit is applied inline and the fighter stays in the grab — so the length it declares enforces
nothing on its own, and mashing landed one every 8.6 frames instead of `GRAB.PUMMEL_FRAMES`. It now
holds an explicit cooldown, ticked in `tickTimers` rather than in the grab step so the pummel's own
hitlag does not stall it; counting only unfrozen frames stretched 16 out to 24.

And a throw's `angle` is measured **in the frame `reverse` has already flipped**, so a back throw's
angle reads like a forward one — 45 is up-and-away. Writing a rear-facing angle there as well
reverses it twice, which is why the back throw used to send opponents forwards.

*Aerial landing lag is short* (4-6 frames for most aerials, 10-12 for the down airs) so that
landing an aerial leaves a real combo window: a Bandit forward air gives +11 frames of advantage
at 0% and +37 at 90%. Autocancel windows drop it to the fighter's base landing frames.

**Knockback** — Smash Ultimate's formula, with weight, rage, DI, Smash DI, Sakurai angles,
tumble, and knockdown/tech.

*Launch profile.* A hit reads in three beats: a short **freeze** (3-6 frames, scaled by damage),
then an **explosive launch**, then a **decay** back to ordinary momentum. The knockback vector is
integrated separately from gravity — it loses magnitude at a constant rate while gravity
accumulates on top — so the horizontal burst stays intact and gravity only bends the arc. At
120% a forward smash launches at 35 px/frame and reads `35 → 29 → 23 → 17 → 10` over the next
45 frames.

Because deceleration is constant, range is quadratic in knockback: initial speed scales about
4× from 0% to 180% (11 → 47 px/frame) and distance scales far harder than that. That quadratic
relationship is what makes damage matter, and it is why a proportional/exponential decay was
*not* used — it would compress weak and strong hits toward each other.

*Throws use low base knockback and high growth* (e.g. bkb 40 / kbg 124 for a back throw, versus
the bkb 68 / kbg 68 they started with). High-base/low-growth throws pop the opponent almost the
same distance at 20% as at 180%, which makes a grab feel dead at kill percent. Down throw is the
deliberate exception — it stays weak so it keeps the opponent in combo range.

**Defense** — shield with health, shrink, stun, poke, break and dizzy; out-of-shield jump / grab /
up-smash / up-special; spot dodge, forward/back roll, neutral and directional air dodge;
teching in place and tech rolls; getups and getup attacks.

**Ledges** — ledge grab boxes, hang intangibility drawn from a per-airtime budget, ledge trumping,
regrab lockout, and the five ledge options (getup, roll, jump, attack, drop).

**Match** — stocks, percentage damage, blast zones, KO freeze, respawn platform with invincibility,
7-minute tournament clock, timeout resolved on stocks then damage.

*The ceiling only kills you if you were hit into it.* The upper blast zone sits far above
anything a fighter can reach under its own power, and a top-side KO additionally requires that
the fighter is riding an upward launch. Jumping or recovering into the ceiling stops the ascent
and drops the fighter back in instead of killing them. Side and bottom self-destructs still
count — failing a recovery is supposed to kill you.

*A move connects once per target.* Hitboxes are keyed per move, not per hitbox, so a move's
late/weak hitbox cannot re-catch someone its early/strong hitbox already launched. Explicit
multi-hits (the Fire Tornado) opt back in with `rehitRate`.

**Elixir** — 10-point bar, per-special costs, regeneration, spend denial, cooldowns, regeneration
locks, and the late-game production increase (×1.5 at 2:00 remaining, ×2 at 1:00).

*You pay when the move comes out, not when you press the button.* Affordability is checked on the
input — an unaffordable special still refuses, or takes its `fallback` — but the Elixir itself is
held as a pending cost on the fighter and committed on the move's `costFrame`: the frame the
projectile spawns, the intangibility starts, or the first hitbox goes live. Anything that takes the
fighter out of the move before then (a hit, a grab, a KO, a cancel) drops the pending cost with it,
so a special that never came out is never charged. `setState` is the single choke point every
interruption passes through, which is where the cost is released.

Specials also *do not land-cancel*. An aerial special plays out exactly as it would have on the
ground — being cut off by the floor mid-startup, while already paid for, was the worst version of
the bug above. Aerials and air dodges still land-cancel into landing lag as before.

---

## Where the documents were ambiguous

Every deviation is deliberate, isolated, and easy to change.

| Question | Decision |
|---|---|
| Elixir regeneration rate | The full document explicitly defers this ("a later decision to take during balancing"). Set to **1 per 2.0 s** in `src/config/gameplay.js`. |
| Fireball cost | The full document says 3 and calls it "arbitrary"; the executive document positions it at 5-6 as the expensive counterweight to the Archer's 1-2. **5** is used, because that framing is what makes the economy legible. |
| Bandit's Neutral B and Down B | Not specified. Given a 1-cost Stone Toss and a 1-cost Snatch that steals Elixir. An earlier Smoke Bomb, derived from the document's note that the Boss Bandit shares the dash *plus* smoke bombs, was cut: it was a third escape tool on a character who already has two dashes. |
| Late-game thresholds | The document gives 2:00 → +50% and 1:00 → +100% against an unstated match length. Applied to the 7-minute tournament clock it also specifies. |

Rage, move staling and Smash DI are not named in the documents. They are included because the brief
asks for Ultimate-quality movement and combat, and all three are load-bearing parts of that feel.
Each can be switched off from `src/config/gameplay.js`.

---

## Online play

Host or join a 1v1 with a six-digit code, from ONLINE MATCH on the title screen. The host picks the
stage, both players pick their own fighter, and the match starts when both picks are in.

**One process serves both jobs.** The relay is attached to the same `node server.js` on the same
port as the page, so the client derives the socket address from `location` and there is nothing to
configure. A LAN opponent needs the host's address and nothing else.

### Deterministic lockstep

Both machines run the same simulation and exchange **only inputs** — six bytes per player per frame,
against kilobytes for a serialised world. This is possible because the simulation already is
deterministic: there is no randomness anywhere in `game/`, `engine/` or `core/`, and the only
`Math.random` calls in the project spawn visual embers that never feed back into a fighter.

Measured before building anything on top of it: two independent `Match` instances driven by the same
2,600-frame scripted input stream produced **identical hashes at all 26 checkpoints** and identical
final damage. Over the real relay, two peers stayed in sync for 3,000 frames with zero desyncs.

Frame N is simulated from input both players gave on frame N − 3. **The local player's input is
delayed too** — that is the part that feels wrong and is essential, because input applied
immediately on one machine and three frames later on the other is two different games. At 60Hz that
buys 50ms of headroom.

If the peer's input has not arrived, the frame simply does not advance and the last one is rendered
again. No rollback and no prediction: nothing is ever speculatively applied, so there is nothing to
unwind. A stall is visible and recovers; a desync silently makes two different matches, which is far
worse.

### What had to change to make it possible

**Input derivation was split from device reading.** `readDevice()` returns a raw sample — sticks,
buttons, d-pad — and `applyRaw()` derives everything else: buffers, flick detection, smash memory,
dash taps. Local play feeds one straight into the other; netplay feeds `applyRaw` from the wire.
Everything downstream is untouched and never learns that a player is remote.

**Axes are quantised to a byte before use, locally as well as remotely.** That is not a bandwidth
compromise, it is a correctness requirement: lockstep only holds if both machines derive from
bit-identical samples, so the local player's own input goes through the same round trip its opponent
will see.

**`Match` needed an `externalInput` rule**, because `step()` polls devices itself and would
otherwise overwrite the remote player's input with a live read of the local controller. Worth
knowing: `this.rules` is a **whitelist** rebuilt from the argument rather than a spread, so a rule
that is not named in the constructor is silently dropped — which is exactly how this failed to take
effect the first time, and cost a desync hunt to find.

### Deliberate limits

- **No pause.** A pause menu needs one machine able to stop time, and neither can.
- **No rollback**, so the link is only as good as its latency. Beyond ~50ms it stalls rather than
  hiding it.
- **A desync is reported, not repaired.** State hashes are exchanged every 30 frames; on a mismatch
  the players are told. Recovering would need a full state transfer, which this design does not
  have, and silently continuing would have two people watching different fights.
- The relay is a **dumb pipe** — it never simulates or arbitrates. Since both clients run the same
  deterministic match from the same inputs, there is nothing to cheat against that is not equally
  visible on both machines.

### Reaching each other

The code system needs a server both players can reach. On one machine or a LAN this works as soon as
`node server.js` is running — the joiner opens `http://<host-ip>:5173`. Over the internet the server
has to be somewhere both can reach: deploy it, or put a tunnel in front of it. Nothing in the client
changes either way, because the socket address comes from wherever the page was loaded.

## Architecture

```
src/
  config/gameplay.js      every universal tuning constant, in one place
  core/       loop (fixed 60 Hz), input (gamepad + keyboard), math
  engine/     combat maths, capsule shapes, stage collision, camera
  game/       fighter state machine, hit resolution, elixir, projectiles, match rules
              victory.js — the end-of-match ceremony: shot list, poses, stats
  data/       universalMoves.js  — dodges, rolls, ledge options, grabs (shared by all fighters)
              fighters/*.js      — one file per fighter: attributes + frame data
              stages/*.js        — one file per stage; common.js holds the
                                   shared blast zones, spawns and platform heights
  render/     renderer3d.js — 2.5D scene, low-angle camera, pooled effects
              rig.js        — low-poly skeleton + procedural animation
              renderer.js   — flat debug view (F3)
              hud.js        — damage %, stocks, Elixir bar, timer
  net/        wsserver.js  — hand-rolled RFC 6455 server (no dependencies)
              rooms.js     — six-digit room codes, pairs two players, relays
              connection.js— client link
              lockstep.js  — input queues, delay, stalls, desync hashes
  ui/         main menu, online host/join, stage select, character select,
              pause and result menus
  tools/      balance.js — headless kill-percent and hitbox-reach harness
```

The simulation runs at a fixed 60 Hz with rendering decoupled, because frame data is the game.

**Adding a fighter** is one data file. Everything timed — attacks, dodges, throws, ledge options,
getups, techs — is a move definition run by a single generic `ACTION` state, so a new character
needs no engine changes. Character-specific gimmicks attach through the `onCreate` / `onStep` /
`onHitTaken` / `onGrabbed` / `onHit` hooks; the Wizard's Fire Shield uses all of them and touches no
shared code.

**Adding a stage** is one data file: platforms (`solid` carries ledges, `soft` is drop-through),
blast zones, spawns, a palette, a light rig and a list of props. The 3D renderer builds everything
from that definition, giving each platform depth and a brighter cap on the standable surface. No
renderer change is needed for a new arena.

---

## Balance harness

From the browser console:

```js
CR.balance()          // kill percents, DI value, and hitbox reach
CR.balance('kills')   // kill percents only
CR.balance('reach')   // which spacings each move can connect at
CR.start()            // start a fresh match afterwards
```

It drives the real simulation, so it measures the game rather than a model of it.
`reach` in particular catches hitboxes that are authored but can never connect — it found two
during this build.

Current kill percents from centre stage, fresh move, no DI:

| | Bandit | Wizard |
|---|---|---|
| F-smash (side) | 125% · 75% charged | 85% · 45% charged |
| D-smash (side) | 155% · 100% charged | 120% · 70% charged |
| Forward air (side) | 230% | 140% |
| Back air (side) | 145% | 145% |
| Up smash (top) | 130% | 125% |
| Up air (top) | 265% | 165% |
| Fireball | — | 95% side · 190% top |
| Back throw | 160% | 125% |
| Forward throw | 250% | 165% |
| Up throw (top) | 220% | 155% |
| Down throw | never — combo throw | never — combo throw |

Jabs and tilts do not kill; weak hits shove a grounded opponent along the floor instead of
launching them. Correct survival DI on a horizontal kill move buys about **+15%** (Bandit's
f-smash goes from killing at 125% to 140%) — meaningful, but no longer the near-immunity it was
before the launch decay applied to both axes.

Vertical kills are deliberately harder than horizontal ones, because the ceiling sits at 900px
above the stage while the side blast zones are 570px past the ledges.

---

## Known limitations

- Two fighters, as scoped. Six stages, none of them with moving geometry or hazards. Every stage
  shares one main platform shape; only the floating platforms and the dressing differ.
- No AI opponent — this is a local two-player build.
- No Royal Deliveries, spells, buildings or summoned troops. These belong to the casual ruleset
  described in the documents; the prototype implements the competitive ruleset, where the documents
  state they are switched off.
- No online. No stage-specific rulesets (no Ω forms, no stage striking).
- Placeholder art throughout, by design: untextured low-poly primitives, flat shading, and
  procedural poses rather than authored animation clips. There is no blending between poses,
  so transitions snap.
- The 3D view is presentation only. Depth (z) is not a gameplay axis and never will be —
  the design documents describe a 2D platform fighter.
