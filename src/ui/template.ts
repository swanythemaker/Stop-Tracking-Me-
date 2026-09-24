import { ICON } from "./icons";

export function appMarkup(): string {
  return `
  <div class="bg-grid" aria-hidden="true"></div>
  <main class="shell">
    <header class="hero">
      <div class="hero-bar">
        <div class="hero-mark">${ICON.shield}</div>
        <div class="hero-headline">
          <p class="eyebrow">Browser-only image sanitizer</p>
          <h1>STOP<span>TRACKING</span>ME</h1>
        </div>

        <nav class="stepbar" aria-label="Progress">
          <ol class="steps">
            <li class="step is-active" id="stepUpload" aria-current="step">
              <span class="step-dot">
                <span class="step-num">1</span>
                <span class="step-ico step-ico-check">${ICON.check}</span>
                <span class="step-ico step-ico-lock">${ICON.lock}</span>
              </span>
              <span class="step-label">Upload<small class="step-hint">Drop an image</small></span>
            </li>
            <li class="step-connector" aria-hidden="true"><i class="connector-fill"></i></li>
            <li class="step is-locked" id="stepClean" aria-disabled="true">
              <span class="step-dot">
                <span class="step-num">2</span>
                <span class="step-ico step-ico-check">${ICON.check}</span>
                <span class="step-ico step-ico-lock">${ICON.lock}</span>
              </span>
              <span class="step-label">Clean image<small class="step-hint">Upload first</small></span>
            </li>
          </ol>
        </nav>

        <button id="barReset" class="bar-reset" type="button"
                aria-label="Start over with a new image">${ICON.refresh}<span>New image</span></button>
      </div>

      <div class="hero-text">
        <p class="subtitle">
          Strip EXIF, GPS, XMP, C2PA and hidden metadata from your photos.
          Everything runs locally in your browser, and your image is never uploaded.
        </p>
        <ul class="trust" role="list">
          <li>${ICON.check}<span>No uploads</span></li>
          <li>${ICON.check}<span>No analytics</span></li>
          <li>${ICON.check}<span>Fail-closed audit</span></li>
        </ul>
      </div>
    </header>

    <div class="carousel" id="carousel">
      <div class="carousel-track">

        <section class="slide" id="slideUpload" aria-label="Step 1: upload an image">
          <div class="panel">
            <div class="dropzone" id="dropzone" role="button" tabindex="0"
                 aria-label="Drop an image or press Enter to browse">
              <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
              <div class="dz-icon">${ICON.upload}</div>
              <strong class="dz-title">Drop an image here</strong>
              <span class="dz-sub">or <u>browse files</u></span>
              <span class="dz-formats">PNG · JPEG · WebP, up to 64&nbsp;MB</span>
            </div>

            <div class="filecard" id="fileCard" hidden>
              <img id="fileThumb" class="filecard-thumb" alt="" />
              <div class="filecard-meta">
                <strong id="fileName" class="filecard-name"></strong>
                <span id="fileFacts" class="filecard-facts"></span>
              </div>
              <button id="clearFile" class="icon-btn" type="button" aria-label="Remove image">${ICON.x}</button>
            </div>

            <p id="status" class="status" role="status" aria-live="polite">Select an image to begin.</p>
          </div>
        </section>

        <section class="slide" id="slideProcessing" aria-label="Sanitizing your image">
          <div class="panel processing">
            <div class="proc-frame" id="procFrame">
              <img id="procPreview" alt="" />
              <div class="scanline" aria-hidden="true"></div>
              <div class="proc-check" aria-hidden="true">${ICON.check}</div>
            </div>
            <div class="progress">
              <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
              <p class="progress-stage" id="progressStage">Working…</p>
            </div>
          </div>
        </section>

        <section class="slide" id="slideResult" aria-label="Step 2: your clean image">
          <div class="panel result-stage" id="resultStage">
            <p class="result-headline" id="resultHeadline"></p>
            <div class="verdict" id="verdict" hidden></div>

            <div class="result-canvas">
              <figure class="preview preview-out">
                <figcaption>Clean image <span class="size-tag" id="outSize"></span></figcaption>
                <div class="preview-frame" id="outFrame">
                  <img id="outputPreview" alt="Sanitized image preview" />
                  <div class="frame-pending" id="framePending">Awaiting sanitize</div>
                </div>
              </figure>
              <figure class="preview preview-before">
                <figcaption>Before <span class="size-tag" id="origSize"></span></figcaption>
                <div class="preview-frame"><img id="inputPreview" alt="Original image preview" /></div>
              </figure>
            </div>

            <div class="result-actions">
              <div id="downloadArea"></div>
              <div class="result-buttons">
                <button id="editBtn" class="ghost-btn" type="button">${ICON.edit}<span>Edit</span></button>
                <button id="newImageBtn" class="ghost-btn" type="button">${ICON.refresh}<span>New image</span></button>
              </div>
            </div>

            <div class="editor" id="editor">
              <div class="editor-head">
                <span class="editor-title">Edit</span>
                <span class="adjust-state" id="adjustState">Original</span>
              </div>

              <label class="switch-row">
                <input id="ultraParanoid" type="checkbox" checked />
                <span class="switch" aria-hidden="true"></span>
                <span class="switch-text">
                  <strong>Ultra paranoid mode</strong>
                  <small>Force PNG output · strict fail-closed checks</small>
                </span>
              </label>

              <div class="advanced" id="advanced">
                <label>
                  <span class="field-label">Output format</span>
                  <select id="outputFormat">
                    <option value="same">Same as input</option>
                    <option value="image/png">PNG</option>
                    <option value="image/jpeg">JPEG</option>
                    <option value="image/webp">WebP</option>
                  </select>
                </label>
                <label>
                  <span class="field-label">Quality <b id="qualityValue">92</b></span>
                  <input id="quality" type="range" min="60" max="100" value="92" />
                </label>
              </div>

              <div class="adjust-field">
                <span class="field-label">Resize</span>
                <div class="seg-row" id="resizeChips" role="group" aria-label="Resize">
                  <button type="button" class="seg is-active" data-pct="100">100%</button>
                  <button type="button" class="seg" data-pct="75">75%</button>
                  <button type="button" class="seg" data-pct="50">50%</button>
                  <button type="button" class="seg" data-pct="25">25%</button>
                  <button type="button" class="seg" id="resizeCustomToggle">Custom</button>
                </div>
                <div class="resize-custom" id="resizeCustom" hidden>
                  <input id="resizeSlider" type="range" min="10" max="100" value="100"
                         aria-label="Resize percentage" />
                  <b id="resizeSliderValue">100%</b>
                </div>
                <p class="dim-readout" id="dimReadout" hidden></p>
              </div>

              <div class="adjust-field">
                <span class="field-label">Rotate &amp; flip</span>
                <div class="seg-row" role="group" aria-label="Rotate and flip">
                  <button type="button" class="seg icon-seg" id="rotateLeft" title="Rotate left 90°" aria-label="Rotate left">${ICON.rotateCcw}</button>
                  <button type="button" class="seg icon-seg" id="rotateRight" title="Rotate right 90°" aria-label="Rotate right">${ICON.rotateCw}</button>
                  <button type="button" class="seg icon-seg" id="flipH" title="Flip horizontal" aria-label="Flip horizontal">${ICON.flipH}</button>
                  <button type="button" class="seg icon-seg" id="flipV" title="Flip vertical" aria-label="Flip vertical">${ICON.flipV}</button>
                </div>
                <p class="adjust-note">Applied to the clean output, before re-encode. Resampling also disrupts pixel-hidden traces. It reduces, not removes.</p>
              </div>

              <button id="editDone" class="primary" type="button">${ICON.check}<span>Done</span></button>
            </div>

            <details class="raw">
              <summary>What we found &amp; removed</summary>
              <div class="scan-grid">
                <div class="scan-card" id="inputScanCard"></div>
                <div class="scan-card" id="outputScanCard"></div>
              </div>
              <div class="raw-cols">
                <div><h4>Input scan</h4><pre id="inputReport">No file loaded.</pre></div>
                <div><h4>Output scan</h4><pre id="outputReport">No output yet.</pre></div>
              </div>
            </details>
          </div>
        </section>

      </div>
    </div>

    <section class="panel docs">
      <div class="docs-grid">
        <article>
          <h2>How it works</h2>
          <ol class="how-list">
            <li>Drop or pick a PNG, JPEG or WebP image.</li>
            <li>We decode it to raw pixels and re-encode a fresh file, so no original bytes survive.</li>
            <li>Format-specific stripping removes every non-essential chunk/marker.</li>
            <li>A strict audit re-scans the output. If anything looks off, download is blocked.</li>
            <li>Download your verified-clean image.</li>
          </ol>
        </article>
        <article>
          <h2>What gets removed</h2>
          <ul class="wiki-list">
            <li><b>EXIF</b>: camera, timestamp, and GPS location.</li>
            <li><b>XMP / IPTC</b>: editor &amp; press metadata blocks.</li>
            <li><b>C2PA</b>: provenance &amp; content-credential signatures.</li>
            <li><b>JPEG APP/COM</b>: app marker segments.</li>
            <li><b>PNG text chunks</b>: tEXt, zTXt, iTXt and vendor chunks.</li>
            <li><b>WebP EXIF/XMP/ICCP</b>: metadata chunks.</li>
          </ul>
        </article>
      </div>

      <div class="faq">
        <h2>Questions</h2>
        <details>
          <summary>Why does the input scan say FAIL?</summary>
          <p>That just means metadata or non-essential chunks were detected in your original file. That is exactly the stuff this tool removes. Only the <b>output</b> scan decides whether the download is allowed.</p>
        </details>
        <details>
          <summary>Does this upload my image anywhere?</summary>
          <p>No. All processing happens in your browser in a Web Worker. The production build ships a Content-Security-Policy that blocks every outbound connection.</p>
        </details>
        <details>
          <summary>Does it remove everything?</summary>
          <p>It removes known metadata and provenance structures. It cannot guarantee removal of steganography hidden inside the pixels themselves.</p>
        </details>
        <details>
          <summary>Why force PNG in Ultra Paranoid mode?</summary>
          <p>PNG is a simpler container with fewer metadata edge-cases, so the fail-closed checks can be stricter and more certain.</p>
        </details>
      </div>

      <div class="roadmap">
        <p class="roadmap-eyebrow">Where this is going</p>
        <h2>Erase every trace, not just the ones we can name yet</h2>
        <p class="roadmap-lead">
          Today it removes the hidden data we already know how to find. But the traces worth fearing
          are the ones built to survive a clean-up. The plan is to keep going, deeper into your
          images, then out to everything else that quietly follows you around, without ever breaking
          the one rule: <b>nothing leaves your device</b>.
        </p>

        <div class="roadmap-groups">
          <section class="roadmap-group">
            <h3>Go deeper on every image</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>See the picture, not just the data.</strong>
                Spot faces, license plates, a reflection in a window, a landmark, or a name on a
                screen, and offer to blur them before you share.
              </li>
              <li>
                <strong>Break what hides in the pixels.</strong>
                A heavy-clean mode that disrupts invisible watermarks, hidden messages and tracking
                fingerprints, with a risk score so you know how exposed a photo really is.
              </li>
              <li>
                <strong>Check the work twice.</strong>
                Rebuild the image through more than one engine and compare, so a single buggy
                converter can never let something slip through.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>A private mind, in your tab</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Reads your file like a paranoid expert.</strong>
                A small model that runs entirely on your device, no upload, no server, asking one
                question: could anything in here point back to you?
              </li>
              <li>
                <strong>Explains itself in plain words.</strong>
                “Removed this, because it could reveal that.” Every decision spelled out, worked out
                locally, never phoning home.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>Beyond photos</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Clean the links you share.</strong>
                Strip the tracking tails off a URL and expand shortened redirects that sneak them
                back in.
              </li>
              <li>
                <strong>Show what's watching.</strong>
                A read-out of what a page can use to fingerprint you, and the third-party calls it
                makes behind your back.
              </li>
              <li>
                <strong>Reset what follows you.</strong>
                One click to wipe the cookies and stored IDs that quietly track you between visits.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>Trust you can verify</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Open and reproducible.</strong>
                Signed releases you can rebuild yourself, so the app you run is provably the one we
                published.
              </li>
              <li>
                <strong>A receipt for every clean-up.</strong>
                A local report (what went in, what came out, what was removed) that stays on your
                machine.
              </li>
            </ul>
          </section>
        </div>

        <blockquote class="roadmap-quote">
          We're not done at “we removed the location tag.” The goal is simple: <b>nothing you share
          can be traced back to you</b>, not the obvious traces, and not the hidden ones.
        </blockquote>
      </div>
    </section>

    <footer class="foot">
      <span>${ICON.lock}</span>
      <p>100% local. No servers, no accounts, no tracking. Your pixels never leave this tab.</p>
      <span class="foot-version" title="build ${__APP_COMMIT__}">v${__APP_VERSION__}</span>
    </footer>
  </main>

  <div class="drag-overlay" id="dragOverlay" aria-hidden="true">
    <div class="drag-overlay-card">
      <div class="drag-overlay-icon">${ICON.upload}</div>
      <strong>Drop to sanitize</strong>
    </div>
  </div>
`;
}
