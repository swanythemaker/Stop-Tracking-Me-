# Link tracking parameters: research notes

Research date: 2026-11-18. Facts gathered for the StopTrackingMe "removed tags" explanations. This file is research, not UI copy.

## How to read this file

- **Confidence** levels:
  - **documented**: the company that adds the tag describes it in its own docs.
  - **widely reported**: several independent sources (filter lists, privacy tools, press, user reports) agree, but the company has not documented it.
  - **inferred**: my own reading of the evidence (value shapes, names, decoding). Treat as a hypothesis.
  - **not verified**: I could not confirm it. Do not present it as fact.
- **Example value** shapes are realistic but illustrative unless marked "real example from source".
- Filter lists used as cross-checks (all fetched on 2026-11-18):
  - ClearURLs rules: https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json
  - AdGuard URL Tracking filter, generic: https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/TrackParamFilter/sections/general_url.txt
  - AdGuard URL Tracking filter, site specific: https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/TrackParamFilter/sections/specific.txt
  - DandelionSprout "Legitimate URL Shortener" (used by uBlock Origin users): https://raw.githubusercontent.com/DandelionSprout/adfilt/master/LegitimateURLShortener.txt
  - Firefox query stripping list (Remote Settings): https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/query-stripping/records
- Brave: its query filter list now ships as a downloadable component, not in brave-core source, so I could not read the full current list. Only the Brave GitHub issue for X's `t` was read.
- Web search through webgate's SearXNG returned nothing during this session. Searches were done by fetching DuckDuckGo's HTML results page through `webgate fetch` until DuckDuckGo started serving a bot challenge. After that, only direct fetches of known URLs were used.

## Implementation facts worth knowing (not UI copy)

- X's `a`, `s` and `t` must be scoped to `x.com` / `twitter.com`. `a`, `s` and `t` are functional on many other sites (YouTube's `t` is the start time).
- AdGuard strips X's `t` only on `/status/` paths, because stripping it elsewhere broke `/i/redirect?url=` links (comment cites uBlockOrigin/uAssets issue 20941).
- Reddit `rdt`: AdGuard and uBlock strip it only on Firefox, because stripping it at request time in Chromium caused reload loops (AdguardFilters issue 191029). For pasted links that StopTrackingMe cleans (not live navigation) this is less of a concern.
- Amazon `psc` and `th` choose a product variant on some pages. AdGuard keeps its `psc` rule disabled after a breakage report (AdguardFilters issue 157889).
- TikTok: AdGuard notes that removing `share_app_id` while a Referer header is present can make TikTok return "502 Bad Gateway" (AdguardFilters issue 234858). This matters for request rewriting, not for pasted links.
- Facts about who already removes X's `a=` (checked 2026-11-18):
  - AdGuard: yes, since 2026-10-29.
  - ClearURLs: no. Its `x` provider is still `(?:ref_?)?src`, `s`, `cn`, `ref_url`, `t`, and PR 354 is open.
  - DandelionSprout list: no X rule for `a`.

---

## X (Twitter)

### a

- **Who adds it**: X, when you use Share then Copy link on a post. Reported on the web app (`s=20`) and the iPhone app (`s=46`). Also reported on the Android app (X 13.37.2), but only through LinkClean's summary of a Piko issue. I did not read that issue myself.
- **What it is**: An opaque share token that X started adding to copied post links in late October 2026, in the place where `t=` used to be.
- **What it gives away**: Not documented by X. **Inferred**: same job as `t=`. Each click on the link can be tied back to the specific share (and so, on X's side, to the account or session that copied it). One reporter (ClearURLs issue 352) describes it as "a unique fingerprint attached to each time the user presses 'Copy link'". I did not test whether it changes on every copy.
- **Example value**: `https://x.com/user/status/123?a=arMamaA1lWeuSqriZFw&s=20`. Real examples from sources:
  - `a=RFELiAObBLe_jLlG8Ms` (Cybernews)
  - `a=uimaJy3bBcbyfnLBrjs` (ClearURLs issue 352)
  - `a=km-iPVLqJ85w4CTILo8` (ClearURLs PR 354)
  - `a=Z6xVF8Ttr_sjvaP7Xbs` (OpenClip PR 81)
- **Format observations (inferred, my own analysis)**:
  - Every value seen (including the owner's) is exactly 19 characters from the URL-safe base64 alphabet (A-Z, a-z, 0-9, `-`, `_`).
  - That decodes to 14 bytes. The old `t=` values were 22 characters, which decodes to 16 bytes (example `t=CXBXxSiUKI8wPAkoGMH7zg` from 2021).
  - So `a` is not just `t` renamed with the same value format. The token length changed too.
  - The decoded bytes do not look like an X post ID (snowflake) or a timestamp. They look random.
- **When it appeared**: First public reports are dated 2026-10-28/29, about three weeks before today, not one week.
  - ClearURLs Rules issue 352 was opened 2026-10-29 06:49 UTC. Its first linked post has ID 2115497330082504960, and decoding that ID dates the post to 2026-10-28 17:34 UTC.
  - OpenClip's "Clean Link" PR 81 was merged 2026-10-29.
  - AdGuard commit 598630ce3a ("fix x.com copy link tracking parameters", 2026-10-29 12:52 UTC) added `||x.com^$removeparam=a` and `||x.com^$removeparam=s`.
  - Cybernews and a wave of Italian/Spanish posts the same day.
  - LinkClean states links copied since 2026-10-29 carry `a=` and no `t=`.
- **Confidence**:
  - Existence, date and format: **widely reported** (plus my own decoding).
  - What it encodes: **not verified**. X has said nothing.
  - "Same role as `t`": **inferred**.
- **Sources**:
  - https://github.com/ClearURLs/Rules/issues/352 (read via GitHub API)
  - https://github.com/ClearURLs/Rules/pull/354 (read)
  - https://github.com/ganeshmshetty/openclip-extensions/pull/81 (read)
  - AdGuard commit 598630ce3a in AdguardTeam/AdguardFilters (read via GitHub API)
  - https://cybernews.com/privacy/twitter-tracks-copied-links/ (read; shows an `a=` example but does not explain it)
  - https://pasqualepillitteri.it/en/news/28027/x-link-tracking-s20-s46-t-parameters (read; notes that `a=` is undocumented and new)
  - https://linkclean.app/trackers/a-twitter/ (read; summarizes four reports from 2026-10-29)
  - https://linkclean.app/learn/x-twitter-share-url-explained/ (read)

### t

- **Who adds it**: X (then Twitter), on links copied with Share. First noticed on mobile apps. A 2021 Reddit user saw it from a Samsung phone but not from the web or an iPod.
- **What it is**: An opaque share token. Before late October 2026 it was the main per-share tag on X links.
- **What it gives away**: Disputed, and X never documented it.
  - Gergely Orosz (2022-11-12) said it is the encoded user ID of the person who shared, letting X see who opens links you shared elsewhere. This was widely repeated.
  - Brave's issue says it "appears to be linked to the Twitter account".
  - LinkClean/Link Cleaner say it is consistent per device session and useful for spotting coordinated sharing.
  - A 2021 Reddit user saw a different `t` on each of three copies of the same post.
  - Safe wording: it lets X tie the link to the share, and through that to the sharer's account or session on X's side. A recipient cannot read a name out of it.
- **Example value**: `?t=CXBXxSiUKI8wPAkoGMH7zg&s=19`. Real `t` value from ClearURLs GitLab issue 203 (22 characters, URL-safe base64, 16 bytes).
- **History**: ClearURLs GitLab issue 203 (2021-11-17) asked to remove "the new t parameter recently added" to Twitter share links. Brave issue 26756 (opened 2022-11-14, closed 2022-11-17) added removal on twitter.com.
- **Confidence**:
  - Existence: **widely reported**.
  - "Encoded user ID": **widely reported but not confirmed**.
  - "Ties link to the sharing account on X's side": **inferred**.
- **Sources**:
  - https://gitlab.com/ClearURLs/rules/-/work_items/203 (read via GitLab API)
  - https://github.com/brave/brave-browser/issues/26756 (read)
  - https://x.com/GergelyOrosz/status/1591412171107450880 (search snippet only)
  - https://www.reddit.com/r/Twitter/comments/r7s1gi/t_query_in_twitter_urls/ (search snippet only)
  - https://pasqualepillitteri.it/en/news/28027/x-link-tracking-s20-s46-t-parameters (read)
  - https://linkclean.app/learn/x-twitter-share-url-explained/ (read)

### s

- **Who adds it**: X, on links made with Share (Copy link, or share to another app).
- **What it is**: A two-digit code for which app or device made the link and which share button was used.
- **What it gives away**: The kind of device and app the sharer used (web, Android, iPhone, iPad), and the share route (Copy link, WhatsApp, SMS, email, and so on). On its own it does not identify a person.
- **Code table**: The full list of 71 codes was extracted from Twitter's own web JavaScript (archived `main.ea5f3cf9.js`, 2022) by the Unfurl project. Selected values:
  - `19` Android, Copy
  - `20` Twitter Web, Copy (the most common in the wild)
  - `21` iOS, Copy
  - `46` iPhone, Copy
  - `09` Android, Other
  - `12` iOS, Other
  - `17` Web, Email
  - `18` Web, Download
  - `08` Android, WhatsApp
  - `24` iOS, WhatsApp
  - `48` iPhone, WhatsApp
  - `41` Gryphon (third-party client), Copy
  - `57` to `71` are iPad variants.
  - Press in Oct/Nov 2026 (Cybernews, Techweez, NDTV Profit) repeats the short version: 19 Android, 20 web, 46 iPhone.
  - One conflicting claim: OpenClip's PR text calls `s=20` the iOS share-sheet code. That contradicts Unfurl and everyone else. Treat it as an error.
- **Example value**: `?s=20`, `?s=46`, `?s=19`
- **Confidence**: **widely reported**. It comes from X's own front-end code but was never published as documentation, so the numbers could change without notice.
- **Sources**:
  - https://raw.githubusercontent.com/obsidianforensics/unfurl/main/unfurl/parsers/parse_twitter.py (read; contains the full table and the reference to Twitter's JS)
  - https://cybernews.com/privacy/twitter-tracks-copied-links/ (read)
  - https://techweez.com/2026/11/02/x-link-device-tracking-iphone-android/ (read)
  - https://www.ndtvprofit.com/india/iphone-android-or-desktop-can-a-twitter-link-reveal-the-source-heres-the-truth-12263184 (search snippet only)
  - https://linkclean.app/learn/x-twitter-share-url-explained/ (read)

### cn

- **Who adds it**: X/Twitter, in links inside its notification and digest emails. Seen together with `refsrc=email`, and inside `twitter.com/i/redirect?url=...` wrappers. Those wrappers also carried `uid=`, `sig=`, `iid=`, `nid=`.
- **What it is**: A base64-looking value on email links. Most likely it labels the email campaign or notification type (**inferred**).
- **What it gives away**: That you arrived from an X email, and probably which kind of email. The surrounding redirect wrapper in the reported example also carried a `uid=` (user ID) value.
- **Example value**: `?cn=ZmxleGlibGVfcmVjcw%3D%3D&refsrc=email` (illustrative shape; the ClearURLs report shows `cn=...%3D%3D` with the real values altered)
- **Confidence**: Existence: **widely reported** (ClearURLs and AdGuard strip it). Exact meaning: **not verified**.
- **Sources**:
  - https://gitlab.com/ClearURLs/rules/-/work_items/277 (read)
  - ClearURLs data.min.json, providers `twitter` and `x` (read)

### ref_src

- **Who adds it**: X's embed code ("Twitter for Websites") on links inside embedded posts on other websites.
- **What it is**: A label saying the click came from an embedded post on a third-party site.
- **What it gives away**: That you clicked from an embed, plus campaign details. Long forms include the embedded post ID: `twsrc^tfw|twcamp^tweetembed|twterm^<id>`.
- **Example value**: `?ref_src=twsrc%5Etfw` or `?ref_src=twsrc%5Etfw%7Ctwcamp%5Etweetembed%7Ctwterm%5E1181537299038953473`
- **Confidence**: **widely reported**. The value appears in X's publish.twitter.com embed code. "tfw = Twitter for Websites" is the common reading.
- **Sources**:
  - DandelionSprout list line 117 (real example)
  - AdGuard specific.txt ("Embedded tweets" section)
  - https://stackoverflow.com/questions/74538291/html-and-twitter-url-regex-search-and-replace (search snippet only)

### ref_url

- **Who adds it**: X's embed widgets, next to `ref_src`.
- **What it is**: The address of the web page where the embedded post was shown.
- **What it gives away**: Which page you were reading when you clicked through to X.
- **Example value**: `&ref_url=https%3A%2F%2Fwww.example-news.com%2F2026%2F11%2Fstory.html`
- **Confidence**: **widely reported** (stripped by ClearURLs, AdGuard and DandelionSprout as an embed parameter).
- **Sources**: DandelionSprout list line 117; AdGuard specific.txt "Embedded tweets"; ClearURLs `twitter`/`x` providers

### (extra) cxt

- **Who adds it**: X, when you open a post from someone's profile.
- **What it is**: An opaque context token.
- **What it gives away**: Which X screen the click came from.
- **Example value**: `?cxt=HHwWgMCj2Zi23ooSAAAA` (real example from DandelionSprout list)
- **Confidence**: **widely reported**.
- **Sources**: https://gitlab.com/ClearURLs/rules/-/work_items/242 (read); DandelionSprout list line 3919

### twclid (X ads)

- **Who adds it**: X Ads, on the landing-page link when someone clicks an ad on X.
- **What it is**: X's click ID.
- **What it gives away**: Ties the visit to the exact ad click, so X and the advertiser can match later purchases or sign-ups to the ad. X says its Pixel reads `twclid` from the URL or from a first-party cookie.
- **Example value**: `?twclid=2-3bhrj1ny7p11v5r9pap3anqge` (real example from AdGuard list comment)
- **Confidence**: **documented**.
- **Sources**:
  - https://help.x.com/en/business-and-advertising/conversion-tracking-for-websites (read: "twclid: X click ID ... The X Pixel already automatically passes twclid from URL or first-party cookie")
  - Firefox strip list (contains `twclid`)

---

## Instagram and Threads (Meta)

### igsh

- **Who adds it**: Instagram, on links copied with Share (app and web).
- **What it is**: A share token added to a copied Instagram link.
- **What it gives away**: Ties the link to the account that shared it. Lifehacker (2026-03-13) and user reports say that whoever opens a shared reel can be shown that your account shared it ("[username] shared a reel with you"), even if you did not send it to them directly. Pillitteri notes this is reported by users and Lifehacker, not described by Meta.
- **Example value**: `?igsh=cGd5cGx4enJmcThu` (real example from Lifehacker). It decodes from base64 to the random-looking 12-character string `pgyplxzrfq8n` (my decoding).
- **Confidence**: Existence: **widely reported**. "Shows the recipient who shared": **widely reported** (not documented by Meta).
- **Sources**:
  - https://lifehacker.com/tech/how-to-stop-social-media-platforms-from-tracking-you (read)
  - https://pasqualepillitteri.it/en/news/28027/x-link-tracking-s20-s46-t-parameters (read)
  - ClearURLs `instagram` provider (`igshid`, `igsh`)
  - AdGuard specific.txt "instagram.com - share tracking"

### igshid

- **Who adds it**: Instagram. The older name for the same kind of share token. Also seen on outside links opened from Instagram bios.
- **What it is**: The original Instagram share ID.
- **What it gives away**: Same as `igsh`. Ties the link to the share and so to the sharer's account on Meta's side.
- **Example value**: `?igshid=YmMyMTA2M2Y%3D&utm_source=ig_web_copy_link` (shape from LinkClean)
- **Confidence**: **widely reported**. On the claim that `igshid`, `igsh` and `igsi` are one token renamed over time: LinkClean says so, and I did not verify it independently.
- **Sources**:
  - https://linkclean.app/trackers/igshid/ (read)
  - DandelionSprout list line 272
  - AdGuard specific.txt (`igshid` on instagram.com, threads.com, threads.net)

### igsi, stkn, srtk, psln, exln, vrfl, cplk, dlrf, mdxt, obrf, rpxt, xtok (new Instagram share names, 2026)

- **Who adds it**: Instagram (and `stkn` also Threads), on copied post and reel links.
- **What it is**: New names for the share token. Instead of always using `igsh`, links now carry one of several short names. A user report says the values are always 12 to 13 bytes, base64 encoded.
- **What it gives away**: **Inferred**: same as `igsh`. LinkClean says these names are listed in one family with `igshid`/`igsh` in Instagram's public configuration. I did not see that configuration myself.
- **Example value**: `https://www.instagram.com/reel/DAbCdEfGhIj/?srtk=MTJhYmNkZWZnaGlq` (illustrative)
- **Timeline**:
  - AdGuard issue 244642 (2026-10-17) reported `psln`, `srtk`, `exln`, `stkn`, `vrfl`.
  - ClearURLs issue 351 / PR 350 (2026-10-24) asked for `exln`.
  - AdGuard added 12 names on 2026-11-13 (commit 2f8d5f3ab1).
  - ClearURLs' published rules still only list `igshid` and `igsh`.
- **Confidence**: Existence: **widely reported**. Meaning: **inferred**.
- **Sources**:
  - https://github.com/AdguardTeam/AdguardFilters/issues/244642 (read)
  - AdGuard commit 2f8d5f3ab1 (read)
  - https://github.com/ClearURLs/Rules/issues/351 (title seen)
  - https://linkclean.app/learn/instagram-facebook-url-parameters/ (read)

### utm_source=ig_web_copy_link (Instagram)

- **Who adds it**: Instagram's web client, next to its share token.
- **What it is**: A standard UTM campaign label naming Instagram's web Copy link button.
- **What it gives away**: Where the link was copied from.
- **Confidence**: **widely reported**.
- **Sources**: https://linkclean.app/trackers/igshid/

---

## Facebook (Meta)

### fbclid

- **Who adds it**: Meta, on links people click from Facebook and Instagram.
  - Meta's docs describe it for ad clicks: "passed with the URL of an advertiser's website when a user clicks an ad on Facebook and/or Instagram".
  - Filter lists and press report it on ordinary outbound links too.
- **What it is**: Meta's "ClickID", a click identifier added to the destination URL.
- **What it gives away**: Ties the visit to the click on Meta. If the site runs the Meta Pixel, the Pixel stores it in the `_fbc` cookie and sends it back, so Meta and the site can match your visit (and later purchases) to that click. If you forward the link, the next person's visit carries your click's ID.
- **Example value**: `?fbclid=IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk` (Meta's own example)
- **Confidence**: **documented** (for ads). On non-ad links: **widely reported**.
- **Sources**:
  - https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/ (read)
  - Firefox strip list; ClearURLs globalRules; AdGuard general_url.txt ("Facebook analytics")

### mibextid

- **Who adds it**: Facebook's mobile apps (sometimes Messenger), on links shared from the app.
- **What it is**: An undocumented share ID.
- **What it gives away**: Unclear. LinkClean observed fixed values such as `wwXIfr` and `LQQJ4d` that recur unchanged on links shared by unrelated people. On its own the value then seems to name the app or share surface rather than a person (**inferred**). Treat claims that it identifies your account as **not verified**.
- **Example value**: `?mibextid=wwXIfr` (real recurring value per LinkClean)
- **Confidence**: Existence: **widely reported**. Meaning: **not verified**.
- **Sources**:
  - https://linkclean.app/trackers/mibextid/ (read)
  - ClearURLs `facebook` provider; AdGuard specific.txt ("Facebook" section)
  - https://www.reddit.com/r/webdev/comments/169up1z/what_is_the_mibextidxxxxxx_url_parameter_used_for/ (search snippet only)

### `__cft__[0]` (often written `__cft__%5B0%5D`)

- **Who adds it**: Facebook, on links inside facebook.com (post and comment timestamps, profile links). Noticed around 2020.
- **What it is**: A long encoded token about the click.
- **What it gives away**: **Inferred**: context about where and how the link was clicked and by which session. It shows up when you copy a post's link from the page. Not documented.
- **Example value**: `?__cft__[0]=AZW3k9...` (a very long opaque string)
- **Confidence**: **widely reported** (filter lists strip `__cft__[n]` and `__xts__[n]`). Meaning: **not verified**.
- **Sources**:
  - https://stackoverflow.com/questions/64092454/what-is-the-purpose-of-the-new-cft-0-and-tn-parameters-in-facebook-po (search snippet only; the full page was blocked)
  - ClearURLs `facebook` provider
  - https://www.untracklink.com/tracking-parameters/__cft__ (read, secondary)

### `__tn__`

- **Who adds it**: Facebook, on internal links. Usually seen together with `__cft__`.
- **What it is**: A short code describing the part of Facebook's interface the link was in (feed, profile, and so on).
- **What it gives away**: Which Facebook screen you clicked from (**inferred**).
- **Example value**: `&__tn__=%2CO%2CP-R` (illustrative shape)
- **Confidence**: **widely reported**. Meaning: **inferred**.
- **Sources**: Stack Overflow question above (snippet); ClearURLs `facebook` provider; https://www.untracklink.com/tracking-parameters/__tn__ (read, secondary)

### sfnsn (Priority 2)

- **Who adds it**: Facebook mobile apps, on shared post links.
- **What it is**: A share-source marker, for example `mo` (mobile).
- **What it gives away**: That the link was shared from Facebook's mobile app.
- **Example value**: `?sfnsn=mo` (real example from DandelionSprout list)
- **Confidence**: **widely reported**.
- **Sources**: DandelionSprout list line 2176; ClearURLs `facebook` provider

### fb_action_ids, fb_action_types, fb_source, fb_ref (extra)

- **Who adds it**: Facebook, on links posted through older Open Graph "story" sharing.
- **What it gives away**: Which Facebook action or story produced the click.
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs globalRules; AdGuard general_url.txt; https://linkclean.app/learn/instagram-facebook-url-parameters/

---

## YouTube (Google)

### si

- **Who adds it**: YouTube, on links made with the Share button (apps and web). Widely noticed from about August/September 2023.
- **What it is**: A share identifier.
- **What it gives away**: Ties the link to the share, and so to the account that made it, on Google's side. Users and press say YouTube can use it to connect sharer and recipient (for example, for recommendations). Google has not documented its exact use.
- **Example value**: `https://youtu.be/dQw4w9WgXcQ?si=Zq3bRDXMnA_ZLp5n` (illustrative, 16 characters)
- **Important**: YouTube's `t=` is the start time (for example `t=90`). It is not a tracker and must be kept.
- **Confidence**: Existence: **widely reported**. Purpose: **widely reported** (not documented).
- **Sources**:
  - https://www.reddit.com/r/webdev/comments/15ukrpi/what_is_the_si_parameter_in_a_youtube_share_link/ (snippet)
  - https://linksanitizer.com/learn/what-is-the-si-parameter/ (snippet: "began adding it ... in September 2023")
  - https://linkclean.app/trackers/si/ (read)
  - ClearURLs `youtube` provider; AdGuard specific.txt

### pp

- **Who adds it**: YouTube, on video links in listings (search results, subscriptions feed, channel video lists). The watch page then drops it from the address bar.
- **What it is**: An encoded context token, for example `pp=sAQA`.
- **What it gives away**: Context about where the click came from (which list or search). **Not verified**: whether some values contain the search words themselves.
- **Example value**: `&pp=sAQA` (real example from the Hacker News thread)
- **Confidence**: **widely reported**.
- **Sources**:
  - https://news.ycombinator.com/item?id=28005638 (snippet: "YouTube started adding a new parameter pp=sAQA to video URLs on most index style pages", 2021)
  - AdGuard specific.txt `||youtube.com^$removeparam=pp`
  - ClearURLs `youtube` provider

### feature

- **Who adds it**: YouTube, on some shared or embedded links.
- **What it is**: A label for which YouTube feature made the link (for example `share`, `youtu.be`, `shared`, `emb_logo`).
- **What it gives away**: How the link was made or where it was clicked. It does not identify a person.
- **Example value**: `?feature=share`
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs `youtube` provider; https://www.untracklink.com/tracking-parameters/feature (read, secondary)

---

## Spotify

### si

- **Who adds it**: Spotify, on every link made with Share (tracks, albums, playlists, podcasts). Around since at least 2018.
- **What it is**: A share identifier (same letters as YouTube's, but a separate system).
- **What it gives away**: Ties the link to the person who shared it. Spotify Community users report it is used to suggest "social connections" between sharer and recipient. Not documented by Spotify.
- **Example value**: `https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1a2b3c4d5e6f4a7b` (illustrative)
- **Confidence**: **widely reported**.
- **Sources**:
  - https://community.spotify.com/t5/Social-Random/Option-to-disable-quot-si-quot-tracking-parameters-in-shared/td-p/7270226 (snippet)
  - https://www.reddit.com/r/spotify/comments/8k0u9q/spotify_si_url_parameter/ (snippet, 2018)
  - ClearURLs `spotify.com` provider; AdGuard specific.txt (also strips `sp_cid`, `dlsi`, `pi`, `referral` on open.spotify.com)

---

## TikTok

All TikTok share tags below are undocumented. Filter lists strip them on tiktok.com. Confidence is **widely reported** unless noted.

### _t

- **Who adds it**: TikTok app, on copied or shared video links.
- **What it is**: A share token.
- **What it gives away**: Ties the link to the share event and, on TikTok's side, to the sharing account (**inferred**).
- **Example value**: `?_r=1&_t=ZS-98gqVCd8df7` (shape from UntrackLink)
- **Sources**: ClearURLs `tiktok.com` provider; AdGuard specific.txt; https://www.untracklink.com/tracking-parameters/_t (read, secondary)

### _r

- **Who adds it**: TikTok app, next to `_t`.
- **What it is**: A small flag (usually `1`) that is part of share tracking.
- **What it gives away**: Little on its own. It marks the link as an app share.
- **Example value**: `_r=1`
- **Sources**: same as `_t`

### is_from_webapp

- **Who adds it**: TikTok website, on links copied from the browser version.
- **What it is**: A flag saying the link came from TikTok's website.
- **What it gives away**: That the sharer used the web version.
- **Example value**: `?is_from_webapp=1&sender_device=pc`
- **Sources**: AdGuard specific.txt (`||tiktok.com/@*/video/*$removeparam=is_from_webapp`); https://www.untracklink.com/tracking-parameters/is_from_webapp (snippet)

### sender_device

- **Who adds it**: TikTok, on shared links.
- **What it is**: The kind of device the sharer used.
- **What it gives away**: The sharer's device type (for example `pc` or `mobile`).
- **Example value**: `sender_device=pc`
- **Sources**: AdGuard specific.txt; https://www.untracklink.com/tracking-parameters/sender_device (read, secondary)

### share_app_id, share_link_id, share_item_id, share_author_id, share_iid, share_region, share_app_name, social_share_type

- **Who adds it**: TikTok, on links shared from the app.
- **What it is**: Details of the share.
  - `share_app_id`: which TikTok app made it.
  - `share_link_id`: an ID for this particular share link.
  - `share_author_id`: the video author's ID.
  - `share_iid`: install ID, **inferred** from the name.
  - `share_region`: region.
- **What it gives away**: Which app, which share, and possibly which install made the link, plus a region. Together these tie the link to the sharer's app install and account on TikTok's side (**inferred**).
- **Example value**: `&share_app_id=1233&share_link_id=8c1f0a4e-2b7d-4f3e-9a51-6d0c2e7b9f14&share_region=US` (illustrative)
- **Sources**: ClearURLs `tiktok.com` (`share_app_name`, `share_iid`); AdGuard specific.txt (`share_app_id`, `share_author_id`, `share_link_id`, `share_region`, `social_share_type`)

### u_code, user_id, sec_user_id, sec_uid, timestamp, tt_from, refer, enter_method (extra TikTok)

- **What it gives away**:
  - `user_id`, `sec_user_id`, `sec_uid` and `u_code` look like direct account identifiers for the sharer (**inferred** from the names; not verified).
  - `timestamp` is when the link was made.
  - `tt_from` is the share route (for example `copy`).
- **Sources**: ClearURLs `tiktok.com` (`u_code`, `user_id`, `timestamp`, `_d`, `preview_pb`, `source`); AdGuard specific.txt

### ttclid (TikTok ads)

- **Who adds it**: TikTok Ads, on the landing page link when someone clicks a TikTok ad.
- **What it is**: TikTok's click ID.
- **What it gives away**: Ties the visit to the ad click so TikTok and the advertiser can attribute purchases or sign-ups to the ad.
- **Example value**: `?ttclid=E.C.P.CsUBabc123...` (illustrative)
- **Confidence**: **documented**.
- **Sources**:
  - https://ads.tiktok.com/resources/help/article/tiktok-click-id?lang=en (snippet: "TTCLID is a tracking parameter appended to a landing page URL when you click on an ad on TikTok")
  - https://business-api.tiktok.com/portal/docs/send-tiktok-click-id-ttclid/v1.3 (snippet)

---

## Google (Ads, Analytics, Merchant Center)

### gclid

- **Who adds it**: Google Ads, when auto-tagging is on, on the landing page link after an ad click.
- **What it is**: The Google Click ID.
- **What it gives away**: "Identifies the campaign along with other attributes of the click associated with the ad" (Google). The site and Google can tie your visit and later actions (purchase, sign-up, even offline sales) to that ad click.
- **Example value**: `?gclid=Cj0KCQiA2KitBhCIARIsAPPMEhJx...` (illustrative shape)
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/google-ads/answer/9744275 (read); Firefox strip list

### gbraid

- **Who adds it**: Google Ads, for iOS 14+ traffic where `gclid` cannot be used without consent ("web to app" measurement).
- **What it is**: A replacement click parameter designed to comply with Apple's App Tracking Transparency rules.
- **What it gives away**: Lets Google attribute conversions back to ad campaigns, with aggregated or modeled measurement. **Inferred**: it is less tied to one person than `gclid`, which is Google's stated reason for it.
- **Example value**: `?gbraid=0AAAAAoX7...` (illustrative)
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/analytics/answer/11367152 (read); https://support.google.com/google-ads/answer/10417364 (snippet: introduced March 2021)

### wbraid

- **Who adds it**: Google Ads, for iOS 14+ "app to web" measurement (ad clicked in a Google app, landing on a website).
- **What it is**: The other iOS replacement for `gclid`.
- **What it gives away**: Ties the visit to an ad campaign for conversion measurement.
- **Example value**: `?wbraid=CkQKCQiA...` (illustrative)
- **Confidence**: **documented**.
- **Sources**: same as `gbraid`

### gad_source

- **Who adds it**: Google Ads, on ad landing URLs.
- **What it is**: Google's words: "used to identify the source of ads URLs and improve the accuracy of ads conversion measurement".
- **What it gives away**: That you came from a Google ad, and which kind of Google ad surface.
- **Example value**: `?gad_source=1`
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/google-ads/answer/13327296 (read)

### gad_campaignid (extra)

- **Who adds it**: Google Ads.
- **What it is**: The ad campaign's ID.
- **What it gives away**: Which campaign showed you the ad.
- **Example value**: `&gad_campaignid=21234567890`
- **Confidence**: **widely reported** (AdGuard cites the same Google help article; I did not see the name in that article's short text).
- **Sources**: AdGuard general_url.txt

### srsltid

- **Who adds it**: Google Merchant Center auto-tagging, when someone clicks a product on Google Search (free listings included). It is on by default for new accounts.
- **What it is**: A search-result ID added to the shop's product URL.
- **What it gives away**: Ties your visit to the specific Google product listing click, so the shop and Google can measure purchases from it.
- **Example value**: `?srsltid=AfmBOoq3xT...` (illustrative)
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/merchants/answer/15191080 (read; the search snippet of the same page names `srsltid`); ClearURLs globalRules; AdGuard ("Google Merchant Center tracking")

### _gl

- **Who adds it**: Google Analytics / Google tag cross-domain measurement, on links between a company's own domains.
- **What it is**: A "linker" parameter that carries your analytics cookie IDs from one domain to the next.
- **What it gives away**: Your Google Analytics visitor and session IDs. Shared links that contain it can merge the next person's visit into your analytics identity.
- **Example value**: `?_gl=1*abcde5*` (Google's example), real ones are longer: `_gl=1*1x2y3z*_ga*MTIzNDU2Nzg5LjE3MzA...`
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/analytics/answer/10071811 (read)

### utm_source, utm_medium, utm_campaign, utm_term, utm_content

- **Who adds it**: Whoever published the link (marketers, newsletters, apps). This is Google Analytics' campaign convention, used by almost every analytics tool.
- **What it is** (Google's definitions):
  - `utm_source`: the referrer (for example google, newsletter4)
  - `utm_medium`: the marketing medium (cpc, banner, email)
  - `utm_campaign`: the campaign (spring_sale)
  - `utm_term`: the paid keyword
  - `utm_content`: tells creatives or links apart (for example two buttons in one email)
- **What it gives away**: Which campaign, email, ad or app the link came from. Usually not a personal ID, but some senders put subscriber or user IDs in them.
- **Example value**: `?utm_source=newsletter&utm_medium=email&utm_campaign=nov_sale&utm_content=button_2`
- **Also documented**: `utm_id` (campaign ID), `utm_source_platform`, `utm_creative_format`, `utm_marketing_tactic`. Filter lists strip dozens of nonstandard `utm_*` variants.
- **Confidence**: **documented**.
- **Sources**: https://support.google.com/analytics/answer/10917952 (read); ClearURLs globalRules `utm(?:_[a-z_]*)?`

### dclid (Priority 2)

- **Who adds it**: Google display advertising (Campaign Manager 360 / Display & Video 360).
- **What it is**: The display-ad click ID.
- **What it gives away**: Ties the visit to a display ad click.
- **Example value**: `?dclid=CJqT...`
- **Confidence**: **widely reported** (Firefox strip list, ClearURLs, AdGuard citing Google's Measurement Protocol parameter reference).
- **Sources**: Firefox strip list; AdGuard general_url.txt

### gclsrc (Priority 2)

- **Who adds it**: Google Ads / Search Ads 360, next to `gclid`.
- **What it is**: Names the system that generated the click ID (for example `aw.ds`).
- **What it gives away**: Which Google ad system the click came from.
- **Example value**: `&gclsrc=aw.ds` (real example from DandelionSprout list)
- **Confidence**: **widely reported**.
- **Sources**: DandelionSprout list line 105; AdGuard general_url.txt

### _ga (Priority 2)

- **Who adds it**: Older Google Analytics (analytics.js) cross-domain linker.
- **What it is**: The predecessor of `_gl`. It carries your GA client ID.
- **What it gives away**: Your Google Analytics visitor ID.
- **Example value**: `?_ga=2.123456789.987654321.1731900000-1234567890.1731900000`
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs globalRules; AdGuard general_url.txt (cites support.google.com/analytics/answer/10071811)

---

## Microsoft Advertising (Bing)

### msclkid

- **Who adds it**: Microsoft Advertising, when "auto-tagging of Microsoft Click ID" is on.
- **What it is**: A unique click ID added to the landing page URL.
- **What it gives away**: Ties your visit to the ad click. Microsoft says the click ID "will be included in all subsequent UET events fired whenever the same customer visits your page", so later visits and purchases are attributed to that click.
- **Example value**: `?msclkid=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d` (32 hex characters is the common shape)
- **Confidence**: **documented**.
- **Sources**: https://help.ads.microsoft.com/apex/index/3/en/60125 (snippet); https://help.ads.microsoft.com/apex/index/3/en/60000 (snippet); Firefox strip list

---

## LinkedIn

### li_fat_id

- **Who adds it**: LinkedIn Ads, on ad landing-page links ("first-party ad tracking").
- **What it is**: LinkedIn's first-party ad tracking ID. Advertisers can send it back to LinkedIn's Conversions API as the ID type `LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID`.
- **What it gives away**: Ties the visit to the LinkedIn member's ad click, so the advertiser and LinkedIn can match later conversions to that member.
- **Example value**: `?li_fat_id=3c2f1e0d-4b5a-4c3d-8e9f-0a1b2c3d4e5f` (UUID shape)
- **Confidence**: The ID type is **documented**. That the URL parameter is named `li_fat_id` is **widely reported** (I did not find the name in the page I read).
- **Not verified**: LinkClean's claim that it is keyed to the member's email address.
- **Sources**: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api (read); https://linkclean.app/trackers/li-fat-id/ (read, secondary)

### trk

- **Who adds it**: LinkedIn, on links inside LinkedIn, in emails and on public pages.
- **What it is**: A code for the LinkedIn page, module or email the link was clicked from.
- **What it gives away**: Which LinkedIn surface or email sent you.
- **Example value**: `?trk=public_profile_browsemap` or `?trk=eml-email_job_alert_digest_01` (illustrative)
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs `LinkedIn` provider (`trk`, `trackingId`, `refId`, `li[a-z]{2}`); AdGuard specific.txt (`trk`, `/^trk/`, `trackingId`, `refId`, `lipi`)

### rcm

- **Who adds it**: LinkedIn, on post links copied with Share. Usually next to `utm_source=share&utm_medium=member_desktop` (or `member_android`, `member_ios`).
- **What it is**: An undocumented share token.
- **What it gives away**: **Inferred**: identifies the member who shared the link. Values commonly start with `ACoAA`, the same prefix LinkedIn uses for its internal member profile IDs. I did not confirm that the value decodes to the sharer's profile.
- **Example value**: `?utm_source=share&utm_medium=member_android&rcm=ACoAAB1x...` (shape from UntrackLink)
- **Confidence**: Existence: **widely reported**. Meaning: **inferred**.
- **Sources**: https://www.untracklink.com/tracking-parameters/rcm (read, secondary); https://linkclean.app/trackers/li-fat-id/ (mentions rcm)

### trackingId

- **Who adds it**: LinkedIn, on internal links (job postings, profiles, feed items).
- **What it is**: A per-click or per-impression tracking token.
- **What it gives away**: Lets LinkedIn tie the click to the list or recommendation that showed it.
- **Example value**: `?trackingId=x7Yp2QvXSq6m%2Fk3cA9bZ1w%3D%3D` (illustrative)
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs `LinkedIn`; AdGuard specific.txt; https://www.untracklink.com/tracking-parameters/trackingId (read, secondary)

---

## Reddit

### share_id

- **Who adds it**: Reddit app, on links made with Share. It comes with `utm_source=share`, `utm_medium=ios_app` (or android_app, web2x), `utm_name`, `utm_content`, `utm_term`.
- **What it is**: An ID for that one share.
- **What it gives away**: Ties every click on the link back to the person and device that shared it (**inferred** from it being unique per share).
- **Example value**: `?share_id=4Zjm4_WlLJMCMT2L8PsuF&utm_content=1&utm_medium=ios_app&utm_name=iossmf&utm_source=share&utm_term=1` (`share_id` value is real, from AdguardFilters issue 191029)
- **Confidence**: **widely reported**.
- **Sources**: AdGuard specific.txt; ClearURLs `reddit`; https://linkclean.app/trackers/share-id/ (read, secondary)

### rdt

- **Who adds it**: Reddit, during a redirect when you arrive on reddit.com.
- **What it is**: A short number added to the URL.
- **What it gives away**: Purpose **not verified**. Filter lists strip it.
- **Caveat**: Stripping it at request time caused reload loops in Chromium, so AdGuard limits that rule to Firefox.
- **Example value**: `?rdt=51234` (illustrative)
- **Confidence**: Existence: **widely reported**. Meaning: **not verified**.
- **Sources**: https://github.com/AdguardTeam/AdguardFilters/issues/191029 (read via API); ClearURLs `reddit`

### ref_source, ref_campaign, ref=share, correlation_id, $deep_link, $3p, _branch_match_id (Reddit extras)

- **What it is**:
  - The web share button uses `ref=share&ref_source=link`.
  - `correlation_id` names the request that made the link.
  - `$deep_link` and `$3p` look like Branch deep-link data. Reddit app links go through `reddit.app.link`, a Branch domain. This is **inferred**, and the meaning of `$3p` is **not verified**.
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs `reddit`; AdGuard specific.txt; https://linkclean.app/trackers/share-id/

---

## Amazon

### tag

- **Who adds it**: Amazon Associates (affiliate) publishers, in links to Amazon.
- **What it is**: The affiliate's Associates ID ("the unique ID that is used to identify your Associates account").
- **What it gives away**: Which affiliate gets paid a commission if you buy. It identifies the link's publisher, not you.
- **Note**: Removing it removes the affiliate's commission. Whether StopTrackingMe strips affiliate tags is a product decision.
- **Example value**: `https://www.amazon.com/dp/B000IB9QXI/ref=nosim?tag=example-20` (Amazon's own format)
- **Confidence**: **documented**.
- **Sources**: https://affiliate-program.amazon.com/help/node/topic/GP38PJ6EUR6PFBEC (read)

### ref, ref_ and the /ref= path segment

- **Who adds it**: Amazon itself, on almost every internal link. Either as a query parameter (`ref_=nav_logo`) or as a path segment (`/dp/B07WNXS613/ref=sr_1_4`).
- **What it is**: Amazon's internal referral code naming the page, widget and position you clicked.
- **What it gives away**: How you found the product. For example `sr_1_4` reads as search results, item 4 (**inferred** from the pattern). Associates links use `ref=nosim` in Amazon's own example.
- **Example value**: `/ref=sr_1_4`, `?ref_=ast_sto_dp`
- **Confidence**: **widely reported**. The meaning of each code is **inferred**.
- **Sources**:
  - ClearURLs `amazon` (rule `ref_?` and raw rule `\/ref=[^/?]*`)
  - DandelionSprout list line 2002 (real `/ref=sr_1_4_mod_primary_new` example)
  - Amazon Associates help page above (`ref=nosim`)

### pf_rd_* (pf_rd_p, pf_rd_r, pf_rd_s, pf_rd_t, pf_rd_i, pf_rd_m)

- **Who adds it**: Amazon, on links from page widgets and recommendation slots.
- **What it is**: "Page frame" recommendation data (**inferred** expansion). Placement ID, request ID, slot, page type, and so on.
- **What it gives away**: The exact page slot and request that showed you the item. The request ID can tie the click to your browsing session.
- **Example value**: `&pf_rd_r=8XK2M3N4P5Q6R7S8T9V0&pf_rd_p=5a6b7c8d-1e2f-3a4b-5c6d-7e8f9a0b1c2d`
- **Confidence**: **widely reported** (stripped by ClearURLs rule `p[fd]_rd_[a-z]*`). Meanings are **inferred**.
- **Sources**: ClearURLs `amazon`

### pd_rd_* (pd_rd_w, pd_rd_wg, pd_rd_r, pd_rd_i)

- **Who adds it**: Amazon, on links from product-page recommendation carousels ("customers also bought").
- **What it is**: Recommendation widget and request data.
- **What it gives away**: Which recommendation widget and request led you there.
- **Example value**: `&pd_rd_w=Ab1Cd&pd_rd_wg=Ef2Gh&pd_rd_r=1a2b3c4d-...&pd_rd_i=B0XXXXXXXX`
- **Confidence**: **widely reported**. Meanings are **inferred**.
- **Sources**: ClearURLs `amazon`

### crid, sprefix, qid, sr, keywords (Amazon search tags)

- **Who adds it**: Amazon, on product links clicked from search results.
- **What it is**:
  - `keywords` (also `k`): your search words.
  - `sprefix`: what you had typed when you picked an autocomplete suggestion, plus the department and a number. Example: `sprefix=wireless+hea%2Caps%2C183`.
  - `qid`: a number that matches Unix time, i.e. when you searched (**inferred** from the values).
  - `sr`: your position in the results, for example `sr=8-4` (**inferred**).
  - `crid`: an ID for the search request or session (**inferred**).
- **What it gives away**: What you searched for and even what you started typing, when you searched, and which result you clicked. If you share a product link copied from search results, the recipient sees your search terms in it.
- **Example value**: `?crid=2M3N4P5Q6R7S8&keywords=wireless+headphones&qid=1731900000&sprefix=wireless+hea%2Caps%2C183&sr=8-4`
- **Confidence**: That Amazon adds them: **widely reported** (ClearURLs strips `qid`, `srs?`, `sprefix`, `crid`, `keywords`). The decoding of each value is **inferred**.
- **Sources**: ClearURLs `amazon`

### Other Amazon extras

- `linkCode`, `creativeASIN`, `ascsubtag`, `camp`, `creative`: affiliate link details.
- `smid`: seller ID. `th`, `psc`: variant selection, which can be functional.
- `dib`, `dib_tag`, `dchild`, `content-id`, `social_share`.
- **Sources**: ClearURLs `amazon` rules list

---

## eBay

### mkevt, mkcid, mkrid, campid (eBay Partner Network)

- **Who adds it**: eBay Partner Network (affiliate) links, and eBay's own share links.
- **What it is** (eBay docs):
  - `mkevt`: tracking event type (1 = click, 2 = impression, 3 = viewable impression).
  - `mkcid`: channel ID.
  - `mkrid`: rotation ID for the target marketplace (for example `711-53200-19255-0` for the US site).
  - `campid`: "the unique EPN campaign ID assigned to the eBay partner".
  - Also `toolid` (which link tool made it) and `customid` (the partner's own sub ID).
- **What it gives away**: Which affiliate or partner sent you and gets paid. `customid` can carry whatever the partner wants, including their own user IDs.
- **Example value**: `?mkevt=1&mkcid=1&mkrid=710-53481-19255-0&campid=1234567890&toolid=10050&customid=abc123` (eBay's own example)
- **Confidence**: **documented**.
- **Sources**: https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html (read)

### amdata

- **Who adds it**: eBay Partner Network priority-listing links.
- **What it is**: An encrypted payload (`enc:...`) from eBay's feed, appended to affiliate URLs to track priority listings.
- **What it gives away**: Affiliate and listing attribution data (encrypted, so contents are unknown).
- **Example value**: `&amdata=enc%3AAQAFAAAAkB1DmsmXf...` (eBay's own example, truncated)
- **Confidence**: **documented**.
- **Sources**: https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html (read)

### _trksid

- **Who adds it**: eBay, on internal links.
- **What it is**: A page, module and link tracking code.
- **What it gives away**: Which eBay page and widget you clicked from.
- **Example value**: `?_trksid=p2047675.m570.l1313` (illustrative, common shape)
- **Confidence**: **widely reported**. Meaning is **inferred**.
- **Caveat**: AdGuard only strips it on `/str` pages after a breakage report (uAssets issue 25247).
- **Sources**: ClearURLs `ebay`; AdGuard specific.txt

### _trkparms

- **Who adds it**: eBay, on links from recommendation modules and search.
- **What it is**: A long URL-encoded bundle of tracking key/value pairs (module, algorithm, placement IDs).
- **What it gives away**: Which recommendation or search module showed you the item, and related IDs.
- **Example value**: `&_trkparms=amclksrc%3DITM%26aid%3D1110006%26algo%3DHOMESPLICE.SIM...`
- **Confidence**: **widely reported**.
- **Sources**: ClearURLs `ebay`; AdGuard specific.txt

### hash

- **Who adds it**: eBay, on item links (for example `hash=item3f5a1b2c3d:g:AbCdEfGh`).
- **What it is**: An item and image reference code.
- **What it gives away**: Little personal information. It is treated as tracking clutter.
- **Confidence**: **widely reported** (ClearURLs, AdGuard strip it). Meaning is **not verified**.
- **Sources**: ClearURLs `ebay`; AdGuard specific.txt

### ssspo, sssrc, ssuid (eBay share tags, extra)

- **What it is**: Seen on links made with eBay's Share button. `ssuid` reads as "share user ID" (**inferred**).
- **Confidence**: **widely reported** (AdGuard strips them on www.ebay.*).
- **Sources**: AdGuard specific.txt

---

## AliExpress (Alibaba)

### spm

- **Who adds it**: Alibaba sites (AliExpress, Taobao, Tmall, 1688, Lazada).
- **What it is**: Alibaba's "Super Position Model" code. A dotted string naming site, page, module and click position.
- **What it gives away**: The exact page area and position you clicked. That reveals how the link was found or shared, not who you are.
- **Example value**: `?spm=a2g0o.productlist.main.1.5c4f1d4eXyz`
- **Confidence**: **widely reported** (ClearURLs globalRules, AdGuard aliexpress rules).
- **Sources**: https://linkclean.app/trackers/spm/ (read, secondary); ClearURLs globalRules; AdGuard specific.txt

### scm (and scm_id, scm-url)

- **Who adds it**: AliExpress, Taobao and Lazada, on recommendation links.
- **What it is**: A recommendation or content tracking code that goes with `spm` (**inferred**).
- **What it gives away**: Which recommendation algorithm or slot showed you the item.
- **Example value**: `&scm=1007.40196.394786.0`
- **Confidence**: **widely reported**. Meaning is **inferred**.
- **Sources**: ClearURLs `aliexpress` (`scm[_a-z-]*`); AdGuard specific.txt

### algo_pvid, algo_expid (algo_exp_id)

- **Who adds it**: AliExpress search and recommendation results.
- **What it is**: The recommendation algorithm's page-view ID and experiment ID (**inferred** from the names).
- **What it gives away**: Which search page view and which A/B test variant you were in. The page-view ID can tie the click to your session.
- **Example value**: `&algo_pvid=3f2e1d0c-...&algo_expid=3f2e1d0c-...-0`
- **Confidence**: **widely reported**. Meaning is **inferred**.
- **Sources**: ClearURLs `aliexpress`; AdGuard specific.txt

### aff_platform, aff_trace_key, aff_fcid, aff_fsk, terminal_id (AliExpress affiliate, extra)

- **What it is**: AliExpress affiliate tracking (which affiliate, which device or terminal).
- **Confidence**: **widely reported**.
- **Sources**: AdGuard specific.txt; ClearURLs `aliexpress`

---

## Priority 2: email and marketing automation

### mc_cid (Mailchimp)

- **Who adds it**: Mailchimp, on links in campaign emails.
- **What it is**: "The Mailchimp ID for the campaign that generated the link."
- **What it gives away**: Which email campaign you clicked from.
- **Example value**: `?mc_cid=3a4b5c6d7e`
- **Confidence**: **documented**.
- **Sources**: https://mailchimp.com/developer/marketing/docs/e-commerce/ (read)

### mc_eid (Mailchimp)

- **Who adds it**: Mailchimp, on links in campaign emails.
- **What it is**: "A unique Mailchimp ID that identifies the recipient's email address."
- **What it gives away**: The recipient's identity. Mailchimp documents that the store can look up the subscriber's email address from it via the API. If you forward the email, the recipient's clicks count as yours.
- **Example value**: `?mc_eid=18d3c1adfe` (Mailchimp's own example)
- **Confidence**: **documented**.
- **Sources**: https://mailchimp.com/developer/marketing/docs/e-commerce/ (read); Firefox strip list

### mkt_tok (Marketo / Adobe)

- **Who adds it**: Marketo, on links in marketing emails.
- **What it is**: A per-recipient tracking token.
- **What it gives away**: Which lead or contact clicked (ties the click to your record in the sender's CRM).
- **Example value**: `?mkt_tok=MTIzLUFCQy00NTYAAAGX...` (long base64)
- **Confidence**: **widely reported** (Firefox strip list, AdGuard "Marketo email tracking"). Brave strips it except on unsubscribe and emailWebview pages, where it is needed.
- **Sources**: Firefox strip list; AdGuard general_url.txt; brave-core `components/query_filter/browser/utils.cc` (read; the exception list)

### _hsenc, _hsmi (HubSpot email)

- **Who adds it**: HubSpot, on links in marketing emails.
- **What it is**: `_hsenc` is an encoded per-contact token. `_hsmi` is the email (message) ID.
- **What it gives away**: `_hsenc` ties the click to your contact record. `_hsmi` says which email it was.
- **Example value**: `?_hsenc=p2ANqtz-_aBcDeF...&_hsmi=89123456`
- **Confidence**: **widely reported** (Firefox strip list has `_hsenc`; AdGuard cites HubSpot's ad tracking page). The per-field meaning comes from secondary sources.
- **Sources**: Firefox strip list; AdGuard general_url.txt; https://linkclean.app/trackers/hsenc/ (read, secondary)

### hsCtaTracking (HubSpot)

- **Who adds it**: HubSpot call-to-action buttons.
- **What it is**: Identifies the CTA (and variant) that was clicked.
- **What it gives away**: Which button or campaign element you clicked.
- **Example value**: `?hsCtaTracking=1a2b3c4d-...%7C5e6f7a8b-...`
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list (`hsctatracking`); ClearURLs globalRules

### hsa_* (HubSpot ads)

- **Who adds it**: HubSpot's ad tracking template, on ads it manages (Google, Facebook, LinkedIn, Microsoft).
- **What it is**: Ad details:
  - `hsa_acc` (ad account)
  - `hsa_cam` (campaign)
  - `hsa_grp` (ad group)
  - `hsa_ad` (creative)
  - `hsa_kw` (keyword)
  - `hsa_mt` (match type)
  - `hsa_net` (network)
  - `hsa_src` (source network)
  - `hsa_tgt` (target)
  - `hsa_ver`
- **What it gives away**: Which exact ad, keyword and campaign you clicked.
- **Example value**: `?hsa_acc=1234567890&hsa_cam=111&hsa_grp=222&hsa_ad=333&hsa_net=adwords&hsa_ver=3`
- **Confidence**: **documented**.
- **Sources**: https://knowledge.hubspot.com/ads/track-and-report-on-google-ads-in-hubspot (read); https://knowledge.hubspot.com/ads/ad-tracking-in-hubspot (read)

### _kx (Klaviyo)

- **Who adds it**: Klaviyo email and SMS.
- **What it is**: A per-recipient tracking token.
- **What it gives away**: Which subscriber clicked.
- **Example value**: `?_kx=Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8.XyZ123`
- **Confidence**: **widely reported** (DandelionSprout cites Klaviyo help article 115005076767).
- **Sources**: DandelionSprout list line 955; https://linkclean.app/trackers/kx/ (read, secondary)

### vero_id, vero_conv (Vero)

- **Who adds it**: Vero email.
- **What it is**: `vero_id` is a subscriber ID. `vero_conv` is a conversion token.
- **What it gives away**: Which subscriber clicked.
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list (`vero_id`); ClearURLs globalRules; AdGuard general_url.txt

### oly_anon_id, oly_enc_id, rb_clickid (Omeda Olytics)

- **Who adds it**: Omeda's Olytics, on publisher and newsletter links.
- **What it is**: Anonymous or encrypted reader IDs, and a click ID.
- **What it gives away**: Which reader clicked.
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list (`oly_anon_id`, `oly_enc_id`); AdGuard general_url.txt ("Olytics")

### __s (Drip)

- **Who adds it**: Drip email.
- **What it is**: A subscriber token.
- **What it gives away**: Which subscriber clicked.
- **Caveat**: Generic name. AdGuard only strips values of 6 or more alphanumeric characters because some sites use `__s` functionally.
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list; AdGuard general_url.txt (cites help.drip.com article 4424695632269)

### ml_subscriber, ml_subscriber_hash (MailerLite, extra)

- **Confidence**: **widely reported**.
- **Sources**: ClearURLs globalRules; AdGuard (cites brave-browser issue 17507)

## Priority 2: click IDs from other ad networks

### yclid (Yandex)

- **Who / what**: Yandex Direct (ads) click ID.
- **Gives away**: Ties the visit to a Yandex ad click.
- **Example**: `?yclid=1234567890123456789`
- **Confidence**: **widely reported**. The Yandex help page did not load for me.
- **Sources**: Firefox strip list; AdGuard ("Yandex Metrika"); ClearURLs globalRules

### ysclid (Yandex)

- **Who / what**: Yandex, on links clicked from Yandex search and Yandex services.
- **Gives away**: Ties the click to a Yandex session.
- **Example**: `?ysclid=lq2w3e4r5t123456789`
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list; AdGuard general_url.txt

### epik (Pinterest)

- **Who / what**: Pinterest, on outbound clicks from pins and ads. Read by the Pinterest Tag for attribution.
- **Gives away**: Ties the visit to the Pinterest click.
- **Example**: `?epik=dj0yJnU9...`
- **Confidence**: **widely reported**.
- **Sources**: DandelionSprout list line 1281; https://linkclean.app/trackers/epik/ (read, secondary)

### wickedid (Wicked Reports)

- **Who / what**: Wicked Reports, a marketing attribution service. Click ID.
- **Gives away**: Ties the visit to a tracked ad click.
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list; AdGuard ("Wicked Reports click tracking")

### _openstat (Openstat)

- **Who / what**: Openstat, an analytics and ad tracker on Russian-language sites. Campaign or click marker.
- **Confidence**: **widely reported**.
- **Sources**: Firefox strip list; ClearURLs globalRules

### sc_cid

- **Not verified**: I did not find a source tying `sc_cid` to a vendor. Snap's click ID appears in AdGuard and LinkClean as `ScCid` / `sc_click_id`, a different name.

## Priority 2: analytics suites

### pk_* (pk_campaign, pk_kwd, pk_source, pk_medium, pk_vid)

- **Who / what**: Matomo (formerly Piwik) campaign parameters, older names. `pk_vid` carries a visitor ID (AdGuard).
- **Gives away**: The campaign. `pk_vid` gives away the visitor.
- **Confidence**: **documented** (Matomo: "pk_ parameters remain supported for backwards compatibility").
- **Sources**: https://matomo.org/faq/how-to/faq_120/ (read)

### mtm_* (mtm_campaign, mtm_kwd, mtm_source, mtm_medium, mtm_content, mtm_cid, mtm_group, mtm_placement)

- **Who / what**: Matomo's current recommended campaign parameters.
- **Gives away**: The campaign and keyword.
- **Confidence**: **documented**.
- **Sources**: https://matomo.org/faq/how-to/faq_120/ (read)

### matomo_* (matomo_campaign, matomo_kwd)

- **Who / what**: Alternate Matomo campaign names, also read by default.
- **Confidence**: **documented**.
- **Sources**: https://matomo.org/faq/how-to/faq_120/ (read)

### s_cid (Adobe Analytics)

- **Who / what**: A conventional query parameter for Adobe Analytics "tracking codes" (campaign IDs). Each company picks the name; `s_cid` is the common default.
- **Gives away**: The campaign.
- **Confidence**: **documented** that Adobe reads tracking codes from a query string the company chooses. The exact name `s_cid` is **widely reported**.
- **Sources**: https://experienceleague.adobe.com/en/docs/analytics/components/dimensions/tracking-code (read); AdGuard ("Adobe SiteCatalyst Campaign Tracking ID parameter")

### xtor (AT Internet / Piano Analytics)

- **Who / what**: Campaign tracking parameter.
- **Example**: `?xtor=EREC-123-[newsletter]`
- **Confidence**: **widely reported** (AdGuard cites AT Internet developer docs).
- **Sources**: AdGuard general_url.txt

### wt_mc, wt_zmc (Webtrekk / Mapp)

- **Who / what**: Mapp (formerly Webtrekk) campaign parameters.
- **Confidence**: **widely reported** (AdGuard cites documentation.mapp.com "URL Campaign Mapper").
- **Sources**: AdGuard general_url.txt; ClearURLs globalRules `wt_?z?mc`; DandelionSprout list line 4672

### ns_* (ns_source, ns_mchannel, ns_campaign, ns_linkname, ns_fee)

- **Who / what**: Campaign parameters, notably on BBC links. **Inferred**: from comScore's analytics, formerly Nedstat ("ns").
- **Confidence**: That they are tracking tags: **widely reported**. Vendor attribution: **inferred**.
- **Sources**: DandelionSprout list lines 407 to 411; AdGuard specific.txt (bbc.com rules)

### mbid (Conde Nast)

- **Who / what**: Campaign label on Conde Nast sites (Wired, New Yorker), for example `mbid=social_twitter`.
- **Gives away**: Which social channel the link was posted on.
- **Confidence**: **widely reported**. The publisher attribution is **inferred** from examples.
- **Sources**: DandelionSprout list line 315

### cmpid

- **Who / what**: A generic "campaign ID" used by many sites.
- **Gives away**: The campaign.
- **Confidence**: **widely reported**. AdGuard excludes it from its MV3 extension rules because of breakage.
- **Sources**: ClearURLs globalRules; AdGuard general_url.txt

## Priority 2: affiliate networks

### irclickid, irgwc (Impact)

- **Who / what**: impact.com. `irclickid` is a click ID the shop is told to capture and store. `irgwc=1` comes with it.
- **Gives away**: Brave's assessment (quoted by LinkClean): random, not tied to identity, but "meant to be used as a stable identifier to recognize a single user across different pages".
- **Example**: `?irclickid=QQD2zbykJxyPTmGz47wiYyUCUkFQ2fRt028z140&irgwc=1` (real example quoted by LinkClean)
- **Confidence**: **widely reported**.
- **Sources**: https://linkclean.app/trackers/irclickid/ (read, secondary); AdGuard general_url.txt

### ranMID, ranEAID, ranSiteID (Rakuten Advertising)

- **Who / what**: Rakuten affiliate links. **Inferred** expansions: merchant ID, encrypted affiliate ID, and the affiliate's site ID.
- **Gives away**: Which affiliate sent you.
- **Confidence**: That they are Rakuten tags: **widely reported**. Expansions: **inferred**.
- **Sources**: AdGuard general_url.txt ("Rakuten")

### zanpid (Zanox, now Awin)

- **Who / what**: Affiliate click ID.
- **Confidence**: **widely reported**. The vendor attribution is from common knowledge and not verified in this pass.
- **Sources**: DandelionSprout list line 412

### clickid, aff_*

- **Who / what**: Generic names used by many affiliate and ad networks for a click ID or affiliate details.
- **Caveat**: Too generic to strip everywhere. AdGuard only strips `clickid` when it appears next to `rtkcid`.
- **Confidence**: **widely reported** as generic tracking names.
- **Sources**: AdGuard general_url.txt

### _trk* (for example _trksid, _trkparms, trk, trkInfo)

- **Who / what**: Generic "tracking" prefix used by several sites (eBay, LinkedIn).
- **Caveat**: There is no single vendor. Handle per site.
- **Sources**: ClearURLs; AdGuard

## Priority 2: deep-link and app attribution services

### _branch_match_id (Branch)

- **Who / what**: Branch (deep-linking service) appends it after a Branch link click. Branch's web SDK reportedly describes it as "the current user's browser-fingerprint-id".
- **Gives away**: An ID for your browser at Branch.
- **Example**: `?_branch_match_id=1234567890123456789`
- **Confidence**: **widely reported**. The SDK quote comes via LinkClean; I could not open the SDK doc myself.
- **Sources**: https://linkclean.app/trackers/branch-match-id/ (read, secondary); AdGuard general_url.txt (cites stackoverflow.com/questions/37882810)

### _branch_referrer (Branch)

- **Who / what**: Branch. A gzip-compressed, base64-encoded value.
- **Gives away**: Which Branch short link sent you. Decoding the real example in the DandelionSprout list gives `https://slyb.app.link/SKdyQ6A449` (my decoding).
- **Example**: `?_branch_referrer=H4sIAAAAAAAAA8soKSkottLXL86pTNJLLCjQy8nMy9YP9k6pDDRzNDGxBABVqlN1IAAAAA%3D%3D` (real, from DandelionSprout list line 915)
- **Confidence**: **documented by decoding** (verified).
- **Sources**: DandelionSprout list line 915

### $deep_link, $3p

- **Who / what**: Branch-style link data keys seen on Reddit links (`%24deep_link`, `%243p`).
- **Gives away**: **Not verified**. `$3p` likely names the third-party channel.
- **Confidence**: That they are stripped: **widely reported**. Meaning: **not verified**.
- **Sources**: ClearURLs `reddit`; AdGuard specific.txt

## Priority 2: Pinterest share tags

### invite_code, sender, sender_id, mt, sfo

- **Who / what**: Pinterest app share links.
  - `invite_code`: reportedly a referral code linking the click to the person who shared.
  - `sender` / `sender_id`: reportedly the sharer.
  - `mt` and `sfo`: meaning not found.
- **Example**: `https://www.pinterest.com/pin/1234567890123456789/?invite_code=xyz&sender=abc123` (shape from UntrackLink)
- **Confidence**: `invite_code` and `sender`: **widely reported** (secondary only). `mt` and `sfo`: **not verified**. I found no filter-list rules for them in ClearURLs or AdGuard.
- **Sources**: https://www.untracklink.com/tracking-parameters/invite_code (read, secondary)

---

## Redirect wrappers, short links and text fragments

### Redirect wrappers

A wrapper is a link to the platform's own redirect page that carries the real destination inside it as a parameter. When you click, the platform logs the click (who, when, from where), checks the destination, and then forwards you. Because the destination is inside the URL, a browser-only tool can unwrap it locally with no network request. It decodes the inner parameter and drops the rest.

- **Facebook link shim**: `https://l.facebook.com/l.php?u=<percent-encoded destination>&h=<token>`, also `lm.facebook.com`.
  - `u` is the destination.
  - `h` is a token Facebook adds, widely reported to tie the redirect to the session that saw the link. **Not verified** in Meta docs this pass.
  - Facebook also adds `fbclid` to the destination.
  - ClearURLs unwraps this pattern: `^https?://l[a-z]?\.facebook\.com/l\.php\?.*?u=(https?%3A%2F%2F[^&]*)`.
- **Instagram**: `l.instagram.com/?u=<destination>` (ClearURLs `instagram` redirection `.*u=([^&]*)`).
- **Google**: `https://www.google.com/url?q=<destination>` (or `url=`), used by Gmail, Google Docs and some search results.
  - Extra parameters such as `sa`, `ved`, `usg` and `ei` are Google's click-logging fields. `usg` is widely reported as a signature over the URL.
  - ClearURLs also unwraps `adurl=` (ad clicks) and `/amp/s/` AMP links.
- **YouTube**: `youtube.com/redirect?q=<destination>` (links in video descriptions).
- **Reddit**: `out.reddit.com/...?url=` and `click.redditmail.com/...?url=`.
- **LinkedIn**: `linkedin.com/redir/redirect?url=` and `linkedin.com/safety/go?url=`.
- **X**: `twitter.com/i/redirect?url=...`, used in email. It carried `uid`, `sig`, `cn` in a reported example.
- **eBay**: `rover.ebay.*/rover/...mpre=<destination>`.
- **Rakuten**: `linksynergy.com/...murl=<destination>`.
- **Sources**:
  - ClearURLs data.min.json `redirections` fields for facebook, instagram, google, youtube, reddit, LinkedIn, ebay, linksynergy.com (read)
  - https://gitlab.com/ClearURLs/rules/-/work_items/277 (X email redirect, read)

### Short links (t.co, bit.ly, amzn.to and path-based share links)

- A short link like `https://t.co/AbC123xyz` contains only a random code. The real destination is stored only on the shortener's server.
- The only way to learn the destination is to ask that server (an HTTP request). That request is itself a tracked click: the shortener sees your IP address, time and browser.
- X says its link service "measures information such as how many times a link has been clicked". All links posted on X, including in DMs, are wrapped in t.co, and users "cannot opt out of link shortening". X also notes that bit.ly's click metrics keep working when bit.ly links are posted on X.
- `amzn.to` is Amazon's shortener for Associates links. The destination usually carries the affiliate `tag`.
- **Technical constraint for a browser-only tool (Fetch standard)**: a web page cannot quietly read where a short link points. A cross-origin `fetch` is subject to CORS. With `redirect: "manual"` the browser returns an "opaqueredirect" response with no readable `Location` header. Expanding therefore needs either a server-side helper or opening the link, and both contact the shortener.
- **Path-based share links**: some platforms now put the share ID in the path instead of the query, for example:
  - `reddit.com/r/<sub>/s/<code>`
  - `facebook.com/share/p/<code>/`
  - `vm.tiktok.com/<code>`
  - `spotify.link/<code>`

  These behave like short links. Nothing can be stripped locally, because the whole path is the token. That these encode the sharer is **not verified** in this pass.
- **Sources**:
  - https://help.x.com/en/using-x/url-shortener (read)
  - https://github.com/ganeshmshetty/openclip-extensions/pull/81 (read: "Expanding t.co / bit.ly needs a network request")

### Text fragments (`#:~:text=`)

- **What it is**: A browser feature (WICG "URL Fragment Text Directives", supported in Chrome, Edge, Safari and Firefox) that makes a link scroll to and highlight specific words on the page. The syntax is `https://example.com/page#:~:text=[prefix-,]textStart[,textEnd][,-suffix]`. Chrome's "Copy link to highlight" creates them, and Google Search adds them when you click a featured snippet.
- **Why it leaks**: The highlighted words are written in plain text, percent-encoded, in the link. Anyone you send the link to, and any app or chat service that previews or stores it, can read exactly which passage you selected. That can reveal what you were focused on or searching for.
- **What it does not leak**: The part after `#` is not sent to the website's server in the HTTP request. Per the spec, the directive "is stripped from script-accessible APIs to prevent interaction with author script", so the page's own JavaScript cannot read it from `location`.
- **Example**: `https://en.wikipedia.org/wiki/Privacy#:~:text=right%20to%20be%20let%20alone`
- **Confidence**: **documented**.
- **Sources**:
  - https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments (read)
  - https://wicg.github.io/scroll-to-text-fragment/ (read)

---

## Summary of what remains unverified

- X `a=`: what it encodes and whether it is unique per copy. X has said nothing, and all reports describe only its presence and position.
- X `t=`: whether it is an encoded user ID (2022 claim) or a session token (LinkClean). X never documented it.
- X `cn`: exact meaning.
- Facebook `mibextid`, `__cft__`, `__tn__`, link-shim `h`: meanings are undocumented.
- Instagram's newer share names: that they are the same token as `igsh` is inferred.
- YouTube `pp`: whether it can contain search words.
- LinkedIn `rcm`: whether it decodes to the sharer's profile ID.
- Reddit `rdt`, `$3p`: purpose.
- Pinterest `mt`, `sfo`: purpose.
- Amazon search tags: the decoding of `qid`, `sr`, `crid` is inferred from value shapes.
- `sc_cid`: no vendor found.
