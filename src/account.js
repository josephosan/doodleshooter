// Same-origin account/statistics client. Match events stay peer-to-peer; only one compact
// authenticated result is sent when an online match ends.
export const account = { user: null, loaded: false, notice: '' };

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
  });
  let body = null; try { body = await response.json(); } catch (_) { /* non-json failure */ }
  if (!response.ok) throw new Error(body && body.error || 'The server did not accept that request.');
  return body;
}

function acceptUser(body) { account.user = body && body.user || null; account.loaded = true; return account.user; }

export async function loadAccount() {
  try { return acceptUser(await request('/api/me')); }
  catch (_) { account.loaded = true; account.user = null; return null; }
}
export async function signup(username, password) { return acceptUser(await request('/api/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) })); }
export async function login(username, password) { return acceptUser(await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })); }
export async function logout() { await request('/api/auth/logout', { method: 'POST' }); account.user = null; }
export async function checkUsername(username) { return request('/api/account/username/check?username=' + encodeURIComponent(username)); }
export async function changeUsername(username) { return acceptUser(await request('/api/account/username', { method: 'PUT', body: JSON.stringify({ username }) })); }
export async function saveColor(color) { return acceptUser(await request('/api/account/color', { method: 'PUT', body: JSON.stringify({ color }) })); }
export async function leaderboard(scope) { return request('/api/leaderboards/' + (scope === 'weekly' ? 'weekly' : 'all-time')); }
export async function recentGames() { return request('/api/me/games'); }
export async function recentSoloRuns() { return request('/api/me/solo-runs'); }
export async function publicProfile(username) { return request('/api/profiles/' + encodeURIComponent(username)); }
export async function searchPlayers(query) { return request('/api/players/search?q=' + encodeURIComponent(query)); }
export async function duelRequests() { return request('/api/duels'); }
export async function requestDuel(username) { return request('/api/duels', { method: 'POST', body: JSON.stringify({ username }) }); }
export async function respondDuel(id, action) { return request('/api/duels/' + encodeURIComponent(id) + '/respond', { method: 'POST', body: JSON.stringify({ action }) }); }
export async function cancelDuel(id) { return request('/api/duels/' + encodeURIComponent(id), { method: 'DELETE' }); }
export async function submitSoloRun(runId, result) {
  if (!account.user || !runId) return null;
  const response = await request('/api/solo-runs/' + encodeURIComponent(runId), { method: 'POST', body: JSON.stringify(result) });
  if (response.user) account.user = response.user;
  return response;
}
export async function submitResult(gameId, result) {
  if (!account.user || !gameId) return null;
  const response = await request('/api/games/' + encodeURIComponent(gameId) + '/results', { method: 'POST', body: JSON.stringify(result) });
  if (response.user) account.user = response.user;
  return response;
}

export function badgeLabel(user = account.user) { return user && user.badge ? user.badge.label : ''; }
