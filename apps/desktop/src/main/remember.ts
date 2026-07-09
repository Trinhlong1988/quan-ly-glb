// "Ghi nhớ đăng nhập" — persist credentials encrypted via Electron safeStorage.
// Plaintext never leaves the main process; the renderer only asks main to fill the form.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

interface RememberedCreds {
  username: string;
  password: string;
}

function file(): string {
  return join(app.getPath('userData'), 'remember.bin');
}

export function saveRemembered(username: string, password: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const payload = JSON.stringify({ username, password } satisfies RememberedCreds);
    const enc = safeStorage.encryptString(payload);
    writeFileSync(file(), enc);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[remember] save failed', err);
  }
}

export function clearRemembered(): void {
  try {
    if (existsSync(file())) rmSync(file());
  } catch {
    /* ignore */
  }
}

export function getRemembered(): RememberedCreds | null {
  try {
    if (!existsSync(file()) || !safeStorage.isEncryptionAvailable()) return null;
    const buf = readFileSync(file());
    const json = safeStorage.decryptString(buf);
    const parsed = JSON.parse(json) as RememberedCreds;
    if (parsed && typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      return parsed;
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[remember] read failed', err);
    return null;
  }
}
