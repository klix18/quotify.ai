/**
 * sparkleFlow.js
 * ──────────────────────────────────────────────────────────────────────
 * A self-contained canvas particle system that dissolves every visible
 * form-field into tiny glowing sparkles, then funnels them into the
 * "Generate + Download Quote" button.
 *
 * Usage:
 *   import { triggerSparkleFlow } from "./sparkleFlow";
 *   triggerSparkleFlow(buttonElement);
 *
 * The animation lasts exactly 2 seconds, cleans up after itself, and
 * leaves zero DOM residue.
 * ──────────────────────────────────────────────────────────────────────
 */

/* ── tunables ──────────────────────────────────────────────────────── */
const DURATION_MS        = 2000;
const PARTICLES_PER_FIELD = 28;
const PARTICLE_MIN_R      = 1.4;
const PARTICLE_MAX_R      = 3.0;
const GLOW_BASE_ALPHA     = 0.12;   // individual sparkle outer glow
const GLOW_PEAK_ALPHA     = 0.55;   // glow when particles converge
const GLOW_RADIUS_MULT    = 5;      // blur radius = size * this
const TRAIL_LENGTH        = 6;      // how many past positions to draw
const TRAIL_FADE          = 0.55;   // opacity fall-off per trail step

/* colour palette (matches the Quotify blue / cyan theme) */
const PALETTE = [
  [23, 101, 212],   // #1765D4 — primary blue
  [100, 180, 255],  // bright sky
  [201, 242, 255],  // #C9F2FF — cyan highlight
  [255, 255, 255],  // white sparkle
  [140, 210, 255],  // ice blue
  [60, 140, 230],   // mid blue
];

/* ── easing helpers ────────────────────────────────────────────────── */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}
function easeInQuad(t) {
  return t * t;
}

/* ── deterministic-ish random with seed feel ───────────────────────── */
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ── vector helpers ────────────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/* ── Particle class ────────────────────────────────────────────────── */
class Particle {
  constructor(ox, oy, tx, ty, delay) {
    /* origin (field position) */
    this.ox = ox;
    this.oy = oy;
    /* target (button centre) */
    this.tx = tx;
    this.ty = ty;
    /* current */
    this.x = ox;
    this.y = oy;
    /* visual */
    const [r, g, b] = pick(PALETTE);
    this.r = r; this.g = g; this.b = b;
    this.size = rand(PARTICLE_MIN_R, PARTICLE_MAX_R);
    this.baseAlpha = rand(0.6, 1);
    this.alpha = 0;
    /* timing */
    this.delay = delay;                        // 0 → ~0.3 stagger
    this.life = 0;                             // 0 → 1
    this.active = false;
    /* motion: random control-point for a quadratic Bézier */
    const mx = (ox + tx) / 2;
    const my = (oy + ty) / 2;
    const spread = dist(ox, oy, tx, ty) * 0.45;
    this.cx = mx + rand(-spread, spread);
    this.cy = my + rand(-spread, spread);
    /* secondary wobble */
    this.wobbleAmp = rand(6, 22);
    this.wobbleFreq = rand(3, 7);
    this.wobblePhase = rand(0, Math.PI * 2);
    /* trail history */
    this.trail = [];
    /* twinkle */
    this.twinkleSpeed = rand(8, 18);
    this.twinklePhase = rand(0, Math.PI * 2);
  }

  update(globalT) {
    /* stagger activation */
    const localT = (globalT - this.delay) / (1 - this.delay);
    if (localT <= 0) { this.active = false; return; }
    this.active = true;
    this.life = Math.min(localT, 1);

    /* Bézier position */
    const e = easeInOutCubic(this.life);
    const inv = 1 - e;
    const bx = inv * inv * this.ox + 2 * inv * e * this.cx + e * e * this.tx;
    const by = inv * inv * this.oy + 2 * inv * e * this.cy + e * e * this.ty;

    /* perpendicular wobble that decays toward the end */
    const wobbleDecay = 1 - easeInQuad(this.life);
    const angle = Math.atan2(this.ty - this.oy, this.tx - this.ox) + Math.PI / 2;
    const wobble = Math.sin(this.life * this.wobbleFreq * Math.PI + this.wobblePhase)
      * this.wobbleAmp * wobbleDecay;

    this.trail.push({ x: this.x, y: this.y, a: this.alpha });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();

    this.x = bx + Math.cos(angle) * wobble;
    this.y = by + Math.sin(angle) * wobble;

    /* alpha: fade in fast, hold, then fade out on arrival */
    const fadeIn = Math.min(this.life / 0.15, 1);
    const fadeOut = this.life > 0.92 ? 1 - easeOutQuart((this.life - 0.92) / 0.08) : 1;
    const twinkle = 0.7 + 0.3 * Math.sin(this.life * this.twinkleSpeed * Math.PI + this.twinklePhase);
    this.alpha = this.baseAlpha * fadeIn * fadeOut * twinkle;
  }
}

/* ── canvas renderer ───────────────────────────────────────────────── */
function createOverlayCanvas() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    pointer-events: none; width: 100vw; height: 100vh;
  `;
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  return { canvas, ctx };
}

function drawParticle(ctx, p, convergenceFactor) {
  if (!p.active || p.alpha < 0.01) return;

  /* ── trail ── */
  for (let i = 0; i < p.trail.length; i++) {
    const t = p.trail[i];
    const ratio = (i + 1) / p.trail.length;
    const ta = t.a * ratio * TRAIL_FADE * 0.3;
    if (ta < 0.01) continue;
    ctx.beginPath();
    ctx.arc(t.x, t.y, p.size * ratio * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${ta})`;
    ctx.fill();
  }

  /* ── glow (soft outer halo) ── */
  const glowAlpha = lerp(GLOW_BASE_ALPHA, GLOW_PEAK_ALPHA, convergenceFactor) * p.alpha;
  const glowR = p.size * GLOW_RADIUS_MULT * (1 + convergenceFactor * 2);
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
  grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${glowAlpha})`);
  grad.addColorStop(0.4, `rgba(${p.r},${p.g},${p.b},${glowAlpha * 0.4})`);
  grad.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
  ctx.beginPath();
  ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  /* ── core dot ── */
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${p.alpha})`;
  ctx.fill();

  /* ── hard white centre for "hot" look — brightness scales with size ── */
  const sizeNorm = (p.size - PARTICLE_MIN_R) / (PARTICLE_MAX_R - PARTICLE_MIN_R); // 0→1
  const whiteBrightness = 0.45 + sizeNorm * 0.55;   // small=0.45, large=1.0
  const whiteRadius = p.size * (0.3 + sizeNorm * 0.25); // small=30%, large=55% of core
  ctx.beginPath();
  ctx.arc(p.x, p.y, whiteRadius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${p.alpha * whiteBrightness})`;
  ctx.fill();
}

/* ── helper: rounded-rect canvas path matching the button's border-radius ── */
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ── converging bloom that follows the button shape ────────────────── */
function drawButtonBloom(ctx, bx, by, bw, bh, progress) {
  if (progress < 0.6) return;
  const t = (progress - 0.6) / 0.4;                    // 0 → 1 over last 40%
  const br = 14;                                        // match button border-radius

  /* single subtle glow — inset inside the button, long gradient fade */
  const pad = -2 + t * 2;                               // starts inset, barely reaches edge
  const alpha = easeOutQuart(t) * 0.12;
  ctx.save();
  ctx.filter = `blur(${2 + t * 4}px)`;
  roundedRectPath(ctx, bx - pad, by - pad,
    bw + pad * 2, bh + pad * 2, br);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const gradR = Math.max(bw, bh) / 2 + 4;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradR);
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(0.25, `rgba(201,242,255,${alpha * 0.7})`);
  grad.addColorStop(0.5, `rgba(100,180,255,${alpha * 0.3})`);
  grad.addColorStop(0.75, `rgba(23,101,212,${alpha * 0.1})`);
  grad.addColorStop(1, `rgba(23,101,212,0)`);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.filter = "none";
  ctx.restore();
}

/* ── field flash effect (fields briefly brighten when "consumed") ──── */
function flashFields(fields, progress) {
  const flashStart = 0;
  const flashEnd = 0.35;
  if (progress < flashStart || progress > flashEnd) {
    // reset
    fields.forEach((f) => {
      if (f._origBg !== undefined) {
        f.el.style.boxShadow = f._origShadow || "";
        f.el.style.transition = "box-shadow 400ms ease";
        delete f._origBg;
        delete f._origShadow;
      }
    });
    return;
  }
  const t = (progress - flashStart) / (flashEnd - flashStart);
  const flashAlpha = (1 - easeOutQuart(t)) * 0.6;
  fields.forEach((f) => {
    if (f._origBg === undefined) {
      f._origBg = f.el.style.background;
      f._origShadow = f.el.style.boxShadow;
    }
    f.el.style.boxShadow = `0 0 ${20 + 20 * flashAlpha}px rgba(201,242,255,${flashAlpha}),
                             inset 0 0 ${10 + 10 * flashAlpha}px rgba(201,242,255,${flashAlpha * 0.5})`;
    f.el.style.transition = "box-shadow 60ms linear";
  });
}

/* ── PUBLIC: trigger the full animation ────────────────────────────── */
export function triggerSparkleFlow(buttonEl) {
  if (!buttonEl) return;

  /* button bounds */
  const btnRect = buttonEl.getBoundingClientRect();
  const btnCX = btnRect.left + btnRect.width / 2;
  const btnCY = btnRect.top + btnRect.height / 2;

  /* find every visible input / select / textarea on the right panel */
  const scrollablePanel = buttonEl.closest("main") || document.querySelector("main");
  if (!scrollablePanel) return;

  const inputEls = scrollablePanel.querySelectorAll("input, select, textarea");
  const fieldData = [];
  inputEls.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // only fields actually in view (or close)
    if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
    fieldData.push({ el, rect: r });
  });

  if (fieldData.length === 0) return;

  /* build particles */
  const particles = [];
  const maxDist = Math.max(
    ...fieldData.map((f) =>
      dist(f.rect.left + f.rect.width / 2, f.rect.top + f.rect.height / 2, btnCX, btnCY)
    )
  );

  fieldData.forEach((f) => {
    const fx = f.rect.left + f.rect.width / 2;
    const fy = f.rect.top + f.rect.height / 2;
    const d = dist(fx, fy, btnCX, btnCY);
    /* stagger: closer fields start slightly later for a "pull" feel */
    const baseDelay = (1 - d / maxDist) * 0.25;

    for (let i = 0; i < PARTICLES_PER_FIELD; i++) {
      const ox = f.rect.left + rand(0, f.rect.width);
      const oy = f.rect.top + rand(0, f.rect.height);
      const delay = baseDelay + rand(0, 0.12);
      /* scatter target tightly inside the button center area */
      const insetX = btnRect.width * 0.2;
      const insetY = btnRect.height * 0.25;
      const tx = btnRect.left + rand(insetX, btnRect.width - insetX);
      const ty = btnRect.top + rand(insetY, btnRect.height - insetY);
      particles.push(new Particle(ox, oy, tx, ty, delay));
    }
  });

  /* create overlay canvas */
  const { canvas, ctx } = createOverlayCanvas();

  /* animation loop */
  const start = performance.now();
  let frameId;

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / DURATION_MS, 1);

    ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);

    /* update particles */
    particles.forEach((p) => p.update(progress));

    /* compute convergence factor (how bunched-up particles are near button rect) */
    let nearCount = 0;
    const nearThresh = 30;
    particles.forEach((p) => {
      if (!p.active) return;
      /* distance to nearest point on button rect */
      const cx = Math.max(btnRect.left, Math.min(p.x, btnRect.right));
      const cy = Math.max(btnRect.top, Math.min(p.y, btnRect.bottom));
      if (dist(p.x, p.y, cx, cy) < nearThresh) nearCount++;
    });
    const convergence = Math.min(nearCount / (particles.length * 0.4), 1);

    /* composite mode for additive glow */
    ctx.globalCompositeOperation = "lighter";

    /* draw all particles */
    particles.forEach((p) => drawParticle(ctx, p, convergence));

    /* button bloom */
    drawButtonBloom(ctx, btnRect.left, btnRect.top, btnRect.width, btnRect.height, progress);

    /* reset composite */
    ctx.globalCompositeOperation = "source-over";

    /* field flash effect */
    flashFields(fieldData, progress);

    if (progress < 1) {
      frameId = requestAnimationFrame(frame);
    } else {
      /* cleanup */
      cancelAnimationFrame(frameId);
      canvas.remove();
      /* reset field styles */
      fieldData.forEach((f) => {
        f.el.style.boxShadow = f._origShadow || "";
        f.el.style.transition = "box-shadow 400ms ease";
      });
    }
  }

  frameId = requestAnimationFrame(frame);
}
