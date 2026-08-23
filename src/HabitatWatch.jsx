import { useEffect, useMemo, useRef, useState } from "react";

/*
  Habitat Watch
  A single-file React app that helps people take concrete, local action to
  protect wildlife from data center development in their county.

  Persistence: the spec asks for entries that survive a reload but forbids
  localStorage and sessionStorage. All data lives in React state and is
  mirrored into the URL hash (compressed JSON via history.replaceState), so a
  reload, a bookmark, or a shared link restores it. No web storage APIs used.
*/

// ---------- static reference data (generic, nothing county-specific) ----------

const BODIES = [
  {
    id: "planning",
    name: "County Planning / Zoning Commission",
    role:
      "Hears rezoning, special use permits, and site plans first. Usually makes a recommendation, sometimes the final call on use permits.",
    find:
      "Search your county website for \"Planning Commission agenda\" or \"Boards and Commissions.\" Many counties post agendas on a portal (Legistar, CivicClerk, Granicus, Municode Meetings). Note the public comment sign-up rule; some require signing up before the meeting starts.",
  },
  {
    id: "commissioners",
    name: "Board of Commissioners / County Council",
    role:
      "Final vote on rezonings, development agreements, and tax abatements. This is where conditions get attached or dropped.",
    find:
      "County website, \"Board of Commissioners\" or \"County Council\" page. Look for the meeting calendar, the agenda packet (often a PDF posted 3 to 7 days ahead), and the public comment policy (time limit, sign-up method).",
  },
  {
    id: "stateenv",
    name: "State environmental agency (water withdrawal and stormwater permits)",
    role:
      "Issues surface water and groundwater withdrawal permits, NPDES / stormwater permits, and stream buffer variances. Often has its own public notice and comment period separate from county hearings.",
    find:
      "Search \"[your state] environmental agency water withdrawal permit public notice.\" Agency names vary: Environmental Protection Division, Department of Environmental Quality, DEP, DNR, TCEQ, etc. Look for a \"public notices\" or \"permits out for comment\" page and sign up for email alerts if offered.",
  },
  {
    id: "utility",
    name: "State public service / utility commission (optional)",
    role:
      "Reviews transmission line routing and large new utility load in many states. Relevant if the project needs a new line or substation.",
    find:
      "Search \"[your state] public service commission docket search\" and look for certificate of need, transmission, or large load tariff filings naming the project or utility.",
  },
  {
    id: "municipal",
    name: "City council / municipal planning (if inside city limits)",
    role:
      "If the parcel is inside a city, the city may control zoning instead of the county, or both may weigh in on annexation and utilities.",
    find:
      "Check the parcel on the county GIS / tax assessor map to see if it is inside a city boundary, then look up that city's planning department page.",
  },
];

const CONCERNS = [
  {
    id: "water",
    label: "Water withdrawal",
    para: (w) =>
      `My first concern is water. If the facility uses evaporative cooling, it can consume a large volume of water every day, much of it lost to the air rather than returned. I am asking that any approval require the applicant to disclose projected gallons per day and the source in writing, and that the condition favor closed-loop or air-cooled systems, or reclaimed water, over new withdrawals from ${w}.`,
  },
  {
    id: "buffers",
    label: "Stream and wetland buffers",
    para: (w) =>
      `Second, stream and wetland buffers. I am asking for a condition that keeps all grading, impervious surface, and stormwater outfalls a set distance back from ${w} and any mapped wetlands on the parcel, at or beyond the minimum in our local ordinance, with the buffer line shown on the recorded site plan.`,
  },
  {
    id: "habitat",
    label: "Habitat clearing",
    para: () =>
      `Third, habitat clearing. Large campuses often clear far more than the building footprint. I am asking for a condition limiting clearing to the developed footprint plus a defined construction zone, preserving existing tree canopy where feasible, and requiring a replanting plan with native species for any disturbed area that is not built on.`,
  },
  {
    id: "lighting",
    label: "Night lighting and bird migration",
    para: () =>
      `Next, lighting. Many birds migrate at night and are drawn off course by bright, upward-spilling light. I am asking for a condition requiring full-cutoff, downward-facing fixtures, warm color temperature, and a reduction or curfew on non-essential exterior lighting during spring and fall migration.`,
  },
  {
    id: "noise",
    label: "Noise",
    para: () =>
      `I also want to raise noise. Cooling equipment and backup generators run continuously and can be heard well past the property line, affecting both neighbors and wildlife. I am asking for a measurable decibel limit at the property line, day and night, and for generator testing to be scheduled during daytime hours.`,
  },
  {
    id: "transmission",
    label: "Transmission line routing",
    para: (w) =>
      `Finally, transmission and utility routing. New lines and substations can fragment habitat beyond the parcel itself. I am asking that any new corridor follow existing roads or rights-of-way where possible and avoid crossing ${w} and intact forest blocks.`,
  },
];

const DEVELOPER_QUESTIONS = [
  {
    q: "What type of cooling will the facility use?",
    why: "Closed-loop or air-cooled systems consume far less water than evaporative (open-loop) cooling towers. Ask for the answer in writing.",
  },
  {
    q: "How many gallons of water per day at full build-out, and from what source?",
    why: "Ask for the peak summer number, not the annual average, and whether the source is municipal, reclaimed, groundwater wells, or direct surface withdrawal.",
  },
  {
    q: "What setbacks from streams and wetlands will be maintained, and are they shown on the site plan?",
    why: "A verbal promise is not a condition. Ask for the buffer line on the recorded plan.",
  },
  {
    q: "What is the exterior lighting specification?",
    why: "Ask about fixture cutoff, color temperature (Kelvin), and whether there is a migration-season curfew or dimming schedule.",
  },
  {
    q: "How many backup generators, what fuel, and how often will they be tested?",
    why: "Generator count drives both noise and air permits. Ask for testing hours and a noise limit at the property line.",
  },
  {
    q: "Is the site a brownfield or previously developed parcel, or undeveloped land?",
    why: "Reuse of already-disturbed land avoids new habitat loss entirely. Ask what was on the parcel before and how much will be cleared.",
  },
];

const SCORE_FIELDS = [
  {
    id: "land",
    label: "Land type",
    max: 25,
    options: [
      { v: "brownfield", label: "Brownfield or previously developed industrial site", pts: 25 },
      { v: "cleared", label: "Previously cleared (farmland, pasture, old commercial)", pts: 15 },
      { v: "partial", label: "Partially wooded, mixed", pts: 7 },
      { v: "undeveloped", label: "Undeveloped forest or land adjacent to wetlands", pts: 0 },
      { v: "unknown", label: "Unknown", pts: 3 },
    ],
    fix: "Ask the applicant to site on an already-disturbed parcel, or to limit clearing to the developed footprint with a recorded conservation easement on the rest.",
  },
  {
    id: "cooling",
    label: "Cooling system",
    max: 20,
    options: [
      { v: "air", label: "Air-cooled or closed-loop liquid", pts: 20 },
      { v: "hybrid", label: "Hybrid (evaporative only on hot days)", pts: 10 },
      { v: "evap", label: "Evaporative / open-loop cooling towers", pts: 0 },
      { v: "unknown", label: "Unknown", pts: 3 },
    ],
    fix: "Request a condition requiring closed-loop or air-cooled systems, or a hard cap on daily water use with annual reporting.",
  },
  {
    id: "watersrc",
    label: "Water source",
    max: 15,
    options: [
      { v: "reclaimed", label: "Reclaimed or recycled water", pts: 15 },
      { v: "municipal", label: "Municipal potable supply", pts: 8 },
      { v: "wells", label: "On-site groundwater wells", pts: 3 },
      { v: "surface", label: "Direct surface withdrawal (river, lake, stream)", pts: 0 },
      { v: "unknown", label: "Unknown", pts: 2 },
    ],
    fix: "Ask for reclaimed water where available, and for any withdrawal permit to include low-flow cutoffs that pause withdrawals during drought.",
  },
  {
    id: "stream",
    label: "Distance from graded area to nearest stream or wetland",
    max: 15,
    options: [
      { v: "far", label: "More than 1,000 feet", pts: 15 },
      { v: "mid", label: "300 to 1,000 feet", pts: 10 },
      { v: "near", label: "100 to 300 feet", pts: 4 },
      { v: "adjacent", label: "Less than 100 feet", pts: 0 },
      { v: "unknown", label: "Unknown", pts: 2 },
    ],
    fix: "Request a recorded buffer at or beyond the local ordinance minimum, with stormwater outfalls kept outside the buffer and erosion controls inspected during construction.",
  },
  {
    id: "lighting",
    label: "Lighting plan",
    max: 10,
    options: [
      { v: "best", label: "Full-cutoff, warm (3000K or lower), with migration curfew or motion control", pts: 10 },
      { v: "shielded", label: "Shielded fixtures, no curfew", pts: 6 },
      { v: "bright", label: "Unshielded or bright white flood lighting", pts: 0 },
      { v: "unknown", label: "No plan submitted yet", pts: 2 },
    ],
    fix: "Ask for a lighting plan with full-cutoff fixtures, 3000K or warmer, and a dimming schedule during spring and fall migration.",
  },
  {
    id: "habitat",
    label: "Habitat type being cleared",
    max: 15,
    options: [
      { v: "none", label: "None (already paved or built)", pts: 15 },
      { v: "field", label: "Old field, scrub, or managed turf", pts: 9 },
      { v: "forest", label: "Mature forest", pts: 3 },
      { v: "wetland", label: "Wetland, floodplain, or riparian corridor", pts: 0 },
      { v: "unknown", label: "Unknown", pts: 2 },
    ],
    fix: "Ask for a tree survey and habitat assessment before the vote, avoidance of wetland and riparian areas, and native replanting of all disturbed areas not built on.",
  },
];

const HOME_ITEMS = [
  { id: "h1", cat: "Plants", text: "Replace part of the lawn with native plants that host local insects (check your state native plant society for a regional list)." },
  { id: "h2", cat: "Plants", text: "Add a native flowering shrub or small tree that fruits in fall for migrating birds." },
  { id: "h3", cat: "Plants", text: "Stop using broad-spectrum insecticides and weed-and-feed on the yard." },
  { id: "h4", cat: "Light", text: "Turn off non-essential outdoor lights from 11 pm to 6 am during spring (roughly March to May) and fall (roughly August to November) migration." },
  { id: "h5", cat: "Light", text: "Swap exterior bulbs to warm color (3000K or lower) and point fixtures down or add shields." },
  { id: "h6", cat: "Light", text: "Put porch and landscape lights on a motion sensor or timer." },
  { id: "h7", cat: "Water", text: "Set out a shallow water dish or birdbath and clean it every few days." },
  { id: "h8", cat: "Water", text: "Let a low spot stay damp or add a small rain garden to slow runoff before it reaches the street." },
  { id: "h9", cat: "Shelter", text: "Leave a brush pile in a back corner for small mammals, birds, and reptiles." },
  { id: "h10", cat: "Shelter", text: "Leave the leaves under trees and in beds through winter; many insects overwinter in leaf litter." },
  { id: "h11", cat: "Shelter", text: "Leave standing dead stems and seed heads until spring instead of cutting back in fall." },
  { id: "h12", cat: "Windows", text: "Add visible markers (dots, tape, or cord) spaced 2 inches apart on the outside of windows that have had strikes." },
  { id: "h13", cat: "Windows", text: "Move bird feeders to within 3 feet of windows or more than 30 feet away." },
  { id: "h14", cat: "Windows", text: "Close blinds or curtains at night in lit rooms during migration season." },
];

const HOME_CATS = ["All", "Plants", "Light", "Water", "Shelter", "Windows"];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

// ---------- URL hash persistence helpers (no web storage) ----------

const HASH_KEY = "hw";

function encodeState(obj) {
  try {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return "";
  }
}

function decodeState(str) {
  try {
    const json = decodeURIComponent(escape(atob(str)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readHash() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return null;
  const params = new URLSearchParams(h);
  const raw = params.get(HASH_KEY);
  return raw ? decodeState(raw) : null;
}

function writeHash(obj) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set(HASH_KEY, encodeState(obj));
  const next = "#" + params.toString();
  if (window.location.hash !== next) {
    window.history.replaceState(null, "", next);
  }
}

const emptyBodyEntry = () => ({ tracked: false, schedule: "", agendaUrl: "", notes: "" });

function defaultState() {
  return {
    tab: "watch",
    watch: {
      county: "",
      state: "",
      bodies: Object.fromEntries(BODIES.map((b) => [b.id, emptyBodyEntry()])),
    },
    toolkit: {
      speaker: "",
      project: "",
      waterway: "",
      concerns: { water: true, buffers: true, habitat: false, lighting: false, noise: false, transmission: false },
    },
    score: Object.fromEntries(SCORE_FIELDS.map((f) => [f.id, ""])),
    home: { done: {}, filter: "All" },
  };
}

function mergeState(base, saved) {
  if (!saved || typeof saved !== "object") return base;
  return {
    ...base,
    ...saved,
    watch: { ...base.watch, ...(saved.watch || {}), bodies: { ...base.watch.bodies, ...((saved.watch && saved.watch.bodies) || {}) } },
    toolkit: { ...base.toolkit, ...(saved.toolkit || {}), concerns: { ...base.toolkit.concerns, ...((saved.toolkit && saved.toolkit.concerns) || {}) } },
    score: { ...base.score, ...(saved.score || {}) },
    home: { ...base.home, ...(saved.home || {}), done: { ...((saved.home && saved.home.done) || {}) } },
  };
}

// ---------- styles ----------

const css = `
  :root {
    --bg: #f6f5ef;
    --card: #ffffff;
    --ink: #1f2a22;
    --muted: #5b6a5f;
    --line: #dcdfd4;
    --accent: #2f6b4f;
    --accent-soft: #e3efe7;
    --warn: #9a5b1f;
    --warn-soft: #f7ecdd;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .hw {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    min-height: 100vh;
    line-height: 1.5;
    font-size: 16px;
  }
  .hw a { color: var(--accent); }
  .hw-wrap { max-width: 760px; margin: 0 auto; padding: 16px 16px 48px; }
  .hw-header { padding: 20px 0 8px; }
  .hw-header h1 { font-size: 1.6rem; margin: 0 0 4px; letter-spacing: -0.01em; }
  .hw-header p { margin: 0; color: var(--muted); font-size: 0.95rem; }
  .hw-tabs {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
    position: sticky; top: 0; z-index: 5; background: var(--bg); padding: 12px 0;
  }
  .hw-tab {
    appearance: none; border: 1px solid var(--line); background: var(--card);
    color: var(--ink); border-radius: 10px; padding: 10px 4px; font-size: 0.85rem;
    cursor: pointer; line-height: 1.2; min-height: 44px;
  }
  .hw-tab.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .hw-card {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 16px; margin: 12px 0;
  }
  .hw-card h2 { font-size: 1.2rem; margin: 0 0 6px; }
  .hw-card h3 { font-size: 1rem; margin: 14px 0 6px; }
  .hw-lede { color: var(--muted); margin: 0 0 12px; font-size: 0.95rem; }
  .hw-row { display: grid; gap: 10px; grid-template-columns: 1fr; }
  @media (min-width: 520px) { .hw-row.two { grid-template-columns: 2fr 1fr; } .hw-row.half { grid-template-columns: 1fr 1fr; } }
  .hw-field label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px; }
  .hw-field input, .hw-field select, .hw-field textarea {
    width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; color: var(--ink); min-height: 44px;
  }
  .hw-field textarea { min-height: 70px; resize: vertical; }
  .hw-field input:focus, .hw-field select:focus, .hw-field textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .hw-hint { font-size: 0.82rem; color: var(--muted); margin: 4px 0 0; }
  .hw-body { border-top: 1px solid var(--line); padding: 14px 0; }
  .hw-body:first-of-type { border-top: none; }
  .hw-body-head { display: flex; gap: 10px; align-items: flex-start; }
  .hw-body-head input[type=checkbox] { width: 22px; height: 22px; margin-top: 3px; flex: none; accent-color: var(--accent); }
  .hw-body-head strong { display: block; }
  .hw-body-head span { color: var(--muted); font-size: 0.9rem; }
  .hw-find { background: var(--accent-soft); border-radius: 8px; padding: 10px 12px; font-size: 0.88rem; margin: 10px 0; }
  .hw-check { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; cursor: pointer; }
  .hw-check input { width: 22px; height: 22px; margin-top: 2px; flex: none; accent-color: var(--accent); }
  .hw-check.done span { color: var(--muted); text-decoration: line-through; }
  .hw-btn {
    appearance: none; border: 1px solid var(--accent); background: var(--accent); color: #fff;
    border-radius: 8px; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer; min-height: 44px;
  }
  .hw-btn.ghost { background: transparent; color: var(--accent); }
  .hw-btn.small { padding: 6px 10px; min-height: 36px; font-size: 0.85rem; }
  .hw-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .hw-output {
    white-space: pre-wrap; background: #fbfaf5; border: 1px solid var(--line); border-radius: 8px;
    padding: 14px; font-size: 1rem; line-height: 1.6; margin-top: 10px;
  }
  .hw-meta { font-size: 0.85rem; color: var(--muted); margin-top: 6px; }
  .hw-meta.over { color: var(--warn); font-weight: 600; }
  .hw-q { padding: 10px 0; border-top: 1px solid var(--line); }
  .hw-q:first-child { border-top: none; }
  .hw-q strong { display: block; }
  .hw-q span { color: var(--muted); font-size: 0.9rem; }
  .hw-score { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 4px; }
  .hw-score .num { font-size: 3rem; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .hw-score .of { color: var(--muted); }
  .hw-bar { height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; margin: 6px 0 12px; }
  .hw-bar > div { height: 100%; background: var(--accent); transition: width 0.3s; }
  .hw-factor { border-top: 1px solid var(--line); padding: 10px 0; }
  .hw-factor .head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
  .hw-factor .fix { font-size: 0.9rem; margin: 4px 0 0; }
  .hw-factor.low .head { color: var(--warn); }
  .hw-pill { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-left: 6px; vertical-align: middle; }
  .hw-pill.warn { background: var(--warn-soft); color: var(--warn); }
  .hw-filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
  .hw-filters button {
    appearance: none; border: 1px solid var(--line); background: #fff; color: var(--ink);
    border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 0.85rem; cursor: pointer; min-height: 36px;
  }
  .hw-filters button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .hw-note { font-size: 0.85rem; color: var(--muted); border-left: 3px solid var(--line); padding-left: 12px; margin: 20px 0 0; }
  .hw-small { font-size: 0.85rem; }
  .hw-print-only { display: none; }
  @media print {
    body * { visibility: hidden; }
    .hw-print-area, .hw-print-area * { visibility: visible; }
    .hw-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
    .hw-print-only { display: block; }
  }
`;

// ---------- component ----------

export default function HabitatWatch() {
  const [state, setState] = useState(() => mergeState(defaultState(), readHash()));
  const firstRender = useRef(true);

  // mirror state into the URL hash (debounced) so a reload restores it
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => writeHash(state), 250);
    return () => clearTimeout(t);
  }, [state]);

  const set = (patch) => setState((s) => ({ ...s, ...patch }));
  const setWatch = (patch) => setState((s) => ({ ...s, watch: { ...s.watch, ...patch } }));
  const setBody = (id, patch) =>
    setState((s) => ({ ...s, watch: { ...s.watch, bodies: { ...s.watch.bodies, [id]: { ...s.watch.bodies[id], ...patch } } } }));
  const setToolkit = (patch) => setState((s) => ({ ...s, toolkit: { ...s.toolkit, ...patch } }));
  const setConcern = (id, on) =>
    setState((s) => ({ ...s, toolkit: { ...s.toolkit, concerns: { ...s.toolkit.concerns, [id]: on } } }));
  const setScore = (id, v) => setState((s) => ({ ...s, score: { ...s.score, [id]: v } }));
  const setHome = (patch) => setState((s) => ({ ...s, home: { ...s.home, ...patch } }));
  const toggleHome = (id) =>
    setState((s) => ({ ...s, home: { ...s.home, done: { ...s.home.done, [id]: !s.home.done[id] } } }));

  const place = [state.watch.county, state.watch.state].filter(Boolean).join(", ");

  return (
    <div className="hw">
      <style>{css}</style>
      <div className="hw-wrap">
        <header className="hw-header">
          <h1>Habitat Watch</h1>
          <p>Concrete local steps to protect wildlife when a data center is proposed in your county.</p>
        </header>

        <nav className="hw-tabs" aria-label="Sections">
          {[
            ["watch", "Watchlist"],
            ["toolkit", "Hearing Toolkit"],
            ["score", "Site Scorecard"],
            ["home", "Home Ground"],
          ].map(([id, label]) => (
            <button key={id} className={"hw-tab" + (state.tab === id ? " on" : "")} onClick={() => set({ tab: id })} aria-current={state.tab === id ? "page" : undefined}>
              {label}
            </button>
          ))}
        </nav>

        {state.tab === "watch" && <Watchlist watch={state.watch} setWatch={setWatch} setBody={setBody} state={state} setState={setState} />}
        {state.tab === "toolkit" && <Toolkit toolkit={state.toolkit} setToolkit={setToolkit} setConcern={setConcern} place={place} />}
        {state.tab === "score" && <Scorecard score={state.score} setScore={setScore} />}
        {state.tab === "home" && <HomeGround home={state.home} setHome={setHome} toggleHome={toggleHome} />}

        <p className="hw-note">
          An honest note: this tool organizes action. It does not predict whether a project will be approved, denied, or conditioned. Showing up prepared with specific asks is the part you control. Nothing here is legal advice, and none of the meeting details or waterway names are pre-filled; you enter what you find.
        </p>
      </div>
    </div>
  );
}

// ---------- 1. Watchlist ----------

function Watchlist({ watch, setWatch, setBody, state, setState }) {
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const trackedCount = BODIES.filter((b) => watch.bodies[b.id].tracked).length;

  const exportJson = () => {
    const text = JSON.stringify(state, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    } else {
      setImportText(text);
    }
  };
  const importJson = () => {
    const parsed = (() => { try { return JSON.parse(importText); } catch { return null; } })();
    if (parsed) { setState((s) => mergeState(s, parsed)); setImportText(""); }
  };

  return (
    <>
      <section className="hw-card">
        <h2>Your county</h2>
        <p className="hw-lede">Enter where you live. Everything below is a checklist of the bodies that typically approve data center projects, with space to record what you find on their websites.</p>
        <div className="hw-row two">
          <div className="hw-field">
            <label htmlFor="county">County</label>
            <input id="county" value={watch.county} onChange={(e) => setWatch({ county: e.target.value })} placeholder="e.g. your county name" autoComplete="off" />
          </div>
          <div className="hw-field">
            <label htmlFor="state">State</label>
            <select id="state" value={watch.state} onChange={(e) => setWatch({ state: e.target.value })}>
              <option value="">Select</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <p className="hw-hint">Tip: the county GIS or tax assessor map will tell you whether a parcel is inside a city, which changes who votes on it.</p>
      </section>

      <section className="hw-card">
        <h2>Approving bodies <span className="hw-pill">{trackedCount} of {BODIES.length} tracked</span></h2>
        <p className="hw-lede">Check each body once you have found its meeting schedule. Paste the agenda or calendar URL so you can get back to it quickly.</p>
        {BODIES.map((b) => {
          const entry = watch.bodies[b.id];
          return (
            <div className="hw-body" key={b.id}>
              <label className="hw-body-head">
                <input type="checkbox" checked={entry.tracked} onChange={(e) => setBody(b.id, { tracked: e.target.checked })} />
                <div>
                  <strong>{b.name}</strong>
                  <span>{b.role}</span>
                </div>
              </label>
              <div className="hw-find"><strong>Where to find it:</strong> {b.find}</div>
              <div className="hw-row half">
                <div className="hw-field">
                  <label htmlFor={`sched-${b.id}`}>Meeting schedule</label>
                  <input id={`sched-${b.id}`} value={entry.schedule} onChange={(e) => setBody(b.id, { schedule: e.target.value })} placeholder="e.g. 2nd Tuesday, 6 pm, Room 100" />
                </div>
                <div className="hw-field">
                  <label htmlFor={`url-${b.id}`}>Agenda / calendar URL</label>
                  <input id={`url-${b.id}`} type="url" inputMode="url" value={entry.agendaUrl} onChange={(e) => setBody(b.id, { agendaUrl: e.target.value })} placeholder="https://" />
                </div>
              </div>
              <div className="hw-field" style={{ marginTop: 10 }}>
                <label htmlFor={`notes-${b.id}`}>Notes (case number, contact, comment sign-up rule)</label>
                <textarea id={`notes-${b.id}`} value={entry.notes} onChange={(e) => setBody(b.id, { notes: e.target.value })} placeholder="Anything you want to remember, e.g. the rezoning case number from the agenda packet" />
              </div>
              {entry.agendaUrl && /^https?:\/\//i.test(entry.agendaUrl) && (
                <p className="hw-hint"><a href={entry.agendaUrl} target="_blank" rel="noopener noreferrer">Open saved link</a></p>
              )}
            </div>
          );
        })}
      </section>

      <section className="hw-card">
        <h2>Saving your work</h2>
        <p className="hw-lede hw-small">
          Your entries are stored in this page's address (the part after #), not in browser storage. Reloading restores them, and bookmarking or sharing the URL carries them with it. For a backup, copy the JSON below and paste it back later.
        </p>
        <div className="hw-btns">
          <button className="hw-btn small" onClick={exportJson}>{copied ? "Copied" : "Copy backup JSON"}</button>
          <button className="hw-btn small ghost" onClick={() => { if (window.confirm("Clear all entries on every tab?")) { setState(defaultState()); writeHash(defaultState()); } }}>Clear everything</button>
        </div>
        <div className="hw-field" style={{ marginTop: 10 }}>
          <label htmlFor="import">Paste backup JSON to restore</label>
          <textarea id="import" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"watch": ...}' />
        </div>
        <div className="hw-btns">
          <button className="hw-btn small ghost" onClick={importJson} disabled={!importText.trim()}>Restore from JSON</button>
        </div>
      </section>
    </>
  );
}

// ---------- 2. Hearing Toolkit ----------

function buildComment({ speaker, project, waterway, concerns, place }) {
  const w = waterway.trim() || "the nearby stream or wetland";
  const p = project.trim() || "the proposed data center";
  const who = speaker.trim() ? `My name is ${speaker.trim()}` : "My name is [your name]";
  const where = place ? `and I live in ${place}` : "and I live in this county";

  const chosen = CONCERNS.filter((c) => concerns[c.id]);
  const intro = `Good evening. ${who}, ${where}. Thank you for the chance to speak. I am here about ${p}. I am not asking you to deny the project outright. I am asking that, if it moves forward, approval come with specific, enforceable conditions that protect ${w} and the wildlife that depends on it.`;

  const body = chosen.map((c) => c.para(w)).join("\n\n");

  const close = `These are reasonable conditions that other jurisdictions have attached to similar projects, and they can be written into the zoning approval or the development agreement so they are enforceable. I would also ask that the applicant answer, on the record, what type of cooling the facility will use and how many gallons of water per day it expects to draw. Thank you for your time.`;

  const parts = [intro];
  if (body) parts.push(body);
  parts.push(close);
  return parts.join("\n\n");
}

function Toolkit({ toolkit, setToolkit, setConcern, place }) {
  const text = useMemo(() => buildComment({ ...toolkit, place }), [toolkit, place]);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = words / 130; // comfortable read-aloud pace
  const mm = Math.floor(minutes);
  const ss = Math.round((minutes - mm) * 60).toString().padStart(2, "0");
  const over = minutes > 3;
  const [copied, setCopied] = useState(false);
  const chosenCount = Object.values(toolkit.concerns).filter(Boolean).length;

  const copy = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    }
  };

  return (
    <>
      <section className="hw-card">
        <h2>Build your public comment</h2>
        <p className="hw-lede">Pick the concerns that apply and name the real waterway or habitat at risk. The generator writes a short, specific, non-hostile statement that asks for permit conditions, not a blanket denial.</p>
        <div className="hw-row half">
          <div className="hw-field">
            <label htmlFor="speaker">Your name (as you will say it)</label>
            <input id="speaker" value={toolkit.speaker} onChange={(e) => setToolkit({ speaker: e.target.value })} placeholder="Optional" />
          </div>
          <div className="hw-field">
            <label htmlFor="project">Project name or case number</label>
            <input id="project" value={toolkit.project} onChange={(e) => setToolkit({ project: e.target.value })} placeholder="From the agenda packet" />
          </div>
        </div>
        <div className="hw-field" style={{ marginTop: 10 }}>
          <label htmlFor="waterway">Local waterway or habitat at risk</label>
          <input id="waterway" value={toolkit.waterway} onChange={(e) => setToolkit({ waterway: e.target.value })} placeholder="e.g. the creek named on the site plan" />
          <p className="hw-hint">Find the name on the applicant's site plan, the county GIS map, or the USGS National Map. If the stream is unnamed, describe it ("the unnamed tributary on the east side of the parcel").</p>
        </div>

        <h3>Concerns to include <span className="hw-pill">{chosenCount} selected</span></h3>
        {CONCERNS.map((c) => (
          <label key={c.id} className="hw-check">
            <input type="checkbox" checked={!!toolkit.concerns[c.id]} onChange={(e) => setConcern(c.id, e.target.checked)} />
            <span>{c.label}</span>
          </label>
        ))}
        <p className="hw-hint">Three or four concerns usually fit comfortably in three minutes. Check the time estimate below.</p>
      </section>

      <section className="hw-card hw-print-area">
        <h2>Your statement</h2>
        <p className="hw-print-only hw-small">Habitat Watch public comment{place ? `, ${place}` : ""}</p>
        <div className="hw-output">{text}</div>
        <p className={"hw-meta" + (over ? " over" : "")}>
          About {words} words, roughly {mm}:{ss} spoken at a steady pace.{over ? " That is over three minutes; remove a concern or trim a sentence." : " Under the typical three-minute limit."}
        </p>
        <div className="hw-btns">
          <button className="hw-btn" onClick={() => window.print()}>Print</button>
          <button className="hw-btn ghost" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
        </div>
        <p className="hw-hint">Check the body's actual time limit; many allow 2 or 3 minutes and cut the mic. Bring a printed copy and hand it to the clerk so it enters the record.</p>
      </section>

      <section className="hw-card">
        <h2>Questions to ask the developer</h2>
        <p className="hw-lede">Ask these at the hearing, at the neighborhood meeting, or by email, and ask for answers in writing. Vague answers are themselves useful to note on the record.</p>
        {DEVELOPER_QUESTIONS.map((q, i) => (
          <div className="hw-q" key={i}>
            <strong>{i + 1}. {q.q}</strong>
            <span>{q.why}</span>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------- 3. Site Scorecard ----------

function Scorecard({ score, setScore }) {
  const rows = SCORE_FIELDS.map((f) => {
    const opt = f.options.find((o) => o.v === score[f.id]);
    return { field: f, opt, pts: opt ? opt.pts : 0 };
  });
  const answered = rows.filter((r) => r.opt).length;
  const total = rows.reduce((s, r) => s + r.pts, 0);
  const dragging = rows.filter((r) => r.opt && r.pts < r.field.max * 0.6).sort((a, b) => (b.field.max - b.pts) - (a.field.max - a.pts));
  const unanswered = rows.filter((r) => !r.opt);

  let verdict = "";
  if (answered === 0) verdict = "Answer the questions above to see a score.";
  else if (answered < SCORE_FIELDS.length) verdict = `Partial score based on ${answered} of ${SCORE_FIELDS.length} factors. Pick "Unknown" where you do not have an answer yet; that is itself a question for the developer.`;
  else if (total >= 80) verdict = "Strong siting. The remaining asks are about locking the good choices into enforceable conditions.";
  else if (total >= 55) verdict = "Mixed. A few conditions would make a real difference; focus on the factors listed below.";
  else verdict = "Poor siting for wildlife as proposed. Each factor below comes with a concrete condition to ask for.";

  return (
    <>
      <section className="hw-card">
        <h2>Score a proposed site</h2>
        <p className="hw-lede">Use what is in the application, the site plan, or the developer's own answers. Do not guess; pick "Unknown" and add it to your question list.</p>
        {SCORE_FIELDS.map((f) => (
          <div className="hw-field" style={{ marginTop: 12 }} key={f.id}>
            <label htmlFor={`sc-${f.id}`}>{f.label} <span className="hw-pill">up to {f.max} pts</span></label>
            <select id={`sc-${f.id}`} value={score[f.id]} onChange={(e) => setScore(f.id, e.target.value)}>
              <option value="">Select</option>
              {f.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
        ))}
        <div className="hw-btns">
          <button className="hw-btn small ghost" onClick={() => SCORE_FIELDS.forEach((f) => setScore(f.id, ""))}>Reset</button>
        </div>
      </section>

      <section className="hw-card">
        <h2>Result</h2>
        <div className="hw-score"><span className="num">{total}</span><span className="of">/ 100</span></div>
        <div className="hw-bar"><div style={{ width: `${total}%` }} /></div>
        <p className="hw-lede">{verdict}</p>

        {dragging.length > 0 && (
          <>
            <h3>What is dragging the score down</h3>
            {dragging.map((r) => (
              <div className="hw-factor low" key={r.field.id}>
                <div className="head"><span>{r.field.label}</span><span>{r.pts} / {r.field.max}</span></div>
                <div className="hw-small" style={{ color: "var(--muted)" }}>{r.opt.label}</div>
                <p className="fix"><strong>Condition to ask for:</strong> {r.field.fix}</p>
              </div>
            ))}
          </>
        )}

        {rows.filter((r) => r.opt && r.pts >= r.field.max * 0.6).length > 0 && (
          <>
            <h3>Holding up</h3>
            {rows.filter((r) => r.opt && r.pts >= r.field.max * 0.6).map((r) => (
              <div className="hw-factor" key={r.field.id}>
                <div className="head"><span>{r.field.label}</span><span>{r.pts} / {r.field.max}</span></div>
                <div className="hw-small" style={{ color: "var(--muted)" }}>{r.opt.label}. Ask that this be written into the approval so it cannot change later.</div>
              </div>
            ))}
          </>
        )}

        {unanswered.length > 0 && answered > 0 && (
          <p className="hw-hint">Not yet answered: {unanswered.map((r) => r.field.label.toLowerCase()).join(", ")}.</p>
        )}
        <p className="hw-hint">The weights are a simple rubric for comparing proposals and organizing your asks, not a regulatory standard.</p>
      </section>
    </>
  );
}

// ---------- 4. Home Ground ----------

function HomeGround({ home, setHome, toggleHome }) {
  const visible = HOME_ITEMS.filter((i) => home.filter === "All" || i.cat === home.filter);
  const doneCount = HOME_ITEMS.filter((i) => home.done[i.id]).length;
  const pct = Math.round((doneCount / HOME_ITEMS.length) * 100);

  return (
    <>
      <section className="hw-card">
        <h2>On your own ground</h2>
        <p className="hw-lede">Large projects fragment habitat. Yards, balconies, and lots stitched together can give wildlife stepping stones. Check things off as you do them.</p>
        <div className="hw-score"><span className="num">{doneCount}</span><span className="of">of {HOME_ITEMS.length} done</span></div>
        <div className="hw-bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="hw-filters" role="tablist" aria-label="Filter by category">
          {HOME_CATS.map((c) => (
            <button key={c} className={home.filter === c ? "on" : ""} onClick={() => setHome({ filter: c })}>
              {c}{c !== "All" ? ` (${HOME_ITEMS.filter((i) => i.cat === c && home.done[i.id]).length}/${HOME_ITEMS.filter((i) => i.cat === c).length})` : ""}
            </button>
          ))}
        </div>
        {visible.map((item) => (
          <label key={item.id} className={"hw-check" + (home.done[item.id] ? " done" : "")}>
            <input type="checkbox" checked={!!home.done[item.id]} onChange={() => toggleHome(item.id)} />
            <span><span className="hw-pill" style={{ marginLeft: 0, marginRight: 6 }}>{item.cat}</span>{item.text}</span>
          </label>
        ))}
        <p className="hw-hint">Migration windows vary by region; your state wildlife agency or a local Audubon chapter publishes the dates that apply where you live.</p>
      </section>
    </>
  );
}
