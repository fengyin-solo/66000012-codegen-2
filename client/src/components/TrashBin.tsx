import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, TrashFilters, TrashSort } from '../types';
import { boardApi } from '../services/api';
import { formatFullDate } from '../utils/date';

interface TrashBinProps {
  userId: string;
  onBack: () => void;
}

interface ActionError {
  kind: 'restore' | 'purge';
  message: string;
  retryable: boolean;
}

type PendingAction = 'restore' | 'purge';

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: '#1a1a1a',
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  outline: 'none',
};

const buttonBase: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 500,
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  transition: 'opacity 0.2s',
};

const getRandomGradient = (seed: number): string => {
  const gradients = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  ];
  return gradients[Math.abs(seed) % gradients.length];
};

export const TrashBin: React.FC<TrashBinProps> = ({ userId, onBack }) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TrashFilters>({});
  const [sort, setSort] = useState<TrashSort>('deletedAt-desc');
  const [pendingMap, setPendingMap] = useState<Record<string, PendingAction>>({});
  const [errorMap, setErrorMap] = useState<Record<string, ActionError>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'info' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveFilters = Boolean(
    filters.name?.trim() ||
      filters.collaborator?.trim() ||
      filters.createdFrom ||
      filters.createdTo
  );

  const showToast = useCallback((text: string, tone: 'success' | 'info' = 'success') => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const loadTrash = useCallback(
    async (currentFilters: TrashFilters, currentSort: TrashSort) => {
      setLoading(true);
      setFetchError(null);
      try {
        const data = await boardApi.getTrashBoards(userId, currentFilters, currentSort);
        setBoards(data);
      } catch (error) {
        console.error('Failed to load recycle bin:', error);
        setFetchError(error instanceof Error ? error.message : '加载回收站失败');
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  // Debounced reload whenever filters or sort order change.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadTrash(filters, sort);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.name, filters.collaborator, filters.createdFrom, filters.createdTo, sort]);

  const collaboratorSuggestions = useMemo(() => {
    const ids = new Set<string>();
    boards.forEach((b) => b.collaborators.forEach((c) => ids.add(c)));
    return Array.from(ids);
  }, [boards]);

  const updateFilter = (patch: Partial<TrashFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const resetFilters = () => {
    setFilters({});
    setSort('deletedAt-desc');
  };

  const removeBoardLocally = (boardId: string) => {
    setBoards((prev) => prev.filter((b) => b._id !== boardId));
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[boardId];
      return next;
    });
  };

  const isConflictOrGone = (error: unknown): 'restored' | 'gone' | null => {
    const status = (error as { status?: number })?.status;
    const code = (error as { code?: string })?.code;
    if (status === 404) return 'gone';
    if (status === 409 && code === 'NOT_IN_TRASH') return 'restored';
    return null;
  };

  const handleRestore = useCallback(
    async (board: Board) => {
      setPendingMap((prev) => ({ ...prev, [board._id]: 'restore' }));
      setErrorMap((prev) => {
        const next = { ...prev };
        delete next[board._id];
        return next;
      });
      try {
        await boardApi.restoreBoard(board._id, userId);
        removeBoardLocally(board._id);
        showToast(`白板「${board.name}」已恢复，可在工作台原分类中查看`);
      } catch (error) {
        console.error('Failed to restore board:', error);
        const outcome = isConflictOrGone(error);
        if (outcome === 'restored') {
          removeBoardLocally(board._id);
          showToast('该白板已在工作台中，无需重复恢复', 'info');
        } else if (outcome === 'gone') {
          removeBoardLocally(board._id);
          showToast('该记录已不存在', 'info');
        } else {
          setErrorMap((prev) => ({
            ...prev,
            [board._id]: {
              kind: 'restore',
              message: error instanceof Error ? error.message : '恢复失败，请重试',
              retryable: true,
            },
          }));
        }
      } finally {
        setPendingMap((prev) => {
          const next = { ...prev };
          delete next[board._id];
          return next;
        });
      }
    },
    [userId, showToast]
  );

  const handlePurge = useCallback(
    async (board: Board) => {
      const confirmed = window.confirm(`永久删除后无法恢复，确定删除「${board.name}」吗？`);
      if (!confirmed) return;

      setPendingMap((prev) => ({ ...prev, [board._id]: 'purge' }));
      setErrorMap((prev) => {
        const next = { ...prev };
        delete next[board._id];
        return next;
      });
      try {
        await boardApi.purgeBoard(board._id, userId);
        removeBoardLocally(board._id);
        showToast(`白板「${board.name}」已永久删除`);
      } catch (error) {
        console.error('Failed to purge board:', error);
        const outcome = isConflictOrGone(error);
        if (outcome === 'restored') {
          removeBoardLocally(board._id);
          showToast('该白板已恢复到工作台，无法在回收站删除', 'info');
        } else if (outcome === 'gone') {
          removeBoardLocally(board._id);
          showToast('该记录已不存在', 'info');
        } else {
          // The server retains the original record on failure; keep the card
          // and surface a re-submit entry.
          setErrorMap((prev) => ({
            ...prev,
            [board._id]: {
              kind: 'purge',
              message: error instanceof Error ? error.message : '永久删除失败，记录已保留，请重试',
              retryable: true,
            },
          }));
        }
      } finally {
        setPendingMap((prev) => {
          const next = { ...prev };
          delete next[board._id];
          return next;
        });
      }
    },
    [userId, showToast]
  );

  const renderEmptyState = () => {
    const filtered = hasActiveFilters;
    return (
      <div style={{ textAlign: 'center', padding: '72px 16px', color: '#6b7280' }}>
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{ margin: '0 auto 16px', opacity: 0.5 }}
        >
          {filtered ? (
            <>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </>
          ) : (
            <>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </>
          )}
        </svg>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 500, color: '#374151' }}>
          {filtered ? '没有找到匹配的白板' : '回收站为空'}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: '13px' }}>
          {filtered
            ? '尝试更换白板名称、创建时间或协作者条件'
            : '从工作台删除的白板会先进入这里，可随时恢复'}
        </p>
        {filtered && (
          <button
            onClick={resetFilters}
            style={{
              ...buttonBase,
              marginTop: '20px',
              color: '#fff',
              background: '#667eea',
            }}
          >
            清空筛选条件
          </button>
        )}
      </div>
    );
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
            <span style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a' }}>回收站</span>
            {!loading && !fetchError && (
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
        </div>
      </header>

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px' }}>
        {/* Filter bar */}
        <div
          style={{
            background: '#fff',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            白板名称
            <input
              type="text"
              value={filters.name || ''}
              onChange={(e) => updateFilter({ name: e.target.value })}
              placeholder="按名称搜索"
              style={{ ...inputStyle, width: '180px' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            协作者
            <input
              type="text"
              value={filters.collaborator || ''}
              onChange={(e) => updateFilter({ collaborator: e.target.value })}
              placeholder="协作者 ID，如 user-2"
              list="collaborator-suggestions"
              style={{ ...inputStyle, width: '170px' }}
            />
            <datalist id="collaborator-suggestions">
              {collaboratorSuggestions.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            创建时间 起
            <input
              type="date"
              value={filters.createdFrom || ''}
              onChange={(e) => updateFilter({ createdFrom: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            创建时间 止
            <input
              type="date"
              value={filters.createdTo || ''}
              onChange={(e) => updateFilter({ createdTo: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            排序（删除时间）
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as TrashSort)}
              style={{ ...inputStyle, width: '150px', cursor: 'pointer' }}
            >
              <option value="deletedAt-desc">最近删除优先</option>
              <option value="deletedAt-asc">最早删除优先</option>
            </select>
          </label>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              style={{
                ...buttonBase,
                color: '#667eea',
                background: '#eef2ff',
                height: '34px',
              }}
            >
              重置
            </button>
          )}
        </div>

        {toast && (
          <div
            style={{
              position: 'fixed',
              top: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 500,
              color: '#fff',
              background: toast.tone === 'success' ? '#10b981' : '#6b7280',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            }}
          >
            {toast.text}
          </div>
        )}

        {fetchError ? (
          <div
            style={{
              textAlign: 'center',
              padding: '56px 16px',
              background: '#fff',
              borderRadius: '12px',
            }}
          >
            <p style={{ margin: 0, fontSize: '14px', color: '#dc2626' }}>回收站加载失败：{fetchError}</p>
            <button
              onClick={() => loadTrash(filters, sort)}
              style={{ ...buttonBase, marginTop: '16px', color: '#fff', background: '#667eea' }}
            >
              重新加载
            </button>
          </div>
        ) : loading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '20px',
            }}
          >
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  borderRadius: '12px',
                  height: '210px',
                  background: '#e5e7eb',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        ) : boards.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '12px' }}>{renderEmptyState()}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '20px',
            }}
          >
            {boards.map((board, index) => {
              const pending = pendingMap[board._id];
              const actionError = errorMap[board._id];
              return (
                <div
                  key={board._id}
                  style={{
                    background: '#fff',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '96px',
                      background: board.backgroundColor || getRandomGradient(index),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      filter: 'grayscale(0.35)',
                      opacity: 0.85,
                    }}
                  >
                    <span
                      style={{
                        color: '#fff',
                        fontSize: '22px',
                        fontWeight: 600,
                        textShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {board.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div style={{ padding: '14px 16px 16px' }}>
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
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280', lineHeight: 1.7 }}>
                      <div>删除于 {board.deletedAt ? formatFullDate(board.deletedAt) : '—'}</div>
                      <div>创建于 {formatFullDate(board.createdAt)}</div>
                      <div>
                        协作者 {board.collaborators.length > 0 ? board.collaborators.join('、') : '无'}
                      </div>
                    </div>

                    {actionError && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '8px 10px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#b91c1c',
                        }}
                      >
                        <div>{actionError.message}</div>
                        {actionError.retryable && (
                          <button
                            onClick={() =>
                              actionError.kind === 'restore'
                                ? handleRestore(board)
                                : handlePurge(board)
                            }
                            disabled={Boolean(pending)}
                            style={{
                              ...buttonBase,
                              marginTop: '6px',
                              padding: '4px 10px',
                              color: '#fff',
                              background: '#dc2626',
                              opacity: pending ? 0.6 : 1,
                              cursor: pending ? 'wait' : 'pointer',
                            }}
                          >
                            重新提交
                          </button>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <button
                        onClick={() => handleRestore(board)}
                        disabled={Boolean(pending)}
                        style={{
                          ...buttonBase,
                          flex: 1,
                          color: '#fff',
                          background: '#667eea',
                          opacity: pending ? 0.6 : 1,
                          cursor: pending ? 'wait' : 'pointer',
                        }}
                      >
                        {pending === 'restore' ? '恢复中…' : '恢复'}
                      </button>
                      <button
                        onClick={() => handlePurge(board)}
                        disabled={Boolean(pending)}
                        style={{
                          ...buttonBase,
                          flex: 1,
                          color: '#dc2626',
                          background: '#fef2f2',
                          opacity: pending ? 0.6 : 1,
                          cursor: pending ? 'wait' : 'pointer',
                        }}
                      >
                        {pending === 'purge' ? '删除中…' : '永久删除'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};
