type Slide = 0 | 1 | 2;

export class StepFlow {
  private carousel: HTMLElement;
  private slides: HTMLElement[];
  private stepUpload: HTMLElement;
  private stepClean: HTMLElement;
  private resultStage: HTMLElement;
  private ro: ResizeObserver;
  private current: Slide = 0;

  constructor(els: {
    carousel: HTMLElement;
    slides: [HTMLElement, HTMLElement, HTMLElement];
    stepUpload: HTMLElement;
    stepClean: HTMLElement;
    resultStage: HTMLElement;
  }) {
    this.carousel = els.carousel;
    this.slides = els.slides;
    this.stepUpload = els.stepUpload;
    this.stepClean = els.stepClean;
    this.resultStage = els.resultStage;

    this.ro = new ResizeObserver(() => this.syncHeight());
    window.addEventListener("resize", () => this.syncHeight());

    this.apply(false);
  }

  get slide(): Slide {
    return this.current;
  }

  goTo(slide: Slide, opts: { focus?: boolean } = {}): void {
    this.current = slide;
    this.apply(opts.focus ?? false);
  }

  setEditing(on: boolean): void {
    this.resultStage.classList.toggle("is-editing", on);
    this.syncHeight();
  }

  syncHeight(): void {
    const active = this.slides[this.current];
    if (active) this.carousel.style.height = `${active.offsetHeight}px`;
  }

  private apply(focus: boolean): void {
    document.body.dataset.mode = this.current === 0 ? "landing" : "working";

    this.slides.forEach((s, i) => {
      const active = i === this.current;
      s.classList.toggle("is-active", active);
      if (active) s.removeAttribute("inert");
      else s.setAttribute("inert", "");
    });

    this.ro.disconnect();
    this.ro.observe(this.slides[this.current]);

    this.renderStepBar();
    this.syncHeight();

    if (focus) {
      const active = this.slides[this.current];
      active.setAttribute("tabindex", "-1");
      active.focus({ preventScroll: true });
    }
  }

  private renderStepBar(): void {
    const cleaned = this.current === 2;
    const inFlight = this.current === 1;

    this.setStep(this.stepUpload, {
      active: this.current === 0,
      done: this.current > 0,
      locked: false,
    });

    this.setStep(this.stepClean, {
      active: inFlight || cleaned,
      done: cleaned,
      locked: this.current === 0,
    });

    this.carousel.dataset.slide = String(this.current);
  }

  private setStep(
    el: HTMLElement,
    state: { active: boolean; done: boolean; locked: boolean },
  ): void {
    el.classList.toggle("is-active", state.active && !state.done);
    el.classList.toggle("is-done", state.done);
    el.classList.toggle("is-locked", state.locked);
    if (state.active && !state.done) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
    if (state.locked) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  }
}
