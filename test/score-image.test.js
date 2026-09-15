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

test("createScoreImage renders three exact panels behind crest match content only", () => {
  const crests = decode(createScoreImage("Home\nAway\n0 - 0", {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YWdheQ==",
  }));
  const panelRects = [
    '<rect x="6" y="8" width="88" height="90" rx="10" fill="#223040" stroke="#3d5063" stroke-width="1"/>',
    '<rect x="102" y="8" width="88" height="90" rx="10" fill="#223040" stroke="#3d5063" stroke-width="1"/>',
    '<rect x="6" y="104" width="184" height="48" rx="10" fill="#223040" stroke="#3d5063" stroke-width="1"/>',
  ];
  for (const rect of panelRects) assert.ok(crests.includes(rect));
  assert.equal((crests.match(/fill="#223040"/g) || []).length, 3);
  assert.ok(crests.indexOf(panelRects[2]) < crests.indexOf('<image '));

  const generic = decode(createScoreImage("Home\nAway\n0 - 0"));
  assert.doesNotMatch(generic, /fill="#223040"/);
  assert.doesNotMatch(generic, /(?:Home team|Away team|Score) panel/);
});

test("createScoreImage recenters crest match content on the panel axes", () => {
  const svg = decode(createScoreImage("Real Betis\nReal Madrid\n2 - 1", {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YWdheQ==",
  }));
  assert.match(svg, /<image x="26" y="20" width="48" height="48"/);
  assert.match(svg, /<image x="122" y="20" width="48" height="48"/);
  assert.match(svg, /<text x="50" y="88"[^>]*>Real Betis<\/text>/);
  assert.match(svg, /<text x="146" y="88"[^>]*>Real Madrid<\/text>/);
  assert.match(svg, /<text x="98" y="140"[^>]*font-size="40"[^>]*>2 - 1<\/text>/);
});

test("createScoreImage bounds team names by a conservative width estimate", () => {
  const innerWidth = 80;
  const charWidthFactor = 0.7;
  const renderName = (label) => decode(createScoreImage(`${label}\nBrighton\n0 - 0`, {
    homeCrest: "data:image/png;base64,aG9tZQ==",
  }));
  const teamText = (svg, label) => {
    const match = new RegExp(`<text x="50" y="88"([^>]*)>${label}<\\/text>`).exec(svg);
    assert.ok(match, label);
    return match[1];
  };

  for (const label of ["ABCDEFGHIJ", "WEST HAM UTD", "WOLVES WOMEN", "ABCDEFGHIJKLM"]) {
    const attributes = teamText(renderName(label), label);
    const fontSize = Number(/font-size="(\d+)"/.exec(attributes)[1]);
    const estimated = label.length * fontSize * charWidthFactor;
    assert.equal(fontSize, 12, label);
    assert.ok(estimated > innerWidth, `${label}: ${estimated}`);
    assert.match(attributes, /textLength="80" lengthAdjust="spacingAndGlyphs"/);
    assert.equal(Number(/textLength="(\d+)"/.exec(attributes)[1]), innerWidth);
  }

  const fittingLabel = "Brighton";
  const fittingAttributes = teamText(renderName(fittingLabel), fittingLabel);
  const fittingFontSize = Number(/font-size="(\d+)"/.exec(fittingAttributes)[1]);
  assert.equal(fittingFontSize, 14);
  assert.ok(fittingLabel.length * fittingFontSize * charWidthFactor <= innerWidth);
  assert.doesNotMatch(fittingAttributes, /textLength=/);
});

test("createScoreImage marks the assigned home or away crest with one compact accessible line", () => {
  const crests = {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  };
  const home = decode(createScoreImage("Home\nAway\n0 - 0", { ...crests, assignedTeamSide: "home" }));
  assert.match(home, /<g aria-label="Assigned home team"><line x1="34" y1="14" x2="66" y2="14" stroke="#d7dde5" stroke-width="4" stroke-linecap="round"\/><\/g>/);
  assert.equal((home.match(/Assigned (?:home|away) team/g) || []).length, 1);

  const away = decode(createScoreImage("Home\nAway\n0 - 0", { ...crests, assignedTeamSide: "away" }));
  assert.match(away, /<g aria-label="Assigned away team"><line x1="130" y1="14" x2="162" y2="14" stroke="#d7dde5" stroke-width="4" stroke-linecap="round"\/><\/g>/);
  assert.equal((away.match(/Assigned (?:home|away) team/g) || []).length, 1);
});

test("createScoreImage renders the assigned line only when that crest is valid", () => {
  const homeCrest = "data:image/png;base64,aG9tZQ==";
  const awayCrest = "data:image/png;base64,YXdheQ==";
  const selectedOnly = decode(createScoreImage("Home\nAway\n0 - 0", { homeCrest, assignedTeamSide: "home" }));
  assert.match(selectedOnly, /Assigned home team/);
  assert.equal((selectedOnly.match(/<image /g) || []).length, 1);

  for (const options of [
    { awayCrest, assignedTeamSide: "home" },
    { homeCrest, assignedTeamSide: "away" },
    { homeCrest, awayCrest, assignedTeamSide: null },
    { homeCrest, awayCrest, assignedTeamSide: "both" },
    { assignedTeamSide: "home" },
  ]) {
    const svg = decode(createScoreImage("Home\nAway\n0 - 0", options));
    assert.doesNotMatch(svg, /Assigned (?:home|away) team/);
    assert.doesNotMatch(svg, /stroke="#d7dde5"/);
  }
});

test("createScoreImage renders the generic date line larger and explicitly bold", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\n9/14/2026"));
  assert.match(svg, /y="178"[^>]*font-size="19"[^>]*font-weight="700"[^>]*>9\/14\/2026<\/text>/);
});

test("createScoreImage preserves every generic line-layout coordinate", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\nLIVE\nExtra"));
  for (const [label, y, fontSize, color] of [
    ["Home", 38, 19, "#ffffff"],
    ["Away", 76, 19, "#ffffff"],
    ["0 - 0", 132, 40, "#8ee7ff"],
    ["LIVE", 178, 19, "#9aa4b2"],
    ["Extra", 190, 15, "#9aa4b2"],
  ]) {
    assert.match(svg, new RegExp(`<text x="98" y="${y}" fill="${color}"[^>]*font-size="${fontSize}"[^>]*>${label}<\\/text>`));
  }
  assert.doesNotMatch(svg, /fill="#223040"/);
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

test("createScoreImage bounds visibly estimated match phases in the lower row", () => {
  for (const phase of ["~1ST HALF 44'", "~HALF TIME", "~2ND HALF 90'"]) {
    const svg = decode(createScoreImage(`Home\nAway\n2 - 2\n${phase}`));
    assert.match(svg, /y="178"[^>]*textLength="168" lengthAdjust="spacingAndGlyphs"/);
    assert.ok(svg.includes(phase.replace("'", "&apos;")));
  }
});

test("createScoreImage ignores non-image crest data", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0\n2026-09-14", { homeCrest: "javascript:alert(1)" }));
  assert.doesNotMatch(svg, /<image /);
  assert.doesNotMatch(svg, /fill="#223040"/);
});

test("createScoreImage accepts canonical Base64 and rejects malformed crest payloads", () => {
  for (const payload of ["YWJj", "YWI=", "YQ==", "aG9tZQ=="]) {
    const crest = `data:image/png;base64,${payload}`;
    const svg = decode(createScoreImage("Home\nAway\n0 - 0", { homeCrest: crest, assignedTeamSide: "home" }));
    assert.equal((svg.match(/<image /g) || []).length, 1, payload);
    assert.match(svg, /Assigned home team/, payload);
  }

  for (const payload of ["====", "a", "abc", "YQ=", "YQ===", "YW=J", "YWJj=", "YW$j", ""]) {
    const crest = `data:image/png;base64,${payload}`;
    const svg = decode(createScoreImage("Home\nAway\n0 - 0", { homeCrest: crest, assignedTeamSide: "home" }));
    assert.doesNotMatch(svg, /<image /, payload);
    assert.doesNotMatch(svg, /Assigned home team/, payload);
  }
});

test("a malformed opposite crest does not suppress a valid selected crest indicator", () => {
  const svg = decode(createScoreImage("Home\nAway\n0 - 0", {
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,====",
    assignedTeamSide: "home",
  }));

  assert.equal((svg.match(/<image /g) || []).length, 1);
  assert.equal((svg.match(/Assigned (?:home|away) team/g) || []).length, 1);
  assert.match(svg, /Assigned home team/);
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
  assert.match(home, /<rect x="10" y="117" width="42" height="22" rx="11" fill="#d71920" stroke="#ffffff" stroke-width="1"\/>(?:<text[^>]*x="31"[^>]*y="132"[^>]*>Goal!!<\/text>)/);
  assert.equal((home.match(/>Goal!!<\/text>/g) || []).length, 1);
  assert.doesNotMatch(home, /Away team goal increase/);
  assert.doesNotMatch(home, /<polygon\b/);

  const awayWithCrests = decode(createScoreImage("Home\nAway\n9 - 9", {
    goalSide: "away",
    homeCrest: "data:image/png;base64,aG9tZQ==",
    awayCrest: "data:image/png;base64,YXdheQ==",
  }));
  assert.match(awayWithCrests, /aria-label="Away team goal increase"/);
  assert.match(awayWithCrests, /<rect x="144" y="117" width="42" height="22" rx="11" fill="#d71920" stroke="#ffffff" stroke-width="1"\/>(?:<text[^>]*x="165"[^>]*y="132"[^>]*fill="#ffffff"[^>]*>Goal!!<\/text>)/);
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
  const badges = [...svg.matchAll(/<rect x="(10|144)" y="(117)" width="42" height="22" rx="11" fill="#d71920"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: 42, height: 22 }));
  const [homeBadge, awayBadge] = badges;
  const protectedScoreArea = { left: 52, right: 144 };
  const protectedPaintedScoreArea = { left: 53, right: 143 };
  const scoreAdvance = 80.039;
  const scoreBounds = { left: 98 - scoreAdvance / 2, right: 98 + scoreAdvance / 2 };

  assert.equal(badges.length, 2);
  assert.equal(homeBadge.x + homeBadge.width, protectedScoreArea.left);
  assert.equal(awayBadge.x, protectedScoreArea.right);
  assert.ok(homeBadge.x + homeBadge.width + 0.5 < protectedPaintedScoreArea.left);
  assert.ok(awayBadge.x - 0.5 > protectedPaintedScoreArea.right);
  assert.ok(scoreBounds.left > protectedPaintedScoreArea.left);
  assert.ok(scoreBounds.right < protectedPaintedScoreArea.right);
  assert.deepEqual(
    [scoreBounds.left, scoreBounds.right].map((value) => Number(value.toFixed(2))),
    [57.98, 138.02],
  );
  assert.deepEqual(
    [scoreBounds.left - protectedPaintedScoreArea.left, protectedPaintedScoreArea.right - scoreBounds.right]
      .map((value) => Number(value.toFixed(2))),
    [4.98, 4.98],
  );
  for (const badge of badges) {
    assert.ok(badge.x >= 0 && badge.x + badge.width <= 196);
    assert.ok(badge.y >= 0 && badge.y + badge.height <= 196);
  }
  assert.equal((svg.match(/<text x="(?:31|165)" y="132"[^>]*>Goal!!<\/text>/g) || []).length, 2);
  assert.match(svg, /<text x="98" y="132"[^>]*font-size="40"[^>]*>9 - 9<\/text>/);
  assert.match(svg, /y="178"[^>]*>LIVE<\/text>/);
});

test("createScoreImage renders bounded remaining-refresh progress along the bottom edge", () => {
  for (const [progress, expectedWidth] of [[1, 172], [0.5, 86], [0, 0], [2, 172], [-1, 0]]) {
    const svg = decode(createScoreImage("Home\nAway\n1 - 0\nLIVE", { refreshProgress: progress }));
    const bars = [...svg.matchAll(/<rect x="12" y="190" width="([0-9.]+)" height="4" rx="2"/g)];
    assert.equal(bars.length, 2, String(progress));
    assert.equal(Number(bars[0][1]), 172, "the track remains within the 196x196 image");
    assert.equal(Number(bars[1][1]), expectedWidth, String(progress));
    for (const bar of bars) {
      assert.ok(12 + Number(bar[1]) <= 196);
      assert.ok(190 + 4 <= 196);
    }
  }

  for (const progress of [undefined, null, "1", Number.NaN]) {
    const svg = decode(createScoreImage("Home\nAway\n1 - 0", { refreshProgress: progress }));
    assert.doesNotMatch(svg, /Automatic refresh time remaining/, String(progress));
  }
});

test("createScoreImage keeps at most five meaningful lines", () => {
  const svg = decode(createScoreImage("1\n2\n3\n4\n5\n6\n7"));
  assert.match(svg, />5</);
  assert.doesNotMatch(svg, />6</);
  assert.deepEqual(svg.match(/<text /g).length, 5);
});
