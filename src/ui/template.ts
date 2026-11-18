import { ICON } from "./icons";

export function appMarkup(): string {
  return `
  <div class="bg-grid" aria-hidden="true"></div>
  <main class="shell">
    <header class="hero">
      <div class="hero-bar">
        <div class="hero-mark">${ICON.shield}</div>
        <div class="hero-headline">
          <p class="eyebrow">Private by default</p>
          <h1>STOP<span>TRACKING</span>ME</h1>
        </div>

        <nav class="tools" role="tablist" aria-label="What do you want to clean?">
          <button class="tool-tab" type="button" role="tab" data-tool-tab="photo" id="tabPhoto">${ICON.photo}<span>Photos</span></button>
          <button class="tool-tab" type="button" role="tab" data-tool-tab="video" id="tabVideo">${ICON.video}<span>Videos</span></button>
          <button class="tool-tab" type="button" role="tab" data-tool-tab="link" id="tabLink">${ICON.link}<span>Links</span></button>
        </nav>

        <nav class="stepbar" aria-label="Progress" data-for="photo video">
          <ol class="steps">
            <li class="step is-active" id="stepUpload" aria-current="step">
              <span class="step-dot">
                <span class="step-num">1</span>
                <span class="step-ico step-ico-check">${ICON.check}</span>
                <span class="step-ico step-ico-lock">${ICON.lock}</span>
              </span>
              <span class="step-label">Upload<small class="step-hint">Drop a file</small></span>
            </li>
            <li class="step-connector" aria-hidden="true"><i class="connector-fill"></i></li>
            <li class="step is-locked" id="stepClean" aria-disabled="true">
              <span class="step-dot">
                <span class="step-num">2</span>
                <span class="step-ico step-ico-check">${ICON.check}</span>
                <span class="step-ico step-ico-lock">${ICON.lock}</span>
              </span>
              <span class="step-label">Clean file<small class="step-hint">Upload first</small></span>
            </li>
          </ol>
        </nav>

        <button id="barReset" class="bar-reset" type="button" data-for="photo video"
                aria-label="Start over with a new file">${ICON.refresh}<span>New file</span></button>
      </div>

      <div class="hero-text">
        <p class="subtitle" data-for="photo">
          Strip the GPS location, camera details, dates, edit history and C2PA credentials hidden
          in your photos. Everything runs in your browser. Your photo is never uploaded.
        </p>
        <p class="subtitle" data-for="video">
          Strip the location, device, dates and encoder tags hidden in your videos. Everything runs
          in your browser. Your video is never uploaded.
        </p>
        <p class="subtitle" data-for="link">
          Take the tracking tags off a link before you share it: Facebook, Instagram, X, TikTok,
          YouTube, Amazon, eBay and the ad networks. Everything runs in your browser. Nothing is
          sent anywhere.
        </p>
        <ul class="trust" role="list">
          <li>${ICON.check}<span>No uploads</span></li>
          <li>${ICON.check}<span>No analytics</span></li>
          <li data-for="photo video">${ICON.check}<span>Fail-closed audit</span></li>
          <li data-for="link">${ICON.check}<span>Short links never opened</span></li>
        </ul>
      </div>
    </header>

    <div class="carousel" id="carousel" data-for="photo video">
      <div class="carousel-track">

        <section class="slide" id="slideUpload" aria-label="Step 1: upload a file">
          <div class="panel">
            <div class="dropzone" id="dropzone" role="button" tabindex="0"
                 aria-label="Drop a file, or press Enter to browse">
              <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv" hidden />
              <div class="dz-icon">${ICON.upload}</div>
              <strong class="dz-title" data-for="photo">Drop a photo here</strong>
              <strong class="dz-title" data-for="video">Drop a video here</strong>
              <span class="dz-sub">or <u>browse files</u></span>
              <span class="dz-formats" data-for="photo">PNG · JPEG · WebP up to 64&nbsp;MB</span>
              <span class="dz-formats" data-for="video">MP4 · MOV · WebM · MKV up to 100&nbsp;MB</span>
            </div>

            <div class="filecard" id="fileCard" hidden>
              <img id="fileThumb" class="filecard-thumb" alt="" />
              <video id="fileThumbVideo" class="filecard-thumb" muted playsinline hidden></video>
              <div class="filecard-meta">
                <strong id="fileName" class="filecard-name"></strong>
                <span id="fileFacts" class="filecard-facts"></span>
              </div>
              <button id="clearFile" class="icon-btn" type="button" aria-label="Remove file">${ICON.x}</button>
            </div>

            <p id="status" class="status" role="status" aria-live="polite"></p>
            <p id="capNote" class="cap-note" hidden></p>
          </div>
        </section>

        <section class="slide" id="slideProcessing" aria-label="Sanitizing your file">
          <div class="panel processing">
            <div class="proc-frame" id="procFrame">
              <img id="procPreview" alt="" />
              <video id="procPreviewVideo" muted playsinline loop autoplay hidden></video>
              <div class="scanline" aria-hidden="true"></div>
              <div class="proc-check" aria-hidden="true">${ICON.check}</div>
            </div>
            <div class="progress">
              <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
              <p class="progress-stage" id="progressStage">Working…</p>
              <p class="progress-detail" id="progressDetail" hidden></p>
              <button id="cancelBtn" class="ghost-btn cancel-btn" type="button" hidden>${ICON.x}<span>Cancel</span></button>
            </div>
          </div>
        </section>

        <section class="slide" id="slideResult" aria-label="Step 2: your clean file">
          <div class="panel result-stage" id="resultStage">
            <p class="result-headline" id="resultHeadline"></p>
            <div class="verdict" id="verdict" hidden></div>

            <div class="result-canvas">
              <figure class="preview preview-out">
                <figcaption><span id="outCaption">Clean image</span> <span class="size-tag" id="outSize"></span></figcaption>
                <div class="preview-frame" id="outFrame">
                  <img id="outputPreview" alt="Sanitized image preview" />
                  <video id="outputPreviewVideo" controls muted playsinline hidden></video>
                  <div class="frame-pending" id="framePending">Awaiting sanitize</div>
                </div>
              </figure>
              <figure class="preview preview-before">
                <figcaption>Before <span class="size-tag" id="origSize"></span></figcaption>
                <div class="preview-frame">
                  <img id="inputPreview" alt="Original image preview" />
                  <video id="inputPreviewVideo" muted playsinline hidden></video>
                </div>
              </figure>
            </div>

            <div class="result-actions">
              <div id="downloadArea"></div>
              <div class="result-buttons">
                <button id="editBtn" class="ghost-btn" type="button">${ICON.edit}<span>Edit</span></button>
                <button id="newImageBtn" class="ghost-btn" type="button">${ICON.refresh}<span>New file</span></button>
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
                  <small id="ultraHint">Force PNG output · strict fail-closed checks</small>
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

              <div class="video-options" id="videoOptions" hidden>
                <label class="switch-row">
                  <input id="keepAudio" type="checkbox" checked />
                  <span class="switch" aria-hidden="true"></span>
                  <span class="switch-text">
                    <strong>Keep sound</strong>
                    <small>Re-encoded, not scrubbed. Voices and audio watermarks stay.</small>
                  </span>
                </label>
                <label class="video-container-row" id="videoContainerRow">
                  <span class="field-label">Output container</span>
                  <select id="videoContainer">
                    <option value="auto">Auto (MP4)</option>
                    <option value="video/mp4">MP4</option>
                    <option value="video/webm">WebM</option>
                  </select>
                </label>
                <p class="engine-note" id="engineNote"></p>
              </div>

              <div class="adjust-field watermark-tools" id="watermarkTools">
                <span class="field-label">Remove a watermark or overlay</span>
                <div class="seg-row mask-tools" role="group" aria-label="Mask tools">
                  <button type="button" class="seg is-active" id="maskBrush">Brush</button>
                  <button type="button" class="seg" id="maskEraser">Eraser</button>
                  <label class="mask-size"><span>Size</span><input id="maskSize" type="range" min="1" max="20" value="6" aria-label="Brush size" /></label>
                  <button type="button" class="seg" id="maskClear">Clear</button>
                </div>
                <div class="seg-row" role="group" aria-label="Corner presets">
                  <button type="button" class="seg" id="maskCornerTl">Top left</button>
                  <button type="button" class="seg" id="maskCornerTr">Top right</button>
                  <button type="button" class="seg" id="maskCornerBl">Bottom left</button>
                  <button type="button" class="seg" id="maskCornerBr">Bottom right</button>
                </div>
                <p class="mask-state" id="maskState">Nothing marked</p>
                <div class="seg-row" id="inpaintEngine" role="group" aria-label="Remover">
                  <button type="button" class="seg is-active" data-engine="migan">Fast · 28 MB download</button>
                  <button type="button" class="seg" data-engine="lama">High quality · 93 MB download</button>
                </div>
                <div class="mask-actions">
                  <button type="button" class="ghost-btn" id="findWatermark">Find watermark · 275 MB model, about 30 s</button>
                  <button type="button" class="ghost-btn" id="acceptProposals" hidden>Accept all</button>
                  <button type="button" class="primary" id="removeBtn">${ICON.check}<span>Remove marked area</span></button>
                </div>
                <div class="model-progress" id="modelProgress" hidden>
                  <div class="progress-track"><div class="progress-fill" id="modelProgressFill"></div></div>
                  <p class="progress-detail" id="modelProgressText"></p>
                  <button type="button" class="ghost-btn" id="modelCancel">${ICON.x}<span>Cancel download</span></button>
                </div>
                <label class="switch-row">
                  <input id="reduceAi" type="checkbox" />
                  <span class="switch" aria-hidden="true"></span>
                  <span class="switch-text">
                    <strong>Reduce hidden marks</strong>
                    <small>Breaks fragile invisible marks such as the one older Stable Diffusion builds add. Does not remove SynthID. Not a guarantee.</small>
                  </span>
                </label>
                <p class="model-store"><span id="modelStore">Downloaded models: none</span> <button type="button" class="link-btn" id="deleteModels">Delete downloaded models</button></p>
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

    <section class="panel links" id="linkPanel" data-for="link" aria-label="Clean a link">
      <span class="field-label">Paste a link, or a whole message with links in it</span>
      <textarea id="linkInput" class="link-box" rows="3" spellcheck="false" autocomplete="off"
                aria-label="Link or text to clean"
                placeholder="https://www.amazon.com/Some-Product/dp/B08N5WRWNW/ref=sr_1_3?tag=..."></textarea>
      <p class="link-state" id="linkState" role="status" aria-live="polite"></p>
      <div class="link-out" id="linkOut" hidden>
        <span class="field-label">Clean</span>
        <textarea id="linkOutput" class="link-box" rows="3" readonly aria-label="Clean text"></textarea>
        <details class="link-details">
          <summary id="linkSummary"></summary>
          <ul class="link-report" id="linkReport" role="list"></ul>
        </details>
        <button id="linkCopy" class="primary" type="button">${ICON.check}<span>Copy clean link</span></button>
      </div>
    </section>

    <section class="panel docs">
      <div class="docs-grid">
        <article data-for="photo video">
          <h2>How it works</h2>
          <ol class="how-list">
            <li data-for="photo">Drop or pick a PNG, JPEG or WebP photo.</li>
            <li data-for="photo">It is decoded to raw pixels and re-encoded fresh.</li>
            <li data-for="photo">Every non-essential chunk and marker is stripped.</li>
            <li data-for="video">Drop or pick an MP4, MOV, WebM or MKV video.</li>
            <li data-for="video">It is decoded frame by frame and re-encoded with your browser's encoder, or rebuilt from the raw samples when it has none.</li>
            <li data-for="video">Every metadata box and in-stream encoder tag is stripped.</li>
            <li>A strict audit re-scans the output. If anything looks off, download is blocked.</li>
            <li>Download your verified-clean file.</li>
          </ol>
        </article>
        <article data-for="photo video">
          <h2>What gets removed</h2>
          <ul class="wiki-list">
            <li data-for="photo"><b>EXIF</b>: camera, timestamp, and GPS location.</li>
            <li data-for="photo"><b>XMP / IPTC</b>: editor &amp; press metadata blocks.</li>
            <li><b>C2PA</b>: provenance &amp; content-credential signatures.</li>
            <li data-for="photo"><b>JPEG APP/COM</b>: app marker segments.</li>
            <li data-for="photo"><b>PNG text chunks</b>: tEXt, zTXt, iTXt and vendor chunks.</li>
            <li data-for="photo"><b>WebP EXIF/XMP/ICCP</b>: metadata chunks.</li>
            <li data-for="video"><b>MP4 / MOV</b>: GPS, Apple and Android keys, creation dates, encoder names, unique IDs, C2PA, XMP, hidden tracks and padding.</li>
            <li data-for="video"><b>WebM / MKV</b>: tags, title, dates, segment IDs, attachments, chapters, padding.</li>
            <li data-for="video"><b>Inside the video stream</b>: encoder strings (x264, VideoToolbox SEI) and AV1 metadata.</li>
          </ul>
        </article>
        <article data-for="link">
          <h2>How it works</h2>
          <ol class="how-list">
            <li>Paste a link, or a whole message with links in it.</li>
            <li>Each link is checked against known tracking tags and a short rule per site, right in this page.</li>
            <li>The clean text appears as you type. Tap the summary to see what came off each link.</li>
            <li>Copy it and share it. Nothing was sent anywhere.</li>
          </ol>
        </article>
        <article data-for="link">
          <h2>What gets removed</h2>
          <ul class="wiki-list">
            <li><b>Ad click IDs</b>: fbclid, gclid, msclkid, ttclid and the utm tags.</li>
            <li><b>Share IDs</b>: who shared it, from X, Instagram, TikTok, YouTube, Spotify, LinkedIn and Reddit.</li>
            <li><b>Shop links</b>: Amazon, eBay, AliExpress, Etsy and Temu cut down to the product.</li>
            <li><b>Redirects</b>: Facebook, Google and YouTube wrappers replaced by the real address.</li>
            <li><b>Highlights</b>: the text you highlighted, which some browsers add to copied links.</li>
          </ul>
        </article>
      </div>

      <div class="faq">
        <h2>Questions</h2>
        <details data-for="photo video">
          <summary>Why does the input scan say FAIL?</summary>
          <p>That just means metadata or non-essential chunks were detected in your original file. That is exactly the stuff this tool removes. Only the <b>output</b> scan decides whether the download is allowed.</p>
        </details>
        <details>
          <summary>Does this upload anything?</summary>
          <p>No. Photos, videos and links are all processed in your browser. The site ships a Content-Security-Policy that blocks every outbound connection.</p>
        </details>
        <details data-for="photo video">
          <summary>Does it remove everything?</summary>
          <p>It removes known metadata and provenance structures. It cannot guarantee removal of steganography hidden inside the pixels themselves.</p>
        </details>
        <details data-for="photo video">
          <summary>Why force PNG in Ultra Paranoid mode?</summary>
          <p>PNG is a simpler container with fewer metadata edge-cases, so the fail-closed checks can be stricter and more certain. For video, Ultra Paranoid always re-encodes when the browser can, removes the sound, and writes MP4.</p>
        </details>
        <details data-for="video">
          <summary>Full clean or basic clean for video?</summary>
          <p><b>Full clean</b> decodes every frame and re-encodes it with your browser's own video encoder, which also drops the original encoder's fingerprint and weakens fragile hidden patterns. <b>Basic clean</b> rebuilds the container from the raw samples and strips every metadata box and in-stream tag, but leaves the picture and sound bytes as they were. You get the full clean whenever your browser has a WebCodecs encoder; otherwise the page tells you and falls back to the basic clean.</p>
        </details>
        <details data-for="video">
          <summary>Why does video take longer?</summary>
          <p>A full clean re-encodes every frame. A minute of 1080p video can take from a few seconds on a desktop to a few minutes on a phone. The basic clean is a byte copy and takes seconds.</p>
        </details>
        <details data-for="photo">
          <summary>Does this remove AI watermarks?</summary>
          <p>It can reduce some. Reduce hidden marks runs a small local autoencoder round trip plus a resample and requantize, which defeats fragile marks such as the DWT-DCT scheme older Stable Diffusion builds used. It does not remove SynthID or similar robust marks, it cannot verify that anything is gone, and a processed image can itself be recognised as processed.</p>
        </details>
        <details data-for="link">
          <summary>How does Clean a link work?</summary>
          <p>It removes the tags that only exist to track who shared a link and who clicked it: utm and click IDs from the ad networks (fbclid, gclid, msclkid and others), share IDs from X, Instagram, TikTok, YouTube and Spotify, and referral codes from Amazon and eBay. Amazon and eBay product links are cut down to the product number. Facebook, Google and YouTube redirect links are replaced by the real address inside them. Anything it does not recognise stays, so the link keeps working. It all runs in your browser.</p>
        </details>
        <details data-for="link">
          <summary>Can it open short links like t.co, bit.ly or amzn.to?</summary>
          <p>No, on purpose. A short link is just a code. Only the company behind it knows where it leads, and asking them tells them you clicked. The page marks short links so you know. To clean one, open it in a private window, copy the full address and paste that here.</p>
        </details>
        <details data-for="photo">
          <summary>How does Remove marked area work?</summary>
          <p>You mark the watermark with the brush or a corner preset. A local inpainting model (MI-GAN, or LaMa for High quality) fills only the marked pixels, then the image goes through the same encode, strip and audit as any other. The models download once, after your click, are verified against a hash pinned in the source, and can be deleted from the editor.</p>
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
                Reduce hidden marks is the first step. Next is a regenerate mode strong enough for
                robust marks, once it runs in minutes rather than an hour, with a risk score so you
                know how exposed a photo really is.
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
