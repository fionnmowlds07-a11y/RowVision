import { megabytes, percent, useModels } from "./use-models";

/** The measuring models in Settings: what is on this computer, and a way to fetch them. */
export function ModelsCard() {
  const models = useModels();
  if (!models) return null;
  return (
    <section className="card stack" style={{ maxWidth: 480 }} aria-labelledby="models-title" data-testid="models-card">
      <h2 id="models-title" style={{ fontSize: 19 }}>Measuring models</h2>
      {models.state === "ready" ? <p className="soft">Downloaded. RowVision measures your clips without the internet.</p> : null}
      {models.state === "checking" ? <p className="soft">Checking this computer…</p> : null}
      {models.state === "no_engine" ? <p className="soft">The measuring part of RowVision isn&apos;t installed in this test version yet, so there is nothing to download.</p> : null}
      {models.state === "missing" ? (
        <>
          <p className="soft">Not downloaded yet. RowVision needs them once{models.totalBytes > 0 ? `, about ${megabytes(models.totalBytes)}` : ""}, and clips wait until they are here.</p>
          <button type="button" className="button primary" onClick={() => void window.rowvision.downloadModels()}>Download</button>
        </>
      ) : null}
      {models.state === "downloading" ? (
        <>
          <p className="soft" role="status">Downloading, {megabytes(models.downloadedBytes)} of {megabytes(models.totalBytes)} ({percent(models)}%)</p>
          <progress max={100} value={percent(models)} aria-label="Download progress" />
          <button type="button" className="button quiet" onClick={() => void window.rowvision.cancelModels()}>Cancel</button>
        </>
      ) : null}
      {models.state === "failed" ? (
        <>
          <p role="alert" className="error">{models.message}</p>
          <button type="button" className="button primary" onClick={() => void window.rowvision.downloadModels()}>Try again</button>
        </>
      ) : null}
    </section>
  );
}
