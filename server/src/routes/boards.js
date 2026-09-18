const express = require('express');
const router = express.Router();
const { Board } = require('../storage');

// Get all active boards for a user (trashed boards are excluded)
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const boards = await Board.find({
      $or: [{ ownerId: userId }, { collaborators: userId }]
    }).sort({ updatedAt: -1 });
    console.log(`[Boards] Fetched ${boards.length} boards for user ${userId}`);
    res.json(boards);
  } catch (err) {
    console.error('[Boards] Error fetching boards:', err);
    res.status(500).json({ error: err.message });
  }
});

// List boards in the current user's recycle bin.
// Filters: name, collaborator, createdFrom, createdTo
// Sorting: sort=deletedAt (default) | name | createdAt, order=desc (default) | asc
router.get('/trash', async (req, res) => {
  try {
    const { userId, name, collaborator, createdFrom, createdTo, sort, order } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const allowedSortFields = ['deletedAt', 'name', 'createdAt'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'deletedAt';
    const sortDir = order === 'asc' ? 1 : -1;

    const boards = await Board.findTrash({
      ownerId: userId,
      name,
      collaborator,
      createdFrom,
      createdTo,
      sort: { [sortField]: sortDir },
    });

    console.log(`[Boards] Trash query for ${userId} returned ${boards.length} board(s)`);
    res.json(boards);
  } catch (err) {
    console.error('[Boards] Error fetching trash:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single board
router.get('/:id', async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new board
router.post('/', async (req, res) => {
  try {
    const { name, ownerId, width, height, backgroundColor, layers, category, collaborators, createdAt, updatedAt } = req.body;

    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    const boardData = {
      name: name || 'Untitled Board',
      ownerId,
      collaborators: Array.isArray(collaborators) ? collaborators : [],
      category: category || 'general',
      width: width || 3000,
      height: height || 2000,
      backgroundColor: backgroundColor || '#ffffff',
    };
    if (createdAt) boardData.createdAt = createdAt;
    if (updatedAt) boardData.updatedAt = updatedAt;

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
    const board = await Board.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!board) return res.status(404).json({ error: 'Board not found' });
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a board -> moves it into the owner's recycle bin (soft delete).
// Only the owner can trash a board. Repeat calls are idempotent.
router.delete('/:id', async (req, res) => {
  try {
    const ownerId = req.query.userId || (req.body && req.body.userId);
    if (!ownerId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await Board.softDelete(req.params.id, ownerId);
    if (result === null) {
      return res.status(404).json({ error: 'Board not found' });
    }
    if (result.status === 'forbidden') {
      return res.status(403).json({ error: 'Only the board owner can delete this board' });
    }
    if (result.status === 'already-trashed') {
      // Idempotent: do not create any duplicate record
      return res.json({ message: 'Board is already in trash', board: result.board });
    }
    res.json({ message: 'Board moved to trash', board: result.board });
  } catch (err) {
    console.error('[Boards] Error moving board to trash:', err);
    // The original record is preserved; client may resubmit
    res.status(500).json({ error: err.message, retryable: true });
  }
});

// Restore a board from the recycle bin. Category, collaborators and updatedAt
// are restored to their original values. Repeat restores are idempotent.
router.post('/:id/restore', async (req, res) => {
  try {
    const ownerId = (req.body && req.body.userId) || req.query.userId;
    if (!ownerId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await Board.restore(req.params.id, ownerId);
    if (result === null) {
      return res.status(404).json({ error: 'Board not found' });
    }
    if (result.status === 'forbidden') {
      return res.status(403).json({ error: 'Only the board owner can restore this board' });
    }
    if (result.status === 'not-trashed') {
      // Idempotent: the board is already active, never duplicated
      return res.json({ message: 'Board is already restored', board: result.board });
    }
    res.json({ message: 'Board restored', board: result.board });
  } catch (err) {
    console.error('[Boards] Error restoring board:', err);
    // The board stays in the trash; client may resubmit
    res.status(500).json({ error: err.message, retryable: true });
  }
});

// Permanently delete a single board from the recycle bin
router.delete('/:id/permanent', async (req, res) => {
  try {
    const ownerId = req.query.userId || (req.body && req.body.userId);
    if (!ownerId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await Board.permanentDelete(req.params.id, ownerId);
    if (result === null) {
      return res.status(404).json({ error: 'Board not found' });
    }
    if (result.status === 'forbidden') {
      return res.status(403).json({ error: 'Only the board owner can delete this board' });
    }
    if (result.status === 'not-trashed') {
      return res.status(400).json({ error: 'Board is not in trash' });
    }
    res.json({ message: 'Board permanently deleted' });
  } catch (err) {
    console.error('[Boards] Error permanently deleting board:', err);
    // Record preserved on failure; client may resubmit
    res.status(500).json({ error: err.message, retryable: true });
  }
});

// Permanently clear every board in the user's recycle bin
router.post('/trash/clear', async (req, res) => {
  try {
    const ownerId = (req.body && req.body.userId) || req.query.userId;
    if (!ownerId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await Board.emptyTrash(ownerId);
    res.json({ message: 'Trash cleared', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[Boards] Error clearing trash:', err);
    // All records preserved; client may resubmit
    res.status(500).json({ error: err.message, retryable: true });
  }
});

module.exports = router;
