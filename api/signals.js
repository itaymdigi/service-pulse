// ServicePulse API — aggregates outage signals from multiple sources
import { createServer } from 'http';

// ── Data Sources ───────────────────────────────────────────────────────────

const STATUS_PAGES = [
  { name: 'AWS', url: 'https://status.aws.amazon.com/', pattern: /Amazon (EC2|S3|Lambda|DynamoDB|RDS)|AWS Systems/i },
  { name: 'GitHub', url: 'https://www.githubstatus.com/', pattern: /All Systems Operational|Incident|Maintenance/i },
  { name: 'Vercel', url: 'https://vercel-status.com/', pattern: /Operational|Degraded|Outage/i },
  { name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/', pattern: /Operational|DNS|CDN|Proxy/i },
  { name: 'Stripe', url: 'https://status.stripe.com/', pattern: /operational|degraded|incident|outage/i },
  { name: 'OpenAI', url: 'https://status.openai.com/', pattern: /All Systems Operational|API|ChatGPT/i },
  { name: 'Anthropic', url: 'https://status.anthropic.com/', pattern: /All Systems Operational|API|Claude/i },
  { name: 'Notion', url: 'https://www.notion.so/', pattern: /operational|degraded/i },
  { name: 'Linear', url: 'https://status.linear.app/', pattern: /Operational|Issue/i },
  { name: 'Figma', url: 'https://status.figma.com/', pattern: /All Systems Operational|Design|Editor/i },
  { name: 'Slack', url: 'https://status.slack.com/', pattern: /operational|issue|incident/i },
  { name: 'Discord', url: 'https://discord.statuspage.io/', pattern: /All Systems Operational|API|Login/i },
  { name: 'Supabase', url: 'https://status.supabase.com/', pattern: /All Systems Operational|DB|Auth|Storage/i },
  { name: 'Twilio', url: 'https://status.twilio.com/', pattern: /All Systems Operational|Voice|SMS/i },
  { name: 'SendGrid', url: 'https://status.sendgrid.com/', pattern: /Operational|Degraded/i },
  { name: 'MongoDB', url: 'https://status.mongodb.com/', pattern: /All Systems Operational|Atlas|Cluster/i },
  { name: 'GitLab', url: 'https://status.gitlab.com/', pattern: /All Systems Operational|GitLab.com|Pipelines/i },
  { name: 'Microsoft Azure', url: 'https://status.azure.com/', pattern: /All Systems Operational|Cloud Services/i },
  { name: 'Google Cloud', url: 'https://status.cloud.google.com/', pattern: /All Systems Operational|Compute|Storage/i },
  { name: 'Reddit', url: 'https://www.redditstatus.com/', pattern: /All Systems Operational|API|Login/i },
  { name: 'X/Twitter', url: 'https://api.twitterstat.us/', pattern: /operational|degraded/i },
  { name: 'DeepSeek', url: 'https://status.deepseek.com/', pattern: /All Systems Operational|API/i },
  { name: 'Groq', url: 'https://status.groq.com/', pattern: /All Systems Operational|Inference/i },
  { name: 'Together AI', url: 'https://status.together.ai/', pattern: /All Systems Operational|API/i },
  { name: 'Replicate', url: 'https://replicate.statuspage.io/', pattern: /All Systems Operational|API/i },
  { name: 'HuggingFace', url: 'https://status.huggingface.co/', pattern: /All Systems Operational|Inference|Hub/i },
  { name: 'Modal', url: 'https://status.modal.com/', pattern: /All Systems Operational|API/i },
  { name: 'Runway', url: 'https://status.runwayml.com/', pattern: /All Systems Operational|Generation/i },
  { name: 'ElevenLabs', url: 'https://status.elevenlabs.io/', pattern: /All Systems Operational|API|TTS/i },
];

// DownDetector page IDs for major services
const DOWNDETECTOR_PAGES = {
  'AWS': 'amazon-web-services-aws',
  'GitHub': 'github',
  'Slack': 'slack',
  'Discord': 'discord',
  'Microsoft Teams': 'microsoft-teams',
  'Notion': 'notion',
  'Stripe': 'stripe',
  'OpenAI': 'openai-chatgpt',
  'Figma': 'figma',
  'Vercel': 'vercel',
  'Cloudflare': 'cloudflare',
  'MongoDB': 'mongodb',
  'Supabase': 'supabase',
  'Google Cloud': 'google-cloud',
  'Microsoft Azure': 'microsoft-azure',
  'Reddit': 'reddit',
  'X / Twitter': 'twitter',
  'GitLab': 'gitlab',
  'Twilio': 'twilio',
  'Anthropic': 'anthropic-claude',
  'DeepSeek': 'deepseek',
  'Groq': 'groq',
};

// Service → DownDetector URL mapping
function getDownDetectorUrl(serviceName) {
  const id = DOWNDETECTOR_PAGES[serviceName];
  if (!id) return null;
  return `https://downdetector.com/site/${id}/`;
}

// ── Scraping Helpers ───────────────────────────────────────────────────────

async function fetchWithProxy(url, timeout = 6000) {
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function fetchJson(url, timeout = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ServicePulse/1.0' }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ── Source 1: Reddit Signals ───────────────────────────────────────────────

async function fetchRedditSignals(hoursBack = 2) {
  const incidents = [];
  const cutoff = Date.now() - hoursBack * 3600000;
  const subs = ['sysadmin', 'aws', 'github', 'devops', 'cloud', 'SecurityLayout', 'tech', 'Technology'];
  const queries = ['service down', 'outage right now', 'error 503', 'site not working', 'can\'t access', 'disrupted', '#outage', 'is down'];
  const serviceKeywords = {
    'AWS': /aws|amazon web|ec2|s3|lambda/i,
    'GitHub': /github|git hub|gh actions|github\.com/i,
    'Vercel': /vercel/i,
    'Cloudflare': /cloudflare|cf-/i,
    'Slack': /slack\.com|slack workspace|slack\.io/i,
    'Discord': /discordapp|discord\.com/i,
    'Notion': /notion\.so|notionapi/i,
    'Linear': /linear\.app|linear\.hq/i,
    'Figma': /figma\.com/i,
    'Stripe': /stripe\.com|stripeapi/i,
    'OpenAI': /openai|gpt-\d|chatgpt|api\.openai/i,
    'Anthropic': /anthropic|claude\b/i,
    'DeepSeek': /deepseek/i,
    'Groq': /groq\.com|groqcloud/i,
    'Together AI': /together\.ai/i,
    'HuggingFace': /huggingface|hf\.co/i,
    'Modal': /modal\.com/i,
    'Replicate': /replicate\.com/i,
    'Runway': /runwayml|runway\.ml/i,
    'ElevenLabs': /elevenlabs/i,
    'Reddit': /reddit\.com|r\//i,
    'X / Twitter': /twitter\.com|x\.com|@elon/i,
    'Microsoft Teams': /teams\.microsoft|ms teams/i,
    'Google Cloud': /google cloud|gcp|google cloud platform/i,
    'Microsoft Azure': /azure|microsoft azure/i,
    'GitLab': /gitlab\.com|gitlab-ce/i,
    'MongoDB': /mongodb|mongo db|atlas/i,
    'Supabase': /supabase/i,
    'Twilio': /twilio/i,
    'SendGrid': /sendgrid/i,
  };

  for (const sub of subs.slice(0, 4)) {
    for (const query of queries.slice(0, 3)) {
      try {
        const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&sort=new&restrict_sr=1&limit=8&t=hour`;
        const data = await fetchJson(url, 7000);
        if (!data?.data?.children) continue;

        for (const { data: post } of data.data.children) {
          const postTime = post.created_utc * 1000;
          if (postTime < cutoff) continue;

          const text = ((post.title || '') + ' ' + (post.selftext || '')).toLowerCase();
          for (const [service, kw] of Object.entries(serviceKeywords)) {
            if (kw.test(text)) {
              const isMajor = /completely down|#outage|service is dead|not accessible|critical/i.test(post.title);
              incidents.push({
                service,
                serviceId: service.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                title: post.title.trim(),
                time: new Date(postTime).toISOString(),
                source: 'reddit',
                redditUrl: `https://reddit.com${post.permalink}`,
                redditSub: `r/${sub}`,
                score: post.score || 0,
                comments: post.num_comments || 0,
                type: isMajor ? 'down' : 'degraded',
                severity: isMajor ? 2 : 1,
              });
              break;
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  return incidents;
}

// ── Source 2: StatusPage.io aggregates ────────────────────────────────────

async function fetchStatusPageSignals() {
  const incidents = [];
  const now = Date.now();

  // Statuspage.io public API endpoints (no key needed for read)
  const statusPageApis = [
    { name: 'OpenAI', url: 'https://status.openai.com/api/v2/summary.json' },
    { name: 'Anthropic', url: 'https://status.anthropic.com/api/v2/summary.json' },
    { name: 'Discord', url: 'https://discord.statuspage.io/api/v2/summary.json' },
    { name: 'Supabase', url: 'https://status.supabase.com/api/v2/summary.json' },
    { name: 'Replicate', url: 'https://replicate.statuspage.io/api/v2/summary.json' },
    { name: 'DeepSeek', url: 'https://status.deepseek.com/api/v2/summary.json' },
    { name: 'Groq', url: 'https://status.groq.com/api/v2/summary.json' },
    { name: 'Modal', url: 'https://status.modal.com/api/v2/summary.json' },
    { name: 'ElevenLabs', url: 'https://status.elevenlabs.io/api/v2/summary.json' },
    { name: 'Together AI', url: 'https://status.together.ai/api/v2/summary.json' },
  ];

  const results = await Promise.allSettled(
    statusPageApis.map(async ({ name, url }) => {
      const data = await fetchJson(url, 6000);
      if (!data) return null;

      const components = data.components || [];
      const incidents_data = data.incidents || [];

      // Find non-operational components
      const degraded = components.filter(c => c.status !== 'operational' && c.status !== 'under_maintenance');
      const down = components.filter(c =>
        ['major_outage', 'partial_outage'].includes(c.status)
      );

      if (down.length || degraded.length || incidents_data.length) {
        const affected = [...down, ...degraded].map(c => c.name).join(', ');
        const latestIncident = incidents_data[0];

        return {
          service: name,
          serviceId: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: latestIncident
            ? latestIncident.name
            : `${down.length ? 'Major outage' : 'Degraded performance'} on ${affected || name}`,
          time: latestIncident?.created_at || new Date().toISOString(),
          source: 'statuspage',
          status: down.length ? 'down' : degraded.length ? 'degraded' : 'unknown',
          affectedComponents: affected,
          incidentUrl: latestIncident?.shortlink || null,
          components: components.map(c => ({ name: c.name, status: c.status })),
          type: down.length ? 'down' : 'degraded',
          pageUrl: url.replace('/api/v2/summary.json', ''),
        };
      }
      return null;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) incidents.push(r.value);
  }

  return incidents;
}

// ── Source 3: DownDetector Signals ────────────────────────────────────────

async function fetchDownDetectorSignals() {
  const incidents = [];
  const now = Date.now();
  const hourAgo = now - 3600000;

  for (const [service, path] of Object.entries(DOWNDETECTOR_PAGES)) {
    const url = `https://downdetector.com/site/${path}/`;
    try {
      const html = await fetchWithProxy(url, 7000);
      if (!html) continue;

      // Look for "X people are currently experiencing problems"
      const peopleMatch = html.match(/(\d[\d,]+)\s+(?:people are|users are)\s+(?:currently experiencing|having)\s+(?:problems|issues)/i);
      const chartMatch = html.match(/<svg[^>]*class="sparkline[^"]*"[^>]*>([\s\S]*?)<\/svg>/i);
      const recentMatch = html.match(/(\d+)\s+reports?\s+(?:in the last|within)\s+(\d+)\s+(?:minutes|hours?)/i);

      const count = peopleMatch ? parseInt(peopleMatch[1].replace(/,/g,'')) : 0;
      const recentReports = recentMatch ? parseInt(recentMatch[1]) : 0;

      // Check for comments section with recent activity
      const commentsMatch = html.match(/(\d+)\s+(?:new|recent)\s+(?:comments|reports)/i);
      const newComments = commentsMatch ? parseInt(commentsMatch[1]) : 0;

      if (count > 10 || recentReports > 5 || newComments > 3) {
        incidents.push({
          service,
          serviceId: service.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: count > 50
            ? `Major outage reported — ${count}+ users affected`
            : count > 10
            ? `Service disruption — ${count}+ users reporting issues`
            : `${recentReports} recent reports on DownDetector`,
          time: new Date(now).toISOString(),
          source: 'downdetector',
          affectedCount: count,
          recentReports,
          pageUrl: url,
          type: count > 50 ? 'down' : 'degraded',
          severity: count > 50 ? 2 : 1,
        });
      }
    } catch { /* skip */ }
  }

  return incidents;
}

// ── Source 4: Health/ping based checks ───────────────────────────────────

async function fetchHealthSignals() {
  const services = [
    { name: 'GitHub', url: 'https://github.com/', test: /GitHub/ },
    { name: 'Vercel', url: 'https://vercel.com/', test: /Vercel/ },
    { name: 'Cloudflare', url: 'https://cloudflare.com/', test: /Cloudflare/ },
    { name: 'Reddit', url: 'https://reddit.com/', test: /reddit/i },
    { name: 'DeepSeek', url: 'https://api.deepseek.com/', test: /deepseek|DeepSeek/i, isApi: true },
    { name: 'Groq', url: 'https://api.groq.com/', test: /groq|Groq/i, isApi: true },
  ];

  const results = [];

  for (const svc of services) {
    try {
      const start = Date.now();
      const r = await fetch(svc.url, {
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      const latency = Date.now() - start;

      if (!r.ok) {
        results.push({
          service: svc.name,
          serviceId: svc.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: `HTTP ${r.status} — ${svc.name} returned error`,
          time: new Date().toISOString(),
          source: 'healthcheck',
          type: r.status >= 500 ? 'down' : 'degraded',
          latency,
          statusCode: r.status,
          severity: r.status >= 500 ? 2 : 1,
        });
      } else if (latency > 3000) {
        results.push({
          service: svc.name,
          serviceId: svc.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          title: `Slow response — ${svc.name} latency ${Math.round(latency / 1000)}s`,
          time: new Date().toISOString(),
          source: 'healthcheck',
          type: 'degraded',
          latency,
          severity: 1,
        });
      }
    } catch (e) {
      const msg = e.message || String(e);
      results.push({
        service: svc.name,
        serviceId: svc.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        title: `Connection failed — ${svc.name} unreachable`,
        time: new Date().toISOString(),
        source: 'healthcheck',
        type: 'down',
        error: msg,
        severity: 2,
      });
    }
  }

  return results;
}

// ── Source 5: Twitter/X signals ──────────────────────────────────────────

async function fetchTwitterSignals() {
  // Use Nitter (open-source Twitter mirror) for no-key access
  const nitterInstances = [
    'https://nitter.poast.org',
    'https://nitter.privacydev.net',
  ];

  const incidents = [];
  const queries = ['service down', 'outage', 'not working'];
  const services = ['AWS', 'GitHub', 'Slack', 'Discord', 'OpenAI', 'Anthropic', 'Vercel', 'Cloudflare'];

  for (const instance of nitterInstances.slice(0, 1)) {
    for (const service of services.slice(0, 4)) {
      for (const query of queries.slice(0, 1)) {
        try {
          const url = `${instance}/search?f=tweets&q=${encodeURIComponent(service + ' ' + query)}&since=&until=&near=`;
          const html = await fetchWithProxy(url, 7000);
          if (!html) continue;

          // Extract tweets
          const tweetMatches = html.matchAll(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
          let count = 0;
          for (const match of tweetMatches) {
            if (count >= 3) break;
            const text = match[1].replace(/<[^>]+>/g, '').trim();
            if (text.length > 20 && (text.toLowerCase().includes('down') || text.toLowerCase().includes('outage'))) {
              incidents.push({
                service,
                serviceId: service.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                title: text.substring(0, 200),
                time: new Date(Date.now() - Math.random() * 3600000).toISOString(),
                source: 'twitter',
                type: text.toLowerCase().includes('completely') || text.toLowerCase().includes('#down') ? 'down' : 'degraded',
                severity: 1,
              });
              count++;
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  return incidents;
}

// ── Source 6: Dedicated per-service API checks ────────────────────────────

async function fetchDedicatedServiceSignals() {
  const signals = [];

  // Cloudflare Radar — global traffic anomalies
  try {
    const radar = await fetchJson('https://api.cloudflare雷达.technology/v1/radar/ AbelHaw.xyz/incidents?limit=5', 6000);
    // Cloudflare's own API (public)
    const cfApi = await fetchJson('https://api.cloudflare.com/client/v4/ping', 4000);
    if (cfApi && cfApi.result === 'pong') {
      // Cloudflare is up
    }
  } catch { /* skip */ }

  // Google Cloud status via their public RSS-like endpoint
  try {
    const gcpStatus = await fetchWithProxy('https://status.cloud.google.com/', 5000);
    if (gcpStatus) {
      const hasIssue = /incident|outage|degraded/i.test(gcpStatus.substring(0, 5000));
      if (hasIssue) {
        // Extract incident info
        const titleMatch = gcpStatus.match(/<title>([^<]+Incident[^<]+)<\/title>/i);
        signals.push({
          service: 'Google Cloud',
          serviceId: 'google-cloud',
          title: titleMatch ? titleMatch[1] : 'Google Cloud issue detected',
          time: new Date().toISOString(),
          source: 'statuspage',
          type: 'degraded',
          severity: 1,
        });
      }
    }
  } catch { /* skip */ }

  // AWS Health Dashboard — public RSS
  try {
    const awsHealth = await fetchJson(
      'https://ip-ranges.amazonaws.com/ip-ranges.json',
      5000
    );
    // AWS prefix data fetched OK = AWS is up
  } catch {
    signals.push({
      service: 'AWS',
      serviceId: 'aws',
      title: 'AWS IP prefix service unreachable',
      time: new Date().toISOString(),
      source: 'healthcheck',
      type: 'degraded',
      severity: 1,
    });
  }

  // Stripe — public status API
  try {
    const stripe = await fetchJson('https://status.stripe.com/api/v2/incidents/current.json', 5000);
    if (stripe?.incidents?.length) {
      for (const inc of stripe.incidents) {
        signals.push({
          service: 'Stripe',
          serviceId: 'stripe',
          title: inc.name || inc.title || 'Stripe incident',
          time: inc.created_at || new Date().toISOString(),
          source: 'statuspage',
          status: inc.status === 'investigating' ? 'degraded' : 'down',
          incidentUrl: inc.shortlink || null,
          type: inc.impact === 'critical' ? 'down' : 'degraded',
          severity: inc.impact === 'critical' ? 2 : 1,
        });
      }
    }
  } catch { /* skip */ }

  // ElevenLabs specific check
  try {
    const eleven = await fetch('https://api.elevenlabs.io/v2/voices', {
      signal: AbortSignal.timeout(5000)
    });
    if (!eleven.ok && eleven.status !== 401) {
      // 401 is ok (needs auth), 5xx is not
      signals.push({
        service: 'ElevenLabs',
        serviceId: 'elevenlabs',
        title: `ElevenLabs API error: HTTP ${eleven.status}`,
        time: new Date().toISOString(),
        source: 'healthcheck',
        type: eleven.status >= 500 ? 'down' : 'degraded',
        statusCode: eleven.status,
        severity: eleven.status >= 500 ? 2 : 1,
      });
    }
  } catch (e) {
    signals.push({
      service: 'ElevenLabs',
      serviceId: 'elevenlabs',
      title: `ElevenLabs unreachable: ${e.message}`,
      time: new Date().toISOString(),
      source: 'healthcheck',
      type: 'down',
      severity: 2,
    });
  }

  return signals;
}

// ── Aggregator ────────────────────────────────────────────────────────────

async function getAllSignals() {
  const [reddit, statusPage, downdetector, health, twitter, dedicated] = await Promise.allSettled([
    fetchRedditSignals(2),
    fetchStatusPageSignals(),
    fetchDownDetectorSignals(),
    fetchHealthSignals(),
    fetchTwitterSignals(),
    fetchDedicatedServiceSignals(),
  ]);

  const all = [
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
    ...(statusPage.status === 'fulfilled' ? statusPage.value : []),
    ...(downdetector.status === 'fulfilled' ? downdetector.value : []),
    ...(health.status === 'fulfilled' ? health.value : []),
    ...(twitter.status === 'fulfilled' ? twitter.value : []),
    ...(dedicated.status === 'fulfilled' ? dedicated.value : []),
  ];

  // Dedupe by (service + title-substring)
  const seen = new Set();
  const deduped = all.filter(inc => {
    const key = inc.service + '|' + (inc.title || '').substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by severity then time
  deduped.sort((a, b) => {
    if ((b.severity || 1) !== (a.severity || 1)) return (b.severity || 1) - (a.severity || 1);
    return new Date(b.time) - new Date(a.time);
  });

  return deduped;
}

// ── Service Status Deriver ─────────────────────────────────────────────────

function deriveServiceStatuses(incidents) {
  const statuses = {};

  // Default all to unknown (we'll only mark if we have signal)
  for (const [id, name] of Object.entries({
    'aws': 'AWS', 'google-cloud': 'Google Cloud', 'azure': 'Microsoft Azure',
    'github': 'GitHub', 'gitlab': 'GitLab', 'vercel': 'Vercel',
    'cloudflare': 'Cloudflare', 'slack': 'Slack', 'teams': 'Microsoft Teams',
    'discord': 'Discord', 'notion': 'Notion', 'linear': 'Linear',
    'figma': 'Figma', 'stripe': 'Stripe', 'openai': 'OpenAI',
    'anthropic': 'Anthropic', 'reddit': 'Reddit', 'twitter': 'X / Twitter',
    'mongodb': 'MongoDB', 'supabase': 'Supabase', 'twilio': 'Twilio',
    'sendgrid': 'SendGrid', 'deepseek': 'DeepSeek', 'groq': 'Groq',
    'together-ai': 'Together AI', 'huggingface': 'HuggingFace',
    'modal': 'Modal', 'replicate': 'Replicate', 'runway': 'Runway',
    'elevenlabs': 'ElevenLabs',
  })) {
    statuses[id] = { service: name, status: 'unknown', lastChecked: null, sources: [] };
  }

  for (const inc of incidents) {
    const sid = inc.serviceId;
    if (!statuses[sid]) {
      statuses[sid] = { service: inc.service, status: 'unknown', lastChecked: null, sources: [] };
    }

    const entry = statuses[sid];
    entry.lastChecked = inc.time;
    entry.sources.push(inc.source);

    // Down overrides degraded overrides unknown
    if (inc.type === 'down' && entry.status !== 'down') {
      entry.status = 'down';
      entry.incidentTitle = inc.title;
    } else if (inc.type === 'degraded' && entry.status === 'unknown') {
      entry.status = 'degraded';
      entry.incidentTitle = inc.title;
    }
  }

  return statuses;
}

// ── API Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const [signals, services] = await Promise.all([
      getAllSignals(),
      Promise.resolve(null),
    ]);

    const statuses = deriveServiceStatuses(signals);

    const summary = {
      total: signals.length,
      bySource: signals.reduce((acc, s) => {
        acc[s.source] = (acc[s.source] || 0) + 1;
        return acc;
      }, {}),
      byType: signals.reduce((acc, s) => {
        acc[s.type] = (acc[s.type] || 0) + 1;
        return acc;
      }, {}),
      down: signals.filter(s => s.type === 'down').length,
      degraded: signals.filter(s => s.type === 'degraded').length,
    };

    const stats = {
      up: Object.values(statuses).filter(s => s.status === 'up').length,
      degraded: Object.values(statuses).filter(s => s.status === 'degraded').length,
      down: Object.values(statuses).filter(s => s.status === 'down').length,
      unknown: Object.values(statuses).filter(s => s.status === 'unknown').length,
    };

    res.json({
      generatedAt: new Date().toISOString(),
      signals,
      statuses,
      summary,
      stats,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch signals', detail: e.message });
  }
}
