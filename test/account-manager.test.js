const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach } = require('node:test');
const AccountManager = require('../src/account-manager');

function makeTmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-test-'));
  return {
    file: path.join(dir, 'accounts.json'),
    auth: path.join(dir, '.wwebjs_auth'),
    dir,
  };
}

describe('AccountManager', () => {
  let paths;

  beforeEach(() => {
    paths = makeTmpPaths();
  });

  it('adds an account and makes it active by default', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const account = mgr.add('Sales');
    assert.strictEqual(mgr.getActive().id, account.id);
    assert.strictEqual(mgr.getActive().label, 'Sales');
  });

  it('seeds with a fixed id when provided', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    mgr.add('Legacy', 'whatsapp-bulk-campaign-tool');
    assert.strictEqual(mgr.get('whatsapp-bulk-campaign-tool').label, 'Legacy');
  });

  it('persists accounts and active id across instances', () => {
    const mgr1 = new AccountManager(paths.file, paths.auth);
    const a = mgr1.add('One');
    const b = mgr1.add('Two');
    mgr1.setActive(b.id);

    const mgr2 = new AccountManager(paths.file, paths.auth);
    assert.strictEqual(mgr2.getActive().id, b.id);
    assert.ok(mgr2.get(a.id));
    assert.strictEqual(mgr2.list().accounts.length, 2);
  });

  it('tracks sent/failed stats per account', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const a = mgr.add('One');
    const b = mgr.add('Two');
    mgr.recordSent(a.id);
    mgr.recordSent(a.id);
    mgr.recordFailed(b.id);
    assert.strictEqual(mgr.get(a.id).stats.sent, 2);
    assert.strictEqual(mgr.get(a.id).stats.failed, 0);
    assert.strictEqual(mgr.get(b.id).stats.sent, 0);
    assert.strictEqual(mgr.get(b.id).stats.failed, 1);
  });

  it('removes an account, its session dir, and reassigns active', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const a = mgr.add('One');
    const b = mgr.add('Two');

    const sessionDir = mgr.getSessionDir(a.id);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'x'), 'data');
    assert.ok(mgr.hasSession(a.id));

    mgr.setActive(b.id);
    assert.ok(mgr.remove(a.id));
    assert.strictEqual(mgr.get(a.id), null);
    assert.ok(!fs.existsSync(sessionDir));
    assert.strictEqual(mgr.getActive().id, b.id);
  });

  it('removing the active account promotes the first remaining', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const a = mgr.add('One');
    mgr.add('Two');
    assert.ok(mgr.remove(a.id));
    assert.strictEqual(mgr.getActive().label, 'Two');
  });

  it('refuses to switch to a missing account', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    mgr.add('One');
    const result = mgr.setActive('nope');
    assert.strictEqual(result.success, false);
  });

  it('falls back to first account when active id is stale', () => {
    fs.writeFileSync(
      paths.file,
      JSON.stringify({
        accounts: [{ id: 'x', label: 'X', createdAt: 'now', stats: { sent: 0, failed: 0 } }],
        activeId: 'ghost',
      }),
    );
    const mgr = new AccountManager(paths.file, paths.auth);
    assert.strictEqual(mgr.getActive().id, 'x');
  });

  it('lists only linked accounts in registration order', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const a = mgr.add('One');
    const b = mgr.add('Two');
    const c = mgr.add('Three');

    fs.mkdirSync(mgr.getSessionDir(a.id), { recursive: true });
    fs.mkdirSync(mgr.getSessionDir(c.id), { recursive: true });

    const linked = mgr.listLinked();
    assert.deepStrictEqual(linked.map((x) => x.id), [a.id, c.id]);
    assert.ok(!linked.some((x) => x.id === b.id));
  });

  it('stores, persists, and clears a per-account proxy', () => {
    const mgr = new AccountManager(paths.file, paths.auth);
    const a = mgr.add('One');
    mgr.add('Two');

    const result = mgr.setProxy(a.id, '1.2.3.4:8080');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.proxy, 'http://1.2.3.4:8080');
    assert.strictEqual(mgr.get(a.id).proxy, 'http://1.2.3.4:8080');
    assert.strictEqual(mgr.list().accounts[1].proxy, null);

    const mgr2 = new AccountManager(paths.file, paths.auth);
    assert.strictEqual(mgr2.get(a.id).proxy, 'http://1.2.3.4:8080');

    assert.strictEqual(mgr.setProxy(a.id, '').success, true);
    assert.strictEqual(mgr.get(a.id).proxy, null);

    assert.strictEqual(mgr.setProxy(a.id, 'not a proxy').success, false);
    assert.strictEqual(mgr.setProxy('ghost', '1.2.3.4:8080').success, false);
  });
});
