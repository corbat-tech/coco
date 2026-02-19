import React, { useState, useCallback } from 'react';

interface UserCardProps {
  /** User name to display */
  name: string;
  /** User email */
  email: string;
  /** Callback when card is clicked */
  onClick?: () => void;
}

/**
 * Displays a user card with name and email.
 */
export function UserCard({ name, email, onClick }: UserCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      role="button"
      aria-label={`User card for ${name}`}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <h2>{name}</h2>
      <p>{email}</p>
      {isExpanded && (
        <button onClick={handleToggle} aria-expanded={isExpanded}>
          Show less
        </button>
      )}
    </div>
  );
}
