"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createScoreImage } = require("../src/plugin/score-image.js");

function decode(dataUri) {
  return Buffer.from(dataUri.split(",")[1], "base64").toString("utf8");
}

test("createScoreImage returns null when there is nothing to render", () => {
  assert.equal(createScoreImage(""), null);
  assert.equal(createScoreImage("   \n  "), null);
  assert.equal(createScoreImage(undefined), null);
});

test("createScoreImage emits an SVG data URI with every line and no raw markup", () => {
  const dataUri = createScoreImage("Betis vs Sevilla FC\n2-1 FT");
  assert.ok(dataUri.startsWith("data:image/svg+xml;base64,"));
  const svg = decode(dataUri);
  assert.match(svg, /width="196" height="196"/);
  assert.match(svg, /Betis vs Sevilla FC/);
  assert.match(svg, /2-1 FT/);
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;)/);

  const hostile = decode(createScoreImage("<script>&\"'"));
  assert.match(hostile, /&lt;script&gt;&amp;&quot;&apos;/);
});

test("createScoreImage embeds two cached crest images in the match layout", () => {
  const home = "data:image/png;base64,aG9tZQ==";
  const away = "data:image/svg+xml;base64,YXdheQ==";
  const svg = decode(createScoreImage("Real Betis\nReal Madrid\n2 - 1\n2026-09-14", { homeCrest: home, awayCrest: away }));
  assert.match(svg, new RegExp(home));
  assert.match(svg, new RegExp(away.replace("+", "\\+")));
  assert.equal((svg.match(/<image /g) || []).length, 2);
  assert.match(svg, /Real Betis/);
  assert.match(svg, /2 - 1/);
  assert.match(svg, /y="178"[^>]*font-size="19"[^>]*font-weight="700"[^>]*>2026-09-14<\/text>/);
});

test("createScoreImage renders the generic date line larger and explicitly bold", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\n9/14/2026"));
  assert.match(svg, /y="178"[^>]*font-size="19"[^>]*font-weight="700"[^>]*>9\/14\/2026<\/text>/);
});

test("createScoreImage bounds the countdown row with defined typography with and without crests", () => {
  const countdown = "START IN 23:59";
  const generic = decode(createScoreImage(`Home\nAway\n20:00\n${countdown}`));
  assert.match(generic, /x="98" y="178"[^>]*font-family="Arial, sans-serif"[^>]*font-size="19"[^>]*font-weight="700"[^>]*textLength="168" lengthAdjust="spacingAndGlyphs"[^>]*>START IN 23:59<\/text>/);

  const crests = decode(createScoreImage(`Home\nAway\n20:00\n${countdown}`, {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(crests, /x="98" y="178"[^>]*font-family="Arial, sans-serif"[^>]*font-size="19"[^>]*font-weight="700"[^>]*textLength="168" lengthAdjust="spacingAndGlyphs"[^>]*>START IN 23:59<\/text>/);
  assert.equal((crests.match(/<image /g) || []).length, 2);
});

test("createScoreImage bounds long live clock text in the existing lower row", () => {
  const clock = "EXTRA TIME 103+12'";
  const generic = decode(createScoreImage(`Home\nAway\n2 - 2\n${clock}`));
  assert.match(generic, /y="178"[^>]*textLength="168" lengthAdjust="spacingAndGlyphs"[^>]*>EXTRA TIME 103\+12&apos;<\/text>/);

  const crests = decode(createScoreImage(`Home\nAway\n2 - 2\n${clock}`, {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(crests, /y="178"[^>]*textLength="168" lengthAdjust="spacingAndGlyphs"[^>]*>EXTRA TIME 103\+12&apos;<\/text>/);
  assert.equal((crests.match(/<image /g) || []).length, 2);
});

test("createScoreImage ignores non-image crest data", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\n2026-09-14", { homeCrest: "javascript:alert(1)" }));
  assert.doesNotMatch(svg, /<image /);
});

test("createScoreImage preserves supplied LIVE text without adding a duplicate badge", () => {
  const generic = decode(createScoreImage("Home\nAway\n1 - 0\nLIVE", { live: true }));
  assert.equal((generic.match(/>LIVE<\/text>/g) || []).length, 1);
  assert.doesNotMatch(generic, /fill="#d71920"/);
  assert.doesNotMatch(generic, /aria-label="Live"/);
  assert.match(generic, /<text x="98" y="38"[^>]*>Home<\/text>/);
  assert.match(generic, /y="178"[^>]*>LIVE<\/text>/);

  const crests = decode(createScoreImage("Home\nAway\n1 - 0\nLIVE", {
    live: true,
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.equal((crests.match(/>LIVE<\/text>/g) || []).length, 1);
  assert.equal((crests.match(/<image /g) || []).length, 2);
  assert.doesNotMatch(crests, /aria-label="Live"/);
});

test("createScoreImage renders red Goal!! badges on the requested sides", () => {
  const home = decode(createScoreImage("Home\nAway\n9 - 9", { goalSide: "home" }));
  assert.match(home, /aria-label="Home team goal increase"/);
  assert.match(home, /<rect x="4" y="110" width="42" height="22" rx="11" fill="#d71920" stroke="#ffffff" stroke-width="1"\/>(?:<text[^>]*y="125"[^>]*>Goal!!<\/text>)/);
  assert.equal((home.match(/>Goal!!<\/text>/g) || []).length, 1);
  assert.doesNotMatch(home, /Away team goal increase/);
  assert.doesNotMatch(home, /<polygon\b/);

  const awayWithCrests = decode(createScoreImage("Home\nAway\n9 - 9", {
    goalSide: "away",
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(awayWithCrests, /aria-label="Away team goal increase"/);
  assert.match(awayWithCrests, /<rect x="150" y="110" width="42" height="22" rx="11" fill="#d71920" stroke="#ffffff" stroke-width="1"\/>(?:<text[^>]*y="125"[^>]*fill="#ffffff"[^>]*>Goal!!<\/text>)/);
  assert.equal((awayWithCrests.match(/>Goal!!<\/text>/g) || []).length, 1);
  assert.doesNotMatch(awayWithCrests, /Home team goal increase/);
  assert.doesNotMatch(awayWithCrests, /<polygon\b/);
  assert.equal((awayWithCrests.match(/<image /g) || []).length, 2);

  const both = decode(createScoreImage("Home\nAway\n9 - 9\nLIVE", { goalSide: "both", live: true }));
  assert.match(both, /Home team goal increase/);
  assert.match(both, /Away team goal increase/);
  assert.equal((both.match(/>Goal!!<\/text>/g) || []).length, 2);
  assert.equal((both.match(/fill="#d71920"/g) || []).length, 2);
  assert.doesNotMatch(both, /<polygon\b/);
  assert.equal((both.match(/>LIVE<\/text>/g) || []).length, 1);

  for (const goalSide of [null, undefined, "left", "HOME", 1]) {
    const svg = decode(createScoreImage("Home\nAway\n0 - 0", { goalSide }));
    assert.doesNotMatch(svg, /team goal increase/, String(goalSide));
    assert.doesNotMatch(svg, />Goal!!<\/text>/, String(goalSide));
  }
});

test("createScoreImage keeps goal badges outside the centered single-digit score area", () => {
  const svg = decode(createScoreImage("Home\nAway\n9 - 9\nLIVE", { goalSide: "both", live: true }));
  const badges = [...svg.matchAll(/<rect x="(4|150)" y="(110)" width="42" height="22" rx="11" fill="#d71920"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: 42, height: 22 }));
  const [homeBadge, awayBadge] = badges;
  const protectedScoreArea = { left: 48, right: 148 };

  assert.equal(badges.length, 2);
  assert.ok(homeBadge.x + homeBadge.width < protectedScoreArea.left);
  assert.ok(awayBadge.x > protectedScoreArea.right);
  for (const badge of badges) {
    assert.ok(badge.x >= 0 && badge.x + badge.width <= 196);
    assert.ok(badge.y >= 0 && badge.y + badge.height <= 196);
  }
  assert.equal((svg.match(/<text x="(?:25|171)" y="125"[^>]*>Goal!!<\/text>/g) || []).length, 2);
  assert.match(svg, /<text x="98" y="132"[^>]*font-size="40"[^>]*>9 - 9<\/text>/);
  assert.match(svg, /y="178"[^>]*>LIVE<\/text>/);
});

test("createScoreImage keeps at most five meaningful lines", () => {
  const svg = decode(createScoreImage("1\n2\n3\n4\n5\n6\n7"));
  assert.match(svg, />5</);
  assert.doesNotMatch(svg, />6</);
  assert.deepEqual(svg.match(/<text /g).length, 5);
});
