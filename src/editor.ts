import type { Draft, Entry, Chart, Note, GenerationRequest, Settings } from './types';
import { LibraryStore } from './store';
import { MusicClock } from './audio';
import { parseLyrics, lyricsAsLrc } from './lyrics';
import { drawPoster } from './renderer';
import { clamp } from './geometry';
import { estimateTempo } from './generator';
import { exportPackage, download } from './packages';
import { $, esc, clock, uid, toast, busy, fontReady, drawWave } from './ui';
type Hooks = {
  generate: (request: GenerationRequest) => Promise<Chart>;
  resolveAudio: (id: string) => Promise<Blob | undefined>;
  settings: () => Settings;
  save: (entry: Entry) => Promise<void>;
  preview: (chart: Chart, entry: Entry) => Promise<void>;
  leave: () => void;
};
export class Editor {
  draft?: Draft;
  step = 0;
  clock?: MusicClock;
  blob?: Blob;
  wave: number[] = [];
  history: Draft[] = [];
  future: Draft[] = [];
  selected?: string;
  mode: 'idle' | 'listen' | 'record' | 'sync' = 'idle';
  captured: Note[] = [];
  range = { start: 0, end: 0 };
  contacts = new Map<number, { t: number; id?: string }>();
  lastKey?: { pointer: number; t: number; id: string };
  syncIndex = 0;
  visible = false;
  raf = 0;
  saveTimer?: ReturnType<typeof setTimeout>;
  textTimer?: ReturnType<typeof setTimeout>;
  recordOriginal?: Draft;
  loadToken = 0;
  held = new Set<string>();
  constructor(
    readonly store: LibraryStore,
    readonly hooks: Hooks,
  ) {
    document
      .querySelectorAll<HTMLElement>('[data-step]')
      .forEach((b) => (b.onclick = () => this.go(Number(b.dataset.step))));
    $('nextStep').onclick = () => this.go(this.step + 1);
    $('prevStep').onclick = () => this.go(this.step - 1);
    $('leaveEditor').onclick = () => {
      this.flushFields();
      this.flushLyrics();
      this.stop();
      void this.persist();
      this.hide();
      hooks.leave();
    };
    $('chooseAudio').onclick = () => {
      $<HTMLInputElement>('audioFile').value = '';
      $('audioFile').click();
    };
    $<HTMLInputElement>('audioFile').onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void this.importAudio(file);
    };
    $('chooseLyrics').onclick = () => {
      $<HTMLInputElement>('lyricsFile').value = '';
      $('lyricsFile').click();
    };
    $<HTMLInputElement>('lyricsFile').onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f || !this.draft) return;
      this.checkpoint();
      this.draft.lyricsText = await f.text();
      this.draft.lyrics = parseLyrics(this.draft.lyricsText);
      this.changed();
      this.fields();
    };
    for (const [id, key] of [
      ['draftTitle', 'title'],
      ['draftArtist', 'artist'],
      ['emphasis', 'emphasis'],
    ] as const)
      $<HTMLInputElement>(id).addEventListener('input', () => {
        if (!this.draft) return;
        this.checkpoint();
        this.draft[key] = $<HTMLInputElement>(id).value;
        this.changed();
      });
    $<HTMLTextAreaElement>('lyricsText').addEventListener('input', () => {
      clearTimeout(this.textTimer);
      this.textTimer = setTimeout(() => {
        if (!this.draft) return;
        this.checkpoint();
        this.draft.lyricsText = $<HTMLTextAreaElement>('lyricsText').value;
        this.draft.lyrics = parseLyrics(this.draft.lyricsText);
        this.changed();
        this.lyricList();
      }, 350);
    });
    $<HTMLSelectElement>('template').onchange = () => {
      if (this.draft) {
        this.checkpoint();
        this.draft.template = $<HTMLSelectElement>('template').value as Chart['template'];
        this.changed();
      }
    };
    $<HTMLInputElement>('seed').onchange = () => {
      if (this.draft) {
        this.checkpoint();
        this.draft.seed = Number($<HTMLInputElement>('seed').value) || 0;
        this.changed();
      }
    };
    $<HTMLInputElement>('tempo').onchange = () => {
      if (this.draft) {
        this.checkpoint();
        this.draft.tempo = clamp(Number($<HTMLInputElement>('tempo').value) || 120, 30, 300);
        this.changed();
      }
    };
    $('undo').onclick = () => this.undo();
    $('redo').onclick = () => this.redo();
    $('record').onclick = () => void this.transport('record');
    $('listen').onclick = () => void this.transport('listen');
    $('stopRecord').onclick = () => this.stop();
    $('syncLyrics').onclick = () =>
      this.mode === 'sync' ? this.stop() : void this.transport('sync');
    $('markLyric').onclick = () => this.markLyric();
    $('snap').onclick = () => this.snap();
    $<HTMLInputElement>('recordSeek').oninput = () => {
      if (this.mode !== 'idle') this.stop();
      if (this.clock) this.clock.paused = Number($<HTMLInputElement>('recordSeek').value);
      this.waveDraw();
    };
    $('tapPad').addEventListener('pointerdown', (e) => {
      if (this.mode !== 'record') return;
      e.preventDefault();
      $('tapPad').setPointerCapture(e.pointerId);
      this.recordDown(e.pointerId, this.clock!.judgedTime(e.timeStamp));
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      $('tapPad').addEventListener(name, (e) =>
        this.contacts.delete((e as PointerEvent).pointerId),
      );
    document.addEventListener('keydown', (e) => {
      if (
        !this.visible ||
        this.mode !== 'record' ||
        e.repeat ||
        this.held.has(e.code) ||
        (e.target as HTMLElement).matches('input,textarea,select,button')
      )
        return;
      if (['Space', 'Enter', 'KeyF', 'KeyJ'].includes(e.code)) {
        e.preventDefault();
        this.held.add(e.code);
        this.recordDown(
          e.code === 'KeyF' ? -1 : e.code === 'KeyJ' ? -2 : -3,
          this.clock!.judgedTime(e.timeStamp),
        );
      }
    });
    document.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.contacts.delete(e.code === 'KeyF' ? -1 : e.code === 'KeyJ' ? -2 : -3);
    });
    $('noteTime').addEventListener('change', () =>
      this.updateSelected({ t: Number($<HTMLInputElement>('noteTime').value) }),
    );
    $('noteKind').addEventListener('change', () =>
      this.updateSelected({ kind: $<HTMLSelectElement>('noteKind').value as Note['kind'] }),
    );
    $('deleteNote').onclick = () => {
      if (!this.draft || !this.selected) return;
      this.checkpoint();
      this.draft.events = this.draft.events.filter((e) => e.id !== this.selected);
      this.selected = undefined;
      this.changed();
      this.timeline();
    };
    $('addDuet').onclick = () => {
      if (!this.draft) return;
      const start = Number($<HTMLInputElement>('duetStart').value),
        end = Number($<HTMLInputElement>('duetEnd').value);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        end > this.draft.duration
      ) {
        toast('双球段落需要位于音乐范围内');
        return;
      }
      this.checkpoint();
      this.draft.duets.push({ id: uid('duet'), start, end });
      this.changed();
      this.duetList();
    };
    $('generate').onclick = () => void this.generate();
    $('previewDraft').onclick = () => void this.preview();
    $('saveWork').onclick = () => void this.save();
    $('saveCopy').onclick = () => void this.save(true);
    $('exportDraft').onclick = () => void this.export();
    window.addEventListener('blur', () => {
      if (this.mode !== 'idle') this.stop();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode !== 'idle') this.stop();
    });
  }
  async open(draft: Draft) {
    this.stop();
    this.draft = structuredClone(draft);
    this.visible = true;
    this.history = [];
    this.future = [];
    this.step = 0;
    this.blob = undefined;
    this.wave = [];
    this.fields();
    this.go(0);
    const token = ++this.loadToken;
    if (draft.audioId) {
      try {
        const blob = await this.hooks.resolveAudio(draft.audioId);
        if (token !== this.loadToken) return;
        if (blob) {
          this.blob = blob;
          this.clock ??= new MusicClock(this.hooks.settings());
          await this.clock.decode(blob);
          if (token !== this.loadToken) return;
          this.wave = this.clock.waveform();
          this.waveDraw();
        }
      } catch {
        toast('草稿音乐未载入，可重新选择文件');
      }
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }
  hide() {
    this.visible = false;
    this.loadToken++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.textTimer);
  }
  checkpoint() {
    if (!this.draft) return;
    this.history.push(structuredClone(this.draft));
    this.history = this.history.slice(-40);
    this.future = [];
    this.historyUI();
  }
  undo() {
    if (!this.draft || !this.history.length) return;
    this.stop();
    this.future.push(structuredClone(this.draft));
    this.draft = this.history.pop()!;
    this.fields();
    this.scheduleSave();
    this.historyUI();
  }
  redo() {
    if (!this.draft || !this.future.length) return;
    this.stop();
    this.history.push(structuredClone(this.draft));
    this.draft = this.future.pop()!;
    this.fields();
    this.scheduleSave();
    this.historyUI();
  }
  historyUI() {
    ($('undo') as HTMLButtonElement).disabled = !this.history.length;
    ($('redo') as HTMLButtonElement).disabled = !this.future.length;
  }
  changed() {
    if (!this.draft) return;
    this.draft.chart = undefined;
    this.draft.updatedAt = Date.now();
    this.scheduleSave();
    this.historyUI();
    $('finishInfo').textContent = '节奏或文字已改变，请重新生成地图。';
  }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    $('saveStatus').textContent = '待保存';
    this.saveTimer = setTimeout(() => void this.persist(), 650);
  }
  async persist() {
    clearTimeout(this.saveTimer);
    if (!this.draft) return;
    const saved = await this.store.put('drafts', this.draft.id, this.draft);
    $('saveStatus').textContent = saved ? '草稿已保存' : '未持久保存 · 请导出';
    return saved;
  }
  fields() {
    if (!this.draft) return;
    const d = this.draft;
    for (const [id, key] of [
      ['draftTitle', 'title'],
      ['draftArtist', 'artist'],
      ['lyricsText', 'lyricsText'],
      ['emphasis', 'emphasis'],
      ['template', 'template'],
      ['seed', 'seed'],
      ['tempo', 'tempo'],
    ] as const)
      $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).value = String(d[key]);
    $('audioName').textContent = d.audioName
      ? d.audioName + ' · ' + clock(d.duration)
      : '尚未选择音乐';
    $<HTMLInputElement>('rangeEnd').value = String(d.duration || 10);
    $<HTMLInputElement>('recordSeek').max = String(d.duration || 100);
    $('editorNote').textContent = this.store.persistent ? '自动保存草稿' : '临时模式 · 请导出备份';
    this.lyricList();
    this.duetList();
    this.timeline();
    this.historyUI();
    this.poster();
  }
  go(step: number) {
    if (!this.draft) return;
    step = clamp(step, 0, 4);
    if (step > 0 && !this.draft.duration) {
      toast('先选择一首音乐');
      return;
    }
    this.flushFields();
    this.flushLyrics();
    this.stop();
    this.step = step;
    document
      .querySelectorAll<HTMLElement>('[data-panel]')
      .forEach((p) => (p.hidden = Number(p.dataset.panel) !== step));
    document
      .querySelectorAll('[data-step]')
      .forEach((b) =>
        b.setAttribute(
          'aria-current',
          Number((b as HTMLElement).dataset.step) === step ? 'step' : 'false',
        ),
      );
    ($('prevStep') as HTMLButtonElement).disabled = step === 0;
    ($('nextStep') as HTMLButtonElement).disabled = step === 4;
    document.querySelector('.editor-body')!.scrollTop = 0;
    this.waveDraw();
    this.poster();
    if (step === 2) $('tapPad').focus({ preventScroll: true });
  }
  flushFields() {
    if (!this.draft) return;
    const patch: Partial<Draft> = {
      title: $<HTMLInputElement>('draftTitle').value,
      artist: $<HTMLInputElement>('draftArtist').value,
      emphasis: $<HTMLInputElement>('emphasis').value,
      template: $<HTMLSelectElement>('template').value as Chart['template'],
      seed: Number($<HTMLInputElement>('seed').value) || 0,
      tempo: clamp(Number($<HTMLInputElement>('tempo').value) || 120, 30, 300),
    };
    if (Object.entries(patch).some(([key, value]) => this.draft![key as keyof Draft] !== value)) {
      this.checkpoint();
      Object.assign(this.draft, patch);
      this.changed();
    }
  }
  flushLyrics() {
    if (this.draft && $<HTMLTextAreaElement>('lyricsText').value !== this.draft.lyricsText) {
      clearTimeout(this.textTimer);
      this.checkpoint();
      this.draft.lyricsText = $<HTMLTextAreaElement>('lyricsText').value;
      this.draft.lyrics = parseLyrics(this.draft.lyricsText);
      this.changed();
      this.lyricList();
    }
  }
  async importAudio(file: File) {
    const token = ++this.loadToken;
    if (!this.draft) return;
    busy('读取音乐与波形');
    try {
      this.clock ??= new MusicClock(this.hooks.settings());
      const buffer = await this.clock.decode(file);
      if (token !== this.loadToken) return;
      this.checkpoint();
      const id = uid('audio');
      const persisted = await this.store.put('audio', id, file);
      this.blob = file;
      this.draft.audioId = id;
      this.draft.audioName = file.name;
      this.draft.duration = buffer.duration;
      if (!this.draft.title) this.draft.title = file.name.replace(/\.[^.]+$/, '');
      this.draft.events = [];
      this.draft.duets = [];
      this.wave = this.clock.waveform();
      this.changed();
      await this.persist();
      this.fields();
      if (!persisted) toast('音乐仅在本次会话中保留，完成后请导出谱包');
      else toast('音乐已导入');
    } catch {
      toast('音乐无法解码，请尝试 MP3 或 WAV；原草稿保留');
    } finally {
      busy();
    }
  }
  async transport(mode: 'listen' | 'record' | 'sync') {
    if (!this.draft || !this.blob) {
      toast('先选择音乐文件');
      return;
    }
    this.stop();
    this.flushLyrics();
    this.clock ??= new MusicClock(this.hooks.settings());
    this.clock.apply(this.hooks.settings());
    if (!this.clock.buffer) await this.clock.decode(this.blob);
    let start =
      mode === 'sync'
        ? 0
        : mode === 'record'
          ? Number($<HTMLInputElement>('rangeStart').value)
          : Number($<HTMLInputElement>('recordSeek').value);
    const end =
      mode === 'record' ? Number($<HTMLInputElement>('rangeEnd').value) : this.draft.duration;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > this.draft.duration + 0.01
    ) {
      toast('请检查录制段落的起止时间');
      return;
    }
    this.range = { start, end: Math.min(end, this.draft.duration) };
    this.captured = [];
    this.recordOriginal = mode === 'record' ? structuredClone(this.draft) : undefined;
    if (mode === 'record') this.checkpoint();
    if (mode === 'sync') {
      this.checkpoint();
      this.syncIndex = 0;
      this.lyricList();
    }
    try {
      if (!(await this.clock.play(start, this.range.end, 0.8))) return;
      this.mode = mode;
      ($('stopRecord') as HTMLButtonElement).disabled = false;
      ($('record') as HTMLButtonElement).disabled = true;
      ($('listen') as HTMLButtonElement).disabled = true;
      ($('markLyric') as HTMLButtonElement).disabled = mode !== 'sync';
      $('tapHint').textContent =
        mode === 'record' ? '跟着音乐敲 · 双指记录双押' : '单击 / 双指 · 空格 / F＋J';
      $('syncLyrics').textContent = mode === 'sync' ? '停止标句' : '听歌标句';
      if (mode === 'record') $('tapPad').focus({ preventScroll: true });
    } catch {
      toast('声音未启动，请再次点击');
    }
  }
  recordDown(pointer: number, t: number) {
    if (
      !this.draft ||
      this.mode !== 'record' ||
      t < this.range.start ||
      t >= this.range.end ||
      this.contacts.has(pointer)
    )
      return;
    this.contacts.set(pointer, { t });
    const recent = this.captured.at(-1),
      partner =
        recent?.kind === 'tap' &&
        ([...this.contacts.entries()].find(
          ([id, c]) => id !== pointer && c.id === recent.id && Math.abs(c.t - t) <= 0.08,
        ) ||
          (pointer < 0 &&
            this.lastKey &&
            this.lastKey.pointer !== pointer &&
            this.lastKey.id === recent.id &&
            Math.abs(this.lastKey.t - t) <= 0.08));
    if (partner && recent) {
      recent.kind = 'double';
      recent.rawTimes = [...(recent.rawTimes || [recent.t]), t];
      this.contacts.get(pointer)!.id = recent.id;
    } else {
      if (recent && t - recent.t < 0.035) return;
      const note: Note = { id: uid('note'), t, kind: 'tap', track: 0, rawTimes: [t] };
      this.captured.push(note);
      this.contacts.get(pointer)!.id = note.id;
    }
    if (pointer < 0) this.lastKey = { pointer, t, id: this.contacts.get(pointer)!.id! };
    this.clock!.feedback(!!partner);
    $('tapCount').textContent = String(this.captured.length);
    $('tapPad').classList.add('active');
    setTimeout(() => $('tapPad').classList.remove('active'), 70);
    this.timeline(this.captureEvents());
  }
  captureEvents() {
    if (!this.draft) return [];
    return this.mode === 'record' || this.recordOriginal
      ? [
          ...this.draft.events.filter((e) => e.t < this.range.start || e.t >= this.range.end),
          ...this.captured,
        ].sort((a, b) => a.t - b.t)
      : this.draft.events;
  }
  commitRecording() {
    if (!this.draft || !this.recordOriginal) return;
    this.draft.events = this.captureEvents();
    this.draft.tempo = estimateTempo(this.draft.events);
    $<HTMLInputElement>('tempo').value = String(this.draft.tempo);
    this.recordOriginal = undefined;
    this.changed();
    this.timeline();
  }
  stop() {
    this.clock?.pause();
    if (this.mode === 'record') this.commitRecording();
    this.mode = 'idle';
    this.contacts.clear();
    this.lastKey = undefined;
    this.held.clear();
    ($('stopRecord') as HTMLButtonElement).disabled = true;
    ($('record') as HTMLButtonElement).disabled = false;
    ($('listen') as HTMLButtonElement).disabled = false;
    ($('markLyric') as HTMLButtonElement).disabled = true;
    $('syncLyrics').textContent = '听歌标句';
    $('tapHint').textContent = '单击 / 双指 · 空格 / F＋J';
  }
  frame() {
    if (!this.visible) return;
    if (this.clock && this.mode !== 'idle') {
      const time = this.clock.time();
      $('recordClock').textContent = clock(time);
      $<HTMLInputElement>('recordSeek').value = String(Math.max(0, time));
      this.waveDraw(time);
      if (time >= this.range.end) {
        if (this.mode === 'record' && $<HTMLInputElement>('loop').checked) {
          this.commitRecording();
          this.captured = [];
          this.recordOriginal = structuredClone(this.draft!);
          this.contacts.clear();
          void this.clock.play(this.range.start, this.range.end, 0.8);
        } else this.stop();
      }
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }
  waveDraw(time = this.clock?.time() || 0) {
    const ratio = time / (this.draft?.duration || 1);
    for (const id of ['importWave', 'recordWave'])
      drawWave($<HTMLCanvasElement>(id), this.wave, ratio);
  }
  lyricList() {
    if (!this.draft) return;
    $('lyricLines').innerHTML = this.draft.lyrics
      .map(
        (l, i) =>
          '<li' +
          (i === this.syncIndex && this.mode === 'sync' ? ' class="active"' : '') +
          '><input type="number" min="0" step="0.01" aria-label="第 ' +
          (i + 1) +
          ' 句时间" data-lyric="' +
          i +
          '" value="' +
          (l.t ?? '') +
          '" placeholder="秒"><span>' +
          esc(l.text) +
          '</span></li>',
      )
      .join('');
    $('lyricLines')
      .querySelectorAll<HTMLInputElement>('input')
      .forEach(
        (input) =>
          (input.onchange = () => {
            if (!this.draft) return;
            this.checkpoint();
            const line = this.draft.lyrics[Number(input.dataset.lyric)],
              value = input.value === '' ? undefined : Number(input.value);
            if (
              value !== undefined &&
              (!Number.isFinite(value) || value < 0 || value > this.draft.duration)
            ) {
              toast('歌词起点应在音乐范围内');
              input.value = String(line.t ?? '');
              return;
            }
            line.t = value;
            this.draft.lyricsText = lyricsAsLrc(this.draft.lyrics);
            $<HTMLTextAreaElement>('lyricsText').value = this.draft.lyricsText;
            this.changed();
          }),
      );
    $('syncCurrent').textContent = this.draft.lyrics[this.syncIndex]?.text || '';
  }
  markLyric() {
    if (!this.draft || this.mode !== 'sync' || !this.clock || !this.draft.lyrics[this.syncIndex])
      return;
    this.draft.lyrics[this.syncIndex].t = clamp(this.clock.time(), 0, this.draft.duration);
    this.syncIndex++;
    this.draft.lyricsText = lyricsAsLrc(this.draft.lyrics);
    $<HTMLTextAreaElement>('lyricsText').value = this.draft.lyricsText;
    this.changed();
    this.lyricList();
    if (this.syncIndex >= this.draft.lyrics.length) this.stop();
  }
  timeline(events = this.draft?.events || []) {
    if (!this.draft) return;
    const width = Math.max($('timeline').clientWidth, this.draft.duration * 62),
      symbols = { tap: '●', double: '●●', swipe: '↔' };
    $('eventCount').textContent = events.length + ' 次';
    $('timeline').innerHTML =
      '<div class="timeline-track" style="width:' +
      width +
      'px">' +
      events
        .map(
          (e) =>
            '<button class="note-dot' +
            (this.selected === e.id ? ' selected' : '') +
            '" data-note="' +
            esc(e.id) +
            '" style="left:' +
            (e.t / this.draft!.duration) * width +
            'px" aria-label="' +
            e.t.toFixed(3) +
            ' 秒 ' +
            (e.kind === 'double' ? '双押' : e.kind === 'swipe' ? '岔路' : '单击') +
            '">' +
            symbols[e.kind] +
            '<small>' +
            e.t.toFixed(2) +
            '</small></button>',
        )
        .join('') +
      '</div>';
    $('tapCount').textContent = String(events.length);
    $('timeline')
      .querySelectorAll<HTMLElement>('[data-note]')
      .forEach((b) => {
        let start = 0,
          original = 0,
          moved = false;
        b.addEventListener('pointerdown', (e) => {
          if (this.mode !== 'idle') return;
          e.preventDefault();
          this.selected = b.dataset.note;
          const note = this.draft!.events.find((e) => e.id === this.selected)!;
          original = note.t;
          start = document.body.dataset.rotated === 'true' ? e.clientY : e.clientX;
          moved = false;
          b.setPointerCapture(e.pointerId);
          this.selectNote();
        });
        b.addEventListener('pointermove', (e) => {
          if (!b.hasPointerCapture(e.pointerId) || this.mode !== 'idle') return;
          const delta = (document.body.dataset.rotated === 'true' ? e.clientY : e.clientX) - start;
          const note = this.draft!.events.find((e) => e.id === this.selected)!;
          if (Math.abs(delta) > 3 && !moved) {
            this.checkpoint();
            moved = true;
          }
          if (moved) {
            note.t = clamp(
              original + (delta / width) * this.draft!.duration,
              0,
              this.draft!.duration - 0.001,
            );
            b.style.left = (note.t / this.draft!.duration) * width + 'px';
            $<HTMLInputElement>('noteTime').value = note.t.toFixed(3);
          }
        });
        const up = () => {
          if (moved) {
            this.draft!.events.sort((a, b) => a.t - b.t);
            if (this.draft!.events.some((e, i, a) => i > 0 && e.t - a[i - 1].t < 0.035)) {
              this.draft!.events.find((e) => e.id === this.selected)!.t = original;
              this.draft!.events.sort((a, b) => a.t - b.t);
              toast('两个节奏点太近，可将其中一个设为双押');
            }
            this.changed();
          }
          this.timeline();
          this.selectNote();
        };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', () => {
          if (moved) this.draft!.events.find((e) => e.id === this.selected)!.t = original;
          this.timeline();
        });
      });
    this.selectNote();
  }
  selectNote() {
    const note = this.draft?.events.find((e) => e.id === this.selected);
    $('noteEditor').hidden = !note;
    if (note) {
      $<HTMLInputElement>('noteTime').value = note.t.toFixed(3);
      $<HTMLSelectElement>('noteKind').value = note.kind;
    }
  }
  updateSelected(patch: Partial<Note>) {
    const note = this.draft?.events.find((e) => e.id === this.selected);
    if (!note || !this.draft) return;
    if (
      patch.t !== undefined &&
      (!Number.isFinite(patch.t) ||
        patch.t < 0 ||
        patch.t >= this.draft.duration ||
        this.draft.events.some((e) => e.id !== note.id && Math.abs(e.t - patch.t!) < 0.035))
    ) {
      toast('请设置音乐范围内的独立时间点');
      this.selectNote();
      return;
    }
    this.checkpoint();
    Object.assign(note, patch);
    this.draft.events.sort((a, b) => a.t - b.t);
    this.changed();
    this.timeline();
  }
  snap() {
    if (!this.draft || !this.draft.events.length) return;
    this.stop();
    this.checkpoint();
    const step = 60 / this.draft.tempo / 2,
      phase = this.draft.events[0].t;
    const snapped = this.draft.events.map((e) => ({
      ...e,
      t: clamp(phase + Math.round((e.t - phase) / step) * step, 0, this.draft!.duration - 0.001),
    }));
    if (snapped.some((e, i, a) => i > 0 && e.t - a[i - 1].t < 0.035)) {
      toast('吸附会重叠节奏点，原节奏保留；可调整 BPM');
      this.history.pop();
      return;
    }
    this.draft.events = snapped;
    this.changed();
    this.timeline();
    toast('已吸附，可撤销恢复真实点击');
  }
  duetList() {
    if (!this.draft) return;
    $('duetList').innerHTML = this.draft.duets
      .map(
        (d) =>
          '<div class="duet-row"><span>● ● ' +
          d.start.toFixed(1) +
          ' — ' +
          d.end.toFixed(1) +
          ' 秒</span><button data-remove-duet="' +
          esc(d.id) +
          '">移除</button></div>',
      )
      .join('');
    $('duetList')
      .querySelectorAll<HTMLElement>('[data-remove-duet]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            this.checkpoint();
            this.draft!.duets = this.draft!.duets.filter((d) => d.id !== b.dataset.removeDuet);
            this.changed();
            this.duetList();
          }),
      );
  }
  async generate() {
    if (!this.draft || !this.draft.duration) return;
    this.flushFields();
    this.flushLyrics();
    this.stop();
    const d = this.draft;
    busy('编排路线与歌词');
    try {
      const chart = await this.hooks.generate({
        id: d.chart?.id || d.id + '-chart',
        songId: d.songId,
        title: d.title || '未命名作品',
        artist: d.artist,
        duration: d.duration,
        events: d.events,
        lyrics: d.lyrics,
        duets: d.duets,
        seed: d.seed,
        tempo: d.tempo,
        template: d.template,
        emphasis: d.emphasis,
      });
      await fontReady(chart.lyrics.map((l) => l.text).join('') + chart.title);
      d.chart = chart;
      d.updatedAt = Date.now();
      await this.persist();
      $('generationNote').textContent =
        chart.warnings.join(' ') ||
        chart.events.length + ' 次击打 · ' + chart.duets.length + ' 个双球片段';
      this.poster();
      toast('地图已生成，节奏时间保持不变');
    } catch (e) {
      toast(e instanceof Error ? e.message : '地图生成失败，草稿保留');
    } finally {
      busy();
    }
  }
  poster() {
    if (!this.draft?.chart) {
      $('finishInfo').textContent = '先生成一份地图，再试玩或保存。';
      return;
    }
    for (const id of ['generatedPoster', 'finishPoster'])
      drawPoster($<HTMLCanvasElement>(id), this.draft.chart);
    $('finishInfo').textContent =
      this.draft.chart.title +
      ' · ' +
      clock(this.draft.duration) +
      ' · ' +
      this.draft.chart.events.length +
      ' 次击打';
  }
  entry(): Entry {
    const d = this.draft!;
    return {
      id: d.songId,
      title: d.title || '未命名作品',
      artist: d.artist,
      duration: d.duration,
      audioId: d.audioId,
      audioName: d.audioName,
      favorite: false,
      charts: [d.chart!],
      createdAt: Date.now(),
    };
  }
  async preview() {
    if (!this.draft?.chart) {
      toast('先生成地图');
      this.go(3);
      return;
    }
    await this.persist();
    this.stop();
    this.visible = false;
    cancelAnimationFrame(this.raf);
    await this.hooks.preview(this.draft.chart, this.entry());
  }
  returnFromPreview() {
    this.visible = true;
    this.go(4);
    this.raf = requestAnimationFrame(() => this.frame());
  }
  async save(copy = false) {
    if (!this.draft?.chart) {
      toast('先生成地图');
      this.go(3);
      return;
    }
    this.stop();
    if (copy) {
      this.checkpoint();
      const c = structuredClone(this.draft.chart);
      c.id = uid('chart');
      this.draft.chart = c;
      this.draft.id = uid('draft');
      await this.persist();
    }
    await this.hooks.save(this.entry());
  }
  async export() {
    if (!this.draft || !this.blob) {
      toast('先导入音乐');
      return;
    }
    if (!this.draft.chart) await this.generate();
    if (!this.draft.chart) return;
    busy('打包作品');
    try {
      await download(await exportPackage(this.entry(), this.blob, true), this.draft.title + '.zip');
      toast('谱包已准备');
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败');
    } finally {
      busy();
    }
  }
}
