import { useEffect, useState } from "react";
import { User } from "./icons";
import { emailInitials, gravatarUrl } from "../lib/gravatar";

interface UserAvatarProps {
  email?: string | null;
  size?: number;
  className?: string;
}

export function UserAvatar({ email, size = 32, className = "" }: UserAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);

    if (!email?.trim()) return;

    void gravatarUrl(email, size * 2)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [email, size]);

  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.34)),
        background: "var(--accent-muted)",
        color: "var(--accent)",
        border: "1px solid var(--border-subtle)",
      }}
      aria-hidden
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          width={size}
          height={size}
          className="block h-full w-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : email?.trim() ? (
        emailInitials(email)
      ) : (
        <User size={Math.round(size * 0.48)} strokeWidth={1.75} />
      )}
    </div>
  );
}
