// A wax-seal style mark: an amber seal with a keyhole
export default function Logo({ size = 28, text = true }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 1.5l3.1 2.2 3.8-.4 1.5 3.5 3.5 1.5-.4 3.8L29.5 16l-2.2 3.1.4 3.8-3.5 1.5-1.5 3.5-3.8-.4L16 30.5l-3.1-2.2-3.8.4-1.5-3.5-3.5-1.5.4-3.8L2.5 16l2.2-3.1-.4-3.8 3.5-1.5 1.5-3.5 3.8.4L16 1.5Z"
          fill="var(--accent)"
        />
        <circle cx="16" cy="13.5" r="3" fill="var(--on-accent)" />
        <path d="M14.4 15.5h3.2l1 7h-5.2l1-7Z" fill="var(--on-accent)" />
      </svg>
      {text && <span>SecureChat</span>}
    </span>
  );
}
