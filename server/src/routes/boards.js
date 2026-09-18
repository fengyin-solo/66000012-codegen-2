const express = require('express');
const router = express.Router();
const { Board } = require('../storage');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Get all active (non-deleted) boards for a user
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const boards = await Board.find({
      $or: [{ ownerId: userId }, { collaborators: userId }]
    }).deleted(false).sort({ updatedAt: -1 }).exec();
    console.log(`[Boards] Fetched ${boards.length} boards for user ${userId}`);
    res.json(boards);
  } catch (err) {
    console.error('[Boards] Error fetching boards:', err);
    res.status(500).json({ error: err.message });
  }
});

// List boards in the current user's recycle bin.
// Supports filtering by name (substring), collaborator (exact id) and
// creation-time range, plus sorting by deletedAt (desc/asc).
router.get('/trash/list', async (req, res) => {
  try {
    const { userId, name, collaborator, createdFrom, createdTo, sort } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const filters = {};
    if (name && name.trim()) {
      filters.nameRegex = new RegExp(escapeRegExp(name.trim()), 'i');
    }
    if (collaborator && collaborator.trim()) {
      filters.collaborator = collaborator.trim();
    }
    if (createdFrom) {
      const from = new Date(createdFrom);
      if (Number.isNaN(from.getTime())) {
        return res.status(400).json({ error: 'createdFrom is not a valid date' });
      }
      filters.createdFrom = from;
    }
    if (createdTo) {
      // Treat an end date as the inclusive end of that calendar day.
      const to = /^\d{4}-\d{2}-\d{2}$/.test(createdTo)
        ? new Date(`${createdTo}T23:59:59.999Z`)
        : new Date(createdTo);
      if (Number.isNaN(to.getTime())) {
        return res.status(400).json({ error: 'createdTo is not a valid date' });
      }
      filters.createdTo = to;
    }

    const sortSpec = sort === 'deletedAt-asc' ? { deletedAt: 1 } : { deletedAt: -1 };

    const boards = await Board.find({ ownerId: userId })
      .deleted(true)
      .matching(filters)
      .sort(sortSpec)
      .exec();
    console.log(`[Boards] Trash returned ${boards.length} boards for user ${userId}`);
    res.json(boards);
  } catch (err) {
    console.error('[Boards] Error fetching trash:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restore a board from the recycle bin.
router.post('/:id/restore', async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let result;
    try {
      result = await Board.restore(req.params.id, userId);
    } catch (writeErr) {
      // Storage write failed: the trashed record is still on disk.
      console.error('[Boards] Failed to restore board, record retained:', writeErr);
      return res.status(500).json({
        error: 'Failed to restore board, the record was retained. Please retry.',
        code: 'RESTORE_FAILED',
      });
    }

    if (result.status === 404) {
      return res.status(404).json({ error: 'Board not found', code: 'NOT_FOUND' });
    }
    if (result.status === 403) {
      return res.status(403).json({ error: 'Only the owner can restore this board', code: 'FORBIDDEN' });
    }
    // Repeated restore of an already active board: report the conflict and
    // return the existing board — no duplicate is ever created.
    if (result.status === 409) {
      return res
        .status(409)
        .json({ error: 'Board is not in the recycle bin', code: 'NOT_IN_TRASH', board: result.board });
    }

    console.log(`[Boards] Restored board: ${req.params.id}`);
    res.json(result.board);
  } catch (err) {
    console.error('[Boards] Error restoring board:', err);
    res.status(500).json({ error: err.message });
  }
});

// Permanently delete a board that sits in the recycle bin.
router.delete('/:id/purge', async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let result;
    try {
      result = await Board.purge(req.params.id, userId);
    } catch (writeErr) {
      // Storage write failed: the original record is still on disk.
      console.error('[Boards] Failed to purge board, record retained:', writeErr);
      return res.status(500).json({
        error: 'Failed to permanently delete board, the record was retained. Please retry.',
        code: 'PURGE_FAILED',
      });
    }

    if (result.status === 404) {
      return res.status(404).json({ error: 'Board not found', code: 'NOT_FOUND' });
    }
    if (result.status === 403) {
      return res.status(403).json({ error: 'Only the owner can permanently delete this board', code: 'FORBIDDEN' });
    }
    if (result.status === 409) {
      return res.status(409).json({ error: 'Board is not in the recycle bin', code: 'NOT_IN_TRASH' });
    }

    console.log(`[Boards] Purged board: ${req.params.id}`);
    res.json({ message: 'Board permanently deleted' });
  } catch (err) {
    console.error('[Boards] Error purging board:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single board
router.get('/:id', async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    if (board.deletedAt) {
      return res.status(410).json({ error: 'Board is in the recycle bin', code: 'IN_TRASH' });
    }
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new board
router.post('/', async (req, res) => {
  try {
    const { name, ownerId, width, height, backgroundColor, layers, collaborators } = req.body;

    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    const boardData = {
      name: name || 'Untitled Board',
      ownerId,
      collaborators: Array.isArray(collaborators) ? collaborators : [],
      width: width || 3000,
      height: height || 2000,
      backgroundColor: backgroundColor || '#ffffff',
    };

    if (layers && Array.isArray(layers)) {
      boardData.layers = layers.map((layer) => ({
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        order: layer.order,
        elements: layer.elements,
      }));
    } else {
      boardData.layers = [{ name: 'Layer 1', visible: true, locked: false, order: 0, elements: [] }];
    }

    const board = new Board(boardData);
    const savedBoard = await board.save();
    console.log(`[Boards] Created board: ${savedBoard._id}, name: ${savedBoard.name}, layers: ${savedBoard.layers.length}`);
    res.status(201).json(savedBoard);
  } catch (err) {
    console.error('[Boards] Error creating board:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update a board
router.put('/:id', async (req, res) => {
  try {
    const existing = await Board.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Board not found' });
    if (existing.deletedAt) {
      return res.status(410).json({ error: 'Board is in the recycle bin', code: 'IN_TRASH' });
    }
    const board = await Board.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!board) return res.status(404).json({ error: 'Board not found' });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a board into the recycle bin (soft delete).
// Idempotent: deleting a board that is already in the bin returns 200 with
// its existing deletedAt; deleting a non-existent id returns 404.
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let result;
    try {
      result = await Board.softDelete(req.params.id, userId);
    } catch (writeErr) {
      // Storage write failed: nothing was moved, the active record is retained.
      console.error('[Boards] Failed to soft-delete board, record retained:', writeErr);
      return res.status(500).json({
        error: 'Failed to move board to recycle bin, the record was retained. Please retry.',
        code: 'DELETE_FAILED',
      });
    }

    if (result.status === 404) {
      return res.status(404).json({ error: 'Board not found', code: 'NOT_FOUND' });
    }
    if (result.status === 403) {
      return res.status(403).json({ error: 'Only the owner can delete this board', code: 'FORBIDDEN' });
    }

    console.log(`[Boards] Moved board to recycle bin: ${req.params.id}`);
    res.json({ message: 'Board moved to recycle bin', board: result.board });
  } catch (err) {
    console.error('[Boards] Error deleting board:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
