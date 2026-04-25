function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatCurrency(amount) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export default function LineChart({ series, height = 220 }) {
  const values = series.map((p) => (Number.isFinite(p.value) ? p.value : 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;

  const w = 640;
  const h = height;
  const padX = 22;
  const padY = 22;

  const points = series.map((p, i) => {
    const x = padX + (i * (w - padX * 2)) / Math.max(1, series.length - 1);
    const y = padY + (1 - (clamp(p.value, min, max) - min) / range) * (h - padY * 2);
    return { ...p, x, y };
  });

  const path = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const area = `${path} L ${points[points.length - 1].x.toFixed(2)} ${(h - padY).toFixed(2)} L ${
    points[0].x.toFixed(2)
  } ${(h - padY).toFixed(2)} Z`;

  return (
    <div style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Daily revenue chart">
        <defs>
          <linearGradient id="toneArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--brand-2)" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id="toneLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#toneArea)" />
        <path d={path} stroke="url(#toneLine)" strokeWidth="3" fill="none" strokeLinejoin="round" />

        {points.map((p) => (
          <g key={p.date}>
            <circle cx={p.x} cy={p.y} r="4.6" fill="var(--surface-solid)" />
            <circle cx={p.x} cy={p.y} r="3.2" fill="var(--brand)" />
          </g>
        ))}

        {points.map((p) => (
          <text
            key={`${p.date}-label`}
            x={p.x}
            y={h - 6}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted)"
          >
            {p.label}
          </text>
        ))}

        <text x={padX} y={14} fontSize="12" fill="var(--muted)">
          {formatCurrency(max)}
        </text>
      </svg>
    </div>
  );
}

