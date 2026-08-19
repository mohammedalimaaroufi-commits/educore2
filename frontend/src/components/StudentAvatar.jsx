import React from 'react';
import { initialsAvatar } from '../utils/image.js';

export default function StudentAvatar({ name, photoUrl, size = 36 }) {
  if (photoUrl) {
    return (
      <img src={photoUrl} alt={name} className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }} />
    );
  }
  const { initials, color } = initialsAvatar(name);
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {initials}
    </div>
  );
}
