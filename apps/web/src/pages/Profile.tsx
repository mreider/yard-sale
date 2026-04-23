import { useId, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError, type PublicUser, api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

/**
 * /profile — account settings in three grouped cards:
 *
 *   1. Account      avatar + identity (username, email, created)
 *   2. Preferences  defaults applied to new sales (theme, language)
 *   3. Security     password change + delete account, together
 *
 * Previous version had 5 scattered cards with avatar floating
 * between password change and a read-only "account facts" card. This
 * version clusters by purpose so it scans top-to-bottom.
 */
export function ProfilePage() {
  const { user, loading, setUser } = useAuth();

  if (loading) return <div className="card">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <AccountCard user={user} onUserUpdate={(u) => setUser(u)} />
      <PreferencesCard user={user} onUserUpdate={(u) => setUser(u)} />
      <SecurityCard onDeleted={() => setUser(null)} />
    </>
  );
}

function AccountCard({
  user,
  onUserUpdate,
}: {
  user: PublicUser;
  onUserUpdate: (u: PublicUser) => void;
}) {
  return (
    <div className="card">
      <h2>Account</h2>
      <p className="sub">Your identity on yrdsl.app.</p>
      <div className="profile-account">
        <AvatarBlock user={user} onUserUpdate={onUserUpdate} />
        <dl className="kv">
          <dt>Username</dt>
          <dd>@{user.username}</dd>
          <dt>Email</dt>
          <dd>
            {user.email}{' '}
            {user.emailConfirmed ? (
              <span className="pill ok">confirmed</span>
            ) : (
              <span className="pill warn">unconfirmed</span>
            )}
          </dd>
          <dt>Member since</dt>
          <dd>{new Date(user.createdAt * 1000).toLocaleDateString()}</dd>
        </dl>
      </div>
    </div>
  );
}

function AvatarBlock({
  user,
  onUserUpdate,
}: {
  user: PublicUser;
  onUserUpdate: (u: PublicUser) => void;
}) {
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(0);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setFlash({
        kind: 'err',
        msg: `Please pick a PNG, JPEG, or WebP. You gave "${file.type || 'unknown'}".`,
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFlash({ kind: 'err', msg: 'That file is over 10 MB.' });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const img = await createImageBitmap(file);
      if (img.width < 128 || img.height < 128) {
        throw new Error(`Image too small (${img.width}×${img.height}). Minimum 128×128.`);
      }
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create canvas context.');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.85),
      );
      if (!blob) throw new Error('Could not encode WebP.');
      const { avatarUrl } = await api.uploadAvatar(blob);
      onUserUpdate({ ...user, avatarUrl });
      setBump(Date.now());
      setFlash({ kind: 'ok', msg: 'Avatar updated.' });
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  const src = user.avatarUrl ? `${user.avatarUrl}?v=${bump}` : null;

  return (
    <div className="avatar-block">
      <div className="avatar-preview" aria-hidden="true">
        {src ? <img src={src} alt="" /> : <span>{user.username.charAt(0).toUpperCase()}</span>}
      </div>
      <div>
        <label className="btn ghost tiny">
          {busy ? 'Uploading…' : src ? 'Replace' : 'Upload avatar'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            disabled={busy}
            style={{ display: 'none' }}
          />
        </label>
        <div className="avatar-hint">PNG, JPEG, or WebP. Minimum 128×128.</div>
        {flash && (
          <div className={`flash ${flash.kind}`} style={{ marginTop: 8, marginBottom: 0 }}>
            {flash.msg}
          </div>
        )}
      </div>
    </div>
  );
}

function PreferencesCard({
  user,
  onUserUpdate,
}: {
  user: PublicUser;
  onUserUpdate: (u: PublicUser) => void;
}) {
  const langId = useId();
  const themeId = useId();
  const [defaultLanguage, setDefaultLanguage] = useState(user.defaultLanguage);
  const [defaultTheme, setDefaultTheme] = useState(user.defaultTheme);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const { user: updated } = await api.updateMe({
        defaultLanguage,
        defaultTheme,
      });
      onUserUpdate(updated);
      setFlash({ kind: 'ok', msg: 'Saved.' });
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Preferences</h2>
      <p className="sub">These apply to every new sale you create. Per-sale settings override.</p>
      <form onSubmit={save}>
        {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
        <div className="field">
          <label htmlFor={themeId}>Default theme</label>
          <select
            id={themeId}
            value={defaultTheme}
            onChange={(e) => setDefaultTheme(e.target.value)}
          >
            <option value="conservative">Clean</option>
            <option value="artsy">Magazine</option>
            <option value="hip">Bold</option>
            <option value="retro">Retro</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={langId}>Default language</label>
          <select
            id={langId}
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </select>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SecurityCard({ onDeleted }: { onDeleted: () => void }) {
  return (
    <div className="card">
      <h2>Security</h2>
      <p className="sub">
        Change your password, or permanently delete your account along with all sales, items,
        images, and tokens.
      </p>
      <h3 className="section-sub">Change password</h3>
      <PasswordForm />
      <h3 className="section-sub">Delete account</h3>
      <p className="sub" style={{ marginBottom: 12 }}>
        Irreversible. Your sales stop being accessible immediately; backing data is purged after a
        short grace window.
      </p>
      <DeleteForm onDeleted={onDeleted} />
    </div>
  );
}

function PasswordForm() {
  const currentId = useId();
  const newId = useId();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNewPw] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setFlash({ kind: 'ok', msg: 'Password changed. Logging out…' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_current_password') {
        setFlash({ kind: 'err', msg: 'Current password is incorrect.' });
      } else {
        setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
      <div className="field">
        <label htmlFor={currentId}>Current password</label>
        <input
          id={currentId}
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={newId}>New password</label>
        <input
          id={newId}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPw(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>
      <div className="row">
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

function DeleteForm({ onDeleted }: { onDeleted: () => void }) {
  const currentPwId = useId();
  const confirmId = useId();
  const [currentPassword, setCurrent] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const ready = currentPassword.length > 0 && confirmation === 'DELETE';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setFlash(null);
    try {
      await api.deleteMe(currentPassword);
      onDeleted();
      window.location.href = '/';
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_current_password') {
        setFlash({ kind: 'err', msg: 'Current password is incorrect.' });
      } else {
        setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed.' });
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {flash && <div className={`flash ${flash.kind}`}>{flash.msg}</div>}
      <div className="field">
        <label htmlFor={currentPwId}>Current password</label>
        <input
          id={currentPwId}
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={confirmId}>
          Type <code>DELETE</code> to confirm
        </label>
        <input
          id={confirmId}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="row">
        <button className="btn danger" disabled={busy || !ready} type="submit">
          {busy ? 'Deleting…' : 'Permanently delete account'}
        </button>
      </div>
    </form>
  );
}
