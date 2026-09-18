const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readBoards = () => {
  ensureDataDir();
  if (!fs.existsSync(BOARDS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(BOARDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Storage] Error reading boards file:', error);
    return [];
  }
};

const writeBoards = (boards) => {
  ensureDataDir();
  // Atomic write: serialize to a temp file first, then rename it over the
  // real file. If anything fails mid-write the original boards.json stays
  // intact, so a failed delete/purge never corrupts or loses existing records.
  const tmpFile = `${BOARDS_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(boards, null, 2), 'utf8');
    fs.renameSync(tmpFile, BOARDS_FILE);
  } catch (error) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (cleanupError) {
      console.error('[Storage] Error cleaning up temp file:', cleanupError);
    }
    console.error('[Storage] Error writing boards file:', error);
    throw error;
  }
};

const isDeleted = (board) => Boolean(board && board.deletedAt);

// Evaluate a single MongoDB-style condition: plain equality plus $ne / $exists and nested $or.
const matchesCondition = (board, condition) => {
  if (condition.$or) {
    return condition.$or.some((sub) => matchesCondition(board, sub));
  }
  return Object.entries(condition).every(([key, expected]) => {
    const actual = board[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if (Object.prototype.hasOwnProperty.call(expected, '$ne')) {
        return actual !== expected.$ne;
      }
      if (Object.prototype.hasOwnProperty.call(expected, '$exists')) {
        return expected.$exists ? actual !== undefined && actual !== null : actual === undefined || actual === null;
      }
    }
    // Mongoose array-contains semantics: an array field matches a scalar
    // query when the array includes that value.
    if (Array.isArray(actual)) {
      return actual.includes(expected);
    }
    return actual === expected;
  });
};

// Chainable query: Board.find(query).deleted(true|false).matching({...}).sort({ field: -1 }).exec()
class BoardQuery {
  constructor(query = {}) {
    this.query = query;
    this.deletedFlag = null; // null = any, true = only deleted, false = only active
    this.filters = {};
    this.sortSpec = { updatedAt: -1 };
  }

  deleted(flag) {
    this.deletedFlag = flag;
    return this;
  }

  matching(filters) {
    this.filters = { ...this.filters, ...filters };
    return this;
  }

  sort(spec) {
    if (spec) this.sortSpec = spec;
    return this;
  }

  async exec() {
    let result = readBoards().filter((board) => matchesCondition(board, this.query));

    if (this.deletedFlag === true) {
      result = result.filter(isDeleted);
    } else if (this.deletedFlag === false) {
      result = result.filter((board) => !isDeleted(board));
    }

    const { nameRegex, collaborator, createdFrom, createdTo } = this.filters;
    if (nameRegex) {
      result = result.filter((board) => typeof board.name === 'string' && nameRegex.test(board.name));
    }
    if (collaborator) {
      result = result.filter(
        (board) => Array.isArray(board.collaborators) && board.collaborators.includes(collaborator)
      );
    }
    if (createdFrom instanceof Date) {
      result = result.filter((board) => new Date(board.createdAt).getTime() >= createdFrom.getTime());
    }
    if (createdTo instanceof Date) {
      result = result.filter((board) => new Date(board.createdAt).getTime() <= createdTo.getTime());
    }

    const sortEntries = Object.entries(this.sortSpec);
    result.sort((a, b) => {
      for (const [key, direction] of sortEntries) {
        const av = a[key];
        const bv = b[key];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = new Date(av).getTime() - new Date(bv).getTime();
        return cmp * direction;
      }
      return 0;
    });

    return result;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }
}

class LocalBoard {
  constructor(data) {
    this._id = data._id || uuidv4();
    this.name = data.name || 'Untitled Board';
    this.ownerId = data.ownerId;
    this.collaborators = data.collaborators || [];
    this.layers = data.layers || [{ name: 'Layer 1', visible: true, locked: false, order: 0, elements: [] }];
    this.width = data.width || 3000;
    this.height = data.height || 2000;
    this.backgroundColor = data.backgroundColor || '#ffffff';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.deletedAt = data.deletedAt || null;
  }

  toObject() {
    return {
      _id: this._id,
      name: this.name,
      ownerId: this.ownerId,
      collaborators: this.collaborators,
      layers: this.layers,
      width: this.width,
      height: this.height,
      backgroundColor: this.backgroundColor,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt,
    };
  }

  async save() {
    this.updatedAt = new Date().toISOString();
    const boards = readBoards();
    const existingIndex = boards.findIndex((b) => b._id === this._id);

    if (existingIndex >= 0) {
      boards[existingIndex] = this.toObject();
    } else {
      boards.unshift(this.toObject());
    }

    writeBoards(boards);
    console.log(`[Storage] Saved board: ${this._id}, name: ${this.name}`);
    return this.toObject();
  }

  static find(query = {}) {
    return new BoardQuery(query);
  }

  static async findById(id) {
    const boards = readBoards();
    const board = boards.find((b) => b._id === id);
    return board || null;
  }

  static async findByIdAndUpdate(id, updates, options = {}) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);

    if (index < 0) {
      return null;
    }

    boards[index] = {
      ...boards[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    writeBoards(boards);
    console.log(`[Storage] Updated board: ${id}`);
    return options.new ? boards[index] : null;
  }

  static async findByIdAndDelete(id) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);

    if (index < 0) {
      return null;
    }

    const deleted = boards[index];
    boards.splice(index, 1);
    writeBoards(boards);
    console.log(`[Storage] Deleted board: ${id}`);
    return deleted;
  }

  // Move a board into the recycle bin. Idempotent: deleting an already
  // soft-deleted board keeps its original deletedAt and does not duplicate.
  // Returns { status, board? } where status is 404 / 403 / 200.
  static async softDelete(id, userId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);

    if (index < 0) {
      return { status: 404 };
    }

    const board = boards[index];
    if (board.ownerId !== userId) {
      return { status: 403, board };
    }

    if (!isDeleted(board)) {
      boards[index] = { ...board, deletedAt: new Date().toISOString() };
      writeBoards(boards);
      console.log(`[Storage] Soft-deleted board: ${id}`);
    }

    return { status: 200, board: boards[index] };
  }

  // Restore a board out of the recycle bin. ownerId / collaborators /
  // updatedAt are intentionally left untouched so the board returns to its
  // original category and "recently updated" position.
  // Returns { status, code?, board? }: 404 / 403 / 409 (not in trash) / 200.
  static async restore(id, userId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);

    if (index < 0) {
      return { status: 404, code: 'NOT_FOUND' };
    }

    const board = boards[index];
    if (board.ownerId !== userId) {
      return { status: 403, code: 'FORBIDDEN', board };
    }

    if (!isDeleted(board)) {
      return { status: 409, code: 'NOT_IN_TRASH', board };
    }

    boards[index] = { ...board, deletedAt: null };
    writeBoards(boards);
    console.log(`[Storage] Restored board: ${id}`);
    return { status: 200, board: boards[index] };
  }

  // Permanently remove a board that is in the recycle bin. Throws if the file
  // write fails; the on-disk record is only removed when the write succeeds,
  // so a failed purge always leaves the original record in place.
  // Returns { status, code?, board? }: 404 / 403 / 409 (not in trash) / 200.
  static async purge(id, userId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);

    if (index < 0) {
      return { status: 404, code: 'NOT_FOUND' };
    }

    const board = boards[index];
    if (board.ownerId !== userId) {
      return { status: 403, code: 'FORBIDDEN', board };
    }

    if (!isDeleted(board)) {
      return { status: 409, code: 'NOT_IN_TRASH', board };
    }

    boards.splice(index, 1);
    writeBoards(boards);
    console.log(`[Storage] Purged board: ${id}`);
    return { status: 200, board };
  }
}

const initStorage = () => {
  ensureDataDir();
  console.log(`[Storage] Initialized with data directory: ${DATA_DIR}`);
  const count = readBoards().length;
  console.log(`[Storage] Loaded ${count} boards from local storage`);
};

module.exports = {
  Board: LocalBoard,
  initStorage,
};
