import { ICON } from "../ui/icons";

export function siteNav(): string {
  return `
    <nav class="site-nav" aria-label="Learn more">
      <a href="/how-it-works/">How it works</a>
      <a href="/trackers/">Every tracker explained</a>
      <a href="https://github.com/swanythemaker/Stop-Tracking-Me-" rel="noopener noreferrer">Source code</a>
    </nav>`;
}

export function siteFooter(): string {
  return `
    <footer class="foot">
      ${siteNav()}
      <div class="foot-line">
        <span>${ICON.lock}</span>
        <p>100% local. No servers, no accounts, no tracking. Nothing you clean leaves this tab.</p>
        <span class="foot-version" title="build ${__APP_COMMIT__}">v${__APP_VERSION__}</span>
      </div>
    </footer>`;
}

export function pageShell(opts: { eyebrow: string; title: string; lead: string; body: string }): string {
  return `
  <div class="bg-grid" aria-hidden="true"></div>
  <main class="shell page">
    <header class="hero page-hero">
      <div class="hero-bar">
        <a class="hero-mark" href="/" aria-label="StopTrackingMe home">${ICON.shield}</a>
        <div class="hero-headline">
          <p class="eyebrow">${opts.eyebrow}</p>
          <a class="page-brand" href="/"><h1>STOP<span>TRACKING</span>ME</h1></a>
        </div>
        <nav class="tools" aria-label="Tools">
          <a class="tool-tab" href="/#photos">${ICON.photo}<span>Photos</span></a>
          <a class="tool-tab" href="/#videos">${ICON.video}<span>Videos</span></a>
          <a class="tool-tab" href="/#links">${ICON.link}<span>Links</span></a>
        </nav>
      </div>
      <div class="hero-text">
        <h2 class="page-title">${opts.title}</h2>
        <p class="subtitle">${opts.lead}</p>
      </div>
    </header>
    ${opts.body}
    ${siteFooter()}
  </main>`;
}

export function mount(html: string): HTMLElement {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("App root not found");
  app.innerHTML = html;
  return app;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
