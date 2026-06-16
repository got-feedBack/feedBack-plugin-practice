// Practice Journal plugin

// ── Auto-tracking ───────────────────────────────────────────────────────
// Hooks into the player to automatically record practice sessions.

let _pjSessionStart = null;
let _pjSpeeds = [];
let _pjLoopsUsed = new Set();
let _pjFilename = null;
let _pjTitle = null;
let _pjArtist = null;
let _pjArrangement = null;

// Hooks: playSong / showScreen / setSpeed / loadSavedLoop
(function() {
    // Idempotency: if screen.js is re-evaluated (loader cache miss, hot reload,
    // older core builds without the load-side guard), don't re-wrap any of
    // the four hooked globals — each re-wrap captures the previous wrapper,
    // growing the chain and leaking closures.
    const HOOK_KEY = '__slopsmithPracticeHooksInstalled';
    if (window[HOOK_KEY]) return;
    window[HOOK_KEY] = true;

    // Hook into playSong — record when a song starts
    const origPlaySong = window.playSong;
    window.playSong = async function(filename, arrangement) {
        // End previous session if any
        _pjEndSession();
        await origPlaySong(filename, arrangement);
        // Start tracking
        _pjFilename = decodeURIComponent(filename);
        _pjSessionStart = new Date().toISOString();
        _pjSpeeds = [1.0];
        _pjLoopsUsed = new Set();
        _pjTitle = document.getElementById('hud-title')?.textContent || '';
        _pjArtist = document.getElementById('hud-artist')?.textContent || '';
        _pjArrangement = document.getElementById('hud-arrangement')?.textContent || '';
    };

    // Hook into showScreen — end session when leaving player
    const origShowScreen = window.showScreen;
    window.showScreen = function(id) {
        if (id !== 'player') _pjEndSession();
        origShowScreen(id);
        if (id === 'plugin-practice_journal') _pjLoadDashboard();
    };

    // Hook into setSpeed — track speed changes
    const origSetSpeed = window.setSpeed;
    window.setSpeed = function(v) {
        origSetSpeed(v);
        if (_pjSessionStart) _pjSpeeds.push(parseFloat(v));
    };

    // Hook into loadSavedLoop — track which loops are used
    const origLoadSavedLoop = window.loadSavedLoop;
    window.loadSavedLoop = function(loopId) {
        origLoadSavedLoop(loopId);
        const sel = document.getElementById('saved-loops');
        const opt = sel?.selectedOptions[0];
        if (opt && loopId) {
            _pjLoopsUsed.add(opt.textContent.split('(')[0].trim());
        }
    };
})();

function _pjEndSession() {
    if (!_pjSessionStart || !_pjFilename) return;

    const now = new Date();
    const start = new Date(_pjSessionStart);
    const duration = (now - start) / 1000;

    const avgSpeed = _pjSpeeds.length > 0
        ? _pjSpeeds.reduce((a, b) => a + b, 0) / _pjSpeeds.length
        : 1.0;

    // Fire and forget
    fetch('/api/plugins/practice_journal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: _pjFilename,
            title: _pjTitle,
            artist: _pjArtist,
            started_at: _pjSessionStart,
            duration: duration,
            avg_speed: Math.round(avgSpeed * 100) / 100,
            loops_used: [..._pjLoopsUsed],
            arrangement: _pjArrangement,
        }),
    }).catch(() => {});

    _pjSessionStart = null;
    _pjFilename = null;
}

// End session on page unload
window.addEventListener('beforeunload', _pjEndSession);

// ── Dashboard ───────────────────────────────────────────────────────────

function _pjFormatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function _pjLoadDashboard() {
    try {
        const resp = await fetch('/api/plugins/practice_journal/stats');
        const data = await resp.json();

        // Stats cards
        document.getElementById('pj-today').textContent = _pjFormatDuration(data.today_time);
        document.getElementById('pj-week').textContent = _pjFormatDuration(data.week_time);
        document.getElementById('pj-total').textContent = _pjFormatDuration(data.total_time);
        document.getElementById('pj-songs').textContent = data.unique_songs;

        // Daily chart (bar chart)
        const chart = document.getElementById('pj-chart');
        if (data.daily.length === 0) {
            chart.innerHTML = '<p class="text-gray-600 text-sm w-full text-center">No practice data yet</p>';
        } else {
            const maxVal = Math.max(...data.daily.map(d => d.seconds), 1);
            // Fill in missing days
            const days = [];
            const now = new Date();
            for (let i = 29; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const key = d.toISOString().split('T')[0];
                const found = data.daily.find(x => x.date === key);
                days.push({ date: key, seconds: found ? found.seconds : 0 });
            }
            chart.innerHTML = days.map(d => {
                const pct = Math.max(2, (d.seconds / maxVal) * 100);
                const day = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'narrow' });
                const title = `${d.date}: ${_pjFormatDuration(d.seconds)}`;
                return `<div class="flex-1 flex flex-col items-center gap-1">
                    <div class="w-full rounded-t transition-all ${d.seconds > 0 ? 'bg-accent' : 'bg-dark-600'}"
                         style="height:${pct}%" title="${title}"></div>
                    <span class="text-gray-600 text-[9px]">${day}</span>
                </div>`;
            }).join('');
        }

        // Top songs
        const top = document.getElementById('pj-top');
        if (data.top_songs.length === 0) {
            top.innerHTML = '<p class="text-gray-600 text-sm">No songs practiced yet</p>';
        } else {
            const maxTime = data.top_songs[0]?.total_time || 1;
            top.innerHTML = data.top_songs.map(s => {
                const pct = (s.total_time / maxTime) * 100;
                return `<div class="bg-dark-700/50 border border-gray-800/50 rounded-lg p-3">
                    <div class="flex justify-between items-center mb-1">
                        <div class="min-w-0 flex-1">
                            <span class="text-sm text-white truncate block">${esc(s.title || s.filename)}</span>
                            <span class="text-xs text-gray-500">${esc(s.artist)}</span>
                        </div>
                        <span class="text-xs text-gray-400 ml-2 flex-shrink-0">${_pjFormatDuration(s.total_time)} · ${s.sessions}x</span>
                    </div>
                    <div class="h-1 bg-dark-600 rounded-full"><div class="h-1 bg-accent rounded-full" style="width:${pct}%"></div></div>
                </div>`;
            }).join('');
        }

        // Recent sessions
        const recent = document.getElementById('pj-recent');
        if (data.recent.length === 0) {
            recent.innerHTML = '<p class="text-gray-600 text-sm">No sessions yet. Play a song to start tracking!</p>';
        } else {
            recent.innerHTML = data.recent.map(s => {
                const date = new Date(s.started_at);
                const timeStr = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
                    + ' ' + date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
                const speedStr = s.speed !== 1.0 ? ` · ${s.speed.toFixed(2)}x` : '';
                const arrStr = s.arrangement ? ` · ${s.arrangement}` : '';
                return `<div class="flex items-center justify-between py-2 px-3 bg-dark-700/30 rounded-lg">
                    <div class="min-w-0">
                        <span class="text-sm text-white truncate block">${esc(s.title || s.filename)}</span>
                        <span class="text-xs text-gray-500">${esc(s.artist)}${arrStr}</span>
                    </div>
                    <div class="text-right flex-shrink-0 ml-2">
                        <span class="text-xs text-gray-300 block">${_pjFormatDuration(s.duration)}${speedStr}</span>
                        <span class="text-xs text-gray-600">${timeStr}</span>
                    </div>
                </div>`;
            }).join('');
        }

    } catch (e) {
        console.error('Practice Journal load failed:', e);
    }
}
