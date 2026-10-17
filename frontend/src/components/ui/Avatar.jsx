import React, { useState } from 'react';

export default function Avatar({ src, name, size }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (!src || failed) {
    return (
      <span className="avatar avatar-fallback" style={style} aria-hidden="true">
        {(name || '?').trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }
  return <img className="avatar" src={src} alt="" style={style} onError={() => setFailed(true)} />;
}
