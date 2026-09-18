const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.WHITEBOARD_DATA_DIR
  ? path.resolve(process.env.WHITEBOARD_DATA_DIR)
  : path.join(__dirname, '../data');
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
  try {
    fs.writeFileSync(BOARDS_FILE, JSON.stringify(boards, null, 2), 'utf8');
  } catch (error) {
    console.error('[Storage] Error writing boards file:', error);
    throw error;
  }
};

const matchCondition = (board, condition) => {
  // Nested $or / $and
  if (condition.$or) {
    return condition.$or.some((sub) => matchCondition(board, sub));
  }
  if (condition.$and) {
    return condition.$and.every((sub) => matchCondition(board, sub));
  }
  return Object.entries(condition).every(([key, value]) => {
    const boardValue = board[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.$in !== undefined) {
        return Array.isArray(boardValue) && value.$in.some((v) => boardValue.includes(v));
      }
      if (value.$regex) {
        const flags = value.$options || '';
        return typeof boardValue === 'string' && new RegExp(value.$regex, flags).test(boardValue);
      }
      if (value.$gte !== undefined) {
        return new Date(boardValue).getTime() >= new Date(value.$gte).getTime();
      }
      if (value.$lte !== undefined) {
        return new Date(boardValue).getTime() <= new Date(value.$lte).getTime();
      }
    }
    if (Array.isArray(boardValue)) {
      // e.g. query { collaborators: 'user-2' } matches a board whose
      // collaborators array contains 'user-2'
      return boardValue.includes(value);
    }
    if (Array.isArray(value)) {
      return value.includes(boardValue);
    }
    return boardValue === value;
  });
};

const sortByField = (list, sort = {}) => {
  const [field, dirRaw] = Object.entries(sort)[0] || ['updatedAt', -1];
  const dir = dirRaw === 1 || dirRaw === 'asc' ? 1 : -1;
  return [...list].sort(
    (a, b) => (new Date(a[field]).getTime() - new Date(b[field]).getTime()) * dir
  );
};

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
    this.category = data.category || 'general';
    this.deletedAt = data.deletedAt || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
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
      category: this.category,
      deletedAt: this.deletedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  async save() {
    // Honor explicitly provided timestamps (e.g. boards created from imported
    // data / templates); otherwise stamp with the current time.
    this.updatedAt = this.updatedAt || new Date().toISOString();
    this.createdAt = this.createdAt || new Date().toISOString();
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

  // Active (non-trashed) boards only. Pass { includeDeleted: true } to see all.
  static find(query = {}, options = {}) {
    const boards = readBoards();
    let result = boards.filter((b) => options.includeDeleted || !b.deletedAt);

    if (Object.keys(query).length > 0) {
      const rootCondition = query.$or
        ? { $or: query.$or }
        : query.$and
        ? { $and: query.$and }
        : query;
      result = result.filter((board) => matchCondition(board, rootCondition));
    }

    result = sortByField(result, options.sort);

    return {
      sort: (sort) => {
        result = sortByField(result, sort);
        return {
          exec: async () => result,
          then: (resolve) => Promise.resolve(result).then(resolve),
        };
      },
      exec: async () => result,
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
  }

  // Boards in a user's recycle bin, with name / collaborator / creation-time filters
  // and deletion-time ordering.
  static async findTrash({
    ownerId,
    name,
    collaborator,
    createdFrom,
    createdTo,
    sort = { deletedAt: -1 },
  } = {}) {
    const boards = readBoards().filter((b) => b.deletedAt && b.ownerId === ownerId);

    let result = boards;
    if (name) {
      const keyword = name.trim().toLowerCase();
      result = result.filter((b) => b.name.toLowerCase().includes(keyword));
    }
    if (collaborator) {
      result = result.filter(
        (b) => Array.isArray(b.collaborators) && b.collaborators.includes(collaborator)
      );
    }
    if (createdFrom) {
      const from = new Date(createdFrom).getTime();
      result = result.filter((b) => new Date(b.createdAt).getTime() >= from);
    }
    if (createdTo) {
      // Make an inclusive end-of-day style bound when only a date is provided
      const raw = String(createdTo);
      const to = new Date(raw.length === 10 ? `${raw}T23:59:59.999Z` : createdTo).getTime();
      result = result.filter((b) => new Date(b.createdAt).getTime() <= to);
    }

    return sortByField(result, sort);
  }

  static async findById(id, options = {}) {
    const boards = readBoards();
    const board = boards.find((b) => b._id === id);
    if (!board) return null;
    if (!options.includeDeleted && board.deletedAt) return null;
    return board;
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

  // Soft delete: move the owner's board into the recycle bin.
  // Returns:
  //   { status: 'trashed', board }      - newly moved to trash
  //   { status: 'already-trashed', board } - idempotent repeat call
  //   null                               - board does not exist
  //   { status: 'forbidden' }            - caller is not the owner
  // On write failure the on-disk record is left untouched and the error is rethrown.
  static async softDelete(id, ownerId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);
    if (index < 0) return null;

    const board = boards[index];
    if (board.ownerId !== ownerId) return { status: 'forbidden' };
    if (board.deletedAt) return { status: 'already-trashed', board };

    const updated = { ...board, deletedAt: new Date().toISOString() };
    boards[index] = updated;
    writeBoards(boards); // throws -> original file content preserved
    console.log(`[Storage] Moved board to trash: ${id}`);
    return { status: 'trashed', board: updated };
  }

  // Restore a board from the recycle bin. Original category, collaborators and
  // updatedAt are preserved verbatim. Returns:
  //   { status: 'restored', board }
  //   { status: 'not-trashed', board } - idempotent repeat restore, no duplicate
  //   null                              - record missing
  //   { status: 'forbidden' }
  static async restore(id, ownerId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);
    if (index < 0) return null;

    const board = boards[index];
    if (board.ownerId !== ownerId) return { status: 'forbidden' };
    if (!board.deletedAt) return { status: 'not-trashed', board };

    const restored = { ...board, deletedAt: null };
    boards[index] = restored;
    writeBoards(boards); // throws -> record remains in trash and can be retried
    console.log(`[Storage] Restored board from trash: ${id}`);
    return { status: 'restored', board: restored };
  }

  // Permanently remove a single trashed board owned by ownerId.
  // Mirrors softDelete/restore return conventions; a failed write keeps the record.
  static async permanentDelete(id, ownerId) {
    const boards = readBoards();
    const index = boards.findIndex((b) => b._id === id);
    if (index < 0) return null;

    const board = boards[index];
    if (board.ownerId !== ownerId) return { status: 'forbidden' };
    if (!board.deletedAt) return { status: 'not-trashed', board };

    const remaining = boards.filter((b) => b._id !== id);
    writeBoards(remaining); // throws -> file untouched, record preserved
    console.log(`[Storage] Permanently deleted board: ${id}`);
    return { status: 'deleted', board };
  }

  // Permanently remove every trashed board owned by ownerId.
  // The write is one atomic replacement, so a failure leaves all records in place
  // and the caller can resubmit.
  static async emptyTrash(ownerId) {
    const boards = readBoards();
    const trashed = boards.filter((b) => b.deletedAt && b.ownerId === ownerId);
    if (trashed.length === 0) return { deletedCount: 0, boards: [] };

    const remaining = boards.filter((b) => !(b.deletedAt && b.ownerId === ownerId));
    writeBoards(remaining); // throws -> nothing is removed
    console.log(`[Storage] Emptied trash for ${ownerId}: ${trashed.length} board(s)`);
    return { deletedCount: trashed.length, boards: trashed };
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
  // exported for tests
  _internal: { readBoards, writeBoards, BOARDS_FILE, matchCondition, sortByField },
};
