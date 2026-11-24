const LEVELS = [1, .89, .78, .69];

// Resolve against real frame timing so a fast phone keeps the sharper profile,
// while a thermally limited or slower phone has a cheaper back buffer.
export class RenderBudget {
  constructor(mobile = Boolean(document.documentElement.dataset.kovTelegram)) {
    this.mobile = mobile;
    this.level = 0;
    this.seconds = 0;
    this.frames = 0;
    this.goodWindows = 0;
  }

  ratio(width, height, deviceRatio, cap, maxPixels = 1600000) {
    const pixelLimit = this.mobile ? Math.min(940000, maxPixels) : maxPixels;
    const capRatio = this.mobile ? Math.min(1.65, cap) : cap;
    const ideal = Math.min(deviceRatio || 1, capRatio, Math.sqrt(pixelLimit / Math.max(1, width * height)));
    return ideal * LEVELS[this.level];
  }

  observe(dt, active = true) {
    if (!this.mobile) return false;
    if (!active || dt > .115) {
      this.seconds = this.frames = this.goodWindows = 0;
      return false;
    }
    if (dt <= 0) return false;
    this.seconds += dt;
    this.frames++;
    if (this.seconds < 1.8) return false;

    const average = this.seconds / this.frames;
    this.seconds = this.frames = 0;
    if (average > .023 && this.level < LEVELS.length - 1) {
      this.goodWindows = 0;
      this.level++;
      return true;
    }
    this.goodWindows = average < .0179 ? this.goodWindows + 1 : 0;
    if (this.level && this.goodWindows >= 4) {
      this.goodWindows = 0;
      this.level--;
      return true;
    }
    return false;
  }
}
