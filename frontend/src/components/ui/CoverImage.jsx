import React, { useState } from 'react';
import { Music2 } from 'lucide-react';
import { DEFAULT_COVER } from '../../utils/requestConstants';

// Beatmap cover with a drawn placeholder for manual requests and covers that
// haven't downloaded yet (the server's default cover is a 1px stub).
export default function CoverImage({ src, className = 'request-cover', alt = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || src === DEFAULT_COVER || failed) {
    return <span className={`${className} cover-placeholder`} aria-hidden="true"><Music2 size={14} /></span>;
  }
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function coverBackground(src) {
  return src && src !== DEFAULT_COVER ? { backgroundImage: `url("${src}")` } : undefined;
}
