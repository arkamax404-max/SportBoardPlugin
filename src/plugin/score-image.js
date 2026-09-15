"use strict";

// src/plugin/score-image.js — the only rendering path for dynamic key content.
//
// Evidence: sibling D200 plugins (FlightInfoPlugin) render dynamic key content as
// a 196x196 base64 SVG data URI sent as a type-1 state command; host-rendered
// text metadata is unreliable on the D200. This module is pure: it composes the
// SVG, escapes every interpolated value, and returns null when there is nothing
// to draw, so callers keep the manifest's static fallback icon instead.

const SIZE = 196;
const MAX_LINES = 5;

// Four-row match layout: home team, away team, result, date. The result row is
// the visual anchor, so it is larger and coloured; the date row is deliberately
// quiet. Long club names use the smallest team font that still reads on a
// 196px key.
const LINE_LAYOUT = [
  { y: 38, fontSize: 19, color: "#ffffff" },
  { y: 76, fontSize: 19, color: "#ffffff" },
  { y: 132, fontSize: 40, color: "#8ee7ff" },
  { y: 178, fontSize: 19, color: "#9aa4b2" },
  { y: 190, fontSize: 15, color: "#9aa4b2" },
];

const LIVE_LINE_LAYOUT = [
  { y: 55, fontSize: 19, color: "#ffffff" },
  { y: 86, fontSize: 19, color: "#ffffff" },
  { y: 134, fontSize: 40, color: "#8ee7ff" },
  { y: 178, fontSize: 19, color: "#9aa4b2" },
  { y: 190, fontSize: 15, color: "#9aa4b2" },
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isEmbeddedImage(value) {
  return typeof value === "string"
    && /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function countdownFit(line) {
  return /^START IN \d{2,}:\d{2}$/.test(line) ? ' textLength="168" lengthAdjust="spacingAndGlyphs"' : "";
}

function crestMatchBody(lines, { homeCrest, awayCrest }) {
  const image = (data, x) => isEmbeddedImage(data)
    ? `<image x="${x}" y="12" width="48" height="48" preserveAspectRatio="xMidYMid meet" href="${escapeXml(data)}"/>`
    : "";
  const team = (label, x) => {
    const fontSize = label.length > 13 ? 11 : label.length > 9 ? 12 : 14;
    return `<text x="${x}" y="82" fill="#ffffff" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${escapeXml(label)}</text>`;
  };
  const result = `<text x="98" y="134" fill="#8ee7ff" font-family="Arial, sans-serif" font-size="40" font-weight="700" text-anchor="middle">${escapeXml(lines[2] ?? "-")}</text>`;
  const date = lines[3]
    ? `<text x="98" y="178" fill="#9aa4b2" font-family="Arial, sans-serif" font-size="19" font-weight="700" text-anchor="middle"${countdownFit(lines[3])}>${escapeXml(lines[3])}</text>`
    : "";
  return `${image(homeCrest, 20)}${image(awayCrest, 128)}${team(lines[0] ?? "Home", 44)}${team(lines[1] ?? "Away", 152)}${result}${date}`;
}

function liveBadge() {
  return '<g aria-label="Live"><rect x="72" y="8" width="52" height="24" rx="7" fill="#d71920"/><text x="98" y="25" fill="#ffffff" font-family="Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle">LIVE</text></g>';
}

/** @typedef {null | "home" | "away" | "both"} GoalSide */

function goalMarkers(goalSide) {
  const marker = (side) => {
    const home = side === "home";
    const points = home ? "8,122 20,111 20,133" : "188,122 176,111 176,133";
    const label = home ? "Home team goal increase" : "Away team goal increase";
    return `<g aria-label="${label}"><polygon points="${points}" fill="#ffbf00" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></g>`;
  };
  if (goalSide === "both") return `${marker("home")}${marker("away")}`;
  if (goalSide === "home" || goalSide === "away") return marker(goalSide);
  return "";
}

/** @param {string} text @param {{ homeCrest?: string, awayCrest?: string, live?: boolean, goalSide?: GoalSide }} options */
function createScoreImage(text, options = {}) {
  if (typeof text !== "string") return null;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
  if (lines.length === 0) return null;
  const hasCrest = isEmbeddedImage(options.homeCrest) || isEmbeddedImage(options.awayCrest);
  const layout = options.live === true && !hasCrest ? LIVE_LINE_LAYOUT : LINE_LAYOUT;
  const body = hasCrest
    ? crestMatchBody(lines, options)
    : lines.map((line, index) => {
      const { y, fontSize, color } = layout[index];
      return `<text x="${SIZE / 2}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle"${index === 3 ? countdownFit(line) : ""}>${escapeXml(line)}</text>`;
    }).join("");
  const badge = options.live === true ? liveBadge() : "";
  const markers = goalMarkers(options.goalSide);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="12" fill="#101820"/>${body}${badge}${markers}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

module.exports = { createScoreImage };
