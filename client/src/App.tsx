import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { Shell } from './layout/Shell';
import { LoginPage } from './pages/Login';
import { disconnectSocket } from './socket';

const TOKEN_KEY = 'vchat_token';
const USER_KEY = 'vchat_user';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [booting, setBooting] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    api
      .me(token)
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (booting) {
    return <div className="empty-state">加载中…</div>;
  }

  if (!token || !user) {
    return (
      <LoginPage
        onAuthed={(nextToken, nextUser) => {
          localStorage.setItem(TOKEN_KEY, nextToken);
          localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
          setToken(nextToken);
          setUser(nextUser);
        }}
      />
    );
  }

  return (
    <Shell
      token={token}
      user={user}
      onLogout={() => {
        disconnectSocket();
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      }}
    />
  );
}
