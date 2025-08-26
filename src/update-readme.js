// update-readme.js — modernizovaný updater pro README
// Autor: cooffeeRequired (upraveno podle požadavků)
// Node: >=18 (CommonJS), bez externích závislostí

const https = require('https');
const fs = require('fs');

/** ====== KONFIGURACE ====== */
const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'cooffeeRequired';
// !! DOPLŇ: svoje veřejné WakaTime share JSON URL (dashboard/share → "Public URLs")
const WAKATIME = {
  timeDataUrl: process.env.WAKA_TIME_DAILY_URL || 'https://wakatime.com/share/@your-id/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json',
  allTimeDataUrl: process.env.WAKA_TIME_ALLTIME_URL || 'https://wakatime.com/share/@your-id/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json',
  languagesDataUrl: process.env.WAKA_TIME_LANGS_URL || 'https://wakatime.com/share/@your-id/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json',
};
const ICON_BASE = process.env.LANG_ICON_BASE || `https://raw.githubusercontent.com/${USERNAME}/${USERNAME}/main/icon-language`;

const SECTIONS = {
  WAKA_MAIN: { start: '<!-- WAKATIME-START -->', end: '<!-- WAKATIME-END -->' },
  LANGS:     { start: '<!-- LANGS-START -->',     end: '<!-- LANGS-END -->' },
  SPARK:     { start: '<!-- SPARK-START -->',     end: '<!-- SPARK-END -->' },
  REPOS:     { start: '<!-- REPOS-START -->',     end: '<!-- REPOS-END -->' },
  COMMITS:   { start: '<!-- COMMITS-START -->',   end: '<!-- COMMITS-END -->' },
};

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'readme-updater', ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data}`));
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Chyba při parsování JSON z ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function padRight(str, len) {
  return (str + ' '.repeat(len)).slice(0, len);
}

function replaceSection(content, startMarker, endMarker, newContent) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return content;
  return content.slice(0, start + startMarker.length) + '\n' + newContent + '\n' + content.slice(end);
}

function createASCIIGraph(dailyData) {
  if (!Array.isArray(dailyData) || dailyData.length === 0) {
    return 'Neočekávaná struktura dat. Nelze vytvořit graf.';
  }
  const graphWidth = 28;
  const dny = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);
  const relevant = dailyData.filter((item) => {
      const dt = new Date(item.range.date);
      dt.setHours(0, 0, 0, 0);
      return dt >= sevenDaysAgo && dt <= today;
    }).sort((a, b) => new Date(a.range.date) - new Date(b.range.date));
  const maxSeconds = Math.max(...relevant.map((i) => i.grand_total.total_seconds || 0), 1);
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(sevenDaysAgo);
    cur.setDate(sevenDaysAgo.getDate() + i);
    const item = relevant.find((d) => new Date(d.range.date).toDateString() === cur.toDateString());
    const seconds = item ? item.grand_total.total_seconds : 0;
    const len = Math.round((seconds / maxSeconds) * graphWidth);
    const bar = '▓'.repeat(len) + '░'.repeat(graphWidth - len);
    const timeText = item ? item.grand_total.text : '0 secs';
    rows.push(`${padRight(dny[cur.getDay()], 9)} │ ${padRight(timeText, 12)} ${bar}`);
  }
  return rows.join('\n');
}

function buildSparklineSVG(values, { width = 500, height = 80, stroke = '#FF61F6', fill = 'none', strokeWidth = 2 } = {}) {
  if (!values || values.length === 0) values = [0];
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = (i * step).toFixed(2);
    const y = (height - (v / max) * (height - 10) - 5).toFixed(2);
    return `${x},${y}`;
  });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><polyline points="${points.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function formatLanguagesData(languagesData) {
  const langs = (languagesData?.data || []).map((lang) => {
    const key = String(lang.name || '').toLowerCase();
    const iconUrl = `${ICON_BASE}/${key}.png`;
    const pct = Number(lang.percent || 0).toFixed(2);
    return `<span><img src="${iconUrl}" height="14" alt="${key}"/> **${key}**: ${pct}%</span>`;
  });
  const perRow = 4;
  const rows = [];
  for (let i = 0; i < langs.length; i += perRow) {
    rows.push(langs.slice(i, i + perRow).join(' &nbsp;•&nbsp; '));
  }
  return rows.join('\n\n');
}

async function getTopRepos(limit = 6) {
  const repos = await fetchJSON(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`);
  repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
  return repos.slice(0, limit).map(r => `- [${r.name}](${r.html_url}) ★ ${r.stargazers_count} — ${r.description || ''}`.trim());
}

async function getRecentCommits(limit = 5) {
  try {
    const commits = await fetchJSON(`https://api.github.com/repos/${USERNAME}/${USERNAME}/commits?per_page=${limit}`);
    return commits.map(c => `- ${c.commit.message} ([view](${c.html_url}))`);
  } catch { return ['(no recent commits found in profile repo)']; }
}

function formatAllTime(allTimeData) {
  const gt = allTimeData?.data?.grand_total;
  if (!gt) return 'All time: N/A';
  return `**All‑time coding:** ${gt.human_readable_total_including_other_language || gt.text || 'N/A'}`;
}

function codeBlock(content) {
  return '```\n' + content + '\n```';
}

(async function main() {
  try {
    const readmePath = 'README.md';
    if (!fs.existsSync(readmePath)) {
      console.error(`Soubor ${readmePath} nebyl nalezen!`);
      process.exit(1);
    }
    const original = fs.readFileSync(readmePath, 'utf-8');
    const [timeDaily, alltime, langs] = await Promise.all([
      fetchJSON(WAKATIME.timeDataUrl),
      fetchJSON(WAKATIME.allTimeDataUrl),
      fetchJSON(WAKATIME.languagesDataUrl),
    ]);
    const ascii = createASCIIGraph(timeDaily.data);
    const allTimeLine = formatAllTime(alltime);
    const daily = (timeDaily.data || []).slice(-30);
    const values = daily.map(d => Number(d.grand_total.total_seconds || 0));
    const sparkSVG = buildSparklineSVG(values, { width: 600, height: 90, stroke: '#00E5FF' });
    const repos = await getTopRepos();
    const commits = await getRecentCommits();
    let updated = original;
    updated = replaceSection(updated, SECTIONS.WAKA_MAIN.start, SECTIONS.WAKA_MAIN.end, allTimeLine + '\n\n' + codeBlock(ascii));
    updated = replaceSection(updated, SECTIONS.LANGS.start, SECTIONS.LANGS.end, formatLanguagesData(langs));
    updated = replaceSection(updated, SECTIONS.SPARK.start, SECTIONS.SPARK.end, sparkSVG);
    updated = replaceSection(updated, SECTIONS.REPOS.start, SECTIONS.REPOS.end, repos.join('\n'));
    updated = replaceSection(updated, SECTIONS.COMMITS.start, SECTIONS.COMMITS.end, commits.join('\n'));
    if (updated !== original) {
      fs.writeFileSync(readmePath, updated);
      console.log('README aktualizován.');
    } else {
      console.log('Žádné změny v README.');
    }
  } catch (e) {
    console.error('Chyba při aktualizaci README:', e.message);
    process.exit(1);
  }
})(); 
