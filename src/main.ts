import '@fontsource/noto-serif-sc/400.css';
import './style.css';
import type { Chart, Entry, Draft, Profile, Settings, GenerationRequest, Result } from './types';
import { defaults } from './types';
import { LibraryStore, profileKey } from './store';
import { Engine, MOTION_DELAY, type Judgment } from './engine';
import { MusicClock } from './audio';
import { PlayInput } from './input';
import { Renderer, drawPoster } from './renderer';
import { Editor } from './editor';
import { validateChart, checkClearance } from './validate';
import { RuntimeReport } from './performance';
import { lyricsAsLrc } from './lyrics';
import { exportPackage, importPackage, sha256, download } from './packages';
import { chartRevision, clamp } from './geometry';
import { $, esc, clock, uid, toast, busy, fontReady } from './ui';
const report = new RuntimeReport();
const store = new LibraryStore();
let profile: Profile = {
  settings: { ...defaults },
  bests: {},
  history: [],
  lastPage: 'anti-utopia',
  legacyBests: {},
};
let offlineStatus = '离线资源尚未准备';
let entries: Entry[] = [],
  filtered: Entry[] = [],
  filter = 'all',
  pageIndex = 0,
  current = 'cover',
  settingsBack = 'cover',
  helpBack = 'cover',
  selectedChart = 0,
  practice = 'full';
let engine: Engine | undefined,
  renderer: Renderer | undefined,
  music: MusicClock | undefined,
  input: PlayInput | undefined,
  gameState: 'idle' | 'loading' | 'running' | 'paused' | 'finished' = 'idle',
  automatic = false,
  assisted = false,
  preview = false,
  runEntry: Entry | undefined,
  runChart: Chart | undefined,
  runRange = { start: 0, end: 0 },
  frameId = 0,
  lastHud = -99,
  sessionToken = 0,
  layoutSignature = '',
  toastPrecisionAt = 0;
const pending = new Map<number, { resolve: (c: Chart) => void; reject: (e: Error) => void }>();
let workerId = 0;
const worker = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (event) => {
  const p = pending.get(event.data.id);
  if (!p) return;
  pending.delete(event.data.id);
  event.data.error ? p.reject(Error(event.data.error)) : p.resolve(event.data.chart);
};
worker.onerror = () => {
  for (const p of pending.values()) p.reject(Error('地图生成器中断，草稿保留，请刷新后重试'));
  pending.clear();
};
const generate = (request: GenerationRequest) =>
  new Promise<Chart>((resolve, reject) => {
    const id = ++workerId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, request });
  });
const editor = new Editor(store, {
  generate,
  resolveAudio,
  settings: () => profile.settings,
  save: saveEntry,
  preview: async (chart, entry) => {
    await playChart(entry, chart, false, true);
  },
  leave: () => show('library'),
});
function persist() {
  return store.put('profile', profileKey, profile);
}
function currentEntry() {
  return filtered[pageIndex];
}
function currentChart() {
  return currentEntry()?.charts[selectedChart] || currentEntry()?.charts[0];
}
function rotated() {
  return document.body.dataset.rotated === 'true';
}
function layout() {
  const r = profile.settings.layout === 'landscape' && innerWidth < innerHeight,
    w = r ? innerHeight : innerWidth,
    h = r ? innerWidth : innerHeight,
    signature = [w, h, r].join(':');
  if (layoutSignature && signature !== layoutSignature && gameState === 'running') pauseGame();
  if (layoutSignature && signature !== layoutSignature && editor.mode !== 'idle') editor.stop();
  layoutSignature = signature;
  document.body.dataset.rotated = String(r);
  document.body.dataset.wide = String(w > h);
  document.body.dataset.compact = String(h < 500);
  document.documentElement.style.setProperty('--app-height', h + 'px');
  document.querySelectorAll('[data-action=layout]').forEach((b) => {
    b.textContent = profile.settings.layout === 'landscape' ? '自动布局 ↗' : '横屏 ↗';
    b.setAttribute('aria-pressed', String(profile.settings.layout === 'landscape'));
  });
  requestAnimationFrame(() => {
    renderer?.resize();
    if (current === 'work' && currentChart())
      drawPoster($<HTMLCanvasElement>('poster'), currentChart());
    if (current === 'editor') {
      editor.waveDraw();
      editor.poster();
    }
  });
}
function show(page: string) {
  if (current === 'game' && page !== 'game' && gameState === 'running') pauseGame();
  if (current === 'editor' && page !== 'editor') editor.stop();
  current = page;
  document.body.dataset.screen = page;
  for (const id of ['cover', 'library', 'work', 'editor', 'game', 'results', 'settings', 'help'])
    $(id).hidden = id !== page;
  layout();
  if (page === 'library') void renderLibrary();
  if (page === 'cover')
    $('coverCount').textContent = entries.length + ' 篇作品 · 导入自己的音乐与歌词';
  if (page === 'work') void renderWork();
  if (page === 'game' && engine && renderer) {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
  }
  const heading = $(page).querySelector<HTMLElement>('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
async function renderLibrary() {
  const search = $<HTMLInputElement>('search').value.toLocaleLowerCase();
  filtered = entries.filter(
    (e) =>
      (filter !== 'favorite' || e.favorite) &&
      (filter !== 'mine' || !e.builtin) &&
      (filter !== 'recent' || e.lastPlayed) &&
      (e.title + ' ' + e.artist).toLocaleLowerCase().includes(search),
  );
  if (filter === 'recent') filtered.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  $('contents').innerHTML = filtered.length
    ? filtered
        .map(
          (e, i) =>
            '<button class="contents-row" data-entry="' +
            esc(e.id) +
            '"><span class="folio">' +
            String(i + 1).padStart(2, '0') +
            '</span><div><h2>' +
            esc(e.title) +
            '</h2><p class="muted">' +
            esc(e.artist || '未署名') +
            ' · ' +
            clock(e.duration) +
            ' · ' +
            e.charts.length +
            ' 份谱面' +
            (e.favorite ? ' · 收藏' : '') +
            '</p></div><span class="arrow">→</span></button>',
        )
        .join('')
    : '<div class="empty">这一页，留给你的作品。</div>';
  $('libraryCount').textContent = filtered.length + ' 篇 / ' + entries.length + ' 篇';
  $('contents')
    .querySelectorAll<HTMLElement>('[data-entry]')
    .forEach((b) => (b.onclick = () => openEntry(b.dataset.entry!)));
  document
    .querySelectorAll('[data-filter]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.filter === filter)),
    );
  const drafts = await store.drafts();
  $('draftShelf').innerHTML = drafts.length
    ? drafts
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
        .map(
          (d) =>
            '<button data-draft="' +
            esc(d.id) +
            '"><span class="muted">继续草稿</span><br>' +
            esc(d.title || '未命名作品') +
            '</button>',
        )
        .join('')
    : '';
  $('draftShelf')
    .querySelectorAll<HTMLElement>('[data-draft]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const d = drafts.find((d) => d.id === b.dataset.draft)!;
          void openEditor(d);
        }),
    );
}
function openEntry(id: string) {
  if (!filtered.some((e) => e.id === id)) filtered = entries.slice();
  pageIndex = Math.max(
    0,
    filtered.findIndex((e) => e.id === id),
  );
  selectedChart = 0;
  practice = 'full';
  profile.lastPage = id;
  void persist();
  show('work');
}
async function renderWork() {
  const entry = currentEntry();
  if (!entry) {
    show('library');
    return;
  }
  const chart = currentChart();
  $('workTitle').textContent = entry.title;
  $('workArtist').textContent =
    entry.artist +
    ' · ' +
    clock(entry.duration) +
    (store.unsaved.has('entries:' + entry.id) || store.unsaved.has('audio:' + entry.audioId)
      ? ' · 未持久保存，请导出谱包'
      : '');
  $('workNumber').textContent =
    String(pageIndex + 1).padStart(2, '0') + ' / ' + String(filtered.length).padStart(2, '0');
  $('workFolio').textContent = '作品 / ' + String(pageIndex + 1).padStart(2, '0');
  $('pageCount').textContent =
    String(pageIndex + 1).padStart(2, '0') + ' / ' + String(filtered.length).padStart(2, '0');
  $('favorite').textContent = entry.favorite ? '♥' : '♡';
  $('favorite').setAttribute('aria-pressed', String(entry.favorite));
  ($('prevPage') as HTMLButtonElement).disabled = pageIndex === 0;
  ($('nextPage') as HTMLButtonElement).disabled = pageIndex === filtered.length - 1;
  $<HTMLSelectElement>('chartPicker').innerHTML = entry.charts
    .map(
      (c, i) =>
        '<option value="' +
        i +
        '">' +
        esc(
          c.id === 'anti-utopia-original'
            ? '原始单球'
            : c.id === 'anti-utopia-duet'
              ? '双球字群'
              : c.title === entry.title
                ? '谱面 ' + (i + 1)
                : c.title,
        ) +
        '</option>',
    )
    .join('');
  $<HTMLSelectElement>('chartPicker').value = String(selectedChart);
  $<HTMLSelectElement>('practicePicker').innerHTML =
    '<option value="full">完整演奏 · ' +
    clock(chart.duration) +
    '</option>' +
    chart.chapters
      .map(
        (p, i) =>
          '<option value="' +
          i +
          '">' +
          String(i + 1).padStart(2, '0') +
          ' · ' +
          esc(p.title.slice(0, 15)) +
          '</option>',
      )
      .join('');
  $<HTMLSelectElement>('practicePicker').value = practice;
  const v = new Engine(chart, profile.settings.difficulty);
  $('noteCount').textContent =
    chart.events.length + ' 次 · ' + (chart.duets.length ? '双球' : '单球');
  document
    .querySelectorAll('[data-difficulty]')
    .forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String((b as HTMLElement).dataset.difficulty === profile.settings.difficulty),
      ),
    );
  const id = [chart.id, chart.revision, profile.settings.difficulty].join(':'),
    best = profile.bests[id];
  const legacy =
    chart.id === 'anti-utopia-original'
      ? (profile.legacyBests[
          'anti-utopia:' + (profile.settings.difficulty === 'basic' ? 'easy' : 'standard')
        ] as any)
      : undefined;
  $('bestScore').textContent = best
    ? String(best.score).padStart(4, '0')
    : legacy
      ? String(legacy.score).padStart(4, '0')
      : '—';
  $('posterCaption').textContent = chart.lyrics[0]?.text || entry.title;
  ($('play') as HTMLButtonElement).disabled = !v.events.length;
  const audio = entry.builtin ? true : await store.get<Blob>('audio', entry.audioId);
  if (current !== 'work' || currentEntry()?.id !== entry.id) return;
  $('attachAudio').hidden = !!audio;
  if (!audio) {
    ($('play') as HTMLButtonElement).disabled = true;
    ($('demo') as HTMLButtonElement).disabled = true;
  } else ($('demo') as HTMLButtonElement).disabled = false;
  await fontReady(chart.lyrics.map((l) => l.text).join('') + entry.title);
  if (current === 'work' && currentEntry()?.id === entry.id)
    drawPoster($<HTMLCanvasElement>('poster'), chart);
}
function flip(delta: number) {
  if (pageIndex + delta < 0 || pageIndex + delta >= filtered.length) return;
  pageIndex += delta;
  selectedChart = 0;
  practice = 'full';
  profile.lastPage = currentEntry().id;
  void persist();
  const spread = $('bookSpread');
  spread.classList.remove('flipping');
  spread.style.setProperty('--turn-angle', delta > 0 ? '5deg' : '-5deg');
  spread.style.setProperty('--turn-offset', delta > 0 ? '8px' : '-8px');
  requestAnimationFrame(() => spread.classList.add('flipping'));
  void renderWork();
}
let bookTouch: { id: number; x: number; y: number } | undefined;
$('bookSpread').addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button,input,select,a')) return;
  bookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
$('bookSpread').addEventListener('pointerup', (e) => {
  if (!bookTouch || bookTouch.id !== e.pointerId) return;
  const dx = rotated() ? e.clientY - bookTouch.y : e.clientX - bookTouch.x,
    dy = rotated() ? e.clientX - bookTouch.x : e.clientY - bookTouch.y;
  bookTouch = undefined;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) flip(dx < 0 ? 1 : -1);
});
$('bookSpread').addEventListener('pointercancel', () => (bookTouch = undefined));
async function resolveAudio(id: string): Promise<Blob | undefined> {
  const own = await store.get<Blob>('audio', id);
  if (own) return own;
  if (id.startsWith('builtin:')) {
    const file = id === 'builtin:practice' ? 'practice.wav' : 'anti-utopia.mp3';
    try {
      const response = await fetch(new URL('assets/' + file, location.href));
      if (!response.ok) return undefined;
      return response.blob();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
async function openEditor(draft?: Draft) {
  if (!draft) {
    const id = uid('draft');
    draft = {
      id,
      songId: uid('song'),
      title: '',
      artist: '',
      audioId: '',
      audioName: '',
      duration: 0,
      lyricsText: '',
      lyrics: [],
      events: [],
      duets: [],
      seed: 20261005,
      tempo: 120,
      template: 'inset',
      emphasis: '',
      updatedAt: Date.now(),
    };
  }
  show('editor');
  await editor.open(draft);
}
async function editWork() {
  const entry = currentEntry(),
    chart = currentChart();
  if (!entry || !chart) return;
  const id = uid('draft');
  await openEditor({
    id,
    songId: entry.builtin ? uid('song') : entry.id,
    title: entry.title,
    artist: entry.artist,
    audioId: entry.audioId,
    audioName: entry.audioName,
    duration: entry.duration,
    lyricsText: lyricsAsLrc(chart.lyrics),
    lyrics: structuredClone(chart.lyrics),
    events: structuredClone(chart.events),
    duets: structuredClone(chart.duets),
    seed: chart.seed,
    tempo: chart.tempo,
    template: chart.template,
    emphasis: '',
    updatedAt: Date.now(),
  });
  editor.go(2);
}
async function saveEntry(entry: Entry) {
  const existing = entries.find((e) => e.id === entry.id);
  if (existing) {
    const charts = existing.charts.filter((c) => c.id !== entry.charts[0].id);
    entry = {
      ...existing,
      ...entry,
      favorite: existing.favorite,
      charts: [...entry.charts, ...charts],
    };
  }
  const saved = await store.put('entries', entry.id, entry);
  entries = entries.filter((e) => e.id !== entry.id);
  entries.push(entry);
  editor.hide();
  filtered = entries.slice();
  openEntry(entry.id);
  toast(saved ? '已加入我的曲集' : '作品仅保留在会话中，请导出谱包备份');
}
async function exportWork(includeAudio = true) {
  const entry = currentEntry();
  if (!entry) return;
  busy('整理谱包');
  try {
    const audio = await resolveAudio(entry.audioId);
    if (!audio && includeAudio) throw Error('请先附加匹配的音乐');
    await download(
      await exportPackage(entry, audio, includeAudio),
      entry.title + (includeAudio ? '' : '-谱面') + '.zip',
    );
    toast('谱包已准备');
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败');
  } finally {
    busy();
  }
}
async function importWork(file: File) {
  busy('读取谱包');
  try {
    let pack: { entry: Entry; audio?: Blob; expectedHash?: string };
    if (file.name.toLowerCase().endsWith('.json')) {
      if (file.size > 20 * 1024 * 1024) throw Error('谱面文件过大');
      const chart = JSON.parse(await file.text());
      validateChart(chart);
      if (checkClearance(chart)) throw Error('文字覆盖了路线');
      chart.revision = chartRevision(chart);
      pack = {
        entry: {
          id: chart.songId,
          title: chart.title,
          artist: chart.artist,
          duration: chart.duration,
          audioId: 'missing:' + chart.songId,
          audioName: '待附加原音乐',
          favorite: false,
          charts: [chart],
          createdAt: Date.now(),
        },
      };
    } else pack = await importPackage(file);
    const entry = pack.entry;
    if (entries.some((e) => e.id === entry.id && e.builtin)) {
      entry.id = uid('song');
      entry.charts = entry.charts.map((c) => {
        const chart = { ...c, songId: entry.id, id: uid('chart') };
        chart.revision = chartRevision(chart);
        return chart;
      });
    }
    const audioSaved = pack.audio ? await store.put('audio', entry.audioId, pack.audio) : true;
    const saved = await store.put('entries', entry.id, entry);
    entries = entries.filter((e) => e.id !== entry.id);
    entries.push(entry);
    filtered = entries.slice();
    openEntry(entry.id);
    toast(
      !audioSaved || !saved
        ? '谱包已打开，本机未持久保存，请保留原谱包'
        : pack.audio
          ? '作品已导入'
          : '谱面已导入，请附加原音乐',
    );
  } catch (e) {
    toast(e instanceof Error ? e.message : '无法导入该谱包');
  } finally {
    busy();
  }
}
async function playChart(entry: Entry, chart: Chart, auto = false, fromEditor = false) {
  const token = ++sessionToken;
  input?.destroy();
  music?.stop();
  engine = undefined;
  renderer = undefined;
  editor.stop();
  preview = fromEditor;
  runEntry = entry;
  runChart = chart;
  gameState = 'loading';
  report.reset();
  show('game');
  $('pauseOverlay').hidden = true;
  busy('准备音乐与字形');
  try {
    music ??= new MusicClock(profile.settings);
    void music.context.resume();
    music.apply(profile.settings);
    const blob = await resolveAudio(entry.audioId);
    if (!blob) throw Error('音乐尚未附加');
    await Promise.all([
      music.decode(blob),
      fontReady(chart.lyrics.map((l) => l.text).join('') + chart.title),
    ]);
    if (token !== sessionToken) return;
    validateChart(chart);
    engine = new Engine(chart, profile.settings.difficulty);
    const chapter =
      !fromEditor && practice !== 'full' ? chart.chapters[Number(practice)] : undefined;
    runRange = { start: chapter?.start || 0, end: chapter?.end || chart.duration };
    if (chapter)
      engine.events.splice(
        0,
        engine.events.length,
        ...engine.events.filter((e) => e.t >= runRange.start && e.t < runRange.end),
      );
    renderer = new Renderer($<HTMLCanvasElement>('gameCanvas'), engine, { ...profile.settings });
    renderer.camera = engine.ball(0, runRange.start);
    automatic = auto;
    assisted = auto;
    input = new PlayInput(
      $('field'),
      engine,
      (stamp) => music!.judgedTime(stamp),
      () => current === 'game' && gameState === 'running' && !automatic,
      (j) => onJudgment(j),
      () => {
        report.input(input?.lastDeliveryMs || 0);
        if (renderer) renderer.contactAt = performance.now();
      },
      rotated,
    );
    $('gameTitle').textContent = entry.title;
    $('combo').textContent = '0';
    $('score').textContent = '0000';
    $('judgment').textContent = '';
    $('offset').textContent = '';
    lastHud = -99;
    const started = await music.play(runRange.start, runRange.end, 0.8);
    if (!started) return;
    if (token !== sessionToken) {
      music.stop();
      return;
    }
    gameState = 'running';
    busy();
    if (document.hidden) pauseGame();
    $('field').focus({ preventScroll: true });
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
    entry.lastPlayed = Date.now();
    void store.put('entries', entry.id, entry);
  } catch (e) {
    if (token !== sessionToken) return;
    music?.stop();
    gameState = 'idle';
    busy();
    toast(e instanceof Error ? e.message : '音乐未启动，请再试一次');
    if (fromEditor) {
      show('editor');
      editor.returnFromPreview();
    } else show('work');
  }
}
function onJudgment(j: Judgment) {
  renderer?.feedback(j);
  if (j.grade !== 'MISS') music?.feedback(j.kind === 'double');
  $('judgment').textContent =
    j.grade === 'MISS' ? 'MISS' : Math.abs(j.offset) <= 0.025 ? 'JUST' : j.grade;
  $('offset').textContent =
    j.grade === 'MISS' ? '' : (j.offset >= 0 ? '+' : '') + Math.round(j.offset * 1000) + ' ms';
  $('timingNeedle').style.left = clamp(50 + (j.offset / 0.18) * 50, 0, 100) + '%';
  toastPrecisionAt = performance.now();
}
function frame(stamp: number) {
  const started = performance.now();
  if (current !== 'game' || !engine || !music || !renderer) return;
  const raw = music.time(),
    t = music.judgedTime();
  if (gameState === 'running') {
    const before = engine.signals.length;
    engine.tick(t, automatic);
    for (const j of engine.signals.slice(before)) onJudgment(j);
    renderer.draw(t, stamp);
    report.frame(stamp, performance.now() - started);
    if (stamp - lastHud > 45) {
      lastHud = stamp;
      $('combo').textContent = String(engine.combo);
      $('score').textContent = String(engine.score()).padStart(4, '0');
      $('gameClock').textContent = clock(raw) + ' / ' + clock(runRange.end);
      $<HTMLProgressElement>('gameProgress').value = clamp(
        (raw - runRange.start) / (runRange.end - runRange.start),
        0,
        1,
      );
      $('nextNotes').innerHTML = engine
        .upcoming(3, t)
        .map(
          (e) =>
            '<li><b>' +
            (e.kind === 'double' ? '● ●' : e.kind === 'swipe' ? '↔' : '●') +
            '</b><small>' +
            Math.max(0, e.t - t).toFixed(1) +
            's</small></li>',
        )
        .join('');
      if (stamp - toastPrecisionAt > 700) {
        $('judgment').textContent = '';
        $('offset').textContent = '';
      }
    }
    if (raw >= runRange.end + MOTION_DELAY) {
      finish();
      return;
    }
  } else renderer.draw(t, stamp);
  frameId = requestAnimationFrame(frame);
}
function pauseGame() {
  if (gameState !== 'running') return;
  music?.pause();
  gameState = 'paused';
  input?.clear();
  $('pauseOverlay').hidden = false;
  $('pauseLabel').textContent = automatic ? '演示 / 暂停' : '暂停';
  $('pauseTitle').textContent = '下一拍，继续。';
  $('toggleAuto').textContent = automatic ? '接管' : '演示';
}
async function resumeGame() {
  if (gameState !== 'paused' || !music) return;
  try {
    music.apply({ ...profile.settings, offset: music.settings.offset });
    if (renderer)
      Object.assign(renderer.settings, { ...profile.settings, offset: music.settings.offset });
    input?.clear();
    renderer?.resize();
    const token = sessionToken;
    const started = await music.resume();
    if (!started || token !== sessionToken || current !== 'game') return;
    gameState = 'running';
    $('pauseOverlay').hidden = true;
    $('field').focus({ preventScroll: true });
  } catch {
    toast('声音未启动，请再点继续');
  }
}
function leaveGame() {
  sessionToken++;
  music?.stop();
  input?.destroy();
  cancelAnimationFrame(frameId);
  gameState = 'idle';
  if (preview) {
    show('editor');
    editor.returnFromPreview();
  } else show('work');
}
function finish() {
  if (!engine || !music || !runEntry) return;
  engine.tick(runRange.end + engine.goodWindow + 0.05, automatic);
  gameState = 'finished';
  music.stop();
  input?.clear();
  const result = engine.result(assisted, preview || practice !== 'full');
  result.routes = engine.keys.map((k) => [
    engine!.ball(k.id, runRange.start),
    ...k.keys.filter((p) => p.t > runRange.start && p.t < runRange.end),
    engine!.ball(k.id, runRange.end),
  ]);
  const key = [result.chartId, result.revision, result.difficulty].join(':'),
    newBest = !profile.bests[key] || result.score > profile.bests[key].score;
  void store.record(profile, result).then((saved) => {
    if (!saved && !result.assisted && !result.practice) toast('成绩未持久保存；可先导出作品备份');
  });
  $('resultSong').textContent = runEntry.title + ' / ' + runEntry.artist;
  $('resultScore').textContent = String(result.score).padStart(4, '0');
  $('resultGrade').textContent = result.grade;
  $('resultBadge').textContent = result.assisted
    ? '演示成绩 · 不计入最高分'
    : result.practice
      ? '练习成绩 · 不计入最高分'
      : newBest
        ? '新的本机最高纪录'
        : result.miss === 0
          ? '全连完成'
          : '演奏完成';
  for (const [id, key] of [
    ['resultPerfect', 'perfect'],
    ['resultGood', 'good'],
    ['resultMiss', 'miss'],
    ['resultCombo', 'combo'],
  ] as const)
    $(id).textContent = String(result[key]);
  $('resultPrecision').textContent =
    '命中率 ' +
    result.accuracy +
    '% · JUST ' +
    result.just +
    (result.meanError !== null ? ' · 平均偏差 ' + result.meanError + ' ms' : '');
  $('resultMode').textContent =
    (result.assisted ? '演示' : result.practice ? '练习' : '完整演奏') +
    ' / ' +
    (result.difficulty === 'basic' ? '基础' : '原谱');
  drawRoute(result);
  show('results');
}
function drawRoute(result: Result) {
  const points = result.routes.flat(),
    minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y)),
    scale = Math.min(310 / Math.max(1, maxX - minX), 270 / Math.max(1, maxY - minY)),
    dx = (360 - (maxX - minX) * scale) / 2,
    dy = (320 - (maxY - minY) * scale) / 2;
  $('resultRoute').innerHTML = result.routes
    .map(
      (route, i) =>
        '<polyline stroke="' +
        (i ? '#bbb' : '#444') +
        '" points="' +
        route
          .map(
            (p) =>
              (dx + (p.x - minX) * scale).toFixed(2) + ',' + (dy + (p.y - minY) * scale).toFixed(2),
          )
          .join(' ') +
        '"/>',
    )
    .join('');
}
function settingsUI() {
  const s = profile.settings;
  $<HTMLInputElement>('musicVolume').value = String(s.music);
  $<HTMLInputElement>('hitVolume').value = String(s.hits);
  $<HTMLInputElement>('timingOffset').value = String(s.offset);
  $('musicValue').textContent = s.music + '%';
  $('hitsValue').textContent = s.hits + '%';
  $('offsetValue').textContent = (s.offset > 0 ? '+' : '') + s.offset + ' ms';
  $<HTMLInputElement>('effectsEnabled').checked = s.effects;
  $<HTMLInputElement>('hapticsEnabled').checked = s.haptics;
  $<HTMLSelectElement>('layoutPicker').value = s.layout;
  $('performanceInfo').textContent = report.summary();
  $('offlineInfo').textContent = offlineStatus;
  $('storageInfo').textContent =
    store.persistent && !store.unsaved.size
      ? '音乐、草稿与纪录保存在这台设备。'
      : '部分内容未持久保存，请导出谱包备份。';
}
document.querySelectorAll<HTMLElement>('[data-action]').forEach(
  (b) =>
    (b.onclick = () => {
      switch (b.dataset.action) {
        case 'cover':
          if (gameState === 'running' || gameState === 'paused') leaveGame();
          show('cover');
          break;
        case 'library':
          if (gameState === 'running' || gameState === 'paused') leaveGame();
          show('library');
          break;
        case 'create':
          void openEditor();
          break;
        case 'settings':
          settingsBack = current;
          pauseGame();
          editor.stop();
          settingsUI();
          show('settings');
          break;
        case 'help':
          helpBack = current;
          show('help');
          break;
        case 'layout':
          profile.settings.layout = profile.settings.layout === 'landscape' ? 'auto' : 'landscape';
          void persist();
          layout();
          break;
      }
    }),
);
$('openBook').onclick = () => show('library');
$('resumeBook').onclick = () => openEntry(profile.lastPage);
$('search').addEventListener('input', () => void renderLibrary());
document.querySelectorAll<HTMLElement>('[data-filter]').forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter!;
      void renderLibrary();
    }),
);
$('prevPage').onclick = () => flip(-1);
$('nextPage').onclick = () => flip(1);
$('favorite').onclick = () => {
  const e = currentEntry();
  e.favorite = !e.favorite;
  void store.put('entries', e.id, e).then((saved) => {
    if (!saved) toast('收藏仅在当前会话中保留');
  });
  void renderWork();
};
$('chartPicker').addEventListener('change', () => {
  selectedChart = Number($<HTMLSelectElement>('chartPicker').value);
  practice = 'full';
  void renderWork();
});
$('practicePicker').addEventListener(
  'change',
  () => (practice = $<HTMLSelectElement>('practicePicker').value),
);
document.querySelectorAll<HTMLElement>('[data-difficulty]').forEach(
  (b) =>
    (b.onclick = () => {
      profile.settings.difficulty = b.dataset.difficulty as Settings['difficulty'];
      void persist();
      void renderWork();
    }),
);
$('play').onclick = () => void playChart(currentEntry(), currentChart());
$('demo').onclick = () => void playChart(currentEntry(), currentChart(), true);
$('editWork').onclick = () => void editWork();
$('exportWork').onclick = () => void exportWork();
$('exportChart').onclick = () => void exportWork(false);
$('importPackage').onclick = () => {
  $<HTMLInputElement>('packageFile').value = '';
  $('packageFile').click();
};
$<HTMLInputElement>('packageFile').onchange = (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void importWork(file);
};
$('attachAudio').onclick = () => {
  $<HTMLInputElement>('attachFile').value = '';
  $('attachFile').click();
};
$<HTMLInputElement>('attachFile').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0],
    entry = currentEntry();
  if (!file || !entry) return;
  busy('核对音乐');
  try {
    const digest = await sha256(file);
    if (entry.audioId.startsWith('sha256:') && digest !== entry.audioId.slice(7))
      throw Error('这份音乐与谱包不匹配，请选择原文件');
    const Audio = window.AudioContext || (window as any).webkitAudioContext;
    const probe = new Audio();
    try {
      const decoded = await probe.decodeAudioData(await file.arrayBuffer());
      if (entry.audioId.startsWith('missing:') && Math.abs(decoded.duration - entry.duration) > 0.3)
        throw Error('音乐时长与谱面不匹配，请选择原文件');
    } catch (error) {
      throw error instanceof Error ? error : Error('音乐无法解码');
    } finally {
      await probe.close();
    }
    const saved = await store.put('audio', entry.audioId, file);
    toast(saved ? '音乐已附加' : '音乐仅在当前会话中可用，请导出备份');
    void renderWork();
  } catch (error) {
    toast(error instanceof Error ? error.message : '附加失败');
  } finally {
    busy();
  }
};
$('pause').onclick = () => (gameState === 'running' ? pauseGame() : void resumeGame());
$('continue').onclick = () => void resumeGame();
$('restart').onclick = () =>
  runEntry && runChart && void playChart(runEntry, runChart, false, preview);
$('leaveGame').onclick = leaveGame;
$('gameSettings').onclick = () => {
  settingsBack = 'game';
  settingsUI();
  show('settings');
};
$('toggleAuto').onclick = () => {
  automatic = !automatic;
  if (automatic) assisted = true;
  $('toggleAuto').textContent = automatic ? '接管' : '演示';
};
$('again').onclick = () =>
  runEntry && runChart && void playChart(runEntry, runChart, false, preview);
$('resultBack').onclick = leaveGame;
$('resultHome').onclick = leaveGame;
$('closeSettings').onclick = () => show(settingsBack);
$('closeHelp').onclick = () => show(helpBack);
$('startTutorial').onclick = () => {
  const entry = entries.find((e) => e.id === 'practice');
  if (!entry) return;
  filtered = entries.slice();
  pageIndex = filtered.indexOf(entry);
  selectedChart = 0;
  practice = 'full';
  profile.settings.difficulty = 'standard';
  void playChart(entry, entry.charts[0], false);
};
for (const [id, key] of [
  ['musicVolume', 'music'],
  ['hitVolume', 'hits'],
  ['timingOffset', 'offset'],
] as const)
  $(id).addEventListener('input', () => {
    profile.settings[key] = Number($<HTMLInputElement>(id).value);
    settingsUI();
    void persist();
  });
for (const [id, key] of [
  ['effectsEnabled', 'effects'],
  ['hapticsEnabled', 'haptics'],
] as const)
  $(id).addEventListener('change', () => {
    profile.settings[key] = $<HTMLInputElement>(id).checked;
    void persist();
  });
$('layoutPicker').addEventListener('change', () => {
  profile.settings.layout = $<HTMLSelectElement>('layoutPicker').value as Settings['layout'];
  void persist();
  layout();
});
$('resetSettings').onclick = () => {
  profile.settings = { ...defaults };
  settingsUI();
  layout();
  void persist();
  toast('已恢复默认设置');
};
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    else toast('可在浏览器菜单中添加到主屏幕');
  } catch {
    toast('全屏未开启，仍可正常演奏');
  }
};
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea,select')) return;
  if (e.code === 'Escape') {
    e.preventDefault();
    if (current === 'game') gameState === 'running' ? pauseGame() : void resumeGame();
    else if (current === 'settings') show(settingsBack);
    else if (current === 'help') show(helpBack);
  }
  if (current === 'work' && ['ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
    flip(e.code === 'ArrowRight' ? 1 : -1);
  }
});
window.addEventListener('resize', layout);
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});
new ResizeObserver(() => renderer?.resize()).observe($('field'));
async function init() {
  try {
    await store.open();
    profile = await store.profile();
    profile.settings = { ...defaults, ...profile.settings };
    if (new URLSearchParams(location.search).get('layout') === 'landscape')
      profile.settings.layout = 'landscape';
    const response = await fetch('catalog.json');
    if (!response.ok) throw Error('曲集未载入');
    const catalog = await response.json();
    const builtin: Entry[] = catalog.entries;
    for (const e of builtin) for (const c of e.charts) validateChart(c);
    const own = await store.entries();
    const merged = new Map(builtin.map((e) => [e.id, e]));
    for (const e of own) {
      try {
        for (const c of e.charts) validateChart(c);
        const original = merged.get(e.id);
        merged.set(
          e.id,
          e.builtin && original
            ? { ...original, favorite: e.favorite, lastPlayed: e.lastPlayed }
            : e,
        );
      } catch {
        toast('一份旧谱面未通过校验，原数据保留');
      }
    }
    entries = [...merged.values()];
    filtered = entries.slice();
    show('cover');
    if (!store.persistent) toast('当前为临时模式，请通过谱包保存作品');
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .register('sw.js', { scope: './' })
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          offlineStatus = '程序与宋体字库已准备，可离线创作';
          $('performanceInfo').textContent = report.summary();
          $('offlineInfo').textContent = offlineStatus;
        })
        .catch(() => {
          offlineStatus = '离线资源未完成，请联网后再试';
        });
  } catch (e) {
    layout();
    toast(e instanceof Error ? e.message : '初始化失败，请刷新；仍可尝试新建作品');
    $('coverCount').textContent = '内置曲集未载入，可创作自己的作品';
  }
}
void init();
