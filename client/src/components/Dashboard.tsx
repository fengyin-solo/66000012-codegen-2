import React, { useState, useEffect } from 'react';
import { Board } from '../types';
import { boardApi, templateApi } from '../services/api';
import { useWhiteboardStore } from '../store/whiteboard';
import { TemplateCenter } from './TemplateCenter';
import { TrashView } from './TrashView';

interface DashboardProps {
  onBoardSelect: (board: Board) => void;
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
};

const getRandomGradient = (index: number): string => {
  const gradients = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  ];
  return gradients[index % gradients.length];
};

const BoardCard: React.FC<{
  board: Board;
  index: number;
  onClick: () => void;
  onTrash?: () => void;
}> = ({ board, index, onClick, onTrash }) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      onClick={onClick}
      className="board-card-wrap"
      style={{
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'transform 0.2s, box-shadow 0.2s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
        setConfirming(false);
      }}
    >
      {onTrash && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            gap: '6px',
            zIndex: 2,
          }}
        >
          {confirming ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTrash();
                  setConfirming(false);
                }}
                onMouseLeave={() => setConfirming(false)}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: '#fff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                确认删除
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: '#374151',
                  background: 'rgba(255,255,255,0.95)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </>
          ) : (
            <button
              title="移到回收站"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              style={{
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                background: 'rgba(0, 0, 0, 0.35)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'opacity 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#dc2626';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.35)';
              }}
              // Hidden until the card is hovered (.board-card-wrap:hover)
              className="board-trash-btn"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div
        style={{
          height: '120px',
          background: board.backgroundColor || getRandomGradient(index),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#fff',
            fontSize: '24px',
            fontWeight: 600,
            textShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
          }}
        >
          {board.name.charAt(0).toUpperCase()}
        </span>
      </div>
      <div style={{ padding: '16px' }}>
        <h3
          style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: 600,
            color: '#1a1a1a',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {board.name}
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '12px',
            color: '#6b7280',
          }}
        >
          <span>{formatDate(board.updatedAt)}</span>
          {board.collaborators.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{board.collaborators.length + 1}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ onBoardSelect }) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTemplateCenterOpen, setIsTemplateCenterOpen] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const username = useWhiteboardStore((state) => state.username);

  const userId = 'user-1';

  useEffect(() => {
    loadBoards();
  }, []);

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  const loadBoards = async () => {
    try {
      setLoading(true);
      const data = await boardApi.getBoards(userId);
      setBoards(data);
    } catch (error) {
      console.error('Failed to load boards:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBoard = async (name: string, templateId?: string) => {
    try {
      let newBoard: Board | null = null;
      if (templateId) {
        newBoard = await templateApi.createBoardFromTemplate(templateId, { name, ownerId: userId });
      } else {
        newBoard = await boardApi.createBoard({ name, ownerId: userId });
      }
      if (newBoard) {
        await loadBoards();
        onBoardSelect(newBoard);
      } else {
        throw new Error('Failed to create board');
      }
    } catch (error) {
      console.error('Failed to create board:', error);
      alert('创建白板失败，请重试');
    }
  };

  // Soft delete: the owner's board moves to the recycle bin. Repeated clicks
  // are idempotent on the server, so no duplicate record can appear.
  const handleMoveToTrash = async (board: Board) => {
    try {
      setTrashError(null);
      const ok = await boardApi.deleteBoard(board._id, userId);
      if (!ok) throw new Error('delete failed');
      setBoards((list) => list.filter((b) => b._id !== board._id));
      setNotice(`已将「${board.name}」移入回收站，可在回收站中恢复`);
    } catch (error) {
      console.error('Failed to move board to trash:', error);
      // The original board remains in place; user can try again
      setTrashError(`删除「${board.name}」失败，原白板已保留，请重试`);
    }
  };

  if (showTrash) {
    return <TrashView userId={userId} onBack={() => setShowTrash(false)} />;
  }

  const myBoards = boards.filter((b) => b.ownerId === userId);
  const sharedBoards = boards.filter((b) => b.ownerId !== userId);
  const recentBoards = [...boards].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const SectionHeader: React.FC<{ title: string; count?: number }> = ({ title, count }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 600,
          color: '#1a1a1a',
        }}
      >
        {title}
      </h2>
      {count !== undefined && (
        <span
          style={{
            fontSize: '13px',
            color: '#6b7280',
            background: '#f3f4f6',
            padding: '2px 8px',
            borderRadius: '10px',
          }}
        >
          {count}
        </span>
      )}
    </div>
  );

  const BoardGrid: React.FC<{ boards: Board[]; loading?: boolean; owned?: boolean }> = ({
    boards: boardList,
    loading: gridLoading,
    owned,
  }) => {
    if (gridLoading) {
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '20px',
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                borderRadius: '12px',
                height: '200px',
                background: '#e5e7eb',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>
      );
    }

    if (boardList.length === 0) {
      return (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 16px',
            color: '#6b7280',
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ margin: '0 auto 16px', opacity: 0.5 }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          </svg>
          <p style={{ margin: 0, fontSize: '14px' }}>暂无白板</p>
          <p style={{ margin: '8px 0 0', fontSize: '13px' }}>点击「新建白板」开始创建</p>
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '20px',
        }}
      >
        {boardList.map((board, index) => (
          <BoardCard
            key={board._id}
            board={board}
            index={index}
            onClick={() => onBoardSelect(board)}
            onTrash={
              owned || board.ownerId === userId ? () => handleMoveToTrash(board) : undefined
            }
          />
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f9fafb',
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .board-trash-btn {
          opacity: 0;
        }
        .board-card-wrap:hover .board-trash-btn,
        .board-trash-btn:focus-visible {
          opacity: 1;
        }
      `}</style>

      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 32px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <span
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#1a1a1a',
              }}
            >
              协作白板
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={() => setShowTrash(true)}
              title="回收站"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
                background: '#f3f4f6',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#e5e7eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              回收站
            </button>
            <button
              onClick={() => setIsTemplateCenterOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#fff',
                background: '#667eea',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#5a67d8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#667eea';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建白板
            </button>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
              }}
            >
              {username.charAt(0).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px' }}>
        {notice && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 16px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '8px',
              color: '#065f46',
              fontSize: '13px',
            }}
          >
            {notice}
          </div>
        )}
        {trashError && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 16px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '13px',
            }}
          >
            {trashError}
          </div>
        )}
        <div
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '16px',
            padding: '40px',
            marginBottom: '40px',
            color: '#fff',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 700,
              marginBottom: '8px',
            }}
          >
            欢迎回来，{username}
          </h1>
          <p style={{ margin: 0, fontSize: '15px', opacity: 0.9 }}>
            继续你的创作，或者开始一个新的白板
          </p>
          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button
              onClick={() => setIsTemplateCenterOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#667eea',
                background: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建白板
            </button>
          </div>
        </div>

        <section style={{ marginBottom: '40px' }}>
          <SectionHeader title="最近编辑" count={loading ? undefined : recentBoards.length} />
          <BoardGrid boards={recentBoards.slice(0, 8)} loading={loading && boards.length === 0} />
        </section>

        <section style={{ marginBottom: '40px' }}>
          <SectionHeader title="我创建的" count={loading ? undefined : myBoards.length} />
          <BoardGrid boards={myBoards} loading={loading && boards.length === 0} owned />
        </section>

        <section>
          <SectionHeader title="我参与的" count={loading ? undefined : sharedBoards.length} />
          <BoardGrid boards={sharedBoards} loading={loading && boards.length === 0} />
        </section>
      </main>

      <TemplateCenter
        isOpen={isTemplateCenterOpen}
        onClose={() => setIsTemplateCenterOpen(false)}
        onCreate={handleCreateBoard}
      />
    </div>
  );
};
