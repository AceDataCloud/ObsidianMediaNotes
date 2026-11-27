export const services = {
  suno: { name: 'Suno', kind: 'audio', field: 'audio_url' },
  acemusic: { name: 'ACE Music', kind: 'audio', field: 'audio_url' },
  'nano-banana': { name: 'Nano Banana', kind: 'image', field: 'image_url' },
  openai: { name: 'GPT Image', kind: 'image', field: 'url' },
  seedream: { name: 'Seedream', kind: 'image', field: 'image_url' },
  flux: { name: 'Flux', kind: 'image', field: 'image_url' },
  seedance: { name: 'Seedance', kind: 'video', field: 'video_url' },
  kling: { name: 'Kling', kind: 'video', field: 'video_url' },
  veo: { name: 'Veo', kind: 'video', field: 'video_url' },
  hailuo: { name: 'Hailuo', kind: 'video', field: 'video_url' }
} as const;
export type Service = keyof typeof services;
export type MediaKind = 'image' | 'audio' | 'video';
export type Asset = { title: string; url: string };
export const maxBytes = 64 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function taskResult(service: Service, id: string, value: unknown): { state: string; assets: Asset[] } {
  const task = object(value), result = object(task.response), data = object(result.data), spec = services[service];
  if (task.id !== id || (result.task_id != null && result.task_id !== id)) throw new Error('The task response did not match that ID.');
  let rows: unknown[] = Array.isArray(result.data) ? result.data : [];
  if (service === 'seedance') rows = [data.content];
  if (service === 'kling') rows = [result];
  const assets: Asset[] = [];
  const states: string[] = [];
  for (const candidate of rows) {
    const row = object(candidate), state = row.state ?? row.status, raw = row[spec.field];
    if (typeof state === 'string') states.push(state);
    if (typeof raw !== 'string') continue;
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : `${spec.name} ${spec.kind} ${assets.length + 1}`;
    assets.push({ title, url: url.href });
  }
  const state = [result.status, result.state, data.status, task.state, task.status, ...states].find(v => typeof v === 'string' && v);
  return { assets, state: typeof state === 'string' ? state : (result.success === false || result.error ? 'failed' : assets.length || task.finished_at ? 'completed' : 'pending') };
}

export function mediaExtension(kind: MediaKind, bytes: Uint8Array): string {
  if (bytes.length > maxBytes) throw new Error('This attachment exceeds the 64 MiB import limit.');
  const starts = (...signature: number[]) => signature.every((v, i) => bytes[i] === v);
  const ascii = (i: number, txt: string) => [...txt].every((v, j) => bytes[i + j] === v.charCodeAt(0));
  if (kind === 'image') {
    if (starts(137,80,78,71,13,10,26,10)) return 'png';
    if (starts(255,216,255)) return 'jpg';
    if (ascii(0,'RIFF') && ascii(8,'WEBP')) return 'webp';
    if (ascii(0,'GIF87a') || ascii(0,'GIF89a')) return 'gif';
  } else if (kind === 'audio') {
    if (ascii(0,'ID3') || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
    if (ascii(0,'RIFF') && ascii(8,'WAVE')) return 'wav';
    if (ascii(0,'OggS')) return 'ogg';
    if (ascii(0,'fLaC')) return 'flac';
    if (ascii(4,'ftyp')) return 'm4a';
  } else {
    if (ascii(4,'ftyp')) return ascii(8,'qt  ') ? 'mov' : 'mp4';
    if (starts(26,69,223,163)) return 'webm';
  }
  throw new Error('The download did not contain a supported file for this media type.');
}
