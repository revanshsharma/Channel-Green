import { describe, expect, it } from 'vitest';
import { currentPosition, isPrivateHost, parseMediaSource, parseYouTubeId } from '../src/media';

const tapes = { rain: { id: 'rain', title: 'Rain', artist: 'Tape' } } as never;

describe('currentPosition', () => {
  it('stands still while paused', () => {
    expect(currentPosition({ playing: false, position: 12, at: 1000 }, 99999)).toBe(12);
  });
  it('advances while playing', () => {
    expect(currentPosition({ playing: true, position: 10, at: 1000 }, 4000)).toBe(13);
  });
  it('never goes negative', () => {
    expect(currentPosition({ playing: true, position: 0, at: 5000 }, 1000)).toBe(0);
  });
});

describe('isPrivateHost', () => {
  it.each(['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '169.254.169.254', '::1', '[::1]', 'printer', 'db.internal', 'fd00::1'])('blocks %s', (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });
  it.each(['example.com', '8.8.8.8', '172.32.0.1', 'cdn.example.org'])('allows %s', (h) => {
    expect(isPrivateHost(h)).toBe(false);
  });
});

describe('parseYouTubeId', () => {
  const id = 'dQw4w9WgXcQ';
  it.each([id, `https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?t=3`, `https://www.youtube.com/embed/${id}`, `https://m.youtube.com/shorts/${id}`])('reads %s', (s) => {
    expect(parseYouTubeId(s)).toBe(id);
  });
  it.each(['', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=short'])('refuses %s', (s) => {
    expect(parseYouTubeId(s)).toBeNull();
  });
});

describe('parseMediaSource', () => {
  it('accepts a known tape only in the listening room', () => {
    expect(parseMediaSource('listen', 'tape', 'rain', undefined, tapes).ok).toBe(true);
    expect(parseMediaSource('watch', 'tape', 'rain', undefined, tapes).ok).toBe(false);
    expect(parseMediaSource('listen', 'tape', 'nope', undefined, tapes).ok).toBe(false);
  });
  it('accepts https video files for watch only', () => {
    expect(parseMediaSource('watch', 'video', 'https://example.com/a/b.mp4', undefined, tapes).ok).toBe(true);
    expect(parseMediaSource('listen', 'video', 'https://example.com/b.mp4', undefined, tapes).ok).toBe(false);
  });
  it('refuses http, private hosts, credentials and wrong extensions', () => {
    for (const u of ['http://example.com/a.mp4', 'https://127.0.0.1/a.mp4', 'https://u:p@example.com/a.mp4', 'https://example.com/a.exe', 'not a url']) {
      expect(parseMediaSource('watch', 'video', u, undefined, tapes).ok, u).toBe(false);
    }
  });
  it('accepts audio links in the listening room', () => {
    const r = parseMediaSource('listen', 'audio', 'https://example.com/song%20one.mp3', undefined, tapes);
    expect(r.ok && r.source.title).toBe('song one.mp3');
  });
  it('limits custom titles', () => {
    const r = parseMediaSource('watch', 'youtube', 'dQw4w9WgXcQ', 'x'.repeat(300), tapes);
    expect(r.ok && r.source.title.length).toBe(80);
  });
});
