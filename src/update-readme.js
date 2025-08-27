// update-readme.js — modern design + verbose logging/progress
/* eslint-disable no-console */
const https = require('https');
const fs = require('fs');
const { performance } = require('perf_hooks');

// ---- CLI flags ----
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const VERBOSE = ARGS.includes('--verbose');
const NO_ANSI = ARGS.includes('--no-ansi');

// ---- Tuning ----
const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'cooffeeRequired';
const WAKATIME = {
    timeDataUrl: process.env.WAKA_TIME_DAILY_URL,
    allTimeDataUrl: process.env.WAKA_TIME_ALLTIME_URL,
    languagesDataUrl: process.env.WAKA_TIME_LANGS_URL,
};

const SECTIONS = {
    WAKA_MAIN: { start: '<!-- WAKATIME-START -->', end: '<!-- WAKATIME-END -->' },
    LANGS: { start: '<!-- LANGS-START -->', end: '<!-- LANGS-END -->' },
    SPARK: { start: '<!-- SPARK-START -->', end: '<!-- SPARK-END -->' },
    REPOS: { start: '<!-- REPOS-START -->', end: '<!-- REPOS-END -->' },
    COMMITS: { start: '<!-- COMMITS-START -->', end: '<!-- COMMITS-END -->' },
};

// ---- Simple logger with ANSI/emoji ----
const COLORS = NO_ANSI
    ? { r: '', g: '', y: '', b: '', m: '', c: '', dim: '', bold: '', reset: '' }
    : {
          r: '\x1b[31m',
          g: '\x1b[32m',
          y: '\x1b[33m',
          b: '\x1b[34m',
          m: '\x1b[35m',
          c: '\x1b[36m',
          dim: '\x1b[2m',
          bold: '\x1b[1m',
          reset: '\x1b[0m',
      };

const ICONS = NO_ANSI ? { step: '[*]', ok: '[OK]', warn: '[!]', err: '[x]', dot: '-', write: '[W]' } : { step: '⏳', ok: '✅', warn: '⚠️', err: '❌', dot: '•', write: '📝' };

function hr() {
    console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`);
}
function fmt(ms) {
    return `${ms.toFixed(0)}ms`;
}
function step(msg) {
    console.log(`${ICONS.step} ${COLORS.bold}${msg}${COLORS.reset}`);
}
function ok(msg, t) {
    console.log(`${ICONS.ok} ${COLORS.g}${msg}${COLORS.reset}${t ? ` ${COLORS.dim}(${fmt(t)})${COLORS.reset}` : ''}`);
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
        ok(label.replace(/^\w+:\s*/, '') || 'OK', performance.now() - t0);
        return res;
    } catch (e) {
        err(`${label} — ${e.message}`);
        //throw e;
    }
}

// ---- Network helpers ----
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        if (!url) return reject(new Error('URL není definováno (missing env?)'));
        verbose(`GET ${url}`);
        https
            .get(url, { headers: { 'User-Agent': 'readme-updater' } }, res => {
                let data = '';
                res.on('data', chunk => (data += chunk));
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 400) {
                            return reject(new Error(`HTTP ${res.statusCode} při načítání ${url}`));
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Chyba při parsování JSON: ${e.message}`));
                    }
                });
            })
            .on('error', e => reject(e));
    });
}

// ---- README section replacement (with change tracking) ----
function replaceSection(content, startMarker, endMarker, newContent) {
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker);
    if (start === -1 || end === -1 || end < start) {
        return { content, changed: false, reason: 'markers-not-found' };
    }
    const before = content.slice(0, start + startMarker.length);
    const after = content.slice(end);
    const current = content.slice(start + startMarker.length, end);
    const next = `\n${newContent}\n`;
    const changed = current !== next;
    return { content: before + next + after, changed, reason: changed ? 'updated' : 'no-diff' };
}

// ---- Visual blocks builders ----
// Barevný ASCII graf (7 dní) — 🟩 plný, 🟨 částečný, ⬜ prázdný
function createASCIIGraph(dailyData) {
    if (!Array.isArray(dailyData) || dailyData.length === 0) return 'No data';

    const graphWidth = 25;
    const days = ['Ned', 'Pon', 'Úte', 'Stř', 'Čtv', 'Pát', 'Sob'];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 6);

    const relevant = dailyData
        .filter(d => {
            const dt = new Date(d.range.date);
            dt.setHours(0, 0, 0, 0);
            return dt >= weekAgo && dt <= today;
        })
        .sort((a, b) => new Date(a.range.date) - new Date(b.range.date));

    const maxSeconds = Math.max(...relevant.map(d => d.grand_total.total_seconds || 0), 1);

    const graph = [];
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(weekAgo);
        currentDate.setDate(weekAgo.getDate() + i);

        const item = relevant.find(d => {
            const dt = new Date(d.range.date);
            return dt.toDateString() === currentDate.toDateString();
        });

        const seconds = item ? item.grand_total.total_seconds : 0;
        const timeText = item ? item.grand_total.text || '0 secs' : '0 secs';

        const barLength = (seconds / maxSeconds) * graphWidth;
        const fullBlocks = Math.floor(barLength);
        const hasPartial = barLength > fullBlocks ? 1 : 0;

        const bar = '🟩'.repeat(fullBlocks) + (hasPartial ? '🟨' : '') + '⬜'.repeat(Math.max(graphWidth - fullBlocks - hasPartial, 0));

        const dayText = days[currentDate.getDay()].padEnd(3);
        graph.push(`${dayText} │ ${timeText.padEnd(12)} ${bar}`);
    }

    return graph.join('\n');
}

// ---- Kompletní mapping WakaTime názvů na skillicons.dev ----
const WA2SKILL = new Map([
    // Základní jazyky
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['python', 'py'],
    ['java', 'java'],
    ['c', 'c'],
    ['cpp', 'cpp'],
    ['csharp', 'cs'],
    ['go', 'go'],
    ['rust', 'rust'],
    ['kotlin', 'kotlin'],
    ['swift', 'swift'],
    ['dart', 'dart'],
    ['r', 'r'],
    ['scala', 'scala'],
    ['clojure', 'clojure'],
    ['haskell', 'haskell'],
    ['elixir', 'elixir'],
    ['erlang', 'erlang'],
    ['lua', 'lua'],
    ['perl', 'perl'],
    ['php', 'php'],
    ['ruby', 'ruby'],
    ['crystal', 'crystal'],
    ['zig', 'zig'],
    ['v', 'v'],
    ['nim', 'nim'],
    ['ocaml', 'ocaml'],
    ['fsharp', 'fs'],
    ['julia', 'julia'],

    // Web technologie
    ['html', 'html'],
    ['css', 'css'],
    ['scss', 'sass'],
    ['sass', 'sass'],
    ['less', 'less'],
    ['stylus', 'stylus'],
    ['jsx', 'react'],
    ['tsx', 'react'],
    ['vue', 'vue'],
    ['svelte', 'svelte'],
    ['solidjs', 'solidjs'],
    ['angular', 'angular'],
    ['ember', 'ember'],
    ['lit', 'lit'],
    ['htmx', 'htmx'],

    // Databáze
    ['sql', 'mysql'],
    ['mysql', 'mysql'],
    ['postgresql', 'postgres'],
    ['sqlite', 'sqlite'],
    ['mongodb', 'mongodb'],
    ['redis', 'redis'],
    ['cassandra', 'cassandra'],
    ['dynamodb', 'dynamodb'],

    // DevOps a nástroje
    ['docker', 'docker'],
    ['dockerfile', 'docker'],
    ['kubernetes', 'kubernetes'],
    ['terraform', 'terraform'],
    ['ansible', 'ansible'],
    ['jenkins', 'jenkins'],
    ['git', 'git'],
    ['github', 'github'],
    ['gitlab', 'gitlab'],
    ['bitbucket', 'bitbucket'],
    ['githubactions', 'githubactions'],

    // Frameworky a knihovny
    ['react', 'react'],
    ['nextjs', 'nextjs'],
    ['nuxtjs', 'nuxtjs'],
    ['gatsby', 'gatsby'],
    ['express', 'express'],
    ['nestjs', 'nestjs'],
    ['fastapi', 'fastapi'],
    ['django', 'django'],
    ['flask', 'flask'],
    ['spring', 'spring'],
    ['laravel', 'laravel'],
    ['symfony', 'symfony'],
    ['rails', 'rails'],
    ['dotnet', 'dotnet'],
    ['aspnet', 'dotnet'],

    // Cloud a platformy
    ['aws', 'aws'],
    ['azure', 'azure'],
    ['gcp', 'gcp'],
    ['firebase', 'firebase'],
    ['vercel', 'vercel'],
    ['netlify', 'netlify'],
    ['heroku', 'heroku'],
    ['cloudflare', 'cloudflare'],
    ['supabase', 'supabase'],

    // Nástroje a build systémy
    ['nodejs', 'nodejs'],
    ['npm', 'npm'],
    ['yarn', 'yarn'],
    ['pnpm', 'pnpm'],
    ['webpack', 'webpack'],
    ['vite', 'vite'],
    ['rollupjs', 'rollupjs'],
    ['esbuild', 'esbuild'],
    ['swc', 'swc'],
    ['babel', 'babel'],
    ['typescript', 'ts'],
    ['jest', 'jest'],
    ['vitest', 'vitest'],
    ['cypress', 'cypress'],
    ['selenium', 'selenium'],
    ['playwright', 'playwright'],

    // IDE a editory
    ['vscode', 'vscode'],
    ['vim', 'vim'],
    ['neovim', 'neovim'],
    ['emacs', 'emacs'],
    ['intellij', 'idea'],
    ['pycharm', 'pycharm'],
    ['clion', 'clion'],
    ['webstorm', 'webstorm'],
    ['sublime', 'sublime'],
    ['atom', 'atom'],

    // Další
    ['markdown', 'md'],
    ['json', 'json'],
    ['xml', 'xml'],
    ['yaml', 'yaml'],
    ['toml', 'toml'],
    ['ini', 'ini'],
    ['shell', 'bash'],
    ['bash', 'bash'],
    ['powershell', 'powershell'],
    ['gitconfig', 'git'],
    ['git config', 'git'],
    ['gitignore', 'git'],
    ['dockerignore', 'docker'],
    ['env', 'env'],
    ['config', 'config'],
    ['lock', 'lock'],
    ['license', 'license'],
    ['readme', 'md'],
    ['changelog', 'md'],
    ['contributing', 'md'],
    ['code of conduct', 'md'],
    ['other', 'brackets-yellow'], // Pro "Other" jazyky použij lokální ikonu
]);

function toSkillSlug(wakaName) {
    if (!wakaName) return null;
    const n = String(wakaName).toLowerCase().trim();
    if (WA2SKILL.has(n)) return WA2SKILL.get(n);
    // Pokud není v mapování, zkusíme použít název přímo
    return n;
}

// Jazyky → používá pouze lokální ikony z icon-language/ + procenta
function formatLanguagesData(languagesData) {
    console.log('\n=== DEBUG: Language Processing ===');
    (languagesData?.data || []).forEach(l => {
        const original = l.name;
        const slug = toSkillSlug(l.name);
        const iconPath = `icon-language/${slug}.png`;
        const hasLocalIcon = fs.existsSync(iconPath);
        const source = slug ? (hasLocalIcon ? 'LOCAL (fallback)' : 'SKILLICONS (primary)') : 'TEXT';
        console.log(`${original} → ${slug} → ${iconPath} (${source})`);
    });
    console.log('=== END DEBUG ===\n');

    const langs = (languagesData?.data || [])
        .map(l => ({
            raw: l.name,
            slug: toSkillSlug(l.name),
            percent: Number.isFinite(l.percent) ? l.percent : 0,
        }))
        .sort((a, b) => b.percent - a.percent);

    if (langs.length === 0) return 'No languages';

    // Vytvořit jednoduchý seznam jazyků vedle sebe
    const languageItems = [];

    for (const l of langs) {
        if (l.slug) {
            // Kontrola, zda existuje lokální ikona pro fallback
            const iconPath = `icon-language/${l.slug}.png`;
            const hasLocalIcon = fs.existsSync(iconPath);

            // Preferuj skillicons.dev, ale pokud lokální soubor existuje, použij ho jako fallback
            const imgSrc = hasLocalIcon ? iconPath : `https://skillicons.dev/icons?i=${l.slug}`;

            // Určení barvy podle procenta
            let colorClass = '';
            if (l.percent >= 30) colorClass = 'color: #10b981'; // zelená pro vysoká procenta
            else if (l.percent >= 10) colorClass = 'color: #3b82f6'; // modrá pro střední procenta
            else if (l.percent >= 5) colorClass = 'color: #f59e0b'; // oranžová pro nižší procenta
            else colorClass = 'color: #6b7280'; // šedá pro velmi nízká procenta

            languageItems.push(
                `<img src="${imgSrc}" alt="${l.raw}" title="${l.raw} — ${l.percent.toFixed(1)}%" height="42" /> <span style="${colorClass}">\`${l.percent.toFixed(1)}%\`</span>`
            );
        } else {
            // Pokud nemáme slug, zobrazíme pouze text
            // Určení barvy podle procenta
            let colorClass = '';
            if (l.percent >= 30) colorClass = 'color: #10b981'; // zelená pro vysoká procenta
            else if (l.percent >= 10) colorClass = 'color: #3b82f6'; // modrá pro střední procenta
            else if (l.percent >= 5) colorClass = 'color: #f59e0b'; // oranžová pro nižší procenta
            else colorClass = 'color: #6b7280'; // šedá pro velmi nízká procenta

            languageItems.push(`**${l.raw}**: <span style="${colorClass}">\`${l.percent.toFixed(1)}%\`</span>`);
        }
    }

    // Spojit všechny jazyky s konzistentními mezerami a vycentrovat
    return `<p align="center">${languageItems.join(' &nbsp;&nbsp;&nbsp;&nbsp; ')}</p>`;
}

// Top repos → moderní design s ikonami a více informacemi
async function getTopRepos(limit = 5) {
    const repos = await fetchJSON(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`);
    repos.sort((a, b) => b.stargazers_count - a.stargazers_count);

    const topRepos = repos.slice(0, limit);
    const repoCards = topRepos.map(r => {
        // Určení ikony podle jazyka - vždy skillicons.dev
        const language = r.language?.toLowerCase() || 'other';
        const iconSlug = toSkillSlug(language) || 'brackets-yellow';
        const iconSrc = `https://skillicons.dev/icons?i=${iconSlug}`;

        // Formátování dat na jeden řádek
        const stats = [];
        if (r.stargazers_count > 0) stats.push(`⭐ ${r.stargazers_count}`);
        if (r.forks_count > 0) stats.push(`🍴 ${r.forks_count}`);
        const lastCommit = new Date(r.pushed_at).toLocaleDateString('cs-CZ', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
        });
        stats.push(`📅 ${lastCommit}`);

        // Vytvoření jednoduché Markdown karty
        return `**${r.name}** ${r.description ? `\n> ${r.description}` : ''}\n\`${stats.join(' • ')}\` • \`${r.language || 'Other'}\`\n\n`;
    });

    const cardsHtml = repoCards.join('');

    return {
        table: cardsHtml,
        total: repos.length,
        used: Math.min(limit, repos.length),
    };
}

// Commits → moderní timeline s detaily
async function getRecentCommits(limit = 5) {
    try {
        const commits = await fetchJSON(`https://api.github.com/repos/${USERNAME}/${USERNAME}/commits?per_page=${limit}`);

        const commitCards = commits.map(c => {
            const msg = c.commit.message || '';
            const author = c.commit.author?.name || 'Unknown';
            const date = new Date(c.commit.author?.date || Date.now()).toLocaleDateString('cs-CZ', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });

            // Určení emoji podle typu commitu
            let emoji = '📝';
            let badgeText = 'commit';

            if (msg.startsWith('feat')) {
                emoji = '✨';
                badgeText = 'feature';
            } else if (msg.startsWith('fix')) {
                emoji = '🐛';
                badgeText = 'fix';
            } else if (msg.startsWith('chore')) {
                emoji = '🔧';
                badgeText = 'chore';
            } else if (msg.startsWith('docs')) {
                emoji = '📚';
                badgeText = 'docs';
            } else if (msg.startsWith('style')) {
                emoji = '🎨';
                badgeText = 'style';
            } else if (msg.startsWith('refactor')) {
                emoji = '♻️';
                badgeText = 'refactor';
            } else if (msg.startsWith('test')) {
                emoji = '🧪';
                badgeText = 'test';
            } else if (msg.startsWith('perf')) {
                emoji = '⚡';
                badgeText = 'perf';
            }

            // Zkrácení zprávy pokud je příliš dlouhá
            const shortMsg = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;

            return `**${emoji} ${badgeText}** (${date})\n> ${shortMsg}\nby **${author}** • [view commit](${c.html_url})\n\n`;
        });

        const timelineHtml = commitCards.join('');

        return {
            lines: [timelineHtml],
            count: commits.length,
        };
    } catch {
        return {
            lines: ['*(no recent commits found in profile repo)*'],
            count: 0,
        };
    }
}

// Generuje SVG sparkline graf z hodnot
function buildSparklineSVG(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return '<p align="center">No data</p>';
    }

    const width = 120;
    const height = 30;
    const padding = 2;
    const strokeWidth = 1.5;

    // Normalizace hodnot
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const range = maxValue - minValue || 1;

    // Výpočet bodů
    const points = values
        .map((value, index) => {
            const x = padding + (index / (values.length - 1)) * (width - 2 * padding);
            const y = height - padding - ((value - minValue) / range) * (height - 2 * padding);
            return `${x},${y}`;
        })
        .join(' ');

    // Barva na základě trendu
    const firstHalf = values.slice(0, Math.ceil(values.length / 2));
    const secondHalf = values.slice(Math.ceil(values.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const strokeColor = secondAvg > firstAvg ? '#10b981' : secondAvg < firstAvg ? '#ef4444' : '#6b7280';

    return `<p align="center">
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <polyline
    fill="none"
    stroke="${strokeColor}"
    stroke-width="${strokeWidth}"
    points="${points}"
  />
</svg>
</p>`;
}

function codeBlock(content) {
    return '```\n' + content + '\n```';
}

// ---- Main ----
(async function main() {
    hr();
    info(`Spuštěno pro uživatele: ${USERNAME}${DRY_RUN ? ' (dry-run)' : ''}${VERBOSE ? ' (verbose)' : ''}`);
    info(`WakaTime URLS: daily=${Boolean(WAKATIME.timeDataUrl)}, alltime=${Boolean(WAKATIME.allTimeDataUrl)}, langs=${Boolean(WAKATIME.languagesDataUrl)}`);
    hr();

    // 1) Kontrola README
    const readmePath = 'README.md';
    await timed('Kontrola: README existuje', async () => {
        if (!fs.existsSync(readmePath)) throw new Error('README.md nebyl nalezen!');
    });

    const original = fs.readFileSync(readmePath, 'utf-8');
    const summary = [];

    // 2) Načtení dat (paralelně)
    const [timeDaily, alltime, langs] = await timed('Načítám WakaTime + Langs', async () => {
        const res = await Promise.all([fetchJSON(WAKATIME.timeDataUrl), fetchJSON(WAKATIME.allTimeDataUrl), fetchJSON(WAKATIME.languagesDataUrl)]);
        const dailyCount = res?.[0]?.data?.length || 0;
        const langsCount = res?.[2]?.data?.length || 0;
        info(`WakaTime: daily=${dailyCount} záznamů, langs=${langsCount} jazyků`);
        return res;
    });

    // 3) Výpočty grafů
    const { ascii, sparkSVG, allTimeLine } = await timed('Generuji grafy a summary', async () => {
        const ascii = createASCIIGraph(timeDaily?.data || []);
        const daily = (timeDaily?.data || []).slice(-30);
        const values = daily.map(d => d.grand_total?.total_seconds || 0);
        const sparkSVG = buildSparklineSVG(values);
        const allTimeLine = `**All-time coding:** ${alltime?.data?.grand_total?.text || 'N/A'}`;
        verbose(`Sparkline points: ${values.length}`);
        return { ascii, sparkSVG, allTimeLine };
    });

    // 4) Repozitáře a commity
    const { table: reposTable, total: reposTotal, used: reposUsed } = await timed('Sbírám top repozitáře', async () => getTopRepos(5));
    info(`Repozitáře: použito ${reposUsed} z ${reposTotal}`);

    const { lines: commitsLines, count: commitsCount } = await timed('Sbírám poslední commity', async () => getRecentCommits(5));
    info(`Commity: ${commitsCount}`);

    // 5) Sestavení sekcí a náhrady
    let updated = original;
    const replaceAndTrack = (sectionKey, newContent) => {
        const sec = SECTIONS[sectionKey];
        const result = replaceSection(updated, sec.start, sec.end, newContent);
        updated = result.content;
        const changed = result.changed;
        const reason = result.reason;
        summary.push({ section: sectionKey, changed, reason, bytes: newContent.length });
        const label = changed ? `Sekce ${sectionKey} aktualizována` : `Sekce ${sectionKey} beze změny`;
        (changed ? ok : info)(`${label} (${reason})`);
    };

    await timed('Aktualizuji sekce README', async () => {
        replaceAndTrack('WAKA_MAIN', `${allTimeLine}\n\n>📊 Last 7 days\n\n${codeBlock(ascii)}`);
        replaceAndTrack('LANGS', formatLanguagesData(langs));
        replaceAndTrack('SPARK', sparkSVG);
        replaceAndTrack('REPOS', reposTable);
        replaceAndTrack('COMMITS', commitsLines.join('\n'));
    });

    // 6) Zápis nebo dry-run
    await timed(DRY_RUN ? 'Dry-run: porovnání obsahu' : 'Zapisuje se README', async () => {
        if (updated !== original) {
            if (DRY_RUN) {
                info('Změny detekovány, ale kvůli --dry-run se nezapisují.');
            } else {
                fs.writeFileSync(readmePath, updated);
                console.log(`${ICONS.write} ${COLORS.m}README aktualizován.${COLORS.reset}`);
            }
        } else {
            info('Žádné změny k zápisu.');
        }
    });

    // 7) Souhrn
    hr();
    console.log(`${COLORS.bold}Souhrn změn:${COLORS.reset}`);
    summary.forEach(s => {
        const mark = s.changed ? ICONS.ok : ICONS.dot;
        console.log(`${mark} ${s.section.padEnd(10)} — ${s.changed ? COLORS.g + 'updated' : COLORS.c + 'no-diff'}${COLORS.reset} (${s.reason}), ~${s.bytes} B`);
    });
    hr();

    // 8) Varování na chybějící env
    const missing = Object.entries(WAKATIME)
        .filter(([, v]) => !v)
        .map(([k]) => k);
    if (missing.length) {
        warn(`Chybí env proměnné: ${missing.join(', ')} — příslušné sekce mohou být prázdné.`);
    }

    ok('Hotovo');
})().catch(e => {
    err(e.stack || e.message);
    process.exit(1);
});
