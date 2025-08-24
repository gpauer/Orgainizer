import React, { useState, useEffect, useRef } from 'react';
import api from '../api/http';
import './UserMenu.css';

interface UserInfo {
  email: string;
  displayName: string;
  profilePicture: string;
  givenName?: string;
  familyName?: string;
  locale?: string;
}

interface UserMenuProps {
  onLogout: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ onLogout }) => {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    api.get('/auth/me')
      .then(r => { if (mounted) setUser(r.data); })
      .catch(() => {/* ignore */});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const initials = user?.displayName?.split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
  const showAvatar = !!user?.profilePicture;

  return (
    <div className="user-menu" ref={menuRef}>
      <button className="avatar-btn" onClick={() => setOpen(o => !o)} title={user?.displayName || 'Account'}>
        {showAvatar ? (
          <img src={user!.profilePicture} alt={user!.displayName} onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
        ) : (
          <span className="avatar-fallback">{initials || 'U'}</span>
        )}
      </button>
      {open && user && (
        <div className="user-popover">
          <div className="user-header">
            <img src={user.profilePicture} alt={user.displayName} />
            <div>
              <div className="name">{user.displayName}</div>
              <div className="email">{user.email}</div>
            </div>
          </div>
          <div className="meta">
            {user.locale && <div>Locale: {user.locale}</div>}
          </div>
          <button className="logout" onClick={onLogout}>Logout</button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
