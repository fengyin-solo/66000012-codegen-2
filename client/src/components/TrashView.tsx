import React, { useEffect, useMemo, useState } from 'react';
import { Board } from '../types';
import { boardApi } from '../services/api';

interface TrashViewProps {
  userId: string;
  onBack: () => void;
}

type SortField = 'deletedAt' | 'name' | 'createdAt';
type SortOrder = 'asc' | 'desc';

interface ItemError {
  message: string;
  /** Re-run the failed action (resubmit entry) */
  retry: () => void;
}

const formatDateTime = (dateStr?: string | null): string => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatRelative = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  outline: 'none',
  background: '#fff',
  color: '#1a1a1a',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '12px',
  color: '#6b7280',
  fontWeight: 500,
};

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 500,
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.2s, opacity 0.2s',
};

export const TrashView: React.FC<TrashViewProps> = ({ userId, onBack }) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [name, setName] = useState('');
  const [collaborator, setCollaborator] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('deletedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pending item actions and their errors (boardId -> state)
  const [pending, setPending] = useState<Record<string, 'restore' | 'delete'>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, ItemError>>({});
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Debounced name filter so typing doesn't fire a request per keystroke
  const [debouncedName, setDebouncedName] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(name.trim()), 300);
    return () => clearTimeout(timer);
  }, [name]);

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  const loadTrash = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await boardApi.getTrash(userId, {
        name: debouncedName || undefined,
        collaborator: collaborator || undefined,
        createdFrom: createdFrom || undefined,
        createdTo: createdTo || undefined,
        sort: sortField,
        order: sortOrder,
      });
      setBoards(data);
    } catch (error) {
      console.error('Failed to load trash:', error);
      setLoadError(error instanceof Error ? error.message : '加载回收站失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedName, collaborator, createdFrom, createdTo, sortField, sortOrder]);

  const collaboratorOptions = useMemo(() => {
    const set = new Set<string>();
    boards.forEach((b) => b.collaborators.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [boards]);

  const hasActiveFilters =
    debouncedName !== '' || collaborator !== '' || createdFrom !== '' || createdTo !== '';

  const resetFilters = () => {
    setName('');
    setCollaborator('');
    setCreatedFrom('');
    setCreatedTo('');
  };

  const handleRestore = async (board: Board) => {
    // Guard against duplicate restore submissions
    if (pending[board._id]) return;
    setPending((p) => ({ ...p, [board._id]: 'restore' }));
    setItemErrors((e) => {
      const next = { ...e };
      delete next[board._id];
      return next;
    });
    try {
      const restored = await boardApi.restoreBoard(board._id, userId);
      // Remove locally only after the server confirms. Repeated restores are
      // handled idempotently by the server, so a duplicate click cannot create
      // a copy.
      setBoards((list) => list.filter((b) => b._id !== board._id));
      setNotice(`已恢复「${restored?.name ?? board.name}」，分类与协作者关系保持不变`);
    } catch (error) {
      console.error('Failed to restore board:', error);
      // Record stays in the trash and a resubmit entry is offered
      setItemErrors((e) => ({
        ...e,
        [board._id]: {
          message: error instanceof Error ? error.message : '恢复失败，请重试',
          retry: () => handleRestore(board),
        },
      }));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[board._id];
        return next;
      });
    }
  };

  const handlePermanentDelete = async (board: Board) => {
    if (pending[board._id]) return;
    if (!window.confirm(`确定要彻底删除「${board.name}」吗？此操作无法撤销。`)) return;
    setPending((p) => ({ ...p, [board._id]: 'delete' }));
    setItemErrors((e) => {
      const next = { ...e };
      delete next[board._id];
      return next;
    });
    try {
      const ok = await boardApi.permanentlyDeleteBoard(board._id, userId);
      if (!ok) throw new Error('删除失败，请重试');
      setBoards((list) => list.filter((b) => b._id !== board._id));
      setNotice(`已彻底删除「${board.name}」`);
    } catch (error) {
      console.error('Failed to permanently delete board:', error);
      // Original record preserved; offer resubmit
      setItemErrors((e) => ({
        ...e,
        [board._id]: {
          message: error instanceof Error ? error.message : '删除失败，请重试',
          retry: () => handlePermanentDelete(board),
        },
      }));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[board._id];
        return next;
      });
    }
  };

  const handleEmptyTrash = async () => {
    if (clearing || boards.length === 0) return;
    if (!window.confirm(`确定要清空回收站吗？将彻底删除 ${boards.length} 个白板，此操作无法撤销。`)) {
      return;
    }
    setClearing(true);
    setClearError(null);
    try {
      const count = await boardApi.emptyTrash(userId);
      setBoards([]);
      setNotice(`已清空回收站，共删除 ${count} 个白板`);
    } catch (error) {
      console.error('Failed to clear trash:', error);
      // Failed cleanup keeps all original records; the button itself is the
      // resubmit entry.
      setClearError(error instanceof Error ? error.message : '清空失败，请重新提交');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
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
            <button
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#374151',
                background: '#f3f4f6',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              返回工作台
            </button>
            <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1a1a1a' }}>
              回收站
            </h1>
            {!loading && !loadError && (
              <span
                style={{
                  fontSize: '13px',
                  color: '#6b7280',
                  background: '#f3f4f6',
                  padding: '2px 8px',
                  borderRadius: '10px',
                }}
              >
                {boards.length}
              </span>
            )}
          </div>
          <button
            onClick={handleEmptyTrash}
            disabled={clearing || loading || boards.length === 0}
            style={{
              ...btnBase,
              color: boards.length === 0 ? '#9ca3af' : '#dc2626',
              background: '#fff',
              border: '1px solid #fecaca',
              opacity: clearing ? 0.6 : 1,
              cursor: clearing || boards.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {clearing ? '清空中…' : '清空回收站'}
          </button>
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

        {/* Filter bar */}
        <div
          style={{
            background: '#fff',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
            padding: '16px',
            marginBottom: '20px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end',
          }}
        >
          <label style={{ ...labelStyle, flex: '1 1 180px' }}>
            名称
            <input
              style={inputStyle}
              type="text"
              value={name}
              placeholder="按白板名称搜索"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label style={{ ...labelStyle, flex: '0 1 160px' }}>
            协作者
            <select
              style={inputStyle}
              value={collaborator}
              onChange={(e) => setCollaborator(e.target.value)}
            >
              <option value="">全部协作者</option>
              {collaboratorOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            创建时间 起
            <input
              style={inputStyle}
              type="date"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            创建时间 止
            <input
              style={inputStyle}
              type="date"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
            />
          </label>

          <label style={labelStyle}>
            排序字段
            <select
              style={inputStyle}
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
            >
              <option value="deletedAt">删除时间</option>
              <option value="createdAt">创建时间</option>
              <option value="name">名称</option>
            </select>
          </label>
          <label style={labelStyle}>
            排序方向
            <select
              style={inputStyle}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            >
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </label>

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              style={{
                ...btnBase,
                color: '#6b7280',
                background: '#f3f4f6',
              }}
            >
              清除筛选
            </button>
          )}
        </div>

        {clearError && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 16px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span>清空失败，原记录已保留：{clearError}</span>
            <button
              onClick={handleEmptyTrash}
              disabled={clearing}
              style={{
                ...btnBase,
                color: '#fff',
                background: '#dc2626',
                whiteSpace: 'nowrap',
              }}
            >
              重新提交
            </button>
          </div>
        )}

        {loading ? (
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              height: '120px',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ) : loadError ? (
          <EmptyState
            icon="error"
            title="回收站加载失败"
            description={loadError}
            actionText="重新加载"
            onAction={loadTrash}
          />
        ) : boards.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon="search"
              title="没有匹配的白板"
              description="尝试调整名称、创建时间或协作者筛选条件"
              actionText="清除筛选"
              onAction={resetFilters}
            />
          ) : (
            <EmptyState
              icon="trash"
              title="回收站为空"
              description="从工作台删除的白板会先保存在这里，可随时恢复"
            />
          )
        ) : (
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
              overflow: 'hidden',
            }}
          >
            {boards.map((board) => {
              const itemPending = pending[board._id];
              const itemError = itemErrors[board._id];
              return (
                <div
                  key={board._id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '14px 20px',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      background: board.backgroundColor && board.backgroundColor !== '#ffffff'
                        ? board.backgroundColor
                        : 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '16px',
                      flexShrink: 0,
                    }}
                  >
                    {board.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                      {board.name}
                    </div>
                    <div
                      style={{
                        marginTop: '4px',
                        fontSize: '12px',
                        color: '#6b7280',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <span>删除于 {formatDateTime(board.deletedAt)}（{formatRelative(board.deletedAt)}）</span>
                      <span>创建于 {formatDateTime(board.createdAt)}</span>
                      {board.category && board.category !== 'general' && (
                        <span>分类：{board.category}</span>
                      )}
                      {board.collaborators.length > 0 && (
                        <span>协作者：{board.collaborators.join('、')}</span>
                      )}
                    </div>
                    {itemError && (
                      <div
                        style={{
                          marginTop: '8px',
                          fontSize: '12px',
                          color: '#991b1b',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <span>操作失败，原记录已保留：{itemError.message}</span>
                        <button
                          onClick={itemError.retry}
                          disabled={!!itemPending}
                          style={{
                            ...btnBase,
                            padding: '3px 10px',
                            fontSize: '12px',
                            color: '#fff',
                            background: '#dc2626',
                          }}
                        >
                          重新提交
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={() => handleRestore(board)}
                      disabled={!!itemPending}
                      style={{
                        ...btnBase,
                        color: '#fff',
                        background: '#667eea',
                        opacity: itemPending ? 0.6 : 1,
                        cursor: itemPending ? 'wait' : 'pointer',
                      }}
                    >
                      {itemPending === 'restore' ? '恢复中…' : '恢复'}
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(board)}
                      disabled={!!itemPending}
                      style={{
                        ...btnBase,
                        color: '#dc2626',
                        background: '#fff',
                        border: '1px solid #fecaca',
                        opacity: itemPending ? 0.6 : 1,
                        cursor: itemPending ? 'wait' : 'pointer',
                      }}
                    >
                      {itemPending === 'delete' ? '删除中…' : '彻底删除'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

const EmptyState: React.FC<{
  icon: 'trash' | 'search' | 'error';
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}> = ({ icon, title, description, actionText, onAction }) => (
  <div
    style={{
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
      textAlign: 'center',
      padding: '64px 16px',
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
      {icon === 'trash' && (
        <>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </>
      )}
      {icon === 'search' && (
        <>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      )}
      {icon === 'error' && (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </>
      )}
    </svg>
    <p style={{ margin: 0, fontSize: '15px', fontWeight: 500, color: '#374151' }}>{title}</p>
    {description && <p style={{ margin: '8px 0 0', fontSize: '13px' }}>{description}</p>}
    {actionText && onAction && (
      <button
        onClick={onAction}
        style={{
          ...btnBase,
          marginTop: '16px',
          color: '#fff',
          background: '#667eea',
        }}
      >
        {actionText}
      </button>
    )}
  </div>
);
