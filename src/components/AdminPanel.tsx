import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ban,
  CheckCircle2,
  Eye,
  Globe,
  Laptop,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  adminUpdateSharedItemVisibility,
  deleteSharedItem,
  fetchAllSharedItemsForAdmin,
} from '../lib/communityService';
import {
  deleteUserAccountByAdmin,
  ensureBootstrapAdminRole,
  fetchUserActivityForAdmin,
  fetchUserDevicesForAdmin,
  listAllUserAccounts,
  updateUserAdminControl,
} from '../lib/syncService';
import {
  SharedItemType,
  SharedStudyItem,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  UserRole,
} from '../types';

interface AdminPanelProps {
  currentAdminUid: string;
  currentAdminEmail?: string | null;
  currentAdminAccount?: UserAccountDoc | null;
  onOpenShareCode?: (shareCode: string) => void;
}

type AdminSection = 'users' | 'community';

function extractErrMessage(err: unknown, fallback: string): string {
  let msg = err instanceof Error ? err.message : fallback;
  try {
    const parsed = JSON.parse(msg) as { error?: string };
    if (parsed?.error) msg = parsed.error;
  } catch {
    // keep raw message
  }
  return msg;
}

function formatTs(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB');
  }
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleString('en-GB');
  }
  return '—';
}

export function AdminPanel({
  currentAdminUid,
  currentAdminEmail,
  currentAdminAccount,
  onOpenShareCode,
}: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>('users');

  // Directory state
  const [users, setUsers] = useState<UserAccountDoc[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  // Manage user modal
  const [editingUser, setEditingUser] = useState<UserAccountDoc | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('student');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  // Inspect user modal (devices + activity + shares)
  const [inspectUser, setInspectUser] = useState<UserAccountDoc | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectDevices, setInspectDevices] = useState<UserDeviceDoc[]>([]);
  const [inspectActivity, setInspectActivity] = useState<UserActivityDoc[]>([]);

  // Community moderation state
  const [sharedItems, setSharedItems] = useState<SharedStudyItem[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [sharesLoadedOnce, setSharesLoadedOnce] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareTypeFilter, setShareTypeFilter] = useState<'all' | SharedItemType>('all');
  const [confirmDeleteShareId, setConfirmDeleteShareId] = useState<string | null>(null);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setError(null);
    try {
      if (currentAdminEmail && currentAdminAccount) {
        await ensureBootstrapAdminRole(currentAdminUid, currentAdminEmail, currentAdminAccount);
      }
      const list = await listAllUserAccounts();
      list.sort((a, b) =>
        (a.displayName || a.uid || '').localeCompare(b.displayName || b.uid || '')
      );
      setUsers(list);
    } catch (err) {
      setError(extractErrMessage(err, 'Unable to load users.'));
    } finally {
      setLoadingUsers(false);
    }
  }, [currentAdminUid, currentAdminEmail, currentAdminAccount]);

  const loadShares = useCallback(async () => {
    setLoadingShares(true);
    setError(null);
    try {
      const items = await fetchAllSharedItemsForAdmin();
      setSharedItems(items);
      setSharesLoadedOnce(true);
    } catch (err) {
      setError(extractErrMessage(err, 'Unable to load community shares.'));
    } finally {
      setLoadingShares(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (section === 'community' && !sharesLoadedOnce) {
      void loadShares();
    }
  }, [section, sharesLoadedOnce, loadShares]);

  const metrics = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const educators = users.filter((u) => u.role === 'educator').length;
    const suspended = users.filter((u) => Boolean(u.disabled)).length;
    return { total, admins, educators, suspended };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && u.disabled) return false;
      if (statusFilter === 'suspended' && !u.disabled) return false;
      if (q) {
        const hay = `${u.displayName} ${u.uid} ${u.role} ${u.adminNote || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, searchQ, roleFilter, statusFilter]);

  const filteredShares = useMemo(() => {
    const q = shareSearch.trim().toLowerCase();
    return sharedItems.filter((item) => {
      if (shareTypeFilter !== 'all' && item.type !== shareTypeFilter) return false;
      if (q) {
        const hay =
          `${item.title} ${item.subjectName} ${item.ownerName} ${item.ownerId} ${item.shareCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sharedItems, shareSearch, shareTypeFilter]);

  const openManageModal = (u: UserAccountDoc) => {
    setEditingUser(u);
    setEditName(u.displayName || '');
    setEditRole(u.role);
    setEditDisabled(Boolean(u.disabled));
    setEditReason(u.suspendedReason || '');
    setEditNote(u.adminNote || '');
    setConfirmDeleteUid(null);
    setError(null);
  };

  const handleSaveUserControls = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const cleanName = editName.trim();
    if (!cleanName) {
      setError('Display name cannot be empty.');
      return;
    }
    const isSelf = editingUser.uid === currentAdminUid;
    setSavingUser(true);
    setError(null);
    try {
      await updateUserAdminControl({
        adminUid: currentAdminUid,
        targetUid: editingUser.uid,
        role: isSelf ? editingUser.role : editRole,
        displayName: cleanName,
        disabled: isSelf ? false : editDisabled,
        suspendedReason: editDisabled ? editReason : '',
        adminNote: editNote,
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === editingUser.uid
            ? {
                ...u,
                role: isSelf ? editingUser.role : editRole,
                displayName: cleanName,
                disabled: isSelf ? false : editDisabled,
                suspendedReason: editDisabled ? editReason.trim() : '',
                adminNote: editNote.trim(),
              }
            : u
        )
      );
      setStatusMsg(`Updated controls for ${cleanName}.`);
      setEditingUser(null);
      window.setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setError(extractErrMessage(err, 'Failed to update user account.'));
    } finally {
      setSavingUser(false);
    }
  };

  const handleQuickSuspendToggle = async (u: UserAccountDoc) => {
    if (u.uid === currentAdminUid) return;
    const nextDisabled = !u.disabled;
    setError(null);
    try {
      await updateUserAdminControl({
        adminUid: currentAdminUid,
        targetUid: u.uid,
        disabled: nextDisabled,
        suspendedReason: nextDisabled ? u.suspendedReason || 'Suspended by administrator.' : '',
      });
      setUsers((prev) =>
        prev.map((x) =>
          x.uid === u.uid
            ? {
                ...x,
                disabled: nextDisabled,
                suspendedReason: nextDisabled
                  ? x.suspendedReason || 'Suspended by administrator.'
                  : '',
              }
            : x
        )
      );
      setStatusMsg(
        nextDisabled
          ? `Suspended ${u.displayName}. Cloud sync writes are blocked.`
          : `Reactivated ${u.displayName}.`
      );
      window.setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setError(extractErrMessage(err, 'Failed to toggle suspension.'));
    }
  };

  const handleDeleteUser = async (targetUid: string) => {
    if (targetUid === currentAdminUid) return;
    setDeletingUid(targetUid);
    setError(null);
    try {
      await deleteUserAccountByAdmin(targetUid);
      setUsers((prev) => prev.filter((u) => u.uid !== targetUid));
      if (editingUser?.uid === targetUid) setEditingUser(null);
      if (inspectUser?.uid === targetUid) setInspectUser(null);
      setConfirmDeleteUid(null);
      setStatusMsg('User account record and cloud sync metadata deleted.');
      window.setTimeout(() => setStatusMsg(null), 3500);
    } catch (err) {
      setError(extractErrMessage(err, 'Failed to delete user record.'));
    } finally {
      setDeletingUid(null);
    }
  };

  const openInspectModal = async (u: UserAccountDoc) => {
    setInspectUser(u);
    setInspectLoading(true);
    setInspectDevices([]);
    setInspectActivity([]);
    setError(null);
    try {
      const [devs, acts] = await Promise.all([
        fetchUserDevicesForAdmin(u.uid),
        fetchUserActivityForAdmin(u.uid),
      ]);
      setInspectDevices(devs);
      setInspectActivity(acts);
    } catch (err) {
      setError(extractErrMessage(err, 'Could not inspect user activity/devices.'));
    } finally {
      setInspectLoading(false);
    }
  };

  const handleToggleShareVisibility = async (item: SharedStudyItem) => {
    const nextVis = item.visibility === 'public' ? 'unlisted' : 'public';
    setBusyShareId(item.id);
    setError(null);
    try {
      await adminUpdateSharedItemVisibility(item.id, nextVis);
      setSharedItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, visibility: nextVis } : x))
      );
      setStatusMsg(`Updated "${item.title}" to ${nextVis}.`);
      window.setTimeout(() => setStatusMsg(null), 2500);
    } catch (err) {
      setError(extractErrMessage(err, 'Failed to update share visibility.'));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleDeleteShare = async (shareId: string) => {
    setBusyShareId(shareId);
    setError(null);
    try {
      await deleteSharedItem(shareId);
      setSharedItems((prev) => prev.filter((x) => x.id !== shareId));
      setConfirmDeleteShareId(null);
      setStatusMsg('Shared post removed from Community Share.');
      window.setTimeout(() => setStatusMsg(null), 2500);
    } catch (err) {
      setError(extractErrMessage(err, 'Failed to delete shared post.'));
    } finally {
      setBusyShareId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1160px] space-y-6 px-4 py-7 sm:px-6">
        {/* Header & Section Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">
              Admin Control Center
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Manage user roles, suspend or inspect accounts, and moderate Community Share posts. Encrypted student PII remains private.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="sd-seg" role="tablist" aria-label="Admin sections">
              <button
                type="button"
                role="tab"
                aria-selected={section === 'users'}
                aria-pressed={section === 'users'}
                onClick={() => setSection('users')}
                className="sd-seg-btn whitespace-nowrap"
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Users ({users.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === 'community'}
                aria-pressed={section === 'community'}
                onClick={() => setSection('community')}
                className="sd-seg-btn whitespace-nowrap"
              >
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Community Moderation</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => void (section === 'users' ? loadUsers() : loadShares())}
              className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingUsers || loadingShares ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="sd-card p-4">
            <div className="text-xs font-semibold text-[var(--mute)]">Total Accounts</div>
            <div className="font-mono-num mt-1 text-2xl font-extrabold tabular-nums text-[var(--ink)]">
              {metrics.total}
            </div>
          </div>
          <div className="sd-card p-4">
            <div className="text-xs font-semibold text-[var(--mute)]">Administrators</div>
            <div className="font-mono-num mt-1 text-2xl font-extrabold tabular-nums text-[var(--e3)]">
              {metrics.admins}
            </div>
          </div>
          <div className="sd-card p-4">
            <div className="text-xs font-semibold text-[var(--mute)]">Educators</div>
            <div className="font-mono-num mt-1 text-2xl font-extrabold tabular-nums text-[var(--ink)]">
              {metrics.educators}
            </div>
          </div>
          <div className="sd-card p-4">
            <div className="text-xs font-semibold text-[var(--mute)]">Suspended</div>
            <div className="font-mono-num mt-1 text-2xl font-extrabold tabular-nums text-[var(--bad)]">
              {metrics.suspended}
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-[var(--bad)] bg-[var(--card)] p-3 text-xs font-medium text-[var(--bad)]"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {statusMsg && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-[var(--ok)] bg-[var(--card)] p-3 text-xs font-semibold text-[var(--ok)]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* USERS DIRECTORY */}
        {section === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[220px] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search by display name, UID, or admin note…"
                  className="sd-input pl-8 text-xs"
                />
              </div>
              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
                className="sd-input w-auto text-xs"
              >
                <option value="all">All roles</option>
                <option value="student">Students</option>
                <option value="educator">Educators</option>
                <option value="admin">Admins</option>
              </select>
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')
                }
                className="sd-input w-auto text-xs"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>

            <div className="sd-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--line)] bg-[var(--bg)] text-xs font-semibold text-[var(--mute)]">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">UID</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Key</th>
                      <th className="px-4 py-3 text-right">Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {filteredUsers.map((u) => {
                      const isSelf = u.uid === currentAdminUid;
                      const isSuspended = Boolean(u.disabled);
                      return (
                        <tr key={u.uid} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--ink)]">
                              {u.displayName}
                              {isSelf && (
                                <span className="ml-2 text-xs font-semibold text-[var(--e3)]">
                                  · You
                                </span>
                              )}
                            </div>
                            {u.adminNote && (
                              <div className="mt-0.5 max-w-[260px] truncate text-[11px] text-[var(--mute)]">
                                Note: {u.adminNote}
                              </div>
                            )}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs text-[var(--mute)]">
                            <span title={u.uid}>{u.uid.slice(0, 14)}…</span>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              aria-label={`Role for ${u.displayName}`}
                              disabled={isSelf}
                              value={u.role}
                              onChange={async (e) => {
                                const nextRole = e.target.value as UserRole;
                                try {
                                  await updateUserAdminControl({
                                    adminUid: currentAdminUid,
                                    targetUid: u.uid,
                                    role: nextRole,
                                  });
                                  setUsers((prev) =>
                                    prev.map((x) =>
                                      x.uid === u.uid ? { ...x, role: nextRole } : x
                                    )
                                  );
                                } catch (err) {
                                  setError(extractErrMessage(err, 'Failed to change role.'));
                                }
                              }}
                              className="sd-input w-auto py-1 text-xs font-semibold disabled:opacity-50"
                            >
                              <option value="student">Student</option>
                              <option value="educator">Educator</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            {isSuspended ? (
                              <span className="text-[var(--bad)]" title={u.suspendedReason || ''}>
                                Suspended
                              </span>
                            ) : (
                              <span className="text-[var(--ok)]">Active</span>
                            )}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs tabular-nums text-[var(--mute)]">
                            v{u.keyVersion}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => void openInspectModal(u)}
                                title="Inspect devices & activity"
                                className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Inspect</span>
                              </button>
                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() => void handleQuickSuspendToggle(u)}
                                  title={isSuspended ? 'Reactivate user' : 'Suspend user'}
                                  className={`sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap ${
                                    isSuspended ? 'text-[var(--ok)]' : 'text-[var(--bad)]'
                                  }`}
                                >
                                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>{isSuspended ? 'Restore' : 'Suspend'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openManageModal(u)}
                                className="sd-btn-pri px-2.5 py-1.5 text-xs whitespace-nowrap"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Manage</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingUsers && filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-[var(--mute)]">
                          No user accounts match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* COMMUNITY SHARE MODERATION */}
        {section === 'community' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[220px] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={shareSearch}
                  onChange={(e) => setShareSearch(e.target.value)}
                  placeholder="Search by title, subject, author, or share code…"
                  className="sd-input pl-8 text-xs"
                />
              </div>
              <select
                aria-label="Filter share type"
                value={shareTypeFilter}
                onChange={(e) => setShareTypeFilter(e.target.value as 'all' | SharedItemType)}
                className="sd-input w-auto text-xs"
              >
                <option value="all">All types</option>
                <option value="notes">Notes</option>
                <option value="flashcards">Flashcards</option>
                <option value="subject">Full Subjects</option>
              </select>
            </div>

            <div className="sd-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--line)] bg-[var(--bg)] text-xs font-semibold text-[var(--mute)]">
                    <tr>
                      <th className="px-4 py-3">Resource</th>
                      <th className="px-4 py-3">Author</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Visibility</th>
                      <th className="px-4 py-3">Copies</th>
                      <th className="px-4 py-3 text-right">Moderation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {filteredShares.map((item) => {
                      const isConfirming = confirmDeleteShareId === item.id;
                      const busy = busyShareId === item.id;
                      return (
                        <tr key={item.id} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--ink)]">{item.title}</div>
                            <div className="mt-0.5 text-xs text-[var(--mute)]">
                              <span className="capitalize">{item.type}</span> · {item.subjectName} ·{' '}
                              {item.itemCount} items · Updated {formatTs(item.updatedAt)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--ink)]">
                            {item.ownerName}
                            <div className="font-mono-num text-[11px] text-[var(--mute)]">
                              {item.ownerId.slice(0, 12)}…
                            </div>
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs font-bold text-[var(--e3)]">
                            {item.shareCode}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            <span
                              className={
                                item.visibility === 'public'
                                  ? 'text-[var(--ok)]'
                                  : 'text-[var(--mute)]'
                              }
                            >
                              {item.visibility === 'public' ? 'Public' : 'Unlisted'}
                            </span>
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs tabular-nums text-[var(--mute)]">
                            {item.copyCount}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {onOpenShareCode && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onOpenShareCode(item.shareCode)}
                                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Read</span>
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleToggleShareVisibility(item)}
                                className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                              >
                                {item.visibility === 'public' ? (
                                  <>
                                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Make Unlisted</span>
                                  </>
                                ) : (
                                  <>
                                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Make Public</span>
                                  </>
                                )}
                              </button>
                              {isConfirming ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleDeleteShare(item.id)}
                                    className="sd-btn border-[var(--bad)] px-2.5 py-1.5 text-xs font-bold text-[var(--bad)] whitespace-nowrap"
                                  >
                                    Confirm Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteShareId(null)}
                                    className="sd-btn px-2 py-1.5 text-xs whitespace-nowrap"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmDeleteShareId(item.id)}
                                  className="sd-btn px-2.5 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Remove</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingShares && filteredShares.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-[var(--mute)]">
                          No shared resources match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MANAGE USER MODAL */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Manage ${editingUser.displayName}`}
        >
          <div className="sd-card w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Manage Account
                </h2>
                <p className="font-mono-num text-xs text-[var(--mute)]">{editingUser.uid}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                aria-label="Close modal"
                className="sd-btn h-8 w-8 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveUserControls} className="space-y-4 p-5">
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Display Name
                <input
                  type="text"
                  maxLength={100}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Role
                <select
                  disabled={editingUser.uid === currentAdminUid}
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="sd-input mt-1 text-sm disabled:opacity-50"
                >
                  <option value="student">Student</option>
                  <option value="educator">Educator</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              {editingUser.uid !== currentAdminUid && (
                <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                  <label className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={editDisabled}
                      onChange={(e) => setEditDisabled(e.target.checked)}
                      className="accent-[var(--bad)]"
                    />
                    <span>Suspend account (blocks cloud sync writes &amp; shows notice)</span>
                  </label>

                  {editDisabled && (
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Suspension Reason (shown to user)
                      <input
                        type="text"
                        maxLength={280}
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="e.g. Account suspended by site administrator."
                        className="sd-input mt-1 text-xs"
                      />
                    </label>
                  )}
                </div>
              )}

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Internal Admin Note (not shown to user)
                <textarea
                  rows={2}
                  maxLength={500}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Optional moderation context or support note…"
                  className="sd-input mt-1 text-xs"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                {editingUser.uid !== currentAdminUid ? (
                  confirmDeleteUid === editingUser.uid ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={deletingUid === editingUser.uid}
                        onClick={() => void handleDeleteUser(editingUser.uid)}
                        className="sd-btn border-[var(--bad)] px-3 py-1.5 text-xs font-bold text-[var(--bad)] whitespace-nowrap"
                      >
                        {deletingUid === editingUser.uid ? 'Deleting…' : 'Confirm Delete User'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteUid(null)}
                        className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteUid(editingUser.uid)}
                      className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Delete User Data</span>
                    </button>
                  )
                ) : (
                  <span className="text-xs text-[var(--mute)]">Current admin session</span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingUser}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    {savingUser ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT USER MODAL */}
      {inspectUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect ${inspectUser.displayName}`}
        >
          <div className="sd-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Inspect · {inspectUser.displayName}
                </h2>
                <p className="font-mono-num text-xs text-[var(--mute)]">
                  UID: {inspectUser.uid} · Role: {inspectUser.role} · Key v{inspectUser.keyVersion}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectUser(null)}
                aria-label="Close inspect dialog"
                className="sd-btn h-8 w-8 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                <div>
                  <div className="text-[var(--mute)]">Account Created</div>
                  <div className="font-mono-num mt-0.5 font-semibold text-[var(--ink)]">
                    {formatTs(inspectUser.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--mute)]">Last Metadata Update</div>
                  <div className="font-mono-num mt-0.5 font-semibold text-[var(--ink)]">
                    {formatTs(inspectUser.updatedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--mute)]">Encryption Mode</div>
                  <div className="mt-0.5 font-semibold text-[var(--ink)]">
                    {inspectUser.encryptionMode}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--mute)]">Account Status</div>
                  <div
                    className={`mt-0.5 font-semibold ${
                      inspectUser.disabled ? 'text-[var(--bad)]' : 'text-[var(--ok)]'
                    }`}
                  >
                    {inspectUser.disabled ? 'Suspended' : 'Active'}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="flex items-center gap-1.5 font-display text-sm font-bold text-[var(--ink)]">
                  <Laptop className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Registered Devices ({inspectDevices.length})</span>
                </h3>
                {inspectLoading ? (
                  <p className="mt-2 text-[var(--mute)]">Loading device list…</p>
                ) : inspectDevices.length === 0 ? (
                  <p className="mt-2 text-[var(--mute)]">No registered devices recorded.</p>
                ) : (
                  <div className="mt-2 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--bg)]">
                    {inspectDevices.map((d) => (
                      <div key={d.deviceId} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div>
                          <div className="font-semibold text-[var(--ink)]">{d.deviceName}</div>
                          <div className="text-[11px] text-[var(--mute)]">{d.platform}</div>
                        </div>
                        <div className="font-mono-num text-[11px] text-[var(--mute)]">
                          Seen {formatTs(d.lastSeenAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="flex items-center gap-1.5 font-display text-sm font-bold text-[var(--ink)]">
                  <Activity className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Recent Activity Log ({inspectActivity.length})</span>
                </h3>
                {inspectLoading ? (
                  <p className="mt-2 text-[var(--mute)]">Loading activity log…</p>
                ) : inspectActivity.length === 0 ? (
                  <p className="mt-2 text-[var(--mute)]">No audit events recorded.</p>
                ) : (
                  <div className="mt-2 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--bg)]">
                    {inspectActivity.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div>
                          <div className="font-semibold text-[var(--ink)]">{a.action}</div>
                          <div className="text-[11px] text-[var(--mute)]">{a.deviceName}</div>
                        </div>
                        <div className="font-mono-num text-[11px] text-[var(--mute)]">
                          {formatTs(a.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
