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

test("createScoreImage ignores non-image crest data", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\n2026-09-14", { homeCrest: "javascript:alert(1)" }));
  assert.doesNotMatch(svg, /<image /);
});

test("createScoreImage renders a fixed LIVE badge with and without crests", () => {
  const generic = decode(createScoreImage("Home\nAway\n1 - 0\n9/14/2026", { live: true }));
  assert.match(generic, /fill="#d71920"/);
  assert.match(generic, />LIVE<\/text>/);
  assert.match(generic, /<text x="98" y="55"[^>]*>Home<\/text>/, "generic team text moves below the badge");

  const crests = decode(createScoreImage("Home\nAway\n1 - 0", {
    live: true,
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(crests, />LIVE<\/text>/);
  assert.equal((crests.match(/<image /g) || []).length, 2);
  assert.match(crests, /<rect x="72" y="8" width="52" height="24"/);

  const notLive = decode(createScoreImage("Home\nAway\n1 - 0", { live: false }));
  assert.doesNotMatch(notLive, />LIVE<\/text>/);
});

test("createScoreImage renders bounded amber goal markers on the requested sides", () => {
  const home = decode(createScoreImage("Home\nAway\n1 - 0", { goalSide: "home" }));
  assert.match(home, /aria-label="Home team goal increase"/);
  assert.match(home, /points="8,122 20,111 20,133"/);
  assert.doesNotMatch(home, /Away team goal increase/);

  const awayWithCrests = decode(createScoreImage("Home\nAway\n1 - 1", {
    goalSide: "away",
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(awayWithCrests, /aria-label="Away team goal increase"/);
  assert.match(awayWithCrests, /fill="#ffbf00" stroke="#ffffff"/);
  assert.equal((awayWithCrests.match(/<image /g) || []).length, 2);

  const both = decode(createScoreImage("Home\nAway\n2 - 2", { goalSide: "both", live: true }));
  assert.match(both, /Home team goal increase/);
  assert.match(both, /Away team goal increase/);
  assert.match(both, />LIVE<\/text>/);

  for (const goalSide of [null, undefined, "left", "HOME", 1]) {
    const svg = decode(createScoreImage("Home\nAway\n0 - 0", { goalSide }));
    assert.doesNotMatch(svg, /team goal increase/, String(goalSide));
  }
});

test("createScoreImage keeps at most five meaningful lines", () => {
  const svg = decode(createScoreImage("1\n2\n3\n4\n5\n6\n7"));
  assert.match(svg, />5</);
  assert.doesNotMatch(svg, />6</);
  assert.deepEqual(svg.match(/<text /g).length, 5);
});
