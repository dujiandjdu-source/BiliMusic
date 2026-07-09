/**
 * Animation Interpolator System
 *
 * Inspired by Android's TimeInterpolator / ValueAnimator architecture.
 * Provides:
 *   1. Pure easing functions (Interpolators) — stateless curve computations
 *   2. SmoothValue — exponential-decay smoothing for frame-by-frame value tracking
 *   3. SpringValue — critically-damped spring for bouncy / physical animations
 *   4. LineAnimationState — per-line aggregated animation state (hover, press, blur)
 */

// ---------------------------------------------------------------------------
// 1. Interpolator Functions (Android-style)
//    Input t ∈ [0, 1] → output ∈ [0, 1] (may exceed for overshoot/bounce)
// ---------------------------------------------------------------------------

export type InterpolatorFn = (t: number) => number;

export const Interpolators = {
  /** Constant speed */
  linear: (t: number): number => t,

  /** Slow start, fast end — like Android AccelerateInterpolator */
  accelerate: (t: number, factor = 2.0): number =>
    Math.pow(t, factor),

  /** Fast start, slow end — like Android DecelerateInterpolator */
  decelerate: (t: number, factor = 2.0): number =>
    1 - Math.pow(1 - t, factor),

  /** Slow start & end, fast middle — like Android AccelerateDecelerateInterpolator */
  accelerateDecelerate: (t: number): number =>
    (Math.cos((t + 1) * Math.PI) / 2.0) + 0.5,

  /** Overshoots target then settles — like Android OvershootInterpolator */
  overshoot: (t: number, tension = 2.0): number => {
    const t1 = t - 1;
    return t1 * t1 * ((tension + 1) * t1 + tension) + 1;
  },

  /** Bounces at end — like Android BounceInterpolator */
  bounce: (t: number): number => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      const t2 = t - 1.5 / 2.75;
      return 7.5625 * t2 * t2 + 0.75;
    } else if (t < 2.5 / 2.75) {
      const t2 = t - 2.25 / 2.75;
      return 7.5625 * t2 * t2 + 0.9375;
    } else {
      const t2 = t - 2.625 / 2.75;
      return 7.5625 * t2 * t2 + 0.984375;
    }
  },

  /** Anticipate then overshoot — like Android AnticipateOvershootInterpolator */
  anticipateOvershoot: (t: number, tension = 2.0): number => {
    if (t < 0.5) {
      const t2 = t * 2;
      return 0.5 * (t2 * t2 * ((tension + 1) * t2 - tension));
    } else {
      const t2 = t * 2 - 2;
      return 0.5 * (t2 * t2 * ((tension + 1) * t2 + tension) + 2);
    }
  },

  /** Smooth cubic ease-in-out */
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  /** Fast exponential decay approach — very responsive feel */
  fastOutSlowIn: (t: number): number => {
    // Approximation of Material Design's fast-out-slow-in curve
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -10 * t);
  },
} as const;

// ---------------------------------------------------------------------------
// 2. SmoothValue — Exponential decay smoothing
//    Perfect for continuous tracking (hover progress, blur amount).
//    tau = time constant (seconds); smaller = faster response.
// ---------------------------------------------------------------------------

export class SmoothValue {
  private current: number;
  private target: number;
  private tau: number;
  private _settled = true;

  constructor(initialValue: number, tau = 0.15) {
    this.current = initialValue;
    this.target = initialValue;
    this.tau = tau;
  }

  /** Set the value we're approaching */
  setTarget(value: number): void {
    if (value !== this.target) {
      this.target = value;
      this._settled = false;
    }
  }

  /** Hard-set to a value immediately (no animation) */
  snap(value: number): void {
    this.current = value;
    this.target = value;
    this._settled = true;
  }

  /** Change the time constant */
  setTau(tau: number): void {
    this.tau = tau;
  }

  /** Advance the animation by dt seconds. Returns current value. */
  update(dt: number): number {
    if (this._settled) return this.current;

    const alpha = 1 - Math.exp(-dt / this.tau);
    this.current += (this.target - this.current) * alpha;

    // Settle when close enough (prevent infinite tiny updates)
    if (Math.abs(this.current - this.target) < 0.001) {
      this.current = this.target;
      this._settled = true;
    }

    return this.current;
  }

  getCurrent(): number {
    return this.current;
  }

  getTarget(): number {
    return this.target;
  }

  isSettled(): boolean {
    return this._settled;
  }
}

// ---------------------------------------------------------------------------
// 3. SpringValue — Critically-damped spring for physical animations
//    Great for press/release, bounce, and snappy transitions.
// ---------------------------------------------------------------------------

export interface SpringConfig {
  /** Spring stiffness (higher = faster) */
  stiffness: number;
  /** Damping ratio: 1 = critical, < 1 = bouncy, > 1 = over-damped */
  dampingRatio: number;
  /** Rest threshold */
  precision?: number;
}

/** Presets for common use cases */
export const SpringPresets = {
  /** Snappy response, slight overshoot — good for press scale */
  press: { stiffness: 300, dampingRatio: 0.7, precision: 0.001 } as SpringConfig,
  /** Smooth with no overshoot — good for hover transitions */
  gentle: { stiffness: 120, dampingRatio: 1.0, precision: 0.001 } as SpringConfig,
  /** Very responsive — good for interactive feedback */
  responsive: { stiffness: 400, dampingRatio: 0.85, precision: 0.001 } as SpringConfig,
  /** Bouncy — decorative animations */
  bouncy: { stiffness: 200, dampingRatio: 0.5, precision: 0.001 } as SpringConfig,
} as const;

export class SpringValue {
  private current: number;
  private target: number;
  private velocity: number = 0;
  private config: SpringConfig;
  private _settled = true;

  constructor(initialValue: number, config: SpringConfig = SpringPresets.press) {
    this.current = initialValue;
    this.target = initialValue;
    this.config = config;
  }

  setTarget(value: number): void {
    if (value !== this.target) {
      this.target = value;
      this._settled = false;
    }
  }

  snap(value: number): void {
    this.current = value;
    this.target = value;
    this.velocity = 0;
    this._settled = true;
  }

  /** Inject velocity (e.g. for press release pop) */
  addVelocity(v: number): void {
    this.velocity += v;
    this._settled = false;
  }

  setConfig(config: SpringConfig): void {
    this.config = config;
  }

  update(dt: number): number {
    if (this._settled) return this.current;

    const { stiffness, dampingRatio, precision = 0.001 } = this.config;

    // Compute damping coefficient from ratio: c = 2 * dampingRatio * sqrt(k)
    // (assuming mass = 1)
    const damping = 2 * dampingRatio * Math.sqrt(stiffness);

    const displacement = this.current - this.target;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * this.velocity;
    const acceleration = springForce + dampingForce; // mass = 1

    this.velocity += acceleration * dt;
    this.current += this.velocity * dt;

    if (
      Math.abs(this.velocity) < precision &&
      Math.abs(this.current - this.target) < precision
    ) {
      this.current = this.target;
      this.velocity = 0;
      this._settled = true;
    }

    return this.current;
  }

  getCurrent(): number {
    return this.current;
  }

  getTarget(): number {
    return this.target;
  }

  isSettled(): boolean {
    return this._settled;
  }
}

// ---------------------------------------------------------------------------
// 4. LineAnimationState — Per-line composite animation state
//    Aggregates hover, press, and blur animations for a single lyric line.
// ---------------------------------------------------------------------------

export class LineAnimationState {
  /** Hover progress: 0 = not hovered, 1 = fully hovered */
  readonly hover: SmoothValue;
  /** Press scale: 1 = normal, <1 = pressed in, >1 = bounced out */
  readonly press: SpringValue;
  /** Blur amount (px): smoothly interpolated */
  readonly blur: SmoothValue;

  constructor() {
    // Hover: fast fade in (~60ms), slightly slower fade out (~100ms)
    this.hover = new SmoothValue(0, 0.06);
    // Press: snappy spring with slight overshoot
    this.press = new SpringValue(1, SpringPresets.press);
    // Blur: slightly slower than hover so the focus shift reads clearly
    this.blur = new SmoothValue(0, 0.14);
  }

  /**
   * Call once per frame with dt (seconds) and the desired target states.
   * Returns the interpolated values for rendering.
   */
  update(
    dt: number,
    isHovered: boolean,
    isPressed: boolean,
    targetBlur: number,
  ): { hoverProgress: number; pressScale: number; blurAmount: number } {
    // Hover: asymmetric timing — fast fade-in, slightly slower fade-out
    this.hover.setTau(isHovered ? 0.05 : 0.10);
    this.hover.setTarget(isHovered ? 1 : 0);
    this.hover.update(dt);

    // Press: spring to pressed scale, release back to 1
    this.press.setTarget(isPressed ? 0.95 : 1.0);
    this.press.update(dt);

    // Blur: smooth approach to target blur
    this.blur.setTau(targetBlur > this.blur.getCurrent() ? 0.12 : 0.18);
    this.blur.setTarget(targetBlur);
    this.blur.update(dt);

    return {
      hoverProgress: this.hover.getCurrent(),
      pressScale: this.press.getCurrent(),
      blurAmount: this.blur.getCurrent(),
    };
  }

  /** Trigger a press "pop" animation — scale down then spring back */
  triggerPress(): void {
    // Immediately push scale down, then spring will bring it back
    this.press.snap(0.92);
    this.press.setTarget(1.0);
    this.press.addVelocity(2.0); // Upward velocity for overshoot bounce-back
  }

  /** Check if all animations are at rest */
  isSettled(): boolean {
    return this.hover.isSettled() && this.press.isSettled() && this.blur.isSettled();
  }
}
