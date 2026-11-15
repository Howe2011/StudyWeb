import { FormEvent, useState } from 'react';
import { User } from 'firebase/auth';
import { Check, Copy, ExternalLink, KeyRound, Lock, LogIn, Shield, X } from 'lucide-react';
import { firebaseProjectId } from '../firebase';
import { UserAccountDoc } from '../types';

interface AuthVaultModalProps {
  open: boolean;
  onClose: () => void;
  firebaseUser: User | null;
  account: UserAccountDoc | null;
  vaultUnlocked: boolean;
  hasGuestData: boolean;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onCreateVault: (
    passphrase: string,
    rememberDevice: boolean,
    importGuest: boolean
  ) => Promise<string>;
  onUnlockWithPassphrase: (
    passphrase: string,
    rememberDevice: boolean
  ) => Promise<void>;
  onUnlockWithRecovery: (
    recoveryCode: string,
    rememberDevice: boolean
  ) => Promise<void>;
}

export function AuthVaultModal({
  open,
  onClose,
  firebaseUser,
  account,
  vaultUnlocked,
  hasGuestData,
  onSignInGoogle,
  onSignOut,
  onCreateVault,
  onUnlockWithPassphrase,
  onUnlockWithRecovery,
}: AuthVaultModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [importGuest, setImportGuest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorizedHost, setUnauthorizedHost] = useState<string | null>(null);
  const [copiedHost, setCopiedHost] = useState(false);
  const [generatedRecovery, setGeneratedRecovery] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleGoogle = async () => {
    setError(null);
    setUnauthorizedHost(null);
    setBusy(true);
    try {
      await onSignInGoogle();
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      const msg = e instanceof Error ? e.message : String(e || '');
      if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedHost(host || 'your-domain.vercel.app');
        setError(
          `Firebase blocked Google sign-in on "${host || 'this domain'}" because it is not listed in Firebase Authorized Domains yet.`
        );
      } else if (code === 'auth/popup-blocked') {
        setError('Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.');
      } else if (code === 'auth/popup-closed-by-user') {
        setError('Sign-in popup was closed before completing.');
      } else {
        setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyHostname = async () => {
    if (!unauthorizedHost) return;
    try {
      await navigator.clipboard.writeText(unauthorizedHost);
      setCopiedHost(true);
      setTimeout(() => setCopiedHost(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (passphrase !== confirmPass) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      const code = await onCreateVault(passphrase, rememberDevice, importGuest && hasGuestData);
      setGeneratedRecovery(code);
      setPassphrase('');
      setConfirmPass('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize encrypted vault.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (useRecovery) {
        if (!recoveryInput.trim()) {
          setError('Enter your recovery code.');
          setBusy(false);
          return;
        }
        await onUnlockWithRecovery(recoveryInput, rememberDevice);
      } else {
        if (!passphrase) {
          setError('Enter your vault passphrase.');
          setBusy(false);
          return;
        }
        await onUnlockWithPassphrase(passphrase, rememberDevice);
      }
      setPassphrase('');
      setRecoveryInput('');
      onClose();
    } catch {
      setError(
        useRecovery
          ? 'Invalid recovery code. Check characters and dashes.'
          : 'Incorrect passphrase. Please try again or use your recovery code.'
      );
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!generatedRecovery) return;
    try {
      await navigator.clipboard.writeText(generatedRecovery);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-modal-title"
    >
      <div className="sd-card w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="vault-modal-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              {generatedRecovery
                ? 'Save Your Recovery Key'
                : !firebaseUser
                ? 'Sign In & Sync Across Devices'
                : !account
                ? 'Set Up Encrypted Cloud Vault'
                : 'Unlock Your Encrypted Vault'}
            </h2>
            <p className="mt-1 text-xs text-[var(--mute)]">
              AES-256-GCM client-side encryption · PBKDF2-SHA256 · Multi-device sync
            </p>
          </div>
          {!generatedRecovery && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="sd-btn h-8 w-8 shrink-0 rounded-full p-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-[var(--bad)] bg-[var(--bg)] px-3 py-2.5 text-xs font-medium text-[var(--bad)]">
            <p>{error}</p>
            {unauthorizedHost && (
              <div className="mt-2.5 space-y-2 border-t border-[var(--line)] pt-2.5 font-normal text-[var(--ink)]">
                <p className="text-[11px] leading-relaxed text-[var(--mute)]">
                  To enable Google sign-in on Vercel or a custom domain, add this hostname in{' '}
                  <strong className="text-[var(--ink)]">
                    Firebase Console → Authentication → Settings → Authorized domains
                  </strong>
                  :
                </p>
                <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5">
                  <code className="font-mono-num truncate text-[11px] font-semibold text-[var(--e3)]">
                    {unauthorizedHost}
                  </code>
                  <button
                    type="button"
                    onClick={copyHostname}
                    className="sd-btn shrink-0 px-2 py-0.5 text-[11px]"
                  >
                    {copiedHost ? (
                      <Check className="h-3 w-3 text-[var(--ok)]" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    )}
                    <span>{copiedHost ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <a
                  href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/settings`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--e3)] hover:underline"
                >
                  <span>Open Firebase Auth Authorized Domains</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        )}

        {generatedRecovery ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-[var(--mute)]">
              Your revision cards, Geography notes, Mock Planner schedule, and private profile are
              now encrypted with a 256-bit key. Store this recovery code safely in case you forget
              your passphrase on a new device.
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
              <code className="font-mono-num text-sm font-semibold tracking-wider text-[var(--e3)]">
                {generatedRecovery}
              </code>
              <button
                type="button"
                onClick={copyCode}
                className="sd-btn shrink-0 px-2.5 py-1 text-xs"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setGeneratedRecovery(null);
                onClose();
              }}
              className="sd-btn-pri w-full px-4 py-2.5 text-sm"
            >
              I have saved my recovery code
            </button>
          </div>
        ) : !firebaseUser ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-[var(--mute)]">
              Sign in with Google to synchronize your History &amp; Geography notes, flashcards,
              exam countdowns, and planner tasks across phones, tablets, and desktops.
            </p>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs text-[var(--mute)]">
              <div className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                <Shield className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Zero-Knowledge Cloud Sync</span>
              </div>
              <p className="mt-1 leading-relaxed">
                All study data and personal profile details are encrypted in your browser before
                reaching the cloud database.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogle}
              className="sd-btn-pri w-full px-4 py-2.5 text-sm"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>{busy ? 'Connecting...' : 'Continue with Google'}</span>
            </button>
          </div>
        ) : !account ? (
          <form onSubmit={handleCreate} className="mt-5 space-y-4">
            <div className="text-xs text-[var(--mute)]">
              Signed in as <strong className="text-[var(--ink)]">{firebaseUser.email}</strong>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Create Sync Passphrase (min 8 characters)
                <input
                  type="password"
                  required
                  minLength={8}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase"
                  className="sd-input mt-1.5"
                />
              </label>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Confirm Passphrase
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Repeat passphrase"
                  className="sd-input mt-1.5"
                />
              </label>
            </div>

            {hasGuestData && (
              <label className="flex items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={importGuest}
                  onChange={(e) => setImportGuest(e.target.checked)}
                  className="mt-0.5 rounded accent-[var(--e3)]"
                />
                <span>
                  Import existing revision notes, flashcard progress, and planner schedule from this
                  browser into your encrypted cloud vault.
                </span>
              </label>
            )}

            <label className="flex items-center gap-2 text-xs text-[var(--mute)]">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="rounded accent-[var(--e3)]"
              />
              <span>Keep vault unlocked on this trusted browser</span>
            </label>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)]"
              >
                Switch account
              </button>
              <button
                type="submit"
                disabled={busy}
                className="sd-btn-pri px-4 py-2 text-sm"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span>{busy ? 'Encrypting...' : 'Create Encrypted Vault'}</span>
              </button>
            </div>
          </form>
        ) : !vaultUnlocked ? (
          <form onSubmit={handleUnlock} className="mt-5 space-y-4">
            <div className="text-xs text-[var(--mute)]">
              Signed in as <strong className="text-[var(--ink)]">{firebaseUser.email}</strong>
            </div>

            {!useRecovery ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Vault Passphrase
                  <input
                    type="password"
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter your sync passphrase"
                    className="sd-input mt-1.5"
                  />
                </label>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Recovery Code
                  <input
                    type="text"
                    required
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    className="sd-input font-mono-num mt-1.5 uppercase"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-[var(--mute)]">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="rounded accent-[var(--e3)]"
                />
                <span>Remember on this device</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setUseRecovery((v) => !v);
                }}
                className="cursor-pointer font-semibold text-[var(--e3)] hover:underline"
              >
                {useRecovery ? 'Use passphrase instead' : 'Use recovery code'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)]"
              >
                Sign out
              </button>
              <button
                type="submit"
                disabled={busy}
                className="sd-btn-pri px-4 py-2 text-sm"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                <span>{busy ? 'Decrypting...' : 'Unlock & Sync'}</span>
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
