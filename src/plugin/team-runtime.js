"use strict";

// Per-key view for one configured team. Initial/configuration loads select the
// fixture nearest to now; key presses alternate between the last finished and an
// active-or-upcoming fixture. Each context owns one poll timer and score baseline.

const { createScoreImage } = require("./score-image.js");

const DEFAULT_COMPETITION = "PD";
const DEFAULT_TEAM_ID = 90;
const DEFAULT_TEAM_LABEL = "Betis";
const POLL_INTERVAL_MS = 120000;
const PROGRESS_UPDATE_MS = 1000;
const MAX_TIMEOUT_MS = 0x7fffffff;
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "LIVE"]);
const SCHEDULED_STATUSES = new Set(["SCHEDULED", "TIMED"]);
const SUPPORTED_MATCH_STATUSES = new Set([
  "SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED",
  "SUSPENDED", "POSTPONED", "CANCELLED", "AWARDED", "LIVE",
]);
const ACTIVE_DETAIL_TRANSITIONS = new Set([
  "IN_PLAY", "PAUSED", "LIVE", "FINISHED",
  "SUSPENDED", "POSTPONED", "CANCELLED", "AWARDED",
]);

function isCurrentOrNextStatus(status) {
  return LIVE_STATUSES.has(status) || SCHEDULED_STATUSES.has(status);
}

function toTeamId(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return DEFAULT_TEAM_ID;
}

function isTeamMatch(event, teamId) {
  return Boolean(event) && (event.homeTeamId === teamId || event.awayTeamId === teamId);
}

function kickoffTime(event) {
  const value = Date.parse(event?.kickoff ?? event?.utcDate);
  return Number.isNaN(value) ? null : value;
}

function formatLocalKickoffTime(event) {
  const time = kickoffTime(event);
  if (time !== null) {
    const kickoff = new Date(time);
    return `${String(kickoff.getHours()).padStart(2, "0")}:${String(kickoff.getMinutes()).padStart(2, "0")}`;
  }

  return typeof event?.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(event.time)
    ? event.time.slice(0, 5)
    : null;
}

function selectNearestMatch(matches, reference, teamId) {
  if (!Array.isArray(matches) || !(reference instanceof Date) || Number.isNaN(reference.getTime())) return null;
  const now = reference.getTime();
  let selected = null;
  let selectedTime = null;
  for (const match of matches) {
    if (!isTeamMatch(match, teamId)) continue;
    const time = kickoffTime(match);
    if (time === null) continue;
    if (selected === null) {
      selected = match;
      selectedTime = time;
      continue;
    }
    const distance = Math.abs(time - now);
    const selectedDistance = Math.abs(selectedTime - now);
    if (distance < selectedDistance || (distance === selectedDistance && time >= now && selectedTime < now)) {
      selected = match;
      selectedTime = time;
    }
  }
  return selected;
}

function matchIdOf(match) {
  return typeof match?.id === "string" || typeof match?.id === "number" ? String(match.id) : null;
}

function matchIdOrder(match) {
  return matchIdOf(match) ?? "";
}

function compareMatchIds(left, right) {
  const leftId = matchIdOrder(left);
  const rightId = matchIdOrder(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function selectMatchingMatch(matches, reference, teamId, accepts, compare) {
  if (!Array.isArray(matches) || !(reference instanceof Date) || Number.isNaN(reference.getTime())) return null;
  const now = reference.getTime();
  let selected = null;
  let selectedTime = null;
  for (const match of matches) {
    if (!isTeamMatch(match, teamId)) continue;
    const time = kickoffTime(match);
    if (time === null || !accepts(match, time, now)) continue;
    if (selected === null || compare(match, time, selected, selectedTime, now) < 0) {
      selected = match;
      selectedTime = time;
    }
  }
  return selected;
}

function selectLastFinishedMatch(matches, reference, teamId) {
  return selectMatchingMatch(
    matches,
    reference,
    teamId,
    (match, time, now) => match?.status === "FINISHED" && time <= now,
    (match, time, selected, selectedTime) => selectedTime - time || compareMatchIds(match, selected),
  );
}

function selectNextMatch(matches, reference, teamId) {
  const active = selectMatchingMatch(
    matches,
    reference,
    teamId,
    (match) => LIVE_STATUSES.has(match?.status),
    (match, time, selected, selectedTime, now) => Math.abs(time - now) - Math.abs(selectedTime - now)
      || compareMatchIds(match, selected),
  );
  if (active !== null) return active;
  return selectMatchingMatch(
    matches,
    reference,
    teamId,
    (match, time, now) => SCHEDULED_STATUSES.has(match?.status) && time > now,
    (match, time, selected, selectedTime) => time - selectedTime || compareMatchIds(match, selected),
  );
}

function sameLocalCalendarDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function nextLocalMidnight(reference) {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + 1,
  ).getTime();
}

/**
 * @returns {null | { text: string, kickoff: number, nextRedrawAt: number | null }}
 */
function describeScheduledMatch(match, reference) {
  if (!(reference instanceof Date) || Number.isNaN(reference.getTime())) return null;
  const status = typeof match?.status === "string" ? match.status.toUpperCase() : "";
  if (!SCHEDULED_STATUSES.has(status)) return null;
  const kickoff = kickoffTime(match);
  if (kickoff === null) return null;

  const remaining = kickoff - reference.getTime();
  if (!sameLocalCalendarDate(new Date(kickoff), reference)) {
    return {
      text: formatLocalMatchDate(match),
      kickoff,
      nextRedrawAt: remaining > 0 ? Math.min(nextLocalMidnight(reference), kickoff) : null,
    };
  }

  const minutes = Math.max(0, Math.ceil(remaining / 60000));
  const hours = Math.floor(minutes / 60);
  const minutePart = minutes % 60;
  return {
    text: `START IN ${String(hours).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`,
    kickoff,
    nextRedrawAt: remaining > 0 ? kickoff - (minutes - 1) * 60000 : null,
  };
}

/** @typedef {{ kind: "none" } | { kind: "wake-at-kickoff", kickoff: number } | { kind: "poll-in-2m", delay: number }} MatchSchedule */

/** @returns {MatchSchedule} */
function decideMatchSchedule(match, reference) {
  if (!(reference instanceof Date) || Number.isNaN(reference.getTime())) return { kind: "none" };
  const kickoff = kickoffTime(match);
  if (kickoff === null) return { kind: "none" };
  if (LIVE_STATUSES.has(match?.status)) return { kind: "poll-in-2m", delay: POLL_INTERVAL_MS };
  if (!SCHEDULED_STATUSES.has(match?.status)) return { kind: "none" };
  if (kickoff > reference.getTime()) return { kind: "wake-at-kickoff", kickoff };
  return { kind: "poll-in-2m", delay: POLL_INTERVAL_MS };
}

function isLiveMatch(match) {
  const status = typeof match?.status === "string" ? match.status.toUpperCase() : "";
  return LIVE_STATUSES.has(status);
}

function matchClockValue(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function hasCompatibleDetailIdentity(match, detail) {
  if (matchIdOf(detail) !== matchIdOf(match)) return false;
  const positiveInteger = (value) => Number.isInteger(value) && value > 0;
  const listHome = match?.homeTeamId;
  const listAway = match?.awayTeamId;
  const detailHome = detail?.homeTeamId;
  const detailAway = detail?.awayTeamId;

  if (detailHome != null && !positiveInteger(detailHome)) return false;
  if (detailAway != null && !positiveInteger(detailAway)) return false;
  if (listHome != null && detailHome != null && listHome !== detailHome) return false;
  if (listAway != null && detailAway != null && listAway !== detailAway) return false;
  if (detailHome != null && listAway != null && detailHome === listAway) return false;
  if (detailAway != null && listHome != null && detailAway === listHome) return false;
  if (detailHome != null && detailAway != null && detailHome === detailAway) return false;
  return true;
}

function hasCompatibleDetailStatus(match, detail) {
  if (detail.status == null) return true;
  if (!SUPPORTED_MATCH_STATUSES.has(detail.status)) return false;
  return LIVE_STATUSES.has(match?.status) && ACTIVE_DETAIL_TRANSITIONS.has(detail.status);
}

function mergeMatchDetail(match, detail) {
  if (!detail || typeof detail !== "object") return match;
  if (!hasCompatibleDetailIdentity(match, detail) || !hasCompatibleDetailStatus(match, detail)) return match;
  if (matchClockValue(detail.minute) === null) return match;

  const merged = { ...match };
  const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
  const positiveInteger = (value) => Number.isInteger(value) && value > 0;
  const score = (value) => Number.isInteger(value) && value >= 0;
  const validKickoff = (value) => nonEmptyString(value) && !Number.isNaN(Date.parse(value));
  const validCrestUrl = (value) => {
    if (!nonEmptyString(value)) return false;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  };
  const validDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const validTime = (value) => typeof value === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
  const validStatus = (value) => SUPPORTED_MATCH_STATUSES.has(value);
  const fields = [
    ["leagueId", nonEmptyString], ["round", nonEmptyString],
    ["homeTeamId", positiveInteger], ["awayTeamId", positiveInteger],
    ["homeTeam", nonEmptyString], ["awayTeam", nonEmptyString],
    ["homeCrestUrl", validCrestUrl], ["awayCrestUrl", validCrestUrl],
    ["homeScore", score], ["awayScore", score],
    ["status", validStatus], ["minute", (value) => matchClockValue(value) !== null],
    ["injuryTime", (value) => matchClockValue(value) !== null],
    ["kickoff", validKickoff], ["date", validDate], ["time", validTime],
  ];
  for (const [field, accepts] of fields) {
    if (accepts(detail[field])) merged[field] = detail[field];
  }
  return Object.freeze(merged);
}

function describeLiveMatch(match, reference) {
  const status = typeof match?.status === "string" ? match.status.toUpperCase() : "";
  if (!LIVE_STATUSES.has(status)) return null;

  const minute = matchClockValue(match?.minute);
  if (status === "PAUSED" && minute === null) return "HALF TIME";
  if (minute !== null) {
    const injuryTime = matchClockValue(match?.injuryTime);
    const clock = `${minute}${injuryTime !== null && injuryTime > 0 ? `+${injuryTime}` : ""}'`;
    if (status === "PAUSED") return `HALF TIME ${clock}`;
    if (minute <= 45) return `1ST HALF ${clock}`;
    if (minute <= 90) return `2ND HALF ${clock}`;
    return `EXTRA TIME ${clock}`;
  }

  const kickoff = kickoffTime(match);
  if (kickoff === null || !(reference instanceof Date) || Number.isNaN(reference.getTime())) return "LIVE";
  const elapsed = reference.getTime() - kickoff;
  if (elapsed < 0) {
    if (!sameLocalCalendarDate(new Date(kickoff), reference)) return formatLocalMatchDate(match);
    const minutes = Math.ceil(-elapsed / 60000);
    return `START IN ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const elapsedMinutes = Math.floor(elapsed / 60000);
  if (elapsedMinutes < 45) return `~1ST HALF ${elapsedMinutes}'`;
  if (elapsedMinutes < 60) return "~HALF TIME";
  return `~2ND HALF ${Math.min(90, elapsedMinutes - 15)}'`;
}

function scoreOf(match) {
  if (match?.homeScore == null && match?.awayScore == null) return { home: 0, away: 0 };
  if (!Number.isFinite(match?.homeScore) || !Number.isFinite(match?.awayScore)) return null;
  return { home: match.homeScore, away: match.awayScore };
}

function selectionOf(param) {
  const competition = typeof param?.competition === "string" && param.competition.trim().length > 0
    ? param.competition.trim()
    : DEFAULT_COMPETITION;
  return `${competition}\u0000${toTeamId(param?.teamId)}`;
}

function formatLocalMatchDate(event) {
  const time = kickoffTime(event);
  if (time !== null) return new Date(time).toLocaleDateString();

  const parts = typeof event?.date === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.date)
    : null;
  if (!parts) return null;
  const fallback = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const isSameDate = fallback.getFullYear() === Number(parts[1])
    && fallback.getMonth() === Number(parts[2]) - 1
    && fallback.getDate() === Number(parts[3]);
  return isSameDate ? fallback.toLocaleDateString() : null;
}

function contextualMatchDate(event, reference) {
  const time = kickoffTime(event);
  if (time === null || !(reference instanceof Date) || Number.isNaN(reference.getTime())) {
    return formatLocalMatchDate(event);
  }
  const status = typeof event?.status === "string" ? event.status.toUpperCase() : "";
  const scheduled = describeScheduledMatch(event, reference);
  if (scheduled !== null) return scheduled.text;
  if (LIVE_STATUSES.has(status)) return describeLiveMatch(event, reference);
  if (!sameLocalCalendarDate(new Date(time), reference)) return formatLocalMatchDate(event);
  if (status === "FINISHED") return "FINISHED";
  return formatLocalMatchDate(event);
}

function renderMatch(event, reference) {
  const hasScore = event.homeScore !== null && event.homeScore !== undefined
    && event.awayScore !== null && event.awayScore !== undefined;
  const result = hasScore ? `${event.homeScore} - ${event.awayScore}` : formatLocalKickoffTime(event) ?? "-";
  const lines = [event.homeTeam ?? "Home", event.awayTeam ?? "Away", result];
  const date = contextualMatchDate(event, reference);
  if (date) lines.push(date);
  return lines.join("\n");
}

class TeamRuntime {
  #host;
  #service;
  #render;
  #now;
  #setTimeout;
  #clearTimeout;
  #setProgressTimeout;
  #clearProgressTimeout;
  #maxTimeout;
  #alert;
  #contexts = new Map();

  constructor({
    host,
    service,
    render = createScoreImage,
    now = () => new Date(),
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
    setProgressTimeout = setTimeout,
    clearProgressTimeout = clearTimeout,
    maxTimeout = MAX_TIMEOUT_MS,
    alert = () => {},
  } = {}) {
    if (!host || typeof host.setBaseDataIcon !== "function") throw new TypeError("host must implement setBaseDataIcon");
    if (!service || typeof service.listMatches !== "function") throw new TypeError("service must implement listMatches");
    if (typeof render !== "function" || typeof now !== "function" || typeof setTimeout !== "function" || typeof clearTimeout !== "function" || typeof setProgressTimeout !== "function" || typeof clearProgressTimeout !== "function" || typeof alert !== "function") {
      throw new TypeError("render, alert, clock and timers must be functions");
    }
    if (!Number.isFinite(maxTimeout) || maxTimeout <= 0) throw new TypeError("maxTimeout must be positive");
    this.#host = host;
    this.#service = service;
    this.#render = render;
    this.#now = now;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
    this.#setProgressTimeout = setProgressTimeout;
    this.#clearProgressTimeout = clearProgressTimeout;
    this.#maxTimeout = maxTimeout;
    this.#alert = alert;
  }

  #draw(context, text, options) {
    const image = this.#render(text, options);
    if (image !== null) this.#host.setBaseDataIcon(context, image);
  }

  #replaceContext(context, param, { resetMode, viewMode } = {}) {
    const prior = this.#contexts.get(context);
    if (prior?.timer !== null && prior?.timer !== undefined) this.#clearTimeout(prior.timer);
    if (prior?.progressTimer !== null && prior?.progressTimer !== undefined) this.#clearProgressTimeout(prior.progressTimer);
    const selection = selectionOf(param);
    const sameSelection = prior?.selection === selection;
    const nextMode = viewMode ?? (resetMode === "always" || !sameSelection ? "nearest" : prior?.viewMode ?? "nearest");
    const sameView = resetMode !== "always" && sameSelection && prior?.viewMode === nextMode;
    const entry = {
      generation: (prior?.generation ?? 0) + 1,
      timer: null,
      progressTimer: null,
      param,
      selection,
      viewMode: nextMode,
      selectedStatus: sameView ? prior.selectedStatus : null,
      selectedMatchId: sameView ? prior.selectedMatchId : null,
      baseline: sameView ? prior.baseline : null,
    };
    this.#contexts.set(context, entry);
    return entry;
  }

  #isCurrent(context, entry) {
    return this.#contexts.get(context) === entry;
  }

  #observeScore(entry, match) {
    const matchId = matchIdOf(match);
    const score = scoreOf(match);
    if (matchId === null) {
      entry.baseline = null;
      return null;
    }
    const prior = entry.baseline;
    entry.baseline = { matchId, score };
    if (score === null || prior === null || prior.matchId !== matchId || prior.score === null) return null;
    const changed = prior.score.home !== score.home || prior.score.away !== score.away;
    if (changed && isLiveMatch(match)) {
      try {
        const result = this.#alert();
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch {
        // Audio is best-effort and must never break rendering or future polling.
      }
    }
    const home = score.home > prior.score.home;
    const away = score.away > prior.score.away;
    if (home && away) return "both";
    if (home) return "home";
    if (away) return "away";
    return null;
  }

  #scheduleProgressRedraw(context, entry, deadline, delay, match, options) {
    const reference = this.#now();
    const now = reference instanceof Date ? reference.getTime() : Number.NaN;
    const remaining = deadline - now;
    if (Number.isNaN(now) || remaining <= 0 || !this.#isCurrent(context, entry)) return;
    entry.progressTimer = this.#setProgressTimeout(() => {
      entry.progressTimer = null;
      if (!this.#isCurrent(context, entry)) return;
      const current = this.#now();
      const currentTime = current instanceof Date ? current.getTime() : Number.NaN;
      if (Number.isNaN(currentTime) || currentTime >= deadline) return;
      this.#draw(context, renderMatch(match, current), { ...options, refreshProgress: (deadline - currentTime) / delay });
      this.#scheduleProgressRedraw(context, entry, deadline, delay, match, options);
    }, Math.min(PROGRESS_UPDATE_MS, remaining));
  }

  #schedulePoll(context, entry, delay, match, options) {
    const reference = this.#now();
    const now = reference instanceof Date ? reference.getTime() : Number.NaN;
    entry.timer = this.#setTimeout(() => {
      entry.timer = null;
      if (!this.#isCurrent(context, entry)) return undefined;
      return this.refresh({ context, param: entry.param }, { mode: "background", resetMode: "never" });
    }, delay);
    if (!Number.isNaN(now)) this.#scheduleProgressRedraw(context, entry, now + delay, delay, match, options);
  }

  #scheduleLocalRedraw(context, entry, match, crests) {
    if (!this.#isCurrent(context, entry)) return;
    const reference = this.#now();
    const now = reference instanceof Date ? reference.getTime() : Number.NaN;
    if (Number.isNaN(now)) return;
    const display = describeScheduledMatch(match, reference);
    if (display === null) return;
    if (display.kickoff <= now) {
      this.#draw(context, renderMatch(match, reference), { ...crests, live: false, goalSide: null });
      return this.refresh({ context, param: entry.param }, { mode: "background", resetMode: "never" });
    }
    const target = display.nextRedrawAt;
    if (target === null) return;
    const remaining = target - now;
    entry.timer = this.#setTimeout(() => {
      entry.timer = null;
      if (!this.#isCurrent(context, entry)) return undefined;
      const current = this.#now();
      const currentTime = current instanceof Date ? current.getTime() : Number.NaN;
      if (Number.isNaN(currentTime)) return undefined;
      if (currentTime < target) return this.#scheduleLocalRedraw(context, entry, match, crests);
      const latest = describeScheduledMatch(match, current);
      if (latest === null) return undefined;
      this.#draw(context, renderMatch(match, current), { ...crests, live: false, goalSide: null });
      if (latest.kickoff <= currentTime) {
        return this.refresh({ context, param: entry.param }, { mode: "background", resetMode: "never" });
      }
      return this.#scheduleLocalRedraw(context, entry, match, crests);
    }, Math.min(remaining, this.#maxTimeout));
  }

  #backgroundMatch(matches, entry, teamId) {
    if (entry.selectedMatchId === null) return null;
    return matches.find((match) => isTeamMatch(match, teamId)
      && kickoffTime(match) !== null
      && isCurrentOrNextStatus(match?.status)
      && matchIdOf(match) === entry.selectedMatchId) ?? null;
  }

  async refresh({ context, param } = {}, { mode = "foreground", resetMode = "selection", viewMode } = {}) {
    const prior = this.#contexts.get(context);
    const effectiveParam = param && typeof param === "object" && !Array.isArray(param) ? param : prior?.param;
    const entry = this.#replaceContext(context, effectiveParam, { resetMode, viewMode });
    const token = effectiveParam?.token;
    const label = typeof effectiveParam?.teamLabel === "string" && effectiveParam.teamLabel.length > 0 ? effectiveParam.teamLabel : DEFAULT_TEAM_LABEL;
    if (typeof token !== "string" || token.trim().length === 0) {
      entry.baseline = null;
      this.#draw(context, `${label}\nAdd token`);
      return;
    }

    const reference = this.#now();
    if (mode === "foreground") this.#draw(context, `${label}\nLoading…`);
    try {
      const teamId = toTeamId(effectiveParam?.teamId);
      const competition = typeof effectiveParam?.competition === "string" && effectiveParam.competition.trim().length > 0
        ? effectiveParam.competition.trim()
        : DEFAULT_COMPETITION;
      const matches = await this.#service.listMatches(teamId, token, competition, reference);
      if (!this.#isCurrent(context, entry)) return;
      if (mode === "background" && entry.viewMode === "nearest" && isCurrentOrNextStatus(entry.selectedStatus)) {
        entry.viewMode = "next";
      }
      const retained = mode === "background" && Array.isArray(matches)
        ? this.#backgroundMatch(matches, entry, teamId)
        : null;
      const selectedMatch = retained ?? (entry.viewMode === "last"
        ? selectLastFinishedMatch(matches, reference, teamId)
        : entry.viewMode === "next"
          ? selectNextMatch(matches, reference, teamId)
          : selectNearestMatch(matches, reference, teamId));
      if (!selectedMatch) {
        entry.baseline = null;
        entry.selectedStatus = null;
        entry.selectedMatchId = null;
        const message = entry.viewMode === "last" ? "No finished match"
          : entry.viewMode === "next" ? "No upcoming match" : "No match";
        this.#draw(context, `${label}\n${message}`);
        return;
      }
      let match = selectedMatch;
      if (isLiveMatch(match) && matchClockValue(match.minute) === null && typeof this.#service.loadMatchDetail === "function") {
        try {
          const detail = await this.#service.loadMatchDetail(matchIdOf(match), token, competition);
          if (!this.#isCurrent(context, entry)) return;
          match = mergeMatchDetail(match, detail);
        } catch {
          if (!this.#isCurrent(context, entry)) return;
        }
      }
      const loadCrest = typeof this.#service.loadCrest === "function"
        ? (url) => url ? this.#service.loadCrest(url).catch(() => null) : Promise.resolve(null)
        : () => Promise.resolve(null);
      const [homeCrest, awayCrest] = await Promise.all([
        loadCrest(match.homeCrestUrl),
        loadCrest(match.awayCrestUrl),
      ]);
      if (!this.#isCurrent(context, entry)) return;
      const goalSide = this.#observeScore(entry, match);
      entry.selectedStatus = match.status;
      entry.selectedMatchId = matchIdOf(match);
      const text = renderMatch(match, reference);
      const options = { homeCrest, awayCrest, live: isLiveMatch(match), goalSide };
      const schedule = entry.viewMode !== "last" ? decideMatchSchedule(match, this.#now()) : { kind: "none" };
      if (entry.viewMode !== "last") {
        if (schedule.kind === "poll-in-2m") this.#schedulePoll(context, entry, schedule.delay, match, { ...options, goalSide: null });
        else if (schedule.kind === "wake-at-kickoff") {
          this.#scheduleLocalRedraw(context, entry, match, { homeCrest, awayCrest });
        }
      }
      this.#draw(context, text, schedule.kind === "poll-in-2m" ? { ...options, refreshProgress: 1 } : options);
    } catch {
      if (this.#isCurrent(context, entry)) this.#draw(context, `${label}\nData unavailable`);
    }
  }

  toggle({ context, param } = {}) {
    const prior = this.#contexts.get(context);
    let viewMode;
    if (prior?.viewMode === "last") viewMode = "next";
    else if (prior?.viewMode === "next") viewMode = "last";
    else if (prior?.selectedStatus === "FINISHED") viewMode = "next";
    else viewMode = "last";
    return this.refresh({ context, param }, { mode: "foreground", resetMode: "never", viewMode });
  }

  clear(message) {
    const items = message && Array.isArray(message.param) ? message.param : [];
    for (const item of items) {
      const context = item?.context;
      const entry = this.#contexts.get(context);
      if (entry?.timer !== null && entry?.timer !== undefined) this.#clearTimeout(entry.timer);
      if (entry?.progressTimer !== null && entry?.progressTimer !== undefined) this.#clearProgressTimeout(entry.progressTimer);
      this.#contexts.delete(context);
    }
  }

  dispose() {
    for (const entry of this.#contexts.values()) {
      if (entry.timer !== null && entry.timer !== undefined) this.#clearTimeout(entry.timer);
      if (entry.progressTimer !== null && entry.progressTimer !== undefined) this.#clearProgressTimeout(entry.progressTimer);
    }
    this.#contexts.clear();
  }
}

module.exports = {
  DEFAULT_COMPETITION,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_LABEL,
  MAX_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  TeamRuntime,
  decideMatchSchedule,
  describeLiveMatch,
  describeScheduledMatch,
  formatLocalKickoffTime,
  formatLocalMatchDate,
  isLiveMatch,
  isTeamMatch,
  renderMatch,
  selectLastFinishedMatch,
  selectNearestMatch,
  selectNextMatch,
  toTeamId,
};
