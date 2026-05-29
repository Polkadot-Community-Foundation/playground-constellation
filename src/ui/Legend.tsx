const NODE_ITEMS = [
  { cls: "lg-app", label: "App" },
  { cls: "lg-pinned", label: "Tutorial / sample app" },
  { cls: "lg-builder", label: "Builder" },
];

const EDGE_ITEMS = [
  { cls: "lg-lineage", label: "Mod lineage" },
  { cls: "lg-ownership", label: "Owns" },
];

export function Legend() {
  return (
    <div className="legend">
      {NODE_ITEMS.map((it) => (
        <div className="lg-row" key={it.label}>
          <span className={`lg-dot ${it.cls}`} />
          <span>{it.label}</span>
        </div>
      ))}
      {EDGE_ITEMS.map((it) => (
        <div className="lg-row" key={it.label}>
          <span className={`lg-line ${it.cls}`} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
