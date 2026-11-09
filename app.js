const STATE_KEY = 'gita-daily-state-v3';
const LEGACY_KEY = 'gita-daily-state-v2';
const DEFAULT_STATE = { completed: ['1.1'], lastCompleted: null, lastCompletedId: null, reminders: false, reminderTime: '08:00', reminderClickedDate: null, sentReminders: [] };
const PUSH_KEY = 'gita-daily-push-device-v1';
const $ = id => document.getElementById(id);
let catalog = null;
let state = loadState();
let pushConfig = null;
let pushConfigPromise = null;
let currentLesson = null;
let selectedChapter = null;
let hls = null;
let playerSessionId = 0;
let subtitleRequestId = 0;
const chapterLoads = new Map();
let hlsScript = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const value = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...value, completed: Array.isArray(value.completed) ? value.completed : ['1.1'] };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function save() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  render();
}
function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function availableLessons() { return catalog.lessons; }
function loadChapter(chapter) {
  if (!chapterLoads.has(chapter)) {
    const number = String(chapter).padStart(2, '0');
    const loading = fetch('./chapters/chapter_' + number + '.json')
      .then(response => {
        if (!response.ok) throw new Error('Chapter HTTP ' + response.status);
        return response.json();
      })
      .then(rows => {
        const byId = new Map(rows.map(row => [row.id, row]));
        catalog.lessons = catalog.lessons.map(row => byId.has(row.id) ? byId.get(row.id) : row);
      }).catch(error => {
        chapterLoads.delete(chapter);
        throw error;
      });
    chapterLoads.set(chapter, loading);
  }
  return chapterLoads.get(chapter);
}
function nextLesson() {
  const rows = availableLessons();
  return rows.find(lesson => !state.completed.includes(lesson.id)) || rows[rows.length - 1];
}
function watchedToday() {
  return !!state.lastCompleted && localDate(new Date(state.lastCompleted)) === localDate();
}
function dailyLesson() {
  if (watchedToday()) {
    const id = state.lastCompletedId || state.completed[state.completed.length - 1];
    const row = availableLessons().find(lesson => lesson.id === id);
    if (row) return row;
  }
  return nextLesson();
}
function verseLabel(lesson) {
  const title = lesson.title || ('Shloka ' + lesson.id);
  return title.replace(/\s*\([^)]*\)\s*$/, '');
}
function verseDetail(lesson) {
  const match = (lesson.title || '').match(/\(([^)]+)\)/);
  if (!match) return lesson.subtitle ? 'Watch the complete Line Up video with English subtitles.' : 'Watch the complete Line Up video.';
  const range = match[1].match(/(\d+)(?:\.(\d+))?\s+to\s+(\d+)(?:\.(\d+))?/);
  if (!range) return 'This video covers ' + match[1] + '.';
  return 'Covers shlokas ' + lesson.chapter + '.' + (range[2] || range[1]) + '–' + lesson.chapter + '.' + (range[4] || range[3]) + '.';
}
function posterFor(lesson) { return lesson.poster || ''; }
function adaptiveMaster(lesson) {
  return './masters/chapter_' + String(lesson.chapter).padStart(2, '0') +
    '_shloka_' + String(lesson.shloka).padStart(3, '0') + '.m3u8?v=2';
}
function render() {
  if (!catalog) return;
  const lesson = dailyLesson();
  const doneToday = watchedToday();
  $('dateLabel').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  $('introCopy').textContent = doneToday ? 'You have completed your shloka for today. Come back tomorrow for the next one.' : 'Your next verse is ready when you are.';
  $('chapterTag').innerHTML = 'CHAPTER ' + String(lesson.chapter).padStart(2, '0') + ' <span>·</span> LINE UP';
  $('verseKicker').textContent = doneToday ? 'WATCHED TODAY' : 'YOUR NEXT VERSE';
  $('verseTitle').textContent = verseLabel(lesson);
  $('verseDescription').textContent = verseDetail(lesson);
  $('watchText').textContent = doneToday ? 'Watch again' : 'Watch today’s shloka';
  $('posterNumber').textContent = String(lesson.chapter).padStart(2, '0') + ' · ' + String(lesson.shloka).padStart(2, '0');
  $('dailyPoster').src = posterFor(lesson);
  document.querySelector('.under-card span:last-child').textContent = lesson.subtitleCoverageSeconds ?
    'Up to 720p · Partial English subtitles' : lesson.subtitle ?
    'Up to 720p · English subtitles' : 'Up to 720p · No source subtitles';
  $('dailyCard').setAttribute('aria-label', 'Watch ' + verseLabel(lesson));
  $('progressText').textContent = state.completed.filter(id => availableLessons().some(x => x.id === id)).length + ' shloka videos watched';
  $('libraryCount').textContent = catalog.chapters.length + ' chapters';
  $('reminderToggle').classList.toggle('on', state.reminders);
  $('reminderToggle').setAttribute('aria-checked', String(state.reminders));
  $('reminderTime').value = state.reminderTime || '08:00';
  renderChapters();
  if (selectedChapter !== null) renderVerses(selectedChapter);
}
function renderChapters() {
  const grid = $('chapterGrid');
  grid.replaceChildren();
  for (const chapter of catalog.chapters) {
    const rows = availableLessons().filter(x => x.chapter === chapter.chapter);
    const button = document.createElement('button');
    button.className = 'chapter-button' + (selectedChapter === chapter.chapter ? ' active' : '');
    button.type = 'button';
    button.innerHTML = '<strong>' + String(chapter.chapter).padStart(2, '0') + '</strong><span>' + rows.length + ' videos</span>';
    button.setAttribute('aria-label', 'Browse Chapter ' + chapter.chapter + ', ' + rows.length + ' videos');
    button.onclick = () => {
      const chapterNumber = chapter.chapter;
      selectedChapter = chapterNumber;
      renderChapters();
      $('versePanel').hidden = false;
      $('selectedChapter').textContent = 'Chapter ' + chapterNumber;
      $('selectedCount').textContent = 'Loading verses…';
      $('verseList').replaceChildren();
      loadChapter(chapterNumber).then(() => {
        if (selectedChapter === chapterNumber) renderVerses(chapterNumber);
      }).catch(() => {
        if (selectedChapter === chapterNumber) $('selectedCount').textContent = 'Could not load. Tap the chapter to retry.';
      });
      $('versePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    grid.append(button);
  }
}
function renderVerses(chapter) {
  const rows = availableLessons().filter(x => x.chapter === chapter);
  $('selectedChapter').textContent = 'Chapter ' + chapter;
  $('selectedCount').textContent = rows.length + ' Line Up videos';
  const list = $('verseList');
  list.replaceChildren();
  for (const lesson of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'verse-button' + (state.completed.includes(lesson.id) ? ' watched' : '');
    const label = document.createElement('span');
    label.textContent = lesson.title || verseLabel(lesson);
    button.append(label);
    if (state.completed.includes(lesson.id)) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      button.append(check);
    }
    button.onclick = () => openPlayer(lesson);
    list.append(button);
  }
  $('versePanel').hidden = false;
}
function setStatus(message, retry = false) {
  const status = $('videoStatus');
  status.textContent = message;
  status.hidden = !message;
  $('retryVideo').hidden = !retry;
}
function loadSubtitles(lesson) {
  const requestId = ++subtitleRequestId;
  const previousTrack = $('subtitleTrack');
  const track = previousTrack.cloneNode(false);
  track.removeAttribute('src');
  previousTrack.replaceWith(track);
  $('captionStatus').textContent = 'Loading English subtitles…';
  if (!lesson.subtitle) {
    $('captionStatus').textContent = 'English subtitles unavailable';
    return;
  }
  track.onload = () => {
    if (requestId !== subtitleRequestId || currentLesson !== lesson) return;
    if (!track.track.cues?.length) {
      $('captionStatus').textContent = 'English subtitles unavailable for this video';
    } else if (lesson.subtitleCoverageSeconds) {
      const minutes = Math.floor(lesson.subtitleCoverageSeconds / 60);
      const seconds = String(Math.floor(lesson.subtitleCoverageSeconds % 60)).padStart(2, '0');
      $('captionStatus').textContent = 'English subtitles available through ' + minutes + ':' + seconds;
    } else $('captionStatus').textContent = 'English subtitles on';
  };
  track.onerror = () => {
    if (requestId === subtitleRequestId && currentLesson === lesson)
      $('captionStatus').textContent = 'English subtitles unavailable for this video';
  };
  track.src = './subtitles/chapter_' + String(lesson.chapter).padStart(2, '0') +
    '_shloka_' + String(lesson.shloka).padStart(3, '0') + '.vtt';
  track.track.mode = 'showing';
}
function stopVideo() {
  playerSessionId++;
  subtitleRequestId++;
  const video = $('video');
  video.pause();
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute('src');
  video.load();
  const track = $('subtitleTrack');
  track.onload = null;
  track.onerror = null;
  track.removeAttribute('src');
}
function loadHlsScript() {
  if (!hlsScript) hlsScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  }).catch(error => { hlsScript = null; throw error; });
  return hlsScript;
}
function openPlayer(lesson) {
  currentLesson = lesson;
  $('playerChapter').textContent = 'CHAPTER ' + String(lesson.chapter).padStart(2, '0') + ' · LINE UP';
  $('playerTitle').textContent = verseLabel(lesson);
  $('markWatched').textContent = state.completed.includes(lesson.id) ? 'Watched ✓' : 'Mark as watched ✓';
  $('playerOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setStatus('Preparing video…');
  stopVideo();
  const sessionId = playerSessionId;
  const video = $('video');
  let wasPlaying = false;
  let recoveryTimer = null;
  let recoveryAttempts = 0;
  let networkRecoveryAttempts = 0;
  video.onplay = () => { wasPlaying = true; };
  video.onpause = () => { if (video.ended) wasPlaying = false; };
  video.onended = () => {
    if (playerSessionId === sessionId && currentLesson === lesson &&
        !state.completed.includes(lesson.id)) markWatched();
  };
  video.onplaying = () => {
    clearTimeout(recoveryTimer);
    recoveryAttempts = 0;
    networkRecoveryAttempts = 0;
    setStatus('');
  };
  video.onseeking = () => {
    setStatus('Seeking…');
    const target = video.currentTime;
    let alreadyBuffered = false;
    for (let i = 0; i < video.buffered.length; i++) {
      if (target >= video.buffered.start(i) && target < video.buffered.end(i) - 0.1) {
        alreadyBuffered = true;
        break;
      }
    }
    if (hls && target > 0.5 && !alreadyBuffered) {
      hls.nextAutoLevel = 0;
      hls.stopLoad();
      hls.startLoad(target);
    }
  };
  video.onseeked = () => {
    if ($('retryVideo').hidden && (video.paused || video.readyState >= 2)) setStatus('');
  };
  const recoverPlayback = () => {
    if (!wasPlaying || video.paused || video.ended) return;
    clearTimeout(recoveryTimer);
    const stalledAt = video.currentTime;
    recoveryTimer = setTimeout(() => {
      if (playerSessionId !== sessionId || video.paused || video.ended ||
          Math.abs(video.currentTime - stalledAt) >= 0.1) return;
      recoveryAttempts++;
      setStatus('Playback paused while loading. Reconnecting…');
      if (hls) {
        hls.nextAutoLevel = 0;
        hls.stopLoad();
        hls.startLoad(Math.max(0, stalledAt));
      } else {
        video.addEventListener('loadedmetadata', () => {
          if (playerSessionId !== sessionId) return;
          video.currentTime = Math.min(stalledAt, Math.max(0, video.duration - 0.25));
          loadSubtitles(lesson);
          video.play().catch(() => setStatus('Tap play to resume the video.'));
        }, { once: true });
        video.load();
      }
      if (recoveryAttempts < 2) recoverPlayback();
      else recoveryTimer = setTimeout(() => {
        if (!video.paused && Math.abs(video.currentTime - stalledAt) < 0.1)
          setStatus('Playback is still loading. Check your connection and retry.', true);
      }, 15000);
    }, recoveryAttempts ? 15000 : 12000);
  };
  video.onwaiting = recoverPlayback;
  video.onstalled = recoverPlayback;
  video.poster = posterFor(lesson);
  video.onerror = () => setStatus('The video could not load. Please retry.', true);
  video.onloadedmetadata = () => setStatus('');
  $('captionStatus').textContent = 'Loading English subtitles…';
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = adaptiveMaster(lesson);
    video.load();
    loadSubtitles(lesson);
  } else {
    setStatus('Loading video player…');
    loadHlsScript().then(() => {
      if (playerSessionId !== sessionId) return;
      if (!window.Hls?.isSupported()) {
        setStatus('This browser cannot play the video.', true);
        return;
      }
    const connection = navigator.connection;
    const slowConnection = connection && (connection.saveData ||
      connection.downlink < 3.5 || /2g|3g/.test(connection.effectiveType || ''));
    hls = new Hls({ enableWorker: true, startLevel: slowConnection ? 0 : 1,
      maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30 });
    hls.autoLevelCapping = 1;
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(adaptiveMaster(lesson));
      loadSubtitles(lesson);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => setStatus(''));
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (++networkRecoveryAttempts <= 2) {
          setStatus('Video connection interrupted. Retrying…');
          hls.startLoad();
        } else setStatus('Video connection failed. Please retry.', true);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (++networkRecoveryAttempts <= 2) hls.recoverMediaError();
        else setStatus('Video playback failed. Please retry.', true);
      } else {
        setStatus('The video could not load. Please retry.', true);
      }
    });
    hls.attachMedia(video);
    }).catch(() => {
      if (playerSessionId === sessionId)
        setStatus('The video player could not load. Please retry.', true);
    });
  }
  $('closePlayer').focus();
}
function closePlayer() {
  $('playerOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  stopVideo();
  currentLesson = null;
  $('dailyCard').focus();
}
function retryVideo() {
  if (!currentLesson) return;
  const lesson = currentLesson;
  const resumeAt = $('video').currentTime;
  openPlayer(lesson);
  const video = $('video');
  video.addEventListener('loadedmetadata', () => {
    if (currentLesson !== lesson) return;
    if (resumeAt > 0) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 0.25));
    video.play().catch(() => setStatus('Tap play to resume the video.'));
  }, { once: true });
}
function markWatched() {
  if (!currentLesson) return;
  const stoppingToday = currentLesson.id === nextLesson().id;
  if (!state.completed.includes(currentLesson.id)) state.completed.push(currentLesson.id);
  if (stoppingToday) {
    state.lastCompleted = new Date().toISOString();
    state.lastCompletedId = currentLesson.id;
    state.reminderClickedDate = localDate();
  }
  save();
  if (stoppingToday) reportPush('watched');
  closePlayer();
  toast('Today’s shloka marked as watched');
}
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}
function pushDevice() {
  try { return JSON.parse(localStorage.getItem(PUSH_KEY) || 'null'); } catch { return null; }
}
function applicationKey(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}
async function pushRequest(body) {
  if (!pushConfig?.pushApi) throw new Error('Push service unavailable');
  const response = await fetch(pushConfig.pushApi, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Push service returned ' + response.status);
  return response.json();
}
async function reportPush(action) {
  const device = pushDevice();
  if (!device) return;
  try {
    await pushConfigPromise;
    await pushRequest({ action, ...device, reminderTime: state.reminderTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, active: state.reminders });
  } catch (error) { console.warn('Reminder update failed', error); }
}
async function toggleReminder() {
  await pushConfigPromise;
  if (state.reminders) {
    const device = pushDevice();
    try {
      if (device) await pushRequest({ action: 'unsubscribe', ...device });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      localStorage.removeItem(PUSH_KEY);
    } catch (error) { console.warn('Reminder unsubscribe failed', error); }
    state.reminders = false;
    save();
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Install this app on your device to enable push reminders'); return;
  }
  if (!pushConfig?.vapidPublic) { toast('Push service is unavailable. Try again shortly.'); return; }
  try {
    if (await Notification.requestPermission() !== 'granted') {
      toast('Allow notifications to receive reminders'); return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
      applicationServerKey: applicationKey(pushConfig.vapidPublic) });
    const device = await pushRequest({ action: 'subscribe', subscription: subscription.toJSON(),
      reminderTime: state.reminderTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    localStorage.setItem(PUSH_KEY, JSON.stringify({ id: device.id, token: device.token }));
    state.reminders = true;
    save();
    if (watchedToday()) await reportPush('watched');
    toast('Daily push reminders are on');
  } catch (error) {
    console.error('Could not enable push', error);
    toast('Could not enable reminders. Please try again.');
  }
}
async function init() {
  let catalogReady;
  $('dailyCard').onclick = async () => {
    try { await catalogReady; } catch { return; }
    if (catalog) openPlayer(dailyLesson());
  };
  pushConfigPromise = fetch('./config.json').then(r => r.ok ? r.json() : null)
    .then(value => { pushConfig = value; }).catch(() => {});
  try {
    catalogReady = (async () => {
      const response = await fetch('./catalog-index.json');
      if (!response.ok) throw new Error('Catalog HTTP ' + response.status);
      catalog = await response.json();
      await loadChapter(dailyLesson().chapter);
      render();
    })();
    await catalogReady;
  } catch {
    $('introCopy').textContent = 'The catalog could not load. Please refresh the page.';
    return;
  }
  $('browseButton').onclick = () => $('library').scrollIntoView({ behavior: 'smooth' });
  $('closePlayer').onclick = closePlayer;
  $('retryVideo').onclick = retryVideo;
  $('playerBackdrop').onclick = closePlayer;
  $('markWatched').onclick = markWatched;
  $('settingsButton').onclick = () => $('settingsOverlay').classList.remove('hidden');
  $('closeSettings').onclick = () => $('settingsOverlay').classList.add('hidden');
  $('settingsBackdrop').onclick = () => $('settingsOverlay').classList.add('hidden');
  $('reminderToggle').onclick = toggleReminder;
  $('reminderTime').onchange = event => { state.reminderTime = event.target.value; save(); if (state.reminders) reportPush('settings'); };
  $('resetProgress').onclick = () => { if (confirm('Reset your watch progress on this device?')) { state = { ...DEFAULT_STATE }; save(); toast('Watch progress reset to Shloka 1.1 completed'); } };
  $('dailyPoster').onerror = () => { $('dailyPoster').style.opacity = '0'; };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('playerOverlay').classList.contains('hidden')) closePlayer(); $('settingsOverlay').classList.add('hidden'); } });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'reminder-clicked') { state.reminderClickedDate = localDate(); save(); reportPush('clicked'); openPlayer(dailyLesson()); } });
  }
  if (state.reminders && !pushDevice()) { state.reminders = false; save(); }
  if (state.reminders && watchedToday()) reportPush('watched');
  if (new URLSearchParams(location.search).has('reminder')) {
    state.reminderClickedDate = localDate(); save(); reportPush('clicked');
    history.replaceState(null, '', location.pathname);
    openPlayer(dailyLesson());
  }
}
init();
