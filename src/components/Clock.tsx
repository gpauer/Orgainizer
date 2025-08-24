import React, { useEffect, useState } from 'react';

const fmt: Intl.DateTimeFormatOptions = { weekday:'short', month:'short', day:'numeric' };

function format(now: Date) {
  const datePart = now.toLocaleDateString(undefined, fmt);
  const timePart = now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  return `${datePart} · ${timePart}`;
}

const Clock: React.FC = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000); // update every 30s
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="header-clock" aria-label="Current date and time">{format(now)}</div>
  );
};

export default Clock;
