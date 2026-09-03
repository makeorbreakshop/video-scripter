export default function InspirationLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="cs-page-head">
        <div>
          <div className="cs-skel" style={{ width: 140, height: 20, borderRadius: 5 }} />
          <div className="cs-skel" style={{ width: 280, height: 13, borderRadius: 4, marginTop: 6 }} />
        </div>
      </div>
      <div className="cs-skel" style={{ height: 70, borderRadius: 10, marginBottom: 18 }} />
      {[0, 1, 2].map((index) => (
        <div key={index} className="cs-skel" style={{ height: 190, borderRadius: 10, marginBottom: 12 }} />
      ))}
    </div>
  );
}
