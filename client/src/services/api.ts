import { Board, Template } from '../types';

const API_BASE_URL = '/api/boards';
const TEMPLATE_API_URL = '/api/templates';

export const boardApi = {
  async getBoards(userId: string): Promise<Board[]> {
    const response = await fetch(`${API_BASE_URL}?userId=${userId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch boards');
    }
    return response.json();
  },

  async getBoard(boardId: string): Promise<Board | null> {
    const response = await fetch(`${API_BASE_URL}/${boardId}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch board');
    }
    return response.json();
  },

  async createBoard(data: { name: string; ownerId: string; width?: number; height?: number }): Promise<Board | null> {
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create board');
    }
    return response.json();
  },

  /** Move one of the user's own boards into the recycle bin (soft delete) */
  async deleteBoard(boardId: string, userId: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/${boardId}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    return response.ok;
  },

  /** Fetch boards in the user's recycle bin, filtered and sorted server-side */
  async getTrash(
    userId: string,
    filters: {
      name?: string;
      collaborator?: string;
      createdFrom?: string;
      createdTo?: string;
      sort?: 'deletedAt' | 'name' | 'createdAt';
      order?: 'asc' | 'desc';
    } = {}
  ): Promise<Board[]> {
    const params = new URLSearchParams({ userId });
    if (filters.name) params.set('name', filters.name);
    if (filters.collaborator) params.set('collaborator', filters.collaborator);
    if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) params.set('createdTo', filters.createdTo);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.order) params.set('order', filters.order);

    const response = await fetch(`${API_BASE_URL}/trash?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch trash');
    }
    return response.json();
  },

  /** Restore a board from the recycle bin; returns the restored board */
  async restoreBoard(boardId: string, userId: string): Promise<Board | null> {
    const response = await fetch(`${API_BASE_URL}/${boardId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to restore board');
    }
    const data = await response.json();
    return data.board ?? null;
  },

  /** Permanently remove a single board from the recycle bin */
  async permanentlyDeleteBoard(boardId: string, userId: string): Promise<boolean> {
    const response = await fetch(
      `${API_BASE_URL}/${boardId}/permanent?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    return response.ok;
  },

  /** Permanently clear every board in the user's recycle bin */
  async emptyTrash(userId: string): Promise<number> {
    const response = await fetch(`${API_BASE_URL}/trash/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to clear trash');
    }
    const data = await response.json();
    return data.deletedCount ?? 0;
  },

  getMockBoards(): Board[] {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString();
    const lastWeek = new Date(Date.now() - 86400000 * 7).toISOString();

    return [
      {
        _id: 'board-1',
        name: '产品需求评审',
        ownerId: 'user-1',
        collaborators: ['user-2', 'user-3'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#f5f5f5',
        createdAt: lastWeek,
        updatedAt: now,
      },
      {
        _id: 'board-2',
        name: '架构设计讨论',
        ownerId: 'user-1',
        collaborators: ['user-4'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#ffffff',
        createdAt: lastWeek,
        updatedAt: yesterday,
      },
      {
        _id: 'board-3',
        name: '用户旅程地图',
        ownerId: 'user-2',
        collaborators: ['user-1', 'user-5'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#f0f8ff',
        createdAt: lastWeek,
        updatedAt: twoDaysAgo,
      },
      {
        _id: 'board-4',
        name: '团队脑暴会',
        ownerId: 'user-3',
        collaborators: ['user-1'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#fff8e1',
        createdAt: lastWeek,
        updatedAt: lastWeek,
      },
    ];
  },

  createMockBoard(data: { name: string; ownerId: string }): Board {
    const now = new Date().toISOString();
    return {
      _id: `board-${Date.now()}`,
      name: data.name,
      ownerId: data.ownerId,
      collaborators: [],
      layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
      width: 3000,
      height: 2000,
      backgroundColor: '#ffffff',
      createdAt: now,
      updatedAt: now,
    };
  },
};

export const templateApi = {
  async getTemplates(): Promise<Template[]> {
    const response = await fetch(TEMPLATE_API_URL);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch templates');
    }
    return response.json();
  },

  async getTemplate(templateId: string): Promise<Template | null> {
    const response = await fetch(`${TEMPLATE_API_URL}/${templateId}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch template');
    }
    return response.json();
  },

  async createBoardFromTemplate(
    templateId: string,
    data: { name: string; ownerId: string }
  ): Promise<Board | null> {
    const response = await fetch(`${TEMPLATE_API_URL}/${templateId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create board from template');
    }
    return response.json();
  },
};
