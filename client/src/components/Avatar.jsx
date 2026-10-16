// Round avatar with a calm colour chosen from the username, plus an optional online dot.
const COLORS = ['#3b6ea5', '#0f766e', '#6d5bd0', '#a2527a', '#a8741a', '#4c7d3a', '#7a5c99', '#2f7f9d'];

function pick(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return COLORS[h % COLORS.length];
}

export default function Avatar({ name, size = 44, online }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: pick(name) }}>
      {name[0].toUpperCase()}
      {online !== undefined && <i className={`dot ${online ? 'online' : ''}`} />}
    </span>
  );
}
