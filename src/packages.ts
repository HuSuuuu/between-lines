import { zip, unzip, strToU8, strFromU8 } from 'fflate';
import type { Entry, Chart } from './types';
import { validateChart, checkClearance } from './validate';
import { chartRevision } from './geometry';
export type Manifest = {
  format: 'between-lines';
  version: 1;
  entry: Omit<Entry, 'charts'>;
  charts: string[];
  audio?: { file: string; sha256: string; mime: string; name: string };
};
export async function sha256(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export async function exportPackage(
  entry: Entry,
  audio: Blob | undefined,
  includeAudio = true,
): Promise<Blob> {
  if (includeAudio && !audio) throw Error('完整谱包需要音乐文件');
  const digest = audio
      ? await sha256(audio)
      : entry.audioId.startsWith('sha256:')
        ? entry.audioId.slice(7)
        : undefined,
    { charts, ...metadata } = entry,
    paths = charts.map(
      (c, i) => 'charts/' + i + '-' + c.id.replace(/[^a-z0-9_-]/gi, '_') + '.json',
    );
  const manifest: Manifest = {
    format: 'between-lines',
    version: 1,
    entry: {
      ...metadata,
      builtin: false,
      favorite: false,
      lastPlayed: undefined,
      audioId: digest ? 'sha256:' + digest : 'missing:' + entry.id,
    },
    charts: paths,
    audio: digest
      ? {
          file: 'audio.bin',
          sha256: digest,
          mime: audio?.type || 'audio/mpeg',
          name: entry.audioName,
        }
      : undefined,
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  };
  charts.forEach((chart, i) => {
    validateChart(chart);
    if (checkClearance(chart)) throw Error('文字覆盖路线，无法导出');
    files[paths[i]] = strToU8(
      JSON.stringify({ ...chart, revision: chartRevision(chart) }, null, 2),
    );
  });
  files['lyrics.txt'] = strToU8(entry.charts[0]?.lyrics.map((l) => l.text).join('\n') || '');
  if (includeAudio) files['audio.bin'] = new Uint8Array(await audio!.arrayBuffer());
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 4 }, (e, b) => (e ? reject(e) : resolve(b))),
  );
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}
export async function importPackage(
  blob: Blob,
): Promise<{ entry: Entry; audio?: Blob; expectedHash?: string }> {
  if (blob.size > 150 * 1024 * 1024) throw Error('谱包太大，无法在浏览器安全解包');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let total = 0;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(
      bytes,
      {
        filter: (file) => {
          if (
            file.name.startsWith('/') ||
            file.name.includes('..') ||
            file.originalSize > 150 * 1024 * 1024
          )
            return false;
          total += file.originalSize;
          if (total > 180 * 1024 * 1024) return false;
          return (
            file.name === 'manifest.json' ||
            file.name === 'audio.bin' ||
            /^charts\/[a-zA-Z0-9_-]+\.json$/.test(file.name)
          );
        },
      },
      (e, b) => (e ? reject(Error('谱包损坏，无法解包')) : resolve(b)),
    ),
  );
  if (!files['manifest.json']) throw Error('谱包缺少清单');
  let m: Manifest;
  try {
    m = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw Error('谱包清单不是有效 JSON');
  }
  if (
    m.format !== 'between-lines' ||
    m.version !== 1 ||
    !m.entry ||
    !Array.isArray(m.charts) ||
    !m.charts.length ||
    m.charts.length > 30
  )
    throw Error('不支持的谱包格式');
  if (
    typeof m.entry.id !== 'string' ||
    typeof m.entry.title !== 'string' ||
    typeof m.entry.artist !== 'string' ||
    typeof m.entry.duration !== 'number' ||
    typeof m.entry.audioName !== 'string'
  )
    throw Error('作品信息不完整');
  const charts: Chart[] = m.charts.map((name) => {
    if (typeof name !== 'string' || !/^charts\/[a-zA-Z0-9_-]+\.json$/.test(name) || !files[name])
      throw Error('谱包缺少谱面');
    let c: unknown;
    try {
      c = JSON.parse(strFromU8(files[name]));
    } catch {
      throw Error('谱面不是有效 JSON');
    }
    validateChart(c);
    if (c.songId !== m.entry.id || Math.abs(c.duration - m.entry.duration) > 0.02)
      throw Error('谱面与音乐信息不一致');
    if (checkClearance(c)) throw Error('文字覆盖了路线');
    return { ...c, revision: chartRevision(c) };
  });
  if (m.audio && (!/^[0-9a-f]{64}$/.test(m.audio.sha256) || m.audio.file !== 'audio.bin'))
    throw Error('音乐清单无效');
  const audio = files['audio.bin']
    ? new Blob([files['audio.bin'] as BlobPart], { type: m.audio?.mime || 'audio/mpeg' })
    : undefined;
  if (audio && m.audio?.sha256 && (await sha256(audio)) !== m.audio.sha256)
    throw Error('音乐校验失败');
  return {
    entry: {
      ...m.entry,
      charts,
      builtin: false,
      favorite: false,
      createdAt: Date.now(),
      audioId: m.audio?.sha256 ? 'sha256:' + m.audio.sha256 : 'missing:' + m.entry.id,
    },
    audio,
    expectedHash: m.audio?.sha256,
  };
}
export async function download(blob: Blob, name: string) {
  const previous = document.getElementById('downloadDialog') as HTMLDialogElement | null;
  previous?.close();
  previous?.remove();
  const url = URL.createObjectURL(blob);
  const blobUrl = url;
  const dialog = document.createElement('dialog');
  dialog.id = 'downloadDialog';
  dialog.className = 'download-dialog';
  const heading = document.createElement('h2');
  heading.textContent = '谱包已准备';
  const filename = document.createElement('p');
  filename.textContent = name;
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.textContent = '下载 ZIP →';
  link.className = 'primary';
  dialog.append(heading, filename, link);
  if (navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] })) {
    const share = document.createElement('button');
    share.textContent = '分享谱包';
    share.onclick = () => {
      void navigator
        .share({ files: [new File([blob], name, { type: blob.type })] })
        .catch(() => {});
    };
    dialog.append(share);
  }
  const close = document.createElement('button');
  close.textContent = '完成';
  close.onclick = () => dialog.close();
  dialog.append(close);
  document.getElementById('app')!.append(dialog);
  dialog.addEventListener(
    'close',
    () => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
}
