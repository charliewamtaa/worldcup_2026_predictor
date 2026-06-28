// scripts/fetch-scores.mjs
// Runs inside GitHub Actions. Calls your football data provider with a key kept
// in GitHub Secrets, then writes a clean scores.json that the static site reads.
// No dependencies — uses Node 20's built-in fetch. Output is a flat list:
//   { updated: <iso>, matches: [ { home, away, hs, as, status } ] }
// The web page matches each entry onto its fixtures by TEAM PAIR, so the exact
// team spelling and the provider's own match IDs don't matter here.

import { writeFile } from 'node:fs/promises';

const OUT_PATH = 'scores.json';            // change to 'docs/scores.json' if Pages serves from /docs
const API_KEY  = process.env.API_KEY || '';

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS — pick one by setting PROVIDER below. Each returns the same shape.
// Verify your plan includes LIVE (in-play) scores, not just final results.
// ─────────────────────────────────────────────────────────────────────────────
const PROVIDER = process.env.PROVIDER || 'football-data';

const PROVIDERS = {
  // 1) football-data.org  ·  header: X-Auth-Token  ·  competition code: WC
  'football-data': {
    url: 'https://api.football-data.org/v4/competitions/WC/matches',
    headers: () => ({ 'X-Auth-Token': API_KEY }),
    parse: (j) => (j.matches || []).map(m => ({
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      hs:   m.score?.fullTime?.home,        // null until the match kicks off
      as:   m.score?.fullTime?.away,
      status: m.status                       // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED
    })),
  },

  // 2) API-Football (api-sports.io)  ·  header: x-apisports-key  ·  league 1 = World Cup
  'api-football': {
    url: 'https://v3.football.api-sports.io/fixtures?league=1&season=2026',
    headers: () => ({ 'x-apisports-key': API_KEY }),
    parse: (j) => (j.response || []).map(f => ({
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      hs:   f.goals?.home,
      as:   f.goals?.away,
      status: f.fixture?.status?.short        // NS | 1H | HT | 2H | FT | AET | PEN
    })),
  },

  // 3) worldcup26.ir  ·  free, no key  ·  best-effort field guessing
  'worldcup26': {
    url: 'https://worldcup26.ir/get/games',
    headers: () => ({}),
    parse: (j) => {
      const arr = Array.isArray(j) ? j : (j.games || j.data || j.matches || []);
      return arr.map(m => ({
        home: m.home_team ?? m.home ?? m.team1 ?? m.homeName,
        away: m.away_team ?? m.away ?? m.team2 ?? m.awayName,
        hs:   numOrNull(m.home_score ?? m.homeScore ?? m.score_home ?? m.hs),
        as:   numOrNull(m.away_score ?? m.awayScore ?? m.score_away ?? m.as),
        status: m.status ?? m.state ?? ''
      }));
    },
  },
};

function numOrNull(v){ return (v===''||v===null||v===undefined||isNaN(+v)) ? null : +v; }

async function main(){
  const p = PROVIDERS[PROVIDER];
  if(!p){ console.error('Unknown PROVIDER:', PROVIDER); process.exit(1); }
  if(PROVIDER !== 'worldcup26' && !API_KEY){
    console.error('Missing API_KEY secret.'); process.exit(1);
  }

  let matches = [];
  try{
    const res = await fetch(p.url, { headers: p.headers() });
    if(!res.ok){ console.error('API error', res.status, await res.text().catch(()=> '')); process.exit(1); }
    const json = await res.json();
    matches = p.parse(json)
      .filter(m => m.home && m.away)                 // drop junk rows
      .map(m => ({ home:m.home, away:m.away,
                   hs: numOrNull(m.hs), as: numOrNull(m.as),
                   status: m.status || '' }));
  }catch(err){
    console.error('Fetch failed:', err.message); process.exit(1);
  }

  const out = { updated: new Date().toISOString(), matches };
  await writeFile(OUT_PATH, JSON.stringify(out));
  const withScores = matches.filter(m => m.hs!=null && m.as!=null).length;
  console.log(`Wrote ${OUT_PATH}: ${matches.length} fixtures, ${withScores} with scores.`);
}

main();
