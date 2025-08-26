// update-readme.js — modernizovaná verze s Skill Icons
// Autor: cooffeeRequired

const https = require("https");
const fs = require("fs");

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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "readme-updater" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Chyba při parsování JSON: ${e.message}`));
          }
        });
      })
      .on("error", (err) => reject(err));
  });
}

function replaceSection(content, startMarker, endMarker, newContent) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) return content;
  return (
    content.slice(0, start + startMarker.length) +
    "\n" +
    newContent +
    "\n" +
    content.slice(end)
  );
}

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
  const max = Math.max(...relevant.map((d) => d.grand_total.total_seconds || 0), 1);
  return relevant
    .map((item) => {
      const dt = new Date(item.range.date);
      const seconds = item.grand_total.total_seconds || 0;
      const len = Math.round((seconds / max) * graphWidth);
      const bar = "▓".repeat(len) + "░".repeat(graphWidth - len);
      return `${days[dt.getDay()]} │ ${item.grand_total.text.padEnd(10)} ${bar}`;
    })
    .join("\n");
}

function buildSparklineSVG(values, { width = 500, height = 80, stroke = "#FF61F6" } = {}) {
  if (!values || values.length === 0) values = [0];
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = (i * step).toFixed(2);
    const y = (height - (v / max) * (height - 10) - 5).toFixed(2);
    return `${x},${y}`;
  });
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <polyline points="${points.join(" ")}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// 🔥 místo vlastních PNG generujeme skill icons
function formatLanguagesData(languagesData) {
  const langs = (languagesData?.data || [])
    .map((lang) => lang.name.toLowerCase().replace(/\s+/g, ""))
    .filter(Boolean);

  if (langs.length === 0) return "No languages";

  const url = `https://skillicons.dev/icons?i=${langs.join(",")}&perline=8`;
  return `<p align="center"><img src="${url}"/></p>`;
}

async function getTopRepos(limit = 5) {
  const repos = await fetchJSON(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`);
  repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
  return repos.slice(0, limit).map((r) => `- [${r.name}](${r.html_url}) ★ ${r.stargazers_count}`);
}

async function getRecentCommits(limit = 5) {
  try {
    const commits = await fetchJSON(`https://api.github.com/repos/${USERNAME}/${USERNAME}/commits?per_page=${limit}`);
    return commits.map((c) => `- ${c.commit.message} ([view](${c.html_url}))`);
  } catch {
    return ["(no recent commits found in profile repo)"];
  }
}

function codeBlock(content) {
  return "```\n" + content + "\n```";
}

(async function main() {
  const readmePath = "README.md";
  if (!fs.existsSync(readmePath)) {
    console.error("README.md nebyl nalezen!");
    process.exit(1);
  }
  const original = fs.readFileSync(readmePath, "utf-8");

  const [timeDaily, alltime, langs] = await Promise.all([
    fetchJSON(WAKATIME.timeDataUrl),
    fetchJSON(WAKATIME.allTimeDataUrl),
    fetchJSON(WAKATIME.languagesDataUrl),
  ]);

  const ascii = createASCIIGraph(timeDaily.data);
  const allTimeLine = `**All-time coding:** ${alltime.data?.grand_total?.text || "N/A"}`;
  const daily = (timeDaily.data || []).slice(-30);
  const values = daily.map((d) => d.grand_total.total_seconds || 0);
  const sparkSVG = buildSparklineSVG(values);

  const repos = await getTopRepos();
  const commits = await getRecentCommits();

  let updated = original;
  updated = replaceSection(updated, SECTIONS.WAKA_MAIN.start, SECTIONS.WAKA_MAIN.end, allTimeLine + "\n\n" + codeBlock(ascii));
  updated = replaceSection(updated, SECTIONS.LANGS.start, SECTIONS.LANGS.end, formatLanguagesData(langs));
  updated = replaceSection(updated, SECTIONS.SPARK.start, SECTIONS.SPARK.end, sparkSVG);
  updated = replaceSection(updated, SECTIONS.REPOS.start, SECTIONS.REPOS.end, repos.join("\n"));
  updated = replaceSection(updated, SECTIONS.COMMITS.start, SECTIONS.COMMITS.end, commits.join("\n"));

  if (updated !== original) {
    fs.writeFileSync(readmePath, updated);
    console.log("README aktualizován.");
  } else {
    console.log("Žádné změny.");
  }
})();
