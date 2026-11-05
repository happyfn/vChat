import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';

type Props = {
  onAuthed: (token: string, user: User) => void;
};

export function LoginPage({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
      onAuthed(res.token, res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>vChat</h1>
        <p>Let`s Fucking Go!</p>
        <div className="login-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="field">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>
          <button className="primary-btn" disabled={loading}>
            {loading ? '请稍候…' : mode === 'login' ? '进入' : '创建账号'}
          </button>
        </form>
      </div>
    </div>
  );
}
