import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enterMainProfile, leaveMainProfile } from '../src/main-profile.js';

test('main profile: gateway edits are undone, app edits made during the session survive, crashes recover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dots-main-')), home = join(root, 'home'), state = join(root, 'state');
  try {
    await (await import('node:fs/promises')).mkdir(home, { recursive: true });
    const authOriginal = '{"auth_mode":"apikey","OPENAI_API_KEY":"real"}', configOriginal = 'openai_base_url = "http://127.0.0.1:10100/v1"\nmodel = "gpt-6.1-sol"\n[projects.a]\ntrust = "trusted"\n';
    await writeFile(join(home, 'auth.json'), authOriginal); await writeFile(join(home, 'config.toml'), configOriginal);
    await enterMainProfile(home, state);
    // ağ geçidi yazar
    await writeFile(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}');
    await writeFile(join(home, 'config.toml'), 'chatgpt_base_url = "https://localhost:8002/backend-api"\nopenai_base_url = "https://localhost:8002/backend-api/codex"\nmodel = "gpt-6.1-sol"\n[projects.a]\ntrust = "trusted"\n[projects.b]\ntrust = "trusted"\n');
    // kapanmadan yeniden giriş (çökme kurtarma): önce eski hale döner, sonra aynı özgün kopyalar yeniden alınır
    assert.equal((await enterMainProfile(home, state)).recovered, true);
    assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), authOriginal);
    assert.match(await readFile(join(home, 'config.toml'), 'utf8'), /\[projects\.b\]/);
    await writeFile(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}');
    await writeFile(join(home, 'config.toml'), 'chatgpt_base_url = "https://localhost:8002/backend-api"\nopenai_base_url = "https://localhost:8002/backend-api/codex"\nmodel = "gpt-6.1-sol"\n[projects.a]\ntrust = "trusted"\n');
    assert.equal(await leaveMainProfile(home, state), true);
    assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), authOriginal);
    const config = await readFile(join(home, 'config.toml'), 'utf8');
    assert.ok(!config.includes('localhost:8002') && config.startsWith('openai_base_url = "http://127.0.0.1:10100/v1"'));
    assert.ok(config.includes('[projects.a]') && config.includes('model = "gpt-6.1-sol"'));
    assert.equal(await leaveMainProfile(home, state), false, 'ikinci çağrı bir şey yapmaz');
    await assert.rejects(stat(join(state, 'main-profile-state.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
