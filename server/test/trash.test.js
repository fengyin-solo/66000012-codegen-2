const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Give every test run its own data directory and server port.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-trash-'));
process.env.WHITEBOARD_DATA_DIR = tmpDir;
process.env.PORT = String(3100 + Math.floor(Math.random() * 200));

const { Board } = require('../src/storage');
const { httpServer } = require('../src/index');

const base = `http://localhost:${process.env.PORT}/api/boards`;

const request = (method, urlPath, body) =>
  new Promise((resolve, reject) => {
    const url = new URL(base + urlPath);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const createBoard = async (overrides = {}) => {
  const res = await request('POST', '/', {
    name: '测试白板',
    ownerId: 'user-1',
    collaborators: ['user-2', 'user-3'],
    category: 'design',
    ...overrides,
  });
  assert.strictEqual(res.status, 201);
  return res.body;
};

test.after(() => {
  httpServer.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deleting an owned board moves it to trash and removes it from the active list', async () => {
  const board = await createBoard({ name: '待删除白板' });

  const del = await request('DELETE', `/${board._id}?userId=user-1`);
  assert.strictEqual(del.status, 200);
  assert.ok(del.body.board.deletedAt);

  const active = await request('GET', '/?userId=user-1');
  assert.ok(!active.body.find((b) => b._id === board._id), 'trashed board hidden from active list');

  const trash = await request('GET', '/trash?userId=user-1');
  const inTrash = trash.body.find((b) => b._id === board._id);
  assert.ok(inTrash, 'board appears in trash');
  assert.strictEqual(inTrash.name, '待删除白板');
});

test('only the owner can move a board to trash', async () => {
  const board = await createBoard({ name: '他人白板' });
  const del = await request('DELETE', `/${board._id}?userId=user-2`);
  assert.strictEqual(del.status, 403);

  // collaborator still sees the active board
  const shared = await request('GET', '/?userId=user-2');
  assert.ok(shared.body.find((b) => b._id === board._id));
});

test('trash filters by name, collaborator and creation time, and sorts by deletedAt', async () => {
  const owner = 'user-filters';
  const old = await createBoard({
    ownerId: owner,
    name: '架构脑暴',
    collaborators: ['user-4'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  const recent = await createBoard({
    ownerId: owner,
    name: '产品路线图',
    collaborators: ['user-2'],
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
  });

  // stagger deletedAt so ordering is deterministic
  const { _internal } = require('../src/storage');
  const boards = _internal.readBoards();
  const setDeleted = (id, when) => {
    const idx = boards.findIndex((b) => b._id === id);
    boards[idx] = { ...boards[idx], deletedAt: when };
  };
  setDeleted(old._id, '2025-01-10T00:00:00.000Z');
  setDeleted(recent._id, '2025-07-10T00:00:00.000Z');
  _internal.writeBoards(boards);

  const byName = await request('GET', `/trash?userId=${owner}&name=架构`);
  assert.strictEqual(byName.body.length, 1);
  assert.strictEqual(byName.body[0]._id, old._id);

  const byCollab = await request('GET', `/trash?userId=${owner}&collaborator=user-4`);
  assert.deepStrictEqual(byCollab.body.map((b) => b._id), [old._id]);

  const byDate = await request(
    'GET',
    `/trash?userId=${owner}&createdFrom=2025-01-01&createdTo=2025-12-31`
  );
  assert.deepStrictEqual(byDate.body.map((b) => b._id), [recent._id]);

  const desc = await request('GET', `/trash?userId=${owner}&sort=deletedAt&order=desc`);
  assert.strictEqual(desc.body[0]._id, recent._id);

  const asc = await request('GET', `/trash?userId=${owner}&sort=deletedAt&order=asc`);
  assert.strictEqual(asc.body[0]._id, old._id);

  const noMatch = await request('GET', `/trash?userId=${owner}&name=不存在的白板xyz`);
  assert.strictEqual(noMatch.body.length, 0);
});

test('restoring preserves category, collaborators and the original updatedAt', async () => {
  const board = await createBoard({
    name: '恢复我',
    collaborators: ['user-5'],
    category: 'research',
    updatedAt: '2024-05-01T08:30:00.000Z',
    createdAt: '2024-04-01T08:30:00.000Z',
  });
  await request('DELETE', `/${board._id}?userId=user-1`);

  const restored = await request('POST', `/${board._id}/restore`, { userId: 'user-1' });
  assert.strictEqual(restored.status, 200);
  const b = restored.body.board;
  assert.strictEqual(b.deletedAt, null);
  assert.strictEqual(b.category, 'research');
  assert.deepStrictEqual(b.collaborators, ['user-5']);
  assert.strictEqual(b.updatedAt, '2024-05-01T08:30:00.000Z');
  assert.strictEqual(b.createdAt, '2024-04-01T08:30:00.000Z');

  // back in active lists for owner and collaborator
  const ownerList = await request('GET', '/?userId=user-1');
  assert.ok(ownerList.body.find((x) => x._id === board._id));
  const collabList = await request('GET', '/?userId=user-5');
  assert.ok(collabList.body.find((x) => x._id === board._id));
  const trash = await request('GET', '/trash?userId=user-1');
  assert.ok(!trash.body.find((x) => x._id === board._id));
});

test('repeated restore and delete are idempotent and never duplicate records', async () => {
  const board = await createBoard({ name: '幂等白板' });

  await request('DELETE', `/${board._id}?userId=user-1`);
  const secondDelete = await request('DELETE', `/${board._id}?userId=user-1`);
  assert.strictEqual(secondDelete.status, 200);

  await request('POST', `/${board._id}/restore`, { userId: 'user-1' });
  const secondRestore = await request('POST', `/${board._id}/restore`, { userId: 'user-1' });
  assert.strictEqual(secondRestore.status, 200);
  assert.strictEqual(secondRestore.body.message, 'Board is already restored');

  // exactly one record with this id, active
  const { _internal } = require('../src/storage');
  const matches = _internal.readBoards().filter((b) => b._id === board._id);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].deletedAt, null);

  // deleting / restoring a missing record yields 404, not a new record
  const missingDel = await request('DELETE', '/does-not-exist?userId=user-1');
  assert.strictEqual(missingDel.status, 404);
  const missingRestore = await request('POST', '/does-not-exist/restore', { userId: 'user-1' });
  assert.strictEqual(missingRestore.status, 404);
});

test('permanent delete and empty trash remove only trashed boards of the owner', async () => {
  const owner = 'user-perm';
  const a = await createBoard({ name: '彻底删除A', ownerId: owner });
  const b = await createBoard({ name: '清空目标B', ownerId: owner });
  const active = await createBoard({ name: '仍在使用', ownerId: owner });
  await request('DELETE', `/${a._id}?userId=${owner}`);
  await request('DELETE', `/${b._id}?userId=${owner}`);

  const perm = await request('DELETE', `/${a._id}/permanent?userId=${owner}`);
  assert.strictEqual(perm.status, 200);

  const { _internal } = require('../src/storage');
  assert.ok(!_internal.readBoards().find((x) => x._id === a._id));

  const cleared = await request('POST', '/trash/clear', { userId: owner });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.body.deletedCount, 1); // only b remained in trash

  const remaining = _internal.readBoards();
  assert.ok(!remaining.find((x) => x._id === b._id));
  assert.ok(remaining.find((x) => x._id === active._id && !x.deletedAt));

  // other owners' trash is untouched
  const otherOwner = await createBoard({ name: '别人的回收站白板', ownerId: 'user-other' });
  await request('DELETE', `/${otherOwner._id}?userId=user-other`);
  await request('POST', '/trash/clear', { userId: owner });
  assert.ok(_internal.readBoards().find((x) => x._id === otherOwner._id && x.deletedAt));

  // clearing an already-empty trash is a harmless no-op
  const again = await request('POST', '/trash/clear', { userId: owner });
  assert.strictEqual(again.body.deletedCount, 0);
});

test('a failed permanent write preserves the original record', async () => {
  const board = await createBoard({ name: '写入失败白板' });
  await request('DELETE', `/${board._id}?userId=user-1`);

  // Simulate a storage write failure (disk error / permission issue).
  // Reads keep working, so handlers find the record but cannot persist changes.
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => {
    const err = new Error('simulated disk failure');
    err.code = 'EIO';
    throw err;
  };

  const perm = await request('DELETE', `/${board._id}/permanent?userId=user-1`);
  assert.strictEqual(perm.status, 500);
  assert.strictEqual(perm.body.retryable, true);

  const restore = await request('POST', `/${board._id}/restore`, { userId: 'user-1' });
  assert.strictEqual(restore.status, 500);

  const clear = await request('POST', '/trash/clear', { userId: 'user-1' });
  assert.strictEqual(clear.status, 500);

  // Failed writes never touched the file, so the board is still in the trash.
  const { _internal } = require('../src/storage');
  const duringFailure = _internal
    .readBoards()
    .find((b) => b._id === board._id);
  assert.ok(duringFailure, 'record still exists on disk');
  assert.ok(duringFailure.deletedAt, 'record is still trashed');

  // Recover and resubmit through the same entry point.
  fs.writeFileSync = realWriteFileSync;
  const retry = await request('POST', `/${board._id}/restore`, { userId: 'user-1' });
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(retry.body.board._id, board._id);
  assert.strictEqual(retry.body.board.deletedAt, null);

  // sanity: storage layer itself reports the restored record
  const stillThere = await Board.findById(board._id);
  assert.ok(stillThere);
});
