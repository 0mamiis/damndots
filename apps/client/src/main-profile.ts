import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Ana Codex profiline geçici olarak Dots ağ geçidi ayarlarını yazar ve çıkışta eski haline getirir.
// Değişen tek şey auth.json ile config.toml içindeki iki adres satırıdır; özgün kopyalar stateDir altında tutulur.
const OURS = /^\s*(?:chatgpt_base_url|openai_base_url)\s*=.*\r?\n/gm;
const exists = (p: string) => stat(p).then(() => true, () => false);
const marker = (stateDir: string) => join(stateDir, 'main-profile-state.json');

export async function enterMainProfile(home: string, stateDir: string): Promise<{ recovered: boolean }> {
  const recovered = await leaveMainProfile(home, stateDir); // önceki oturum düzgün kapanmadıysa önce onu geri al
  const original = join(stateDir, 'original');
  await mkdir(original, { recursive: true });
  const had = { auth: await exists(join(home, 'auth.json')), config: await exists(join(home, 'config.toml')) };
  if (had.auth) await copyFile(join(home, 'auth.json'), join(original, 'auth.json'));
  if (had.config) await copyFile(join(home, 'config.toml'), join(original, 'config.toml'));
  await writeFile(marker(stateDir), JSON.stringify({ home, had, at: new Date().toISOString() }), { mode: 0o600 });
  return { recovered };
}

export async function leaveMainProfile(home: string, stateDir: string): Promise<boolean> {
  let state: { home: string; had: { auth: boolean; config: boolean } };
  try { state = JSON.parse(await readFile(marker(stateDir), 'utf8')); } catch { return false; }
  if (state.home !== home) throw new Error('Kayıtlı geri alma bilgisi başka bir profile ait: ' + state.home);
  const original = join(stateDir, 'original');
  if (state.had.auth) await copyFile(join(original, 'auth.json'), join(home, 'auth.json'));
  else await rm(join(home, 'auth.json'), { force: true });
  if (state.had.config) {
    const first = await readFile(join(original, 'config.toml'), 'utf8');
    const current = (await exists(join(home, 'config.toml'))) ? await readFile(join(home, 'config.toml'), 'utf8') : '';
    // Oturum sırasında uygulamanın config.toml'a eklediği her şey korunur; yalnızca bizim iki satır özgün satırlarla değişir.
    await writeFile(join(home, 'config.toml'), (first.match(OURS) ?? []).join('') + current.replace(OURS, ''), { mode: 0o600 });
  } else {
    const current = (await exists(join(home, 'config.toml'))) ? (await readFile(join(home, 'config.toml'), 'utf8')).replace(OURS, '') : '';
    if (current.trim()) await writeFile(join(home, 'config.toml'), current, { mode: 0o600 }); else await rm(join(home, 'config.toml'), { force: true });
  }
  await rm(marker(stateDir), { force: true });
  return true;
}
