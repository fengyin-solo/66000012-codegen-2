import { Board, Template, TrashFilters, TrashSort } from '../types';

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

  async deleteBoard(boardId: string, userId: string): Promise<{ ok: boolean; status: number; board?: Board }> {
    const response = await fetch(`${API_BASE_URL}/${boardId}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Failed to delete board') as Error & {
        status: number;
        code?: string;
      };
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return { ok: true, status: response.status, board: data.board };
  },

  async getTrashBoards(
    userId: string,
    filters: TrashFilters = {},
    sort: TrashSort = 'deletedAt-desc'
  ): Promise<Board[]> {
    const params = new URLSearchParams({ userId, sort });
    if (filters.name?.trim()) params.set('name', filters.name.trim());
    if (filters.collaborator?.trim()) params.set('collaborator', filters.collaborator.trim());
    if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) params.set('createdTo', filters.createdTo);

    const response = await fetch(`${API_BASE_URL}/trash/list?${params.toString()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch recycle bin');
    }
    return response.json();
  },

  async restoreBoard(boardId: string, userId: string): Promise<Board | null> {
    const response = await fetch(`${API_BASE_URL}/${boardId}/restore?userId=${encodeURIComponent(userId)}`, {
      method: 'POST',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Failed to restore board') as Error & {
        status: number;
        code?: string;
        board?: Board;
      };
      error.status = response.status;
      error.code = data.code;
      error.board = data.board;
      throw error;
    }
    return data;
  },

  async purgeBoard(boardId: string, userId: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/${boardId}/purge?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || 'Failed to permanently delete board') as Error & {
        status: number;
        code?: string;
      };
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return true;
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

const mockTemplates: Template[] = [
  {
    _id: 'template-meeting',
    name: '会议纪要',
    description: '快速记录会议要点、待办事项和决议',
    category: 'meeting',
    thumbnail: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    icon: '📝',
    width: 3000,
    height: 2000,
    backgroundColor: '#f8f9fa',
  },
  {
    _id: 'template-workflow',
    name: '流程梳理',
    description: '可视化梳理业务流程、工作流和决策路径',
    category: 'workflow',
    thumbnail: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    icon: '🔄',
    width: 3500,
    height: 2200,
    backgroundColor: '#f0f9ff',
  },
  {
    _id: 'template-weekly',
    name: '周计划',
    description: '规划一周工作，跟踪每日任务和重要事项',
    category: 'productivity',
    thumbnail: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    icon: '📅',
    width: 3200,
    height: 2000,
    backgroundColor: '#f0fdf4',
  },
];

const createMockBoardFromTemplate = (
  template: Template,
  data: { name: string; ownerId: string }
): Board => {
  const now = new Date().toISOString();
  return {
    _id: `board-${Date.now()}`,
    name: data.name || template.name,
    ownerId: data.ownerId,
    collaborators: [],
    layers: template.layers || [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
    width: template.width,
    height: template.height,
    backgroundColor: template.backgroundColor,
    createdAt: now,
    updatedAt: now,
  };
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
