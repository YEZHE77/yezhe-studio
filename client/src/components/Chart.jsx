import React from 'react';

// 零依赖 SVG 图表：柱状图 + 折线图（浅色主题，适配 w-full 自适应）
export function BarChart({ data = [], height = 220, color = '#2f7cf6', valueFormat = (v) => v }) {
  const W = 660, H = height, padL = 44, padB = 30, padT = 14, padR = 14;
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  const n = data.length || 1;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(48, slot * 0.55);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + (H - padT - padB) * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f5" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9aa3af">{valueFormat(Math.round(max * t))}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padL + slot * i + (slot - bw) / 2;
        const h = Math.max(2, (H - padT - padB) * ((d.value || 0) / max));
        const y = H - padB - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx="3" fill={color} />
            <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize="11" fill="#1f2329">{valueFormat(d.value || 0)}</text>
            <text x={x + bw / 2} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#9aa3af">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ labels = [], series = [], height = 240, valueFormat = (v) => v }) {
  const W = 660, H = height, padL = 48, padB = 30, padT = 14, padR = 14;
  const all = series.flatMap((s) => s.values || []);
  const max = Math.max(1, ...all);
  const n = labels.length || 1;
  const xAt = (i) => padL + (W - padL - padR) * (n <= 1 ? 0.5 : i / (n - 1));
  const yAt = (v) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = yAt(max * t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef1f5" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9aa3af">{valueFormat(Math.round(max * t))}</text>
          </g>
        );
      })}
      {series.map((s, si) => (
        <g key={si}>
          <polyline points={(s.values || []).map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" />
          {(s.values || []).map((v, i) => (
            <circle key={i} cx={xAt(i)} cy={yAt(v)} r="3" fill={s.color} />
          ))}
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={xAt(i)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#9aa3af">{l}</text>
      ))}
      <g>
        {series.map((s, si) => (
          <g key={si} transform={`translate(${padL + 6}, ${padT + 4 + si * 16})`}>
            <rect width="10" height="10" rx="2" fill={s.color} />
            <text x="15" y="9" fontSize="11" fill="#5b6573">{s.name}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
