import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { ensureBootstrapAdminRole, listAllUserAccounts, updateUserRole } from '../lib/syncService';
import { UserAccountDoc, UserRole } from '../types';

interface AdminPanelProps {
  currentAdminUid: string;
  currentAdminEmail?: string | null;
  currentAdminAccount?: UserAccountDoc | null;
}

export function AdminPanel({
  currentAdminUid,
  currentAdminEmail,
  currentAdminAccount,
}: AdminPanelProps) {
  const [users, setUsers] = useState<UserAccountDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
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
      let msg = err instanceof Error ? err.message : 'Unable to load users.';
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed?.error) msg = parsed.error;
      } catch {
        // keep original string
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentAdminUid, currentAdminEmail, currentAdminAccount]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (targetUid: string, role: UserRole) => {
    setUpdatingUid(targetUid);
    setError(null);
    try {
      await updateUserRole(currentAdminUid, targetUid, role);
      setUsers((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, role } : u))
      );
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Failed to update role.';
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed?.error) msg = parsed.error;
      } catch {
        // keep original string
      }
      setError(msg);
    } finally {
      setUpdatingUid(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1120px] space-y-6 px-4 py-7 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">
              Role-Based Access Control
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Manage account roles across StudyWeb. Private PII profiles remain encrypted and inaccessible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="sd-btn px-3.5 py-2 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh directory</span>
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--bad)] bg-[var(--card)] p-3 text-xs text-[var(--bad)]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="sd-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--line)] bg-[var(--bg)] text-xs font-semibold text-[var(--mute)]">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">UID</th>
                  <th className="px-4 py-3">Encryption</th>
                  <th className="px-4 py-3">Key Ver.</th>
                  <th className="px-4 py-3 text-right">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {users.map((u) => (
                  <tr key={u.uid} className="hover:bg-[var(--bg)]/60">
                    <td className="px-4 py-3 font-semibold text-[var(--ink)]">
                      {u.displayName}
                      {u.uid === currentAdminUid && (
                        <span className="ml-2 text-xs font-semibold text-[var(--e3)]">
                          · You
                        </span>
                      )}
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs text-[var(--mute)]">
                      {u.uid}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--mute)]">
                      {u.encryptionMode}
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs text-[var(--mute)]">
                      v{u.keyVersion}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <select
                        aria-label={`Role for ${u.displayName}`}
                        disabled={updatingUid === u.uid || u.uid === currentAdminUid}
                        value={u.role}
                        onChange={(e) => void handleRoleChange(u.uid, e.target.value as UserRole)}
                        className="sd-input w-auto py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        <option value="student">Student</option>
                        <option value="educator">Educator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-[var(--mute)]">
                      No user accounts found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
