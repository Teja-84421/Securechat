// Round avatar with a colour derived from the username, plus an optional online dot.
function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function Avatar({ name, size = 44, online }) {
  const h = hue(name);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(140deg, hsl(${h} 72% 62%), hsl(${(h + 48) % 360} 70% 48%))`,
      }}
    >
      {name[0].toUpperCase()}
      {online !== undefined && <i className={`dot ${online ? 'online' : ''}`} />}
    </span>
  );
}
