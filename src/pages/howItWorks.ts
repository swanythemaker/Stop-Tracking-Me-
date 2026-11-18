import "../styles/base.css";
import "../styles/docs.css";
import "../styles/pages.css";
import { mount, pageShell } from "./chrome";

mount(
  pageShell({
    eyebrow: "How it works",
    title: "How it works",
    lead: "What the three tools do, how link tracking works, and how you can check for yourself that nothing leaves your device.",
    body: `
    <nav class="panel page-panel page-toc" aria-label="On this page">
      <a href="#rule">The one rule</a>
      <a href="#links">Links</a>
      <a href="#photos">Photos</a>
      <a href="#videos">Videos</a>
      <a href="#limits">What it can't do</a>
      <a href="#verify">Check it yourself</a>
    </nav>

    <section class="panel page-panel prose" id="rule">
      <h2>The one rule: nothing leaves your device</h2>
      <p>Every tool runs inside this browser tab. There is no upload, no account and no server that sees your photo, video or link. The only thing the site ever downloads after the page itself is a model file, and only when you press a button that needs one (watermark removal and Find watermark).</p>
      <details>
        <summary>For nerds</summary>
        <p>The site sends a Content-Security-Policy with <code>connect-src 'self'</code>, so the browser itself refuses any request to another server, even if a bug or a bad dependency tried. Photos and videos are processed in a Web Worker by a Rust core compiled to WebAssembly. The link cleaner is a plain function with no network code at all. The end-to-end tests record every request the page makes during a real clean and fail if a single one goes anywhere else.</p>
      </details>
    </section>

    <section class="panel page-panel prose" id="links">
      <h2>Links</h2>
      <h3>How a link tracks you</h3>
      <p>A link can carry more than the address of a page. Apps and ad networks add small tags to the end of it, after the <code>?</code>. They are invisible in a preview, but they travel with the link wherever you paste it. There are six common kinds:</p>
      <ul class="wiki-list">
        <li><b>Click IDs</b> such as <code>fbclid</code> or <code>gclid</code>. An ad network adds a unique code to the link when someone clicks an ad or a post. When that page later reports a sale or a sign-up, the network can match it to that exact click.</li>
        <li><b>Share IDs</b> such as X's <code>a</code> and <code>t</code>, Instagram's <code>igsh</code> or YouTube's <code>si</code>. The app adds them when you tap Share. Everyone who opens your link carries your code, so the app learns who you share with.</li>
        <li><b>Campaign tags</b> such as <code>utm_source</code>. They tell a site which newsletter, post or ad sent you.</li>
        <li><b>Shop and affiliate tags</b> such as Amazon's <code>tag</code> and <code>/ref=</code>. They record who earns a commission and which search or list the product came from.</li>
        <li><b>Redirect wrappers</b> such as <code>l.facebook.com/l.php?u=</code>. The click goes through the platform's own server first, which logs it, then sends you on. The real address is inside.</li>
        <li><b>Short links</b> such as <code>t.co</code> or <code>amzn.to</code>. The link is only a code. Where it leads, and what it records, sits on the company's server.</li>
      </ul>
      <h3>How the cleaner decides</h3>
      <ol class="how-list">
        <li><b>Unwrap redirects.</b> If the link is a known wrapper, the real address inside replaces it, up to five layers deep.</li>
        <li><b>Apply the site rule.</b> Shop links are cut down to the product (Amazon <code>/dp/&lt;number&gt;</code>, eBay <code>/itm/&lt;number&gt;</code>). Post links on X, YouTube, LinkedIn, Instagram, Threads, TikTok and Spotify keep only what the page needs, so a tag a site renames or invents next week comes off too.</li>
        <li><b>Remove known tags.</b> A list of about 60 tag names and families that only exist to track, on any site.</li>
        <li><b>Clean the end of the address.</b> Highlight fragments (<code>#:~:text=</code>) are removed, normal anchors such as <code>#install</code> stay.</li>
        <li><b>Leave everything else alone.</b> A tag the cleaner does not recognise stays, because removing it could break the link. A link with nothing to remove comes back byte for byte.</li>
      </ol>
      <p>Every removed tag is listed under the clean link. Tap one to read what it was. <a href="/trackers/">See every tracker explained</a>.</p>
      <details>
        <summary>For nerds</summary>
        <p>The rules live in <code>src/links/clean.ts</code> and are tested in <code>tests/unit/links.spec.ts</code>, one real-shaped link per rule. Query strings are filtered as raw text, not re-serialised through <code>URLSearchParams</code>, so the parts that stay keep their exact encoding. Short links are recognised by host and flagged; the cleaner never follows them, because the only way to learn where a short link leads is to ask the shortener, and that request is exactly the tracking event you are trying to avoid.</p>
      </details>
    </section>

    <section class="panel page-panel prose" id="photos">
      <h2>Photos</h2>
      <p>A photo carries more than pixels: the GPS position where it was taken, the camera or phone model and its serial number, the date and time, the editing apps it went through, and sometimes a signed content credential (C2PA). The photo tool removes all of it.</p>
      <ol class="how-list">
        <li>The photo is decoded to raw pixels by our own WebAssembly core, so the result is the same in every browser.</li>
        <li>Any edits you chose (resize, rotate, flip, watermark removal) are applied to those pixels.</li>
        <li>A fresh file is encoded from the pixels, then every chunk that is not needed to show the image is stripped.</li>
        <li>The output is scanned again by the same parser. If anything questionable is left, the download is blocked.</li>
      </ol>
      <details>
        <summary>For nerds</summary>
        <p>PNG keeps <code>IHDR</code>, <code>PLTE</code>, <code>IDAT</code>, <code>IEND</code> and <code>tRNS</code>; JPEG drops <code>APP0</code> to <code>APP15</code> and <code>COM</code>; WebP keeps <code>VP8</code>, <code>VP8L</code>, <code>VP8X</code> and <code>ALPH</code>. Strip and audit share one allowlist, so they cannot disagree. Ultra paranoid mode forces PNG, the simplest container, so the audit can be strictest. Images are byte-for-byte identical across browsers.</p>
      </details>
    </section>

    <section class="panel page-panel prose" id="videos">
      <h2>Videos</h2>
      <p>Videos carry the same kind of data as photos, plus the name and settings of the app that encoded them, hidden tracks, and tags inside the video stream itself. The video tool removes them in one of two ways, depending on your browser.</p>
      <ul class="wiki-list">
        <li><b>Full clean</b>, when your browser has a video encoder: every frame is decoded, your edits are applied, and the video is encoded fresh. This also removes the original encoder's fingerprint.</li>
        <li><b>Basic clean</b>, when it has none: the file is rebuilt from the raw picture and sound data, without any metadata. The picture itself is untouched.</li>
      </ul>
      <p>Either way, the final file is written and audited by the same Rust core. If it is not provably clean, there is no download.</p>
      <details>
        <summary>For nerds</summary>
        <p>MP4 and MOV output gets a canonical <code>ftyp</code>, zeroed times and empty handler names, with no <code>udta</code>, <code>meta</code>, <code>uuid</code> (XMP, C2PA) or timed metadata tracks. H.264 and HEVC SEI units, AV1 metadata OBUs and filler data are filtered out of the stream. WebM and MKV lose <code>Tags</code>, <code>Title</code>, <code>DateUTC</code>, <code>SegmentUUID</code>, attachments and chapters. The full clean uses WebCodecs, so its bytes differ between devices; the verdict does not.</p>
      </details>
    </section>

    <section class="panel page-panel prose" id="limits">
      <h2>What it can't do</h2>
      <ul class="wiki-list">
        <li><b>Short links</b> can't be checked without asking the company behind them, so the cleaner flags them instead.</li>
        <li><b>Once you open a link</b>, the site can still recognise you with cookies, logins and browser fingerprinting. A clean link only stops the link itself from telling on you.</li>
        <li><b>Tracking hidden in the address path</b> of a site we have no rule for stays, because it can't be told apart from the page name.</li>
        <li><b>Hidden marks inside the pixels</b> (steganography, AI watermarks such as SynthID, sensor noise patterns) can be weakened by the photo tools, never guaranteed gone.</li>
        <li><b>Sound you keep</b> in a video still carries voices and background noise.</li>
      </ul>
    </section>

    <section class="panel page-panel prose" id="verify">
      <h2>Check it yourself</h2>
      <ol class="how-list">
        <li>Open your browser's developer tools and the Network tab.</li>
        <li>Clean a photo, a video and a link.</li>
        <li>Every request you see goes to this site, and none of them carries your file or your link.</li>
      </ol>
      <p>The code is open: <a href="https://github.com/swanythemaker/Stop-Tracking-Me-" rel="noopener noreferrer">github.com/swanythemaker/Stop-Tracking-Me-</a>. The version and build in the footer name the exact commit that is running.</p>
    </section>`,
  }),
);
