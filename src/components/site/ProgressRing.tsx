export function ProgressRing({ value, size = 96 }: { value: number; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, value) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.9 0.01 250)" strokeWidth="8" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .6s linear" }}
      />
      <text
        x="50%"
        y="52%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-card-foreground font-display text-sm font-bold"
      >
        {value.toFixed(0)}%
      </text>
    </svg>
  );
}
