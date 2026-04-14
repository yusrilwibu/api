// Standalone Vercel serverless handler - no dependencies needed
// Scrapes otakudesu.cloud directly

const https = require('https');
const http = require('http');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'id-ID,id;q=0.9',
        'Referer': 'https://otakudesu.cloud/',
      },
      timeout: 10000,
    };
    const req = lib.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseAnimeCards(html) {
  const items = [];
  const re = /href="https:\/\/otakudesu\.cloud\/anime\/([^\/]+)\/"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>[\s\S]*?(?:class="[^"]*epz[^"]*"[^>]*>([^<]*)<\/div>)?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({
      animeId: m[1],
      poster: m[2],
      title: m[3].trim(),
      episodes: m[4] ? m[4].trim() : null,
    });
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  const url = req.url || '/';
  const qs = url.includes('?') ? Object.fromEntries(new URLSearchParams(url.split('?')[1])) : {};
  const path = url.split('?')[0];
  const page = qs.page || '1';

  try {
    let data = {};

    if (path.includes('/ongoing')) {
      const html = await fetchUrl(`https://otakudesu.cloud/ongoing-anime/page/${page}/`);
      data = { animeList: parseAnimeCards(html) };

    } else if (path.includes('/complete') || path.includes('/completed')) {
      const html = await fetchUrl(`https://otakudesu.cloud/complete-anime/page/${page}/`);
      data = { animeList: parseAnimeCards(html) };

    } else if (path.includes('/search')) {
      const q = qs.q || '';
      const html = await fetchUrl(`https://otakudesu.cloud/?s=${encodeURIComponent(q)}&post_type=anime`);
      data = { animeList: parseAnimeCards(html) };

    } else if (path.includes('/home')) {
      const html = await fetchUrl('https://otakudesu.cloud/');
      data = { animeList: parseAnimeCards(html).slice(0, 20) };

    } else if (path.match(/\/anime\/([^\/\?]+)/)) {
      const animeId = path.match(/\/anime\/([^\/\?]+)/)[1];
      const html = await fetchUrl(`https://otakudesu.cloud/anime/${animeId}/`);

      const titleM = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/);
      const posterM = html.match(/class="[^"]*fotoanime[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/);
      const synM = html.match(/class="[^"]*sinopc[^"]*"[^>]*>([\s\S]*?)<\/div>/);

      const epRe = /href="https:\/\/otakudesu\.cloud\/episode\/([^\/]+)\/"[^>]*>\s*Episode\s+(\d+)/gi;
      const eps = [];
      let em;
      while ((em = epRe.exec(html)) !== null) {
        eps.push({ episodeId: em[1], episodeNum: em[2] });
      }

      data = {
        info: {
          title: titleM ? titleM[1].trim() : animeId,
          poster: posterM ? posterM[1] : '',
          synopsis: synM ? synM[1].replace(/<[^>]+>/g, '').trim() : '',
          totalEpisodes: eps.length.toString(),
        },
        episodeList: eps.reverse(),
      };

    } else if (path.match(/\/episode\/([^\/\?]+)/)) {
      const epId = path.match(/\/episode\/([^\/\?]+)/)[1];
      const html = await fetchUrl(`https://otakudesu.cloud/episode/${epId}/`);

      const titleM = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/);
      const videoRe = /data-video="([^"]+)"/gi;
      const servers = [];
      let vm;
      while ((vm = videoRe.exec(html)) !== null) {
        let vurl = vm[1];
        if (vurl.startsWith('//')) vurl = 'https:' + vurl;
        if (vurl.startsWith('/')) vurl = 'https://otakudesu.cloud' + vurl;
        servers.push({
          serverName: 'Server ' + (servers.length + 1),
          qualities: [{ quality: 'SD', url: vurl }],
        });
      }

      const prevM = html.match(/href="https:\/\/otakudesu\.cloud\/episode\/([^\/]+)\/"[^>]*>[^<]*(?:Prev|laquo)/i);
      const nextM = html.match(/href="https:\/\/otakudesu\.cloud\/episode\/([^\/]+)\/"[^>]*>[^<]*(?:Next|raquo)/i);

      data = {
        title: titleM ? titleM[1].trim() : epId,
        streamingLink: servers,
        prevEpisode: prevM ? prevM[1] : null,
        nextEpisode: nextM ? nextM[1] : null,
      };

    } else if (path.includes('/schedule')) {
      const html = await fetchUrl('https://otakudesu.cloud/jadwal-rilis/');
      const result = {};
      const days = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'];
      for (const day of days) {
        const secRe = new RegExp(`<h2[^>]*>${day}<\\/h2>([\\s\\S]*?)(?=<h2|$)`, 'i');
        const sec = html.match(secRe);
        if (sec) {
          const aRe = /href="https:\/\/otakudesu\.cloud\/anime\/([^\/]+)\/"[^>]*>([^<]+)<\/a>/gi;
          const animes = [];
          let am;
          while ((am = aRe.exec(sec[1])) !== null) {
            animes.push({ animeId: am[1], title: am[2].trim(), poster: '' });
          }
          if (animes.length) result[day.toLowerCase()] = animes;
        }
      }
      data = result;

    } else if (path.includes('/genre')) {
      const html = await fetchUrl('https://otakudesu.cloud/genre-list/');
      const gRe = /href="https:\/\/otakudesu\.cloud\/genres\/([^\/]+)\/"[^>]*>([^<]+)<\/a>/gi;
      const genres = [];
      let gm;
      while ((gm = gRe.exec(html)) !== null) {
        genres.push({ genreId: gm[1], name: gm[2].trim() });
      }
      data = { genreList: genres };

    } else {
      data = { message: 'Otakudesu API - Sub Indo', status: 'OK' };
    }

    res.status(200).json({ statusCode: 200, statusMessage: 'OK', data });
  } catch (err) {
    res.status(500).json({ statusCode: 500, error: err.message });
  }
};
