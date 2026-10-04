export function MetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="metric-tile"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}
