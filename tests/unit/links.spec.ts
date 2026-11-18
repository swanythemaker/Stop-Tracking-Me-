import { expect, test } from "@playwright/test";
import { cleanLink, cleanText } from "../../src/links/clean";

const cases: [string, string, string][] = [
  ["generic utm and click ids", "https://example.com/post?id=7&utm_source=fb&utm_medium=social&fbclid=IwAR0abc&gclid=x1", "https://example.com/post?id=7"],
  ["amazon product to canonical", "https://www.amazon.de/Some-Long-Product-Name/dp/b0c1h26c46/ref=sr_1_3?crid=2X&keywords=kabel&qid=1700000000&sr=8-3&tag=affil-21", "https://www.amazon.de/dp/B0C1H26C46"],
  ["amazon gp/product", "https://www.amazon.com/gp/product/B08N5WRWNW?pf_rd_r=ABC&pd_rd_w=xyz", "https://www.amazon.com/dp/B08N5WRWNW"],
  ["amazon search keeps the query", "https://www.amazon.com/s?k=usb+cable&crid=3AB&sprefix=usb%2Caps%2C200&ref=nb_sb_noss_1", "https://www.amazon.com/s?k=usb+cable"],
  ["ebay item to canonical", "https://www.ebay.com/itm/125984623541?_trkparms=amclksrc%3DITM&_trksid=p2047675.c100005&itmmeta=01HX&hash=item1d55&amdata=enc%3A1", "https://www.ebay.com/itm/125984623541"],
  ["ebay item keeps the variant", "https://www.ebay.de/itm/Some-Title/325412345678?var=514512345678&mkevt=1&mkcid=1", "https://www.ebay.de/itm/325412345678?var=514512345678"],
  ["facebook wrapper unwrapped", "https://l.facebook.com/l.php?u=https%3A%2F%2Fnews.example.org%2Fstory%3Futm_source%3Dfacebook%26fbclid%3DIwAR1&h=AT0abc", "https://news.example.org/story"],
  ["facebook post", "https://www.facebook.com/permalink.php?story_fbid=123&id=456&__cft__[0]=AZW&__tn__=%2CO%2CP-R&mibextid=Nif5oz", "https://www.facebook.com/permalink.php?story_fbid=123&id=456"],
  ["instagram share", "https://www.instagram.com/p/C1abcDEF/?igsh=MWQ1ZGUxMzBkMA==&utm_source=ig_web_copy_link", "https://www.instagram.com/p/C1abcDEF/"],
  ["x share", "https://x.com/someone/status/1790000000000000000?s=46&t=AbCdEfGhIjKlMnOp", "https://x.com/someone/status/1790000000000000000"],
  ["x share with the new a tag", "https://x.com/fromcodetocloud/status/2123062312617804096?a=arMamaA1lWeuSqriZFw&s=20", "https://x.com/fromcodetocloud/status/2123062312617804096"],
  ["x post with a tag nobody knows yet", "https://x.com/someone/status/1790000000000000000/photo/1?zz9=abc", "https://x.com/someone/status/1790000000000000000/photo/1"],
  ["youtube drops tags nobody knows yet", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&newtrk=Zz1&list=PL1", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1"],
  ["youtube shorts", "https://youtube.com/shorts/abcDEF12345?si=Ab12&feature=share", "https://youtube.com/shorts/abcDEF12345"],
  ["linkedin post drops tags nobody knows yet", "https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000000/?updateEntityUrn=x&newtrk=1", "https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000000/"],
  ["twitter share", "https://twitter.com/someone/status/1?ref_src=twsrc%5Etfw", "https://twitter.com/someone/status/1"],
  ["tiktok share", "https://www.tiktok.com/@someone/video/7300000000000000000?is_from_webapp=1&sender_device=pc&_r=1&_t=8abc", "https://www.tiktok.com/@someone/video/7300000000000000000"],
  ["youtube keeps time and playlist", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1&si=Ab12Cd34&feature=shared&pp=ygU", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1"],
  ["youtu.be share", "https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd34", "https://youtu.be/dQw4w9WgXcQ"],
  ["spotify share", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=a1b2c3&context=x", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"],
  ["linkedin post", "https://www.linkedin.com/posts/someone_activity-7100000000000000000-abcd?utm_source=share&utm_medium=member_desktop&rcm=ACoAA", "https://www.linkedin.com/posts/someone_activity-7100000000000000000-abcd"],
  ["reddit share", "https://www.reddit.com/r/privacy/comments/abc123/title/?share_id=XyZ&utm_content=2&utm_medium=android_app", "https://www.reddit.com/r/privacy/comments/abc123/title/"],
  ["google redirect unwrapped", "https://www.google.com/url?sa=t&rct=j&q=&esrc=s&url=https%3A%2F%2Fexample.com%2Fa%3Fgclid%3D1&ved=2ah", "https://example.com/a"],
  ["google search keeps the query", "https://www.google.com/search?q=privacy&sca_esv=1&ei=abc&ved=0ahUKE&oq=priv&gs_lp=Egx", "https://www.google.com/search?q=privacy"],
  ["youtube redirect unwrapped", "https://www.youtube.com/redirect?event=video_description&redir_token=QUFF&q=https%3A%2F%2Fshop.example.com%2F%3Futm_campaign%3Dyt&v=abc", "https://shop.example.com/"],
  ["aliexpress item", "https://www.aliexpress.com/item/1005006000000000.html?spm=a2g0o.home&gatewayAdapt=glo2deu&algo_pvid=x", "https://www.aliexpress.com/item/1005006000000000.html"],
  ["etsy listing", "https://www.etsy.com/listing/1234567890/handmade-mug?click_key=abc&ref=hp_rv-2&pro=1&sts=1", "https://www.etsy.com/listing/1234567890"],
  ["text fragment dropped", "https://example.com/article#:~:text=something%20I%20highlighted", "https://example.com/article"],
  ["real anchors stay", "https://example.com/docs?utm_source=x#install", "https://example.com/docs#install"],
];

for (const [name, input, expected] of cases) {
  test(`cleans: ${name}`, () => {
    const r = cleanLink(input)!;
    expect(r.clean).toBe(expected);
    expect(r.removed.length).toBeGreaterThan(0);
  });
}

test("a clean link comes back byte for byte", () => {
  const url = "https://example.com/search?q=a+b&page=2&flag";
  const r = cleanLink(url)!;
  expect(r.clean).toBe(url);
  expect(r.removed).toEqual([]);
});

test("x search keeps its query", () => {
  const url = "https://x.com/search?q=privacy&src=typed_query&f=live";
  expect(cleanLink(url)!.clean).toBe(url);
});

test("unknown parameters on unknown sites are kept", () => {
  expect(cleanLink("https://shop.example/item?id=9&color=red&utm_term=x")!.clean).toBe("https://shop.example/item?id=9&color=red");
});

test("short links are flagged and never fetched", () => {
  for (const url of ["https://t.co/AbCdEf1234", "https://amzn.to/3xYz", "https://bit.ly/abc", "https://vm.tiktok.com/ZMabc/", "https://www.reddit.com/r/privacy/s/AbCdEf"]) {
    expect(cleanLink(url)!.shortLink, url).toBe(true);
  }
  expect(cleanLink("https://example.com/a")!.shortLink).toBe(false);
});

test("removed list names what came off", () => {
  const r = cleanLink("https://l.facebook.com/l.php?u=https%3A%2F%2Fa.example%2F%3Futm_source%3Dfb")!;
  expect(r.removed).toEqual(["redirect through l.facebook.com", "utm_source"]);
});

test("non links are ignored", () => {
  expect(cleanLink("hello")).toBeNull();
  expect(cleanLink("javascript:alert(1)")).toBeNull();
  expect(cleanLink("ftp://example.com/x")).toBeNull();
});

test("cleans every link inside a message and keeps punctuation", () => {
  const msg = "Look at this (https://www.amazon.com/dp/B08N5WRWNW?tag=x-20), and https://youtu.be/abc?si=zz.\nBye";
  const r = cleanText(msg);
  expect(r.text).toBe("Look at this (https://www.amazon.com/dp/B08N5WRWNW), and https://youtu.be/abc.\nBye");
  expect(r.links).toHaveLength(2);
});

test("a pasted address without https is cleaned too", () => {
  expect(cleanText("amazon.com/dp/B08N5WRWNW?tag=x-20").text).toBe("https://amazon.com/dp/B08N5WRWNW");
});

test("brackets that belong to the link stay", () => {
  expect(cleanText("https://en.wikipedia.org/wiki/Mercury_(planet)?utm_source=x").text).toBe("https://en.wikipedia.org/wiki/Mercury_(planet)");
});
