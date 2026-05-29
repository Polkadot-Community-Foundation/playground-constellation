export function Headline({ text, meta }: { text: string | null; meta?: string }) {
  if (!text) return null;
  return (
    <div className="headline">
      <div className="headline-text">{text}</div>
      {meta && <div className="headline-meta">{meta}</div>}
    </div>
  );
}
