// update-readme.js — modern design + verbose logging/progress
/* eslint-disable no-console */
const https = require("https");
const fs = require("fs");
const { performance } = require("perf_hooks");

// ---- CLI flags ----
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const VERBOSE = ARGS.includes("--verbose");
const NO_ANSI = ARGS.includes("--no-ansi");

// ---- Tuning ----
const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || "cooffeeRequired";
const WAKATIME = {
  timeDataUrl: process.env.WAKA_TIME_DAILY_URL,
  allTimeDataUrl: process.env.WAKA_TIME_ALLTIME_URL,
  languagesDataUrl: process.env.WAKA_TIME_LANGS_URL,
};

const SECTIONS = {
  WAKA_MAIN: { start: "<!-- WAKATIME-START -->", end: "<!-- WAKATIME-END -->" },
  LANGS: { start: "<!-- LANGS-START -->", end: "<!-- LANGS-END -->" },
  SPARK: { start: "<!-- SPARK-START -->", end: "<!-- SPARK-END -->" },
  REPOS: { start: "<!-- REPOS-START -->", end: "<!-- REPOS-END -->" },
  COMMITS: { start: "<!-- COMMITS-START -->", end: "<!-- COMMITS-END -->" },
};

// ---- Simple logger with ANSI/emoji ----
const COLORS = NO_ANSI
  ? { r: "", g: "", y: "", b: "", m: "", c: "", dim: "", bold: "", reset: "" }
  : {
      r: "\x1b[31m",
      g: "\x1b[32m",
      y: "\x1b[33m",
      b: "\x1b[34m",
      m: "\x1b[35m",
      c: "\x1b[36m",
      dim: "\x1b[2m",
      bold: "\x1b[1m",
      reset: "\x1b[0m",
    };

const ICONS = NO_ANSI
  ? { step: "[*]", ok: "[OK]", warn: "[!]", err: "[x]", dot: "-", write: "[W]" }
  : { step: "⏳", ok: "✅", warn: "⚠️", err: "❌", dot: "•", write: "📝" };

function hr() {
  console.log(`${COLORS.dim}${"─".repeat(60)}${COLORS.reset}`);
}
function fmt(ms) {
  return `${ms.toFixed(0)}ms`;
}
function step(msg) {
  console.log(`${ICONS.step} ${COLORS.bold}${msg}${COLORS.reset}`);
}
function ok(msg, t) {
  console.log(
    `${ICONS.ok} ${COLORS.g}${msg}${COLORS.reset}${
      t ? ` ${COLORS.dim}(${fmt(t)})${COLORS.reset}` : ""
    }`
  );
}
function warn(msg) {
  console.log(`${ICONS.warn} ${COLORS.y}${msg}${COLORS.reset}`);
}
function err(msg) {
  console.log(`${ICONS.err} ${COLORS.r}${msg}${COLORS.reset}`);
}
function info(msg) {
  console.log(`${ICONS.dot} ${COLORS.c}${msg}${COLORS.reset}`);
}
function verbose(msg) {
  if (VERBOSE) console.log(`${COLORS.dim}${msg}${COLORS.reset}`);
}

// ---- Utils: timed async wrapper ----
async function timed(label, fn) {
  step(label);
  const t0 = performance.now();
  try {
    const res = await fn();
    ok(label.replace(/^\w+:\s*/, "") || "OK", performance.now() - t0);
    return res;
  } catch (e) {
    err(`${label} — ${e.message}`);
    throw e;
  }
}

// ---- Network helpers ----
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("URL není definováno (missing env?)"));
    verbose(`GET ${url}`);
    https
      .get(url, { headers: { "User-Agent": "readme-updater" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              return reject(
                new Error(`HTTP ${res.statusCode} při načítání ${url}`)
              );
            }
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Chyba při parsování JSON: ${e.message}`));
          }
        });
      })
      .on("error", (e) => reject(e));
  });
}

// ---- README section replacement (with change tracking) ----
function replaceSection(content, startMarker, endMarker, newContent) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return { content, changed: false, reason: "markers-not-found" };
  }
  const before = content.slice(0, start + startMarker.length);
  const after = content.slice(end);
  const current = content.slice(start + startMarker.length, end);
  const next = `\n${newContent}\n`;
  const changed = current !== next;
  return {
    content: before + next + after,
    changed,
    reason: changed ? "updated" : "no-diff",
  };
}

// ---- Visual blocks builders ----
// ASCII graf (7 dní)
function createASCIIGraph(dailyData) {
  if (!Array.isArray(dailyData) || dailyData.length === 0) return "No data";
  const graphWidth = 28;
  const days = ["Ned", "Pon", "Úte", "Stř", "Čtv", "Pát", "Sob"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);

  const relevant = dailyData.filter((d) => {
    const dt = new Date(d.range.date);
    dt.setHours(0, 0, 0, 0);
    return dt >= weekAgo && dt <= today;
  });
  const max = Math.max(
    ...relevant.map((d) => d.grand_total.total_seconds || 0),
    1
  );

  return relevant
    .map((item) => {
      const dt = new Date(item.range.date);
      const seconds = item.grand_total.total_seconds || 0;
      const len = Math.round((seconds / max) * graphWidth);
      const bar = "▓".repeat(len) + "░".repeat(graphWidth - len);
      const label = (item.grand_total.text || "0s").padEnd(10);
      return `${days[dt.getDay()]} │ ${label} ${bar}`;
    })
    .join("\n");
}

// Sparkline (30 dní)
function buildSparklineSVG(
  values,
  { width = 500, height = 80, stroke = "#FF61F6" } = {}
) {
  if (!values || values.length === 0) values = [0];
  const max = Math.max(...values, 1);
  const stepX = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = (i * stepX).toFixed(2);
    const y = (height - (v / max) * (height - 10) - 5).toFixed(2);
    return `${x},${y}`;
  });
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="30-day coding sparkline">
  <polyline points="${points.join(
    " "
  )}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// Jazyky → Skill icons + procenta
function formatLanguagesData(languagesData) {
  const langs = (languagesData?.data || []).map((lang) => ({
    name: (lang.name || "").toLowerCase().replace(/\s+/g, ""),
    percent: Number.isFinite(lang.percent) ? lang.percent.toFixed(1) : "0.0",
  }));
  if (langs.length === 0) return "No languages";
  const url = `https://skillicons.dev/icons?i=${langs
    .map((l) => l.name)
    .join(",")}&perline=8`;
  const list = langs.map((l) => `**${l.name}**: ${l.percent}%`).join(" · ");
  return `<p align="center"><img src="${url}" alt="Language skill icons"/></p>\n<p align="center">${list}</p>`;
}

// Top repos → tabulka
async function getTopRepos(limit = 5) {
  const repos = await fetchJSON(
    `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`
  );
  repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
  const rows = repos.slice(0, limit).map((r) => {
    const stars = `★ ${r.stargazers_count}`;
    const lastCommit = new Date(r.pushed_at).toISOString().split("T")[0];
    return `| [${r.name}](${r.html_url}) | ${stars} | ${lastCommit} |`;
  });
  return {
    table: `| Repo | Stars | Last commit |\n|------|-------|-------------|\n${rows.join(
      "\n"
    )}`,
    total: repos.length,
    used: Math.min(limit, repos.length),
  };
}

// Commits → timeline styl
async function getRecentCommits(limit = 5) {
  try {
    const commits = await fetchJSON(
      `https://api.github.com/repos/${USERNAME}/${USERNAME}/commits?per_page=${limit}`
    );
    return {
      lines: commits.map((c) => {
        const msg = c.commit.message || "";
        let emoji = "📝";
        if (msg.startsWith("feat")) emoji = "✨";
        else if (msg.startsWith("fix")) emoji = "🐛";
        else if (msg.startsWith("chore")) emoji = "🔧";
        return `- ${emoji} ${msg} ([view](${c.html_url}))`;
      }),
      count: commits.length,
    };
  } catch {
    return { lines: ["(no recent commits found in profile repo)"], count: 0 };
  }
}

function codeBlock(content) {
  return "```\n" + content + "\n```";
}

// ---- Main ----
(async function main() {
  hr();
  info(
    `Spuštěno pro uživatele: ${USERNAME}${DRY_RUN ? " (dry-run)" : ""}${
      VERBOSE ? " (verbose)" : ""
    }`
  );
  info(
    `WakaTime URLS: daily=${Boolean(WAKATIME.timeDataUrl)}, alltime=${Boolean(
      WAKATIME.allTimeDataUrl
    )}, langs=${Boolean(WAKATIME.languagesDataUrl)}`
  );
  hr();

  // 1) Kontrola README
  const readmePath = "README.md";
  await timed("Kontrola: README existuje", async () => {
    if (!fs.existsSync(readmePath)) throw new Error("README.md nebyl nalezen!");
  });

  const original = fs.readFileSync(readmePath, "utf-8");
  const summary = [];

  // 2) Načtení dat (paralelně)
  const [timeDaily, alltime, langs] = await timed(
    "Načítám WakaTime + Langs",
    async () => {
      console.log(WAKATIME);
      const res = await Promise.all([
        fetchJSON(WAKATIME.timeDataUrl),
        fetchJSON(WAKATIME.allTimeDataUrl),
        fetchJSON(WAKATIME.languagesDataUrl),
      ]);
      const dailyCount = res?.[0]?.data?.length || 0;
      const langsCount = res?.[2]?.data?.length || 0;
      info(`WakaTime: daily=${dailyCount} záznamů, langs=${langsCount} jazyků`);
      return res;
    }
  );

  // 3) Výpočty grafů
  const { ascii, sparkSVG, allTimeLine } = await timed(
    "Generuji grafy a summary",
    async () => {
      const ascii = createASCIIGraph(timeDaily?.data || []);
      const daily = (timeDaily?.data || []).slice(-30);
      const values = daily.map((d) => d.grand_total?.total_seconds || 0);
      const sparkSVG = buildSparklineSVG(values);
      const allTimeLine = `**All-time coding:** ${
        alltime?.data?.grand_total?.text || "N/A"
      }`;
      verbose(`Sparkline points: ${values.length}`);
      return { ascii, sparkSVG, allTimeLine };
    }
  );

  // 4) Repozitáře a commity
  const {
    table: reposTable,
    total: reposTotal,
    used: reposUsed,
  } = await timed("Sbírám top repozitáře", async () => getTopRepos(5));
  info(`Repozitáře: použito ${reposUsed} z ${reposTotal}`);

  const { lines: commitsLines, count: commitsCount } = await timed(
    "Sbírám poslední commity",
    async () => getRecentCommits(5)
  );
  info(`Commity: ${commitsCount}`);

  // 5) Sestavení sekcí a náhrady
  let updated = original;

  const replaceAndTrack = (sectionKey, newContent) => {
    const sec = SECTIONS[sectionKey];
    const result = replaceSection(updated, sec.start, sec.end, newContent);
    updated = result.content;
    const changed = result.changed;
    const reason = result.reason;
    summary.push({
      section: sectionKey,
      changed,
      reason,
      bytes: newContent.length,
    });
    const label = changed
      ? `Sekce ${sectionKey} aktualizována`
      : `Sekce ${sectionKey} beze změny`;
    (changed ? ok : info)(`${label} (${reason})`);
  };

  await timed("Aktualizuji sekce README", async () => {
    replaceAndTrack(
      "WAKA_MAIN",
      `${allTimeLine}\n\n<details><summary>📊 Posledních 7 dní</summary>\n\n${codeBlock(
        ascii
      )}\n</details>`
    );
    replaceAndTrack("LANGS", formatLanguagesData(langs));
    replaceAndTrack("SPARK", sparkSVG);
    replaceAndTrack("REPOS", reposTable);
    replaceAndTrack("COMMITS", commitsLines.join("\n"));
  });

  // 6) Zápis nebo dry-run
  await timed(
    DRY_RUN ? "Dry-run: porovnání obsahu" : "Zapisuje se README",
    async () => {
      if (updated !== original) {
        if (DRY_RUN) {
          info("Změny detekovány, ale kvůli --dry-run se nezapisují.");
        } else {
          fs.writeFileSync(readmePath, updated);
          console.log(
            `${ICONS.write} ${COLORS.m}README aktualizován.${COLORS.reset}`
          );
        }
      } else {
        info("Žádné změny k zápisu.");
      }
    }
  );

  // 7) Souhrn
  hr();
  console.log(`${COLORS.bold}Souhrn změn:${COLORS.reset}`);
  summary.forEach((s) => {
    const mark = s.changed ? ICONS.ok : ICONS.dot;
    console.log(
      `${mark} ${s.section.padEnd(10)} — ${
        s.changed ? COLORS.g + "updated" : COLORS.c + "no-diff"
      }${COLORS.reset} (${s.reason}), ~${s.bytes} B`
    );
  });
  hr();

  // 8) Varování na chybějící env
  const missing = Object.entries(WAKATIME)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    warn(
      `Chybí env proměnné: ${missing.join(
        ", "
      )} — příslušné sekce mohou být prázdné.`
    );
  }

  ok("Hotovo");
})().catch((e) => {
  err(e.stack || e.message);
  process.exit(1);
});
